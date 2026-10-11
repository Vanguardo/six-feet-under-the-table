// Gobelets de départ et niveaux d'intérêts : la variété entre les runs, jamais de puissance gratuite.

export type CupId = 'cuir' | 'boucher' | 'os' | 'dore' | 'perce' | 'creancier';

export interface Cup {
  id: CupId;
  /** Teinte du cuir du gobelet en jeu. */
  tint: number;
}

export const CUPS: Cup[] = [
  // Teinte multipliée par la texture de cuir : blanc = cuir d'origine.
  { id: 'cuir', tint: 0xffffff },
  { id: 'boucher', tint: 0xd06050 },
  { id: 'os', tint: 0xfff4d8 },
  { id: 'dore', tint: 0xffd060 },
  { id: 'perce', tint: 0x9a9aa8 },
  { id: 'creancier', tint: 0x403434 },
];

export const MAX_STAKE = 8;

/**
 * Niveaux d'intérêts, cumulatifs : le niveau 3 applique aussi les niveaux 1 et 2.
 * Index 0 = niveau 1.
 */
export const STAKES = [
  'debt20', // dette +20 %
  'reroll', // −1 relance par échéance
  'boss', // dette des boss +25 %
  'prices', // boutique +1 $ par article
  'debt20b', // dette encore +20 %
  'interest', // intérêts plafonnés à 2
  'hands', // plus de pièces pour les mains non jouées
  'lastHand', // une main de moins par échéance
] as const;

export type StakeRule = (typeof STAKES)[number];

/** Règles actives pour un niveau d'intérêts donné. */
export function stakeRules(level: number): Set<StakeRule> {
  return new Set(STAKES.slice(0, Math.max(0, Math.min(MAX_STAKE, level))));
}
