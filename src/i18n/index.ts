import { en } from './en';
import { fr } from './fr';

export type Lang = 'en' | 'fr';

const DICTS: Record<Lang, Record<string, string>> = { en, fr };
let lang: Lang = 'en';

export function setLang(l: Lang) {
  lang = l;
  document.documentElement.lang = l;
}

export function getLang(): Lang {
  return lang;
}

/**
 * Texte traduit. `{nom}` dans la chaîne est remplacé par `vars.nom`.
 * Sans traduction dans la langue choisie : le français, puis `fallback`, puis la clé.
 */
export function t(key: string, vars?: Record<string, string | number>, fallback?: string): string {
  let s = DICTS[lang][key] ?? fr[key] ?? fallback ?? key;
  if (vars) for (const [k, v] of Object.entries(vars)) s = s.split(`{${k}}`).join(String(v));
  return s;
}

/** Nombre formaté à la manière de la langue (« 66 600 » ou « 66,600 »). */
export function fmtNum(n: number): string {
  return Math.floor(n).toLocaleString(lang === 'en' ? 'en-US' : 'fr-FR');
}

/** Pluriel simple : `plural(2, 'finger')` cherche `finger.other`, sinon `finger.one`. */
export function plural(n: number, key: string): string {
  return t(`${key}.${n > 1 ? 'other' : 'one'}`, { n });
}
