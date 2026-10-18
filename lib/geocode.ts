// Office geocoding via Mireye POST /v1/geocode (1 credit per call), cached in `geocode_cache`
// so each distinct address costs at most one credit (decisions.md D025).

import { getPool } from "@/lib/db";

export type GeocodeResult =
  | { ok: true; lat: number; lng: number; accuracyType: string; normalizedAddress: string; source: string | null }
  | { ok: false; status: "too_coarse" | "not_found" | "rejected_accuracy"; message: string };

// Accuracy types we trust for an office location. Mireye refuses centroid-grade matches itself;
// this list is a second guard in case a new type appears.
export const ACCEPTED_ACCURACY = ["rooftop", "range_interpolation"];

// "  1 Market St,  San Francisco " -> "1 market st, san francisco"
export function addressKey(address: string): string {
  return address.trim().toLowerCase().replace(/\s+/g, " ");
}

// Turn Mireye's HTTP status + JSON body into a GeocodeResult. Pure, so it is unit tested.
// Throws for errors that aren't about the address (auth, timeouts, outages); those must not be cached.
export function parseGeocodeResponse(status: number, body: unknown): GeocodeResult {
  // `as` tells TypeScript what shape we expect; we still check the fields we use.
  const b = body as Record<string, unknown>;
  if (status === 200) {
    const accuracyType = String(b.accuracy_type ?? "");
    if (typeof b.lat !== "number" || typeof b.lng !== "number") throw new Error("geocode: missing lat/lng");
    if (!ACCEPTED_ACCURACY.includes(accuracyType)) {
      return {
        ok: false,
        status: "rejected_accuracy",
        message: `Address could only be placed approximately (${accuracyType}). Please enter a full street address.`,
      };
    }
    return {
      ok: true,
      lat: b.lat,
      lng: b.lng,
      accuracyType,
      normalizedAddress: String(b.normalized_address ?? ""),
      source: typeof b.source === "string" ? b.source : null,
    };
  }
  const detail = (b?.detail ?? {}) as Record<string, unknown>;
  if (status === 404 && detail.error === "address_too_coarse") {
    return { ok: false, status: "too_coarse", message: "That address is too general. Please enter a full street address." };
  }
  if (status === 404 && detail.error === "address_not_found") {
    return { ok: false, status: "not_found", message: "We couldn't find that address. Please check it and try again." };
  }
  throw new Error(`geocode failed: HTTP ${status} ${String(detail.error ?? "")}`.trim());
}

// The network call, separated so tests and the scoring route can swap in a fake.
export type Geocoder = (address: string) => Promise<GeocodeResult>;

export const mireyeGeocoder: Geocoder = async (address) => {
  const token = process.env.MIREYE_API_TOKEN;
  if (!token) throw new Error("MIREYE_API_TOKEN is not set");
  const res = await fetch("https://api.mireye.com/v1/geocode", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ address }),
  });
  return parseGeocodeResponse(res.status, await res.json().catch(() => ({})));
};

// Cache-first lookup. Successes and address refusals are cached; network/auth errors are not.
export async function geocodeOffice(address: string, geocoder: Geocoder = mireyeGeocoder): Promise<GeocodeResult> {
  const key = addressKey(address);
  const pool = getPool();
  const cached = await pool.query(
    "SELECT status, lat, lng, accuracy_type, normalized_address, source, message FROM geocode_cache WHERE address_key = $1",
    [key],
  );
  if (cached.rows.length > 0) {
    const r = cached.rows[0];
    return r.status === "ok"
      ? { ok: true, lat: r.lat, lng: r.lng, accuracyType: r.accuracy_type, normalizedAddress: r.normalized_address, source: r.source }
      : { ok: false, status: r.status, message: r.message };
  }

  const result = await geocoder(address);
  await pool.query(
    `INSERT INTO geocode_cache (address_key, status, lat, lng, accuracy_type, normalized_address, source, message)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8) ON CONFLICT (address_key) DO NOTHING`,
    result.ok
      ? [key, "ok", result.lat, result.lng, result.accuracyType, result.normalizedAddress, result.source, null]
      : [key, result.status, null, null, null, null, null, result.message],
  );
  return result;
}
