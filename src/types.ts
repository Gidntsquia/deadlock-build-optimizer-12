export interface ItemProp {
  value?: string | number;
  label?: string;
  postfix?: string;
  prefix?: string;
  css_class?: string;
  scale_function?: { specific_stat_scale_type?: string; scaling_stats?: string[] };
}
export interface TooltipAttr {
  loc_string?: string;
  properties?: string[];
  important_properties?: string[];
  elevated_properties?: string[];
}
export interface Item {
  id: number;
  name: string;
  class_name: string;
  shopable?: boolean;
  disabled?: boolean | null;
  cost: number;
  item_tier: number;
  item_slot_type: 'weapon' | 'vitality' | 'spirit';
  is_active_item?: boolean;
  shop_image_webp?: string;
  image_webp?: string;
  properties?: Record<string, ItemProp>;
  description?: { desc?: string; active?: string; passive?: string } | null;
  tooltip_sections?: { section_type?: string; section_attributes?: TooltipAttr[] }[];
}
export interface Ability {
  id: number;
  class_name: string;
  name: string;
  description?: { desc?: string } | null;
  properties?: Record<string, ItemProp>;
}
export interface Hero {
  id: number;
  name: string;
  class_name: string;
  starting_stats: Record<string, { value: number }>;
  standard_level_up_upgrades: Record<string, number>;
  abilities: Ability[];
}
export interface ItemStat {
  item_id: number;
  wins: number;
  losses: number;
  matches: number;
  players: number;
  avg_buy_time_s: number;
}
export interface AbilityOrderStat {
  abilities: number[];
  wins: number;
  losses: number;
  matches: number;
}
export interface PermStat {
  item_ids: number[];
  wins: number;
  losses: number;
  matches: number;
}
export interface HeroAnalytics {
  hero_id: number;
  fetched_at: string;
  itemStats: ItemStat[];
  abilityOrders: AbilityOrderStat[];
  perms: PermStat[];
}

export type Phase = 'early' | 'mid' | 'late';
export interface BuildItem {
  item: Item;
  phase: Phase;
  score: number;
  winRate: number;
  pickRate: number;
  avgBuyMin: number;
  runningSouls: number;
  reasons: string[];
}
export interface AbilityStep {
  level: number;
  ability: Ability;
  kind: 'unlock' | 'upgrade';
  tier: number; // 0 = unlock, 1..3 = upgrade tier
}
export interface Build {
  key: string;
  name: string;
  blurb: string;
  items: BuildItem[];
  abilitySteps: AbilityStep[];
  abilityOrderMatches: number;
  abilityOrderWinRate: number;
}
