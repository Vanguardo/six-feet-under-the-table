import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { Ambience } from './ambience';
import { Creditor } from './creditor/creditor';
import { Cup } from './cup';
import { Die } from './dice';
import { CHIPS_COLOR, COIN_COLOR, FloatTexts, MULT_COLOR, XMULT_COLOR } from './floatText';
import { Hud } from './hud';
import { RelicShelf } from './relicShelf';
import { COMBOS, evaluate, type ComboId, type ComboResult } from './rules/combos';
import { RARITY_LABEL, type Effect } from './rules/relics';
import { RunState, type Earnings } from './rules/run';
import { scoreHand, type ScoreBreakdown, type ScoreStep } from './rules/scoring';
import type { Stage } from './scene';
import type { Sfx } from './sfx';
import { Particles } from './render/particles';
import { ps1ify } from './render/ps1';
import { levelLine, ShopUi } from './shopUi';
import { DiceTable } from './table';

type Phase = 'play' | 'scoring' | 'payout' | 'shop' | 'over';

const SCORE_NOTES = [0, 3, 5, 7, 10, 12, 15, 17, 19, 22, 24];
const SCORE_BASE_HZ = 262;
const PAYOUT_DURATION = 1.6;
// Le créancier s'impatiente si le joueur ne fait rien pendant ce délai (secondes).
const PATIENCE = 5;
const IMPATIENCE_RAMP = 10;

/** Effets d'image et de caméra que la run déclenche. */
export interface Fx {
  jolt(amount: number): void;
  tear(amount: number): void;
  aberration(amount: number): void;
  dim(level: number): void;
  pressure(level: number): void;
}

interface Sequence {
  breakdown: ScoreBreakdown;
  next: number;
  nextAt: number;
  totalAt: number;
  endAt: number;
}

/** La run : échéances, scoring animé, gains, boutique, fin de partie. */
export class Game {
  private phase: Phase = 'play';
  private run = new RunState();
  private readonly table: DiceTable;
  private readonly shelf: RelicShelf;
  private readonly floats: FloatTexts;
  private readonly shopUi: ShopUi;
  private readonly creditor: Creditor;
  private readonly ambience: Ambience;
  private readonly smoke: Particles;
  private readonly chips: Particles;
  private lastAction = 0;

  private clock = 0;
  private rollsThisHand = 0;
  private freeRerollUsed = false;
  private result: ComboResult | null = null;
  private previousResult: ComboResult | null = null;
  private revealed = false;
  private sequence: Sequence | null = null;
  private earnings: Earnings | null = null;
  private payoutUntil = 0;
  private flash = '';
  private flashUntil = 0;

  constructor(
    private readonly stage: Stage,
    cup: Cup,
    dice: Die[],
    private readonly sfx: Sfx,
    private readonly hud: Hud,
    private readonly fx: Fx,
  ) {
    // Fumée de feutre : grosse, floue, lente, qui monte à peine.
    this.smoke = new Particles(stage.scene, { max: 320, life: [1.1, 2.0], size: [0.45, 2.4], alpha: 0.14, gravity: 0.3, drag: 2, softness: 1 });
    // Copeaux de bois : petits, nets, qui retombent.
    this.chips = new Particles(stage.scene, { max: 360, life: [0.7, 1.4], size: [0.16, 0.1], alpha: 0.95, gravity: -16, drag: 0.8, softness: 0.25 });
    this.table = new DiceTable(stage, cup, dice, sfx, {
      canRoll: () => this.canRoll(),
      canKeep: () => this.phase === 'play' && this.rollsThisHand > 0,
      onRollStart: () => this.onRollStart(),
      onRollRefused: () => this.showFlash('Trop mou. Secoue plus longtemps.'),
      onSettled: () => this.onSettled(),
      onRevealed: () => {
        this.revealed = true;
        if (this.result) this.hud.popCombo(this.result);
      },
    }, { dust: (at, amount) => this.dust(at, amount) });
    this.shelf = new RelicShelf(stage.scene);
    this.floats = new FloatTexts(stage.scene);
    this.ambience = new Ambience(sfx);
    this.creditor = new Creditor(stage.scene, {
      tap: () => this.sfx.play('tap', 0.7),
      scratch: () => this.sfx.play('scratch', 0.9),
      clap: () => this.sfx.play('clap', 1),
      slam: () => this.onSlam(),
      chips: (at) => this.woodChips(at),
    });
    this.creditor.objects.forEach(ps1ify);
    this.creditor.engrave(fmt(this.run.target));
    this.shopUi = new ShopUi({
      buy: (i) => this.buy(i),
      reroll: () => {
        if (this.run.rerollShop()) this.sfx.play('wood', 0.6);
        this.renderShop();
      },
      sell: (i) => {
        this.run.sell(i);
        this.sfx.tone(523, 0.12, 0.2);
        this.shelf.sync(this.run.relics);
        this.renderShop();
      },
      move: (i, d) => {
        this.run.moveRelic(i, d);
        this.shelf.sync(this.run.relics);
        this.renderShop();
      },
      next: () => this.leaveShop(),
    });
    this.bindInput(stage.renderer.domElement);
  }

  // ---------------------------------------------------------------- entrées

  private bindInput(canvas: HTMLCanvasElement) {
    const wake = () => {
      this.sfx.unlock();
      this.ambience.start();
      this.lastAction = this.clock;
    };
    window.addEventListener('pointerdown', wake);
    window.addEventListener('keydown', (e) => {
      wake();
      if (e.code === 'Space') {
        e.preventDefault();
        this.validate();
      } else if (e.code === 'KeyR' && !e.ctrlKey && !e.metaKey) {
        this.newRun();
      } else if (/^Digit[1-5]$/.test(e.code)) {
        this.table.toggleKeepIndex(Number(e.code.slice(5)) - 1);
      }
    });
    // Infobulle des reliques posées sur le rebord. La table met le rayon à jour juste avant.
    canvas.addEventListener('pointermove', (e) => {
      const i = this.table.holding ? -1 : this.shelf.pick(this.table.raycaster);
      const relic = this.run.relics[i];
      if (!relic) return this.hud.hideTooltip();
      const status = relic.def.status ? `<br><b>${relic.def.status(relic.state)}</b>` : '';
      this.hud.showTooltip(
        `<b>${relic.def.name}</b> · ${RARITY_LABEL[relic.def.rarity]}<br>${relic.def.description}${status}`,
        e.clientX,
        e.clientY,
      );
    });
  }

  // ---------------------------------------------------------------- lancers

  private freeRerollAvailable() {
    return this.run.has('mainCoupee') && !this.freeRerollUsed;
  }

  private canRoll() {
    if (this.phase !== 'play' || this.run.hands <= 0) return false;
    return this.rollsThisHand === 0 || this.run.rerolls > 0 || this.freeRerollAvailable();
  }

  private onRollStart() {
    this.lastAction = this.clock;
    this.rollsThisHand++;
    if (this.rollsThisHand > 1) {
      if (this.freeRerollAvailable()) {
        this.freeRerollUsed = true;
        this.showFlash('Main coupée : relance gratuite');
      } else {
        this.run.rerolls--;
      }
    }
    this.result = null;
    this.revealed = false;
  }

  private onSettled() {
    const result = evaluate(this.table.values(), this.run.levels);
    // Pièce trouée : une relance qui n'améliore pas la combinaison la nourrit.
    if (this.previousResult && result.score <= this.previousResult.score) {
      this.run.relics.forEach((r, i) => {
        if (r.def.id !== 'pieceTrouee') return;
        r.state.mult++;
        this.shelf.pulse(i, this.clock);
        this.floats.spawn('+1 Mult', MULT_COLOR, this.shelf.position(i), this.clock);
      });
    }
    this.previousResult = result;
    this.result = result;
    this.table.startReveal(result);
    this.lastAction = this.clock;
    // Le créancier lit le lancer en même temps que le joueur.
    if (result.combo.id === 'cinq') this.creditor.clap();
    else if (result.combo.id === 'deHaut' || result.combo.id === 'paire') this.creditor.sneer(result.combo.id === 'deHaut' ? 1 : 0.7);
    else this.creditor.wince();
  }

  // ---------------------------------------------------------------- scoring

  validate() {
    if (this.phase !== 'play' || !this.table.idle || this.rollsThisHand === 0) return;
    const values = this.table.values();
    const result = evaluate(values, this.run.levels);
    const breakdown = scoreHand(values, result, this.run.relics, {
      isFirstHand: this.run.handsPlayed === 0,
      handsLeftAfter: this.run.hands - 1,
    });
    this.phase = 'scoring';
    this.hud.showTally(result.level > 1 ? `${result.combo.name} niv. ${result.level}` : result.combo.name);
    this.hud.setTally(breakdown.steps[0].chips, breakdown.steps[0].mult);
    this.sfx.play('wood', 0.8);
    this.sequence = { breakdown, next: 1, nextAt: this.clock + 0.4, totalAt: -1, endAt: -1 };
  }

  private stepScoring() {
    const seq = this.sequence;
    if (!seq) return;
    const steps = seq.breakdown.steps;
    while (seq.next < steps.length && this.clock >= seq.nextAt) {
      this.playStep(steps[seq.next], seq.next);
      seq.next++;
      // Le rythme accélère quand les déclenchements s'enchaînent.
      seq.nextAt += Math.max(0.12, 0.3 - seq.next * 0.015);
    }
    if (seq.next >= steps.length && seq.totalAt < 0) seq.totalAt = Math.max(this.clock, seq.nextAt) + 0.15;
    if (seq.totalAt > 0 && seq.endAt < 0 && this.clock >= seq.totalAt) {
      this.hud.setTallyTotal(seq.breakdown.total);
      this.sfx.tone(SCORE_BASE_HZ * 2, 0.5, 0.25, 'square');
      this.sfx.tone(SCORE_BASE_HZ * 3, 0.5, 0.15);
      seq.endAt = this.clock + 1.0;
    }
    if (seq.endAt > 0 && this.clock >= seq.endAt) this.finishScoring(seq.breakdown);
  }

  private playStep(step: ScoreStep, index: number) {
    this.hud.setTally(step.chips, step.mult);
    const note = SCORE_BASE_HZ * 2 ** (SCORE_NOTES[Math.min(index, SCORE_NOTES.length - 1)] / 12);
    if (step.kind === 'die' && step.die !== undefined) {
      this.table.dice[step.die].flash();
      this.floats.spawn(`+${step.effect.chips}`, CHIPS_COLOR, this.table.dice[step.die].mesh.position, this.clock);
      this.sfx.tone(note, 0.12, 0.22);
    } else if (step.kind === 'relic' && step.relic !== undefined) {
      this.shelf.pulse(step.relic, this.clock);
      const [text, color] = effectLabel(step.effect);
      this.floats.spawn(text, color, this.shelf.position(step.relic), this.clock, step.effect.xmult ? 1.2 : 0.9);
      if (step.effect.xmult) this.sfx.tone(note / 2, 0.3, 0.3, 'sawtooth');
      else this.sfx.tone(note, 0.12, 0.25, 'square');
    }
  }

  private finishScoring(breakdown: ScoreBreakdown) {
    this.sequence = null;
    this.lastAction = this.clock;
    // Une main qui paie toute l'échéance d'un coup : le poing du créancier se referme.
    if (breakdown.total >= this.run.target - this.run.score) this.creditor.clench();
    this.hud.hideTally();
    this.run.score += breakdown.total;
    this.run.hands--;
    this.run.handsPlayed++;
    for (const r of this.run.relics) r.def.afterHand?.(r.state);
    this.rollsThisHand = 0;
    this.freeRerollUsed = false;
    this.result = null;
    this.previousResult = null;
    this.revealed = false;
    this.table.collectDice();

    if (this.run.score >= this.run.target) this.startPayout();
    else if (this.run.hands === 0) this.gameOver();
    else this.phase = 'play';
  }

  // ---------------------------------------------------------------- fin d'échéance

  private startPayout() {
    this.phase = 'payout';
    this.earnings = this.run.earnings();
    this.run.coins += this.earnings.total;
    this.payoutUntil = this.clock + PAYOUT_DURATION;
    if (this.run.isFinal) {
      this.phase = 'over';
      this.creditor.vanish();
      this.hud.showBanner('DETTE PAYÉE', 'Le sourire disparaît. R pour une nouvelle run');
      this.sfx.tone(SCORE_BASE_HZ, 1.2, 0.3);
      return;
    }
    this.hud.showBanner(this.run.isBoss ? `NUIT ${this.run.night} TERMINÉE` : 'ÉCHÉANCE PAYÉE', `+${this.earnings.total} pièces`);
    this.sfx.tone(COIN_HZ, 0.15, 0.25, 'square');
    this.sfx.tone(COIN_HZ * 1.5, 0.25, 0.2, 'square');
  }

  private stepPayout() {
    if (this.clock < this.payoutUntil) return;
    this.hud.hideBanner();
    this.phase = 'shop';
    this.ambience.setShop(true);
    this.run.openShop();
    this.shopUi.show(this.run, this.earnings);
  }

  private gameOver() {
    this.phase = 'over';
    const { night, echeance, score, target } = this.run;
    const where = `Nuit ${night}, ${echeance === 2 ? 'boss' : `échéance ${echeance + 1}`}`;
    // Il frappe deux fois. Puis la lumière baisse.
    this.creditor.knock(2, () => {
      if (this.phase !== 'over') return;
      this.stage.lightLevel.value = 0.45;
      this.fx.dim(0.6);
      this.hud.showBanner('LE CRÉANCIER RÉCLAME SON DÛ', `${where} · ${fmt(score)} / ${fmt(target)} · R pour une nouvelle run`);
      this.sfx.tone(98, 1.4, 0.35, 'sawtooth');
      this.sfx.tone(92, 1.6, 0.3, 'sawtooth');
    });
  }

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

  private buy(index: number) {
    const item = this.run.buy(index);
    if (!item) return;
    this.sfx.tone(COIN_HZ, 0.1, 0.25, 'square');
    this.sfx.tone(COIN_HZ * 1.26, 0.18, 0.2, 'square');
    if (item.kind === 'relic') this.shelf.sync(this.run.relics);
    else this.showFlash(`${COMBOS[item.combo].name} monte au niveau ${this.run.levels[item.combo]}`);
    this.renderShop();
  }

  private renderShop() {
    this.shopUi.render(this.run, this.earnings);
  }

  private leaveShop() {
    this.shopUi.hide();
    this.earnings = null;
    this.run.advance();
    this.phase = 'play';
    this.lastAction = this.clock;
    this.ambience.setShop(false);
    this.creditor.engrave(fmt(this.run.target));
    this.sfx.play('wood', 0.7);
  }

  newRun() {
    this.run = new RunState();
    this.phase = 'play';
    this.sequence = null;
    this.rollsThisHand = 0;
    this.freeRerollUsed = false;
    this.result = null;
    this.previousResult = null;
    this.revealed = false;
    this.shelf.sync([]);
    this.shopUi.hide();
    this.hud.hideBanner();
    this.hud.hideTally();
    this.table.reset();
    this.creditor.reset();
    this.creditor.engrave(fmt(this.run.target));
    this.stage.lightLevel.value = 1;
    this.fx.dim(1);
    this.ambience.setShop(false);
    this.lastAction = this.clock;
  }

  // ---------------------------------------------------------------- boucle

  step(dt: number) {
    this.clock += dt;
    this.table.step(dt);
    if (this.phase === 'scoring') this.stepScoring();
    if (this.phase === 'payout') this.stepPayout();

    // Impatience : le joueur hésite, les doigts du créancier tapotent de plus en plus vite.
    const waiting = this.phase === 'play' && this.table.idle && !this.creditor.busy;
    const idle = this.clock - this.lastAction;
    this.creditor.setImpatience(waiting ? Math.min(1, Math.max(0, (idle - PATIENCE) / IMPATIENCE_RAMP)) : 0);
    this.creditor.update(dt, this.clock, this.stage.camera);
    this.smoke.update(dt);
    this.chips.update(dt);
    this.ambience.update(dt);
    this.fx.pressure(this.pressure());
  }

  /** Pression de l'échéance : mains consommées sans que la dette ne baisse. */
  private pressure() {
    if (this.phase === 'over' || this.phase === 'shop') return 0;
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
    this.table.render();
    this.shelf.update(this.clock);
    this.floats.update(this.clock);
    const levels = (Object.keys(this.run.levels) as ComboId[])
      .filter((id) => (this.run.levels[id] ?? 1) > 1)
      .map((id) => levelLine(this.run, id));
    this.hud.update({
      night: this.run.night,
      echeance: this.run.echeance,
      isBoss: this.run.isBoss,
      target: this.run.target,
      score: this.run.score,
      hands: this.run.hands,
      rerolls: this.run.rerolls,
      coins: this.run.coins,
      combo: this.revealed ? this.result : null,
      levels,
      canValidate: this.phase === 'play' && this.table.idle && this.rollsThisHand > 0,
      hint: this.hint(),
    });
  }

  private showFlash(text: string) {
    this.flash = text;
    this.flashUntil = this.clock + 1.8;
  }

  private hint() {
    if (this.clock < this.flashUntil) return this.flash;
    switch (this.phase) {
      case 'scoring':
      case 'payout':
        return '';
      case 'shop':
        return 'Achète, vends, réordonne tes reliques, puis passe à la suite';
      case 'over':
        return 'R pour une nouvelle run';
      case 'play':
        if (this.table.holding) return 'Secoue… puis relâche d’un geste vers la table';
        if (this.table.rolling) return '';
        if (this.rollsThisHand === 0) return 'Clique et maintiens le gobelet, secoue, puis relâche pour lancer';
        if (!this.canRoll() || !this.table.hasLooseDice()) return 'Espace pour valider la main';
        return 'Clique un dé pour le garder · reprends le gobelet pour relancer · Espace pour valider';
    }
  }

  /** Accès de débogage depuis la console du navigateur. */
  debug() {
    return {
      phase: this.phase,
      night: this.run.night,
      echeance: this.run.echeance,
      score: this.run.score,
      target: this.run.target,
      hands: this.run.hands,
      rerolls: this.run.rerolls,
      coins: this.run.coins,
      relics: this.run.relics.map((r) => r.def.id),
      values: this.table.values(),
      result: this.result?.combo.id ?? null,
      idle: this.table.idle,
    };
  }
}

const COIN_HZ = 880;
const fmt = (n: number) => Math.floor(n).toLocaleString('fr-FR');

function effectLabel(e: Effect): [string, string] {
  if (e.xmult) return [`×${e.xmult}`, XMULT_COLOR];
  if (e.mult) return [`+${e.mult} Mult`, MULT_COLOR];
  if (e.chips) return [`+${e.chips}`, CHIPS_COLOR];
  return [`+${e.coins ?? 0} $`, COIN_COLOR];
}

