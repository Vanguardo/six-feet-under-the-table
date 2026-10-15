import { t } from '../i18n';
import type { Body } from './body';
import type { ComboId, ComboResult } from './combos';
import type { Face } from './dice';

export type Rarity = 'commune' | 'peuCommune' | 'rare' | 'maudite';

export const RARITY_LABEL: Record<Rarity, string> = {
  commune: 'Commune',
  peuCommune: 'Peu commune',
  rare: 'Rare',
  maudite: 'Maudite',
};

/** Ce qu'une relique ajoute au score : jetons, mult additif, mult multiplicatif, pièces. */
export interface Effect {
  chips?: number;
  mult?: number;
  xmult?: number;
  coins?: number;
}

export interface HandContext {
  faces: Face[];
  result: ComboResult;
  /** Première main jouée de l'échéance. */
  isFirstHand: boolean;
  /** Mains restantes après celle-ci. */
  handsLeftAfter: number;
  relicCount: number;
  /** Reliques maudites posées sur le rebord. */
  cursed: number;
  body: Body;
  /** Combinaison de la main précédente dans l'échéance. */
  previousCombo: ComboId | null;
}

export type RelicState = Record<string, number>;

export interface RelicDef {
  id: string;
  name: string;
  rarity: Rarity;
  price: number;
  description: string;
  initialState?: () => RelicState;
  /** Déclenché pour chaque dé marquant, juste après lui. */
  onScoringDie?: (face: Face, state: RelicState) => Effect | null;
  /** Déclenché une fois par main, de gauche à droite, après les dés. */
  onHand?: (ctx: HandContext, state: RelicState) => Effect | null;
  /** Après le scoring d'une main (effets qui s'usent). */
  afterHand?: (state: RelicState) => void;
  /** Pièces gagnées à la fin d'une échéance réussie (`end` : mains et relances qui restaient). */
  onEcheanceEnd?: (state: RelicState, end: { hands: number; rerolls: number }) => number;
  /** Texte dynamique, quand la relique accumule une valeur. */
  status?: (state: RelicState) => string;
}

const PAIRS_IN: Partial<Record<ComboId, number>> = { paire: 1, doublePaire: 2, full: 1 };
const SUITES: ComboId[] = ['petiteSuite', 'grandeSuite'];

export const RELICS: RelicDef[] = [
  // ---------------------------------------------------------------- communes
  {
    id: 'dentEnOr',
    name: 'Dent en or',
    rarity: 'commune',
    price: 4,
    description: 'Chaque 1 marquant : +5 mult',
    onScoringDie: (f) => (f.value === 1 ? { mult: 5 } : null),
  },
  {
    id: 'mainCoupee',
    name: 'Main coupée',
    rarity: 'commune',
    price: 5,
    description: 'La première relance de chaque main est gratuite',
  },
  {
    id: 'chapelet',
    name: 'Chapelet',
    rarity: 'commune',
    price: 4,
    description: '+4 mult par paire dans la combinaison',
    onHand: ({ result }) => {
      const pairs = PAIRS_IN[result.combo.id] ?? 0;
      return pairs > 0 ? { mult: 4 * pairs } : null;
    },
  },
  {
    id: 'megot',
    name: 'Mégot',
    rarity: 'commune',
    price: 3,
    description: '+30 jetons, perd 3 jetons à chaque main jouée',
    initialState: () => ({ chips: 30 }),
    onHand: (_, s) => (s.chips > 0 ? { chips: s.chips } : null),
    afterHand: (s) => {
      s.chips = Math.max(0, s.chips - 3);
    },
    status: (s) => t('status.chips', { n: s.chips }),
  },
  {
    id: 'ticketFroisse',
    name: 'Ticket froissé',
    rarity: 'commune',
    price: 4,
    description: '+2 pièces à la fin de chaque échéance',
    onEcheanceEnd: () => 2,
  },
  {
    id: 'ampouleNue',
    name: 'Ampoule nue',
    rarity: 'commune',
    price: 4,
    description: 'Chaque 6 marquant : +10 jetons',
    onScoringDie: (f) => (f.value === 6 ? { chips: 10 } : null),
  },
  {
    id: 'allumette',
    name: 'Allumette',
    rarity: 'commune',
    price: 4,
    description: '+8 mult sur la première main de chaque échéance',
    onHand: ({ isFirstHand }) => (isFirstHand ? { mult: 8 } : null),
  },
  {
    id: 'cleRouillee',
    name: 'Clé rouillée',
    rarity: 'commune',
    price: 5,
    description: '+1 article proposé en boutique',
  },
  {
    id: 'craie',
    name: 'Craie',
    rarity: 'commune',
    price: 4,
    description: 'Petite et grande suite : +3 mult',
    onHand: ({ result }) => (SUITES.includes(result.combo.id) ? { mult: 3 } : null),
  },
  {
    id: 'deACoudre',
    name: 'Dé à coudre',
    rarity: 'commune',
    price: 4,
    description: 'Si les cinq dés marquent : +30 jetons',
    onHand: ({ result }) => (result.scoring.length >= 5 ? { chips: 30 } : null),
  },
  {
    id: 'trefleSeche',
    name: 'Trèfle séché',
    rarity: 'commune',
    price: 4,
    description: 'Chaque 4 ou 5 marquant : +3 mult',
    onScoringDie: (f) => (f.value === 4 || f.value === 5 ? { mult: 3 } : null),
  },
  {
    id: 'ferACheval',
    name: 'Fer à cheval rouillé',
    rarity: 'commune',
    price: 4,
    description: 'Chaque valeur paire qui marque : +8 jetons',
    onScoringDie: (f) => (f.value > 0 && f.value % 2 === 0 ? { chips: 8 } : null),
  },
  {
    id: 'pieceTrouee',
    name: 'Pièce trouée',
    rarity: 'commune',
    price: 5,
    description: '+1 mult définitif chaque fois qu’une relance n’améliore pas la combinaison',
    initialState: () => ({ mult: 0 }),
    onHand: (_, s) => (s.mult > 0 ? { mult: s.mult } : null),
    status: (s) => t('status.mult', { n: s.mult }),
  },
  // ---------------------------------------------------------------- peu communes
  {
    id: 'montreArretee',
    name: 'Montre arrêtée',
    rarity: 'peuCommune',
    price: 7,
    description: 'La première main de chaque échéance compte double',
    onHand: ({ isFirstHand }) => (isFirstHand ? { xmult: 2 } : null),
  },
  {
    id: 'photoDeFamille',
    name: 'Photo de famille',
    rarity: 'peuCommune',
    price: 6,
    description: '+1 mult par relique possédée',
    onHand: ({ relicCount }) => ({ mult: relicCount }),
  },
  {
    id: 'sablier',
    name: 'Sablier',
    rarity: 'peuCommune',
    price: 6,
    description: '+3 mult par main restante non jouée',
    onHand: ({ handsLeftAfter }) => (handsLeftAfter > 0 ? { mult: 3 * handsLeftAfter } : null),
  },
  {
    id: 'bocalVide',
    name: 'Bocal vide',
    rarity: 'peuCommune',
    price: 6,
    description: '+3 mult par partie du corps perdue',
    onHand: ({ body }) => (body.lost > 0 ? { mult: 3 * body.lost } : null),
  },
  {
    id: 'moignon',
    name: 'Moignon',
    rarity: 'peuCommune',
    price: 6,
    description: '+12 jetons par doigt manquant',
    onHand: ({ body }) => (body.fingers > 0 ? { chips: 12 * body.fingers } : null),
  },
  {
    id: 'oeilDeVerre',
    name: 'Œil de verre',
    rarity: 'peuCommune',
    price: 7,
    description: '×2 mult s’il ne te reste qu’un œil',
    onHand: ({ body }) => (body.eyes === 1 ? { xmult: 2 } : null),
  },
  {
    id: 'chienDeFaience',
    name: 'Chien de faïence',
    rarity: 'peuCommune',
    price: 6,
    description: '×1,5 mult si la combinaison est la même que la main précédente',
    onHand: ({ result, previousCombo }) => (previousCombo === result.combo.id ? { xmult: 1.5 } : null),
  },
  {
    id: 'seringue',
    name: 'Seringue',
    rarity: 'peuCommune',
    price: 6,
    description: 'Une fois par main, relancer un seul dé ne coûte pas de relance',
  },
  {
    id: 'gobeletFele',
    name: 'Gobelet fêlé',
    rarity: 'peuCommune',
    price: 6,
    description: 'Un lancer violent ajoute +1 à un dé au hasard',
  },
  {
    id: 'ratEmpaille',
    name: 'Rat empaillé',
    rarity: 'peuCommune',
    price: 5,
    description: 'En fin d’échéance, 1 pièce pour 2 relances non utilisées',
    onEcheanceEnd: (_, end) => Math.floor(end.rerolls / 2),
  },
  {
    id: 'lettreDeChange',
    name: 'Lettre de change',
    rarity: 'peuCommune',
    price: 6,
    description: '+2 mult définitif chaque fois qu’une échéance est réglée avant sa dernière main',
    initialState: () => ({ mult: 0 }),
    onHand: (_, s) => (s.mult > 0 ? { mult: s.mult } : null),
    onEcheanceEnd: (s, end) => {
      if (end.hands > 0) s.mult += 2;
      return 0;
    },
    status: (s) => t('status.mult', { n: s.mult }),
  },
  {
    id: 'couteauABeurre',
    name: 'Couteau à beurre',
    rarity: 'peuCommune',
    price: 5,
    description: 'Les reliques se revendent à leur prix complet',
  },
  {
    id: 'rosaireDos',
    name: "Rosaire d'os",
    rarity: 'peuCommune',
    price: 7,
    description: 'Chaque dé en os sans gravure qui marque : ×1,2 mult',
    onScoringDie: (f) => (f.type === 'os' && !f.mod ? { xmult: 1.2 } : null),
  },
  // ---------------------------------------------------------------- rares
  {
    id: 'leContrat',
    name: 'Le Contrat',
    rarity: 'rare',
    price: 9,
    description: '×3 mult ; la dette de chaque nuit suivante augmente de 10 %',
    onHand: () => ({ xmult: 3 }),
  },
  {
    id: 'langueDeSerpent',
    name: 'Langue de serpent',
    rarity: 'rare',
    price: 8,
    description: 'La valise propose aussi un article maudit, moins cher',
  },
  {
    id: 'chandelleNoire',
    name: 'Chandelle noire',
    rarity: 'rare',
    price: 9,
    description: 'La dernière main de l’échéance compte ×3 mult',
    onHand: ({ handsLeftAfter }) => (handsLeftAfter === 0 ? { xmult: 3 } : null),
  },
  {
    id: 'marteauDeJuge',
    name: 'Marteau de juge',
    rarity: 'rare',
    price: 8,
    description: 'Brelan et Carré : ×2 mult',
    onHand: ({ result }) => (result.combo.id === 'brelan' || result.combo.id === 'carre' ? { xmult: 2 } : null),
  },
  {
    id: 'mainDeGloire',
    name: 'Main de gloire',
    rarity: 'rare',
    price: 10,
    description: '×1,5 mult par relique maudite sur le rebord',
    onHand: ({ cursed }) => (cursed > 0 ? { xmult: 1.5 ** cursed } : null),
  },
  {
    id: 'cinqCouronnes',
    name: 'Cinq Couronnes',
    rarity: 'rare',
    price: 9,
    description: 'Un Cinq rapporte ×5 mult',
    onHand: ({ result }) => (result.combo.id === 'cinq' ? { xmult: 5 } : null),
  },
  {
    id: 'miroirSansTain',
    name: 'Miroir sans tain',
    rarity: 'rare',
    price: 10,
    description: 'Copie l’effet de la relique posée à sa droite',
  },
  {
    id: 'sixiemeDoigt',
    name: 'Sixième doigt',
    rarity: 'rare',
    price: 10,
    description: '+1 dé dans le gobelet ; les cinq meilleurs comptent',
  },
  // ---------------------------------------------------------------- maudites (invendables)
  {
    id: 'coeurDansUnBocal',
    name: 'Cœur dans un bocal',
    rarity: 'maudite',
    price: 8,
    description: '×4 mult ; −2 relances par échéance',
    onHand: () => ({ xmult: 4 }),
  },
  {
    id: 'pacteEnBlanc',
    name: 'Pacte en blanc',
    rarity: 'maudite',
    price: 6,
    description: 'Chaque pacte rapporte aussi 20 pièces',
  },
  {
    id: 'doigtDuCreancier',
    name: 'Doigt du créancier',
    rarity: 'maudite',
    price: 8,
    description: '×(1 + 0,5 par pacte signé) mult',
    onHand: ({ body }) => (body.pacts > 0 ? { xmult: 1 + 0.5 * body.pacts } : null),
  },
  {
    id: 'dentDeLait',
    name: 'Dent de lait',
    rarity: 'maudite',
    price: 6,
    description: '×2 mult ; chaque main jouée te coûte 1 pièce',
    onHand: () => ({ xmult: 2, coins: -1 }),
  },
  {
    id: 'sourireCousu',
    name: 'Sourire cousu',
    rarity: 'maudite',
    price: 8,
    description: 'Toutes les combinaisons +1 niveau ; le créancier ne réagit plus',
  },
];

export const RARITY_WEIGHT: Record<Rarity, number> = { commune: 64, peuCommune: 26, rare: 6, maudite: 4 };

export interface OwnedRelic {
  uid: number;
  def: RelicDef;
  state: RelicState;
}

let nextUid = 1;
export function ownRelic(def: RelicDef): OwnedRelic {
  return { uid: nextUid++, def, state: def.initialState?.() ?? {} };
}

export function sellValue(def: RelicDef, fullPrice = false) {
  return fullPrice ? def.price : Math.floor(def.price / 2);
}

export function findRelic(id: string) {
  return RELICS.find((r) => r.id === id)!;
}
