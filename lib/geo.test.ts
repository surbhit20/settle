import { describe, expect, it } from "vitest";
import { geojsonBounds } from "@/lib/geo";

describe("geojsonBounds", () => {
  it("covers polygons and multipolygons", () => {
    const fc = {
      features: [
        { geometry: { type: "Polygon", coordinates: [[[-122.5, 37.7], [-122.4, 37.8], [-122.5, 37.7]]] } },
        { geometry: { type: "MultiPolygon", coordinates: [[[[-121.8, 37.2], [-121.9, 37.3], [-121.8, 37.2]]]] } },
      ],
    };
    expect(geojsonBounds(fc)).toEqual([[-122.5, 37.2], [-121.8, 37.8]]);
  });

  it("returns null when there is nothing to fit", () => {
    expect(geojsonBounds({ features: [] })).toBeNull();
    expect(geojsonBounds({ features: [{ geometry: null }] })).toBeNull();
  });
});
