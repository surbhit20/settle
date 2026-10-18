"use client";
// "use client" = this component runs in the browser. MapLibre needs the DOM and WebGL,
// so it cannot render on the server like the rest of the page.

import { useEffect, useRef, useState } from "react";
import type { Map as MapLibreMap, MapGeoJSONFeature } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import AreaCard from "@/components/AreaCard";
import { NO_DATA_COLOR, rentFillExpression, rentLegend } from "@/lib/rentScale";

// Free vector basemap, no API key (decisions.md D013).
const BASEMAP_STYLE = "https://tiles.openfreemap.org/styles/positron";
const BAY_AREA_CENTER: [number, number] = [-122.15, 37.6]; // [lng, lat]

const CENSUS_ZCTA_URL = "https://www.census.gov/programs-surveys/geography/guidance/geo-areas/zctas.html";
const ZILLOW_URL = "https://www.zillow.com/research/data/";

// Quick summary shown while hovering (the full card loads only on click).
type HoveredArea = { zcta: string; name: string | null; rent: number | null };

function toHovered(feature: MapGeoJSONFeature): HoveredArea {
  const p = feature.properties;
  return {
    zcta: String(p.zcta),
    name: p.name ?? null,
    // MapLibre turns JSON null into undefined or the string "null"; normalize to null.
    rent: typeof p.rent_usd === "number" ? p.rent_usd : null,
  };
}

export default function AreaMap() {
  // useRef holds values that survive re-renders without causing one:
  // the <div> MapLibre draws into, and the map object itself.
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);

  // useState values DO trigger a re-render when they change, so the panel updates.
  const [hovered, setHovered] = useState<HoveredArea | null>(null);
  const [selectedZcta, setSelectedZcta] = useState<string | null>(null);
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

        // promoteId makes each feature's `zcta` its id, so we can set hover/selected state by id.
        map.addSource("areas", { type: "geojson", data: areas, promoteId: "zcta" });
        map.addLayer({
          id: "areas-fill",
          type: "fill",
          source: "areas",
          paint: {
            // Color by rent band; grey where Zillow has no rent index (lib/rentScale.ts).
            // The cast is needed because our expression is built as a plain array.
            "fill-color": rentFillExpression() as unknown as string,
            // Expressions are MapLibre's mini-language: more opaque while hovered.
            "fill-opacity": ["case", ["boolean", ["feature-state", "hover"], false], 0.85, 0.6],
          },
        });
        map.addLayer({
          id: "areas-outline",
          type: "line",
          source: "areas",
          paint: {
            "line-color": ["case", ["boolean", ["feature-state", "selected"], false], "#18181b", "#ffffff"],
            "line-width": ["case", ["boolean", ["feature-state", "selected"], false], 2.5, 0.6],
          },
        });

        map.on("mousemove", "areas-fill", (e) => {
          const feature = e.features?.[0];
          if (!feature) return;
          if (hoveredId !== undefined) {
            map.setFeatureState({ source: "areas", id: hoveredId }, { hover: false });
          }
          hoveredId = feature.id;
          map.setFeatureState({ source: "areas", id: hoveredId }, { hover: true });
          map.getCanvas().style.cursor = "pointer";
          setHovered(toHovered(feature));
        });
        map.on("mouseleave", "areas-fill", () => {
          if (hoveredId !== undefined) {
            map.setFeatureState({ source: "areas", id: hoveredId }, { hover: false });
          }
          hoveredId = undefined;
          map.getCanvas().style.cursor = "";
          setHovered(null);
        });
        // Click (or tap) opens the full card for that area.
        map.on("click", "areas-fill", (e) => {
          const feature = e.features?.[0];
          if (feature) setSelectedZcta(String(feature.properties.zcta));
        });
      });
    }

    init();
    return () => {
      cancelled = true;
      mapRef.current?.remove();
      mapRef.current = null;
    };
  }, []);

  // Keep the map's "selected" outline in sync with React state. Runs whenever selectedZcta changes;
  // the cleanup un-highlights the previous area first.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !selectedZcta || !map.getSource("areas")) return;
    map.setFeatureState({ source: "areas", id: selectedZcta }, { selected: true });
    return () => {
      if (map.getSource("areas")) {
        map.setFeatureState({ source: "areas", id: selectedZcta }, { selected: false });
      }
    };
  }, [selectedZcta]);

  return (
    <div className="relative flex-1">
      {/* h-full, not absolute positioning: MapLibre's CSS forces position: relative on this div. */}
      <div ref={containerRef} className="h-full w-full" />

      <aside className="absolute left-4 top-4 max-h-[calc(100%-2rem)] w-80 max-w-[calc(100%-2rem)] overflow-y-auto rounded-lg bg-white/95 p-4 text-sm shadow-md dark:bg-zinc-900/95">
        {error ? (
          <p className="text-red-600">{error}</p>
        ) : selectedZcta ? (
          // key: a new ZIP means a new card (and a fresh fetch), not an update to the old one.
          <AreaCard key={selectedZcta} zcta={selectedZcta} onClose={() => setSelectedZcta(null)} />
        ) : hovered ? (
          <div>
            <h2 className="text-base font-semibold">
              {hovered.name ?? "Unnamed area"} <span className="font-normal text-zinc-500">{hovered.zcta}</span>
            </h2>
            <p>
              {hovered.rent === null ? "Rent: no data" : `Typical rent $${Math.round(hovered.rent).toLocaleString("en-US")}/mo`}
            </p>
            <p className="mt-1 text-xs text-zinc-500">Click for hidden risks and sources.</p>
          </div>
        ) : (
          <p className="text-zinc-600 dark:text-zinc-400">Hover an area for its rent; click for details.</p>
        )}
        <p className="mt-3 border-t border-zinc-200 pt-2 text-xs text-zinc-500 dark:border-zinc-700">
          Boundaries:{" "}
          <a className="underline" href={CENSUS_ZCTA_URL} target="_blank" rel="noreferrer">
            US Census 2020 ZCTAs
          </a>
        </p>
      </aside>

      <div className="absolute bottom-8 right-4 rounded-lg bg-white/95 p-3 text-xs shadow-md dark:bg-zinc-900/95">
        <div className="mb-1 font-semibold">Typical monthly rent</div>
        <ul>
          {rentLegend().map((row) => (
            <li key={row.label} className="flex items-center gap-2">
              <span className="inline-block h-3 w-4 rounded-sm" style={{ background: row.color }} />
              {row.label}
            </li>
          ))}
          <li className="flex items-center gap-2">
            <span className="inline-block h-3 w-4 rounded-sm" style={{ background: NO_DATA_COLOR }} />
            No data
          </li>
        </ul>
        <a className="mt-1 block text-zinc-500 underline" href={ZILLOW_URL} target="_blank" rel="noreferrer">
          Zillow Observed Rent Index
        </a>
      </div>
    </div>
  );
}
