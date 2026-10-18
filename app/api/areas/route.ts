import { connection } from "next/server";
import { getAreasGeoJSON } from "@/lib/areas";

// GET /api/areas: every area as a GeoJSON FeatureCollection for the map.
export async function GET() {
  await connection(); // per-request; `next build` must not need the database (D007)

  try {
    return Response.json(await getAreasGeoJSON());
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return Response.json({ error: message }, { status: 503 });
  }
}
