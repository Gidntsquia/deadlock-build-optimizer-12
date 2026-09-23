// Extra held-out checks: other top players on other heroes.
// Fetches each player's recent matchmaking games on the hero (cached in data/validation/),
// then scores the generator's builds with the same rules as the Zergggy check.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { generateBuilds } from '../src/generator';
import { validate, type ZMatch } from '../src/validation';
import type { Hero, HeroAnalytics, Item } from '../src/types';

const API = 'https://api.deadlock-api.com';
const SAMPLE = 30;
const REAL = new Set([1, 4]);
const TESTS = [
  { player: 'Zergggy', account: 35187362, heroId: 1 },
  { player: 'Deathy', account: 87624911, heroId: 31 },
  { player: 'Zergggy', account: 35187362, heroId: 63 },
];
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function get(url: string): Promise<any> {
  for (let i = 0; ; i++) {
    await sleep(450);
    const r = await fetch(url);
    if (r.ok) return r.json();
    if (i >= 3 || (r.status < 500 && r.status !== 429)) throw new Error(`${r.status} ${url}`);
    await sleep(2000 * (i + 1));
  }
}

const items: Item[] = JSON.parse(readFileSync('data/items.json', 'utf8'));
const heroes: Hero[] = JSON.parse(readFileSync('data/heroes.json', 'utf8'));
const itemIds = new Set(items.map((i) => i.id));
const name = (id: number) => items.find((i) => i.id === id)?.name ?? id;

for (const t of TESTS) {
  const hero = heroes.find((h) => h.id === t.heroId)!;
  const file = `data/validation/${t.player.toLowerCase()}-${hero.name.toLowerCase()}.json`;
  if (!existsSync(file)) {
    const hist: any[] = await get(`${API}/v1/players/${t.account}/match-history`);
    const real = hist.filter((m) => m.hero_id === t.heroId && m.game_mode === 1 && REAL.has(m.match_mode)).sort((a, b) => b.start_time - a.start_time);
    const matches: ZMatch[] = [];
    for (const m of real) {
      if (matches.length >= SAMPLE) break;
      try {
        const md = await get(`${API}/v1/matches/${m.match_id}/metadata`);
        const p = md.match_info.players.find((x: any) => x.account_id === t.account);
        if (!p) continue;
        matches.push({ match_id: m.match_id, won: p.team === md.match_info.winning_team,
          purchases: p.items.filter((it: any) => itemIds.has(it.item_id)).map((it: any) => ({ item_id: it.item_id, t: it.game_time_s })) });
      } catch (e) { console.warn(`skip ${m.match_id}: ${(e as Error).message}`); }
    }
    writeFileSync(file, JSON.stringify({ account_id: t.account, hero_id: t.heroId, real_matchmaking: real.length, matches }));
  }
  const matches: ZMatch[] = JSON.parse(readFileSync(file, 'utf8')).matches;
  const analytics: HeroAnalytics = JSON.parse(readFileSync(`data/analytics/${t.heroId}.json`, 'utf8'));
  const { builds } = generateBuilds(hero, items, analytics, { lateBonus: 0 });
  const v = validate(builds, matches);
  console.log(`\n${t.player} ${hero.name}: ${v.sampleSize} games, ${v.core.length} core items`);
  builds.forEach((b, i) => {
    const r = v.perBuild[b.key];
    console.log(`  ${i === 0 ? '[shown] ' : ''}${b.name}: ${Math.round(r.agreement * 100)}% (${r.shared}/${v.core.length} core, ${Math.round(r.order * 100)}% order, ${b.items.length} items)`);
  });
  const shown = new Set(builds[0].items.map((b) => b.item.id));
  console.log('  missed core:', v.core.filter((c) => !shown.has(c.item_id)).map((c) => `${name(c.item_id)} ${Math.round(c.freq * 100)}%`).join(', '));
  console.log('  extra in build:', builds[0].items.filter((b) => !v.core.some((c) => c.item_id === b.item.id)).map((b) => b.item.name).join(', '));
}
