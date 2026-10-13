import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { Ambience } from './ambience';
import { BossProps } from './bossProps';
import { Creditor } from './creditor/creditor';
import { Cup } from './cup';
import { Die } from './dice';
import { CHIPS_COLOR, COIN_COLOR, FloatTexts, MULT_COLOR, XMULT_COLOR } from './floatText';
import { Hud, ticketLines } from './hud';
import { fmtNum, plural, setLang, t } from './i18n';
import { bossName, bossRule, comboName, dieDesc, dieName, modName, partEffect, partName, rarityName, relicDesc, relicName } from './i18n/names';
import { Menu, type RunSummary } from './menu';
import { MousePrompt } from './mousePrompt';
import { PlayerHands } from './playerHands';
import { Printer } from './printer';
import { CoinShower } from './coinShower';
import { VialRack } from './vialRack';
import { VIALS } from './rules/vials';
import { Progress } from './progress';
import { PactScene } from './pact';
import { Particles } from './render/particles';
import { ps1ify } from './render/ps1';
import { buildRelicMesh, RelicShelf } from './relicShelf';
import type { BodyPartId } from './rules/body';
import { CLOCKMAKER_SECONDS } from './rules/bosses';
import { COMBOS, evaluateBest, type BestResult, type ComboId } from './rules/combos';
import { DIE_TYPES, faceOf, newDie, type Face } from './rules/dice';
import type { Effect } from './rules/relics';
import { CUPS } from './rules/cups';
import { findRelic } from './rules/relics';
import { MAX_PACTS, needsTarget, RunState, type Earnings, type RunOptions } from './rules/run';
import { scoreHand, type ScoreBreakdown, type ScoreStep } from './rules/scoring';
import type { Stage } from './scene';
import type { Sfx } from './sfx';
import { itemTooltip, levelLine, ShopPanel } from './shopUi';
import { Suitcase } from './suitcase';
import { DiceTable } from './table';
import { CUP_INNER_RADIUS, CUP_WALL } from './config';

/** Vitesse du gobelet au lâcher au-delà de laquelle un lancer compte comme violent. */
const VIOLENT_THROW = 25;

// Gros plan de la boutique : la valise en haut, le tapis de garde et le rebord en bas.
const SHOP_LOOK = new THREE.Vector3(-0.5, 0.5, 3.4);
const SHOP_FROM = new THREE.Vector3(-0.5, 11.5, 14.8);

// Intro du tutoriel : le gobelet sort de l'ombre derrière la planche, puis glisse vers le joueur.
const INTRO_CUP_FROM = new THREE.Vector3(3.6, 0.8, -14);
const INTRO_CUP_TO = new THREE.Vector3(4.6, 0, -4.2);

type Phase = 'menu' | 'intro' | 'play' | 'scoring' | 'payout' | 'pact' | 'shop' | 'over';

const SCORE_NOTES = [0, 3, 5, 7, 10, 12, 15, 17, 19, 22, 24];
const SCORE_BASE_HZ = 262;
const PAYOUT_DURATION = 1.6;
// Le créancier s'impatiente si le joueur ne fait rien pendant ce délai (secondes).
const PATIENCE = 5;
const IMPATIENCE_RAMP = 10;
// Usure : un dé en verre ou une face crâne cède au troisième usage.
const WEAR_LIMIT = 3;
const CURSE_PER_ZERO = 1.5;
const MOTHER_TOLL = 1;

/** Effets d'image et de caméra que la run déclenche. */
export interface Fx {
  jolt(amount: number): void;
  tear(amount: number): void;
  aberration(amount: number): void;
  dim(level: number, instant?: boolean): void;
  pressure(level: number): void;
  eyes(lost: number): void;
  lean(point: THREE.Vector3 | null, from?: THREE.Vector3): void;
}

interface Sequence {
  breakdown: ScoreBreakdown;
  faces: Face[];
  next: number;
  nextAt: number;
  totalAt: number;
  endAt: number;
}

/** La run : échéances, scoring animé, boss, pactes, boutique, fin de partie. */
export class Game {
  private phase: Phase = 'menu';
  /** Réglages de la dernière run lancée, pour « rejouer » (touche R). */
  private lastOptions: RunOptions = {};
  private readonly menu: Menu;
  /** Le tutoriel rallume l'ampoule progressivement. */
  private lightUp = 1;
  /** Intro muette du tutoriel : début et étape en cours. */
  private introAt = 0;
  private introStage = 0;
  private pactSkippable = false;
  /** Pour le bilan de fin : total payé et meilleure main de la run. */
  private runPaid = 0;
  private runHands = 0;
  private bestHand: { name: string; score: number } | null = null;
  /** Dernier appui : sur un écran tactile, il n'y a pas de survol pour lire les infobulles. */
  private lastTap = { x: 0, y: 0, touch: false };
  /** Article de la valise montré au premier toucher ; un second toucher l'achète. */
  private touchArmed: string | null = null;
  private handsShown = true;
  /** Actions différées (mise en scène), annulées à chaque nouvelle run. */
  private timers: { at: number; fn: () => void }[] = [];
  private coinsRecorded = false;
  private run = new RunState();
  private readonly table: DiceTable;
  private readonly shelf: RelicShelf;
  private readonly floats: FloatTexts;
  private readonly suitcase: Suitcase;
  private readonly mousePrompt: MousePrompt;
  private readonly cigSmoke: Particles;
  private readonly cigTip = new THREE.Vector3(-6.0, 1.12, -9.3);
  private nextPuff = 0;
  private readonly hands: PlayerHands;
  private readonly printer: Printer;
  private readonly coinShower: CoinShower;
  private readonly vialRack: VialRack;
  /** Laudanum bu : la prochaine main jouée compte ×2. */
  private laudanum = false;
  /** Encre de seiche débouchée : le prochain dé cliqué sera retourné. */
  private inking = -1;
  private hoveredVial = -1;
  /** Pièces gagnées mais encore en vol : la pile ne les montre qu'une fois rangées. */
  private coinsPending = 0;
  /** Mains jouées dans l'échéance, imprimées à la suite sur le ticket. */
  private ticketLog: { name: string; gain: number }[] = [];
  /** Gros plan sur le ticket : automatique en début d'échéance, ou Tab / clic droit maintenu. */
  private ticketZoom: 'auto' | 'held' | null = null;
  private readonly panel = new ShopPanel();
  /** Article acheté qui attend qu'on désigne un dé sur le tapis. */
  private targeting: number | null = null;
  private readonly creditor: Creditor;
  private readonly ambience: Ambience;
  private readonly smoke: Particles;
  private readonly chips: Particles;
  private readonly pact: PactScene;
  private readonly bossProps: BossProps;
  private lastAction = 0;

  private clock = 0;
  private rollsThisHand = 0;
  private freeRerollUsed = false;
  /** Seringue : relance d'un seul dé déjà offerte pendant cette main. */
  private syringeUsed = false;
  /** Gobelet fêlé : dés qui valent +1 jusqu'à leur prochaine relance. */
  private readonly cracked = new Set<number>();
  /** Faces œil déjà ouvertes pendant cette main : chacune ne donne sa relance qu'une fois. */
  private readonly eyesOpened = new Set<number>();
  private result: BestResult | null = null;
  private previousResult: BestResult | null = null;
  private revealed = false;
  private sequence: Sequence | null = null;
  private earnings: Earnings | null = null;
  private payoutUntil = 0;
  private flash = '';
  private flashUntil = 0;
  /** L'Aveugle : les faces se dévoilent seulement au scoring. */
  private unveiled = false;
  /** L'Horloger : instant où la main sera jouée d'office. */
  private deadline: number | null = null;
  /** Le Créancier a déjà retourné un dé pour cette main ; validation différée après le geste. */
  private flipped = false;
  private validateAt: number | null = null;

  constructor(
    private readonly stage: Stage,
    private readonly cup: Cup,
    private readonly dice: Die[],
    private readonly sfx: Sfx,
    private readonly hud: Hud,
    private readonly fx: Fx,
    private readonly progress: Progress,
    world: RAPIER.World,
  ) {
    // Fumée de feutre : grosse, floue, lente, qui monte à peine.
    this.smoke = new Particles(stage.scene, { max: 320, life: [1.1, 2.0], size: [0.45, 2.4], alpha: 0.14, gravity: 0.3, drag: 2, softness: 1 });
    // Copeaux de bois (et éclats de verre) : petits, nets, qui retombent.
    // La cigarette du créancier : une fumée lente qui monte dans le faisceau et s'y enroule.
    this.cigSmoke = new Particles(stage.scene, { max: 160, life: [3.5, 5.5], size: [0.25, 3.2], alpha: 0.1, gravity: 0.55, drag: 0.6, softness: 1 });
    this.buildAshtray(stage.scene);
    this.chips = new Particles(stage.scene, { max: 360, life: [0.7, 1.4], size: [0.16, 0.1], alpha: 0.95, gravity: -16, drag: 0.8, softness: 0.25 });
    this.table = new DiceTable(
      stage,
      cup,
      dice,
      sfx,
      {
        canRoll: () => this.canRoll(),
        canKeep: () => this.phase === 'play' && this.rollsThisHand > 0,
        onRollStart: () => this.onRollStart(),
        onRollRefused: () => this.showFlash(t('flash.weak')),
        onSettled: () => this.onSettled(),
        onRevealed: () => {
          this.revealed = true;
          if (this.result && !this.hidden()) this.hud.popCombo(this.result);
          if (this.run.bossIs('horloger')) this.deadline = this.clock + CLOCKMAKER_SECONDS;
        },
      },
      { dust: (at, amount) => this.dust(at, amount) },
    );
    this.shelf = new RelicShelf(stage.scene);
    this.floats = new FloatTexts(stage.scene);
    this.ambience = new Ambience(sfx);
    this.creditor = new Creditor(stage.scene, {
      tap: () => this.sfx.play('tap', 0.7),
      scratch: () => this.sfx.play('scratch', 0.9),
      clap: () => this.sfx.play('clap', 1),
      slam: () => this.onSlam(),
      chips: (at) => this.woodChips(at),
      tear: () => this.sfx.burst({ type: 'bandpass', freq: 3200, freqEnd: 1600, q: 0.8, duration: 0.55, volume: 0.7 }),
    });
    this.creditor.objects.forEach(ps1ify);
    this.pact = new PactScene(stage.scene, sfx, fx, this.creditor);
    this.bossProps = new BossProps(stage.scene);
    this.suitcase = new Suitcase(stage.scene, sfx);
    this.mousePrompt = new MousePrompt(stage.scene);
    this.hands = new PlayerHands(stage.scene);
    this.printer = new Printer(stage.scene, sfx);
    this.coinShower = new CoinShower(world, stage.scene, sfx);
    this.vialRack = new VialRack(this.printer.root);
    this.bindInput(stage.renderer.domElement);
    this.menu = new Menu(progress, {
      play: (cup, stake) => this.startRun({ cup, stake }),
      daily: () => this.startRun({ cup: 'cuir', stake: 0, seed: Progress.dailySeed(), daily: true }),
      tutorial: () => this.startTutorial(),
      settings: () => this.applySettings(),
    });
    progress.onUnlock((u) => {
      const what = u.kind === 'relic' ? relicName(findRelic(u.id)) : t(`cup.${u.id}.name`);
      this.menu.toast(t('flash.unlocked', { what }));
      this.sfx.tone(COIN_HZ * 1.5, 0.3, 0.2);
    });
    this.applySettings();
    // La table attend, dés dans le gobelet, pendant que le menu est ouvert.
    this.syncDice(true);
    this.table.collectDice();
    this.menu.warning(() => {
      this.sfx.unlock();
      this.ambience.start();
      this.menu.title();
    });
  }

  // ---------------------------------------------------------------- entrées

  private bindInput(canvas: HTMLCanvasElement) {
    const wake = () => {
      this.sfx.unlock();
      this.ambience.start();
      this.lastAction = this.clock;
    };
    window.addEventListener('pointerdown', wake);
    window.addEventListener('keyup', (e) => {
      if (e.code === 'Tab') this.holdTicket(false);
    });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    window.addEventListener('pointerup', (e) => {
      if (e.button === 2) this.holdTicket(false);
    });
    window.addEventListener('keydown', (e) => {
      wake();
      if (this.menu.open) return;
      if (e.code === 'Escape' && this.targeting !== null) {
        this.cancelTarget();
      } else if (e.code === 'Escape') {
        if (this.phase === 'over') this.openMenu();
        else this.menu.pause(() => this.menu.hide(), () => this.quitRun());
      } else if (e.code === 'Space') {
        e.preventDefault();
        this.validate();
      } else if (e.code === 'Tab') {
        e.preventDefault();
        if (!e.repeat) this.holdTicket(true);
      } else if (e.code === 'KeyR' && !e.ctrlKey && !e.metaKey && this.phase === 'over') {
        this.startRun(this.lastOptions.daily ? { ...this.lastOptions } : { cup: this.lastOptions.cup, stake: this.lastOptions.stake });
      } else if (/^Digit[1-6]$/.test(e.code)) {
        // Les chiffres suivent les dés en jeu, dans l'ordre.
        const active = this.run.activeDice();
        const die = active[Number(e.code.slice(5)) - 1];
        if (die !== undefined) this.table.toggleKeepIndex(die);
      }
    });
    // Infobulles : reliques sur le rebord, dés sur la table. La table met le rayon à jour juste avant.
    canvas.addEventListener('pointerdown', (e) => {
      this.lastTap = { x: e.clientX, y: e.clientY, touch: e.pointerType === 'touch' };
      if (e.button === 2) return this.holdTicket(true);
      // Au toucher, une relique du rebord se lit d'un appui (hors boutique, où elle ouvre son menu).
      if (this.lastTap.touch && this.phase !== 'shop') {
        const relic = this.run.relics[this.shelf.pick(this.table.raycaster)];
        if (relic) {
          const status = relic.def.status ? `<br><b>${relic.def.status(relic.state)}</b>` : '';
          this.hud.showTooltip(`<b>${relicName(relic.def)}</b> · ${rarityName(relic.def.rarity)}<br>${relicDesc(relic.def)}${status}`, e.clientX, e.clientY, true);
          return;
        }
        this.hud.hideTooltip();
      }
      // Un clic pendant le gros plan automatique : on se rassoit tout de suite.
      if (this.ticketZoom === 'auto') return this.endTicketZoom();
      // Encre débouchée : le dé cliqué se retourne.
      if (this.inking >= 0 && this.phase === 'play') {
        const die = this.table.pickDie();
        if (die >= 0 && !this.dice[die].kept) this.pourInk(die);
        else {
          this.inking = -1;
          this.showFlash(t('flash.inkCancel'));
        }
        return;
      }
      // Une fiole sur la caisse.
      if (this.phase === 'play') {
        const v = this.vialRack.pick(this.table.raycaster);
        if (v >= 0) return this.useVial(v);
      }
      // Au toucher (ni Tab ni clic droit) : un appui sur le ticket le lit de près, un second joue la main.
      if (this.lastTap.touch && this.phase === 'play') {
        const onTicket = this.printer.pick(this.table.raycaster);
        if (this.ticketZoom === 'held') {
          this.holdTicket(false);
          if (onTicket && this.canValidate()) this.validate();
          return;
        }
        if (onTicket) return this.holdTicket(true);
      }
      // Valider la main : un clic sur le ticket (ou Espace).
      if (this.phase === 'play' && this.printer.pick(this.table.raycaster) && this.canValidate()) return this.validate();
      if (this.phase === 'shop') this.shopClick();
      if (this.phase === 'pact' && this.pact.busy && !this.pact.awaitingSignature && this.pactSkippable) this.pact.skip();
      else if (this.phase === 'pact') this.pact.click(this.table.raycaster);
    });
    canvas.addEventListener('pointermove', (e) => {
      if (this.table.holding) return this.hud.hideTooltip();
      const vial = this.phase === 'play' || this.phase === 'shop' ? this.vialRack.pick(this.table.raycaster) : -1;
      this.hoveredVial = vial;
      if (vial >= 0) {
        const id = this.run.vials[vial];
        canvas.style.cursor = this.phase === 'play' ? 'pointer' : 'default';
        return this.hud.showTooltip(`<b>${t(`vial.${id}.name`, {}, VIALS[id].name)}</b><br>${t(`vial.${id}.desc`, {}, VIALS[id].description)}<br><i>${t('tip.vialUse')}</i>`, e.clientX, e.clientY);
      }
      if (this.phase === 'play' && this.printer.pick(this.table.raycaster)) {
        canvas.style.cursor = this.canValidate() ? 'pointer' : 'default';
        return this.hud.showTooltip(this.canValidate() ? t('ticket.validate') : t('ticket.read'), e.clientX, e.clientY);
      }
      if (this.phase === 'pact') {
        canvas.style.cursor = this.pact.hover(this.table.raycaster) ? 'pointer' : 'default';
        return this.hud.hideTooltip();
      }
      if (this.phase === 'shop' && this.targeting === null) {
        const target = this.suitcase.pick(this.table.raycaster);
        this.suitcase.hover(target);
        canvas.style.cursor = target ? 'pointer' : 'default';
        if (target?.kind === 'item') {
          const item = this.run.shop[target.index];
          if (item) return this.hud.showTooltip(itemTooltip(item), e.clientX, e.clientY);
        }
        if (target?.kind === 'bell') return this.hud.showTooltip(t('shop.bell', { n: this.run.rerollCost }), e.clientX, e.clientY);
        if (target?.kind === 'lid') return this.hud.showTooltip(t('shop.lid'), e.clientX, e.clientY);
      }
      const i = this.shelf.pick(this.table.raycaster);
      const relic = this.run.relics[i];
      if (relic) {
        const status = relic.def.status ? `<br><b>${relic.def.status(relic.state)}</b>` : '';
        return this.hud.showTooltip(
          `<b>${relicName(relic.def)}</b> · ${rarityName(relic.def.rarity)}<br>${relicDesc(relic.def)}${status}`,
          e.clientX,
          e.clientY,
        );
      }
      const hit = this.table.raycaster.intersectObjects(this.dice.filter((d) => d.active).map((d) => d.mesh), false)[0];
      const die = hit ? this.dice.findIndex((d) => d.mesh === hit.object) : -1;
      const owned = this.run.dice[die];
      if (!owned) return this.hud.hideTooltip();
      const type = DIE_TYPES[owned.type];
      const mods = owned.mods.map((m, f) => (m ? `<br>${t('shop.face', { v: type.faces[f], mod: modName(m) })}` : '')).join('');
      const pending = this.targeting !== null ? this.run.shop[this.targeting] : null;
      const action = pending ? `<br><b>${pending.kind === 'die' ? t('shop.clickReplace') : t('shop.clickEngrave')}</b>` : '';
      canvas.style.cursor = pending ? 'pointer' : 'default';
      this.hud.showTooltip(`<b>${dieName(owned.type)}</b><br>${dieDesc(owned.type)}${mods}${action}`, e.clientX, e.clientY);
    });
  }

  // ---------------------------------------------------------------- dés

  /** Les faces sont-elles cachées ? (deux yeux perdus, ou l'Aveugle avant le scoring) */
  private hidden() {
    return this.run.body.blind || (this.run.bossIs('aveugle') && !this.unveiled);
  }

  /** Accorde les dés physiques au sac du joueur : nombre en jeu, matière, gravures. */
  private syncDice(activity: boolean) {
    const active = new Set(this.run.activeDice());
    const hidden = this.hidden();
    this.dice.forEach((d, i) => {
      const owned = this.run.dice[i];
      if (activity) d.setActive(!!owned && active.has(i));
      if (owned) d.setLook(DIE_TYPES[owned.type], owned.mods, hidden);
    });
  }

  /** Faces visibles des dés en jeu, avec leur vraie valeur et leur gravure. */
  private faces(): Face[] {
    const faces = this.table.faces().map(({ die, face }) => {
      const f = faceOf(this.run.dice[die], face, die);
      if (!this.cracked.has(die) || f.value === 0) return f;
      return { ...f, value: Math.min(f.value + 1, Math.max(...DIE_TYPES[this.run.dice[die].type].faces)) };
    });
    // Face jumelle : elle prend la valeur du dé posé le plus près d'elle.
    return faces.map((f) => {
      if (f.mod !== 'jumelle') return f;
      const here = this.dice[f.die].mesh.position;
      let best: Face | null = null;
      let bestD = Infinity;
      for (const o of faces) {
        if (o === f || o.mod === 'jumelle') continue;
        const d = this.dice[o.die].mesh.position.distanceTo(here);
        if (d < bestD) {
          bestD = d;
          best = o;
        }
      }
      return best ? { ...f, value: best.value } : f;
    });
  }

  private evaluate(faces: Face[]) {
    return evaluateBest(
      faces.map((f) => f.value),
      this.run.effectiveLevels(),
      faces.map((f) => f.mod === 'crane'),
    );
  }

  // ---------------------------------------------------------------- lancers

  private freeRerollAvailable() {
    return this.run.has('mainCoupee') && !this.freeRerollUsed;
  }

  /** Seringue : une relance d'un seul dé par main ne coûte rien. */
  private syringeAvailable() {
    return this.run.has('seringue') && !this.syringeUsed && this.dice.filter((d) => d.active && !d.kept).length === 1;
  }

  private canRoll() {
    if (this.phase !== 'play' || this.run.hands <= 0 || this.validateAt !== null) return false;
    if (this.rollsThisHand === 0) return true;
    if (this.run.bossIs('mere') && this.run.coins < MOTHER_TOLL) return false;
    return this.run.rerolls > 0 || this.freeRerollAvailable() || this.syringeAvailable();
  }

  private onRollStart() {
    this.lastAction = this.clock;
    this.deadline = null;
    this.rollsThisHand++;
    if (this.rollsThisHand > 1) {
      if (this.syringeAvailable()) {
        this.syringeUsed = true;
        this.showFlash(t('flash.syringe'));
      } else if (this.freeRerollAvailable()) {
        this.freeRerollUsed = true;
        this.showFlash(t('flash.freeReroll'));
      } else {
        this.run.rerolls--;
      }
      // La Mère se fait payer chaque relance.
      if (this.run.bossIs('mere')) {
        this.run.coins -= MOTHER_TOLL;
        this.floats.spawn(`-${MOTHER_TOLL} $`, COIN_COLOR, new THREE.Vector3(-1.6, 1.5, -7.9), this.clock);
      }
    }
    // Les dés relancés perdent le +1 du Gobelet fêlé.
    for (const i of [...this.cracked]) if (!this.dice[i].kept) this.cracked.delete(i);
    this.result = null;
    this.revealed = false;
  }

  private onSettled() {
    // Gobelet percé : au premier lancer de la main, un dé passe par le trou.
    if (this.run.leaky && this.rollsThisHand === 1) {
      const loose = this.table.faces().filter(({ die }) => !this.dice[die].kept);
      const victim = loose[this.run.rng.int(loose.length)];
      if (victim) this.table.dropDie(victim.die);
    }
    // Gobelet fêlé : un lancer violent fend un dé, qui vaut +1.
    if (this.run.has('gobeletFele') && this.table.lastThrowSpeed >= VIOLENT_THROW) {
      const loose = this.table.faces().filter(({ die }) => !this.dice[die].kept && !this.cracked.has(die));
      const victim = loose[this.run.rng.int(loose.length)];
      if (victim) {
        this.cracked.add(victim.die);
        this.showFlash(t('flash.cracked'));
        this.floats.spawn('+1', CHIPS_COLOR, this.dice[victim.die].mesh.position.clone().add(new THREE.Vector3(0, 1, 0)), this.clock);
      }
    }
    const faces = this.faces();
    // Face œil : elle te regarde, et t'accorde une relance de plus pour la main.
    for (const f of faces) {
      if (f.mod !== 'oeil' || this.eyesOpened.has(f.die)) continue;
      this.eyesOpened.add(f.die);
      this.run.rerolls++;
      this.showFlash(t('flash.eye'));
      this.floats.spawn('+1', CHIPS_COLOR, this.dice[f.die].mesh.position.clone().add(new THREE.Vector3(0, 1, 0)), this.clock);
    }
    // Tutoriel : le créancier tapote les dés qui méritent d'être gardés.
    if (this.run.tutorial && this.rollsThisHand === 1 && this.run.handsPlayed === 0 && this.run.echeance === 0) {
      const byValue = new Map<number, number[]>();
      for (const f of faces) byValue.set(f.value, [...(byValue.get(f.value) ?? []), f.die]);
      const group = [...byValue.values()].sort((a, b) => b.length - a.length)[0] ?? [];
      const pick = group.length >= 2 ? group : [faces.reduce((a, b) => (b.value > a.value ? b : a)).die];
      this.creditor.point(pick.map((d) => this.dice[d].mesh.position.clone()));
    }
    const result = this.evaluate(faces);
    // Pièce trouée : une relance qui n'améliore pas la combinaison la nourrit.
    if (this.previousResult && result.score <= this.previousResult.score) {
      this.run.relics.forEach((r, i) => {
        if (r.def.id !== 'pieceTrouee') return;
        r.state.mult++;
        this.shelf.pulse(i, this.clock);
        this.floats.spawn('+1 Mult', MULT_COLOR, this.shelf.position(i), this.clock);
      });
    }
    // Une face clou cloue son dé dans le tapis jusqu'à la fin de la main.
    for (const f of faces) if (f.mod === 'clou') this.table.forceKeep(f.die);

    this.previousResult = result;
    this.result = result;
    const valueOf = new Map(faces.map((f, k) => [f.die, result.values[k]]));
    this.table.startReveal(
      result.scoring.map((k) => faces[k].die),
      (die) => valueOf.get(die) ?? 0,
      this.hidden(),
    );
    this.lastAction = this.clock;
    // Le créancier lit le lancer en même temps que le joueur (sauf s'il a la bouche cousue).
    if (this.run.has('sourireCousu')) return;
    if (result.combo.id === 'cinq') this.creditor.clap();
    else if (result.combo.id === 'deHaut' || result.combo.id === 'paire') this.creditor.sneer(result.combo.id === 'deHaut' ? 1 : 0.7);
    else this.creditor.wince();
  }

  // ---------------------------------------------------------------- scoring

  validate() {
    if (this.phase !== 'play' || !this.table.idle || this.rollsThisHand === 0 || this.validateAt !== null) return;
    this.deadline = null;

    // Le Créancier, une main sur deux : il retourne ton meilleur dé sur sa pire face.
    if (this.run.bossIs('creancier') && this.run.handsPlayed % 2 === 1 && !this.flipped) {
      this.flipped = true;
      const faces = this.faces().filter((f) => this.run.dice[f.die].type !== 'plomb');
      if (faces.length > 0) {
        const best = faces.reduce((a, b) => (b.value > a.value ? b : a));
        const owned = this.run.dice[best.die];
        const worst = DIE_TYPES[owned.type].faces.reduce((w, v, f, all) => (v < all[w] ? f : w), 0);
        this.table.flip(best.die, worst);
        this.creditor.sneer(1);
        this.showFlash(t('flash.creditorFlip'));
        this.validateAt = this.clock + 0.9;
        return;
      }
    }

    this.unveiled = true;
    const shown = this.faces();
    const result = this.evaluate(shown);
    // Les jokers (faces crâne) comptent pour la valeur qu'ils ont prise.
    const faces = shown.map((f, k) => ({ ...f, value: result.values[k] }));
    const disabled = new Set<number>();
    if (this.run.bossIs('pretre')) for (let i = 0; i <= this.run.handsPlayed; i++) disabled.add(i);
    const breakdown = scoreHand(faces, result, this.run.relics, {
      isFirstHand: this.run.handsPlayed === 0,
      handsLeftAfter: this.run.hands - 1,
      rerollsUsed: Math.max(0, this.rollsThisHand - 1),
      curse: this.run.curse,
      body: this.run.body,
      previousCombo: this.run.played.at(-1) ?? null,
      disabledRelics: disabled,
      onlyPairs: this.run.bossIs('comptable'),
      halved: this.run.bossIs('jumeau') && this.run.played.includes(result.combo.id),
      leech: this.run.bossIs('sangsue'),
      laudanum: this.laudanum,
    });
    this.phase = 'scoring';
    this.result = result;
    this.hud.showTally(result.level > 1 ? `${comboName(result.combo.id)} ${t('hud.level', { n: result.level })}` : comboName(result.combo.id));
    this.hud.setTally(breakdown.steps[0].chips, breakdown.steps[0].mult);
    this.sfx.play('wood', 0.8);
    this.sequence = { breakdown, faces, next: 1, nextAt: this.clock + 0.4, totalAt: -1, endAt: -1 };
  }

  private stepScoring() {
    const seq = this.sequence;
    if (!seq) return;
    const steps = seq.breakdown.steps;
    while (seq.next < steps.length && this.clock >= seq.nextAt) {
      this.playStep(steps[seq.next], seq.next, seq.faces);
      seq.next++;
      // Le rythme accélère quand les déclenchements s'enchaînent.
      seq.nextAt += Math.max(0.12, 0.3 - seq.next * 0.015);
    }
    if (seq.next >= steps.length && seq.totalAt < 0) seq.totalAt = Math.max(this.clock, seq.nextAt) + 0.15;
    if (seq.totalAt > 0 && seq.endAt < 0 && this.clock >= seq.totalAt) {
      this.hud.setTallyTotal(seq.breakdown.total);
      this.sfx.tone(SCORE_BASE_HZ * 2, 0.5, 0.25, 'square');
      this.sfx.tone(SCORE_BASE_HZ * 3, 0.5, 0.15);
      // Une main qui pèse : l'ampoule s'emballe, l'or jaillit des dés qui ont marqué.
      const weight = Math.min(1, seq.breakdown.total / Math.max(1, this.run.target - this.run.score));
      if (weight > 0.35) {
        this.stage.flare.value = Math.max(this.stage.flare.value, weight);
        this.fx.jolt(0.25 + weight * 0.4);
        this.fx.aberration(0.003 * weight);
        for (const k of seq.breakdown.steps.filter((st) => st.kind === 'die').map((st) => st.die!)) {
          const at = this.dice[seq.faces[k].die].mesh.position;
          for (let i = 0; i < 6 + Math.round(weight * 10); i++) {
            this.chips.emit({
              position: at.clone().add(new THREE.Vector3(0, 0.5, 0)),
              velocity: new THREE.Vector3((Math.random() - 0.5) * 5, 3 + Math.random() * 5, (Math.random() - 0.5) * 5),
              color: new THREE.Color(1, 0.75 + Math.random() * 0.2, 0.25),
              scale: 0.4 + Math.random() * 0.5,
            });
          }
        }
      }
      seq.endAt = this.clock + 1.0;
    }
    if (seq.endAt > 0 && this.clock >= seq.endAt) this.finishScoring(seq);
  }

  private playStep(step: ScoreStep, index: number, faces: Face[]) {
    this.hud.setTally(step.chips, step.mult);
    if (step.effect.coins) this.run.coins += step.effect.coins;
    const note = SCORE_BASE_HZ * 2 ** (SCORE_NOTES[Math.min(index, SCORE_NOTES.length - 1)] / 12);
    const die = step.die !== undefined ? this.dice[faces[step.die].die] : null;
    if (step.kind === 'die' && die) {
      die.flash();
      this.floats.spawn(`+${step.effect.chips}`, CHIPS_COLOR, die.mesh.position, this.clock);
      this.sfx.tone(note, 0.12, 0.22);
    } else if (step.kind === 'face' && die) {
      const [text, color] = effectLabel(step.effect);
      this.floats.spawn(text, color, die.mesh.position.clone().add(new THREE.Vector3(0, 0.6, 0)), this.clock);
      this.sfx.tone(note * 1.5, 0.1, 0.22, 'square');
    } else if (step.kind === 'relic' && step.relic !== undefined) {
      this.shelf.pulse(step.relic, this.clock);
      const [text, color] = effectLabel(step.effect);
      this.floats.spawn(text, color, this.shelf.position(step.relic), this.clock, step.effect.xmult ? 1.2 : 0.9);
      if (step.effect.xmult) this.sfx.tone(note / 2, 0.3, 0.3, 'sawtooth');
      else this.sfx.tone(note, 0.12, 0.25, 'square');
    } else {
      // Malédiction ou règle du boss : le texte vient de l'ardoise.
      const [text, color] = effectLabel(step.effect);
      this.floats.spawn(step.label ? `${t(`step.${step.label}`)} ${text}` : text, color, new THREE.Vector3(0, 2.5, -7.6), this.clock, 1.1);
      this.sfx.tone(note / 2, 0.4, 0.3, 'sawtooth');
    }
  }

  private finishScoring(seq: Sequence) {
    const { breakdown, faces } = seq;
    this.sequence = null;
    this.lastAction = this.clock;
    const result = this.result!;
    // Une main qui paie toute l'échéance d'un coup : le poing du créancier se referme.
    if (breakdown.total >= this.run.target - this.run.score && !this.run.has('sourireCousu')) this.creditor.clench();
    this.hud.hideTally();
    this.run.score += breakdown.total;
    this.ticketLog.push({ name: comboName(result.combo.id), gain: breakdown.total });
    this.runPaid += breakdown.total;
    this.laudanum = false;
    this.runHands++;
    if (!this.bestHand || breakdown.total > this.bestHand.score) this.bestHand = { name: comboName(result.combo.id), score: breakdown.total };
    this.run.hands--;
    this.run.handsPlayed++;
    this.run.addBleed(breakdown.bled);
    if (!this.run.tutorial) {
      const five = result.combo.id === 'cinq';
      this.progress.record({ type: 'hand', five, fiveOfOnes: five && faces.every((f) => f.value === 1) });
    }
    this.run.played.push(result.combo.id);
    for (const r of this.run.relics) r.def.afterHand?.(r.state);
    // Les 0 des dés maudits maudissent la main suivante.
    const zeros = faces.filter((f) => f.type === 'maudit' && f.value === 0).length;
    this.run.curse = CURSE_PER_ZERO ** zeros;
    // Usure : le verre qui a marqué, les crânes qui ont servi de joker.
    const worn = new Set<number>(breakdown.glassUsed.map((k) => faces[k].die));
    result.scoring.forEach((k) => faces[k].mod === 'crane' && worn.add(faces[k].die));
    for (const die of worn) {
      const owned = this.run.dice[die];
      if (++owned.wear >= WEAR_LIMIT) this.shatter(die);
    }

    this.rollsThisHand = 0;
    this.freeRerollUsed = false;
    this.syringeUsed = false;
    this.cracked.clear();
    this.eyesOpened.clear();
    this.result = null;
    this.previousResult = null;
    this.revealed = false;
    this.unveiled = false;
    this.flipped = false;
    // Le dé tombé par le trou du gobelet revient pour la main suivante.
    this.syncDice(true);
    this.table.collectDice();

    if (this.run.score >= this.run.target) this.startPayout();
    else if (this.run.hands === 0) this.fail();
    else this.phase = 'play';
  }

  /** Un dé usé se brise ; un dé en os ordinaire prend sa place. */
  private shatter(die: number) {
    const name = dieName(this.run.dice[die].type);
    const at = this.dice[die].mesh.position.clone();
    this.run.dice[die] = newDie('os');
    for (let i = 0; i < 14; i++) {
      this.chips.emit({
        position: at.clone(),
        velocity: new THREE.Vector3((Math.random() - 0.5) * 6, 2 + Math.random() * 4, (Math.random() - 0.5) * 6),
        color: new THREE.Color(0.75, 0.9, 0.9),
        scale: 0.5 + Math.random() * 0.6,
      });
    }
    this.sfx.burst({ type: 'highpass', freq: 3500, duration: 0.3, volume: 0.8 });
    this.sfx.burst({ type: 'bandpass', freq: 6000, q: 4, duration: 0.5, volume: 0.4, delay: 0.05 });
    this.showFlash(t('flash.shatter', { name }));
    this.syncDice(false);
  }

  // ---------------------------------------------------------------- fin d'échéance

  private startPayout() {
    this.phase = 'payout';
    this.earnings = this.run.earnings();
    this.run.coins += this.earnings.total;
    this.payoutUntil = this.clock + PAYOUT_DURATION;
    if (this.run.tutorial && this.run.echeance === 0) this.creditor.showSmile(true);
    if (this.run.isBoss && !this.run.tutorial) this.progress.record({ type: 'boss' });
    if (this.run.isFinal) {
      this.phase = 'over';
      this.progress.endRun(this.run.cup, this.run.stake, true);
      // Le sourire s'efface ; les mains déchirent le contrat, puis reculent dans le noir.
      this.creditor.tearContract(() => {
        this.creditor.vanish();
        this.hud.showBanner(t('banner.win'), t('banner.winSub'));
        this.later(3.5, () => this.showSummary(true, t('summary.causeWin')));
        this.sfx.tone(SCORE_BASE_HZ, 1.2, 0.3);
      });
      return;
    }
    if (this.heartGiven()) return;
    this.hud.showBanner(this.run.isBoss ? t('banner.nightDone', { n: this.run.night }) : t('banner.paid'), t('banner.coins', { n: this.earnings.total }));
    this.payCoins(this.earnings.total);
    this.sfx.tone(COIN_HZ, 0.15, 0.25, 'square');
    this.sfx.tone(COIN_HZ * 1.5, 0.25, 0.2, 'square');
  }

  /** Le créancier jette la paie sur la table ; les pièces finissent sur ta pile. */
  private payCoins(total: number) {
    if (total <= 0) return;
    this.coinsPending += total;
    this.payoutUntil = Math.max(this.payoutUntil, this.clock + 3.2);
    const run = this.run;
    this.creditor.toss(() => {
      if (this.run !== run) return;
      this.coinShower.throw(
        new THREE.Vector3(1.8, 2.6, -5.6),
        total,
        () => this.printer.coinWorld(this.run.coins - this.coinsPending),
        (value) => {
          this.coinsPending = Math.max(0, this.coinsPending - value);
          this.printer.setCoins(this.run.coins - this.coinsPending, false);
        },
      );
    });
  }

  private stepPayout() {
    if (this.clock < this.payoutUntil) return;
    this.hud.hideBanner();
    // Le gobelet du créancier n'a pas de boutique la première nuit.
    if (this.run.skipsShop) this.leaveShop();
    else this.openShop();
  }

  private openShop() {
    this.phase = 'shop';
    this.ambience.setShop(true);
    this.run.openShop();
    for (const item of this.run.shop) if (item?.kind === 'relic') this.progress.discover(item.def.id);
    this.bossProps.show(null, this.clock);
    this.fillSuitcase(true);
    this.suitcase.open();
    // On se penche sur la valise : les articles et leurs prix se lisent, le tapis de dés reste en bas.
    this.fx.lean(SHOP_LOOK, SHOP_FROM);
    // Tes dés s'alignent sur le tapis : ce sont les cibles des burins et des échanges.
    this.table.displayInTray(
      this.run.dice.map((_, i) => i),
      (i) => {
        const owned = this.run.dice[i];
        const values = DIE_TYPES[owned.type].faces.map((v, f) => (owned.mods[f] === 'vide' ? 0 : v));
        return values.indexOf(Math.max(...values));
      },
    );
    this.panel.bar(this.run, this.earnings);
  }

  // ---------------------------------------------------------------- pactes

  /** Échéance ratée : le créancier glisse son contrat. Au boss final, pas de pacte. */
  private fail() {
    const boss = this.run.boss;
    if (!this.run.canPact) {
      // Pas de second pacte la même nuit, ni face au créancier lui-même.
      if (this.run.pactsSigned >= MAX_PACTS) this.showFlash(t('flash.noMorePacts'));
      else if (this.run.pactNight === this.run.night) this.showFlash(t('flash.oncePerNight'));
      return this.gameOver();
    }
    const available = this.run.body.available();
    let options: BodyPartId[];
    if (this.run.tutorial) {
      // Le premier pacte ne laisse pas le choix : un doigt.
      options = ['doigt'];
    } else if (boss?.pact && boss.pact !== 'mort' && available.includes(boss.pact)) {
      options = [boss.pact];
    } else {
      const pool = [...available];
      options = [];
      while (options.length < 3 && pool.length > 0) options.push(pool.splice(this.run.rng.int(pool.length), 1)[0]);
    }
    this.phase = 'pact';
    this.creditor.knock(1, () => {
      if (this.phase !== 'pact') return;
      this.pact.offer(
        options,
        (part) => this.sign(part),
        () => this.gameOver(),
      );
    });
  }

  private sign(part: BodyPartId) {
    // La mise en scène ne se passe pas la première fois ; ensuite, un clic l'abrège.
    this.pactSkippable = this.progress.stats.pacts > 0;
    this.run.signPact(part);
    if (!this.run.tutorial) this.progress.record({ type: 'pact', part, inRun: this.run.body.pacts });
    this.sfx.toneAt(0, 196, 180, 0.6, 0.2); // le pouce sur le papier
    this.creditor.sneer(1);
    this.pact.play(part, () => this.afterPact(part));
  }

  private afterPact(part: BodyPartId) {
    // Fin du tutoriel : la partie continue telle quelle, avec le doigt en moins et la relique achetée.
    if (this.run.tutorial) {
      this.progress.finishTutorial();
      this.run.endTutorial();
      this.lastOptions = { cup: 'cuir', stake: 0 };
      this.progress.record({ type: 'pact', part, inRun: this.run.body.pacts });
    }
    this.applyBody();
    this.showFlash(t('flash.part', { name: partName(part), effect: partEffect(part).toLowerCase() }));
    if (this.heartGiven()) return;
    this.earnings = null;
    this.openShop();
  }

  /** Boire (ou verser) une fiole. Seulement pendant une main, gobelet posé. */
  private useVial(index: number) {
    const id = this.run.vials[index];
    if (!id || !this.table.idle) return this.sfx.tone(140, 0.2, 0.2, 'square');
    if (id === 'encre') {
      if (this.rollsThisHand === 0) return this.showFlash(t('flash.inkNeedDice'));
      this.inking = index;
      this.showFlash(t('flash.inkPick'));
      return;
    }
    this.consumeVial(index);
    if (id === 'sang') {
      this.run.rerolls += 2;
      this.showFlash(t('flash.vialBlood'));
    } else if (id === 'laudanum') {
      this.laudanum = true;
      this.showFlash(t('flash.vialLaudanum'));
      this.fx.aberration(0.01);
    }
  }

  /** La fiole est vidée : un glouglou, un hoquet de verre, elle disparaît de la caisse. */
  private consumeVial(index: number) {
    this.run.vials.splice(index, 1);
    this.vialRack.sync(this.run.vials);
    this.sfx.burst({ type: 'bandpass', freq: 500, freqEnd: 260, q: 4, duration: 0.5, volume: 0.6 });
    this.sfx.tone(900, 0.06, 0.12, 'triangle');
  }

  /** L'encre noircit le dé et le retourne sur sa face opposée. */
  private pourInk(die: number) {
    const index = this.inking;
    this.inking = -1;
    this.consumeVial(index);
    const current = this.table.faces().find((f) => f.die === die);
    if (!current) return;
    this.table.flip(die, 5 - current.face);
    for (let i = 0; i < 12; i++) {
      this.smoke.emit({
        position: this.dice[die].mesh.position.clone(),
        velocity: new THREE.Vector3((Math.random() - 0.5) * 1.5, 0.6 + Math.random(), (Math.random() - 0.5) * 1.5),
        color: new THREE.Color(0.05, 0.06, 0.1),
        scale: 0.6,
      });
    }
    this.showFlash(t('flash.vialInk'));
    // Une fois le dé reposé, on relit la table.
    this.later(0.9, () => {
      if (this.phase !== 'play') return;
      const faces = this.faces();
      const result = this.evaluate(faces);
      this.result = result;
      const valueOf = new Map(faces.map((f, k) => [f.die, result.values[k]]));
      this.table.startReveal(result.scoring.map((k) => faces[k].die), (d) => valueOf.get(d) ?? 0, this.hidden());
      if (!this.hidden()) this.hud.popCombo(result);
    });
  }

  /** Un cendrier en fer-blanc sur la planche du créancier, une cigarette qui se consume. */
  private buildAshtray(scene: THREE.Scene) {
    const tin = new THREE.MeshStandardMaterial({ color: 0x6a6460, metalness: 0.7, roughness: 0.45 });
    const tray = new THREE.Mesh(new THREE.CylinderGeometry(0.62, 0.52, 0.18, 14), tin);
    tray.position.set(-6.2, 0.89, -9.4);
    const ash = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.5, 0.02, 12), new THREE.MeshStandardMaterial({ color: 0x3a3632, roughness: 1 }));
    ash.position.set(-6.2, 0.97, -9.4);
    const paper = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.7, 6), new THREE.MeshStandardMaterial({ color: 0xe8e2d4, roughness: 0.8 }));
    paper.rotation.z = Math.PI / 2 - 0.15;
    paper.rotation.y = 0.5;
    paper.position.set(-6.25, 1.06, -9.37);
    const ember = new THREE.Mesh(new THREE.SphereGeometry(0.06, 6, 4), new THREE.MeshBasicMaterial({ color: 0xff5a10 }));
    ember.position.copy(this.cigTip).add(new THREE.Vector3(0, -0.06, 0));
    const glow = new THREE.PointLight(0xff5010, 1.2, 1.6, 2);
    glow.position.copy(this.cigTip);
    for (const m of [tray, ash, paper]) m.castShadow = m.receiveShadow = true;
    scene.add(tray, ash, paper, ember, glow);
  }

  /** Le relevé de fin de run, par-dessus la table assombrie. */
  private showSummary(won: boolean, cause: string) {
    if (this.phase !== 'over') return;
    this.hud.hideBanner();
    const r = this.run;
    if (r.daily) {
      const rank = won ? 999 : r.night * 3 + r.echeance;
      this.progress.recordDaily(rank, won ? t('summary.won') : r.isBoss ? t('where.boss', { n: r.night }) : t('where.echeance', { n: r.night, e: r.echeance + 1 }));
    }
    const s: RunSummary = {
      won,
      cause,
      reached: r.isBoss ? t('where.boss', { n: r.night }) : t('where.echeance', { n: r.night, e: r.echeance + 1 }),
      paid: fmt(this.runPaid),
      best: this.bestHand ? `${this.bestHand.name} · ${fmt(this.bestHand.score)}` : '—',
      hands: this.runHands,
      pacts: r.body.pacts,
      lost: bodySummary(r),
      relics: r.relics.map((x) => relicName(x.def)).join(', '),
    };
    this.menu.summary(s, () => this.startRun(this.lastOptions.daily ? { ...this.lastOptions } : { cup: this.lastOptions.cup, stake: this.lastOptions.stake }), () => this.openMenu());
  }

  /** Le cœur a été donné et la nuit s'achève : la run s'arrête là. */
  private heartGiven() {
    if (!(this.run.lastNight === this.run.night && this.run.isBoss)) return false;
    this.phase = 'over';
    this.progress.endRun(this.run.cup, this.run.stake, false);
    this.stage.lightLevel.value = 0.3;
    this.fx.dim(0.45);
    this.hud.showBanner(t('banner.heart'), t('banner.heartSub', { n: this.run.night }));
    this.later(4, () => this.showSummary(false, t('summary.causeHeart')));
    [0, 1.2, 2.8].forEach((d) => this.sfx.toneAt(d, 58, 36, 0.18, 0.7));
    return true;
  }

  /** Les sens suivent le corps : la vue et l'ouïe perdues le restent. */
  private applyBody() {
    this.sfx.setDeaf(this.run.body.ear);
    this.fx.eyes(this.run.body.eyes);
    this.cup.setBlind(this.run.body.blind);
    this.hands.setBody(this.run.body);
    // Avec une seule main, le gobelet tremble pendant la secousse.
    this.table.tremble = this.run.body.hand ? 1 : 0;
  }

  private gameOver() {
    this.phase = 'over';
    this.progress.endRun(this.run.cup, this.run.stake, false);
    const { night, echeance, score, target } = this.run;
    const where = echeance === 2 ? t('where.boss', { n: night }) : t('where.echeance', { n: night, e: echeance + 1 });
    // Il frappe deux fois. Puis la lumière baisse.
    this.creditor.knock(2, () => {
      if (this.phase !== 'over') return;
      // Noir complet : on n'entend plus que ce qui se passe.
      this.stage.lightLevel.value = 0;
      this.fx.dim(0, true);
      this.sfx.tone(98, 1.4, 0.35, 'sawtooth');
      this.sfx.tone(92, 1.6, 0.3, 'sawtooth');
      this.sfx.burst({ type: 'lowpass', freq: 500, duration: 0.5, volume: 0.9, delay: 1.1 });
      this.sfx.toneAt(1.15, 130, 40, 0.4, 0.6);
      // Puis le sourire, seul dans le noir : la dernière image.
      this.later(2.6, () => {
        if (this.phase !== 'over') return;
        this.creditor.showSmile(true);
        this.fx.dim(0.55);
        this.hud.showBanner(t('banner.death'), t('banner.deathSub', { where, score: fmt(score), target: fmt(target) }));
        this.later(3.2, () => this.showSummary(false, t('summary.causeDeath', { where })));
      });
    });
  }

  // ---------------------------------------------------------------- effets

  /** Bouffée de poussière soulevée du feutre. */
  private dust(at: THREE.Vector3, amount: number) {
    const n = 1 + Math.round(amount * 4);
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = 0.6 + Math.random() * 1.2 * (0.5 + amount);
      const grey = 0.5 + Math.random() * 0.15;
      this.smoke.emit({
        position: new THREE.Vector3(at.x + Math.cos(a) * 0.3, 0.12, at.z + Math.sin(a) * 0.3),
        velocity: new THREE.Vector3(Math.cos(a) * r, 0.25 + Math.random() * 0.5, Math.sin(a) * r),
        color: new THREE.Color(grey, grey * 0.95, grey * 0.85),
        scale: 0.6 + amount * 0.8,
      });
    }
  }

  /** Copeaux et sciure qui jaillissent d'un trou creusé dans l'ardoise. */
  private woodChips(at: THREE.Vector3) {
    // L'ardoise est penchée vers le joueur : les éclats partent vers l'avant et vers le haut.
    for (let i = 0; i < 2; i++) {
      const light = Math.random() < 0.6;
      this.chips.emit({
        position: at.clone(),
        velocity: new THREE.Vector3((Math.random() - 0.5) * 3, 1.5 + Math.random() * 3, 1 + Math.random() * 2.5),
        color: light ? new THREE.Color(0.72, 0.5, 0.3) : new THREE.Color(0.35, 0.2, 0.1),
        scale: 0.6 + Math.random() * 0.8,
      });
    }
    if (Math.random() < 0.35) {
      this.smoke.emit({
        position: at.clone(),
        velocity: new THREE.Vector3((Math.random() - 0.5) * 0.6, 0.3, 0.6),
        color: new THREE.Color(0.45, 0.32, 0.2),
        scale: 0.35,
      });
    }
  }

  /** Le poing du créancier touche la table : tout tremble, l'image se déchire. */
  private onSlam() {
    this.sfx.knock();
    this.fx.jolt(1);
    this.fx.tear(0.9);
    this.fx.aberration(0.008);
    this.table.hop();
  }

  // ---------------------------------------------------------------- boutique

  /** Clic pendant la boutique : un article, la sonnette, le couvercle, un dé cible, une relique. */
  private shopClick() {
    if (!this.suitcase.isOpen) return;
    const ray = this.table.raycaster;
    if (this.targeting !== null) {
      const die = this.table.pickDie();
      if (die < 0 || !this.run.dice[die]) {
        // Un clic dans la valise pendant le choix annule l'achat en cours.
        if (this.suitcase.pick(ray)) this.cancelTarget();
        return;
      }
      const index = this.targeting;
      const item = this.run.shop[index];
      if (item?.kind === 'burin') {
        this.panel.pickFace(this.run.dice[die], modName(item.mod), (face) => this.complete(index, die, face), () => this.cancelTarget());
      } else {
        this.complete(index, die);
      }
      return;
    }
    const relic = this.shelf.pick(ray);
    if (relic >= 0) return this.openRelicMenu(relic);
    const target = this.suitcase.pick(ray);
    if (!target) {
      this.touchArmed = null;
      this.hud.hideTooltip();
      return;
    }
    // Écran tactile : le premier appui montre ce que fait l'article, le second l'achète.
    if (this.lastTap.touch && target.kind !== 'lid') {
      const key = target.kind === 'item' ? `item:${target.index}` : target.kind;
      if (this.touchArmed !== key) {
        this.touchArmed = key;
        this.suitcase.hover(target);
        const item = target.kind === 'item' ? this.run.shop[target.index] : null;
        const html = item ? itemTooltip(item) : t('shop.bell', { n: this.run.rerollCost });
        this.hud.showTooltip(`${html}<br><i>${t('shop.tapAgain')}</i>`, this.lastTap.x, this.lastTap.y, true);
        return;
      }
    }
    this.touchArmed = null;
    this.hud.hideTooltip();
    if (target.kind === 'bell') {
      if (!this.run.rerollShop()) return this.sfx.tone(140, 0.2, 0.2, 'square');
      this.suitcase.ring();
      this.fillSuitcase(true);
      this.panel.bar(this.run, this.earnings);
    } else if (target.kind === 'lid') {
      this.panel.hide();
      this.hud.hideTooltip();
      this.suitcase.close(() => this.leaveShop());
    } else {
      const item = this.run.shop[target.index];
      if (!item || !this.run.canBuy(target.index)) return this.sfx.tone(140, 0.2, 0.2, 'square');
      if (needsTarget(item)) {
        this.targeting = target.index;
        this.hud.hideTooltip();
        this.suitcase.hover(null);
        this.highlightTargets(true);
        const what = item.kind === 'die' ? t('shop.askReplace', { die: dieName(item.type).toLowerCase() }) : t('shop.askEngrave');
        this.panel.ask(this.run, what, () => this.cancelTarget());
      } else {
        this.complete(target.index);
      }
    }
  }

  private cancelTarget() {
    this.targeting = null;
    this.highlightTargets(false);
    this.panel.bar(this.run, this.earnings);
  }

  /** Pendant le choix d'une cible, tes dés s'illuminent sur le tapis. */
  private highlightTargets(on: boolean) {
    this.run.dice.forEach((_, i) => this.dice[i].setHighlight(on));
  }

  /** Achat confirmé : l'objet s'envole vers sa place, puis la valise se remet à jour. */
  private complete(index: number, die = -1, face = -1) {
    this.targeting = null;
    this.highlightTargets(false);
    const item = this.run.buy(index, die, face);
    if (!item) return this.sfx.tone(140, 0.2, 0.2, 'square');
    this.sfx.tone(COIN_HZ, 0.1, 0.25, 'square');
    this.sfx.tone(COIN_HZ * 1.26, 0.18, 0.2, 'square');
    let to: THREE.Vector3;
    if (item.kind === 'relic') to = this.shelf.position(this.run.relics.length - 1).add(new THREE.Vector3(0, 0.4, 0));
    else if (item.kind === 'fiole') to = this.printer.root.localToWorld(new THREE.Vector3(1.15, 0.5, 2.0 + (this.run.vials.length - 1) * 1.0));
    else if (item.kind === 'gravure') to = new THREE.Vector3(0, 1.8, -8.2);
    else to = this.dice[die].mesh.position.clone();
    this.suitcase.flyAway(index, to, () => {
      if (item.kind === 'relic') this.shelf.sync(this.run.relics);
      else if (item.kind === 'fiole') this.vialRack.sync(this.run.vials);
      else if (item.kind === 'gravure') this.showFlash(t('flash.levelUp', { name: comboName(item.combo), n: this.run.levels[item.combo] ?? 1 }));
      else {
        this.syncDice(false);
        // Burin : le dé se retourne pour montrer la face qu'on vient de graver.
        if (item.kind === 'burin' && face >= 0) this.table.turnUp(die, face, () => this.dice[die].flash());
        else this.dice[die].flash();
      }
    });
    this.refreshShop();
  }

  private openRelicMenu(index: number) {
    this.panel.relicMenu(this.run, index, {
      sell: () => {
        const sold = this.run.relics[index];
        if (sold) {
          // Il traverse la table, ramasse la relique et la fait disparaître dans sa manche.
          const copy = buildRelicMesh(sold.def.id);
          copy.position.copy(this.shelf.position(index));
          ps1ify(copy);
          this.stage.scene.add(copy);
          this.creditor.snatch(copy);
        }
        this.run.sell(index);
        this.progress.record({ type: 'sold' });
        this.sfx.tone(523, 0.12, 0.2);
        this.shelf.sync(this.run.relics);
        this.refreshShop();
      },
      move: (delta) => {
        this.run.moveRelic(index, delta);
        this.shelf.sync(this.run.relics);
        this.openRelicMenu(index + delta);
      },
      close: () => this.panel.bar(this.run, this.earnings),
    });
  }

  /** Remplit la valise avec les articles du moment. */
  private fillSuitcase(fresh: boolean) {
    const canReroll = this.run.coins >= this.run.rerollCost;
    if (fresh) this.suitcase.setItems(this.run.shop, (i) => this.run.canBuy(i), this.run.rerollCost, canReroll);
    else this.suitcase.refreshTags(this.run.shop, (i) => this.run.canBuy(i), this.run.rerollCost, canReroll);
  }

  private refreshShop() {
    this.fillSuitcase(false);
    this.panel.bar(this.run, this.earnings);
  }

  private leaveShop() {
    this.fx.lean(null);
    this.panel.hide();
    this.targeting = null;
    this.earnings = null;
    const wasBoss = this.run.isBoss;
    this.run.advance();
    if (wasBoss && !this.run.tutorial) {
      this.progress.record({ type: 'night', reached: this.run.night, boneOnly: this.run.dice.every((d) => d.type === 'os') });
    }
    this.ambience.setShop(false);
    this.startEcheance();
    this.sfx.play('wood', 0.7);
  }

  /** Nouvelle échéance : les dés en jeu, l'objet du boss, l'objectif gravé. */
  private startEcheance() {
    this.phase = 'play';
    this.lastAction = this.clock;
    this.deadline = null;
    this.validateAt = null;
    this.syncDice(true);
    this.table.collectDice();
    const boss = this.run.boss;
    this.bossProps.show(boss?.id ?? null, this.clock);
    this.ticketLog = [];
    this.printTicket();
    if (boss) this.showFlash(t('flash.boss', { name: bossName(boss), rule: bossRule(boss) }));
    if (this.run.confiscated >= 0) this.showFlash(t('flash.confiscated', { die: dieName(this.run.dice[this.run.confiscated].type).toLowerCase() }));
  }

  /** Lance une run : gobelet, intérêts, reliques débloquées. */
  startRun(o: RunOptions) {
    this.lastOptions = o;
    this.menu.hide();
    this.timers = [];
    this.runPaid = 0;
    this.runHands = 0;
    this.bestHand = null;
    this.cup.mesh.visible = true;
    document.body.classList.remove('in-intro');
    this.run = new RunState({ ...o, unlocked: this.progress.unlockedRelics() });
    this.coinsRecorded = false;
    this.sequence = null;
    this.rollsThisHand = 0;
    this.freeRerollUsed = false;
    this.syringeUsed = false;
    this.cracked.clear();
    this.eyesOpened.clear();
    this.result = null;
    this.previousResult = null;
    this.revealed = false;
    this.unveiled = false;
    this.flipped = false;
    this.shelf.sync(this.run.relics);
    this.panel.hide();
    this.suitcase.reset();
    this.targeting = null;
    this.highlightTargets(false);
    this.hud.hideBanner();
    this.hud.hideTally();
    this.pact.reset();
    this.fx.lean(null);
    this.ticketZoom = null;
    this.printer.reset();
    this.coinShower.clear();
    this.coinsPending = 0;
    this.laudanum = false;
    this.inking = -1;
    this.vialRack.sync([]);
    this.table.reset();
    this.creditor.reset();
    this.cup.setTint(CUPS.find((c) => c.id === this.run.cup)?.tint ?? 0xffffff);
    this.lightUp = 1;
    this.stage.lightLevel.value = 1;
    this.fx.dim(1);
    this.applyBody();
    this.ambience.setShop(false);
    this.startEcheance();
  }

  private later(delay: number, fn: () => void) {
    this.timers.push({ at: this.clock + delay, fn });
    this.timers.sort((a, b) => a.at - b.at);
  }

  /** Le tutoriel muet : noir, l'ampoule s'allume, et le créancier montre tout du doigt. */
  startTutorial() {
    this.startRun({ tutorial: true });
    // Noir complet. Il était déjà là : l'ampoule grésille et le révèle.
    this.phase = 'intro';
    this.introAt = this.clock;
    // Le ticket sera lu après l'intro, pas dans le noir.
    this.timers = [];
    this.ticketZoom = null;
    this.fx.lean(null);
    this.introStage = 0;
    this.creditor.reset(); // pas de gravure avant qu'il ait posé le gobelet
    this.creditor.showSmile(false);
    this.stage.lightLevel.value = 0;
    this.fx.dim(0, true);
    this.dice.forEach((d) => d.setActive(false));
    this.cup.place(INTRO_CUP_FROM);
    this.cup.mesh.visible = false;
    document.body.classList.add('in-intro');
  }

  /** Noir, l'ampoule s'allume, il sort le gobelet de sa manche, le pousse vers toi, frappe la table. */
  private stepIntro() {
    const t = this.clock - this.introAt;
    if (this.introStage === 0 && t > 1.4) {
      this.introStage = 1;
      this.creditor.showSmile(true);
      this.sfx.burst({ type: 'bandpass', freq: 2600, q: 2, duration: 0.05, volume: 0.6 }); // l'interrupteur
    }
    if (this.introStage === 1) {
      // Grésillement de plus en plus stable, puis la lumière tient.
      const k = (t - 1.4) / 1.4;
      const on = k >= 1 || Math.sin(t * 41) + Math.sin(t * 17.3) > 1.2 - k * 2.4;
      const level = on ? 1 : 0.04;
      this.stage.lightLevel.value = level;
      this.fx.dim(level, true);
      if (k >= 1) this.introStage = 2;
    }
    if (this.introStage === 2 && t > 3.6) {
      this.introStage = 3;
      const upright = new THREE.Quaternion();
      this.creditor.pullCup(INTRO_CUP_FROM, INTRO_CUP_TO, CUP_INNER_RADIUS + CUP_WALL, (base) => {
        this.cup.mesh.visible = true;
        this.cup.drive(base, upright);
      }, () => {
        if (this.phase !== 'intro') return;
        this.sfx.burst({ type: 'lowpass', freq: 420, freqEnd: 180, duration: 1.5, volume: 0.55 }); // le cuir glisse sur le feutre
        const rest = this.cup.restPose();
        this.cup.moveTo(rest.position, rest.quaternion, 1.5, () => {
          if (this.phase !== 'intro') return;
          this.sfx.play('wood', 0.8);
          this.creditor.knock(2, () => this.endIntro());
        }, (k) => 1 - (1 - k) ** 3);
      });
    }
  }

  private endIntro() {
    if (this.phase !== 'intro') return;
    document.body.classList.remove('in-intro');
    this.phase = 'play';
    this.lastAction = this.clock;
    this.syncDice(true);
    this.table.collectDice();
    this.printTicket();
  }

  /**
   * Nouvelle échéance : l'imprimante crache le ticket et on se penche pour le lire,
   * puis on se rassoit et le créancier grave l'objectif. Un clic abrège.
   */
  private printTicket() {
    this.printer.setContent(ticketLines(this.hudState(), this.ticketLog), true);
    if (this.phase === 'intro') return;
    this.ticketZoom = 'auto';
    const f = this.printer.focus();
    this.fx.lean(f.look, f.from);
    const run = this.run;
    this.later(this.printer.printTime + 1.4, () => {
      if (this.run === run && this.ticketZoom === 'auto') this.endTicketZoom();
    });
  }

  private endTicketZoom() {
    const wasAuto = this.ticketZoom === 'auto';
    this.ticketZoom = null;
    if (this.phase !== 'pact') this.fx.lean(null);
    if (wasAuto && this.phase === 'play') this.creditor.engrave(fmt(this.run.target));
  }

  /** Tab ou clic droit maintenu : on se penche sur le ticket pour le relire. */
  private holdTicket(on: boolean) {
    if (on && this.ticketZoom === null && (this.phase === 'play' || this.phase === 'scoring' || this.phase === 'payout')) {
      this.ticketZoom = 'held';
      const f = this.printer.focus();
      this.fx.lean(f.look, f.from);
    } else if (!on && this.ticketZoom === 'held') {
      this.endTicketZoom();
    }
  }

  /** Retour au menu principal. */
  private openMenu() {
    this.phase = 'menu';
    this.timers = [];
    document.body.classList.remove('in-intro');
    this.hud.hideBanner();
    this.hud.hideTally();
    this.panel.hide();
    this.suitcase.reset();
    this.pact.reset();
    this.fx.lean(null);
    this.stage.lightLevel.value = 1;
    this.fx.dim(1);
    this.menu.title();
  }

  /** Quitter la table en pleine run : elle compte comme perdue. */
  private quitRun() {
    if (this.phase !== 'over' && !this.run.tutorial) this.progress.endRun(this.run.cup, this.run.stake, false);
    this.openMenu();
  }

  /** Réglages du menu appliqués au jeu : langue, volume, gore. */
  private applySettings() {
    const st = this.progress.settings;
    setLang(st.lang);
    this.sfx.setVolume(st.volume);
    this.pact.softGore = st.softGore;
    this.table.simpleThrow = !!st.simpleThrow;
  }

  // ---------------------------------------------------------------- boucle

  step(dt: number) {
    this.clock += dt;
    if (this.lightUp < 1 && this.phase === 'play') {
      // L'ampoule se rallume en grésillant.
      this.lightUp = Math.min(1, this.lightUp + dt / 2.5);
      this.stage.lightLevel.value = this.lightUp * (Math.random() < 0.15 ? 0.3 : 1);
    }
    if (!this.coinsRecorded && this.run.coins >= 40 && !this.run.tutorial) {
      this.coinsRecorded = true;
      this.progress.record({ type: 'coins', amount: this.run.coins });
    }
    if (this.phase === 'intro') this.stepIntro();
    while (this.timers.length > 0 && this.clock >= this.timers[0].at) this.timers.shift()!.fn();
    this.table.step(dt);
    this.pact.update(dt);
    this.pact.shelf.setLight(this.stage.lightLevel.value);
    this.hands.setLight(this.stage.lightLevel.value);
    this.printer.update(dt);
    this.coinShower.update(dt);
    this.vialRack.update(dt, this.hoveredVial);
    this.printer.setLight(this.stage.lightLevel.value);
    this.shelf.setLight(this.stage.lightLevel.value);
    if (this.phase === 'scoring') this.stepScoring();
    if (this.phase === 'payout') this.stepPayout();
    if (this.validateAt !== null && this.clock >= this.validateAt && this.table.idle) {
      this.validateAt = null;
      this.validate();
    }
    // L'Horloger joue la main à ta place quand le temps est écoulé.
    if (this.deadline !== null && this.phase === 'play' && this.table.idle && this.clock >= this.deadline) {
      this.deadline = null;
      this.showFlash(t('flash.clockmaker'));
      this.validate();
    }

    // Impatience : le joueur hésite, les doigts du créancier tapotent de plus en plus vite.
    const waiting = this.phase === 'play' && this.table.idle && !this.creditor.busy;
    const idle = this.clock - this.lastAction;
    this.creditor.setImpatience(waiting ? Math.min(1, Math.max(0, (idle - PATIENCE) / IMPATIENCE_RAMP)) : 0);
    this.creditor.update(dt, this.clock, this.stage.camera);
    this.bossProps.update(this.clock);
    this.suitcase.update(dt, this.clock);
    // Au début de chaque main, le gobelet s'entoure de jaune et une souris montre le geste.
    const awaitingRoll = this.phase === 'play' && this.table.idle && this.rollsThisHand === 0 && this.run.hands > 0 && this.validateAt === null && this.ticketZoom === null;
    this.cup.setPrompt(awaitingRoll);
    this.cup.updatePrompt(dt, this.clock);
    this.mousePrompt.show(awaitingRoll);
    this.mousePrompt.update(dt, this.clock, this.cup.position);
    // Pendant le pacte, seul le pouce qui signe est à l'écran.
    const showHands = this.phase !== 'pact';
    if (showHands !== this.handsShown) {
      this.handsShown = showHands;
      this.hands.setVisible(showHands);
      if (showHands) this.hands.setBody(this.run.body);
    }
    // La main droite reste posée sur le gobelet dès qu'il est de ton côté.
    const cupHome = this.phase !== 'intro' && this.cup.position.z > 4;
    this.hands.update(dt, this.clock, cupHome ? { position: this.cup.position, quaternion: this.cup.quaternion } : null, this.table.holding);
    this.smoke.update(dt);
    // Volutes : une bouffée de temps en temps, qui dérive avec l'air de la cave.
    if (this.clock >= this.nextPuff) {
      this.nextPuff = this.clock + 0.12 + Math.random() * 0.12;
      const drift = Math.sin(this.clock * 0.4) * 0.25;
      this.cigSmoke.emit({
        position: this.cigTip.clone(),
        velocity: new THREE.Vector3(drift + (Math.random() - 0.5) * 0.12, 0.45 + Math.random() * 0.2, 0.08 + (Math.random() - 0.5) * 0.1),
        color: new THREE.Color(0.78, 0.74, 0.68),
      });
    }
    this.cigSmoke.update(dt);
    this.chips.update(dt);
    this.ambience.update(dt);
    this.fx.pressure(this.pressure());
  }

  /** Pression de l'échéance : mains consommées sans que la dette ne baisse. */
  private pressure() {
    if (this.phase !== 'play' && this.phase !== 'scoring') return 0;
    const unpaid = 1 - Math.min(1, this.run.score / this.run.target);
    const spent = 1 - this.run.hands / 4;
    return unpaid * spent * 1.3;
  }

  /** L'ampoule vacille : le bourdonnement chute avec elle. */
  onFlicker(dark: boolean) {
    this.ambience.flicker(dark);
  }

  afterStep(events: RAPIER.EventQueue) {
    this.table.afterStep(events);
  }

  render() {
    this.syncDice(false);
    this.table.render();
    this.shelf.update(this.clock);
    this.floats.update(this.clock);
    const state = this.hudState();
    this.hud.update(state);
    if (this.phase !== 'menu') this.printer.setContent(ticketLines(state, this.ticketLog));
    this.printer.setCoins(this.run.coins - this.coinsPending);
    this.printer.setGlow(!!state.pulse);
  }

  private canValidate() {
    return this.phase === 'play' && this.table.idle && this.rollsThisHand > 0 && this.validateAt === null;
  }

  private hudState() {
    const levels = (Object.keys(COMBOS) as ComboId[])
      .filter((id) => (this.run.effectiveLevels()[id] ?? 1) > 1)
      .map((id) => levelLine(this.run, id));
    const boss = this.run.boss;
    return {
      night: this.run.night,
      echeance: this.run.echeance,
      isBoss: this.run.isBoss,
      target: this.run.target,
      score: this.run.score,
      hands: this.run.hands,
      rerolls: this.run.rerolls,
      coins: this.run.coins,
      combo: this.revealed && !this.hidden() ? this.result : null,
      levels,
      boss: boss ? { name: bossName(boss), rule: bossRule(boss) } : null,
      body: bodySummary(this.run),
      timer: this.deadline !== null && this.phase === 'play' ? Math.max(0, this.deadline - this.clock) : null,
      curse: this.run.curse,
      contracts: MAX_PACTS - this.run.pactsSigned,
      canValidate: this.canValidate(),
      // Tutoriel : le ticket luit dès le premier lancer, c'est là qu'on valide.
      pulse: this.run.tutorial && this.phase === 'play' && this.rollsThisHand > 0,
      hint: this.hint(),
    };
  }

  private showFlash(text: string) {
    this.flash = text;
    this.flashUntil = this.clock + 2.4;
  }

  private hint() {
    if (this.clock < this.flashUntil) return this.flash;
    switch (this.phase) {
      case 'menu':
      case 'intro':
        return '';
      case 'pact':
        return this.pact.awaitingSignature ? t('hint.sign') : '';
      case 'scoring':
      case 'payout':
        return '';
      case 'shop':
        return this.targeting !== null ? t('hint.pickDie') : '';
      case 'over':
        return t('hint.newRun');
      case 'play':
        if (this.table.holding) return t('hint.shake');
        if (this.table.rolling) return '';
        if (this.rollsThisHand === 0) return t(this.table.simpleThrow ? 'hint.grabSimple' : 'hint.grab');
        if (!this.canRoll() || !this.table.hasLooseDice()) return t('hint.validate');
        return t('hint.keep');
    }
  }

  /** Accès de débogage depuis la console du navigateur. */
  debug() {
    return {
      phase: this.phase,
      night: this.run.night,
      echeance: this.run.echeance,
      boss: this.run.boss?.id ?? null,
      score: this.run.score,
      target: this.run.target,
      hands: this.run.hands,
      rerolls: this.run.rerolls,
      coins: this.run.coins,
      relics: this.run.relics.map((r) => r.def.id),
      dice: this.run.dice.map((d) => d.type),
      body: { ...this.run.body },
      faces: this.faces().map((f) => f.value),
      result: this.result?.combo.id ?? null,
      idle: this.table.idle,
    };
  }
}

const COIN_HZ = 880;
const fmt = fmtNum;

function effectLabel(e: Effect): [string, string] {
  if (e.xmult !== undefined) return [`×${+e.xmult.toFixed(2)}`, XMULT_COLOR];
  if (e.mult) return [`+${e.mult} Mult`, MULT_COLOR];
  if (e.chips) return [`+${e.chips}`, CHIPS_COLOR];
  const c = e.coins ?? 0;
  return [`${c >= 0 ? '+' : ''}${c} $`, COIN_COLOR];
}

/** « 2 doigts · 1 œil · langue » : ce que le joueur a perdu. */
function bodySummary(run: RunState) {
  const b = run.body;
  const parts: string[] = [];
  if (b.fingers) parts.push(plural(b.fingers, 'body.finger'));
  if (b.teeth) parts.push(plural(b.teeth, 'body.tooth'));
  if (b.ear) parts.push(t('body.ear'));
  if (b.tongue) parts.push(t('body.tongue'));
  if (b.eyes) parts.push(plural(b.eyes, 'body.eye'));
  if (b.hand) parts.push(t('body.hand'));
  if (b.heart) parts.push(t('body.heart'));
  return parts.join(' · ');
}
