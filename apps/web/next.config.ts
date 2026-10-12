import { loadEnvConfig } from "@next/env";
import type { NextConfig } from "next";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// npm workspace scripts execute from apps/web, while deployment and local
// development keep the shared server configuration in the repository root.
loadEnvConfig(resolve(dirname(fileURLToPath(import.meta.url)), "../.."), true, console, true);

const nextConfig: NextConfig = {
  output: "standalone",
  // The corner badge sat over the room and the map in every screenshot.
  devIndicators: false,
  turbopack: { root: "C:/Users/andrei", resolveAlias: {
    "@chronica/db": "../../packages/db/src/index.ts",
    "@chronica/shared": "../../packages/shared/src/index.ts",
    "@chronica/sim": "../../packages/sim/src/index.ts",
    "@chronica/billing": "../../packages/billing/src/index.ts",
  } },
  transpilePackages: ["@chronica/billing", "@chronica/db", "@chronica/shared", "@chronica/sim"],
};

export default nextConfig;
