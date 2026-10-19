// Public-transit times to the office, read from the precomputed `transit_times` table (D048).
// The office is matched to the area it sits in; every area's time is to that area's center.
// No API calls: the table is built offline by pipeline/settle_pipeline/compute_transit.py.

import { getPool } from "@/lib/db";
import type { Point } from "@/lib/commute";
import type { TransitTimes } from "@/lib/scoring/commuteMode";

export type TransitLookup = { ok: true; times: TransitTimes } | { ok: false; message: string };

export async function getTransitTimes(office: Point): Promise<TransitLookup> {
  const pool = getPool();
  // The area containing the office; failing that, the nearest area center within 3 km
  // (an office on a shoreline or just outside a ZIP boundary).
  const area = await pool.query<{ zcta: string }>(
    `SELECT zcta FROM areas
     WHERE ST_Contains(geometry, ST_SetSRID(ST_MakePoint($1, $2), 4326))
        OR ST_DWithin(centroid::geography, ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography, 3000)
     ORDER BY ST_Contains(geometry, ST_SetSRID(ST_MakePoint($1, $2), 4326)) DESC,
              centroid::geography <-> ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography
     LIMIT 1`,
    [office.lng, office.lat],
  );
  if (area.rows.length === 0) {
    return { ok: false, message: "Public-transit times are only available for offices inside the five Bay Area counties." };
  }
  const officeZcta = area.rows[0].zcta;
  const { rows } = await pool.query<{ from_zcta: string; minutes: number | null; intrazonal: boolean; service_date: string }>(
    "SELECT from_zcta, minutes, intrazonal, service_date::text FROM transit_times WHERE to_zcta = $1",
    [officeZcta],
  );
  if (rows.length === 0) {
    return { ok: false, message: "Public-transit times haven't been computed yet. Choose Drive for now." };
  }
  return {
    ok: true,
    times: {
      officeZcta,
      minutesByZcta: new Map(rows.map((r) => [r.from_zcta, r.minutes])),
      estimated: new Set(rows.filter((r) => r.intrazonal).map((r) => r.from_zcta)),
      serviceDate: rows[0].service_date,
    },
  };
}
