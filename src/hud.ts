import { fmtNum, t } from './i18n';
import { comboName } from './i18n/names';
import type { TicketLine } from './printer';
import type { ComboResult } from './rules/combos';

export interface HudState {
  night: number;
  echeance: number;
  isBoss: boolean;
  target: number;
  score: number;
  hands: number;
  rerolls: number;
  coins: number;
  combo: ComboResult | null;
  levels: string[];
  /** Boss en cours : nom et règle. */
  boss: { name: string; rule: string } | null;
  /** Ce qui a été perdu (« 2 doigts · 1 œil »). */
  body: string;
  /** Secondes restantes avant que l'Horloger ne joue la main. */
  timer: number | null;
  /** ×mult de malédiction pour la prochaine main. */
  curse: number;
  /** Contrats que le créancier accepte encore de signer. */
  contracts: number;
  canValidate: boolean;
  /** Le bouton de validation pulse (tutoriel). */
  pulse?: boolean;
  hint: string;
}

const fmt = fmtNum;

/** Coupe un texte en lignes de `n` caractères au plus, aux espaces. */
function wrap(text: string, n: number): string[] {
  const out: string[] = [];
  let line = '';
  for (const word of text.split(/\s+/)) {
    if ((line + ' ' + word).trim().length > n) {
      if (line) out.push(line);
      line = word;
    } else line = (line + ' ' + word).trim();
  }
  if (line) out.push(line);
  return out;
}

/** Ce que l'imprimante sort : l'état de l'échéance, puis l'historique des mains jouées. */
export function ticketLines(s: HudState, log: { name: string; gain: number }[]): TicketLine[] {
  const L: TicketLine[] = [];
  L.push({ left: 'SIX FEET UNDER', kind: 'title' });
  L.push({ left: t('hud.night', { n: s.night }), right: s.isBoss ? t('hud.boss') : t('hud.echeance', { n: s.echeance + 1 }) });
  if (s.boss) {
    L.push({ left: s.boss.name.toUpperCase(), kind: 'warn' });
    for (const w of wrap(s.boss.rule, 34)) L.push({ left: w, kind: 'small' });
  }
  L.push({ left: '', kind: 'sep' });
  L.push({ left: t('hud.target'), right: fmt(s.target), kind: 'big' });
  L.push({ left: t('hud.score'), right: fmt(s.score), kind: 'big' });
  L.push({ left: '', kind: 'sep' });
  L.push({ left: t('hud.hands'), right: String(s.hands) });
  L.push({ left: t('hud.rerolls'), right: String(s.rerolls) });
  L.push({ left: t('hud.coins'), right: String(s.coins) });
  L.push({ left: t('hud.contracts'), right: String(s.contracts), kind: s.contracts === 0 ? 'warn' : undefined });
  if (s.timer !== null) L.push({ left: t('hud.timer'), right: `${Math.ceil(s.timer)} s`, kind: 'warn' });
  if (s.curse > 1) L.push({ left: t('hud.curse'), right: `x${s.curse.toFixed(2)}`, kind: 'warn' });
  if (log.length) {
    L.push({ left: '', kind: 'sep' });
    for (const entry of log) L.push({ left: entry.name.toUpperCase(), right: `+${fmt(entry.gain)}` });
  }
  if (s.levels.length) {
    L.push({ left: '', kind: 'sep' });
    for (const l of s.levels) L.push({ left: l, kind: 'small' });
  }
  if (s.body) {
    L.push({ left: '', kind: 'sep' });
    for (const w of wrap(t('hud.lost', { what: s.body }), 34)) L.push({ left: w, kind: 'warn' });
  }
  return L;
}

/**
 * HUD temporaire du prototype. Dans le jeu final, ces infos vivront sur la table
 * (ticket imprimé, objectif gravé, pièces empilées) : aucune interface flottante.
 */
export class Hud {
  private readonly ticket = document.getElementById('ticket')!;
  private readonly hint = document.getElementById('hint')!;
  private readonly banner = document.getElementById('banner')!;
  private readonly combo = document.getElementById('combo')!;
  private readonly tally = document.getElementById('tally')!;
  private readonly tooltip = document.getElementById('tooltip')!;

  constructor(private readonly onValidate: () => void) {
    this.ticket.addEventListener('click', (e) => {
      if ((e.target as HTMLElement).id === 'validate') this.onValidate();
    });
  }

  update(s: HudState) {
    this.hint.textContent = s.hint;
    if (this.ticket.style.display !== 'none') this.ticket.style.display = 'none';
  }

  /** La combinaison claque au centre de l'écran une fois les dés révélés. */
  popCombo(res: ComboResult) {
    this.combo.innerHTML = `${comboName(res.combo.id)}<small>${res.chips} × ${res.mult} = ${fmt(res.score)}</small>`;
    this.combo.classList.remove('pop');
    void this.combo.offsetWidth; // relance l'animation CSS
    this.combo.classList.add('pop');
  }

  // Compteur Jetons × Mult pendant le scoring, à la Balatro.
  showTally(name: string) {
    this.combo.classList.remove('pop');
    this.tally.innerHTML = `<div class="name">${name}</div>
      <div class="boxes"><span class="chips">0</span><span class="x">×</span><span class="mult">0</span></div>
      <div class="total"></div>`;
    this.tally.classList.add('show');
  }

  setTally(chips: number, mult: number) {
    const c = this.tally.querySelector('.chips')!;
    const m = this.tally.querySelector('.mult')!;
    const prevC = c.textContent;
    const prevM = m.textContent;
    c.textContent = fmt(chips);
    m.textContent = Number.isInteger(mult) ? fmt(mult) : mult.toFixed(1);
    if (c.textContent !== prevC) this.bump(c);
    if (m.textContent !== prevM) this.bump(m);
  }

  setTallyTotal(total: number) {
    const t = this.tally.querySelector('.total')!;
    t.textContent = `= ${fmt(total)}`;
    this.bump(t);
  }

  hideTally() {
    this.tally.classList.remove('show');
  }

  private bump(el: Element) {
    el.classList.remove('bump');
    void (el as HTMLElement).offsetWidth;
    el.classList.add('bump');
  }

  /** `above` : au toucher, l'infobulle passe au-dessus du doigt qui cacherait le texte. */
  showTooltip(html: string, x: number, y: number, above = false) {
    this.tooltip.innerHTML = html;
    this.tooltip.classList.add('show');
    const w = this.tooltip.offsetWidth;
    const h = this.tooltip.offsetHeight;
    const left = Math.min(Math.max(8, above ? x - w / 2 : x + 16), window.innerWidth - w - 8);
    const top = above ? y - h - 28 : y + 16;
    this.tooltip.style.left = `${left}px`;
    this.tooltip.style.top = `${Math.min(Math.max(8, top), window.innerHeight - h - 8)}px`;
  }

  hideTooltip() {
    this.tooltip.classList.remove('show');
  }

  showBanner(title: string, subtitle: string) {
    this.banner.innerHTML = `${title}<small>${subtitle}</small>`;
    this.banner.classList.add('show');
  }

  hideBanner() {
    this.banner.classList.remove('show');
  }
}
