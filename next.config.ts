import type { NextConfig } from "next";
import path from "path";

const nextConfig: NextConfig = {
  // Evita que Next tome el pnpm-lock.yaml del home como workspace root
  // (rompe el cache .next cuando hay varios lockfiles).
  outputFileTracingRoot: path.join(__dirname),
};

export default nextConfig;
