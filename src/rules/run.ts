import { HAND_COUNT, REROLL_COUNT } from '../config';
import { COMBOS, type ComboId, type ComboLevels } from './combos';
import { ownRelic, RARITY_WEIGHT, RELICS, sellValue, type OwnedRelic, type RelicDef } from './relics';
import { Rng } from './rng';

export const NIGHTS = 7;
export const ECHEANCES_PER_NIGHT = 3;
export const MAX_RELICS = 5;
export const STARTING_COINS = 4;

/** Objectifs de base par nuit (3 échéances, la dernière est le boss). Voir la courbe du GDD. */
const TARGETS: number[][] = [
  [300, 450, 600],
  [800, 1200, 1600],
  [2000, 3000, 4000],
  [5000, 7500, 10000],
  [11000, 16500, 22000],
  [20000, 30000, 40000],
  [35000, 50000, 66600],
];

const ECHEANCE_REWARD = [3, 4, 5];
const INTEREST_STEP = 5;
const INTEREST_CAP = 5;
const CONTRACT_DEBT = 1.1;
const REROLL_BASE = 5;
const GRAVURE_PRICE = 3;

export interface Earnings {
  echeance: number;
  hands: number;
  interest: number;
  relics: number;
  total: number;
}

export type ShopItem =
  | { kind: 'relic'; def: RelicDef; price: number }
  | { kind: 'gravure'; combo: ComboId; price: number };

/** État d'une run, sans rendu : nuits, dette, pièces, reliques, niveaux des combinaisons. */
export class RunState {
  readonly rng: Rng;
  night = 1;
  echeance = 0;
  coins = STARTING_COINS;
  relics: OwnedRelic[] = [];
  levels: ComboLevels = {};
  debtMultiplier = 1;

  score = 0;
  hands = HAND_COUNT;
  rerolls = REROLL_COUNT;
  handsPlayed = 0;

  shop: (ShopItem | null)[] = [];
  rerollCost = REROLL_BASE;

  constructor(seed = Math.floor(Math.random() * 2 ** 31)) {
    this.rng = new Rng(seed);
  }

  get target() {
    return Math.round(TARGETS[this.night - 1][this.echeance] * this.debtMultiplier);
  }

  get isBoss() {
    return this.echeance === ECHEANCES_PER_NIGHT - 1;
  }

  get isFinal() {
    return this.night === NIGHTS && this.isBoss;
  }

  has(id: string) {
    return this.relics.some((r) => r.def.id === id);
  }

  startEcheance() {
    this.score = 0;
    this.hands = HAND_COUNT;
    this.rerolls = REROLL_COUNT;
    this.handsPlayed = 0;
  }

  /** Gains d'une échéance réussie : récompense, mains non jouées, intérêts, reliques. */
  earnings(): Earnings {
    const echeance = ECHEANCE_REWARD[this.echeance];
    const hands = this.hands;
    const interest = Math.min(INTEREST_CAP, Math.floor(this.coins / INTEREST_STEP));
    const relics = this.relics.reduce((sum, r) => sum + (r.def.onEcheanceEnd?.(r.state) ?? 0), 0);
    return { echeance, hands, interest, relics, total: echeance + hands + interest + relics };
  }

  /** Passe à l'échéance suivante ; une nouvelle nuit applique la hausse du Contrat. */
  advance() {
    this.echeance++;
    if (this.echeance >= ECHEANCES_PER_NIGHT) {
      this.echeance = 0;
      this.night++;
      if (this.has('leContrat')) this.debtMultiplier *= CONTRACT_DEBT;
    }
    this.startEcheance();
  }

  // ---------------------------------------------------------------- boutique

  openShop() {
    this.rerollCost = REROLL_BASE;
    this.rollShop();
  }

  rerollShop(): boolean {
    if (this.coins < this.rerollCost) return false;
    this.coins -= this.rerollCost;
    this.rerollCost++;
    this.rollShop();
    return true;
  }

  private rollShop() {
    const relicSlots = this.has('cleRouillee') ? 3 : 2;
    const items: ShopItem[] = [];
    const taken = new Set(this.relics.map((r) => r.def.id));
    for (let i = 0; i < relicSlots; i++) {
      const pool = RELICS.filter((d) => !taken.has(d.id));
      if (pool.length === 0) break;
      const def = this.rng.weighted(pool, pool.map((d) => RARITY_WEIGHT[d.rarity]));
      taken.add(def.id);
      items.push({ kind: 'relic', def, price: def.price });
    }
    const combos = Object.keys(COMBOS) as ComboId[];
    for (let i = 0; i < 2; i++) items.push({ kind: 'gravure', combo: this.rng.pick(combos), price: GRAVURE_PRICE });
    this.shop = items;
  }

  canBuy(index: number) {
    const item = this.shop[index];
    if (!item || this.coins < item.price) return false;
    return item.kind !== 'relic' || this.relics.length < MAX_RELICS;
  }

  buy(index: number): ShopItem | null {
    const item = this.shop[index];
    if (!item || !this.canBuy(index)) return null;
    this.coins -= item.price;
    if (item.kind === 'relic') this.relics.push(ownRelic(item.def));
    else this.levels[item.combo] = (this.levels[item.combo] ?? 1) + 1;
    this.shop[index] = null;
    return item;
  }

  sell(index: number) {
    const relic = this.relics[index];
    if (!relic) return;
    this.coins += sellValue(relic.def);
    this.relics.splice(index, 1);
  }

  moveRelic(index: number, delta: number) {
    const to = index + delta;
    if (to < 0 || to >= this.relics.length) return;
    const [r] = this.relics.splice(index, 1);
    this.relics.splice(to, 0, r);
  }
}
