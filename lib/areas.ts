import { getPool } from "@/lib/db";

// Shape of one row returned by AREAS_SQL. `geometry` is a GeoJSON string built by PostGIS.
export type AreaRow = {
  zcta: string;
  name: string | null;
  county: string;
  population: number | null;
  geometry: string;
};

// The properties every map feature carries. `null` population means "unknown", never zero.
export type AreaProperties = {
  zcta: string;
  name: string | null;
  county: string;
  population: number | null;
};

// Minimal GeoJSON types (enough for MapLibre). Defined here to avoid an extra dependency.
export type Feature = {
  type: "Feature";
  id: string;
  properties: AreaProperties;
  geometry: unknown;
};
export type FeatureCollection = { type: "FeatureCollection"; features: Feature[] };

// Simplify tolerance in degrees (~30 m). Source shapes are already 1:500k generalized; this
// trims the response from ~520 KB to ~375 KB without visible change (decisions.md D012).
export const SIMPLIFY_TOLERANCE_DEG = 0.0003;

const AREAS_SQL = `
  SELECT zcta, name, county, population,
         ST_AsGeoJSON(ST_SimplifyPreserveTopology(geometry, $1), 5) AS geometry
  FROM areas
  ORDER BY zcta
`;

// Pure function (no database), so it is easy to unit test.
export function toFeatureCollection(rows: AreaRow[]): FeatureCollection {
  return {
    type: "FeatureCollection",
    features: rows.map((row) => ({
      type: "Feature",
      id: row.zcta,
      properties: {
        zcta: row.zcta,
        name: row.name,
        county: row.county,
        population: row.population,
      },
      geometry: JSON.parse(row.geometry),
    })),
  };
}

export async function getAreasGeoJSON(): Promise<FeatureCollection> {
  // query<AreaRow> tells TypeScript what each row looks like; pg does not check it at runtime.
  const { rows } = await getPool().query<AreaRow>(AREAS_SQL, [SIMPLIFY_TOLERANCE_DEG]);
  return toFeatureCollection(rows);
}
