import type { ComboResult } from './combos';
import type { Effect, HandContext, OwnedRelic } from './relics';

/** Une étape du scoring, avec les totaux après l'avoir appliquée : c'est ce que l'animation joue. */
export interface ScoreStep {
  kind: 'base' | 'die' | 'relic';
  die?: number;
  relic?: number;
  effect: Effect;
  chips: number;
  mult: number;
}

export interface ScoreBreakdown {
  steps: ScoreStep[];
  chips: number;
  mult: number;
  total: number;
}

/**
 * Ordre fixe, pour que le joueur lise ses combos : la combinaison, puis chaque dé marquant
 * (suivi des reliques qu'il déclenche), puis chaque relique de gauche à droite.
 */
export function scoreHand(
  values: number[],
  result: ComboResult,
  relics: OwnedRelic[],
  ctx: Omit<HandContext, 'values' | 'result' | 'relicCount'>,
): ScoreBreakdown {
  let chips = result.baseChips;
  let mult = result.baseMult;
  const steps: ScoreStep[] = [{ kind: 'base', effect: { chips, mult }, chips, mult }];

  const apply = (kind: ScoreStep['kind'], effect: Effect, extra: Partial<ScoreStep>) => {
    chips += effect.chips ?? 0;
    mult += effect.mult ?? 0;
    if (effect.xmult) mult *= effect.xmult;
    steps.push({ kind, effect, chips, mult, ...extra });
  };

  for (const die of [...result.scoring].sort((a, b) => a - b)) {
    const value = values[die];
    apply('die', { chips: value }, { die });
    relics.forEach((r, i) => {
      const effect = r.def.onScoringDie?.(value, r.state);
      if (effect) apply('relic', effect, { relic: i, die });
    });
  }

  const handCtx: HandContext = { ...ctx, values, result, relicCount: relics.length };
  relics.forEach((r, i) => {
    const effect = r.def.onHand?.(handCtx, r.state);
    if (effect) apply('relic', effect, { relic: i });
  });

  return { steps, chips, mult, total: Math.floor(chips * mult) };
}
