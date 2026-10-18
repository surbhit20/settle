// Copies MapLibre's web worker into public/ so the browser can load it from /maplibre/.
// MapLibre 6 looks for its worker next to its own bundle, which Turbopack does not serve,
// so components/AreaMap.tsx points it here with setWorkerUrl() (decisions.md D014).
// Runs automatically after `npm install` (the "postinstall" script in package.json).
import { copyFileSync, mkdirSync } from "node:fs";

mkdirSync("public/maplibre", { recursive: true });
copyFileSync(
  "node_modules/maplibre-gl/dist/maplibre-gl-worker.mjs",
  "public/maplibre/maplibre-gl-worker.mjs",
);
console.log("copied maplibre-gl-worker.mjs to public/maplibre/");
