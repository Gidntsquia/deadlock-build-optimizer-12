// Runs the generator twice for every hero on the same snapshot and checks the output is identical.
// Also prints the Infernus builds + held-out validation for inspection.
import { readFileSync, readdirSync } from 'node:fs';
import { generateBuilds } from '../src/generator';
import { validate } from '../src/validation';
import type { Hero, HeroAnalytics, Item } from '../src/types';

const items: Item[] = JSON.parse(readFileSync('data/items.json', 'utf8'));
const heroes: Hero[] = JSON.parse(readFileSync('data/heroes.json', 'utf8'));
const load = (id: number): HeroAnalytics => JSON.parse(readFileSync(`data/analytics/${id}.json`, 'utf8'));
const sig = (h: Hero) => JSON.stringify(generateBuilds(h, items, load(h.id), { lateBonus: 1 }).builds.map((b) => [b.name, b.items.map((i) => i.item.id), b.abilitySteps.map((s) => s.ability.id)]));
let fail = 0;
for (const h of heroes) {
  const a = sig(h), b = sig(h);
  const builds = JSON.parse(a) as [string, number[], number[]][];
  const ok = a === b && builds.length >= 2 && builds.every((x) => x[1].length >= 12 && new Set(x[2]).size === 4);
  if (!ok) { fail++; console.log('FAIL', h.name, builds.map((x) => [x[0], x[1].length, new Set(x[2]).size])); }
}
console.log(`${heroes.length - fail}/${heroes.length} heroes: deterministic, >=2 builds, >=12 items, 4 abilities`);
if (readdirSync('data/analytics').length !== heroes.length) { console.log('analytics count mismatch'); fail++; }
const inf = heroes.find((h) => h.id === 1)!;
const { builds } = generateBuilds(inf, items, load(1), { lateBonus: 1 });
const v = validate(builds);
console.log('Zergggy core:', v.core.map((c) => `${items.find((i) => i.id === c.item_id)?.name} ${(c.freq * 100).toFixed(0)}%`).join(', '));
for (const b of builds) {
  console.log(`\n${b.name}: agreement ${(v.perBuild[b.key].agreement * 100).toFixed(0)}%`);
  console.log(b.items.map((i) => `${i.phase[0]} ${i.item.name}${v.perBuild[b.key].coreIds.has(i.item.id) ? '*' : ''}`).join(' | '));
  console.log(b.abilitySteps.map((s) => `${s.ability.name}${s.tier ? 'T' + s.tier : ''}`).join(' > '));
}
process.exit(fail ? 1 : 0);
