import { COMBOS, comboStats, LEVEL_GAIN } from './rules/combos';
import { RARITY_LABEL, sellValue } from './rules/relics';
import { MAX_RELICS, type Earnings, type RunState, type ShopItem } from './rules/run';

export interface ShopActions {
  buy(index: number): void;
  reroll(): void;
  sell(index: number): void;
  move(index: number, delta: number): void;
  next(): void;
}

/**
 * Boutique provisoire en HTML. Dans le jeu final, c'est une valise ouverte sur la table
 * par les mains du marchand.
 */
export class ShopUi {
  private readonly root = document.getElementById('shop')!;

  constructor(private readonly actions: ShopActions) {
    this.root.addEventListener('click', (e) => {
      const btn = (e.target as HTMLElement).closest('button');
      if (!btn || btn.disabled) return;
      const i = Number(btn.dataset.index);
      switch (btn.dataset.action) {
        case 'buy': return this.actions.buy(i);
        case 'reroll': return this.actions.reroll();
        case 'sell': return this.actions.sell(i);
        case 'left': return this.actions.move(i, -1);
        case 'right': return this.actions.move(i, 1);
        case 'next': return this.actions.next();
      }
    });
  }

  get open() {
    return this.root.classList.contains('show');
  }

  show(run: RunState, earnings: Earnings | null) {
    this.render(run, earnings);
    this.root.classList.add('show');
  }

  hide() {
    this.root.classList.remove('show');
  }

  render(run: RunState, earnings: Earnings | null) {
    const earn = earnings
      ? `<div class="earn">Gains : +${earnings.echeance} échéance
          ${earnings.hands ? ` · +${earnings.hands} mains non jouées` : ''}
          ${earnings.interest ? ` · +${earnings.interest} intérêts` : ''}
          ${earnings.relics ? ` · +${earnings.relics} reliques` : ''}</div>`
      : '';
    const items = run.shop
      .map((item, i) => (item ? this.card(item, i, run.canBuy(i)) : `<div class="card sold">Vendu</div>`))
      .join('');
    const owned = run.relics.length
      ? run.relics
          .map(
            (r, i) => `<div class="card owned">
              <div class="name">${r.def.name}</div>
              <div class="rarity ${r.def.rarity}">${RARITY_LABEL[r.def.rarity]}</div>
              <div class="desc">${r.def.description}${r.def.status ? `<br><b>${r.def.status(r.state)}</b>` : ''}</div>
              <div class="row">
                <button data-action="left" data-index="${i}" ${i === 0 ? 'disabled' : ''}>◀</button>
                <button data-action="sell" data-index="${i}">Vendre ${sellValue(r.def)}</button>
                <button data-action="right" data-index="${i}" ${i === run.relics.length - 1 ? 'disabled' : ''}>▶</button>
              </div>
            </div>`,
          )
          .join('')
      : `<div class="empty">Aucune relique. Elles s'activent de gauche à droite.</div>`;
    const nextLabel = run.isBoss ? `Nuit ${run.night + 1}` : 'Échéance suivante';
    this.root.innerHTML = `
      <div class="head"><span>LA VALISE</span><span class="coins">${run.coins} pièces</span></div>
      ${earn}
      <div class="items">${items}</div>
      <div class="sub">Tes reliques (${run.relics.length}/${MAX_RELICS}) — ordre d'activation</div>
      <div class="items">${owned}</div>
      <div class="actions">
        <button data-action="reroll" ${run.coins < run.rerollCost ? 'disabled' : ''}>Relancer la valise (${run.rerollCost})</button>
        <button data-action="next" class="primary">${nextLabel} ▶</button>
      </div>`;
  }

  private card(item: ShopItem, index: number, canBuy: boolean) {
    if (item.kind === 'relic') {
      return `<div class="card">
        <div class="name">${item.def.name}</div>
        <div class="rarity ${item.def.rarity}">${RARITY_LABEL[item.def.rarity]}</div>
        <div class="desc">${item.def.description}</div>
        <button data-action="buy" data-index="${index}" ${canBuy ? '' : 'disabled'}>Acheter ${item.price}</button>
      </div>`;
    }
    const combo = COMBOS[item.combo];
    const gain = LEVEL_GAIN[item.combo];
    return `<div class="card gravure">
      <div class="name">Gravure : ${combo.name}</div>
      <div class="rarity">Consommable</div>
      <div class="desc">+${gain.chips} jetons et +${gain.mult} mult pour ${combo.name}</div>
      <button data-action="buy" data-index="${index}" ${canBuy ? '' : 'disabled'}>Acheter ${item.price}</button>
    </div>`;
  }
}

/** Ligne de niveau affichée dans l'infobulle des combinaisons. */
export function levelLine(run: RunState, id: keyof typeof COMBOS) {
  const level = run.levels[id] ?? 1;
  const s = comboStats(id, level);
  return `${COMBOS[id].name} niv. ${level} : ${s.chips} × ${s.mult}`;
}
