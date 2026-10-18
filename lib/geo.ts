// Bounding box of a GeoJSON FeatureCollection, used to fit the map to all areas on any screen size.
// Returns [[west, south], [east, north]] (MapLibre's LngLatBounds shape), or null if empty.

type Position = number[];

function walk(coords: unknown, visit: (p: Position) => void): void {
  if (!Array.isArray(coords)) return;
  if (typeof coords[0] === "number") {
    visit(coords as Position);
    return;
  }
  for (const c of coords) walk(c, visit);
}

export function geojsonBounds(fc: {
  features: { geometry: { coordinates?: unknown } | null }[];
}): [[number, number], [number, number]] | null {
  let w = Infinity, s = Infinity, e = -Infinity, n = -Infinity;
  for (const f of fc.features) {
    walk(f.geometry?.coordinates, ([lng, lat]) => {
      if (lng < w) w = lng;
      if (lng > e) e = lng;
      if (lat < s) s = lat;
      if (lat > n) n = lat;
    });
  }
  return Number.isFinite(w) ? [[w, s], [e, n]] : null;
}
