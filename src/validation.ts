// Held-out validation against Zergggy's real Infernus builds.
// This is the ONLY module that reads the Zergggy snapshot. It runs after the
// generator and never feeds back into it.
import zerg from '../data/validation/zergggy-infernus.json';
import type { Build } from './types';

export const CORE_THRESHOLD = 0.3; // item must appear in >=30% of sampled matches (win-weighted)
export const WIN_WEIGHT = 1.5; // a win counts 1.5x, a loss 1x
export const OVERLAP_WEIGHT = 0.7;
export const ORDER_WEIGHT = 0.3;

export interface ZMatch { match_id: number; won: boolean; purchases: { item_id: number; t: number }[] }

export interface CoreItem { item_id: number; freq: number; medianBuyS: number }
export interface Validation {
  sampleSize: number;
  core: CoreItem[];
  perBuild: Record<string, { agreement: number; overlap: number; order: number; shared: number; coreIds: Set<number> }>;
}

function median(xs: number[]) {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? (s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2) : 0;
}

export function coreSet(matches: ZMatch[] = (zerg as { matches: ZMatch[] }).matches): { core: CoreItem[]; sampleSize: number } {
  const totalW = matches.reduce((a, m) => a + (m.won ? WIN_WEIGHT : 1), 0);
  const w = new Map<number, number>();
  const times = new Map<number, number[]>();
  for (const m of matches) {
    const first = new Map<number, number>();
    for (const p of m.purchases) if (!first.has(p.item_id) || p.t < first.get(p.item_id)!) first.set(p.item_id, p.t);
    for (const [id, t] of first) {
      w.set(id, (w.get(id) ?? 0) + (m.won ? WIN_WEIGHT : 1));
      times.set(id, [...(times.get(id) ?? []), t]);
    }
  }
  const core = [...w.entries()]
    .map(([item_id, x]) => ({ item_id, freq: x / totalW, medianBuyS: median(times.get(item_id)!) }))
    .filter((c) => c.freq >= CORE_THRESHOLD)
    .sort((a, b) => a.medianBuyS - b.medianBuyS || a.item_id - b.item_id);
  return { core, sampleSize: matches.length };
}

// Agreement = 70% item overlap (share of core items the build contains)
//           + 30% buy-order agreement (share of concordant pairs among shared items).
export function validate(builds: Build[], matches?: ZMatch[]): Validation {
  const { core, sampleSize } = coreSet(matches);
  const coreIds = new Set(core.map((c) => c.item_id));
  const coreRank = new Map(core.map((c, i) => [c.item_id, i]));
  const perBuild: Validation['perBuild'] = {};
  for (const b of builds) {
    const shared = b.items.map((i) => i.item.id).filter((id) => coreIds.has(id));
    const overlap = core.length ? shared.length / core.length : 0;
    let conc = 0, pairs = 0;
    for (let i = 0; i < shared.length; i++)
      for (let j = i + 1; j < shared.length; j++) { pairs++; if (coreRank.get(shared[i])! < coreRank.get(shared[j])!) conc++; }
    const order = pairs ? conc / pairs : shared.length ? 1 : 0;
    perBuild[b.key] = { agreement: OVERLAP_WEIGHT * overlap + ORDER_WEIGHT * order, overlap, order, shared: shared.length, coreIds };
  }
  return { sampleSize, core, perBuild };
}
