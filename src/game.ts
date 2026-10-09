import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { Ambience } from './ambience';
import { BossProps } from './bossProps';
import { Creditor } from './creditor/creditor';
import { Cup } from './cup';
import { Die } from './dice';
import { CHIPS_COLOR, COIN_COLOR, FloatTexts, MULT_COLOR, XMULT_COLOR } from './floatText';
import { Hud } from './hud';
import { MousePrompt } from './mousePrompt';
import { PactScene } from './pact';
import { Particles } from './render/particles';
import { ps1ify } from './render/ps1';
import { RelicShelf } from './relicShelf';
import { BODY_PARTS, type BodyPartId } from './rules/body';
import { CLOCKMAKER_SECONDS } from './rules/bosses';
import { COMBOS, evaluateBest, type BestResult, type ComboId } from './rules/combos';
import { DIE_TYPES, FACE_MODS, faceOf, newDie, type Face } from './rules/dice';
import { RARITY_LABEL, type Effect } from './rules/relics';
import { needsTarget, RunState, type Earnings } from './rules/run';
import { scoreHand, type ScoreBreakdown, type ScoreStep } from './rules/scoring';
import type { Stage } from './scene';
import type { Sfx } from './sfx';
import { itemTooltip, levelLine, ShopPanel } from './shopUi';
import { Suitcase } from './suitcase';
import { DiceTable } from './table';

type Phase = 'play' | 'scoring' | 'payout' | 'pact' | 'shop' | 'over';

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
  dim(level: number): void;
  pressure(level: number): void;
  eyes(lost: number): void;
  lean(point: THREE.Vector3 | null): void;
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
  private phase: Phase = 'play';
  private run = new RunState();
  private readonly table: DiceTable;
  private readonly shelf: RelicShelf;
  private readonly floats: FloatTexts;
  private readonly suitcase: Suitcase;
  private readonly mousePrompt: MousePrompt;
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
  ) {
    // Fumée de feutre : grosse, floue, lente, qui monte à peine.
    this.smoke = new Particles(stage.scene, { max: 320, life: [1.1, 2.0], size: [0.45, 2.4], alpha: 0.14, gravity: 0.3, drag: 2, softness: 1 });
    // Copeaux de bois (et éclats de verre) : petits, nets, qui retombent.
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
        onRollRefused: () => this.showFlash('Trop mou. Secoue plus longtemps.'),
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
    });
    this.creditor.objects.forEach(ps1ify);
    this.pact = new PactScene(stage.scene, sfx, fx, this.creditor);
    this.bossProps = new BossProps(stage.scene);
    this.suitcase = new Suitcase(stage.scene, sfx);
    this.mousePrompt = new MousePrompt(stage.scene);
    this.bindInput(stage.renderer.domElement);
    this.startEcheance();
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
      if (e.code === 'Escape' && this.targeting !== null) {
        this.cancelTarget();
      } else if (e.code === 'Space') {
        e.preventDefault();
        this.validate();
      } else if (e.code === 'KeyR' && !e.ctrlKey && !e.metaKey && this.phase === 'over') {
        this.newRun();
      } else if (/^Digit[1-6]$/.test(e.code)) {
        // Les chiffres suivent les dés en jeu, dans l'ordre.
        const active = this.run.activeDice();
        const die = active[Number(e.code.slice(5)) - 1];
        if (die !== undefined) this.table.toggleKeepIndex(die);
      }
    });
    // Infobulles : reliques sur le rebord, dés sur la table. La table met le rayon à jour juste avant.
    canvas.addEventListener('pointerdown', () => {
      if (this.phase === 'shop') this.shopClick();
      if (this.phase === 'pact') this.pact.click(this.table.raycaster);
    });
    canvas.addEventListener('pointermove', (e) => {
      if (this.table.holding) return this.hud.hideTooltip();
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
        if (target?.kind === 'bell') return this.hud.showTooltip(`<b>Sonnette</b><br>Relancer la valise : ${this.run.rerollCost} $`, e.clientX, e.clientY);
        if (target?.kind === 'lid') return this.hud.showTooltip('<b>Refermer la valise</b><br>Passer à la suite', e.clientX, e.clientY);
      }
      const i = this.shelf.pick(this.table.raycaster);
      const relic = this.run.relics[i];
      if (relic) {
        const status = relic.def.status ? `<br><b>${relic.def.status(relic.state)}</b>` : '';
        return this.hud.showTooltip(
          `<b>${relic.def.name}</b> · ${RARITY_LABEL[relic.def.rarity]}<br>${relic.def.description}${status}`,
          e.clientX,
          e.clientY,
        );
      }
      const hit = this.table.raycaster.intersectObjects(this.dice.filter((d) => d.active).map((d) => d.mesh), false)[0];
      const die = hit ? this.dice.findIndex((d) => d.mesh === hit.object) : -1;
      const owned = this.run.dice[die];
      if (!owned) return this.hud.hideTooltip();
      const type = DIE_TYPES[owned.type];
      const mods = owned.mods.map((m, f) => (m ? `<br>Face ${type.faces[f]} : ${FACE_MODS[m].name}` : '')).join('');
      const pending = this.targeting !== null ? this.run.shop[this.targeting] : null;
      const action = pending ? `<br><b>${pending.kind === 'die' ? 'Clic : remplacer ce dé' : 'Clic : graver une face de ce dé'}</b>` : '';
      canvas.style.cursor = pending ? 'pointer' : 'default';
      this.hud.showTooltip(`<b>${type.name}</b><br>${type.description}${mods}${action}`, e.clientX, e.clientY);
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
    return this.table.faces().map(({ die, face }) => faceOf(this.run.dice[die], face, die));
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

  private canRoll() {
    if (this.phase !== 'play' || this.run.hands <= 0 || this.validateAt !== null) return false;
    if (this.rollsThisHand === 0) return true;
    if (this.run.bossIs('mere') && this.run.coins < MOTHER_TOLL) return false;
    return this.run.rerolls > 0 || this.freeRerollAvailable();
  }

  private onRollStart() {
    this.lastAction = this.clock;
    this.deadline = null;
    this.rollsThisHand++;
    if (this.rollsThisHand > 1) {
      if (this.freeRerollAvailable()) {
        this.freeRerollUsed = true;
        this.showFlash('Main coupée : relance gratuite');
      } else {
        this.run.rerolls--;
      }
      // La Mère se fait payer chaque relance.
      if (this.run.bossIs('mere')) {
        this.run.coins -= MOTHER_TOLL;
        this.floats.spawn(`-${MOTHER_TOLL} $`, COIN_COLOR, new THREE.Vector3(-1.6, 1.5, -7.9), this.clock);
      }
    }
    this.result = null;
    this.revealed = false;
  }

  private onSettled() {
    const faces = this.faces();
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
        this.showFlash('Le créancier retourne ton meilleur dé');
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
    });
    this.phase = 'scoring';
    this.result = result;
    this.hud.showTally(result.level > 1 ? `${result.combo.name} niv. ${result.level}` : result.combo.name);
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
      this.floats.spawn(step.label ? `${step.label} ${text}` : text, color, new THREE.Vector3(0, 2.5, -7.6), this.clock, 1.1);
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
    this.run.hands--;
    this.run.handsPlayed++;
    this.run.addBleed(breakdown.bled);
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
    this.result = null;
    this.previousResult = null;
    this.revealed = false;
    this.unveiled = false;
    this.flipped = false;
    this.table.collectDice();

    if (this.run.score >= this.run.target) this.startPayout();
    else if (this.run.hands === 0) this.fail();
    else this.phase = 'play';
  }

  /** Un dé usé se brise ; un dé en os ordinaire prend sa place. */
  private shatter(die: number) {
    const name = DIE_TYPES[this.run.dice[die].type].name;
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
    this.showFlash(`${name} se brise`);
    this.syncDice(false);
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
    if (this.heartGiven()) return;
    this.hud.showBanner(this.run.isBoss ? `NUIT ${this.run.night} TERMINÉE` : 'ÉCHÉANCE PAYÉE', `+${this.earnings.total} pièces`);
    this.sfx.tone(COIN_HZ, 0.15, 0.25, 'square');
    this.sfx.tone(COIN_HZ * 1.5, 0.25, 0.2, 'square');
  }

  private stepPayout() {
    if (this.clock < this.payoutUntil) return;
    this.hud.hideBanner();
    this.openShop();
  }

  private openShop() {
    this.phase = 'shop';
    this.ambience.setShop(true);
    this.run.openShop();
    this.bossProps.show(null, this.clock);
    this.fillSuitcase(true);
    this.suitcase.open();
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
      if (this.run.pactNight === this.run.night) this.showFlash('Il ne négocie qu’une fois par nuit');
      return this.gameOver();
    }
    const available = this.run.body.available();
    let options: BodyPartId[];
    if (boss?.pact && boss.pact !== 'mort' && available.includes(boss.pact)) {
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
    this.run.signPact(part);
    this.sfx.toneAt(0, 196, 180, 0.6, 0.2); // le pouce sur le papier
    this.creditor.sneer(1);
    this.pact.play(part, () => this.afterPact(part));
  }

  private afterPact(part: BodyPartId) {
    this.applyBody();
    this.showFlash(`${BODY_PARTS[part].name} : ${BODY_PARTS[part].effect.toLowerCase()}`);
    if (this.heartGiven()) return;
    this.earnings = null;
    this.openShop();
  }

  /** Le cœur a été donné et la nuit s'achève : la run s'arrête là. */
  private heartGiven() {
    if (!(this.run.lastNight === this.run.night && this.run.isBoss)) return false;
    this.phase = 'over';
    this.stage.lightLevel.value = 0.3;
    this.fx.dim(0.45);
    this.hud.showBanner('TON CŒUR S’ARRÊTE', `Il bat encore dans sa main. Nuit ${this.run.night} · R pour une nouvelle run`);
    [0, 1.2, 2.8].forEach((d) => this.sfx.toneAt(d, 58, 36, 0.18, 0.7));
    return true;
  }

  /** Les sens suivent le corps : la vue et l'ouïe perdues le restent. */
  private applyBody() {
    this.sfx.setDeaf(this.run.body.ear);
    this.fx.eyes(this.run.body.eyes);
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
        this.panel.pickFace(this.run.dice[die], FACE_MODS[item.mod].name, (face) => this.complete(index, die, face), () => this.cancelTarget());
      } else {
        this.complete(index, die);
      }
      return;
    }
    const relic = this.shelf.pick(ray);
    if (relic >= 0) return this.openRelicMenu(relic);
    const target = this.suitcase.pick(ray);
    if (!target) return;
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
        const what = item.kind === 'die' ? `Clique le dé à remplacer par un ${DIE_TYPES[item.type].name.toLowerCase()}, sur le tapis rouge` : 'Clique le dé à graver, sur le tapis rouge';
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
    else if (item.kind === 'gravure') to = new THREE.Vector3(0, 1.8, -8.2);
    else to = this.dice[die].mesh.position.clone();
    this.suitcase.flyAway(index, to, () => {
      if (item.kind === 'relic') this.shelf.sync(this.run.relics);
      else if (item.kind === 'gravure') this.showFlash(`${COMBOS[item.combo].name} monte au niveau ${this.run.levels[item.combo]}`);
      else {
        this.syncDice(false);
        this.dice[die].flash();
      }
    });
    this.refreshShop();
  }

  private openRelicMenu(index: number) {
    this.panel.relicMenu(this.run, index, {
      sell: () => {
        this.run.sell(index);
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
    this.panel.hide();
    this.targeting = null;
    this.earnings = null;
    this.run.advance();
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
    this.creditor.engrave(fmt(this.run.target));
    if (boss) this.showFlash(`${boss.name} : ${boss.rule}`);
    if (this.run.confiscated >= 0) this.showFlash(`Le Boucher confisque ton ${DIE_TYPES[this.run.dice[this.run.confiscated].type].name.toLowerCase()}`);
  }

  newRun() {
    this.run = new RunState();
    this.sequence = null;
    this.rollsThisHand = 0;
    this.freeRerollUsed = false;
    this.result = null;
    this.previousResult = null;
    this.revealed = false;
    this.unveiled = false;
    this.flipped = false;
    this.shelf.sync([]);
    this.panel.hide();
    this.suitcase.reset();
    this.targeting = null;
    this.highlightTargets(false);
    this.hud.hideBanner();
    this.hud.hideTally();
    this.pact.reset();
    this.fx.lean(null);
    this.table.reset();
    this.creditor.reset();
    this.stage.lightLevel.value = 1;
    this.fx.dim(1);
    this.applyBody();
    this.ambience.setShop(false);
    this.startEcheance();
  }

  // ---------------------------------------------------------------- boucle

  step(dt: number) {
    this.clock += dt;
    this.table.step(dt);
    this.pact.update(dt);
    if (this.phase === 'scoring') this.stepScoring();
    if (this.phase === 'payout') this.stepPayout();
    if (this.validateAt !== null && this.clock >= this.validateAt && this.table.idle) {
      this.validateAt = null;
      this.validate();
    }
    // L'Horloger joue la main à ta place quand le temps est écoulé.
    if (this.deadline !== null && this.phase === 'play' && this.table.idle && this.clock >= this.deadline) {
      this.deadline = null;
      this.showFlash("L'Horloger a perdu patience");
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
    const awaitingRoll = this.phase === 'play' && this.table.idle && this.rollsThisHand === 0 && this.run.hands > 0 && this.validateAt === null;
    this.cup.setPrompt(awaitingRoll);
    this.cup.updatePrompt(dt, this.clock);
    this.mousePrompt.show(awaitingRoll);
    this.mousePrompt.update(dt, this.clock, this.cup.position);
    this.smoke.update(dt);
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
    const levels = (Object.keys(COMBOS) as ComboId[])
      .filter((id) => (this.run.effectiveLevels()[id] ?? 1) > 1)
      .map((id) => levelLine(this.run, id));
    const boss = this.run.boss;
    this.hud.update({
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
      boss: boss ? { name: boss.name, rule: boss.rule } : null,
      body: bodySummary(this.run),
      timer: this.deadline !== null && this.phase === 'play' ? Math.max(0, this.deadline - this.clock) : null,
      curse: this.run.curse,
      canValidate: this.phase === 'play' && this.table.idle && this.rollsThisHand > 0 && this.validateAt === null,
      hint: this.hint(),
    });
  }

  private showFlash(text: string) {
    this.flash = text;
    this.flashUntil = this.clock + 2.4;
  }

  private hint() {
    if (this.clock < this.flashUntil) return this.flash;
    switch (this.phase) {
      case 'pact':
        return this.pact.awaitingSignature ? 'Appose ton pouce sur ce que tu donnes' : '';
      case 'scoring':
      case 'payout':
        return '';
      case 'shop':
        return this.targeting !== null ? 'Clique un de tes dés illuminés sur le tapis rouge · Échap ou un clic dans la valise pour annuler' : '';
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
const fmt = (n: number) => Math.floor(n).toLocaleString('fr-FR');

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
  if (b.fingers) parts.push(`${b.fingers} doigt${b.fingers > 1 ? 's' : ''}`);
  if (b.teeth) parts.push(`${b.teeth} dent${b.teeth > 1 ? 's' : ''}`);
  if (b.ear) parts.push('oreille');
  if (b.tongue) parts.push('langue');
  if (b.eyes) parts.push(b.eyes > 1 ? 'les deux yeux' : 'un œil');
  if (b.hand) parts.push('main gauche');
  if (b.heart) parts.push('cœur');
  return parts.join(' · ');
}
