"use client";
// "use client" = this component runs in the browser. MapLibre needs the DOM and WebGL,
// so it cannot render on the server like the rest of the page.

import { useEffect, useRef, useState } from "react";
import type { Map as MapLibreMap, MapGeoJSONFeature } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";

// Free vector basemap, no API key (decisions.md D013).
const BASEMAP_STYLE = "https://tiles.openfreemap.org/styles/positron";
const BAY_AREA_CENTER: [number, number] = [-122.15, 37.6]; // [lng, lat]

const CENSUS_ZCTA_URL = "https://www.census.gov/programs-surveys/geography/guidance/geo-areas/zctas.html";
const ACS_URL = "https://www.census.gov/programs-surveys/acs";

// What the side panel shows for the area under the mouse / last clicked.
type SelectedArea = {
  zcta: string;
  name: string | null;
  county: string;
  population: number | null;
};

export default function AreaMap() {
  // useRef holds values that survive re-renders without causing one:
  // the <div> MapLibre draws into, and the map object itself.
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);

  // useState values DO trigger a re-render when they change, so the panel updates.
  const [selected, setSelected] = useState<SelectedArea | null>(null);
  const [error, setError] = useState<string | null>(null);

  // useEffect with [] runs once after the component first appears in the browser.
  // The function it returns runs when the component goes away (cleanup).
  useEffect(() => {
    let cancelled = false;
    let hoveredId: string | number | undefined;

    async function init() {
      // Import MapLibre only in the browser (it touches `window`).
      const maplibregl = await import("maplibre-gl");
      if (cancelled || !containerRef.current) return;
      // Worker file is copied into public/ by scripts/copy-maplibre-worker.mjs (D014).
      maplibregl.setWorkerUrl("/maplibre/maplibre-gl-worker.mjs");

      const map = new maplibregl.Map({
        container: containerRef.current,
        style: BASEMAP_STYLE,
        center: BAY_AREA_CENTER,
        zoom: 8.6,
      });
      mapRef.current = map;
      map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");

      // "style.load" fires once the basemap style is parsed. We avoid "load", which also waits for
      // every basemap source; OpenFreeMap's low-zoom raster never finishes at our zoom (D014).
      map.once("style.load", async () => {
        const res = await fetch("/api/areas");
        if (!res.ok) {
          setError(`Could not load areas (HTTP ${res.status}). Is the database running?`);
          return;
        }
        const areas = await res.json();
        if (cancelled) return;

        // promoteId makes each feature's `zcta` its id, so we can set hover state by id.
        map.addSource("areas", { type: "geojson", data: areas, promoteId: "zcta" });
        map.addLayer({
          id: "areas-fill",
          type: "fill",
          source: "areas",
          paint: {
            "fill-color": "#4f7cac",
            // Expressions are MapLibre's mini-language: brighter fill while hovered.
            "fill-opacity": ["case", ["boolean", ["feature-state", "hover"], false], 0.45, 0.15],
          },
        });
        map.addLayer({
          id: "areas-outline",
          type: "line",
          source: "areas",
          paint: { "line-color": "#2d4f73", "line-width": 0.8 },
        });

        const showFeature = (feature: MapGeoJSONFeature | undefined) => {
          if (!feature) return;
          const p = feature.properties;
          setSelected({
            zcta: String(p.zcta),
            name: p.name ?? null,
            county: String(p.county),
            // MapLibre turns JSON null into undefined or the string "null"; normalize to null.
            population: typeof p.population === "number" ? p.population : null,
          });
        };

        map.on("mousemove", "areas-fill", (e) => {
          const feature = e.features?.[0];
          if (!feature) return;
          if (hoveredId !== undefined) {
            map.setFeatureState({ source: "areas", id: hoveredId }, { hover: false });
          }
          hoveredId = feature.id;
          map.setFeatureState({ source: "areas", id: hoveredId }, { hover: true });
          map.getCanvas().style.cursor = "pointer";
          showFeature(feature);
        });
        map.on("mouseleave", "areas-fill", () => {
          if (hoveredId !== undefined) {
            map.setFeatureState({ source: "areas", id: hoveredId }, { hover: false });
          }
          hoveredId = undefined;
          map.getCanvas().style.cursor = "";
        });
        // Tap support for touch screens, where there is no hover.
        map.on("click", "areas-fill", (e) => showFeature(e.features?.[0]));
      });
    }

    init();
    return () => {
      cancelled = true;
      mapRef.current?.remove();
      mapRef.current = null;
    };
  }, []);

  return (
    <div className="relative flex-1">
      {/* h-full, not absolute positioning: MapLibre's CSS forces position: relative on this div. */}
      <div ref={containerRef} className="h-full w-full" />

      <aside className="absolute left-4 top-4 w-72 max-w-[calc(100%-2rem)] rounded-lg bg-white/95 p-4 text-sm shadow-md dark:bg-zinc-900/95">
        {error ? (
          <p className="text-red-600">{error}</p>
        ) : selected ? (
          <>
            <h2 className="text-base font-semibold">
              {selected.name ?? "Unnamed area"}{" "}
              <span className="font-normal text-zinc-500">{selected.zcta}</span>
            </h2>
            <p className="text-zinc-600 dark:text-zinc-400">{selected.county} County</p>
            <dl className="mt-3">
              <dt className="text-zinc-500">Population</dt>
              <dd>
                {selected.population === null ? "No data" : selected.population.toLocaleString()}{" "}
                <a className="text-xs text-zinc-500 underline" href={ACS_URL} target="_blank" rel="noreferrer">
                  ACS 5-year
                </a>
              </dd>
            </dl>
          </>
        ) : (
          <p className="text-zinc-600 dark:text-zinc-400">Hover or tap an area to see details.</p>
        )}
        <p className="mt-3 border-t border-zinc-200 pt-2 text-xs text-zinc-500 dark:border-zinc-700">
          Boundaries:{" "}
          <a className="underline" href={CENSUS_ZCTA_URL} target="_blank" rel="noreferrer">
            US Census 2020 ZCTAs
          </a>
        </p>
      </aside>
    </div>
  );
}
