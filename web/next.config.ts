import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  turbopack: {
    // The repo root has its own package-lock.json for the Anchor integration
    // tests, so Turbopack finds two lockfiles and guesses wrong about which
    // directory is the project root. Pin it to web/.
    root: path.resolve(__dirname),
  },
};

export default nextConfig;
