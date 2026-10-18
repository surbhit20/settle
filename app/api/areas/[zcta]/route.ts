import { connection } from "next/server";
import { getAreaDetails } from "@/lib/areaDetails";

// GET /api/areas/94110: one area's metrics (with sources), risk flags, and regional context.
// RouteContext<"/api/areas/[zcta]"> is a Next.js helper type that knows `params` holds `zcta`.
export async function GET(_req: Request, ctx: RouteContext<"/api/areas/[zcta]">) {
  await connection(); // per-request; never prerendered (D007)
  const { zcta } = await ctx.params;

  if (!/^\d{5}$/.test(zcta)) {
    return Response.json({ error: "zcta must be 5 digits" }, { status: 400 });
  }
  try {
    const details = await getAreaDetails(zcta);
    if (!details) return Response.json({ error: `unknown area ${zcta}` }, { status: 404 });
    return Response.json(details);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return Response.json({ error: message }, { status: 503 });
  }
}
