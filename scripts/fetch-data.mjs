// Downloads every snapshot the app needs into data/ (JSON) and public/img/ (images).
// After one run the app works fully offline.
import { mkdir, writeFile, access } from 'node:fs/promises';

const API = 'https://api.deadlock-api.com';
const ZERGGGY = 35187362;
const USER = 267836488;
const INFERNUS = 1;
const ZERG_SAMPLE = 30;
// Aggregate analytics are restricted to high-skill lobbies (badge >= 90 ≈ Ascendant+)
// and the last 30 days so they reflect the current patch.
const SINCE = Math.floor(Date.now() / 1000) - 30 * 86400;
const ANALYTICS_FILTER = `min_average_badge=90&min_unix_timestamp=${SINCE}`;
// Real matchmaking only: game_mode 1 = normal 6v6; match_mode 1 = unranked, 4 = ranked.
// Private lobbies (2), coop bots (3), calibration/other modes are excluded.
const REAL_MATCH_MODES = new Set([1, 4]);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const DELAY_MS = 450; // API limit is 200 req / 60 s; stay well under it.

async function get(url, { retries = 4, json = true } = {}) {
  for (let i = 0; ; i++) {
    await sleep(DELAY_MS);
    const res = await fetch(url);
    if (res.ok) return json ? res.json() : Buffer.from(await res.arrayBuffer());
    if (i >= retries || (res.status < 500 && res.status !== 429)) throw new Error(`${res.status} ${url}`);
    console.warn(`  retry ${i + 1} after ${res.status}: ${url}`);
    await sleep(2000 * (i + 1));
  }
}
const save = (path, data) => writeFile(path, JSON.stringify(data));
const exists = (p) => access(p).then(() => true, () => false);

await mkdir('data/analytics', { recursive: true });
await mkdir('data/validation', { recursive: true });
await mkdir('public/img/items', { recursive: true });
await mkdir('public/img/heroes', { recursive: true });
await mkdir('public/img/abilities', { recursive: true });

console.log('Item catalog…');
const items = await get(`${API}/v1/assets/items/by-type/upgrade`);
await save('data/items.json', items);
console.log(`  ${items.length} upgrade items (${items.filter((i) => i.shopable).length} shopable)`);

console.log('Heroes + abilities…');
const heroes = (await get(`${API}/v1/assets/heroes?only_active=true`)).filter(
  (h) => h.player_selectable && !h.disabled && !h.in_development,
);
const abilityCatalog = await get(`${API}/v1/assets/items/by-type/ability`);
const byClass = new Map(abilityCatalog.map((a) => [a.class_name, a]));
const heroOut = heroes.map((h) => ({
  id: h.id,
  name: h.name,
  class_name: h.class_name,
  image: h.images?.icon_image_small_webp ?? h.images?.icon_image_small,
  starting_stats: h.starting_stats,
  standard_level_up_upgrades: h.standard_level_up_upgrades,
  purchase_bonuses: h.purchase_bonuses,
  abilities: ['signature1', 'signature2', 'signature3', 'signature4']
    .map((slot) => byClass.get(h.items?.[slot]))
    .filter(Boolean)
    .map((a) => ({
      id: a.id,
      class_name: a.class_name,
      name: a.name,
      image: a.image_webp ?? a.image,
      description: a.description,
      properties: a.properties,
      upgrades: a.upgrades,
    })),
}));
await save('data/heroes.json', heroOut);
console.log(`  ${heroOut.length} active heroes`);

console.log('Per-hero analytics (item-stats, ability-order-stats, item-permutation-stats)…');
for (const h of heroOut) {
  const base = `hero_id=${h.id}&${ANALYTICS_FILTER}`;
  const itemStats = await get(`${API}/v1/analytics/item-stats?${base}`);
  const abilityOrders = (await get(`${API}/v1/analytics/ability-order-stats?${base}&min_matches=20`))
    .sort((a, b) => b.matches - a.matches)
    .slice(0, 60);
  const perms = (await get(`${API}/v1/analytics/item-permutation-stats?${base}&comb_size=2`))
    .sort((a, b) => b.matches - a.matches)
    .slice(0, 600);
  await save(`data/analytics/${h.id}.json`, { hero_id: h.id, fetched_at: new Date().toISOString(), filter: ANALYTICS_FILTER, itemStats, abilityOrders, perms });
  console.log(`  ${h.name}: ${itemStats.length} items, ${abilityOrders.length} ability orders, ${perms.length} pairs`);
}

console.log('User match history (personalization)…');
const userHist = await get(`${API}/v1/players/${USER}/match-history`);
await save('data/user.json', {
  account_id: USER,
  matches: userHist
    .filter((m) => m.game_mode === 1 && REAL_MATCH_MODES.has(m.match_mode))
    .map((m) => ({ match_id: m.match_id, hero_id: m.hero_id, duration_s: m.match_duration_s, result: m.match_result === m.player_team ? 1 : 0, start_time: m.start_time })),
});

// ---- Held-out validation data. Only src/validation.ts reads this file. ----
console.log('Zergggy Infernus matches (validation only)…');
const zHist = await get(`${API}/v1/players/${ZERGGGY}/match-history`);
const zInf = zHist.filter((m) => m.hero_id === INFERNUS);
const zReal = zInf.filter((m) => m.game_mode === 1 && REAL_MATCH_MODES.has(m.match_mode)).sort((a, b) => b.start_time - a.start_time);
const itemIds = new Set(items.map((i) => i.id));
const sampled = [];
for (const m of zReal) {
  if (sampled.length >= ZERG_SAMPLE) break;
  try {
    const md = await get(`${API}/v1/matches/${m.match_id}/metadata`, { retries: 2 });
    const p = md.match_info.players.find((x) => x.account_id === ZERGGGY);
    if (!p) continue;
    sampled.push({
      match_id: m.match_id,
      start_time: m.start_time,
      duration_s: md.match_info.duration_s,
      won: p.team === md.match_info.winning_team,
      purchases: p.items
        .filter((it) => itemIds.has(it.item_id))
        .map((it) => ({ item_id: it.item_id, t: it.game_time_s, sold: it.sold_time_s })),
    });
    console.log(`  ${sampled.length}/${ZERG_SAMPLE} match ${m.match_id}`);
  } catch (e) {
    console.warn(`  skip ${m.match_id}: ${e.message}`);
  }
}
await save('data/validation/zergggy-infernus.json', {
  account_id: ZERGGGY,
  hero_id: INFERNUS,
  infernus_matches_total: zInf.length,
  infernus_real_matchmaking: zReal.length,
  matches: sampled,
});

console.log('Images…');
const imgJobs = [
  ...items.filter((i) => i.shop_image_webp || i.image_webp).map((i) => [i.shop_image_webp ?? i.image_webp, `public/img/items/${i.id}.webp`]),
  ...heroOut.filter((h) => h.image).map((h) => [h.image, `public/img/heroes/${h.id}.webp`]),
  ...heroOut.flatMap((h) => h.abilities.filter((a) => a.image).map((a) => [a.image, `public/img/abilities/${a.id}.webp`])),
];
let n = 0;
for (let i = 0; i < imgJobs.length; i += 8) {
  await Promise.all(
    imgJobs.slice(i, i + 8).map(async ([url, path]) => {
      if (await exists(path)) return;
      const res = await fetch(url);
      if (res.ok) { await writeFile(path, Buffer.from(await res.arrayBuffer())); n++; }
      else console.warn(`  image ${res.status}: ${url}`);
    }),
  );
}
console.log(`  ${n} new images`);
console.log('Done.');
