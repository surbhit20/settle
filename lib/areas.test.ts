import { describe, expect, it } from "vitest";
import { toFeatureCollection } from "@/lib/areas";

describe("toFeatureCollection", () => {
  it("turns rows into GeoJSON features keyed by ZCTA", () => {
    const fc = toFeatureCollection([
      {
        zcta: "94110",
        name: "San Francisco",
        county: "San Francisco",
        population: 70000,
        rent_usd: 4931,
        geometry: '{"type":"MultiPolygon","coordinates":[[[[0,0],[1,0],[1,1],[0,0]]]]}',
      },
    ]);
    expect(fc.type).toBe("FeatureCollection");
    expect(fc.features).toHaveLength(1);
    expect(fc.features[0].id).toBe("94110");
    expect(fc.features[0].properties).toEqual({
      zcta: "94110",
      name: "San Francisco",
      county: "San Francisco",
      population: 70000,
      rent_usd: 4931,
    });
    expect(fc.features[0].geometry).toEqual({
      type: "MultiPolygon",
      coordinates: [[[[0, 0], [1, 0], [1, 1], [0, 0]]]],
    });
  });

  it("keeps unknown population and rent as null, not zero", () => {
    const fc = toFeatureCollection([
      { zcta: "94128", name: null, county: "San Mateo", population: null, rent_usd: null, geometry: '{"type":"Point","coordinates":[0,0]}' },
    ]);
    expect(fc.features[0].properties.population).toBeNull();
    expect(fc.features[0].properties.rent_usd).toBeNull();
  });

  it("handles an empty table", () => {
    expect(toFeatureCollection([])).toEqual({ type: "FeatureCollection", features: [] });
  });
});
