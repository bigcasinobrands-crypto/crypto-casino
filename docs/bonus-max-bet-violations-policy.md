# Max-bet violations and auto-forfeit

## Operator-controlled threshold

- Environment variable: `BONUS_MAX_BET_VIOLATIONS_AUTO_FORFEIT` (integer).
- **0 (default):** disabled. Violations are still recorded on `user_bonus_instances.max_bet_violations_count` and in `bonus_wager_violations`; no automatic forfeit from the worker.
- **N ≥ 1:** the worker periodically selects **active** instances with `max_bet_violations_count >= N` and calls `ForfeitInstance` with reason `max_bet_violations` (system actor in bonus audit). Each run processes at most 50 rows; repeated runs drain a backlog.

Heavy ledger work is **not** done inside the BlueOcean debit path that rejects an over-max bet; only the violation row and counter increment run there.

## Game contribution weights (`game_contribution_profiles`)

The `weights` JSON for the profile named `default` is resolved in this order:

1. **`per_game`** — object map from game id (case-insensitive match on keys) to a percentage 0–100.
2. **Category** — key from `games.category` for the current game (lowercase).
3. **`default`** — fallback key in the same JSON.

Numeric values in `per_game` / category / `default` may be integers, floats, `json.Number`, or decimal strings; they are clamped to 0–100.
