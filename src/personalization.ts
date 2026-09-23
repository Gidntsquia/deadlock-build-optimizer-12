// Light personalization from the user's own match history (account 267836488).
import user from '../data/user.json';

export interface Insight { games: number; medianMin: number; lateBonus: number; heroGames: number; heroWinRate: number | null; text: string }

export function userInsight(heroId: number): Insight {
  const ms = (user as { matches: { hero_id: number; duration_s: number; result: number }[] }).matches;
  const d = ms.map((m) => m.duration_s).sort((a, b) => a - b);
  const medianMin = d.length ? d[Math.floor(d.length / 2)] / 60 : 30;
  // Long games leave time for one more late-game item.
  const lateBonus = medianMin >= 32 ? 1 : 0;
  const hero = ms.filter((m) => m.hero_id === heroId);
  const heroWinRate = hero.length ? hero.filter((m) => m.result).length / hero.length : null;
  const text = `Your median game lasts ${medianMin.toFixed(0)} min over ${ms.length} matchmaking games, so this build plans ${lateBonus ? 'one extra' : 'no extra'} late-game item.` +
    (hero.length ? ` You've played this hero ${hero.length} times (${Math.round(heroWinRate! * 100)}% wins).` : '');
  return { games: ms.length, medianMin, lateBonus, heroGames: hero.length, heroWinRate, text };
}
