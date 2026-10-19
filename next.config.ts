import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Dev only: let phones and other devices on a home network open the dev server by IP
  // (e.g. http://10.0.0.x:3000). Covers the usual private ranges; ignored in production.
  allowedDevOrigins: ["10.*.*.*", "192.168.*.*"],
  // Hide the Next.js dev tools "N" button in the corner during development.
  devIndicators: false,
  cacheComponents: true,
  partialPrefetching: true,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
