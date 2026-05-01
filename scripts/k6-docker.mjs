#!/usr/bin/env node
/**
 * Run `scripts/k6/core-api.js` in Grafana k6 (Docker) without a local k6 install.
 * The API should listen on the host (default: port 9090 in this repo's .env).
 *
 *   node scripts/k6-docker.mjs
 *   $env:K6_BASE_URL="http://host.docker.internal:9090"; node scripts/k6-docker.mjs
 *
 * With k6 on PATH:
 *   $env:K6_IN_HOST_NETWORK="1"; node scripts/k6-docker.mjs
 *
 * Optional k6 flags (e.g. shorter run):  $env:K6_EXTRAS="-d 5s -u 5"
 */
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, dirname } from "node:path";

const scriptDir = join(dirname(fileURLToPath(import.meta.url)), "k6");
const testFile = join(scriptDir, "core-api.js");
if (!existsSync(testFile)) {
  console.error("Missing", testFile);
  process.exit(1);
}

const k6Local = process.env.K6_IN_HOST_NETWORK === "1";

const base = process.env.K6_BASE_URL || (k6Local ? "http://127.0.0.1:9090" : "http://host.docker.internal:9090");
const extras = (process.env.K6_EXTRAS || "").split(/\s+/).filter(Boolean);

if (k6Local) {
  const r = spawnSync("k6", ["version"], { shell: false, encoding: "utf8" });
  if (r.status !== 0) {
    console.error("k6 not on PATH. Use Docker (unset K6_IN_HOST_NETWORK) or install k6: https://k6.io/docs/get-started/installation/");
    process.exit(1);
  }
  const ex = spawnSync("k6", ["run", "-e", `BASE_URL=${base}`, ...extras, "core-api.js"], {
    cwd: scriptDir,
    stdio: "inherit",
    shell: false,
  });
  process.exit(ex.status ?? 1);
}

// On Windows, `C:\x:y` makes Docker parse the volume wrong (colon after drive). Use c:/x/y style.
function dockerVolumeHostPath(absPath) {
  if (process.platform !== "win32") {
    return absPath;
  }
  const s = String(absPath).replace(/\\/g, "/");
  if (/^[A-Za-z]:\//.test(s)) {
    return s[0].toLowerCase() + s.slice(1);
  }
  return absPath;
}

const vol = `${dockerVolumeHostPath(scriptDir)}:/k6:ro`;
const dr = spawnSync(
  "docker",
  [
    "run",
    "--rm",
    "-v",
    vol,
    "grafana/k6",
    "run",
    "-e",
    `BASE_URL=${base}`,
    ...extras,
    "/k6/core-api.js",
  ],
  { stdio: "inherit", shell: false, windowsHide: true },
);
process.exit(dr.status ?? 1);
