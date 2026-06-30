import type { NextConfig } from "next";
import path from "path";

const nextConfig: NextConfig = {
  // Pin the workspace root so Turbopack doesn't walk up into parent
  // directories that happen to contain other lockfiles.
  turbopack: {
    root: path.join(__dirname),
  },
};

export default nextConfig;
