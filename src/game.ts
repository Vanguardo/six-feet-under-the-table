import RAPIER from '@dimforge/rapier3d-compat';
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
import { levelLine, ShopUi } from './shopUi';
import { DiceTable } from './table';

type Phase = 'play' | 'scoring' | 'payout' | 'shop' | 'over';

const SCORE_NOTES = [0, 3, 5, 7, 10, 12, 15, 17, 19, 22, 24];
const SCORE_BASE_HZ = 262;
const PAYOUT_DURATION = 1.6;

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
    stage: Stage,
    cup: Cup,
    dice: Die[],
    private readonly sfx: Sfx,
    private readonly hud: Hud,
  ) {
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
    });
    this.shelf = new RelicShelf(stage.scene);
    this.floats = new FloatTexts(stage.scene);
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
    window.addEventListener('keydown', (e) => {
      this.sfx.unlock();
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
    this.run.openShop();
    this.shopUi.show(this.run, this.earnings);
  }

  private gameOver() {
    this.phase = 'over';
    const { night, echeance, score, target } = this.run;
    const where = `Nuit ${night}, ${echeance === 2 ? 'boss' : `échéance ${echeance + 1}`}`;
    this.hud.showBanner('LE CRÉANCIER RÉCLAME SON DÛ', `${where} · ${fmt(score)} / ${fmt(target)} · R pour une nouvelle run`);
    this.sfx.tone(98, 1.4, 0.35, 'sawtooth');
    this.sfx.tone(92, 1.6, 0.3, 'sawtooth');
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
  }

  // ---------------------------------------------------------------- boucle

  step(dt: number) {
    this.clock += dt;
    this.table.step(dt);
    if (this.phase === 'scoring') this.stepScoring();
    if (this.phase === 'payout') this.stepPayout();
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

