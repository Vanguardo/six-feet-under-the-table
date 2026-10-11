import { t } from './i18n';
import { comboName, dieDesc, dieName, modDesc, modName, rarityName, relicDesc, relicName } from './i18n/names';
import { comboStats, LEVEL_GAIN, type ComboId } from './rules/combos';
import { DIE_TYPES, type OwnedDie } from './rules/dice';
import { sellValue } from './rules/relics';
import { MAX_RELICS, type Earnings, type RunState, type ShopItem } from './rules/run';

/**
 * Ce qui reste en HTML autour de la valise 3D : un bandeau (pièces, gains, consignes),
 * le choix d'une face pour un burin, et le menu d'une relique (vendre, déplacer).
 */
export class ShopPanel {
  private readonly root = document.getElementById('shop')!;
  private handlers: Record<string, (i: number) => void> = {};

  constructor() {
    this.root.addEventListener('click', (e) => {
      const btn = (e.target as HTMLElement).closest('button');
      if (!btn || btn.disabled) return;
      this.handlers[btn.dataset.action ?? '']?.(Number(btn.dataset.index));
    });
  }

  hide() {
    this.root.classList.remove('show');
    this.handlers = {};
  }

  private show(html: string, handlers: Record<string, (i: number) => void> = {}) {
    this.root.innerHTML = html;
    this.handlers = handlers;
    this.root.classList.add('show');
  }

  private head(run: RunState, title = t('shop.title')) {
    return `<div class="head"><span>${title}</span><span class="coins">${t('shop.coins', { n: run.coins })}</span></div>`;
  }

  /** Bandeau par défaut : pièces, gains de l'échéance, consignes. */
  bar(run: RunState, earnings: Earnings | null, message?: string) {
    const earn = earnings
      ? t('shop.earnings', { e: earnings.echeance }) +
        (earnings.hands ? t('shop.earnHands', { n: earnings.hands }) : '') +
        (earnings.interest ? t('shop.earnInterest', { n: earnings.interest }) : '') +
        (earnings.relics ? t('shop.earnRelics', { n: earnings.relics }) : '')
      : t('shop.noEarnings');
    this.show(`${this.head(run)}
      <div class="earn">${earn}</div>
      <div class="sub">${message ?? t('shop.help', { n: run.relics.length, max: MAX_RELICS })}</div>`);
  }

  /** Consigne pendant le choix d'un dé, avec un bouton pour annuler. */
  ask(run: RunState, message: string, onCancel: () => void) {
    this.show(
      `${this.head(run)}
       <div class="sub">${message}</div>
       <div class="actions"><button data-action="cancel">${t('shop.cancel')}</button><span></span></div>`,
      { cancel: onCancel },
    );
  }

  /** Choix de la face à graver ; une gravure existante est remplacée. */
  pickFace(die: OwnedDie, mod: string, onPick: (face: number) => void, onCancel: () => void) {
    const faces = DIE_TYPES[die.type].faces
      .map((v, f) => {
        const m = die.mods[f];
        return `<button class="face ${m ?? ''}" data-action="face" data-index="${f}">${m === 'vide' ? 0 : v}${m ? `<small>${modName(m)}</small>` : ''}</button>`;
      })
      .join('');
    this.show(
      `<div class="head"><span>${dieName(die.type)}</span><span></span></div>
       <div class="sub">${t('shop.pickFace', { mod: mod.toLowerCase() })}</div>
       <div class="faces">${faces}</div>
       <div class="actions"><button data-action="cancel">${t('shop.cancel')}</button><span></span></div>`,
      { face: onPick, cancel: onCancel },
    );
  }

  /** Menu d'une relique posée sur le rebord. */
  relicMenu(run: RunState, index: number, on: { sell: () => void; move: (delta: number) => void; close: () => void }) {
    const r = run.relics[index];
    const sell = run.canSell(index)
      ? `<button data-action="sell">${t('shop.sell', { n: sellValue(r.def, run.has('couteauABeurre')) })}</button>`
      : `<button disabled>${t('shop.cursed')}</button>`;
    this.show(
      `<div class="head"><span>${relicName(r.def)}</span><span class="rarity ${r.def.rarity}">${rarityName(r.def.rarity)}</span></div>
       <div class="sub">${relicDesc(r.def)}${r.def.status ? ` · <b>${r.def.status(r.state)}</b>` : ''}</div>
       <div class="actions">
         <span>
           <button data-action="left" ${index === 0 ? 'disabled' : ''}>${t('shop.before')}</button>
           <button data-action="right" ${index === run.relics.length - 1 ? 'disabled' : ''}>${t('shop.after')}</button>
         </span>
         <span>${sell} <button data-action="close">${t('shop.close')}</button></span>
       </div>`,
      { sell: on.sell, left: () => on.move(-1), right: () => on.move(1), close: on.close },
    );
  }
}

/** Texte de l'infobulle d'un article de la valise. */
export function itemTooltip(item: ShopItem): string {
  switch (item.kind) {
    case 'relic':
      return `<b>${relicName(item.def)}</b> · ${rarityName(item.def.rarity)}<br>${relicDesc(item.def)}<br><b>${item.price} $</b>`;
    case 'gravure': {
      const gain = LEVEL_GAIN[item.combo];
      return t('tip.gravure', { name: comboName(item.combo), chips: gain.chips, mult: gain.mult, price: item.price });
    }
    case 'die':
      return t('tip.die', {
        name: dieName(item.type),
        faces: DIE_TYPES[item.type].faces.join(' '),
        desc: dieDesc(item.type),
        price: item.price ? `${item.price} $` : t('shop.free'),
      });
    case 'burin':
      return t('tip.burin', { name: modName(item.mod), desc: modDesc(item.mod), price: item.price });
  }
}

/** Ligne de niveau affichée dans le ticket. */
export function levelLine(run: RunState, id: ComboId) {
  const level = run.effectiveLevels()[id] ?? 1;
  const s = comboStats(id, level);
  return t('hud.levelLine', { name: comboName(id), n: level, chips: s.chips, mult: s.mult });
}
