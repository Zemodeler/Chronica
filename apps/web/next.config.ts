import { loadEnvConfig } from "@next/env";
import type { NextConfig } from "next";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// npm workspace scripts execute from apps/web, while deployment and local
// development keep the shared server configuration in the repository root.
loadEnvConfig(resolve(dirname(fileURLToPath(import.meta.url)), "../.."), true, console, true);

const nextConfig: NextConfig = {
  output: "standalone",
  transpilePackages: ["@chronica/billing", "@chronica/db", "@chronica/shared", "@chronica/sim"],
};

export default nextConfig;
