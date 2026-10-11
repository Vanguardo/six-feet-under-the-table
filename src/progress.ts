import type { Lang } from './i18n';
import type { BodyPartId } from './rules/body';
import { CUPS, MAX_STAKE, type CupId } from './rules/cups';
import { RELICS } from './rules/relics';

// Sauvegarde locale (navigateur) : réglages, statistiques, déblocages, découvertes.
// Tout est entouré de try/catch : en navigation privée, le jeu marche sans sauvegarde.

const KEY = 'sixfeet.save.v1';

export interface Settings {
  lang: Lang;
  softGore: boolean;
  /** Accessibilité : un clic sur le gobelet lance les dés. */
  simpleThrow?: boolean;
  volume: number;
}

export interface Stats {
  runs: number;
  wins: number;
  bestNight: number;
  hands: number;
  pacts: number;
  relicsSold: number;
  bossesBeaten: number;
  fives: number;
  /** Parties du corps prises, toutes runs confondues (le registre du créancier). */
  taken: Record<BodyPartId, number>;
}

interface SaveData {
  settings: Settings;
  tutorialDone: boolean;
  /** Le doigt perdu au tutoriel manque pendant la toute première run. */
  tutorialFinger: boolean;
  stats: Stats;
  cups: Partial<Record<CupId, number>>;
  relics: string[];
  seen: string[];
}

/** Reliques disponibles dès le départ ; les autres se gagnent. */
const STARTING_RELICS = [
  'dentEnOr', 'mainCoupee', 'chapelet', 'megot', 'ticketFroisse', 'ampouleNue', 'allumette',
  'cleRouillee', 'craie', 'pieceTrouee', 'montreArretee', 'photoDeFamille', 'sablier', 'chienDeFaience',
  'seringue', 'gobeletFele',
];

/** Conditions de déblocage des reliques et des gobelets (vérifiées après chaque événement). */
export interface Unlock {
  kind: 'relic' | 'cup';
  id: string;
  /** Clé de texte décrivant la condition. */
  hint: string;
  done: (p: Progress) => boolean;
}

export const UNLOCKS: Unlock[] = [
  { kind: 'relic', id: 'leContrat', hint: 'unlock.night4', done: (p) => p.stats.bestNight >= 4 },
  { kind: 'relic', id: 'miroirSansTain', hint: 'unlock.night5', done: (p) => p.stats.bestNight >= 5 },
  { kind: 'relic', id: 'cinqCouronnes', hint: 'unlock.five', done: (p) => p.stats.fives >= 1 },
  { kind: 'relic', id: 'bocalVide', hint: 'unlock.pacts3', done: (p) => p.stats.pacts >= 3 },
  { kind: 'relic', id: 'moignon', hint: 'unlock.fingers4', done: (p) => p.stats.taken.doigt >= 4 },
  { kind: 'relic', id: 'oeilDeVerre', hint: 'unlock.eye', done: (p) => p.stats.taken.oeil >= 1 },
  { kind: 'relic', id: 'couteauABeurre', hint: 'unlock.sell5', done: (p) => p.stats.relicsSold >= 5 },
  { kind: 'relic', id: 'rosaireDos', hint: 'unlock.boneNight', done: (p) => p.flags.has('boneNight') },
  { kind: 'relic', id: 'langueDeSerpent', hint: 'unlock.tongue', done: (p) => p.stats.taken.langue >= 1 },
  { kind: 'relic', id: 'sixiemeDoigt', hint: 'unlock.hand', done: (p) => p.stats.taken.main >= 1 },
  { kind: 'relic', id: 'coeurDansUnBocal', hint: 'unlock.heart', done: (p) => p.stats.taken.coeur >= 1 },
  { kind: 'relic', id: 'pacteEnBlanc', hint: 'unlock.pacts2run', done: (p) => p.flags.has('twoPacts') },
  { kind: 'relic', id: 'doigtDuCreancier', hint: 'unlock.fingers8', done: (p) => p.stats.taken.doigt >= 8 },
  { kind: 'relic', id: 'sourireCousu', hint: 'unlock.bosses5', done: (p) => p.stats.bossesBeaten >= 5 },
  { kind: 'cup', id: 'boucher', hint: 'unlock.fingers10', done: (p) => p.stats.taken.doigt >= 10 },
  { kind: 'cup', id: 'os', hint: 'unlock.onesFive', done: (p) => p.flags.has('onesFive') },
  { kind: 'cup', id: 'dore', hint: 'unlock.coins40', done: (p) => p.flags.has('coins40') },
  { kind: 'cup', id: 'perce', hint: 'unlock.night5', done: (p) => p.stats.bestNight >= 5 },
  { kind: 'cup', id: 'creancier', hint: 'unlock.win', done: (p) => p.stats.wins >= 1 },
];

const emptyTaken = (): Record<BodyPartId, number> => ({ doigt: 0, dent: 0, oreille: 0, langue: 0, oeil: 0, main: 0, coeur: 0 });

function defaults(): SaveData {
  return {
    settings: { lang: 'en', softGore: false, volume: 0.8 },
    tutorialDone: false,
    tutorialFinger: false,
    stats: { runs: 0, wins: 0, bestNight: 0, hands: 0, pacts: 0, relicsSold: 0, bossesBeaten: 0, fives: 0, taken: emptyTaken() },
    cups: { cuir: 0 },
    relics: [...STARTING_RELICS],
    seen: [],
  };
}

export class Progress {
  private data: SaveData;
  /** Exploits ponctuels (« un Cinq de 1 », « 40 pièces d'un coup »…), gardés avec la sauvegarde. */
  readonly flags = new Set<string>();
  private readonly listeners: ((u: Unlock) => void)[] = [];

  constructor() {
    this.data = defaults();
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) {
        const loaded = JSON.parse(raw) as Partial<SaveData> & { flags?: string[] };
        const d = defaults();
        this.data = {
          ...d,
          ...loaded,
          settings: { ...d.settings, ...loaded.settings },
          stats: { ...d.stats, ...loaded.stats, taken: { ...emptyTaken(), ...loaded.stats?.taken } },
        };
        for (const f of loaded.flags ?? []) this.flags.add(f);
      }
    } catch {
      // Pas de stockage : on joue sans sauvegarde.
    }
  }

  private save() {
    try {
      localStorage.setItem(KEY, JSON.stringify({ ...this.data, flags: [...this.flags] }));
    } catch {
      // Ignoré : stockage indisponible.
    }
  }

  get settings() {
    return this.data.settings;
  }

  get stats() {
    return this.data.stats;
  }

  get tutorialDone() {
    return this.data.tutorialDone;
  }

  /** Le doigt perdu au tutoriel : une seule fois, pour la run qui suit. */
  takeTutorialFinger(): boolean {
    const had = this.data.tutorialFinger;
    this.data.tutorialFinger = false;
    this.save();
    return had;
  }

  finishTutorial() {
    this.data.tutorialDone = true;
    this.save();
  }

  updateSettings(patch: Partial<Settings>) {
    Object.assign(this.data.settings, patch);
    this.save();
  }

  onUnlock(fn: (u: Unlock) => void) {
    this.listeners.push(fn);
  }

  // ---------------------------------------------------------------- déblocages

  relicUnlocked(id: string) {
    return this.data.relics.includes(id);
  }

  unlockedRelics() {
    return new Set(this.data.relics);
  }

  cupUnlocked(id: CupId) {
    return this.data.cups[id] !== undefined;
  }

  /** Plus haut niveau d'intérêts jouable avec ce gobelet. */
  maxStake(id: CupId) {
    return this.data.cups[id] ?? 0;
  }

  seen(id: string) {
    return this.data.seen.includes(id);
  }

  /** Une relique, un dé ou une gravure aperçus en jeu rejoignent la collection. */
  discover(id: string) {
    if (this.data.seen.includes(id)) return;
    this.data.seen.push(id);
    this.save();
  }

  /** Tout ce qui se débloque dès qu'une statistique change. */
  check() {
    for (const u of UNLOCKS) {
      const already = u.kind === 'relic' ? this.relicUnlocked(u.id) : this.cupUnlocked(u.id as CupId);
      if (already || !u.done(this)) continue;
      if (u.kind === 'relic') this.data.relics.push(u.id);
      else this.data.cups[u.id as CupId] = 0;
      for (const fn of this.listeners) fn(u);
    }
    this.save();
  }

  // ---------------------------------------------------------------- événements de jeu

  record(event: { type: 'hand'; five: boolean; fiveOfOnes: boolean } | { type: 'pact'; part: BodyPartId; inRun: number } | { type: 'night'; reached: number; boneOnly: boolean } | { type: 'boss' } | { type: 'sold' } | { type: 'coins'; amount: number }) {
    const s = this.data.stats;
    switch (event.type) {
      case 'hand':
        s.hands++;
        if (event.five) s.fives++;
        if (event.fiveOfOnes) this.flags.add('onesFive');
        break;
      case 'pact':
        s.pacts++;
        s.taken[event.part]++;
        if (event.inRun >= 2) this.flags.add('twoPacts');
        break;
      case 'night':
        s.bestNight = Math.max(s.bestNight, event.reached);
        if (event.boneOnly) this.flags.add('boneNight');
        break;
      case 'boss':
        s.bossesBeaten++;
        break;
      case 'sold':
        s.relicsSold++;
        break;
      case 'coins':
        if (event.amount >= 40) this.flags.add('coins40');
        break;
    }
    this.check();
  }

  /** Fin de run : statistiques, et le niveau d'intérêts suivant si la dette est payée. */
  endRun(cup: CupId, stake: number, won: boolean) {
    this.data.stats.runs++;
    if (won) {
      this.data.stats.wins++;
      this.data.cups[cup] = Math.max(this.data.cups[cup] ?? 0, Math.min(MAX_STAKE, stake + 1));
    }
    this.check();
  }

  /** Remise à zéro complète (réglages conservés). */
  wipe() {
    const settings = this.data.settings;
    this.data = defaults();
    this.data.settings = settings;
    this.flags.clear();
    this.save();
  }
}

/** Liste des reliques avec leur état pour la collection. */
export function relicCatalog(p: Progress) {
  return RELICS.map((def) => ({
    def,
    unlocked: p.relicUnlocked(def.id),
    seen: p.seen(def.id),
    unlock: UNLOCKS.find((u) => u.kind === 'relic' && u.id === def.id),
  }));
}

export function cupCatalog(p: Progress) {
  return CUPS.map((cup) => ({
    cup,
    unlocked: p.cupUnlocked(cup.id),
    maxStake: p.maxStake(cup.id),
    unlock: UNLOCKS.find((u) => u.kind === 'cup' && u.id === cup.id),
  }));
}
