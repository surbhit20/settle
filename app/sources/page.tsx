import Link from "next/link";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Data sources · Settle",
  description: "Every dataset and service Settle uses, with links and licenses.",
};

// One row per source. `use` says what the app does with it; `license` is what the provider states.
type Source = { name: string; url: string; use: string; license: string };

const GROUPS: { title: string; sources: Source[] }[] = [
  {
    title: "Areas and population",
    sources: [
      { name: "US Census Bureau: 2020 ZCTA cartographic boundaries", url: "https://www.census.gov/geographies/mapping-files/time-series/geo/cartographic-boundary.html", use: "ZIP code area shapes (208 areas in 5 counties)", license: "Public domain (US government work)" },
      { name: "US Census Bureau: 2020 ZCTA-to-county relationship file", url: "https://www.census.gov/geographies/reference-files/time-series/geo/relationship-files.html", use: "Which county each area belongs to", license: "Public domain" },
      { name: "US Census Bureau: 2020 centers of population (block groups)", url: "https://www.census.gov/geographies/reference-files/time-series/geo/centers-population.html", use: "Population-weighted center of each area; residents inside city limits", license: "Public domain" },
      { name: "US Census Bureau: 2020 places", url: "https://www.census.gov/geographies/mapping-files/time-series/geo/cartographic-boundary.html", use: "Area names and city limits", license: "Public domain" },
      { name: "US Census Bureau: American Community Survey 5-year (2020-2024), table B01003", url: "https://www.census.gov/programs-surveys/acs", use: "Population per area", license: "Public domain" },
    ],
  },
  {
    title: "Housing",
    sources: [
      { name: "Zillow Research: Zillow Observed Rent Index (ZORI)", url: "https://www.zillow.com/research/data/", use: "Typical rent and 3-year change (affordability score, rent map)", license: "Zillow Research public data; attribution to Zillow" },
      { name: "Zillow Research: Zillow Home Value Index (ZHVI)", url: "https://www.zillow.com/research/data/", use: "Typical home value (shown on area cards)", license: "Zillow Research public data; attribution to Zillow" },
    ],
  },
  {
    title: "Hidden risks and area details (via the Mireye API)",
    sources: [
      { name: "Mireye", url: "https://api.mireye.com", use: "Delivers the fields below at each area's population-weighted center; office geocoding", license: "Commercial API (free tier); each value keeps its upstream source" },
      { name: "FEMA National Flood Hazard Layer", url: "https://www.fema.gov/flood-maps/national-flood-hazard-layer", use: "Flood zone flag", license: "Public domain" },
      { name: "FEMA National Risk Index", url: "https://hazards.fema.gov/nri/", use: "Wildfire frequency flag", license: "Public domain" },
      { name: "USGS National Seismic Hazard Model (2023) and Design Maps (ASCE 7-22)", url: "https://www.usgs.gov/programs/earthquake-hazards", use: "Earthquake flag (peak ground acceleration) and design category", license: "Public domain" },
      { name: "USGS landslide susceptibility", url: "https://www.sciencebase.gov/catalog/item/65ccea5bd34ef4b119cb3bac", use: "Landslide index on cards", license: "Public domain" },
      { name: "USACE National Inventory of Dams", url: "https://nid.sec.usace.army.mil/", use: "High hazard dam flag", license: "Public domain" },
      { name: "EPA Facility Registry Service: Risk Management Plan facilities", url: "https://www.epa.gov/frs", use: "Hazardous facility flag", license: "Public domain" },
      { name: "FCC Broadband Data Collection", url: "https://broadbandmap.fcc.gov/", use: "Fiber providers on cards", license: "Public domain" },
      { name: "NOAA NCEI nClimGrid-Daily", url: "https://www.ncei.noaa.gov/products/land-based-station/nclimgrid-daily", use: "Days above 32°C on cards", license: "Public domain" },
      { name: "FAA NASR", url: "https://www.faa.gov/air_traffic/flight_info/aeronav/aero_data/NASR_Subscription/", use: "Nearest airport on cards", license: "Public domain" },
      { name: "Overture Maps (transportation)", url: "https://overturemaps.org/", use: "Nearest major road on cards", license: "ODbL / CDLA Permissive 2.0" },
    ],
  },
  {
    title: "Safety",
    sources: [
      { name: "San Francisco Police Department incident reports (DataSF)", url: "https://data.sf.gov/d/wg3w-h783", use: "Neighborhood crime rate (26 SF areas), Jul 2025 to Jun 2026", license: "PDDL 1.0 (public domain)" },
      { name: "Oakland Police Department CrimeWatch (City of Oakland)", url: "https://data.oaklandca.gov/d/ppgh-7dqv", use: "Neighborhood crime rate (14 Oakland areas)", license: "Published under the City of Oakland open data policy; no license stated" },
      { name: "San Jose Police Department calls for service (data.sanjoseca.gov)", url: "https://data.sanjoseca.gov/dataset/police-calls-for-service-quarterly", use: "Neighborhood crime rate (29 San Jose areas), calls with a report or arrest only", license: "CC0 (public domain)" },
      { name: "US Census Geocoder", url: "https://geocoding.geo.census.gov/", use: "Placing San Jose block addresses on the map", license: "Public domain" },
      { name: "FBI Crime Data Explorer (UCR)", url: "https://cde.ucr.cjis.gov/", use: "City-wide crime rates on area cards, for context only (not scored)", license: "Public domain" },
    ],
  },
  {
    title: "Commute and maps",
    sources: [
      { name: "openrouteservice by HeiGIT", url: "https://openrouteservice.org/", use: "Drive time from each area to your office (no traffic)", license: "© openrouteservice.org by HeiGIT; routing data © OpenStreetMap contributors (ODbL)" },
      { name: "OpenFreeMap and OpenMapTiles", url: "https://openfreemap.org/", use: "Basemap tiles", license: "Map data © OpenStreetMap contributors (ODbL)" },
      { name: "MapLibre GL JS", url: "https://maplibre.org/", use: "Map rendering", license: "BSD-3-Clause" },
    ],
  },
  {
    title: "AI",
    sources: [
      { name: "Jev by TypeSafe AI", url: "https://typesafe.ai/", use: "Classifies crime descriptions and routes chat messages", license: "Commercial API" },
      { name: "Claude by Anthropic", url: "https://www.anthropic.com/claude", use: "Explains rankings in chat using only the app's numbers; second check on uncertain crime labels", license: "Commercial API" },
    ],
  },
];

const CAVEATS = [
  "Scores rank areas against each other for your inputs; they are not advice.",
  "Commute times are drive times without traffic. Rush hour is often much longer.",
  "Neighborhood crime data exists only for San Francisco, Oakland and San Jose (69 areas). Other areas are scored without safety and marked \"partial data\".",
  "San Jose publishes police calls, not incident reports; its counts are adjusted for addresses that couldn't be mapped.",
  "Risk values are measured at each area's population-weighted center, not at every address.",
  "Areas without Zillow rent data are listed after every area whose rent is known.",
];

export default function SourcesPage() {
  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-8">
      <Link href="/" className="text-sm text-zinc-600 underline dark:text-zinc-400">
        ← Back to the map
      </Link>
      <h1 className="mt-4 text-2xl font-semibold tracking-tight">Data sources</h1>
      <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
        Every number in Settle links to its source on the area card. This page lists them all in one place.
      </p>

      {GROUPS.map((g) => (
        <section key={g.title} className="mt-8">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-500">{g.title}</h2>
          <ul className="mt-2 divide-y divide-zinc-200 dark:divide-zinc-800">
            {g.sources.map((s) => (
              <li key={s.name} className="py-2 text-sm">
                <a href={s.url} target="_blank" rel="noreferrer" className="font-medium underline">
                  {s.name}
                </a>
                <div className="text-zinc-600 dark:text-zinc-400">{s.use}</div>
                <div className="text-xs text-zinc-500">{s.license}</div>
              </li>
            ))}
          </ul>
        </section>
      ))}

      <section className="mt-8">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-500">Caveats</h2>
        <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-zinc-600 dark:text-zinc-400">
          {CAVEATS.map((c) => (
            <li key={c}>{c}</li>
          ))}
        </ul>
      </section>
    </main>
  );
}
