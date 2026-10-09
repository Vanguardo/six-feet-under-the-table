import { COMBOS, comboStats, LEVEL_GAIN } from './rules/combos';
import { DIE_TYPES, FACE_MODS, type OwnedDie } from './rules/dice';
import { RARITY_LABEL, sellValue } from './rules/relics';
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

  /** Bandeau par défaut : pièces, gains de l'échéance, consignes. */
  bar(run: RunState, earnings: Earnings | null, message?: string) {
    const earn = earnings
      ? `Gains : +${earnings.echeance} échéance${earnings.hands ? ` · +${earnings.hands} mains` : ''}${earnings.interest ? ` · +${earnings.interest} intérêts` : ''}${earnings.relics ? ` · +${earnings.relics} reliques` : ''}`
      : 'Pacte signé : aucun gain.';
    this.show(`
      <div class="head"><span>LA VALISE</span><span class="coins">${run.coins} pièces</span></div>
      <div class="earn">${earn}</div>
      <div class="sub">${
        message ??
        `Clique un objet pour l'acheter · la sonnette relance la valise · clique une relique du rebord pour la vendre ou la déplacer (${run.relics.length}/${MAX_RELICS}) · referme le couvercle pour continuer`
      }</div>`);
  }

  /** Consigne pendant le choix d'un dé, avec un bouton pour annoncer. */
  ask(run: RunState, message: string, onCancel: () => void) {
    this.show(
      `<div class="head"><span>LA VALISE</span><span class="coins">${run.coins} pièces</span></div>
       <div class="sub">${message}</div>
       <div class="actions"><button data-action="cancel">Annuler</button><span></span></div>`,
      { cancel: onCancel },
    );
  }

  /** Choix de la face à graver ; une gravure existante est remplacée. */
  pickFace(die: OwnedDie, modName: string, onPick: (face: number) => void, onCancel: () => void) {
    const type = DIE_TYPES[die.type];
    const faces = type.faces
      .map((v, f) => {
        const mod = die.mods[f];
        return `<button class="face ${mod ?? ''}" data-action="face" data-index="${f}">${mod === 'vide' ? 0 : v}${mod ? `<small>${FACE_MODS[mod].name}</small>` : ''}</button>`;
      })
      .join('');
    this.show(
      `<div class="head"><span>${type.name}</span><span></span></div>
       <div class="sub">Quelle face graver (${modName.toLowerCase()}) ? Une gravure existante est remplacée.</div>
       <div class="faces">${faces}</div>
       <div class="actions"><button data-action="cancel">Annuler</button><span></span></div>`,
      { face: onPick, cancel: onCancel },
    );
  }

  /** Menu d'une relique posée sur le rebord. */
  relicMenu(run: RunState, index: number, on: { sell: () => void; move: (delta: number) => void; close: () => void }) {
    const r = run.relics[index];
    const sell = run.canSell(index)
      ? `<button data-action="sell">Vendre ${sellValue(r.def, run.has('couteauABeurre'))} $</button>`
      : '<button disabled>Maudite : invendable</button>';
    this.show(
      `<div class="head"><span>${r.def.name}</span><span class="rarity ${r.def.rarity}">${RARITY_LABEL[r.def.rarity]}</span></div>
       <div class="sub">${r.def.description}${r.def.status ? ` · <b>${r.def.status(r.state)}</b>` : ''}</div>
       <div class="actions">
         <span>
           <button data-action="left" ${index === 0 ? 'disabled' : ''}>◀ Avant</button>
           <button data-action="right" ${index === run.relics.length - 1 ? 'disabled' : ''}>Après ▶</button>
         </span>
         <span>${sell} <button data-action="close">Fermer</button></span>
       </div>`,
      { sell: on.sell, left: () => on.move(-1), right: () => on.move(1), close: on.close },
    );
  }
}

/** Texte de l'infobulle d'un article de la valise. */
export function itemTooltip(item: ShopItem): string {
  switch (item.kind) {
    case 'relic':
      return `<b>${item.def.name}</b> · ${RARITY_LABEL[item.def.rarity]}<br>${item.def.description}<br><b>${item.price} $</b>`;
    case 'gravure': {
      const gain = LEVEL_GAIN[item.combo];
      return `<b>Gravure : ${COMBOS[item.combo].name}</b><br>+${gain.chips} jetons et +${gain.mult} mult<br><b>${item.price} $</b>`;
    }
    case 'die': {
      const t = DIE_TYPES[item.type];
      return `<b>${t.name}</b> · faces ${t.faces.join(' ')}<br>${t.description}<br>Remplace un de tes dés.<br><b>${item.price ? `${item.price} $` : 'offert'}</b>`;
    }
    case 'burin': {
      const m = FACE_MODS[item.mod];
      return `<b>Burin : ${m.name}</b><br>${m.description}<br>Grave une face d'un de tes dés.<br><b>${item.price} $</b>`;
    }
  }
}

/** Ligne de niveau affichée dans le ticket. */
export function levelLine(run: RunState, id: keyof typeof COMBOS) {
  const level = run.effectiveLevels()[id] ?? 1;
  const s = comboStats(id, level);
  return `${COMBOS[id].name} niv. ${level} : ${s.chips} × ${s.mult}`;
}
