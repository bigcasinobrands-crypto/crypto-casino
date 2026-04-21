#!/usr/bin/env node
/**
 * Wait until a TCP port accepts connections (e.g. Postgres after `docker compose up`).
 * Usage: node scripts/wait-tcp.mjs <host> <port> [timeoutMs]
 */
import net from "node:net";

const host = process.argv[2] || "127.0.0.1";
const port = Number(process.argv[3] || 5432);
const timeoutMs = Number(process.argv[4] || 120_000);

if (!Number.isFinite(port) || port < 1) {
  console.error("wait-tcp: need host and port, e.g. node scripts/wait-tcp.mjs 127.0.0.1 5432");
  process.exit(1);
}

const deadline = Date.now() + timeoutMs;

function tryConnect() {
  return new Promise((resolve, reject) => {
    const socket = net.connect({ host, port }, () => {
      socket.end();
      resolve(undefined);
    });
    socket.setTimeout(2000);
    socket.on("timeout", () => {
      socket.destroy();
      reject(new Error("timeout"));
    });
    socket.on("error", () => {
      socket.destroy();
      reject(new Error("refused"));
    });
  });
}

async function main() {
  process.stderr.write(`wait-tcp: waiting for ${host}:${port} (up to ${timeoutMs}ms)…\n`);
  while (Date.now() < deadline) {
    try {
      await tryConnect();
      process.stderr.write(`wait-tcp: ${host}:${port} is up.\n`);
      process.exit(0);
    } catch {
      await new Promise((r) => setTimeout(r, 400));
    }
  }
  console.error(
    `wait-tcp: timed out after ${timeoutMs}ms — start Postgres (e.g. \`docker compose up -d postgres redis\` or \`npm run dev:casino\` from repo root).`,
  );
  process.exit(1);
}

void main();
