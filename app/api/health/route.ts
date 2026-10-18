import { connection } from "next/server";
import { getPool } from "@/lib/db";

// GET /api/health: confirms the app can reach Postgres and that PostGIS is installed.
export async function GET() {
  // Tells Next.js this route must run per request, never prerendered at build time
  // (we don't want `next build` to need a live database).
  await connection();

  try {
    const { rows } = await getPool().query<{ postgis: string }>(
      "SELECT PostGIS_Version() AS postgis",
    );
    return Response.json({ ok: true, postgis: rows[0].postgis });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return Response.json({ ok: false, error: message }, { status: 503 });
  }
}
