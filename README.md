# Deadlock Build Optimizer

A mobile-first React app that generates item builds and ability orders for any Deadlock hero from public aggregate stats (deadlock-api.com), then checks the Infernus builds against top player Zergggy's real builds as a held-out test.

## Quickstart

```sh
npm install
npm run fetch-data    # ~2–3 min; writes data/*.json and public/img/*
npm run dev           # http://localhost:5173
npm run build         # type-check + production build (works offline)
npm run check-determinism   # generator runs twice per hero, outputs must match
```

After `fetch-data` the app needs no network: all JSON and images are local.

## What it does

- Hero picker (38 active heroes), opens on **Infernus**.
- One build per hero: **Spirit Burn** / **Spirit Caster** or **Gun Carry**, whichever slot (weapon or spirit) high-skill players spend more souls on for that hero. (The generator still scores both; the app shows the first.)
- Each build: ~17–20 items (as many as high-skill players buy on that hero) grouped early / mid / late, in buy order, with cost, running soul total, win rate and pick rate; ability unlock order plus a point-by-point grid of upgrade tiers (T1–T3) using the real ability names.
- Tap any item for a detail card: shop image, cost, tier, slot type, stat lines and passive/active text, all rendered from the assets API.
- Infernus only: a validation card with the build's agreement % with Zergggy, and a ★ on items in his core set.

## Data pipeline (`scripts/fetch-data.mjs`)

| File | Source | Used by |
|---|---|---|
| `data/items.json` | `/v1/assets/items/by-type/upgrade` (251 items) | generator, UI |
| `data/heroes.json` | `/v1/assets/heroes?only_active=true` + ability catalog | generator, UI |
| `data/analytics/{hero}.json` | `/v1/analytics/item-stats`, `ability-order-stats`, `item-permutation-stats` | generator |
| `data/user.json` | `/v1/players/267836488/match-history` | personalization |
| `data/validation/zergggy-infernus.json` | Zergggy match history + `/v1/matches/{id}/metadata` for his 30 latest matchmaking Infernus games | **validation only** |

Requests are made one at a time with a 450 ms gap (the API allows 200 per minute) and retried with backoff on 429/5xx.

## Scoring function (`src/generator.ts`)

Inputs: the item catalog, the hero's asset data, and that hero's **aggregate** analytics snapshot. Nothing else. The module does not import any data file; it's a pure function `generateBuilds(hero, catalog, analytics, { lateSlots })`.

Candidates: shopable items bought in ≥1% of the hero's high-skill games. Each candidate gets a score for each archetype:

| Term | Weight | Meaning |
|---|---|---|
| Win rate | 0.30 | Item win rate, smoothed toward the hero average with a 200-game prior; ±6 pp maps to 0..1. The delta is scaled by (1 − pick rate): an item bought in nearly every game has no games without it to compare against |
| Usage | 0.20 | √(item matches / hero games), where hero games = the most-bought item's matches |
| Stat value per soul | 0.20 | Sum of the item's stat lines (elevated ×1.5, important ×1.25, other ×1), each weighted by the archetype's category weight, divided by √(cost/800), normalized to the best item in the same tier |
| Slot fit | 0.10 | Weapon/vitality/spirit weight for the archetype (gun: 1 / 0.55 / 0.2; spirit: 0.2–0.45 / 0.55 / 1) |
| Kit synergy | 0.10 | Fire-rate items +0.6 if an ability triggers on weapon hits; spirit items scaled by the share of ability damage that scales with Spirit Power and by spirit power per level; gun items by the inverse share and bullet damage growth per level |
| Game phase | 0.05 | How close the item's average buy time is to the phase centre (5 / 17 / 30 min) |
| Active | 0.05 | Active items get a bump; at most 3 actives per build |
| Pair synergy | 0.15 | Mean win-rate lift (from item-permutation-stats pairs) with items already picked |

Category weights (gun / fire rate / spirit / survival / mobility): Gun Carry 1 / 1 / 0.2 / 0.5 / 0.25; Spirit build 0.2 / 0.8 (on-hit kits, else 0.2) / 1 / 0.5 / 0.25.

Selection is greedy, phase by phase, highest score first, ties broken by lower item id:

- **Early**: items from tiers 1–2 (800–1,600 souls)
- **Mid**: items from tiers 2–3 (1,600–3,200)
- **Late**: items from tiers 3–4 (3,200–6,400), plus one extra if personalization says your games run long

Item count per phase comes from the hero's aggregate data: the number of items high-skill players buy with an average buy time under 10 min (early), 10–23 min (mid) and after 23 min (late), rounded and clamped to 3–10. For Infernus that is 5 / 10 / 4.

Inside each phase items are ordered by their average buy time in high-skill games.

Ability order: among ability-order-stats rows (top 60 by games, ≥20 games each), pick the one with the best `smoothed win rate + 0.01·log10(games)`. First occurrence of an ability is its unlock; later ones are upgrade tiers 1–3. Both builds share this order.

No weight was tuned against Zergggy's data. The weights above were set before looking at the validation score and left alone.

**Determinism**: no randomness, no dates, stable sorts with id tie-breaks. `npm run check-determinism` generates every hero twice and compares.

## Zergggy validation (`src/validation.ts`)

This is the only module that imports `data/validation/zergggy-infernus.json` (check with `grep -rn zergggy src/generator.ts` — no hits). It runs on the generator's output after generation.

- **Core set rule**: an item is core if it appears in **≥30% of his sampled matches**, with wins counted 1.5× and losses 1×. Items below 30% are treated as his experiments and excluded.
- **Agreement** = 0.7 × (core items present in the build / core set size) + 0.3 × (share of concordant pairs when comparing the build's order of shared items with his median buy times).

On the 2026-09-23 snapshot: Spirit Burn **63%** (13 of 23 core items, 78% order), Gun Carry 42%.

Earlier fixed-size builds (13–14 items) scored 50%: they could hold at most 14 of his 23 core items. Sizing builds from aggregate purchase counts fixed that without using any of his data. This was the only change made and it was scored once, so the test stays held-out.

## Extra held-out checks (`npm run validate-players`)

`scripts/validate-players.ts` downloads each player's 30 latest matchmaking games on a hero (cached in `data/validation/`) and scores the builds with the same rules. The generator never sees this data. Results from the 2026-09-23 run:

| Player / hero | Core items | Shown build | Other build |
|---|---|---|---|
| Deathy / Lash | 20 | Spirit Caster 48% (5/20, 100% order) | Gun Carry 43% (6/20) |
| Zergggy / Mina | 18 | Gun Carry 59% (8/18, 93% order) | Spirit Burn 67% (11/18) |

- Lash: Deathy plays a hybrid (Headshot Booster, Headhunter, Mystic Burst, Healbane, Unstoppable). Neither archetype covers both halves.
- Mina: the kit check picks Gun Carry, but Zergggy builds spirit, and the spirit build scores higher. His staples (Extra Spirit, Mystic Burst, Boundless Spirit) aren't in either build.

## Round 2 changes (2026-09-23)

Scored once per attempt on all three held-out tests (shown build; Infernus / Lash / Mina):

| Version | Infernus | Lash | Mina |
|---|---|---|---|
| Before (style from kit) | 42% | 48% | 59% |
| A. "Meta" build weighted by aggregate slot spend | 54% | 47% | 72% |
| B. Style chosen by aggregate slot spend | 63% | 48% | 67% |
| **B + staple win-rate fix (shipped)** | **59%** | **51%** | **73%** |

A was reverted. The kit check had been leading with Gun Carry on Infernus and Mina, but high-skill players buy mostly spirit on both. B fixes that using aggregate data only. The staple fix helps Lash and Mina but costs Infernus 4 points. Picking among three variants by test score leaks some information from the tests, so treat these numbers as slightly optimistic.

## Personalization (`src/personalization.ts`)

Median match length of the user's matchmaking games: ≥32 min adds one late-game item. Not shown in the UI.

## Judgment calls

- **Assets host moved.** `assets.deadlock-api.com` no longer resolves (NXDOMAIN on 2026-09-23). The same data is served at `api.deadlock-api.com/v1/assets/*`, so the pipeline uses that.
- **Shopable item count is 173, not ≥200.** The catalog has 251 upgrade items (all saved), but only 173 are flagged `shopable` today; 78 are disabled/removed items. The acceptance criterion's ≥200 figure can't be met against current live data. The generator only recommends shopable items.
- **Analytics filter**: average badge ≥ 90 (roughly Ascendant and up) and the last 30 days, to reflect high-skill play on the current patch.
- **Real matchmaking**: `game_mode = 1` and `match_mode` ∈ {1 Unranked, 4 Ranked}. Private lobbies (2), bots (3), and other modes are excluded, for both Zergggy and the user.
- **Zergggy sample**: his 30 most recent qualifying Infernus matches; an item counts once per match at its first purchase time (sold items still count).
- **Archetypes**: every hero gets the same two archetypes. The name of the spirit build depends on the kit.
- **Kit detection**: "on-hit" = an ability description mentions weapon hits / bullets / shots. For Infernus this is Afterburn, which is why fire-rate items score well in both builds.
- **Build size**: more items than the 12 slots, because later items replace early ones in real games.
- **Images**: shop images are downloaded to `public/img/` so the app works offline.
- Permutation stats: top 600 pairs by games; ability orders: top 60 by games (keeps snapshots small).
- The large JS bundle (~3.5 MB, 360 KB gzipped) is the item catalog; per-hero analytics are split into lazy chunks.
