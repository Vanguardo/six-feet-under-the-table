import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import {
  CUP_BOTTOM,
  CUP_HEIGHT,
  CUP_INNER_RADIUS,
  HOLD_FOLLOW,
  HOLD_MAX,
  HOLD_MAX_SPEED,
  HOLD_MIN,
  HOLD_Z,
  KEEP_SLOT,
  MIN_SHAKE_DISTANCE,
  MIN_SHAKE_TIME,
  TABLE_HALF_D,
  TABLE_HALF_W,
} from './config';
import { Cup } from './cup';
import { Die, orientationFor, randomOrientation } from './dice';
import { DieLabel } from './labels';
import type { Stage } from './scene';
import { Sfx, type SfxKind } from './sfx';

type Phase = 'idle' | 'holding' | 'rolling';
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

/** Effets visuels déclenchés par les dés (fournis par le jeu). */
export interface TableEffects {
  /** Poussière soulevée du feutre ; `amount` ≈ 1 pour un impact franc. */
  dust(at: THREE.Vector3, amount: number): void;
}

/** Ce que la run autorise ou doit savoir : la table ne connaît pas les règles de score. */
export interface TableRules {
  canRoll(): boolean;
  canKeep(): boolean;
  onRollStart(): void;
  onRollRefused(): void;
  onSettled(): void;
  onRevealed(): void;
}

/** La partie physique : gobelet, geste, dés, garde, révélation des chiffres. */
export class DiceTable {
  private phase: Phase = 'idle';
  private cupMode: CupMode = 'rest';

  private clock = 0;
  private holdTime = 0;
  private shakeDistance = 0;
  private readonly holdTarget = new THREE.Vector3();
  private readonly tilt = new THREE.Vector2();
  private history: { t: number; p: THREE.Vector3 }[] = [];
  private rollTime = 0;

  readonly raycaster = new THREE.Raycaster();
  private readonly pointer = new THREE.Vector2();
  private readonly holdPlane = new THREE.Plane(new THREE.Vector3(0, 0, 1), -HOLD_Z);
  private hovered: Die | Cup | null = null;
  private readonly colliderKinds = new Map<number, ColliderKind>();
  private readonly dieByCollider = new Map<number, Die>();
  private dustClock = 0;
  private readonly cupVelocity = new THREE.Vector3();

  private readonly labels: DieLabel[];
  private reveal: { at: number; die: number; step: number }[] = [];
  private revealEnd = -1;
  private revealData: { scoring: Set<number>; valueOf: (die: number) => number; hidden: boolean } | null = null;
  private readonly locked = new Set<Die>();

  constructor(
    private readonly stage: Stage,
    private readonly cup: Cup,
    readonly dice: Die[],
    private readonly sfx: Sfx,
    private readonly rules: TableRules,
    private readonly effects: TableEffects,
  ) {
    for (const d of dice) {
      this.colliderKinds.set(d.collider.handle, 'die');
      this.dieByCollider.set(d.collider.handle, d);
    }
    for (const c of cup.colliders) this.colliderKinds.set(c.handle, 'cup');
    for (const h of stage.feltColliders) this.colliderKinds.set(h, 'felt');
    for (const h of stage.woodColliders) this.colliderKinds.set(h, 'wood');
    this.labels = dice.map(() => new DieLabel(stage.scene));
    this.collectDice();
    this.bindInput(stage.renderer.domElement);
  }

  /** Aucun lancer ni mouvement en cours : on peut valider, ouvrir la boutique… */
  get idle() {
    return this.phase === 'idle' && this.cupMode === 'rest';
  }

  get holding() {
    return this.phase === 'holding';
  }

  get rolling() {
    return this.phase === 'rolling';
  }

  values() {
    return this.dice.map((d) => d.top().value);
  }

  /** Faces visibles des dés en jeu : index du dé et index logique de la face (0 à 5). */
  faces(): { die: number; face: number }[] {
    return this.dice.flatMap((d, i) => (d.active ? [{ die: i, face: d.top().face }] : []));
  }

  hasLooseDice() {
    return this.dice.some((d) => d.active && !d.kept);
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
    if (this.idle) {
      const targets: THREE.Object3D[] = [this.cup.mesh];
      if (this.canKeep()) targets.push(...this.dice.filter((d) => d.active).map((d) => d.mesh));
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

  private canGrab() {
    return this.idle && this.hasLooseDice() && this.rules.canRoll();
  }

  private canKeep() {
    return this.idle && this.rules.canKeep();
  }

  // ---------------------------------------------------------------- garde

  toggleKeepIndex(i: number) {
    if (this.canKeep() && this.dice[i]) this.toggleKeep(this.dice[i]);
  }

  private toggleKeep(die: Die) {
    // Une face clou cloue le dé dans le tapis jusqu'à la fin de la main.
    if (this.locked.has(die)) return;
    const value = die.top().value;
    if (!die.kept) {
      const used = new Set(this.dice.map((d) => d.slot));
      const slot = [0, 1, 2, 3, 4, 5].find((s) => !used.has(s))!;
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

  /** Ramène tous les dés en jeu dans le gobelet posé. */
  collectDice() {
    this.clearReveal(true);
    this.locked.clear();
    this.dice
      .filter((d) => d.active)
      .forEach((d, i) => {
        d.kept = false;
        d.slot = -1;
        d.placeDynamic(this.cup.slotWorld(i), randomOrientation());
      });
  }

  /** Met le dé `i` dans le tapis et l'y cloue jusqu'à la fin de la main. */
  forceKeep(i: number) {
    const die = this.dice[i];
    if (!die?.active) return;
    if (!die.kept) this.toggleKeep(die);
    this.locked.add(die);
  }

  /** Le créancier retourne le dé `i` sur la face `face` (index logique). */
  flip(i: number, face: number) {
    const die = this.dice[i];
    if (!die?.active) return;
    const rot = orientationFor(face + 1, Math.floor(Math.random() * 4));
    if (die.kept) {
      die.moveTo(this.slotPosition(die.slot), rot, 0.45);
    } else {
      const pos = die.position;
      die.moveTo(pos.clone().setY(1.6), rot, 0.4, () => die.placeDynamic(die.position, rot));
    }
    this.sfx.play('wood', 0.7);
  }

  /**
   * Boutique : tous les dés possédés s'alignent sur le tapis, leur plus grosse face en haut,
   * pour qu'on puisse les choisir comme cible d'un burin ou d'un échange.
   */
  displayInTray(owned: number[], face: (die: number) => number) {
    this.clearReveal(true);
    this.locked.clear();
    owned.forEach((i, slot) => {
      const d = this.dice[i];
      d.setActive(true);
      d.kept = false;
      d.slot = -1;
      d.moveTo(this.slotPosition(slot), orientationFor(face(i) + 1), 0.45);
    });
  }

  /** Dé sous le pointeur parmi ceux posés sur le tapis (boutique). */
  pickDie(): number {
    const shown = this.dice.filter((d) => d.active);
    const hit = this.raycaster.intersectObjects(shown.map((d) => d.mesh), false)[0];
    return hit ? this.dice.findIndex((d) => d.mesh === hit.object) : -1;
  }

  /** Les dés posés sur la table sursautent (le poing du créancier). */
  hop() {
    for (const d of this.dice) {
      if (!d.active || d.kept || d.tween) continue;
      d.body.setLinvel({ x: rand(-1.5, 1.5), y: rand(5, 8), z: rand(-1.5, 1.5) }, true);
      d.body.setAngvel(this.randomSpin(rand(4, 9)), true);
    }
  }

  /** Remet la table à zéro, gobelet compris (nouvelle run). */
  reset() {
    this.phase = 'idle';
    this.cupMode = 'rest';
    this.cup.teleportRest();
    this.collectDice();
  }

  // ---------------------------------------------------------------- geste

  private startHolding() {
    this.hovered?.setHighlight(false);
    this.hovered = null;
    this.clearReveal(false);
    this.cup.setSolid(true);
    this.cup.setLid(true);
    this.dice
      .filter((d) => d.active && !d.kept)
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
      this.phase = 'idle';
      this.cupMode = 'moving';
      this.cup.moveTo(rest.position, rest.quaternion, 0.45, () => {
        this.cupMode = 'rest';
        this.cup.setLid(false);
      });
      this.rules.onRollRefused();
      return;
    }

    const v = this.releaseVelocity();
    this.cup.setSolid(false);
    this.throwDice(v);
    this.rules.onRollStart();
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
    const loose = this.dice.filter((d) => d.active && !d.kept);
    for (const d of loose) {
      this.rescueIfLost(d);
      d.stillTime = d.isResting() ? d.stillTime + dt : 0;
      this.trailDust(d, dt);
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
    this.phase = 'idle';
    this.rules.onSettled();
  }

  /** Un dé qui roule sur le feutre laisse une traînée de poussière légère. */
  private trailDust(d: Die, dt: number) {
    this.dustClock += dt;
    if (this.dustClock < 0.012) return;
    const p = d.position;
    const v = d.body.linvel();
    const speed = Math.hypot(v.x, v.z);
    if (p.y > 0.75 || speed < 2.5 || Math.random() > speed / 40) return;
    this.dustClock = 0;
    this.effects.dust(p, 0.25);
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

  // ---------------------------------------------------------------- révélation

  /**
   * Les chiffres apparaissent de gauche à droite, puis la combinaison.
   * `hidden` : rien ne s'affiche (faces cachées, yeux perdus) ; chaque valeur a alors
   * sa propre note, pour qu'on puisse jouer à l'oreille.
   */
  startReveal(scoringDice: number[], valueOf: (die: number) => number, hidden: boolean) {
    const order = this.dice
      .map((_, i) => i)
      .filter((i) => this.dice[i].active)
      .sort((a, b) => this.dice[a].position.x - this.dice[b].position.x);
    this.reveal = order.map((die, step) => ({ at: this.clock + 0.08 + step * REVEAL_STAGGER, die, step }));
    this.revealEnd = this.clock + 0.08 + order.length * REVEAL_STAGGER + 0.12;
    this.revealData = { scoring: new Set(scoringDice), valueOf, hidden };
  }

  private stepReveal() {
    const data = this.revealData;
    if (!data) return;
    while (this.reveal.length > 0 && this.clock >= this.reveal[0].at) {
      const { die, step } = this.reveal.shift()!;
      const scoring = data.scoring.has(die);
      const value = data.valueOf(die);
      if (!data.hidden) {
        this.labels[die].show(value, scoring, this.clock);
        this.dice[die].flash();
      }
      // À l'aveugle, la note dépend de la valeur : on apprend à reconnaître chaque face.
      const semis = data.hidden ? value * 2 : REVEAL_NOTES[step % REVEAL_NOTES.length];
      const freq = REVEAL_BASE_HZ * 2 ** (semis / 12);
      this.sfx.tone(scoring && !data.hidden ? freq * 2 : freq, 0.14, scoring ? 0.3 : 0.18);
    }
    if (this.revealEnd > 0 && this.clock >= this.revealEnd) {
      this.revealEnd = -1;
      this.sfx.tone(REVEAL_BASE_HZ * 2, 0.4, 0.22);
      this.sfx.tone(REVEAL_BASE_HZ * 3, 0.45, 0.16);
      this.rules.onRevealed();
    }
  }

  /** Arrête la révélation ; `all` cache aussi les chiffres des dés gardés. */
  private clearReveal(all: boolean) {
    this.reveal = [];
    this.revealEnd = -1;
    this.revealData = null;
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

  /** Confinement, puis chocs physiques transformés en sons. */
  afterStep(events: RAPIER.EventQueue) {
    this.containDice();
    events.drainContactForceEvents((e) => {
      const a = this.colliderKinds.get(e.collider1());
      const b = this.colliderKinds.get(e.collider2());
      if (a !== 'die' && b !== 'die') return;
      const other = a === 'die' ? b : a;
      const kind: SfxKind = other === 'die' ? 'click' : other === 'cup' ? 'cup' : other === 'felt' ? 'felt' : 'wood';
      const intensity = (e.totalForceMagnitude() - FORCE_THRESHOLD) / 2500;
      this.sfx.play(kind, intensity);
      // Un dé qui retombe sur le feutre soulève une bouffée de poussière.
      if (other === 'felt' && intensity > 0.08) {
        const die = this.dieByCollider.get(a === 'die' ? e.collider1() : e.collider2());
        if (die) this.effects.dust(die.position, Math.min(1, intensity));
      }
    });
  }

  render() {
    this.cup.syncMesh();
    this.dice.forEach((d, i) => {
      d.syncMesh();
      this.labels[i].update(this.clock, d.mesh.position);
    });
  }
}
