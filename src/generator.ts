// Build generator. Pure and deterministic: same inputs -> same builds.
// Match-data inputs are ONLY the aggregate analytics snapshot for the hero
// (item-stats, ability-order-stats, item-permutation-stats). It never sees any
// individual player's matches. See README "Scoring function" for the weights.
import type { Ability, AbilityStep, Build, BuildItem, Hero, HeroAnalytics, Item, ItemStat, Phase } from './types';

// ---------- Stat categories (property key -> category) ----------
type Cat = 'gun' | 'fireRate' | 'spirit' | 'survival' | 'mobility';
const STAT_CATS: Record<string, Cat> = {
  BaseAttackDamagePercent: 'gun', BonusClipSizePercent: 'gun', BonusBulletSpeedPercent: 'gun',
  BulletLifestealPercent: 'gun', BulletArmorReduction: 'gun', BulletResistReduction: 'gun',
  CloseRangeBonusWeaponPower: 'gun', NonPlayerBonusWeaponPower: 'gun', WeaponPower: 'gun',
  BonusFireRate: 'fireRate',
  TechPower: 'spirit', SpiritPower: 'spirit', BonusSpirit: 'spirit', CooldownReduction: 'spirit',
  AbilityLifestealPercentHero: 'spirit', BonusAbilityDurationPercent: 'spirit', TechRangeMultiplier: 'spirit',
  MagicResistReduction: 'spirit', BonusAbilityCharges: 'spirit', BonusSpiritForChargedAbilities: 'spirit',
  DebuffDuration: 'spirit',
  BonusHealth: 'survival', BulletResist: 'survival', TechResist: 'survival', OutOfCombatHealthRegen: 'survival',
  BonusHealthRegen: 'survival', StatusResistancePercent: 'survival', CombatBarrier: 'survival',
  SlowResistancePercent: 'survival', MeleeResistPercent: 'survival',
  BonusMoveSpeed: 'mobility', BonusSprintSpeed: 'mobility', Stamina: 'mobility', StaminaCooldownReduction: 'mobility',
};

export interface Archetype {
  key: string;
  name: string;
  blurb: string;
  catWeight: Record<Cat, number>;
  slotWeight: Record<Item['item_slot_type'], number>;
}

// ---------- Scoring weights (documented in README) ----------
export const WEIGHTS = {
  winRate: 0.3, // Bayesian-smoothed win rate vs hero average
  usage: 0.2, // pick rate among high-skill games on this hero
  statValue: 0.2, // archetype-weighted stat lines per soul
  slotFit: 0.1, // item slot matches the build's damage type
  kit: 0.1, // synergy with the hero's abilities / stat growth
  phase: 0.05, // avg buy time matches the phase being filled
  active: 0.05, // active items (capped per build)
  pairSynergy: 0.15, // permutation-stats win-rate lift with already-picked items
};
const WR_PRIOR_MATCHES = 200; // smoothing strength
const WR_SPREAD = 0.06; // ±6pp win-rate delta maps to 0..1
const MIN_MATCH_SHARE = 0.01; // ignore items bought in <1% of this hero's games
const MAX_ACTIVES = 3;
// Item counts per phase come from the data: how many items high-skill players
// buy on this hero with an average buy time inside each window.
const PHASES: { phase: Phase; tiers: number[]; centerS: number; fromS: number; toS: number }[] = [
  { phase: 'early', tiers: [1, 2], centerS: 300, fromS: 0, toS: 600 },
  { phase: 'mid', tiers: [2, 3], centerS: 1000, fromS: 600, toS: 1400 },
  { phase: 'late', tiers: [3, 4, 5], centerS: 1800, fromS: 1400, toS: Infinity },
];
const MIN_PHASE_ITEMS = 3;
const MAX_PHASE_ITEMS = 10;

export interface KitProfile {
  spiritScaling: number; // 0..1 share of ability damage props that scale with spirit power
  onHit: boolean; // an ability triggers from weapon hits -> fire rate feeds the kit
  gunGrowth: number; // bullet damage gained per level / base bullet damage
  spiritGrowth: number; // spirit power per level
  notes: string[];
}

function descText(a: Ability): string {
  return (a.description?.desc ?? '').replace(/<svg[\s\S]*?<\/svg>/g, '').replace(/<[^>]+>/g, '').toLowerCase();
}

export function kitProfile(hero: Hero): KitProfile {
  let scaled = 0, dmgProps = 0;
  let onHit = false;
  for (const a of hero.abilities) {
    for (const [k, p] of Object.entries(a.properties ?? {})) {
      if (!/Damage|DPS/i.test(k) || !Number(p.value)) continue;
      dmgProps++;
      const sf = p.scale_function;
      if (sf?.specific_stat_scale_type === 'ETechPower' || sf?.scaling_stats?.includes('ETechPower')) scaled++;
    }
    if (/weapon hits|bullets|bullet hits|shots/.test(descText(a))) onHit = true;
  }
  const up = hero.standard_level_up_upgrades ?? {};
  const baseBullet = hero.starting_stats?.bullet_damage?.value ?? 0;
  const gunGrowth = baseBullet ? (up.MODIFIER_VALUE_BASE_BULLET_DAMAGE_FROM_LEVEL ?? 0) / baseBullet : 0;
  const spiritGrowth = up.MODIFIER_VALUE_TECH_POWER ?? 0;
  const spiritScaling = dmgProps ? scaled / dmgProps : 0.5;
  const notes = [
    `${Math.round(spiritScaling * 100)}% of ability damage values scale with Spirit Power`,
    onHit ? 'An ability triggers on weapon hits, so Fire Rate also feeds ability damage' : 'No on-hit ability detected',
    `Per level: +${(gunGrowth * 100).toFixed(1)}% bullet damage, +${spiritGrowth} spirit power`,
  ];
  return { spiritScaling, onHit, gunGrowth, spiritGrowth, notes };
}

export function archetypes(kit: KitProfile): Archetype[] {
  const gun: Archetype = {
    key: 'gun',
    name: 'Gun Carry',
    blurb: 'Weapon damage, fire rate and ammo, with enough health to survive fights.',
    catWeight: { gun: 1, fireRate: 1, spirit: 0.2, survival: 0.5, mobility: 0.25 },
    slotWeight: { weapon: 1, vitality: 0.55, spirit: 0.2 },
  };
  const spirit: Archetype = {
    key: 'spirit',
    name: kit.onHit ? 'Spirit Burn' : 'Spirit Caster',
    blurb: kit.onHit
      ? 'Spirit power and cooldowns to amplify ability damage, plus fire rate to stack on-hit effects.'
      : 'Spirit power, cooldowns and duration to maximise ability damage.',
    catWeight: { gun: 0.2, fireRate: kit.onHit ? 0.8 : 0.2, spirit: 1, survival: 0.5, mobility: 0.25 },
    slotWeight: { spirit: 1, vitality: 0.55, weapon: kit.onHit ? 0.45 : 0.2 },
  };
  // Lead with whichever style the kit leans toward.
  return kit.spiritScaling >= 0.5 ? [spirit, gun] : [gun, spirit];
}

function statLines(item: Item): { key: string; cat: Cat; weight: number }[] {
  const out = new Map<string, { key: string; cat: Cat; weight: number }>();
  for (const sec of item.tooltip_sections ?? []) {
    for (const a of sec.section_attributes ?? []) {
      const add = (keys: string[] | undefined, w: number) => {
        for (const k of keys ?? []) {
          const cat = STAT_CATS[k];
          const v = Number(item.properties?.[k]?.value ?? 0);
          if (cat && v && !out.has(k)) out.set(k, { key: k, cat, weight: w });
        }
      };
      add(a.elevated_properties, 1.5);
      add(a.important_properties, 1.25);
      add(a.properties, 1);
    }
  }
  return [...out.values()].sort((a, b) => a.key.localeCompare(b.key));
}

const clamp01 = (x: number) => Math.max(0, Math.min(1, x));
const pairKey = (a: number, b: number) => (a < b ? `${a}:${b}` : `${b}:${a}`);

export interface GenerateOptions {
  lateBonus?: number; // extra late-game items (personalization: long games)
}

export function generateBuilds(hero: Hero, catalog: Item[], analytics: HeroAnalytics, opts: GenerateOptions = {}): { builds: Build[]; kit: KitProfile } {
  const kit = kitProfile(hero);
  const byId = new Map(catalog.map((i) => [i.id, i]));
  const stats = analytics.itemStats.filter((s) => byId.get(s.item_id)?.shopable && byId.get(s.item_id)?.cost);
  const totalW = stats.reduce((a, s) => a + s.wins, 0);
  const totalM = stats.reduce((a, s) => a + s.matches, 0) || 1;
  const heroWR = totalW / totalM;
  // Proxy for number of games on the hero: the most-bought item is bought in almost every game.
  const heroGames = Math.max(1, ...stats.map((s) => s.matches));

  const pair = new Map<string, number>();
  for (const p of analytics.perms) {
    if (p.item_ids.length !== 2) continue;
    const wr = (p.wins + WR_PRIOR_MATCHES * heroWR) / (p.matches + WR_PRIOR_MATCHES);
    pair.set(pairKey(p.item_ids[0], p.item_ids[1]), wr - heroWR);
  }

  // Max stat value per tier, for normalising stat-per-soul within a tier.
  const rawStat = (item: Item, arch: Archetype) =>
    statLines(item).reduce((a, l) => a + l.weight * arch.catWeight[l.cat], 0) / Math.sqrt(item.cost / 800);

  const eligible: { item: Item; st: ItemStat }[] = stats
    .filter((s) => s.matches / heroGames >= MIN_MATCH_SHARE)
    .map((s) => ({ item: byId.get(s.item_id)!, st: s }))
    .sort((a, b) => a.item.id - b.item.id);

  const phases = PHASES.map((p) => {
    const bought = stats.filter((s) => s.avg_buy_time_s >= p.fromS && s.avg_buy_time_s < p.toS).reduce((a, s) => a + s.matches, 0) / heroGames;
    const count = Math.max(MIN_PHASE_ITEMS, Math.min(MAX_PHASE_ITEMS, Math.round(bought)));
    return { ...p, count: count + (p.phase === 'late' ? opts.lateBonus ?? 0 : 0) };
  });

  // Which style to lead with: whichever slot high-skill players spend more souls on
  // for this hero (aggregate data). The kit check is only a fallback.
  let weaponSouls = 0, spiritSouls = 0;
  for (const { item, st } of eligible) {
    if (item.item_slot_type === 'weapon') weaponSouls += st.matches * item.cost;
    if (item.item_slot_type === 'spirit') spiritSouls += st.matches * item.cost;
  }
  const arches = archetypes(kit).sort((a, b) =>
    weaponSouls === spiritSouls ? 0 : (a.key === (spiritSouls > weaponSouls ? 'spirit' : 'gun') ? -1 : b.key === (spiritSouls > weaponSouls ? 'spirit' : 'gun') ? 1 : 0));

  const builds = arches.map((arch): Build => {
    const maxStat = new Map<number, number>();
    for (const { item } of eligible) maxStat.set(item.item_tier, Math.max(maxStat.get(item.item_tier) ?? 0, rawStat(item, arch)));

    const base = (item: Item, st: ItemStat, centerS: number) => {
      const wr = (st.wins + WR_PRIOR_MATCHES * heroWR) / (st.matches + WR_PRIOR_MATCHES);
      const pick = st.matches / heroGames;
      // An item bought in nearly every game has no "games without it" to compare
      // against, so its win-rate delta carries no signal. Fade it toward neutral.
      const wrN = clamp01(0.5 + (1 - clamp01(pick)) * (wr - heroWR) / (2 * WR_SPREAD));
      const usageN = Math.sqrt(clamp01(pick));
      const statN = (maxStat.get(item.item_tier) ?? 0) > 0 ? rawStat(item, arch) / maxStat.get(item.item_tier)! : 0;
      const slotN = arch.slotWeight[item.item_slot_type] ?? 0;
      const lines = statLines(item);
      let kitN = 0;
      const reasons: string[] = [];
      if (lines.some((l) => l.cat === 'fireRate') && kit.onHit) { kitN += 0.6; reasons.push('Fire rate feeds on-hit ability'); }
      if (lines.some((l) => l.cat === 'spirit')) kitN += 0.6 * kit.spiritScaling + 0.2 * clamp01(kit.spiritGrowth / 2);
      if (lines.some((l) => l.cat === 'gun')) kitN += 0.6 * (1 - kit.spiritScaling) + 0.2 * clamp01(kit.gunGrowth * 10);
      kitN = clamp01(kitN);
      const phaseN = clamp01(1 - Math.abs(st.avg_buy_time_s - centerS) / 1200);
      const activeN = item.is_active_item ? 1 : 0;
      const score =
        WEIGHTS.winRate * wrN + WEIGHTS.usage * usageN + WEIGHTS.statValue * statN + WEIGHTS.slotFit * slotN +
        WEIGHTS.kit * kitN + WEIGHTS.phase * phaseN + WEIGHTS.active * activeN;
      if (wr - heroWR > 0.01) reasons.push(`+${((wr - heroWR) * 100).toFixed(1)}pp win rate vs hero avg`);
      if (pick > 0.4) reasons.push(`Bought in ${Math.round(pick * 100)}% of games`);
      if (statN > 0.8) reasons.push('Top stat value per soul in its tier');
      if (item.is_active_item) reasons.push('Active item');
      return { score, wr, pick, reasons };
    };

    const chosen: BuildItem[] = [];
    const taken = new Set<number>();
    let actives = 0;
    let souls = 0;
    for (const ph of phases) {
      const picked: BuildItem[] = [];
      for (let n = 0; n < ph.count; n++) {
        let best: (BuildItem & { total: number }) | null = null;
        for (const { item, st } of eligible) {
          if (taken.has(item.id) || !ph.tiers.includes(item.item_tier)) continue;
          if (item.is_active_item && actives >= MAX_ACTIVES) continue;
          const b = base(item, st, ph.centerS);
          let lift = 0;
          if (chosen.length + picked.length) {
            const all = [...chosen, ...picked];
            lift = all.reduce((a, c) => a + (pair.get(pairKey(item.id, c.item.id)) ?? 0), 0) / all.length;
          }
          const total = b.score + WEIGHTS.pairSynergy * clamp01(0.5 + lift / (2 * WR_SPREAD));
          if (!best || total > best.total + 1e-12 || (Math.abs(total - best.total) <= 1e-12 && item.id < best.item.id)) {
            best = { item, phase: ph.phase, score: total, total, winRate: b.wr, pickRate: b.pick, avgBuyMin: st.avg_buy_time_s / 60, runningSouls: 0, reasons: b.reasons };
          }
        }
        if (!best) break;
        taken.add(best.item.id);
        if (best.item.is_active_item) actives++;
        picked.push(best);
      }
      // Within a phase, buy in the order high-skill players actually buy them.
      picked.sort((a, b) => a.avgBuyMin - b.avgBuyMin || a.item.id - b.item.id);
      for (const p of picked) { souls += p.item.cost; p.runningSouls = souls; }
      chosen.push(...picked);
    }
    const ab = abilityOrder(hero, analytics, heroWR);
    return { key: arch.key, name: arch.name, blurb: arch.blurb, items: chosen, ...ab };
  });
  return { builds, kit };
}

function abilityOrder(hero: Hero, analytics: HeroAnalytics, heroWR: number) {
  const abil = new Map(hero.abilities.map((a) => [a.id, a]));
  let best = null as null | { s: number; o: (typeof analytics.abilityOrders)[number] };
  for (const o of analytics.abilityOrders) {
    if (!o.abilities.every((id) => abil.has(id))) continue;
    const wr = (o.wins + 50 * heroWR) / (o.matches + 50);
    // Reward win rate, with diminishing credit for popularity.
    const s = wr + 0.01 * Math.log10(o.matches);
    if (!best || s > best.s || (s === best.s && o.abilities.join() < best.o.abilities.join())) best = { s, o };
  }
  const seq = best?.o.abilities ?? fallbackOrder(hero);
  const counts = new Map<number, number>();
  const abilitySteps: AbilityStep[] = seq.map((id, i) => {
    const c = counts.get(id) ?? 0;
    counts.set(id, c + 1);
    return { level: i + 1, ability: abil.get(id)!, kind: c === 0 ? 'unlock' : 'upgrade', tier: c };
  });
  return {
    abilitySteps,
    abilityOrderMatches: best?.o.matches ?? 0,
    abilityOrderWinRate: best ? best.o.wins / best.o.matches : 0,
  };
}

function fallbackOrder(hero: Hero): number[] {
  const ids = hero.abilities.map((a) => a.id);
  return [...ids, ...ids, ...ids, ...ids];
}
