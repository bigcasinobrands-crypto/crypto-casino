#!/usr/bin/env node
/**
 * `go run` for a package under services/core/cmd — finds Go on Windows like build-core.mjs.
 */
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(fileURLToPath(new URL("..", import.meta.url)));
const core = join(root, "services", "core");
const isWin = process.platform === "win32";

function findGo() {
  if (isWin) {
    const local = process.env.LOCALAPPDATA
      ? join(process.env.LOCALAPPDATA, "Programs", "Go", "bin", "go.exe")
      : null;
    for (const p of ["C:\\Program Files\\Go\\bin\\go.exe", local].filter(Boolean)) {
      if (existsSync(p)) return p;
    }
  }
  const pathProbe = spawnSync("go", ["version"], {
    shell: isWin,
    encoding: "utf8",
  });
  if (pathProbe.status === 0) return "go";
  console.error("Go not found. Install Go 1.22+ or add it to PATH.");
  process.exit(1);
}

const pkg = process.argv[2];
if (!pkg) {
  console.error("Usage: node scripts/go-dev.mjs ./cmd/api");
  process.exit(1);
}

const go = findGo();
const r = spawnSync(go, ["run", pkg], {
  cwd: core,
  stdio: "inherit",
  shell: false,
  env: process.env,
});
process.exit(r.status ?? 1);
