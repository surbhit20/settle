"use client";
// "use client" = this component runs in the browser. MapLibre needs the DOM and WebGL,
// so it cannot render on the server like the rest of the page.

import { useEffect, useRef, useState } from "react";
import type { Map as MapLibreMap, MapGeoJSONFeature, Marker } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { NO_DATA_COLOR, rentFillExpression, rentLegend } from "@/lib/rentScale";
import { FILTERED_COLOR, scoreFillExpression, scoreLegend } from "@/lib/scoreScale";
import { geojsonBounds } from "@/lib/geo";

// Free vector basemap, no API key (decisions.md D013).
const BASEMAP_STYLE = "https://tiles.openfreemap.org/styles/positron";
const BAY_AREA_CENTER: [number, number] = [-122.15, 37.6]; // [lng, lat]
const ZILLOW_URL = "https://www.zillow.com/research/data/";
const CENSUS_ZCTA_URL = "https://www.census.gov/programs-surveys/geography/guidance/geo-areas/zctas.html";

// typeof import("maplibre-gl") = "the type of the whole maplibre-gl module", so we can keep the
// dynamically imported module in a ref and create Markers later.
type MapLibreModule = typeof import("maplibre-gl");

type Hovered = { zcta: string; name: string | null; rent: number | null };

type Props = {
  // zcta -> personal score for ranked areas. null = no search yet (show rent instead).
  scores: Record<string, number> | null;
  selectedZcta: string | null;
  compared?: string[]; // areas outlined after a chat "compare"
  busy?: boolean; // scoring in progress: show a small "Updating scores" pill
  // `point` is where on the map the user clicked (pixels from the map's top-left), so the page
  // can show a small menu there.
  onSelect: (zcta: string, point?: { x: number; y: number; name: string | null }) => void;
  office: { lat: number; lng: number } | null;
};

export default function AreaMap({ scores, selectedZcta, compared = [], busy = false, onSelect, office }: Props) {
  // useRef holds values that survive re-renders without causing one.
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const libRef = useRef<MapLibreModule | null>(null);
  const zctasRef = useRef<string[]>([]); // every area id, for setting/clearing feature-state
  const markerRef = useRef<Marker | null>(null);
  // Map event handlers are attached once, but onSelect can change; reading it through a ref
  // means the handler always calls the latest one.
  const onSelectRef = useRef(onSelect);
  useEffect(() => {
    onSelectRef.current = onSelect;
  }, [onSelect]);

  // useState values DO trigger a re-render. `ready` flips once the areas layer exists, which
  // re-runs the effects below that depend on it.
  const [ready, setReady] = useState(false);
  const [hovered, setHovered] = useState<Hovered | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Phones start with the legend collapsed (it would cover most of a small map); desktop CSS
  // always shows it. Tapping the legend title toggles it.
  const [legendOpen, setLegendOpen] = useState(false);
  // True once MapLibre has finished processing the area shapes, so they can be drawn. Until then
  // the map can be blank for several seconds even though the layer exists (`ready`).
  const [painted, setPainted] = useState(false);

  // 1. Create the map once.
  useEffect(() => {
    let cancelled = false;
    let hoveredId: string | number | undefined;

    async function init() {
      const maplibregl = await import("maplibre-gl"); // browser-only import (it touches `window`)
      if (cancelled || !containerRef.current) return;
      libRef.current = maplibregl;
      maplibregl.setWorkerUrl("/maplibre/maplibre-gl-worker.mjs"); // D014

      const map = new maplibregl.Map({
        container: containerRef.current,
        style: BASEMAP_STYLE,
        center: BAY_AREA_CENTER,
        zoom: 8.6,
        // Attribution is added below, bottom-left, because the chat window owns the bottom-right corner.
        attributionControl: false,
      });
      mapRef.current = map;
      // Compact "ⓘ" attribution: the expanded text covered the legend on phones. Full credits
      // are also on the /sources page.
      map.addControl(new maplibregl.AttributionControl({ compact: true }), "bottom-left");
      // Zoom buttons top-left: the legend owns the top-right corner.
      map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-left");

      // "style.load", not "load": see D014.
      map.once("style.load", async () => {
        const res = await fetch("/api/areas");
        if (!res.ok) {
          setError(`Could not load areas (HTTP ${res.status}). Is the database running?`);
          return;
        }
        const areas = await res.json();
        if (cancelled) return;
        zctasRef.current = areas.features.map((f: { id: string }) => f.id);
        // Fit all 208 areas on screen, whatever the screen size (instead of a fixed zoom).
        const bounds = geojsonBounds(areas);
        if (bounds) map.fitBounds(bounds, { padding: 16, duration: 0 });

        map.addSource("areas", { type: "geojson", data: areas, promoteId: "zcta" });
        // Not the map's "idle" event: it waits for every basemap source, and one never finishes (D014).
        const onData = (e: { sourceId?: string; isSourceLoaded?: boolean }) => {
          if (e.sourceId === "areas" && e.isSourceLoaded) {
            setPainted(true);
            map.off("sourcedata", onData);
          }
        };
        map.on("sourcedata", onData);
        // Draw our areas under the basemap's first text layer, so place names stay on top
        // of the colors. `?.id` gives undefined if there's no text layer (then: on top).
        const firstLabelId = map.getStyle().layers.find((l) => l.type === "symbol")?.id;
        map.addLayer({
          id: "areas-fill",
          type: "fill",
          source: "areas",
          paint: {
            // Starts as the rent map; switched to the score map when scores arrive (effect 2).
            "fill-color": rentFillExpression() as unknown as string,
            "fill-opacity": ["case", ["boolean", ["feature-state", "hover"], false], 0.9, 0.65],
          },
        }, firstLabelId);
        map.addLayer({
          id: "areas-outline",
          type: "line",
          source: "areas",
          paint: {
            "line-color": [
              "case",
              ["boolean", ["feature-state", "selected"], false], "#18181b",
              ["boolean", ["feature-state", "compared"], false], "#2563eb",
              "#ffffff",
            ],
            "line-width": [
              "case",
              ["boolean", ["feature-state", "selected"], false], 2.5,
              ["boolean", ["feature-state", "compared"], false], 2.5,
              0.6,
            ],
          },
        }, firstLabelId);

        map.on("mousemove", "areas-fill", (e) => {
          const f: MapGeoJSONFeature | undefined = e.features?.[0];
          if (!f) return;
          if (hoveredId !== undefined) map.setFeatureState({ source: "areas", id: hoveredId }, { hover: false });
          hoveredId = f.id;
          map.setFeatureState({ source: "areas", id: hoveredId }, { hover: true });
          map.getCanvas().style.cursor = "pointer";
          setHovered({
            zcta: String(f.properties.zcta),
            name: f.properties.name ?? null,
            rent: typeof f.properties.rent_usd === "number" ? f.properties.rent_usd : null,
          });
        });
        map.on("mouseleave", "areas-fill", () => {
          if (hoveredId !== undefined) map.setFeatureState({ source: "areas", id: hoveredId }, { hover: false });
          hoveredId = undefined;
          map.getCanvas().style.cursor = "";
          setHovered(null);
        });
        map.on("click", "areas-fill", (e) => {
          const f = e.features?.[0];
          if (f) onSelectRef.current(String(f.properties.zcta), { x: e.point.x, y: e.point.y, name: f.properties.name ?? null });
        });
        setReady(true);
      });
    }

    init();
    return () => {
      cancelled = true;
      mapRef.current?.remove();
      mapRef.current = null;
      // A fresh map starts on the rent colors, so mark it not ready: when it is, effect 2
      // reruns and repaints the scores. (Matters when dev hot reload rebuilds the map.)
      setReady(false);
      setPainted(false);
    };
  }, []);

  // 2. Recolor when scores change: write each area's score into feature-state, then point the
  //    fill color at either the score scale or the rent scale.
  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map) return;
    for (const zcta of zctasRef.current) {
      const score = scores?.[zcta];
      if (typeof score === "number") map.setFeatureState({ source: "areas", id: zcta }, { score });
      else map.removeFeatureState({ source: "areas", id: zcta }, "score");
    }
    const fill = scores ? scoreFillExpression() : rentFillExpression();
    map.setPaintProperty("areas-fill", "fill-color", fill as unknown as string);
  }, [ready, scores]);

  // 3. Outline the selected area. The cleanup un-highlights the previous one first.
  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map || !selectedZcta) return;
    map.setFeatureState({ source: "areas", id: selectedZcta }, { selected: true });
    return () => {
      if (map.getSource("areas")) map.setFeatureState({ source: "areas", id: selectedZcta }, { selected: false });
    };
  }, [ready, selectedZcta]);

  // 3b. Outline compared areas in blue (cleared when the comparison changes).
  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map) return;
    for (const z of compared) map.setFeatureState({ source: "areas", id: z }, { compared: true });
    return () => {
      if (!map.getSource("areas")) return;
      for (const z of compared) map.setFeatureState({ source: "areas", id: z }, { compared: false });
    };
  }, [ready, compared]);

  // 4. Office marker.
  useEffect(() => {
    const map = mapRef.current;
    const lib = libRef.current;
    markerRef.current?.remove();
    markerRef.current = null;
    if (!ready || !map || !lib || !office) return;
    markerRef.current = new lib.Marker({ color: "#18181b" }).setLngLat([office.lng, office.lat]).addTo(map);
  }, [ready, office]);

  const hoveredScore = hovered && scores ? scores[hovered.zcta] : undefined;
  const legend = scores ? scoreLegend() : rentLegend();

  return (
    <div className="relative h-full w-full">
      {/* h-full, not absolute positioning: MapLibre's CSS forces position: relative on this div. */}
      <div ref={containerRef} className="h-full w-full" />

      {!painted && !error && (
        <div className="absolute inset-0 flex items-center justify-center">
          <span className="rounded-full bg-surface/95 px-4 py-2 text-sm text-muted shadow-lg backdrop-blur">
            Loading map…
          </span>
        </div>
      )}
      {busy && ready && (
        <div className="pointer-events-none absolute left-1/2 top-4 -translate-x-1/2 rounded-full bg-ink/90 px-4 py-1.5 text-xs font-medium text-paper shadow-lg backdrop-blur">
          Updating scores…
        </div>
      )}

      {(hovered || error) && (
        <div className="pointer-events-none absolute bottom-10 left-4 rounded-2xl border border-line bg-surface/95 px-4 py-3 text-sm shadow-lg backdrop-blur">
          {error ? (
            <span className="text-red-600">{error}</span>
          ) : hovered ? (
            <>
              <span className="font-serif text-lg">{hovered.name ?? "Unnamed"}</span> <span className="text-muted">{hovered.zcta}</span>
              <div className="text-muted">
                {scores
                  ? hoveredScore === undefined
                    ? "Filtered out"
                    : `Your score ${hoveredScore.toFixed(0)}`
                  : hovered.rent === null
                    ? "Rent: no data"
                    : `Typical rent $${Math.round(hovered.rent).toLocaleString("en-US")}/mo`}
              </div>
            </>
          ) : null}
        </div>
      )}

      {/* Legend: top-right. Bottom-left has the hover card and credits; bottom-right is the chat's. */}
      <div className="absolute right-4 top-4 max-w-[calc(100%-5rem)] rounded-xl border border-line bg-surface/95 px-2.5 py-2 text-[0.7rem] shadow-lg backdrop-blur md:px-3 md:py-2.5">
        <button
          type="button"
          onClick={() => setLegendOpen((o) => !o)}
          className="text-[0.65rem] font-semibold uppercase tracking-[0.12em] text-muted md:pointer-events-none"
          aria-expanded={legendOpen}
        >
          {scores ? "Your score" : "Typical monthly rent"}
          <span className="ml-1 md:hidden">{legendOpen ? "▾" : "▸"}</span>
        </button>
        {/* On phones the list shows only when opened; from md (768 px) up it always shows. */}
        <div className={legendOpen ? "mt-1.5 block" : "hidden md:mt-1.5 md:block"}>
        <ul className="space-y-0.5">
          {legend.map((row) => (
            <li key={row.label} className="flex items-center gap-2">
              <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: row.color }} />
              {row.label}
            </li>
          ))}
          <li className="flex items-center gap-2">
            <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: scores ? FILTERED_COLOR : NO_DATA_COLOR }} />
            {scores ? "Filtered out" : "No data"}
          </li>
        </ul>
        <div className="mt-1.5 text-[0.65rem] text-muted">
          {scores ? (
            "Click an area to see why"
          ) : (
            <a className="underline" href={ZILLOW_URL} target="_blank" rel="noreferrer">
              Zillow Observed Rent Index
            </a>
          )}
          {" · "}
          <a className="underline" href={CENSUS_ZCTA_URL} target="_blank" rel="noreferrer">
            Census ZCTAs
          </a>
        </div>
        </div>
      </div>
    </div>
  );
}
