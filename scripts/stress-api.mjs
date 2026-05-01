#!/usr/bin/env node
/**
 * Local HTTP load tests for the core API (autocannon). Requires: npx (Node), API reachable.
 *
 * Interpreting results:
 * - /health: raw Go net/http throughput (no DB). Use for "server headroom" on a single host.
 * - /health/ready: includes PostgreSQL + Redis ping — typical orchestration probe cost.
 * - /v1/games: heavy JSON + DB; also subject to per-IP httprate (180/min on this route group),
 *   so a single source IP will see ~429 after the bucket is consumed — that is expected abuse protection,
 *   not a failure of the games handler per se.
 * - "Customers" in production: effective throughput ≈ (limits per route × distinct client IPs) behind
 *   a load balancer, plus DB connection pool and hardware. This script is one client only.
 */
import { spawnSync } from "node:child_process";
import { env } from "node:process";

const base = (env.API_STRESS_BASE_URL ?? "http://127.0.0.1:9090").replace(/\/$/, "");

const scenarios = [
  {
    name: "GET /health (liveness, no DB work)",
    args: ["-c", "200", "-d", "10", `${base}/health`],
  },
  {
    name: "GET /health/ready (DB + Redis ping)",
    args: ["-c", "100", "-d", "10", `${base}/health/ready`],
  },
  {
    name: "GET /health/operational (DB queries + JSON)",
    args: ["-c", "50", "-d", "10", "-m", "GET", `${base}/health/operational`],
  },
  {
    name: "GET /v1/games (large payload; expect 429 when exceeding per-IP limit)",
    args: ["-c", "100", "-d", "10", `${base}/v1/games`],
  },
];

function run() {
  console.log(`API stress base: ${base}\n`);
  for (const s of scenarios) {
    console.log(`\n--- ${s.name} ---\n`);
    const r = spawnSync(
      "npx",
      ["--yes", "autocannon@8", ...s.args],
      { stdio: "inherit", shell: true, env: { ...env, FORCE_COLOR: "1" } },
    );
    if (r.status !== 0) {
      console.error(`\n[stress-api] scenario failed: ${s.name} (exit ${r.status})`);
      process.exit(r.status ?? 1);
    }
  }
  console.log(
    "\n[stress-api] Done. See README in this file header for how to read limits vs. raw RPS.\n",
  );
}

run();
