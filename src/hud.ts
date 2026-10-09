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
  canValidate: boolean;
  hint: string;
}

const fmt = (n: number) => Math.floor(n).toLocaleString('fr-FR');

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
  private last = '';

  constructor(private readonly onValidate: () => void) {
    this.ticket.addEventListener('click', (e) => {
      if ((e.target as HTMLElement).id === 'validate') this.onValidate();
    });
  }

  update(s: HudState) {
    const key = JSON.stringify({ ...s, hint: '', timer: s.timer === null ? null : Math.ceil(s.timer), combo: s.combo && [s.combo.combo.id, s.combo.level, s.combo.score] });
    if (key !== this.last) {
      this.last = key;
      const combo = s.combo
        ? `<div class="combo">${s.combo.combo.name}${s.combo.level > 1 ? ` niv. ${s.combo.level}` : ''}</div>
           <div class="detail">${s.combo.chips} jetons × ${s.combo.mult} (avant reliques)</div>`
        : `<div class="detail">—</div>`;
      const levels = s.levels.length ? `<div class="sep"></div>${s.levels.map((l) => `<div class="detail">${l}</div>`).join('')}` : '';
      const boss = s.boss ? `<div class="sep"></div><div class="boss">${s.boss.name}</div><div class="detail">${s.boss.rule}</div>` : '';
      const timer = s.timer !== null ? `<div class="row warn"><span>DÉCIDE</span><span>${Math.ceil(s.timer)} s</span></div>` : '';
      const curse = s.curse > 1 ? `<div class="row warn"><span>MALÉDICTION</span><span>×${s.curse.toFixed(2)}</span></div>` : '';
      const body = s.body ? `<div class="sep"></div><div class="detail warn">Perdu : ${s.body}</div>` : '';
      this.ticket.innerHTML = `
        <div class="row"><span>NUIT ${s.night}/7</span><span>${s.isBoss ? 'BOSS' : `ÉCHÉANCE ${s.echeance + 1}/3`}</span></div>
        ${boss}
        <div class="sep"></div>
        <div class="row"><span>OBJECTIF</span><span>${fmt(s.target)}</span></div>
        <div class="row"><span>SCORE</span><span>${fmt(s.score)}</span></div>
        <div class="sep"></div>
        <div class="row"><span>MAINS</span><span>${s.hands}</span></div>
        <div class="row"><span>RELANCES</span><span>${s.rerolls}</span></div>
        <div class="row"><span>PIÈCES</span><span>${s.coins}</span></div>
        ${timer}${curse}
        <div class="sep"></div>
        ${combo}
        ${levels}
        ${body}
        <button id="validate" ${s.canValidate ? '' : 'disabled'}>VALIDER [ESPACE]</button>`;
    }
    this.hint.textContent = s.hint;
  }

  /** La combinaison claque au centre de l'écran une fois les dés révélés. */
  popCombo(res: ComboResult) {
    this.combo.innerHTML = `${res.combo.name}<small>${res.chips} × ${res.mult} = ${res.score}</small>`;
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

  showTooltip(html: string, x: number, y: number) {
    this.tooltip.innerHTML = html;
    this.tooltip.style.left = `${x + 16}px`;
    this.tooltip.style.top = `${y + 16}px`;
    this.tooltip.classList.add('show');
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
