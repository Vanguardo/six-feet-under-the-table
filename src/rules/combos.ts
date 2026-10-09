// Règles pures : aucune dépendance au rendu ni à la physique.

export type ComboId =
  | 'cinq'
  | 'carre'
  | 'grandeSuite'
  | 'full'
  | 'petiteSuite'
  | 'brelan'
  | 'doublePaire'
  | 'paire'
  | 'deHaut';

export interface Combo {
  id: ComboId;
  name: string;
  chips: number;
  mult: number;
}

export const COMBOS: Record<ComboId, Combo> = {
  cinq: { id: 'cinq', name: 'Cinq', chips: 100, mult: 12 },
  carre: { id: 'carre', name: 'Carré', chips: 60, mult: 7 },
  grandeSuite: { id: 'grandeSuite', name: 'Grande suite', chips: 40, mult: 4 },
  full: { id: 'full', name: 'Full', chips: 40, mult: 4 },
  petiteSuite: { id: 'petiteSuite', name: 'Petite suite', chips: 30, mult: 3 },
  brelan: { id: 'brelan', name: 'Brelan', chips: 30, mult: 3 },
  doublePaire: { id: 'doublePaire', name: 'Double paire', chips: 20, mult: 2 },
  paire: { id: 'paire', name: 'Paire', chips: 10, mult: 2 },
  deHaut: { id: 'deHaut', name: 'Dé haut', chips: 5, mult: 1 },
};

export interface ComboResult {
  combo: Combo;
  /** Indices des dés qui forment la combinaison (les dés « marquants »). */
  scoring: number[];
  chips: number;
  mult: number;
  score: number;
}

/** Plus longue suite de valeurs consécutives ; à longueur égale, la plus haute. */
function longestRun(values: number[]): number[] {
  const uniq = [...new Set(values)].sort((a, b) => a - b);
  let best: number[] = [];
  let run: number[] = [];
  for (const v of uniq) {
    run = run.length > 0 && v === run[run.length - 1] + 1 ? [...run, v] : [v];
    if (run.length >= best.length) best = run;
  }
  return best;
}

export function evaluate(values: number[]): ComboResult {
  const byValue = new Map<number, number[]>();
  values.forEach((v, i) => byValue.set(v, [...(byValue.get(v) ?? []), i]));
  const groups = [...byValue.entries()]
    .map(([value, indices]) => ({ value, indices }))
    .sort((a, b) => b.indices.length - a.indices.length || b.value - a.value);
  const g0 = groups[0]?.indices ?? [];
  const g1 = groups[1]?.indices ?? [];
  const run = longestRun(values);
  const indicesOf = (vals: number[]) => vals.map((v) => byValue.get(v)![0]);

  let id: ComboId;
  let scoring: number[];
  if (g0.length >= 5) {
    id = 'cinq';
    scoring = g0.slice(0, 5);
  } else if (g0.length >= 4) {
    id = 'carre';
    scoring = g0.slice(0, 4);
  } else if (run.length >= 5) {
    id = 'grandeSuite';
    scoring = indicesOf(run.slice(-5));
  } else if (g0.length >= 3 && g1.length >= 2) {
    id = 'full';
    scoring = [...g0.slice(0, 3), ...g1.slice(0, 2)];
  } else if (run.length >= 4) {
    id = 'petiteSuite';
    scoring = indicesOf(run.slice(-4));
  } else if (g0.length >= 3) {
    id = 'brelan';
    scoring = g0.slice(0, 3);
  } else if (g0.length >= 2 && g1.length >= 2) {
    id = 'doublePaire';
    scoring = [...g0.slice(0, 2), ...g1.slice(0, 2)];
  } else if (g0.length >= 2) {
    id = 'paire';
    scoring = g0.slice(0, 2);
  } else {
    id = 'deHaut';
    const max = Math.max(...values);
    scoring = [values.indexOf(max)];
  }

  const combo = COMBOS[id];
  const chips = combo.chips + scoring.reduce((sum, i) => sum + values[i], 0);
  return { combo, scoring, chips, mult: combo.mult, score: chips * combo.mult };
}
