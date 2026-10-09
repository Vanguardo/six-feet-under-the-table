import { HAND_COUNT, REROLL_COUNT } from '../config';
import { Body } from './body';
import { BOSS_POOL, BOSSES, type Boss } from './bosses';
import { COMBOS, type ComboId, type ComboLevels } from './combos';
import { DIE_TYPES, FACE_MODS, newDie, type DieTypeId, type FaceModId, type OwnedDie } from './dice';
import { ownRelic, RARITY_WEIGHT, RELICS, sellValue, type OwnedRelic, type RelicDef } from './relics';
import { Rng } from './rng';

export const NIGHTS = 7;
export const ECHEANCES_PER_NIGHT = 3;
export const MAX_RELICS = 5;
export const STARTING_COINS = 4;
export const BASE_DICE = 5;

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
const BLOOD_DEBT = 1.02;
const REROLL_BASE = 5;
const GRAVURE_PRICE = 3;
const TOOTH_COINS = 8;
const BLANK_PACT_COINS = 20;
const TONGUE_TAX = 1.3;

const SHOP_DICE: DieTypeId[] = ['ecrase', 'noirci', 'ivoire', 'pipe', 'verre', 'plomb', 'maudit'];
const SHOP_MODS = Object.keys(FACE_MODS) as FaceModId[];

export interface Earnings {
  echeance: number;
  hands: number;
  interest: number;
  relics: number;
  total: number;
}

export type ShopItem =
  | { kind: 'relic'; def: RelicDef; price: number }
  | { kind: 'gravure'; combo: ComboId; price: number }
  | { kind: 'die'; type: DieTypeId; price: number }
  | { kind: 'burin'; mod: FaceModId; price: number };

/** Un article qui demande de choisir un dé (et une face pour un burin). */
export const needsTarget = (item: ShopItem) => item.kind === 'die' || item.kind === 'burin';

/** État d'une run, sans rendu : nuits, dette, pièces, reliques, dés, corps. */
export class RunState {
  readonly rng: Rng;
  night = 1;
  echeance = 0;
  coins = STARTING_COINS;
  relics: OwnedRelic[] = [];
  levels: ComboLevels = {};
  debtMultiplier = 1;
  readonly body = new Body();
  dice: OwnedDie[] = Array.from({ length: BASE_DICE }, () => newDie());
  /** Boss de chaque nuit, tirés au début de la run. */
  readonly bosses: Boss[];

  score = 0;
  hands = HAND_COUNT;
  rerolls = REROLL_COUNT;
  handsPlayed = 0;
  /** Dette supplémentaire de l'échéance en cours (faces sanglantes). */
  bleed = 1;
  /** Dé confisqué par le Boucher pour l'échéance, ou -1. */
  confiscated = -1;
  /** ×mult de la prochaine main, gagné par les 0 des dés maudits. */
  curse = 1;
  /** Combinaisons déjà jouées dans l'échéance (Le Jumeau, Chien de faïence). */
  played: ComboId[] = [];
  /** Le cœur a été donné : la run s'arrête à la fin de cette nuit. */
  lastNight = 0;
  /** Une dent vient d'être arrachée : la prochaine boutique propose le dé taillé dedans. */
  toothDie = false;
  /** Nuit du dernier pacte : le créancier ne négocie qu'une fois par nuit. */
  pactNight = 0;

  shop: (ShopItem | null)[] = [];
  rerollCost = REROLL_BASE;

  constructor(seed = Math.floor(Math.random() * 2 ** 31)) {
    this.rng = new Rng(seed);
    const pool = [...BOSS_POOL];
    this.bosses = Array.from({ length: NIGHTS }, (_, n) => {
      if (n === NIGHTS - 1) return BOSSES.creancier;
      return BOSSES[pool.splice(this.rng.int(pool.length), 1)[0]];
    });
    this.startEcheance();
  }

  get target() {
    return Math.round(TARGETS[this.night - 1][this.echeance] * this.debtMultiplier * this.bleed);
  }

  get isBoss() {
    return this.echeance === ECHEANCES_PER_NIGHT - 1;
  }

  get isFinal() {
    return this.night === NIGHTS && this.isBoss;
  }

  /** Le boss actif, seulement pendant la troisième échéance de la nuit. */
  get boss(): Boss | null {
    return this.isBoss ? this.bosses[this.night - 1] : null;
  }

  bossIs(id: Boss['id']) {
    return this.boss?.id === id;
  }

  has(id: string) {
    return this.relics.some((r) => r.def.id === id);
  }

  /** Relances de l'échéance : chaque doigt perdu en retire une. */
  get maxRerolls() {
    return Math.max(0, REROLL_COUNT - this.body.fingers - (this.has('coeurDansUnBocal') ? 2 : 0));
  }

  /** Dés lancés cette échéance (indices dans `dice`). */
  activeDice(): number[] {
    let count = BASE_DICE + (this.has('sixiemeDoigt') ? 1 : 0) - (this.body.hand ? 1 : 0);
    count = Math.min(count, this.dice.length);
    return [...Array(count).keys()].filter((i) => i !== this.confiscated);
  }

  startEcheance() {
    this.score = 0;
    this.hands = HAND_COUNT;
    this.rerolls = this.maxRerolls;
    this.handsPlayed = 0;
    this.bleed = 1;
    this.curse = 1;
    this.played = [];
    this.confiscated = -1;
    // Le Boucher confisque un dé au hasard (sauf un dé en plomb, qu'il ne peut pas soulever).
    if (this.bossIs('boucher')) {
      const candidates = this.activeDice().filter((i) => this.dice[i].type !== 'plomb');
      if (candidates.length > 1) this.confiscated = this.rng.pick(candidates);
    }
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

  /** Un pacte est-il encore possible cette nuit ? */
  get canPact() {
    return this.pactNight !== this.night && this.boss?.pact !== 'mort' && this.body.available().length > 0;
  }

  addBleed(faces: number) {
    this.bleed *= BLOOD_DEBT ** faces;
  }

  // ---------------------------------------------------------------- pactes

  /** Signe un pacte : l'échéance est payée, sans gains. */
  signPact(part: Parameters<Body['take']>[0]) {
    this.body.take(part);
    this.pactNight = this.night;
    if (part === 'dent') {
      this.coins += TOOTH_COINS;
      this.toothDie = true;
    }
    if (part === 'coeur') this.lastNight = this.night;
    if (this.has('pacteEnBlanc')) this.coins += BLANK_PACT_COINS;
    // Les relances perdues comptent tout de suite.
    this.rerolls = Math.min(this.rerolls, this.maxRerolls);
  }

  // ---------------------------------------------------------------- boutique

  private price(base: number) {
    return Math.ceil(base * (this.body.tongue ? TONGUE_TAX : 1));
  }

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
      items.push({ kind: 'relic', def, price: this.price(def.price) });
    }
    const combos = Object.keys(COMBOS) as ComboId[];
    items.push({ kind: 'gravure', combo: this.rng.pick(combos), price: this.price(GRAVURE_PRICE) });
    // Un dé ou un burin, au hasard ; la dent arrachée revient toujours sous forme de dé.
    if (this.toothDie) {
      items.push({ kind: 'die', type: 'dent', price: 0 });
      this.toothDie = false;
    } else if (this.rng.next() < 0.5) {
      const type = this.rng.pick(SHOP_DICE);
      items.push({ kind: 'die', type, price: this.price(DIE_TYPES[type].price) });
    } else {
      const mod = this.rng.pick(SHOP_MODS);
      items.push({ kind: 'burin', mod, price: this.price(FACE_MODS[mod].price) });
    }
    this.shop = items;
  }

  canBuy(index: number) {
    const item = this.shop[index];
    if (!item || this.coins < item.price) return false;
    return item.kind !== 'relic' || this.relics.length < MAX_RELICS;
  }

  /**
   * Achète un article. Les dés remplacent le dé `die` ; les burins gravent sa face `face`.
   * Renvoie l'article acheté, ou null si l'achat est impossible.
   */
  buy(index: number, die = -1, face = -1): ShopItem | null {
    const item = this.shop[index];
    if (!item || !this.canBuy(index)) return null;
    if (item.kind === 'die' && !this.dice[die]) return null;
    if (item.kind === 'burin' && (!this.dice[die] || face < 0 || face > 5)) return null;
    this.coins -= item.price;
    switch (item.kind) {
      case 'relic':
        this.relics.push(ownRelic(item.def));
        break;
      case 'gravure':
        this.levels[item.combo] = (this.levels[item.combo] ?? 1) + 1;
        break;
      case 'die':
        this.dice[die] = newDie(item.type);
        break;
      case 'burin':
        this.dice[die].mods[face] = item.mod;
        break;
    }
    this.shop[index] = null;
    return item;
  }

  canSell(index: number) {
    return this.relics[index]?.def.rarity !== 'maudite';
  }

  sell(index: number) {
    const relic = this.relics[index];
    if (!relic || !this.canSell(index)) return;
    this.coins += sellValue(relic.def, this.has('couteauABeurre'));
    this.relics.splice(index, 1);
  }

  moveRelic(index: number, delta: number) {
    const to = index + delta;
    if (to < 0 || to >= this.relics.length) return;
    const [r] = this.relics.splice(index, 1);
    this.relics.splice(to, 0, r);
  }

  /** Niveaux effectifs des combinaisons (Sourire cousu : +1 partout). */
  effectiveLevels(): ComboLevels {
    if (!this.has('sourireCousu')) return this.levels;
    const out: ComboLevels = {};
    for (const id of Object.keys(COMBOS) as ComboId[]) out[id] = (this.levels[id] ?? 1) + 1;
    return out;
  }
}
