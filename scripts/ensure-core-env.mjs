#!/usr/bin/env node
/**
 * Creates services/core/.env from .env.example when missing so `npm run dev:api` can boot.
 */
import { copyFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(fileURLToPath(new URL("..", import.meta.url)));
const coreDir = join(root, "services", "core");
const envPath = join(coreDir, ".env");
const examplePath = join(coreDir, ".env.example");

if (existsSync(envPath)) {
  process.exit(0);
}
if (!existsSync(examplePath)) {
  console.error("ensure-core-env: missing services/core/.env.example");
  process.exit(1);
}
copyFileSync(examplePath, envPath);
console.log(
  "Created services/core/.env from .env.example (first run). Edit secrets before any shared deploy.",
);
