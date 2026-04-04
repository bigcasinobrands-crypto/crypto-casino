#!/usr/bin/env node
/**
 * Run go mod tidy, vet, and build all cmd/* binaries from repo root.
 * Resolves go.exe on Windows when Go is installed but not on PATH (common in IDE terminals).
 */
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(fileURLToPath(new URL("..", import.meta.url)));
const core = join(root, "services", "core");
const isWin = process.platform === "win32";
const ext = isWin ? ".exe" : "";

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
  console.error(
    "Go not found. Install Go 1.22+ and ensure it is on PATH, or use the default Windows install path.",
  );
  process.exit(1);
}

function run(go, args) {
  const r = spawnSync(go, args, {
    cwd: core,
    stdio: "inherit",
    shell: false,
    env: process.env,
  });
  if (r.status !== 0) process.exit(r.status ?? 1);
}

const go = findGo();
run(go, ["mod", "tidy"]);
run(go, ["vet", "./..."]);
const cmds = ["api", "worker", "bootstrap", "playerbootstrap"];
for (const name of cmds) {
  const out = join(core, "bin", `${name}${ext}`);
  run(go, ["build", "-o", out, `./cmd/${name}`]);
}
console.log("services/core: tidy, vet, and builds OK (" + cmds.join(", ") + ").");
