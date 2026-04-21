#!/usr/bin/env node
/**
 * Idempotent demo seed: published promotions (marketing tiles) + reward_programs
 * (daily calendar, wager hunt, rebate) + one VIP tier benefit for the admin Engagement hub.
 *
 * Reads DATABASE_URL from services/core/.env (or process.env).
 *
 *   npm run seed:rewards-demo
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

async function main() {
  const connectionString = loadDatabaseUrl();
  if (!connectionString) {
    console.error("Missing DATABASE_URL. Add it to services/core/.env or export it.");
    process.exit(1);
  }

  const client = new pg.Client({ connectionString });
  await client.connect();

  const run = (text) => client.query(text);

  try {
    await run("BEGIN");

    await run(`
INSERT INTO promotions (name, slug, status)
SELECT 'Demo: Welcome match', 'demo_seed_welcome_match', 'draft'
WHERE NOT EXISTS (SELECT 1 FROM promotions WHERE slug = 'demo_seed_welcome_match');
`);

    await run(`
INSERT INTO promotion_versions (
  promotion_id, version, rules, terms_text, published_at,
  player_title, player_description, bonus_type, priority
)
SELECT p.id, 1,
  '{"trigger":{"type":"deposit","min_minor":1000},"reward":{"type":"percent_match","percent":100,"cap_minor":50000},"wagering":{"multiplier":35}}'::jsonb,
  'Demo only: welcome package. Replace with real terms before production.',
  now(),
  'Welcome bonus 100% match',
  'Double your first qualifying deposit. Min 10 USDT.',
  'deposit_match',
  60
FROM promotions p
WHERE p.slug = 'demo_seed_welcome_match'
  AND NOT EXISTS (SELECT 1 FROM promotion_versions pv WHERE pv.promotion_id = p.id);
`);

    await run(`
INSERT INTO promotions (name, slug, status)
SELECT 'Demo: Promo code', 'demo_seed_promo_code', 'draft'
WHERE NOT EXISTS (SELECT 1 FROM promotions WHERE slug = 'demo_seed_promo_code');
`);

    await run(`
INSERT INTO promotion_versions (
  promotion_id, version, rules, terms_text, published_at,
  player_title, player_description, bonus_type, priority, promo_code
)
SELECT p.id, 1,
  '{"trigger":{"type":"deposit"},"reward":{"type":"fixed","fixed_minor":2500},"wagering":{"multiplier":20}}'::jsonb,
  'Demo only: redeem DEMOPLAY for a small bonus.',
  now(),
  'Redeem DEMOPLAY',
  'Apply on your next deposit for an extra 25 USDT bonus credit.',
  'promo_code',
  55,
  'DEMOPLAY'
FROM promotions p
WHERE p.slug = 'demo_seed_promo_code'
  AND NOT EXISTS (SELECT 1 FROM promotion_versions pv WHERE pv.promotion_id = p.id);
`);

    await run(`
INSERT INTO promotions (name, slug, status)
SELECT 'Demo: Rewards hub programs', 'demo_seed_rewards_hub', 'draft'
WHERE NOT EXISTS (SELECT 1 FROM promotions WHERE slug = 'demo_seed_rewards_hub');
`);

    await run(`
INSERT INTO promotion_versions (
  promotion_id, version, rules, terms_text, published_at,
  player_title, player_description, bonus_type, priority
)
SELECT p.id, 1,
  '{"trigger":{"type":"deposit"},"reward":{"type":"fixed","fixed_minor":100},"wagering":{"multiplier":5}}'::jsonb,
  'Demo only: backing promotion for daily / hunt / rebate programs.',
  now(),
  'Demo rewards core',
  'Powers calendar claims, wager hunt, and rebate in the rewards hub.',
  'promo_credit',
  40
FROM promotions p
WHERE p.slug = 'demo_seed_rewards_hub'
  AND NOT EXISTS (SELECT 1 FROM promotion_versions pv WHERE pv.promotion_id = p.id);
`);

    await run(`
INSERT INTO reward_programs (program_key, kind, promotion_version_id, config, enabled, priority)
SELECT 'demo_daily_login_v1', 'daily_fixed', pv.id, '{"amount_minor": 500}'::jsonb, true, 100
FROM promotion_versions pv
JOIN promotions p ON p.id = pv.promotion_id
WHERE p.slug = 'demo_seed_rewards_hub' AND pv.version = 1
ON CONFLICT (program_key) DO NOTHING;
`);

    await run(`
INSERT INTO reward_programs (program_key, kind, promotion_version_id, config, enabled, priority)
SELECT 'demo_wager_hunt_v1', 'daily_hunt', pv.id,
  '{"thresholds_wager_minor": [10000, 50000, 100000], "amounts_minor": [100, 300, 1000]}'::jsonb,
  true, 90
FROM promotion_versions pv
JOIN promotions p ON p.id = pv.promotion_id
WHERE p.slug = 'demo_seed_rewards_hub' AND pv.version = 1
ON CONFLICT (program_key) DO NOTHING;
`);

    await run(`
INSERT INTO reward_programs (program_key, kind, promotion_version_id, config, enabled, priority)
SELECT 'demo_wager_rebate_v1', 'wager_rebate', pv.id,
  '{"period":"daily","percent":3,"cap_minor":250000}'::jsonb,
  true, 80
FROM promotion_versions pv
JOIN promotions p ON p.id = pv.promotion_id
WHERE p.slug = 'demo_seed_rewards_hub' AND pv.version = 1
ON CONFLICT (program_key) DO NOTHING;
`);

    await run(`
INSERT INTO vip_tier_benefits (tier_id, sort_order, enabled, benefit_type, promotion_version_id, config, player_title, player_description)
SELECT t.id, 10, true, 'rebate_percent_add', NULL,
  '{"rebate_program_key":"demo_wager_rebate_v1","percent_add":2}'::jsonb,
  'Demo: +2% daily rebate',
  'Stacks on the demo daily wager rebate program (Engagement - VIP).'
FROM vip_tiers t
WHERE t.id = (SELECT id FROM vip_tiers ORDER BY sort_order ASC OFFSET 1 LIMIT 1)
  AND NOT EXISTS (
    SELECT 1 FROM vip_tier_benefits b
    WHERE b.tier_id = t.id AND b.player_title = 'Demo: +2% daily rebate'
  );
`);

    await run("COMMIT");

    console.log("");
    console.log("Rewards demo seed: OK");
    console.log("- Promotions (slugs): demo_seed_welcome_match, demo_seed_promo_code, demo_seed_rewards_hub");
    console.log("- Reward programs: demo_daily_login_v1, demo_wager_hunt_v1, demo_wager_rebate_v1");
    console.log("- Promo code for players: DEMOPLAY");
    console.log("");
    console.log("Next: sign in on player /rewards, or run  npm run demo:rewards");
    console.log("Admin: Bonus Engine (promotions, reward programs) + Engagement - VIP system");
    console.log("");
  } catch (e) {
    await run("ROLLBACK").catch(() => {});
    console.error("Seed failed:", e.message || e);
    process.exitCode = 1;
  } finally {
    await client.end();
  }
}

await main();
