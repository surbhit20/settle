// Drive times from every area to the office via the OpenRouteService Matrix API, cached in
// `commute_cache` by office coordinate rounded to 3 decimals (decisions.md D024, D028).

import { getPool } from "@/lib/db";

export const COMMUTE_MODE = "driving-car";
export const ORS_MATRIX_URL = `https://api.openrouteservice.org/v2/matrix/${COMMUTE_MODE}`;
export const ORS_SOURCE = {
  name: "OpenRouteService (drive time without traffic)",
  url: "https://openrouteservice.org/dev/#/api-docs/matrix_service",
};

export type Point = { lat: number; lng: number };
export type Centroid = Point & { zcta: string };

// ~100 m grid: offices this close share cached commutes.
export function officeKey(office: Point): string {
  return `${office.lat.toFixed(3)},${office.lng.toFixed(3)}`;
}

// One request: every area is a source, the office is the only destination (home -> work).
// ORS wants [lng, lat] order. Pure, so it is unit tested.
export function buildMatrixRequest(office: Point, areas: Centroid[]) {
  return {
    locations: [...areas.map((a) => [a.lng, a.lat]), [office.lng, office.lat]],
    sources: areas.map((_, i) => i),
    destinations: [areas.length],
    metrics: ["duration"],
  };
}

// durations[i][0] is seconds from area i to the office, or null when ORS found no route.
export function parseMatrixResponse(body: unknown, areas: Centroid[]): Map<string, number | null> {
  const durations = (body as { durations?: (number | null)[][] }).durations;
  if (!Array.isArray(durations) || durations.length !== areas.length) {
    throw new Error("ORS matrix: unexpected response shape");
  }
  const out = new Map<string, number | null>();
  areas.forEach((a, i) => {
    const seconds = durations[i]?.[0];
    out.set(a.zcta, typeof seconds === "number" ? seconds / 60 : null);
  });
  return out;
}

export type MatrixClient = (office: Point, areas: Centroid[]) => Promise<Map<string, number | null>>;

export const orsMatrixClient: MatrixClient = async (office, areas) => {
  const key = process.env.ORS_API_KEY;
  if (!key) throw new Error("ORS_API_KEY is not set");
  const res = await fetch(ORS_MATRIX_URL, {
    method: "POST",
    headers: { Authorization: key, "Content-Type": "application/json" },
    body: JSON.stringify(buildMatrixRequest(office, areas)),
  });
  if (!res.ok) throw new Error(`ORS matrix failed: HTTP ${res.status} ${await res.text()}`);
  return parseMatrixResponse(await res.json(), areas);
};

// Cache-first: if every area already has a cached time for this office, no ORS request is made.
export async function getCommutes(
  office: Point,
  client: MatrixClient = orsMatrixClient,
): Promise<{ minutesByZcta: Map<string, number | null>; fromCache: boolean }> {
  const pool = getPool();
  const key = officeKey(office);
  const areas = (
    await pool.query<Centroid>("SELECT zcta, ST_Y(centroid) AS lat, ST_X(centroid) AS lng FROM areas ORDER BY zcta")
  ).rows;
  const cached = await pool.query<{ zcta: string; minutes: number | null }>(
    "SELECT zcta, minutes FROM commute_cache WHERE office_key = $1 AND mode = $2",
    [key, COMMUTE_MODE],
  );
  if (cached.rows.length === areas.length) {
    return { minutesByZcta: new Map(cached.rows.map((r) => [r.zcta, r.minutes])), fromCache: true };
  }

  const minutesByZcta = await client(office, areas);
  const zctas = [...minutesByZcta.keys()];
  // UNNEST turns two parallel arrays into rows, so all 208 rows go in one statement.
  await pool.query(
    `INSERT INTO commute_cache (office_key, zcta, minutes, mode)
     SELECT $1, z, m, $4 FROM UNNEST($2::text[], $3::float8[]) AS t(z, m)
     ON CONFLICT (office_key, zcta, mode) DO UPDATE SET minutes = EXCLUDED.minutes, fetched_at = now()`,
    [key, zctas, zctas.map((z) => minutesByZcta.get(z)), COMMUTE_MODE],
  );
  return { minutesByZcta, fromCache: false };
}
