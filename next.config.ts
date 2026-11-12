import { hostname } from "node:os";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  // `next dev` only serves its scripts to localhost unless told otherwise. Without this the page
  // loads over the LAN or Tailscale but never becomes interactive.
  allowedDevOrigins: [hostname(), "*.local", "*.fritz.box", "**.ts.net", "192.168.*.*", "10.*.*.*", "100.*.*.*"],
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
