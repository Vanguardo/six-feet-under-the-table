import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import {
  CUP_BOTTOM,
  CUP_HEIGHT,
  CUP_INNER_RADIUS,
  HAND_COUNT,
  HOLD_FOLLOW,
  HOLD_MAX,
  HOLD_MAX_SPEED,
  HOLD_MIN,
  HOLD_Z,
  KEEP_SLOT,
  MIN_SHAKE_DISTANCE,
  MIN_SHAKE_TIME,
  REROLL_COUNT,
  TABLE_HALF_D,
  TABLE_HALF_W,
  TARGET,
} from './config';
import { Cup } from './cup';
import { Die, orientationFor, randomOrientation } from './dice';
import { Hud } from './hud';
import { DieLabel } from './labels';
import { evaluate, type ComboResult } from './rules/combos';
import type { Stage } from './scene';
import { Sfx, type SfxKind } from './sfx';

type Phase = 'ready' | 'holding' | 'rolling' | 'over';
type CupMode = 'rest' | 'held' | 'moving';
type ColliderKind = 'die' | 'cup' | 'felt' | 'wood';

const rand = (min: number, max: number) => min + Math.random() * (max - min);
const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));
const X_AXIS = new THREE.Vector3(1, 0, 0);
const Z_AXIS = new THREE.Vector3(0, 0, 1);
const FORCE_THRESHOLD = 120;
const REVEAL_STAGGER = 0.11;
// Gamme mineure pentatonique : la révélation monte, sans jamais sonner joyeuse.
const REVEAL_NOTES = [0, 3, 5, 7, 10];
const REVEAL_BASE_HZ = 392;

export class Game {
  private phase: Phase = 'ready';
  private cupMode: CupMode = 'rest';

  private score = 0;
  private hands = HAND_COUNT;
  private rerolls = REROLL_COUNT;
  private rollsThisHand = 0;
  private result: ComboResult | null = null;

  private clock = 0;
  private holdTime = 0;
  private shakeDistance = 0;
  private readonly holdTarget = new THREE.Vector3();
  private readonly tilt = new THREE.Vector2();
  private history: { t: number; p: THREE.Vector3 }[] = [];
  private rollTime = 0;
  private flash = '';
  private flashUntil = 0;

  private readonly pointer = new THREE.Vector2();
  private readonly raycaster = new THREE.Raycaster();
  private readonly holdPlane = new THREE.Plane(new THREE.Vector3(0, 0, 1), -HOLD_Z);
  private hovered: Die | Cup | null = null;
  private readonly colliderKinds = new Map<number, ColliderKind>();
  private readonly cupVelocity = new THREE.Vector3();

  private readonly labels: DieLabel[];
  private reveal: { at: number; die: number; step: number }[] = [];
  private revealEnd = -1;
  private revealed = false;

  constructor(
    private readonly stage: Stage,
    private readonly cup: Cup,
    private readonly dice: Die[],
    private readonly sfx: Sfx,
    private readonly hud: Hud,
  ) {
    for (const d of dice) this.colliderKinds.set(d.collider.handle, 'die');
    for (const c of cup.colliders) this.colliderKinds.set(c.handle, 'cup');
    for (const h of stage.feltColliders) this.colliderKinds.set(h, 'felt');
    for (const h of stage.woodColliders) this.colliderKinds.set(h, 'wood');
    this.labels = dice.map(() => new DieLabel(stage.scene));
    this.collectDice();
    this.bindInput(stage.renderer.domElement);
  }

  // ---------------------------------------------------------------- entrées

  private bindInput(canvas: HTMLCanvasElement) {
    canvas.addEventListener('pointermove', (e) => {
      this.updatePointer(e);
      if (this.phase !== 'holding') this.updateHover();
    });
    canvas.addEventListener('pointerdown', (e) => {
      this.sfx.unlock();
      this.updatePointer(e);
      this.updateHover();
      if (this.hovered === this.cup && this.canGrab()) {
        canvas.setPointerCapture(e.pointerId);
        this.startHolding();
      } else if (this.hovered instanceof Die && this.canKeep()) {
        this.toggleKeep(this.hovered);
      }
    });
    canvas.addEventListener('pointerup', () => {
      if (this.phase === 'holding') this.release();
    });
    window.addEventListener('keydown', (e) => {
      this.sfx.unlock();
      if (e.code === 'Space') {
        e.preventDefault();
        this.validate();
      } else if (e.code === 'KeyR') {
        this.reset();
      } else if (/^Digit[1-5]$/.test(e.code) && this.canKeep()) {
        this.toggleKeep(this.dice[Number(e.code.slice(5)) - 1]);
      }
    });
  }

  private updatePointer(e: PointerEvent) {
    this.pointer.set((e.clientX / window.innerWidth) * 2 - 1, -(e.clientY / window.innerHeight) * 2 + 1);
    this.raycaster.setFromCamera(this.pointer, this.stage.camera);
    this.raycaster.ray.intersectPlane(this.holdPlane, this.holdTarget);
    this.holdTarget.x = clamp(this.holdTarget.x, HOLD_MIN.x, HOLD_MAX.x);
    this.holdTarget.y = clamp(this.holdTarget.y, HOLD_MIN.y, HOLD_MAX.y);
    this.holdTarget.z = HOLD_Z;
  }

  private updateHover() {
    let next: Die | Cup | null = null;
    if (this.phase === 'ready' && this.cupMode === 'rest') {
      const targets: THREE.Object3D[] = [this.cup.mesh];
      if (this.canKeep()) targets.push(...this.dice.map((d) => d.mesh));
      const hit = this.raycaster.intersectObjects(targets, true)[0];
      if (hit) {
        next = this.dice.find((d) => d.mesh === hit.object) ?? (this.canGrab() ? this.cup : null);
      }
    }
    if (next === this.hovered) return;
    this.hovered?.setHighlight(false);
    next?.setHighlight(true);
    this.hovered = next;
    this.stage.renderer.domElement.style.cursor = next ? 'pointer' : 'default';
  }

  // ---------------------------------------------------------------- règles

  private canGrab() {
    const loose = this.dice.some((d) => !d.kept);
    const hasRoll = this.rollsThisHand === 0 || this.rerolls > 0;
    return this.phase === 'ready' && this.cupMode === 'rest' && this.hands > 0 && loose && hasRoll;
  }

  private canKeep() {
    return this.phase === 'ready' && this.rollsThisHand > 0;
  }

  private values() {
    return this.dice.map((d) => d.top().value);
  }

  private toggleKeep(die: Die) {
    const value = die.top().value;
    if (!die.kept) {
      const used = new Set(this.dice.map((d) => d.slot));
      const slot = [0, 1, 2, 3, 4].find((s) => !used.has(s))!;
      die.kept = true;
      die.slot = slot;
      die.moveTo(this.slotPosition(slot), orientationFor(value), 0.3);
    } else {
      const x = this.slotPosition(die.slot).x;
      die.kept = false;
      die.slot = -1;
      const rot = orientationFor(value);
      die.moveTo(new THREE.Vector3(x, 1.2, TABLE_HALF_D - 1.4), rot, 0.3, () => die.placeDynamic(die.position, rot));
    }
    this.sfx.play('wood', 0.4);
  }

  private slotPosition(slot: number) {
    return new THREE.Vector3(KEEP_SLOT.x0 + slot * KEEP_SLOT.dx, KEEP_SLOT.y, KEEP_SLOT.z);
  }

  /** Ramène tous les dés dans le gobelet posé. */
  private collectDice() {
    this.clearReveal(true);
    this.dice.forEach((d, i) => {
      d.kept = false;
      d.slot = -1;
      d.placeDynamic(this.cup.slotWorld(i), randomOrientation());
    });
  }

  validate() {
    if (this.phase !== 'ready' || this.cupMode !== 'rest' || this.rollsThisHand === 0) return;
    const res = evaluate(this.values());
    this.score += res.score;
    this.hands--;
    this.rollsThisHand = 0;
    this.result = null;
    this.showFlash(`${res.combo.name} : +${res.score}`);
    this.collectDice();
    this.sfx.play('wood', 0.8);
    if (this.score >= TARGET) {
      this.phase = 'over';
      this.hud.showBanner('ÉCHÉANCE PAYÉE', `${this.score} / ${TARGET} · R pour recommencer`);
    } else if (this.hands === 0) {
      this.phase = 'over';
      this.hud.showBanner('ÉCHÉANCE RATÉE', 'Le créancier sourit. R pour recommencer');
    }
  }

  reset() {
    this.score = 0;
    this.hands = HAND_COUNT;
    this.rerolls = REROLL_COUNT;
    this.rollsThisHand = 0;
    this.result = null;
    this.phase = 'ready';
    this.cupMode = 'rest';
    this.cup.teleportRest();
    this.collectDice();
    this.hud.hideBanner();
  }

  // ---------------------------------------------------------------- geste

  private startHolding() {
    this.hovered?.setHighlight(false);
    this.hovered = null;
    this.clearReveal(false);
    this.cup.setSolid(true);
    this.cup.setLid(true);
    this.dice
      .filter((d) => !d.kept)
      .forEach((d, i) => d.placeDynamic(this.cup.slotWorld(i), randomOrientation()));
    this.phase = 'holding';
    this.cupMode = 'held';
    this.holdTime = 0;
    this.shakeDistance = 0;
    this.history = [];
    this.tilt.set(0, 0);
  }

  private stepHeld(dt: number) {
    const pos = this.cup.position;
    const vel = this.holdTarget.clone().sub(pos).multiplyScalar(HOLD_FOLLOW);
    if (vel.length() > HOLD_MAX_SPEED) vel.setLength(HOLD_MAX_SPEED);
    const next = pos.addScaledVector(vel, dt);

    // Le gobelet s'incline dans le sens du mouvement, comme tenu par un poignet.
    this.tilt.lerp(new THREE.Vector2(clamp(-vel.y * 0.006, -0.25, 0.25), clamp(-vel.x * 0.012, -0.4, 0.4)), 0.2);
    const rot = new THREE.Quaternion()
      .setFromAxisAngle(Z_AXIS, this.tilt.y)
      .multiply(new THREE.Quaternion().setFromAxisAngle(X_AXIS, this.tilt.x));
    this.cup.drive(next, rot);
    this.cupVelocity.copy(vel);

    this.holdTime += dt;
    if (next.y > HOLD_MIN.y - 0.5) this.shakeDistance += vel.length() * dt;
    this.history.push({ t: this.clock, p: next.clone() });
    while (this.history.length > 2 && this.clock - this.history[0].t > 0.1) this.history.shift();
  }

  private releaseVelocity() {
    const first = this.history[0];
    const last = this.history[this.history.length - 1];
    if (!first || !last || last.t === first.t) return new THREE.Vector3();
    return last.p.clone().sub(first.p).divideScalar(last.t - first.t);
  }

  private release() {
    const rest = this.cup.restPose();
    if (this.holdTime < MIN_SHAKE_TIME || this.shakeDistance < MIN_SHAKE_DISTANCE) {
      // Lancer refusé : les dés restent dans le gobelet, qui revient se poser.
      this.phase = 'ready';
      this.cupMode = 'moving';
      this.cup.moveTo(rest.position, rest.quaternion, 0.45, () => {
        this.cupMode = 'rest';
        this.cup.setLid(false);
      });
      this.showFlash('Trop mou. Secoue plus longtemps.');
      return;
    }

    const v = this.releaseVelocity();
    this.cup.setSolid(false);
    this.throwDice(v);
    this.rollsThisHand++;
    if (this.rollsThisHand > 1) this.rerolls--;
    this.result = null;
    this.phase = 'rolling';
    this.rollTime = 0;

    // Le gobelet se renverse vers la table, puis revient sur le rebord.
    this.cupMode = 'moving';
    const tipPos = this.cup.position.add(new THREE.Vector3(clamp(v.x * 0.03, -1, 1), 0.6, -1.2));
    const tipRot = new THREE.Quaternion().setFromAxisAngle(X_AXIS, -1.9);
    this.cup.moveTo(tipPos, tipRot, 0.16, () =>
      this.cup.moveTo(rest.position, rest.quaternion, 0.6, () => {
        this.cup.setSolid(true);
        this.cupMode = 'rest';
      }),
    );
  }

  /** La vitesse du geste donne direction et force ; la rotation reste aléatoire pour que rien ne se vise. */
  private throwDice(v: THREE.Vector3) {
    const speed = Math.hypot(v.x, v.y);
    for (const d of this.dice) {
      if (d.kept) continue;
      d.body.setLinvel(
        {
          x: clamp(v.x * 0.45, -9, 9) + rand(-1, 1),
          y: clamp(2 + v.y * 0.15, 0, 8) + rand(0, 1),
          z: -clamp(8 + speed * 0.3, 8, 22) + rand(-1, 1),
        },
        true,
      );
      d.body.setAngvel(this.randomSpin(rand(18, 32)), true);
      d.stillTime = 0;
    }
  }

  private randomSpin(magnitude: number) {
    const w = new THREE.Vector3(rand(-1, 1), rand(-1, 1), rand(-1, 1)).setLength(magnitude);
    return { x: w.x, y: w.y, z: w.z };
  }

  // ---------------------------------------------------------------- lancer en cours

  private stepRolling(dt: number) {
    this.rollTime += dt;
    const loose = this.dice.filter((d) => !d.kept);
    for (const d of loose) {
      this.rescueIfLost(d);
      d.stillTime = d.isResting() ? d.stillTime + dt : 0;
    }
    if (this.rollTime > 9) {
      for (const d of loose) if (d.stillTime === 0) this.nudge(d);
      this.rollTime = 0.6;
    }
    if (this.rollTime < 0.6 || loose.some((d) => d.stillTime < 0.25)) return;

    // Un dé calé contre un bord ou en biais est relancé automatiquement, sans coût.
    const cocked = loose.filter((d) => !d.isFlat());
    if (cocked.length > 0) {
      cocked.forEach((d) => this.nudge(d));
      return;
    }
    this.phase = 'ready';
    this.result = evaluate(this.values());
    this.startReveal();
  }

  // ---------------------------------------------------------------- révélation

  /** Les chiffres apparaissent de gauche à droite, puis la combinaison. */
  private startReveal() {
    const order = this.dice.map((_, i) => i).sort((a, b) => this.dice[a].position.x - this.dice[b].position.x);
    this.reveal = order.map((die, step) => ({ at: this.clock + 0.08 + step * REVEAL_STAGGER, die, step }));
    this.revealEnd = this.clock + 0.08 + order.length * REVEAL_STAGGER + 0.12;
    this.revealed = false;
  }

  private stepReveal() {
    const res = this.result;
    if (!res) return;
    while (this.reveal.length > 0 && this.clock >= this.reveal[0].at) {
      const { die, step } = this.reveal.shift()!;
      const scoring = res.scoring.includes(die);
      this.labels[die].show(this.dice[die].top().value, scoring, this.clock);
      this.dice[die].flash();
      const freq = REVEAL_BASE_HZ * 2 ** (REVEAL_NOTES[step % REVEAL_NOTES.length] / 12);
      this.sfx.tone(scoring ? freq * 2 : freq, 0.14, scoring ? 0.3 : 0.14);
    }
    if (!this.revealed && this.revealEnd > 0 && this.clock >= this.revealEnd) {
      this.revealed = true;
      this.hud.popCombo(res);
      this.sfx.tone(REVEAL_BASE_HZ * 2, 0.4, 0.22);
      this.sfx.tone(REVEAL_BASE_HZ * 3, 0.45, 0.16);
    }
  }

  /** Arrête la révélation ; `all` cache aussi les chiffres des dés gardés. */
  private clearReveal(all: boolean) {
    this.reveal = [];
    this.revealEnd = -1;
    this.revealed = false;
    this.dice.forEach((d, i) => {
      if (all || !d.kept) this.labels[i].hide();
    });
  }

  // ---------------------------------------------------------------- confinement

  /**
   * Filet de sécurité : un gobelet secoué très vite peut faire traverser ses parois.
   * Tant qu'il est tenu, un dé qui sort de l'intérieur y est remis et renvoyé vers le centre.
   */
  private containDice() {
    if (this.cupMode !== 'held') return;
    const cupPos = this.cup.position;
    const rot = this.cup.quaternion;
    const inv = rot.clone().invert();
    const maxR = CUP_INNER_RADIUS - 0.45;
    const minY = CUP_BOTTOM + 0.45;
    const maxY = CUP_HEIGHT - 0.45;
    for (const d of this.dice) {
      if (d.kept) continue;
      const local = d.position.sub(cupPos).applyQuaternion(inv);
      const v = d.body.linvel();
      const rel = new THREE.Vector3(v.x, v.y, v.z).sub(this.cupVelocity).applyQuaternion(inv);
      let escaped = false;
      const r = Math.hypot(local.x, local.z);
      if (r > maxR) {
        const n = new THREE.Vector3(local.x / r, 0, local.z / r);
        local.x = n.x * maxR;
        local.z = n.z * maxR;
        const out = rel.dot(n);
        if (out > 0) rel.addScaledVector(n, -1.4 * out);
        escaped = true;
      }
      if (local.y < minY || local.y > maxY) {
        local.y = clamp(local.y, minY, maxY);
        rel.y *= -0.4;
        escaped = true;
      }
      if (!escaped) continue;
      d.body.setTranslation(local.applyQuaternion(rot).add(cupPos), true);
      const w = rel.applyQuaternion(rot).add(this.cupVelocity);
      d.body.setLinvel({ x: w.x, y: w.y, z: w.z }, true);
    }
  }

  private nudge(d: Die) {
    d.body.setLinvel({ x: rand(-2, 2), y: 7, z: rand(-2, 2) }, true);
    d.body.setAngvel(this.randomSpin(10), true);
    d.stillTime = 0;
  }

  private rescueIfLost(d: Die) {
    const p = d.position;
    const outside =
      p.y < -2 ||
      Math.abs(p.x) > TABLE_HALF_W + 0.5 ||
      p.z < -TABLE_HALF_D - 0.5 ||
      (p.z > TABLE_HALF_D + 0.3 && p.y < 2 && this.rollTime > 1);
    if (!outside) return;
    d.placeDynamic(new THREE.Vector3(rand(-4, 4), 4, rand(-3, 2)), randomOrientation());
    d.body.setAngvel(this.randomSpin(12), true);
  }

  // ---------------------------------------------------------------- boucle

  step(dt: number) {
    this.clock += dt;
    if (this.cupMode === 'held') this.stepHeld(dt);
    else this.cup.step(dt);
    for (const d of this.dice) {
      d.step(dt);
      d.tickGlow(dt);
    }
    if (this.phase === 'rolling') this.stepRolling(dt);
    this.stepReveal();
  }

  /** Transforme les chocs physiques en sons. */
  afterStep(events: RAPIER.EventQueue) {
    this.containDice();
    events.drainContactForceEvents((e) => {
      const a = this.colliderKinds.get(e.collider1());
      const b = this.colliderKinds.get(e.collider2());
      if (a !== 'die' && b !== 'die') return;
      const other = a === 'die' ? b : a;
      const kind: SfxKind = other === 'die' ? 'click' : other === 'cup' ? 'cup' : other === 'felt' ? 'felt' : 'wood';
      this.sfx.play(kind, (e.totalForceMagnitude() - FORCE_THRESHOLD) / 2500);
    });
  }

  render() {
    this.cup.syncMesh();
    this.dice.forEach((d, i) => {
      d.syncMesh();
      this.labels[i].update(this.clock, d.mesh.position);
    });
    this.hud.update({
      target: TARGET,
      score: this.score,
      hands: this.hands,
      rerolls: this.rerolls,
      combo: this.revealed ? this.result : null,
      canValidate: this.phase === 'ready' && this.cupMode === 'rest' && this.rollsThisHand > 0,
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
      case 'holding':
        return 'Secoue… puis relâche d’un geste vers la table';
      case 'rolling':
        return '';
      case 'over':
        return 'R pour recommencer';
      case 'ready':
        if (this.rollsThisHand === 0) return 'Clique et maintiens le gobelet, secoue, puis relâche pour lancer';
        if (this.rerolls === 0 || !this.dice.some((d) => !d.kept)) return 'Espace pour valider la main';
        return 'Clique un dé pour le garder · reprends le gobelet pour relancer · Espace pour valider';
    }
  }

  /** Accès de débogage depuis la console du navigateur. */
  debug() {
    return { phase: this.phase, cupMode: this.cupMode, values: this.values(), result: this.result };
  }
}
