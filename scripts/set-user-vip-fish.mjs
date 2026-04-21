#!/usr/bin/env node
/**
 * One-off: set a player's VIP tier to FISH by username or email substring.
 *   node scripts/set-user-vip-fish.mjs "drio malik"
 */
import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");

function loadDatabaseUrl() {
  const envPath = join(root, "services", "core", ".env");
  if (existsSync(envPath)) {
    const raw = readFileSync(envPath, "utf8");
    for (const line of raw.split(/\r?\n/)) {
      const t = line.trim();
      if (t.startsWith("DATABASE_URL=")) {
        return t.slice("DATABASE_URL=".length).trim().replace(/^["']|["']$/g, "");
      }
    }
  }
  return process.env.DATABASE_URL || "";
}

const needleRaw = process.argv.slice(2).join(" ").trim();
if (!needleRaw) {
  console.error('Usage: node scripts/set-user-vip-fish.mjs "drio malik"');
  process.exit(1);
}

const needle = needleRaw.toLowerCase();
const compact = needle.replace(/\s+/g, "");

const url = loadDatabaseUrl();
if (!url) {
  console.error("Missing DATABASE_URL");
  process.exit(1);
}

const client = new pg.Client({ connectionString: url });
await client.connect();

const { rows: fishRows } = await client.query(
  "SELECT id, name FROM vip_tiers WHERE name = 'FISH' LIMIT 1",
);
const fish = fishRows[0];
if (!fish) {
  console.error("FISH tier not found in vip_tiers");
  await client.end();
  process.exit(1);
}

/** Prefer exact username when "drio malik" → driomalik matches a row. */
let users = (
  await client.query(
    `SELECT id::text, email, username FROM users
     WHERE lower(replace(coalesce(username, ''), ' ', '')) = $1`,
    [compact],
  )
).rows;

if (users.length === 0) {
  const parts = needle.split(/\s+/).filter(Boolean);
  let where = "1=0";
  const params = [];
  let i = 1;
  for (const p of parts) {
    where += ` OR lower(coalesce(username,'')) LIKE $${i} OR lower(email) LIKE $${i}`;
    params.push(`%${p}%`);
    i++;
  }
  users = (await client.query(`SELECT id::text, email, username FROM users WHERE ${where}`, params)).rows;
}

if (users.length === 0) {
  console.error("No user matched:", needle);
  await client.end();
  process.exit(1);
}

if (users.length > 1) {
  console.error("Multiple matches; be more specific:");
  for (const u of users) console.error(" ", u.id, u.email, u.username);
  await client.end();
  process.exit(1);
}

const u = users[0];
await client.query(
  `INSERT INTO player_vip_state (user_id, tier_id, points_balance, lifetime_wager_minor, updated_at)
   VALUES ($1::uuid, $2, 0, 0, now())
   ON CONFLICT (user_id) DO UPDATE SET tier_id = EXCLUDED.tier_id, updated_at = now()`,
  [u.id, fish.id],
);

console.log("OK:", u.email, u.username || "(no username)", "-> VIP", fish.name, `(tier_id=${fish.id})`);
await client.end();
