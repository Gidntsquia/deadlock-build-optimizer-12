import itemsJson from '../data/items.json';
import heroesJson from '../data/heroes.json';
import type { Hero, HeroAnalytics, Item } from './types';

export const items = itemsJson as unknown as Item[];
export const heroes = (heroesJson as unknown as Hero[]).slice().sort((a, b) => a.name.localeCompare(b.name));
const analyticsFiles = import.meta.glob<HeroAnalytics>('../data/analytics/*.json', { import: 'default' });

export async function loadAnalytics(heroId: number): Promise<HeroAnalytics> {
  const f = analyticsFiles[`../data/analytics/${heroId}.json`];
  if (!f) throw new Error(`No analytics snapshot for hero ${heroId}`);
  return f();
}
export const itemImg = (id: number) => `${import.meta.env.BASE_URL}img/items/${id}.webp`;
export const heroImg = (id: number) => `${import.meta.env.BASE_URL}img/heroes/${id}.webp`;
export const abilityImg = (id: number) => `${import.meta.env.BASE_URL}img/abilities/${id}.webp`;
