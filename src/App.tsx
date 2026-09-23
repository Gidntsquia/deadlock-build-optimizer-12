import { useEffect, useMemo, useState } from 'react';
import { abilityImg, heroes, heroImg, itemImg, items, loadAnalytics } from './data';
import { generateBuilds, type KitProfile } from './generator';
import { userInsight } from './personalization';
import { CORE_THRESHOLD, validate, type Validation } from './validation';
import type { Build, HeroAnalytics, Item, Phase } from './types';

const INFERNUS = 1;
const PHASE_LABEL: Record<Phase, string> = { early: 'Early game', mid: 'Mid game', late: 'Late game' };
const souls = (n: number) => n.toLocaleString('en-US');

export default function App() {
  const [heroId, setHeroId] = useState(INFERNUS);
  const [analytics, setAnalytics] = useState<HeroAnalytics | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<Item | null>(null);
  const hero = heroes.find((h) => h.id === heroId)!;

  useEffect(() => {
    let live = true;
    setAnalytics(null);
    setError(null);
    loadAnalytics(heroId).then((a) => live && setAnalytics(a), (e) => live && setError(String(e)));
    return () => { live = false; };
  }, [heroId]);

  const insight = useMemo(() => userInsight(heroId), [heroId]);
  const result = useMemo(
    () => (analytics ? generateBuilds(hero, items, analytics, { lateBonus: insight.lateBonus }) : null),
    [analytics, hero, insight.lateBonus],
  );
  // Validation runs strictly after generation, on its output. Infernus only.
  const validation = useMemo(() => (result && heroId === INFERNUS ? validate(result.builds) : null), [result, heroId]);
  // One build: the style the hero's kit leans toward (generator lists it first).
  const build = result?.builds[0];

  return (
    <div className="app">
      <header className="top">
        <h1>Deadlock Build Optimizer</h1>
        <label className="picker">
          <img src={heroImg(heroId)} alt="" width={40} height={40} />
          <select value={heroId} onChange={(e) => { setHeroId(Number(e.target.value)); }} aria-label="Hero">
            {heroes.map((h) => <option key={h.id} value={h.id}>{h.name}</option>)}
          </select>
        </label>
      </header>

      {error && <p className="error">{error}</p>}
      {!result && !error && <p className="muted">Loading…</p>}

      {result && build && (
        <>
          <h2 className="buildname">{build.name}</h2>
          <p className="blurb">{build.blurb}</p>

          <BuildList build={build} validation={validation} onOpen={setOpen} />
          <AbilityOrder build={build} />
          <KitCard kit={result.kit} analytics={analytics!} />
          {validation && <ValidationCard v={validation} build={build} />}
        </>
      )}
      {open && <ItemCard item={open} onClose={() => setOpen(null)} />}
    </div>
  );
}

function ValidationCard({ v, build }: { v: Validation; build: Build }) {
  const r = v.perBuild[build.key];
  return (
    <section className="card validation">
      <h2>How well did the generator do?</h2>
      <div className="agree">
        <strong>{Math.round(r.agreement * 100)}%</strong>
        <span>agreement with Zergggy's core Infernus items</span>
      </div>
      <p className="muted small">
        Held-out check, not an input. Core set = items in ≥{CORE_THRESHOLD * 100}% of his last {v.sampleSize} matchmaking
        Infernus games (wins weighted 1.5×); rarer items are treated as experiments and ignored. This build contains {r.shared} of {v.core.length} core items
        ({Math.round(r.overlap * 100)}% overlap) with {Math.round(r.order * 100)}% buy-order agreement.
      </p>
    </section>
  );
}

const ROMAN = ['', 'I', 'II', 'III', 'IV'];
const PHASE_ROWS: { label: string; phases: Phase[] }[] = [
  { label: 'Early Game', phases: ['early'] },
  { label: 'Mid Game', phases: ['mid'] },
  { label: 'Late Game', phases: ['late'] },
];

function BuildList({ build, validation, onOpen }: { build: Build; validation: Validation | null; onOpen: (i: Item) => void }) {
  const coreIds = validation?.perBuild[build.key].coreIds;
  return (
    <section className="shop">
      {PHASE_ROWS.map((row) => {
        const list = build.items.filter((b) => row.phases.includes(b.phase));
        const spent = list.reduce((t, b) => t + b.item.cost, 0);
        return (
          <div key={row.label} className="shelf">
            <h3><span>{row.label}</span><span className="spent">{souls(spent)} souls</span></h3>
            <ol className="tiles">
              {list.map((b) => (
                <li key={b.item.id}>
                  <button className={`tile slot-${b.item.item_slot_type}`} onClick={() => onOpen(b.item)}
                    title={`${b.item.name}: ${souls(b.item.cost)} souls, ${(b.winRate * 100).toFixed(1)}% win rate`}>
                    <span className="art">
                      <img src={itemImg(b.item.id)} alt="" loading="lazy" />
                      <span className="flag">{ROMAN[b.item.item_tier]}</span>
                      {b.item.is_active_item && <span className="tag">Active</span>}
                      {coreIds && coreIds.has(b.item.id) && <span className="core" aria-label="Core for Zergggy">★</span>}
                    </span>
                    <span className="label">{b.item.name}</span>
                    <span className="cost">{souls(b.item.cost)}</span>
                  </button>
                </li>
              ))}
            </ol>
          </div>
        );
      })}
      <p className="shopnote">
        {build.items.length} items, {souls(build.items.at(-1)?.runningSouls ?? 0)} souls in buy order, left to right.
        {coreIds && ' ★ marks items in Zergggy\'s core set.'} Tap an item for its stats.
      </p>
    </section>
  );
}

// In-game upgrade costs for tiers 1–3.
const TIER_COST = [0, 1, 2, 5];

function AbilityOrder({ build }: { build: Build }) {
  const abilities = [...new Map(build.abilitySteps.map((s) => [s.ability.id, s.ability])).values()];
  const cols = build.abilitySteps.length;
  return (
    <section className="apo">
      <h2>Ability Point Order</h2>
      <div className="apo-scroll">
        <div className="apo-grid" style={{ ['--cols' as string]: cols }}>
          {abilities.map((a) => (
            <div key={a.id} className="apo-row">
              <img className="apo-icon" src={abilityImg(a.id)} alt={a.name} title={a.name} />
              {build.abilitySteps.map((s, i) =>
                s.ability.id === a.id ? (
                  <span key={s.level} className={`pip ${s.kind}`} style={{ gridColumn: i + 2 }} title={`Point ${s.level}: ${s.kind === 'unlock' ? 'unlock' : `tier ${s.tier}`} ${a.name}`}>
                    {s.kind === 'unlock' ? <span className="bolt">ϟ</span> : <><span className="gem">◆</span>{TIER_COST[s.tier]}</>}
                  </span>
                ) : null,
              )}
            </div>
          ))}
        </div>
      </div>
      <ol className="apo-names">{abilities.map((a) => <li key={a.id}>{a.name}</li>)}</ol>
      <p className="apo-note">
        {build.abilityOrderMatches ? `Best-scoring order from ${souls(build.abilityOrderMatches)} high-skill games (${(build.abilityOrderWinRate * 100).toFixed(1)}% win rate).` : 'No order data for this hero; default rotation.'}
        {' '}ϟ unlocks the ability; ◆ numbers are the point cost of each upgrade.
      </p>
    </section>
  );
}

function KitCard({ kit, analytics }: { kit: KitProfile; analytics: HeroAnalytics }) {
  return (
    <section className="card">
      <h2>Why these items</h2>
      <ul className="small">{kit.notes.map((n) => <li key={n}>{n}</li>)}</ul>
      <p className="muted small">Source: deadlock-api aggregate analytics (badge ≥ 90, last 30 days), snapshot {analytics.fetched_at.slice(0, 10)}.</p>
    </section>
  );
}

const clean = (s?: string) => (s ?? '').replace(/<svg[\s\S]*?<\/svg>/g, '').replace(/\s+/g, ' ').replace(/<br\s*\/?>/g, '\n').replace(/<[^>]+>/g, '').replace(/\{[^}]*\}/g, '').trim();

function propLine(item: Item, key: string) {
  const p = item.properties?.[key];
  if (!p || p.value === undefined || Number(p.value) === 0 || !p.label) return null;
  const v = String(p.value);
  const sign = Number(v) > 0 && !p.prefix && (p.postfix === '%' || /Bonus|Percent/.test(key)) ? '+' : '';
  return `${p.prefix ?? ''}${sign}${v}${p.postfix ?? ''} ${p.label}`.replace('{s:sign}', '');
}

function ItemCard({ item, onClose }: { item: Item; onClose: () => void }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [onClose]);
  return (
    <div className="overlay" onClick={onClose}>
      <div className={`detail slot-${item.item_slot_type}`} role="dialog" aria-label={item.name} onClick={(e) => e.stopPropagation()}>
        <button className="close" onClick={onClose} aria-label="Close">✕</button>
        <div className="dhead">
          <img src={itemImg(item.id)} alt={item.name} width={72} height={72} />
          <div>
            <h2>{item.name}</h2>
            <div className="chips">
              <span className="chip">{souls(item.cost)} souls</span>
              <span className="chip">Tier {item.item_tier}</span>
              <span className={`chip slotchip-${item.item_slot_type}`}>{item.item_slot_type}</span>
              {item.is_active_item && <span className="chip">Active</span>}
            </div>
          </div>
        </div>
        {(item.tooltip_sections ?? []).map((sec, i) => (
          <div key={i} className="sec">
            <h4>{sec.section_type ?? 'stats'}</h4>
            {(sec.section_attributes ?? []).map((a, j) => {
              const keys = [...(a.elevated_properties ?? []), ...(a.important_properties ?? []), ...(a.properties ?? [])];
              return (
                <div key={j}>
                  {a.loc_string && <p>{clean(a.loc_string)}</p>}
                  <ul>{keys.map((k) => { const l = propLine(item, k); return l ? <li key={k}>{l}</li> : null; })}</ul>
                </div>
              );
            })}
          </div>
        ))}
        {!item.tooltip_sections?.length && item.description?.desc && <p>{clean(item.description.desc)}</p>}
      </div>
    </div>
  );
}
