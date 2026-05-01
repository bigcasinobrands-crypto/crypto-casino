#!/usr/bin/env node
/**
 * Read the public URL from a running ngrok agent (local API on :4040) and print
 * core API env + Blue Ocean / webhook URLs to register.
 *
 * Prereq: start the core API on the port you tunnel (default 9090), then in another
 * terminal:  ngrok http 9090
 *   (or:  npx -y ngrok http 9090  if ngrok is not on PATH)
 *
 * Usage:
 *   node scripts/print-ngrok-callback.mjs
 *   node scripts/print-ngrok-callback.mjs --wait 30000
 *   node scripts/print-ngrok-callback.mjs --api-base http://127.0.0.1:4040
 */
import { setTimeout as delay } from "node:timers/promises";

function parseArgs() {
  const args = process.argv.slice(2);
  let waitMs = 0;
  let agentBase = "http://127.0.0.1:4040";
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--wait" && args[i + 1]) {
      waitMs = Number(args[++i]) || 0;
    } else if (args[i] === "--api-base" && args[i + 1]) {
      agentBase = args[++i].replace(/\/$/, "");
    }
  }
  return { waitMs, agentBase };
}

function pickHttpsBase(tunnels) {
  if (!Array.isArray(tunnels)) return null;
  const https = tunnels.find(
    (t) => t.proto === "https" && typeof t.public_url === "string"
  );
  if (https) return https.public_url.replace(/\/$/, "");
  const any = tunnels.find((t) => typeof t.public_url === "string" && t.public_url.startsWith("https://"));
  return any ? any.public_url.replace(/\/$/, "") : null;
}

async function fetchTunnels(agentBase) {
  const res = await fetch(`${agentBase}/api/tunnels`);
  if (!res.ok) {
    throw new Error(`ngrok local API ${res.status} — is ngrok running?`);
  }
  const data = await res.json();
  return pickHttpsBase(data.tunnels);
}

async function main() {
  const { waitMs, agentBase } = parseArgs();
  const deadline = Date.now() + waitMs;
  let lastErr;
  for (;;) {
    try {
      const base = await fetchTunnels(agentBase);
      if (base) {
        const noSlash = base.replace(/\/$/, "");
        process.stdout.write("\n");
        process.stdout.write(`API_PUBLIC_BASE=${noSlash}\n\n`);
        process.stdout.write("Blue Ocean seamless wallet (GET, register in BOG backoffice):\n");
        process.stdout.write(`  ${noSlash}/api/blueocean/callback\n\n`);
        process.stdout.write("Webhooks (POST, if you forward provider POSTs to your API):\n");
        process.stdout.write(`  ${noSlash}/v1/webhooks/blueocean\n\n`);
        process.stdout.write("Set API_PUBLIC_BASE in services/core/.env to the value above (no trailing slash).\n");
        return;
      }
      lastErr = new Error("no https tunnel in ngrok response");
    } catch (e) {
      lastErr = e;
    }
    if (Date.now() >= deadline) {
      process.stderr.write(
        `print-ngrok-callback: ${lastErr?.message || "failed"}\n` +
          `  Start ngrok:  ngrok http 9090  (port must match services/core PORT / default 9090)\n` +
          `  If the agent API is not on 4040:  --api-base http://127.0.0.1:PORT\n`
      );
      process.exit(1);
    }
    await delay(500);
  }
}

main().catch((e) => {
  process.stderr.write(String(e?.message || e) + "\n");
  process.exit(1);
});
