"""Step 3: fetch Mireye hidden-risk fields at each area's population-weighted centroid.

PAID API. Safety rails:
- Prints Mireye's own quote (POST /v1/fetch/quote, unmetered) and the current balance first,
  and refuses to run if the fetch would exceed the allowance.
- Every batch response is written to data/raw/mireye/batches/ before anything else; batches
  already on disk are skipped, so re-running never re-spends credits.
- Each request carries a deterministic Idempotency-Key (hash of its body), so retrying a batch
  whose response was lost is free for 24h.
- Needs --confirm to spend. Without it, it only prints the plan and quote.
- --limit N fetches at most N new batches (used to inspect the first response).

Run: uv run --project pipeline python -m settle_pipeline.fetch_mireye [--confirm] [--limit N]
"""

import argparse
import hashlib
import json
import time

import httpx

from settle_pipeline.config import RAW_DIR, require_env
from settle_pipeline.db import connect

BASE_URL = "https://api.mireye.com"
BATCH_SIZE = 25          # API maximum for /v1/fetch/batch
SECONDS_BETWEEN = 3.5    # free plan: 20 requests/minute
BATCH_DIR = RAW_DIR / "mireye" / "batches"

# Field list approved by the owner on 2026.10.18 (decisions.md D016). Never add parcel_* fields.
FIELDS = [
    "within_floodplain_polygon",
    "wildfire_annual_frequency",
    "seismic_design_category",
    "seismic_pga_2pct_50yr_g",
    "landslide_susceptibility_index",
    "nearest_dam_distance_m",
    "nearest_dam_hazard_potential",
    "high_hazard_dams_within_10km",
    "nearest_hazardous_facility_distance_m",
    "nearest_hazardous_facility_name",
    "fiber_provider_count",
    "days_above_32c_annual_count",
    "nearest_airport_distance_m",
    "nearest_major_road_distance_m",
]


def load_centroids() -> list[tuple[str, float, float]]:
    """(zcta, lat, lng) for every area, sorted by zcta so batches are stable across runs."""
    with connect() as conn:
        rows = conn.execute(
            "SELECT zcta, ST_Y(centroid), ST_X(centroid) FROM areas ORDER BY zcta"
        ).fetchall()
    return [(z, round(lat, 6), round(lng, 6)) for z, lat, lng in rows]


def make_batches(points: list[tuple[str, float, float]]) -> list[list[tuple[str, float, float]]]:
    return [points[i : i + BATCH_SIZE] for i in range(0, len(points), BATCH_SIZE)]


def request_body(batch: list[tuple[str, float, float]]) -> dict:
    return {"fields": FIELDS, "locations": [{"lat": lat, "lng": lng} for _, lat, lng in batch]}


def idempotency_key(body: dict) -> str:
    digest = hashlib.sha256(json.dumps(body, sort_keys=True).encode()).hexdigest()
    return f"settle-{digest[:40]}"


def batch_path(batch: list[tuple[str, float, float]]):
    return BATCH_DIR / f"batch_{batch[0][0]}_{batch[-1][0]}.json"


def quote(client: httpx.Client, batches) -> int:
    total = 0
    allowance = None
    for size in sorted({len(b) for b in batches}):
        q = client.post("/v1/fetch/quote", json={"fields": FIELDS, "locations": size})
        q.raise_for_status()
        q = q.json()
        assert q["breakdown"]["metered_groups"] == {}, "quote includes a metered group (parcel?)"
        n = sum(1 for b in batches if len(b) == size)
        total += n * q["credits_total"]
        allowance = q["allowance"]
    print(f"  quote: {total} credits; remaining {allowance['credits_remaining']} "
          f"of {allowance['credits_included']} (resets {allowance['resets_at']})")
    return total if total <= allowance["credits_remaining"] else -1


RETRY_DIR = RAW_DIR / "mireye" / "retries"


def failed_values() -> dict[str, list[str]]:
    """{zcta: [field, ...]} for every value whose latest cached status is 'failed'.

    Mireye does not bill failed values, so retrying them stays inside the original quote.
    """
    from settle_pipeline.mireye import merge_rows, parse_batch_record  # local: avoids a cycle

    rows = []
    for p in sorted(BATCH_DIR.glob("*.json")):
        rows += parse_batch_record(json.loads(p.read_text()), FIELDS)
    retry_rows = []
    for p in sorted(RETRY_DIR.glob("*.json")):
        rec = json.loads(p.read_text())
        retry_rows += parse_batch_record(rec, rec["request"]["fields"])
    out: dict[str, list[str]] = {}
    for r in merge_rows(rows, retry_rows):
        if r["status"] == "failed":
            out.setdefault(r["zcta"], []).append(r["metric_name"])
    return out


def retry_failed(client: httpx.Client, confirm: bool) -> None:
    """Re-request only failed values, grouped by identical field lists (batch field sets are shared)."""
    RETRY_DIR.mkdir(parents=True, exist_ok=True)
    failed = failed_values()
    coords = {z: (lat, lng) for z, lat, lng in load_centroids()}
    groups: dict[tuple[str, ...], list[str]] = {}
    for zcta, fields in failed.items():
        groups.setdefault(tuple(sorted(fields)), []).append(zcta)
    total = sum(len(f) * len(z) for f, z in groups.items())
    print(f"  {sum(len(v) for v in failed.values())} failed values in {len(failed)} areas "
          f"(~{total} credits if all succeed)")
    if not confirm or not groups:
        print("dry run: pass --confirm to retry" if groups else "nothing to retry")
        return
    n = len(list(RETRY_DIR.glob("*.json")))
    first = True
    for fields, zctas in groups.items():
        for i in range(0, len(zctas), BATCH_SIZE):
            chunk = zctas[i : i + BATCH_SIZE]
            if not first:
                time.sleep(SECONDS_BETWEEN)
            first = False
            body = {"fields": list(fields),
                    "locations": [{"lat": coords[z][0], "lng": coords[z][1]} for z in chunk]}
            resp = client.post("/v1/fetch/batch", json=body,
                               headers={"Idempotency-Key": idempotency_key(body)})
            resp.raise_for_status()
            n += 1
            path = RETRY_DIR / f"retry_{n:03d}.json"
            path.write_text(json.dumps({
                "zctas": chunk, "request": body,
                "fetched_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
                "response": resp.json(),
            }))
            print(f"  saved {path.name} ({len(chunk)} areas x {len(fields)} fields)", flush=True)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--confirm", action="store_true", help="actually spend credits")
    parser.add_argument("--limit", type=int, default=None, help="max new batches to fetch")
    parser.add_argument("--retry-failed", action="store_true", help="re-request only failed values")
    args = parser.parse_args()

    if args.retry_failed:
        headers = {"Authorization": f"Bearer {require_env('MIREYE_API_TOKEN')}"}
        with httpx.Client(base_url=BASE_URL, headers=headers, timeout=300) as client:
            retry_failed(client, args.confirm)
            usage = client.get("/v1/users/me/usage").json()["credits"]
            print(f"  credits used this month: {usage['used']}, remaining: {usage['remaining']}")
        return

    BATCH_DIR.mkdir(parents=True, exist_ok=True)
    batches = make_batches(load_centroids())
    todo = [b for b in batches if not batch_path(b).exists()]
    print(f"  {sum(map(len, batches))} areas in {len(batches)} batches; {len(todo)} not yet cached")
    if not todo:
        print("done (all cached)")
        return

    headers = {"Authorization": f"Bearer {require_env('MIREYE_API_TOKEN')}"}
    with httpx.Client(base_url=BASE_URL, headers=headers, timeout=180) as client:
        if quote(client, todo) < 0:
            raise SystemExit("ABORT: fetch would exceed the remaining allowance")
        if not args.confirm:
            print("dry run: pass --confirm to fetch")
            return
        if args.limit is not None:
            todo = todo[: args.limit]
        for i, batch in enumerate(todo):
            if i:
                time.sleep(SECONDS_BETWEEN)
            body = request_body(batch)
            resp = client.post(
                "/v1/fetch/batch", json=body, headers={"Idempotency-Key": idempotency_key(body)}
            )
            resp.raise_for_status()
            # Save the raw response with the zcta order it was requested in (results are index-aligned).
            record = {
                "zctas": [z for z, _, _ in batch],
                "request": body,
                "fetched_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
                "response": resp.json(),
            }
            batch_path(batch).write_text(json.dumps(record))
            print(f"  saved {batch_path(batch).name}", flush=True)
        usage = client.get("/v1/users/me/usage").json()["credits"]
        print(f"  credits used this month: {usage['used']}, remaining: {usage['remaining']}")
    print("done")


if __name__ == "__main__":
    main()
