import { getLang, setLang, t, type Lang } from './i18n';
import { relicDesc, relicName, rarityName } from './i18n/names';
import { cupCatalog, relicCatalog, type Progress } from './progress';
import type { BodyPartId } from './rules/body';
import { MAX_STAKE, type CupId } from './rules/cups';
import { findRelic, RELICS } from './rules/relics';

/** Une ligne de défi : la récompense, la condition, une barre qui se remplit. */
function bar(reward: string, hint: string, cur: number, max: number, done = false) {
  const pct = Math.round((Math.min(cur, max) / max) * 100);
  return `<div class="challenge ${done ? 'done' : ''}"><div class="top"><span>${reward}</span><small>${done ? '✓' : `${Math.min(cur, max)} / ${max}`}</small></div>
    <div class="hint">${hint}</div><div class="track"><div class="fill" style="width:${pct}%"></div></div></div>`;
}

export interface RunSummary {
  won: boolean;
  cause: string;
  reached: string;
  paid: string;
  best: string;
  hands: number;
  pacts: number;
  lost: string;
  relics: string;
  /** Ce qui manquait pour payer (si perdu). */
  short: string | null;
  /** Records battus pendant cette run. */
  records: string[];
  /** Les défis les plus proches. */
  next: { reward: string; hint: string; cur: number; max: number }[];
}

export interface MenuActions {
  play(cup: CupId, stake: number): void;
  tutorial(): void;
  /** Table du jour : graine fixe, gobelet de cuir, sans intérêts. */
  daily(): void;
  /** Les réglages ont changé (langue, volume, gore). */
  settings(): void;
}

const PARTS: BodyPartId[] = ['doigt', 'dent', 'oreille', 'langue', 'oeil', 'main', 'coeur'];

/**
 * Menus en HTML par-dessus la scène : la table reste visible derrière, dans la pénombre.
 * Avertissement de contenu, titre, gobelets, collection, registre, réglages, pause.
 */
export class Menu {
  private readonly root = document.getElementById('menu')!;
  private readonly toastEl = document.getElementById('toast')!;
  private handlers: Record<string, (arg: string) => void> = {};
  private cup: CupId = 'cuir';
  private stake = 0;
  private toastTimer = 0;

  constructor(
    private readonly progress: Progress,
    private readonly actions: MenuActions,
  ) {
    this.root.addEventListener('click', (e) => {
      const el = (e.target as HTMLElement).closest<HTMLElement>('[data-action]');
      if (!el || (el as HTMLButtonElement).disabled) return;
      this.handlers[el.dataset.action!]?.(el.dataset.arg ?? '');
    });
    this.root.addEventListener('input', (e) => {
      const el = e.target as HTMLInputElement;
      if (el.dataset.action === 'volume') {
        this.progress.updateSettings({ volume: Number(el.value) / 100 });
        this.actions.settings();
      }
    });
  }

  get open() {
    return this.root.classList.contains('show');
  }

  hide() {
    this.root.classList.remove('show');
    document.body.classList.remove('in-menu');
  }

  private show(html: string, handlers: Record<string, (arg: string) => void>) {
    this.root.innerHTML = `<div class="panel">${html}</div>`;
    this.handlers = handlers;
    this.root.classList.add('show');
    document.body.classList.add('in-menu');
  }

  private langSwitch() {
    const l = getLang();
    return `<div class="langs">
      <button data-action="lang" data-arg="en" class="${l === 'en' ? 'on' : ''}">English</button>
      <button data-action="lang" data-arg="fr" class="${l === 'fr' ? 'on' : ''}">Français</button>
    </div>`;
  }

  private setLangAnd(rerender: () => void) {
    return (arg: string) => {
      setLang(arg as Lang);
      this.progress.updateSettings({ lang: arg as Lang });
      this.actions.settings();
      rerender();
    };
  }

  // ---------------------------------------------------------------- écrans

  /** Avertissement de contenu, au lancement. Le clic débloque aussi le son. */
  warning(onAccept: () => void) {
    this.show(
      `<div class="warning">
        <div class="tag">${t('menu.warningTitle')}</div>
        <p>${t('menu.warningText')}</p>
        <p class="small">${t('menu.warningSoft')}</p>
        ${this.langSwitch()}
        <button class="primary" data-action="accept">${t('menu.accept')}</button>
      </div>`,
      { accept: () => onAccept(), lang: this.setLangAnd(() => this.warning(onAccept)) },
    );
  }

  title() {
    this.show(
      `<h1>SIX FEET<br>UNDER THE TABLE</h1>
       <div class="subtitle">${t('menu.subtitle')}</div>
       <div class="buttons">
         <button class="primary" data-action="play">${t('menu.play')}</button>
         ${this.progress.tutorialDone ? `<button data-action="daily">${t('menu.daily')}${this.dailyBest()}</button>` : ''}
         <button data-action="challenges">${t('menu.challenges')}</button>
         <button data-action="collection">${t('menu.collection')}</button>
         <button data-action="registry">${t('menu.registry')}</button>
         <button data-action="settings">${t('menu.settings')}</button>
       </div>
       <div class="small">${t('menu.demo')}</div>`,
      {
        play: () => (this.progress.tutorialDone ? this.cups() : this.actions.tutorial()),
        daily: () => this.actions.daily(),
        collection: () => this.collection(),
        challenges: () => this.challenges(),
        registry: () => this.registry(),
        settings: () => this.settings(() => this.title()),
      },
    );
  }

  private dailyBest() {
    const d = this.progress.daily;
    if (!d || !d.best) return '';
    const streak = this.progress.streak;
    return ` <small>· ${t('menu.dailyBest', { best: d.best.split('|')[1] })}${streak > 1 ? ` · ${t('menu.streak', { n: streak })}` : ''}</small>`;
  }

  /** Choix du gobelet de départ et du niveau d'intérêts. */
  private cups() {
    const cards = cupCatalog(this.progress)
      .map(({ cup, unlocked, unlock }) => {
        const selected = cup.id === this.cup ? 'selected' : '';
        return unlocked
          ? `<button class="cup ${selected}" data-action="cup" data-arg="${cup.id}">
              <span class="swatch" style="background:#${cup.tint.toString(16).padStart(6, '0')}"></span>
              <b>${t(`cup.${cup.id}.name`)}</b><span>${t(`cup.${cup.id}.desc`)}</span></button>`
          : `<button class="cup locked" disabled><b>${t('menu.locked')}</b><span>${unlock ? t(unlock.hint) : ''}</span></button>`;
      })
      .join('');
    const max = this.progress.maxStake(this.cup);
    this.stake = Math.min(this.stake, max);
    const stakes = Array.from({ length: MAX_STAKE + 1 }, (_, n) =>
      n <= max
        ? `<button class="stake ${n === this.stake ? 'on' : ''}" data-action="stake" data-arg="${n}">${n}</button>`
        : `<button class="stake" disabled>${n}</button>`,
    ).join('');
    const rules = Array.from({ length: this.stake }, (_, k) => `<li>${t(`stake.${k + 1}`)}</li>`).join('');
    this.show(
      `<h2>${t('menu.chooseCup')}</h2>
       <div class="cups">${cards}</div>
       <h3>${t('menu.interest')}</h3>
       <div class="stakes">${stakes}</div>
       <ul class="rules">${rules || `<li>${t('menu.noInterest')}</li>`}</ul>
       <div class="row">
         <button data-action="back">${t('menu.back')}</button>
         <button data-action="tutorial">${t('menu.tutorial')}</button>
         <button class="primary" data-action="start">${t('menu.start')}</button>
       </div>`,
      {
        cup: (id) => {
          this.cup = id as CupId;
          this.cups();
        },
        stake: (n) => {
          this.stake = Number(n);
          this.cups();
        },
        back: () => this.title(),
        tutorial: () => this.actions.tutorial(),
        start: () => this.actions.play(this.cup, this.stake),
      },
    );
  }

  /** Les défis : ce qui reste à arracher au créancier, et où tu en es. */
  private challenges() {
    const all = this.progress.challenges();
    const done = all.filter((c) => c.done).length;
    const rows = all
      .sort((a, b) => Number(a.done) - Number(b.done) || b.cur / b.max - a.cur / a.max)
      .map((c) => bar(c.unlock.kind === 'relic' ? relicName(findRelic(c.unlock.id)) : t(`cup.${c.unlock.id}.name`), t(c.unlock.hint), c.cur, c.max, c.done))
      .join('');
    this.show(
      `<h2>${t('menu.challenges')} · ${done}/${all.length}</h2>
       <div class="challenges">${rows}</div>
       <div class="row"><button data-action="back">${t('menu.back')}</button></div>`,
      { back: () => this.title() },
    );
  }

  /** L'étagère : chaque relique découverte dans son bocal étiqueté. */
  private collection() {
    const catalog = relicCatalog(this.progress);
    const found = catalog.filter((c) => c.seen).length;
    const cards = catalog
      .map(({ def, unlocked, seen, unlock }) => {
        if (!unlocked) return `<div class="relic locked"><b>${t('menu.locked')}</b><span>${unlock ? t(unlock.hint) : ''}</span></div>`;
        if (!seen) return `<div class="relic unseen"><b>???</b><span>${t('menu.notSeen')}</span></div>`;
        return `<div class="relic ${def.rarity}"><b>${relicName(def)}</b><i>${rarityName(def.rarity)}</i><span>${relicDesc(def)}</span></div>`;
      })
      .join('');
    this.show(
      `<h2>${t('menu.collection')} · ${found}/${RELICS.length}</h2>
       <div class="relics">${cards}</div>
       <div class="row"><button data-action="back">${t('menu.back')}</button></div>`,
      { back: () => this.title() },
    );
  }

  /** Le registre du créancier : tout ce qu'il t'a pris, toutes runs confondues. */
  private registry() {
    const s = this.progress.stats;
    const parts = PARTS.map((p) => `<div class="line"><span>${t(`ledger.${p}`)}</span><b>${s.taken[p]}</b></div>`).join('');
    this.show(
      `<h2>${t('menu.registry')}</h2>
       <div class="registry">
         <div class="col">${parts}</div>
         <div class="col">
           <div class="line"><span>${t('stats.runs')}</span><b>${s.runs}</b></div>
           <div class="line"><span>${t('stats.wins')}</span><b>${s.wins}</b></div>
           <div class="line"><span>${t('stats.bestNight')}</span><b>${s.bestNight}</b></div>
           <div class="line"><span>${t('stats.hands')}</span><b>${s.hands}</b></div>
           <div class="line"><span>${t('stats.bosses')}</span><b>${s.bossesBeaten}</b></div>
           <div class="line"><span>${t('stats.pacts')}</span><b>${s.pacts}</b></div>
           <div class="line"><span>${t('stats.bestPaid')}</span><b>${(s.bestPaid ?? 0).toLocaleString()}</b></div>
           <div class="line"><span>${t('stats.bestHand')}</span><b>${(s.bestHand ?? 0).toLocaleString()}</b></div>
           <div class="line"><span>${t('stats.clutches')}</span><b>${s.clutches ?? 0}</b></div>
         </div>
       </div>
       <div class="row"><button data-action="back">${t('menu.back')}</button></div>`,
      { back: () => this.title() },
    );
  }

  /** Réglages ; `back` dit où revenir (titre ou pause). */
  settings(back: () => void) {
    const st = this.progress.settings;
    this.show(
      `<h2>${t('menu.settings')}</h2>
       <div class="setting"><span>${t('menu.language')}</span>${this.langSwitch()}</div>
       <div class="setting"><span>${t('menu.volume')}</span><input type="range" min="0" max="100" value="${Math.round(st.volume * 100)}" data-action="volume"></div>
       <div class="setting"><span>${t('menu.softGore')}<small>${t('menu.softGoreHint')}</small></span>
         <button data-action="gore" class="${st.softGore ? 'on' : ''}">${st.softGore ? t('menu.on') : t('menu.off')}</button></div>
       <div class="setting"><span>${t('menu.simpleThrow')}<small>${t('menu.simpleThrowHint')}</small></span>
         <button data-action="simple" class="${st.simpleThrow ? 'on' : ''}">${st.simpleThrow ? t('menu.on') : t('menu.off')}</button></div>
       <div class="setting"><span>${t('menu.fullscreen')}</span><button data-action="fullscreen">${t('menu.toggle')}</button></div>
       <div class="setting"><span>${t('menu.reset')}<small>${t('menu.resetHint')}</small></span><button data-action="reset">${t('menu.resetButton')}</button></div>
       <div class="row"><button data-action="back">${t('menu.back')}</button></div>`,
      {
        lang: this.setLangAnd(() => this.settings(back)),
        gore: () => {
          this.progress.updateSettings({ softGore: !st.softGore });
          this.actions.settings();
          this.settings(back);
        },
        simple: () => {
          this.progress.updateSettings({ simpleThrow: !st.simpleThrow });
          this.actions.settings();
          this.settings(back);
        },
        fullscreen: () => {
          if (document.fullscreenElement) void document.exitFullscreen();
          else void document.documentElement.requestFullscreen?.();
        },
        reset: () => {
          if (!window.confirm(t('menu.resetConfirm'))) return;
          this.progress.wipe();
          this.settings(back);
        },
        back,
      },
    );
  }

  /** Le bilan de la run : imprimé comme un relevé de compte, à la fin. */
  summary(s: RunSummary, again: () => void, toMenu: () => void) {
    const line = (k: string, v: string) => `<div class="line"><span>${k}</span><b>${v}</b></div>`;
    this.show(
      `<div class="summary">
         <h2>${s.won ? t('summary.won') : t('summary.lost')}</h2>
         <div class="cause">${s.cause}</div>
         ${s.short ? `<div class="short">${t('summary.short', { n: s.short })}</div>` : ''}
         ${s.records.length ? `<div class="stamps">${s.records.map((r) => `<span class="stamp">${r}</span>`).join('')}</div>` : ''}
         ${line(t('summary.reached'), s.reached)}
         ${line(t('summary.paid'), s.paid)}
         ${line(t('summary.best'), s.best)}
         ${line(t('summary.hands'), String(s.hands))}
         ${line(t('summary.pacts'), String(s.pacts))}
         ${line(t('summary.lostParts'), s.lost || '—')}
         <div class="relics-list">${t('summary.relics')} ${s.relics || '—'}</div>
         ${s.next.length ? `<div class="next"><b>${t('summary.next')}</b>${s.next.map((n) => bar(n.reward, n.hint, n.cur, n.max)).join('')}</div>` : ''}
       </div>
       <div class="row">
         <button class="primary" data-action="again">${t('summary.again')}</button>
         <button data-action="menu">${t('summary.menu')}</button>
       </div>`,
      { again: () => again(), menu: () => toMenu() },
    );
  }

  /** Pause pendant une run (Échap). */
  pause(onResume: () => void, onQuit: () => void) {
    this.show(
      `<h2>${t('menu.pause')}</h2>
       <div class="buttons">
         <button class="primary" data-action="resume">${t('menu.resume')}</button>
         <button data-action="settings">${t('menu.settings')}</button>
         <button data-action="quit">${t('menu.quit')}</button>
       </div>`,
      {
        resume: () => onResume(),
        settings: () => this.settings(() => this.pause(onResume, onQuit)),
        quit: () => onQuit(),
      },
    );
  }

  /** Petite notification (déblocages). */
  toast(text: string) {
    this.toastEl.innerHTML = text;
    this.toastEl.classList.add('show');
    window.clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => this.toastEl.classList.remove('show'), 3500);
  }
}
