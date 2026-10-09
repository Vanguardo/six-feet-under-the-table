import type { ComboResult } from './rules/combos';

export interface HudState {
  target: number;
  score: number;
  hands: number;
  rerolls: number;
  combo: ComboResult | null;
  canValidate: boolean;
  hint: string;
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
  private last = '';

  constructor(private readonly onValidate: () => void) {}

  update(s: HudState) {
    const key = JSON.stringify([s.target, s.score, s.hands, s.rerolls, s.combo?.score, s.combo?.combo.id, s.canValidate]);
    if (key !== this.last) {
      this.last = key;
      const combo = s.combo
        ? `<div class="combo">${s.combo.combo.name}</div>
           <div class="detail">${s.combo.chips} jetons × ${s.combo.mult} = ${s.combo.score}</div>`
        : `<div class="detail">—</div>`;
      this.ticket.innerHTML = `
        <div class="row"><span>OBJECTIF</span><span>${s.target}</span></div>
        <div class="row"><span>SCORE</span><span>${s.score}</span></div>
        <div class="sep"></div>
        <div class="row"><span>MAINS</span><span>${s.hands}</span></div>
        <div class="row"><span>RELANCES</span><span>${s.rerolls}</span></div>
        <div class="sep"></div>
        ${combo}
        <button id="validate" ${s.canValidate ? '' : 'disabled'}>VALIDER [ESPACE]</button>`;
      this.ticket.querySelector('#validate')!.addEventListener('click', () => this.onValidate());
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

  showBanner(title: string, subtitle: string) {
    this.banner.innerHTML = `${title}<small>${subtitle}</small>`;
    this.banner.classList.add('show');
  }

  hideBanner() {
    this.banner.classList.remove('show');
  }
}
