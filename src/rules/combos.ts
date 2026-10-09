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

/** Gain par niveau, appliqué par les Gravures. */
export const LEVEL_GAIN: Record<ComboId, { chips: number; mult: number }> = {
  cinq: { chips: 40, mult: 4 },
  carre: { chips: 30, mult: 3 },
  grandeSuite: { chips: 30, mult: 3 },
  full: { chips: 25, mult: 2 },
  petiteSuite: { chips: 20, mult: 2 },
  brelan: { chips: 20, mult: 2 },
  doublePaire: { chips: 20, mult: 1 },
  paire: { chips: 15, mult: 1 },
  deHaut: { chips: 10, mult: 1 },
};

export type ComboLevels = Partial<Record<ComboId, number>>;

export function comboStats(id: ComboId, level = 1) {
  const gain = LEVEL_GAIN[id];
  return { chips: COMBOS[id].chips + gain.chips * (level - 1), mult: COMBOS[id].mult + gain.mult * (level - 1) };
}

export interface ComboResult {
  combo: Combo;
  level: number;
  /** Jetons et mult de la combinaison à son niveau, sans les dés. */
  baseChips: number;
  baseMult: number;
  /** Indices des dés qui forment la combinaison (les dés « marquants »). */
  scoring: number[];
  chips: number;
  mult: number;
  score: number;
}

/** Plus longue suite de valeurs consécutives ; à longueur égale, la plus haute. */
function longestRun(values: number[]): number[] {
  // Un 0 (dé maudit, face vide) ne compte jamais dans une suite.
  const uniq = [...new Set(values.filter((v) => v > 0))].sort((a, b) => a - b);
  let best: number[] = [];
  let run: number[] = [];
  for (const v of uniq) {
    run = run.length > 0 && v === run[run.length - 1] + 1 ? [...run, v] : [v];
    if (run.length >= best.length) best = run;
  }
  return best;
}

export function evaluate(values: number[], levels: ComboLevels = {}): ComboResult {
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
  const level = levels[id] ?? 1;
  const base = comboStats(id, level);
  const chips = base.chips + scoring.reduce((sum, i) => sum + values[i], 0);
  return {
    combo,
    level,
    baseChips: base.chips,
    baseMult: base.mult,
    scoring,
    chips,
    mult: base.mult,
    score: chips * base.mult,
  };
}

export interface BestResult extends ComboResult {
  /** Valeurs retenues, jokers résolus (même longueur que l'entrée). */
  values: number[];
}

const JOKER_VALUES = [1, 2, 3, 4, 5, 6, 7, 8, 10, 12];

/** Toutes les façons de choisir `k` indices parmi `n`. */
function subsets(n: number, k: number): number[][] {
  if (k >= n) return [[...Array(n).keys()]];
  const out: number[][] = [];
  const pick = (start: number, acc: number[]) => {
    if (acc.length === k) return out.push([...acc]);
    for (let i = start; i < n; i++) pick(i + 1, [...acc, i]);
  };
  pick(0, []);
  return out;
}

/**
 * Meilleure combinaison possible : avec plus de cinq dés, les cinq meilleurs comptent ;
 * un joker (face crâne) prend la valeur qui rapporte le plus.
 */
export function evaluateBest(values: number[], levels: ComboLevels = {}, jokers: boolean[] = []): BestResult {
  let best: BestResult | null = null;
  for (const subset of subsets(values.length, 5)) {
    const jokerSlots = subset.map((_, k) => k).filter((k) => jokers[subset[k]]);
    // Au-delà de deux jokers, ils prennent tous la même valeur (assez bon, et rapide).
    const assignments: number[][] =
      jokerSlots.length === 0
        ? [[]]
        : jokerSlots.length <= 2
          ? JOKER_VALUES.flatMap((a) => (jokerSlots.length === 1 ? [[a]] : JOKER_VALUES.map((b) => [a, b])))
          : JOKER_VALUES.map((a) => jokerSlots.map(() => a));
    for (const assign of assignments) {
      const sub = subset.map((i) => values[i]);
      jokerSlots.forEach((k, j) => (sub[k] = assign[j]));
      const r = evaluate(sub, levels);
      if (!best || r.score > best.score || (r.score === best.score && r.chips > best.chips)) {
        const resolved = [...values];
        subset.forEach((i, k) => (resolved[i] = sub[k]));
        best = { ...r, scoring: r.scoring.map((k) => subset[k]), values: resolved };
      }
    }
  }
  return best!;
}
