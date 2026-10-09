import type { ComboId, ComboResult } from './combos';

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
  values: number[];
  result: ComboResult;
  /** Première main jouée de l'échéance. */
  isFirstHand: boolean;
  /** Mains restantes après celle-ci. */
  handsLeftAfter: number;
  relicCount: number;
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
  onScoringDie?: (value: number, state: RelicState) => Effect | null;
  /** Déclenché une fois par main, de gauche à droite, après les dés. */
  onHand?: (ctx: HandContext, state: RelicState) => Effect | null;
  /** Après le scoring d'une main (effets qui s'usent). */
  afterHand?: (state: RelicState) => void;
  /** Pièces gagnées à la fin d'une échéance réussie. */
  onEcheanceEnd?: (state: RelicState) => number;
  /** Texte dynamique, quand la relique accumule une valeur. */
  status?: (state: RelicState) => string;
}

const PAIRS_IN: Partial<Record<ComboId, number>> = { paire: 1, doublePaire: 2, full: 1 };
const SUITES: ComboId[] = ['petiteSuite', 'grandeSuite'];

export const RELICS: RelicDef[] = [
  {
    id: 'dentEnOr',
    name: 'Dent en or',
    rarity: 'commune',
    price: 4,
    description: 'Chaque 1 marquant : +5 mult',
    onScoringDie: (v) => (v === 1 ? { mult: 5 } : null),
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
    status: (s) => `+${s.chips} jetons`,
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
    onScoringDie: (v) => (v === 6 ? { chips: 10 } : null),
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
    description: '+1 relique proposée en boutique',
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
    id: 'pieceTrouee',
    name: 'Pièce trouée',
    rarity: 'commune',
    price: 5,
    description: '+1 mult définitif chaque fois qu’une relance n’améliore pas la combinaison',
    initialState: () => ({ mult: 0 }),
    onHand: (_, s) => (s.mult > 0 ? { mult: s.mult } : null),
    status: (s) => `+${s.mult} mult`,
  },
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
    id: 'leContrat',
    name: 'Le Contrat',
    rarity: 'rare',
    price: 9,
    description: '×3 mult ; la dette de chaque nuit suivante augmente de 10 %',
    onHand: () => ({ xmult: 3 }),
  },
  {
    id: 'cinqCouronnes',
    name: 'Cinq Couronnes',
    rarity: 'rare',
    price: 9,
    description: 'Un Cinq rapporte ×5 mult',
    onHand: ({ result }) => (result.combo.id === 'cinq' ? { xmult: 5 } : null),
  },
];

export const RARITY_WEIGHT: Record<Rarity, number> = { commune: 70, peuCommune: 25, rare: 5, maudite: 0 };

export interface OwnedRelic {
  uid: number;
  def: RelicDef;
  state: RelicState;
}

let nextUid = 1;
export function ownRelic(def: RelicDef): OwnedRelic {
  return { uid: nextUid++, def, state: def.initialState?.() ?? {} };
}

export function sellValue(def: RelicDef) {
  return Math.floor(def.price / 2);
}
