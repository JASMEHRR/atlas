import type { NextConfig } from "next";

const config: NextConfig = {
  // node:sqlite and sharp must stay outside the bundler.
  serverExternalPackages: ["sharp", "playwright"],
  typescript: { ignoreBuildErrors: false },
  eslint: { ignoreDuringBuilds: true },
};

export default config;
