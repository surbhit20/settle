"""Smoke check: confirm the pipeline can reach Postgres and the schema exists.

Run: uv run --project pipeline python -m settle_pipeline.check_db
"""

from settle_pipeline.db import connect

EXPECTED_TABLES = ["areas", "area_metrics", "crime_aggregates", "commute_cache", "agent_logs"]


def main() -> None:
    with connect() as conn:
        postgis = conn.execute("SELECT PostGIS_Version()").fetchone()[0]
        print(f"PostGIS {postgis}")
        rows = conn.execute(
            "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'"
        ).fetchall()
        present = {r[0] for r in rows}
        for table in EXPECTED_TABLES:
            print(f"  {'ok     ' if table in present else 'MISSING'} {table}")


if __name__ == "__main__":
    main()
