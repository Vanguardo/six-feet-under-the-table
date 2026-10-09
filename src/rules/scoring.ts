import type { ComboResult } from './combos';
import type { Face } from './dice';
import type { Effect, HandContext, OwnedRelic } from './relics';

/** Une étape du scoring, avec les totaux après l'avoir appliquée : c'est ce que l'animation joue. */
export interface ScoreStep {
  kind: 'base' | 'die' | 'face' | 'relic' | 'curse' | 'boss';
  die?: number;
  relic?: number;
  effect: Effect;
  chips: number;
  mult: number;
  /** Texte court pour l'animation, quand l'étape n'est pas un simple nombre. */
  label?: string;
}

export interface ScoreBreakdown {
  steps: ScoreStep[];
  chips: number;
  mult: number;
  total: number;
  /** Pièces gagnées (ou perdues) pendant le scoring. */
  coins: number;
  /** Une face sanglante a marqué : la dette de l'échéance augmente. */
  bled: number;
  /** Dés en verre qui ont marqué (usure). */
  glassUsed: number[];
}

export interface ScoringOptions {
  isFirstHand: boolean;
  handsLeftAfter: number;
  /** Relances déjà utilisées pendant la main (face flamme). */
  rerollsUsed: number;
  /** ×mult hérité des 0 de la main précédente (dé maudit). */
  curse: number;
  body: HandContext['body'];
  previousCombo: HandContext['previousCombo'];
  /** Index des reliques éteintes (Le Prêtre). */
  disabledRelics: Set<number>;
  /** Le Comptable : seules les paires comptent. */
  onlyPairs: boolean;
  /** Le Jumeau : combinaison déjà jouée. */
  halved: boolean;
  /** La Sangsue : les faces dorées coûtent au lieu de rapporter. */
  leech: boolean;
}

/**
 * Ordre fixe, pour que le joueur lise ses combos : la combinaison, une éventuelle malédiction,
 * puis chaque dé marquant (son type, sa face, les reliques qu'il déclenche),
 * puis chaque relique de gauche à droite, et enfin la règle du boss.
 */
export function scoreHand(faces: Face[], result: ComboResult, relics: OwnedRelic[], o: ScoringOptions): ScoreBreakdown {
  let chips = result.baseChips;
  let mult = result.baseMult;
  let coins = 0;
  let bled = 0;
  const glassUsed: number[] = [];
  const steps: ScoreStep[] = [{ kind: 'base', effect: { chips, mult }, chips, mult }];

  const apply = (kind: ScoreStep['kind'], effect: Effect, extra: Partial<ScoreStep> = {}) => {
    chips += effect.chips ?? 0;
    mult += effect.mult ?? 0;
    if (effect.xmult !== undefined) mult *= effect.xmult;
    coins += effect.coins ?? 0;
    steps.push({ kind, effect, chips, mult, ...extra });
  };

  if (o.curse > 1) apply('curse', { xmult: o.curse }, { label: 'Malédiction' });

  const active = relics.map((r, i) => (o.disabledRelics.has(i) ? null : r));

  for (const i of [...result.scoring].sort((a, b) => a - b)) {
    const face = faces[i];
    apply('die', { chips: face.value }, { die: i });
    // Le type du dé.
    if (face.type === 'ecrase') apply('face', { mult: 2 }, { die: i });
    if (face.type === 'verre') {
      apply('face', { xmult: 2 }, { die: i });
      glassUsed.push(i);
    }
    if (face.type === 'dent') apply('face', { coins: 1 }, { die: i });
    // La gravure de la face.
    switch (face.mod) {
      case 'doree':
        apply('face', { coins: o.leech ? -3 : 3 }, { die: i });
        break;
      case 'sanglante':
        apply('face', { xmult: 1.5 }, { die: i });
        bled++;
        break;
      case 'vide':
        apply('face', { mult: 15 }, { die: i });
        break;
      case 'clou':
        apply('face', { chips: 25 }, { die: i });
        break;
      case 'flamme':
        if (o.rerollsUsed > 0) apply('face', { mult: 4 * o.rerollsUsed }, { die: i });
        break;
    }
    active.forEach((r, k) => {
      const effect = r?.def.onScoringDie?.(face, r.state);
      if (effect) apply('relic', effect, { relic: k, die: i });
    });
  }

  const ctx: HandContext = {
    faces,
    result,
    isFirstHand: o.isFirstHand,
    handsLeftAfter: o.handsLeftAfter,
    relicCount: relics.length,
    body: o.body,
    previousCombo: o.previousCombo,
  };
  active.forEach((r, k) => {
    if (!r) return;
    // Le Miroir sans tain rejoue l'effet de sa voisine de droite.
    const source = r.def.id === 'miroirSansTain' ? active[k + 1] : r;
    const effect = source?.def.onHand?.(ctx, source.state);
    if (effect) apply('relic', effect, { relic: k });
  });

  const PAIRS = ['paire', 'doublePaire'];
  if (o.onlyPairs && !PAIRS.includes(result.combo.id)) apply('boss', { xmult: 0 }, { label: 'Refusé' });
  if (o.halved) apply('boss', { xmult: 0.5 }, { label: 'Déjà vu' });

  return { steps, chips, mult, total: Math.floor(chips * mult), coins, bled, glassUsed };
}
