import * as THREE from 'three';
import { TABLE_HALF_D, TABLE_HALF_W } from './config';
import { CREDITOR_HANDS, HAND_SCALE, Hand, PLAYER_HANDS, type HandLook } from './creditor/hand';
import { buildPiece } from './jarShelf';
import { ps1ify } from './render/ps1';
import { Particles } from './render/particles';
import { grimeTexture } from './render/textures';
import type { Body, BodyPartId } from './rules/body';

/**
 * Les pactes, montrés. Chaque partie a sa scène, son outil et son geste : le créancier tient,
 * l'outil approche, ça coupe, ça gicle, et ce qui a été pris s'éloigne dans sa main.
 * Les doigts et la main se jouent sur le feutre, en gros plan ; les dents, la langue, l'oreille,
 * l'œil et le cœur se jouent face à la caméra, comme si c'était ton visage.
 */

export interface CutsceneFx {
  jolt(amount: number): void;
  tear(amount: number): void;
  aberration(amount: number): void;
  lean(point: THREE.Vector3 | null, from?: THREE.Vector3, speed?: number): void;
  /** Sang projeté sur l'écran, centré en (u, v) (0..1 depuis le haut gauche). */
  splatter(u: number, v: number, amount: number): void;
  /** Yeux perdus : la moitié du monde s'éteint. */
  eyes(lost: number): void;
}

export interface Cutscene {
  /** Durée totale (s). */
  duration: number;
  /** Instant de la coupure (s), pour caler les sons. */
  cut: number;
  update(t: number, dt: number): void;
  dispose(): void;
  /** Ce qui reste sur la table après la scène (la flaque). */
  keep: THREE.Object3D[];
}

const ORDER = [3, 2, 1, 0]; // l'auriculaire part en premier
const ease = (t: number) => t * t * (3 - 2 * t);
const clamp01 = (t: number) => Math.min(1, Math.max(0, t));
const phase = (t: number, a: number, b: number) => ease(clamp01((t - a) / (b - a)));

// Peu métallique : sans environnement à refléter, un acier « vrai » serait noir.
const steel = () => new THREE.MeshStandardMaterial({ color: 0xc8ccd0, metalness: 0.35, roughness: 0.3 });
const rusty = () => new THREE.MeshStandardMaterial({ color: 0x8a6a50, map: grimeTexture(), metalness: 0.6, roughness: 0.6 });
const handle = (color = 0x5a1a12) => new THREE.MeshStandardMaterial({ color, roughness: 0.6 });

/** Une tache de sang, ses éclaboussures autour. */
function splatTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  const blob = (x: number, y: number, r: number) => {
    const grad = g.createRadialGradient(x, y, 0, x, y, r);
    grad.addColorStop(0, 'rgba(255, 255, 255, 1)');
    grad.addColorStop(0.7, 'rgba(235, 235, 235, 0.95)');
    grad.addColorStop(1, 'rgba(200, 200, 200, 0)');
    g.fillStyle = grad;
    g.beginPath();
    g.arc(x, y, r, 0, Math.PI * 2);
    g.fill();
  };
  blob(32, 32, 15);
  for (let i = 0; i < 7; i++) {
    const a = Math.random() * Math.PI * 2;
    const d = 12 + Math.random() * 14;
    blob(32 + Math.cos(a) * d, 32 + Math.sin(a) * d, 1.5 + Math.random() * 3.5);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** Les gouttes tombées sur le feutre : elles restent, d'un pacte à l'autre, jusqu'à la fin de la run. */
export class Splats {
  private readonly mesh: THREE.InstancedMesh;
  private next = 0;
  private readonly m = new THREE.Matrix4();
  private readonly q = new THREE.Quaternion();
  private readonly up = new THREE.Vector3(0, 1, 0);
  private readonly c = new THREE.Color();

  constructor(scene: THREE.Scene, private readonly max = 700) {
    this.mesh = new THREE.InstancedMesh(
      new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2),
      new THREE.MeshStandardMaterial({ map: splatTexture(), transparent: true, roughness: 0.55, metalness: 0, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 }),
      max,
    );
    // Couleurs d'instance créées d'avance : pas de shader à recompiler à la première goutte.
    for (let i = 0; i < max; i++) this.mesh.setColorAt(i, this.c.setRGB(0.3, 0.01, 0.01));
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
    scene.add(this.mesh);
  }

  /** Une goutte s'écrase en (x, z). Hors du feutre, elle se perd dans le noir. */
  add(x: number, z: number, size: number, color: [number, number, number]) {
    if (Math.abs(x) > TABLE_HALF_W - 0.1 || Math.abs(z) > TABLE_HALF_D - 0.1) return false;
    const s = size * (0.7 + Math.random() * 0.6);
    this.q.setFromAxisAngle(this.up, Math.random() * Math.PI * 2);
    this.m.compose(new THREE.Vector3(x, 0.013 + Math.random() * 0.003, z), this.q, new THREE.Vector3(s * (0.8 + Math.random() * 0.5), 1, s));
    this.mesh.setMatrixAt(this.next, this.m);
    // Le sang fonce en touchant le feutre.
    this.mesh.setColorAt(this.next, this.c.setRGB(color[0] * 0.42, color[1] * 0.3, color[2] * 0.3));
    this.next = (this.next + 1) % this.max;
    this.mesh.count = Math.min(this.max, this.mesh.count + 1);
    this.mesh.instanceMatrix.needsUpdate = true;
    this.mesh.instanceColor!.needsUpdate = true;
    return true;
  }

  clear() {
    this.next = 0;
    this.mesh.count = 0;
  }
}

/** Le sang : des gouttes lourdes qui retombent et s'écrasent en taches sur le feutre. */
export function bloodParticles(scene: THREE.Scene, splats: Splats) {
  return new Particles(scene, {
    max: 900,
    life: [1.2, 2.2],
    size: [0.2, 0.16],
    alpha: 1,
    gravity: -16,
    drag: 0.5,
    softness: 0.3,
    onLand: (x, z, scale, color) => splats.add(x, z, 0.22 + scale * 0.32, color),
  });
}

const BLOOD = () => new THREE.Color(0.28 + Math.random() * 0.2, 0.006, 0.006);

// Sous l'ampoule, à un mètre du feutre, les peaux pâles brûlent l'image : on les fonce un peu.
const GORE_CREDITOR: HandLook = { ...CREDITOR_HANDS, skin: 0x988e86, knuckle: 0x786e66 };
const GORE_PLAYER: HandLook = { ...PLAYER_HANDS, skin: 0xc0a08c, knuckle: 0xa08070 };

function spurt(blood: Particles, at: THREE.Vector3, dir: THREE.Vector3, n: number, force = 4, spread = 1.4, size = 1) {
  for (let i = 0; i < n; i++) {
    // Un jet : quelques grosses gouttes lentes, beaucoup de fines qui partent loin.
    const fine = Math.random();
    const v = dir.clone().multiplyScalar(force * (0.3 + fine * 1.3));
    v.x += (Math.random() - 0.5) * spread;
    v.y += (Math.random() - 0.3) * spread;
    v.z += (Math.random() - 0.5) * spread;
    const p = at.clone().add(new THREE.Vector3((Math.random() - 0.5) * 0.15, (Math.random() - 0.5) * 0.15, (Math.random() - 0.5) * 0.15));
    blood.emit({ position: p, velocity: v, color: BLOOD(), scale: (0.35 + (1 - fine) * 1.1) * size });
  }
}

/** Une flaque qui naît sous la plaie et s'étale tant que ça saigne. */
function pool(): { mesh: THREE.Mesh; grow(k: number): void } {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  for (let i = 0; i < 9; i++) {
    const x = 32 + (Math.random() - 0.5) * (i ? 30 : 0);
    const y = 32 + (Math.random() - 0.5) * (i ? 30 : 0);
    const r = i ? 4 + Math.random() * 8 : 22;
    const grad = g.createRadialGradient(x, y, 0, x, y, r);
    grad.addColorStop(0, 'rgba(84, 3, 3, 0.97)');
    grad.addColorStop(0.75, 'rgba(64, 2, 2, 0.92)');
    grad.addColorStop(1, 'rgba(44, 0, 0, 0)');
    g.fillStyle = grad;
    g.beginPath();
    g.arc(x, y, r, 0, Math.PI * 2);
    g.fill();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(1, 1),
    new THREE.MeshStandardMaterial({ map: tex, transparent: true, roughness: 0.62, metalness: 0, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3 }),
  );
  mesh.rotation.x = -Math.PI / 2;
  mesh.scale.setScalar(0.001);
  return { mesh, grow: (k) => mesh.scale.setScalar(Math.max(0.001, k)) };
}

// ---------------------------------------------------------------- outils (pointe vers +Z)

function shears(): { group: THREE.Group; open(a: number): void } {
  const group = new THREE.Group();
  const blades = [new THREE.Group(), new THREE.Group()];
  blades.forEach((b, i) => {
    const blade = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.035, 0.9), steel());
    blade.position.z = 0.45;
    const grip = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.08, 0.9), handle(0x7a1010));
    grip.position.z = -0.45;
    grip.rotation.y = (i ? 1 : -1) * 0.25;
    b.add(blade, grip);
    b.position.y = i * 0.035;
    group.add(b);
  });
  group.add(new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.1, 6), steel()));
  return {
    group,
    open: (a) => {
      blades[0].rotation.y = a * 0.45;
      blades[1].rotation.y = -a * 0.45;
    },
  };
}

function pliers(): { group: THREE.Group; open(a: number): void } {
  const group = new THREE.Group();
  const jaws = [new THREE.Group(), new THREE.Group()];
  jaws.forEach((j, i) => {
    const jaw = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.06, 0.35), rusty());
    jaw.position.z = 0.18;
    const arm = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.07, 1.1), handle(0x2a2a2a));
    arm.position.z = -0.55;
    j.add(jaw, arm);
    group.add(j);
    j.userData.side = i ? 1 : -1;
  });
  return {
    group,
    open: (a) => jaws.forEach((j) => (j.rotation.y = j.userData.side * a * 0.3)),
  };
}

function razor(): THREE.Group {
  const g = new THREE.Group();
  const blade = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.22, 0.9), steel());
  blade.position.z = 0.45;
  const edge = new THREE.Mesh(new THREE.BoxGeometry(0.01, 0.02, 0.9), new THREE.MeshStandardMaterial({ color: 0xffffff, metalness: 1, roughness: 0.05 }));
  edge.position.set(0, -0.11, 0.45);
  const grip = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.16, 0.8), handle(0xd8ccb0));
  grip.position.z = -0.4;
  g.add(blade, edge, grip);
  return g;
}

function spoon(): THREE.Group {
  const g = new THREE.Group();
  const bowl = new THREE.Mesh(new THREE.SphereGeometry(0.22, 10, 6, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2), steel());
  bowl.scale.set(1, 0.5, 1.4);
  bowl.rotation.x = Math.PI;
  bowl.position.z = 0.3;
  const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.04, 1.3, 5), steel());
  stem.rotation.x = Math.PI / 2;
  stem.position.z = -0.4;
  g.add(bowl, stem);
  return g;
}

function cleaver(): THREE.Group {
  const g = new THREE.Group();
  const blade = new THREE.Mesh(new THREE.BoxGeometry(0.06, 1.0, 1.5), rusty());
  blade.position.set(0, -0.35, 0.2);
  const edge = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.06, 1.5), steel());
  edge.position.set(0, -0.86, 0.2);
  const stain = new THREE.Mesh(new THREE.BoxGeometry(0.065, 0.4, 0.6), new THREE.MeshStandardMaterial({ color: 0x4a0606, roughness: 0.3 }));
  stain.position.set(0, -0.62, 0.4);
  const grip = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.12, 1.1, 6), handle(0x3a2010));
  grip.rotation.x = Math.PI / 2;
  grip.position.set(0, 0.05, -1.05);
  g.add(blade, edge, stain, grip);
  return g;
}

/** Une main du créancier, refermée sur un manche ou ouverte, accrochée à un outil. */
function creditorFist(curl: number, scale = 0.55) {
  const h = new Hand(false, GORE_CREDITOR);
  h.root.scale.setScalar(scale);
  h.curl.fill(curl);
  h.pose();
  return h;
}

// ---------------------------------------------------------------- scènes

export interface CutsceneCtx {
  scene: THREE.Scene;
  camera: THREE.Camera;
  fx: CutsceneFx;
  blood: Particles;
  /** Le corps après le pacte : sait déjà ce qui manque. */
  body: Body;
  /** Une lampe pour les gros plans du visage (éteinte le reste du temps). */
  light: THREE.PointLight;
}

export function buildCutscene(part: BodyPartId, ctx: CutsceneCtx): Cutscene {
  switch (part) {
    case 'doigt':
      return fingerScene(ctx);
    case 'main':
      return handScene(ctx);
    case 'coeur':
      return heartScene(ctx);
    case 'dent':
      return toothScene(ctx);
    case 'langue':
      return tongueScene(ctx);
    case 'oreille':
      return earScene(ctx);
    case 'oeil':
      return eyeScene(ctx);
  }
}

/** Assemble une scène : des objets à retirer à la fin, une fonction d'animation. */
function scene(ctx: CutsceneCtx, objects: THREE.Object3D[], duration: number, cut: number, update: (t: number, dt: number) => void, keep: THREE.Object3D[] = []): Cutscene {
  for (const o of objects) {
    ps1ify(o);
    ctx.scene.add(o);
  }
  return {
    duration,
    cut,
    update,
    keep,
    dispose: () => {
      for (const o of objects) if (!keep.includes(o)) ctx.scene.remove(o);
      ctx.fx.lean(null);
      ctx.light.intensity = 0;
    },
  };
}

/** Ta main sur le feutre, maintenue à plat par le créancier. */
function pinnedHand(left: boolean, missing: number[]) {
  const ph = new Hand(left, GORE_PLAYER, false, true);
  ph.root.scale.setScalar(1.1);
  ph.curl.fill(0.05);
  ph.curl[4] = 0.25;
  ph.pose();
  ph.setMissing(missing);
  const grip = creditorFist(0.55, 0.85);
  return { ph, grip };
}

function fingerScene(ctx: CutsceneCtx): Cutscene {
  const b = ctx.body;
  const left = !b.hand;
  const lost = left ? b.leftFingersLost : b.rightFingersLost;
  const f = ORDER[Math.max(0, lost - 1)];
  const before = ORDER.slice(0, Math.max(0, lost - 1));
  const { ph, grip } = pinnedHand(left, before);
  const tool = shears();
  tool.group.scale.setScalar(2.0);
  const piece = buildPiece('doigt');
  piece.scale.multiplyScalar(1.9);
  piece.visible = false;
  const wrist = new THREE.Vector3(left ? -0.5 : 0.5, 0.45, 4.8);
  // Côté de l'auriculaire : à gauche pour la main gauche (paume à plat), à droite pour la droite.
  const pinky = left ? -1 : 1;
  ctx.fx.lean(new THREE.Vector3(wrist.x + pinky * 0.3, 0.3, 3.5), new THREE.Vector3(wrist.x - pinky * 0.5, 6.6, 7.7), 3);
  let cutDone = false;
  const fall = { v: new THREE.Vector3(), spin: new THREE.Vector3() };
  const puddle = pool();
  return scene(ctx, [ph.root, grip.root, tool.group, piece, puddle.mesh], 3.6, 1.5, (t, dt) => {
    // La main glisse sur le feutre ; il lui serre le poignet par le côté du pouce et la cloue à plat.
    const slide = phase(t, 0, 0.5);
    ph.root.position.copy(wrist).add(new THREE.Vector3(0, 0, (1 - slide) * 3));
    ph.root.rotation.set(0.02, Math.PI + (left ? -0.08 : 0.08), 0, 'YXZ');
    grip.root.position.set(wrist.x - pinky * 2.0, 1.35 - phase(t, 0.3, 0.7) * 0.2, wrist.z - 0.7);
    grip.root.rotation.set(0.55, pinky * 1.35, 0, 'YXZ');
    // Le sécateur arrive, s'ouvre au-dessus du doigt, se referme d'un coup.
    const base = ph.fingerBase(f);
    const open = t < 1.5 ? 1 - phase(t, 1.35, 1.5) * 0.2 : t < 1.56 ? 1 - (t - 1.5) / 0.06 : 0;
    tool.open(Math.max(0, open));
    const approach = phase(t, 0.5, 1.3);
    const lift = phase(t, 1.8, 2.5);
    tool.group.position.copy(base).add(new THREE.Vector3(pinky * ((1 - approach) * 3.5 + 0.25), 0.12 + lift * 2.5 + (1 - approach) * 1.5, 0.18));
    tool.group.rotation.set(0, -pinky * (Math.PI / 2 + 0.25), 0);
    if (t >= 1.53 && !cutDone) {
      cutDone = true;
      ph.setMissing([...before, f]);
      piece.visible = true;
      piece.position.copy(base).add(new THREE.Vector3(0, 0.1, -0.3));
      piece.rotation.set(Math.PI / 2, 0, 0);
      // Il saute de côté et retombe dans le champ, au bord de la flaque.
      fall.v.set(pinky * (2.3 + Math.random() * 0.5), 3.0, -0.9);
      fall.spin.set(6, 3, 2);
      ctx.fx.jolt(1.1);
      ctx.fx.tear(0.8);
      ctx.fx.aberration(0.012);
      ctx.fx.splatter(0.42, 0.95, 0.45);
      spurt(ctx.blood, base, new THREE.Vector3(0, 0.8, -0.6), 110, 4.2, 1.8);
    }
    if (cutDone) {
      // Le doigt rebondit sur le feutre ; le moignon pisse le sang par saccades.
      fall.v.y -= 14 * dt;
      piece.position.addScaledVector(fall.v, dt);
      if (piece.position.y < 0.08) {
        piece.position.y = 0.08;
        fall.v.multiplyScalar(0.45);
        fall.v.y = Math.abs(fall.v.y) * 0.4;
        fall.spin.multiplyScalar(0.6);
      }
      piece.rotation.x += fall.spin.x * dt;
      piece.rotation.z += fall.spin.z * dt;
      if (t < 3.0 && Math.sin(t * 22) > 0.3) spurt(ctx.blood, base, new THREE.Vector3(0, 0.6, -0.5), 6, 2.6, 0.7);
      puddle.mesh.position.set(base.x + pinky * 0.35, 0.015, base.z - 0.45);
      puddle.grow(phase(t, 1.55, 3.4) * 2.0);
    }
  }, [puddle.mesh]);
}

function handScene(ctx: CutsceneCtx): Cutscene {
  const b = ctx.body;
  const missing = ORDER.slice(0, Math.min(4, b.fingersAtHand));
  const S = 1.1 * HAND_SCALE;
  // Ta main gauche, à plat ; il te tient les doigts depuis son côté de la table et tire le bras bien droit.
  const ph = new Hand(true, GORE_PLAYER, false, true);
  ph.root.scale.setScalar(1.1);
  ph.curl.fill(0.05);
  ph.curl[4] = 0.25;
  ph.pose();
  ph.setMissing(missing);
  const pin = creditorFist(0.45, 0.85);
  const severed = new Hand(true, GORE_PLAYER, true, true);
  severed.root.scale.setScalar(1.1);
  severed.curl.fill(0.05);
  severed.pose();
  severed.setMissing(missing);
  severed.root.visible = false;
  // Ce qui reste du bras : la manche, la manchette, le poignet ouvert, l'os au milieu.
  const stump = new THREE.Group();
  const box = (w: number, h: number, l: number, color: number, z: number, rough = 1) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w * S, h * S, l * S), new THREE.MeshStandardMaterial({ color, roughness: rough }));
    m.position.z = z * S;
    m.castShadow = true;
    stump.add(m);
    return m;
  };
  box(0.72, 0.48, 5, PLAYER_HANDS.sleeve, -3.0).position.y = 0.05 * S;
  box(0.78, 0.5, 0.3, PLAYER_HANDS.cuff, -0.38).position.y = 0.03 * S;
  box(0.64, 0.3, 0.12, GORE_PLAYER.skin, -0.2, 0.6);
  box(0.6, 0.27, 0.02, 0x7a0808, -0.13, 0.2);
  const bone = new THREE.Mesh(new THREE.CylinderGeometry(0.06 * S, 0.06 * S, 0.04 * S, 6).rotateX(Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0xe8e0c8 }));
  bone.position.set(0.1 * S, 0, -0.12 * S);
  stump.add(bone);
  stump.visible = false;
  // Le hachoir, plus grand que nature, et la main qui le tient refermée sur le manche.
  const tool = cleaver();
  tool.scale.setScalar(1.4);
  const holder = creditorFist(0.95, 0.85 / 1.4);
  holder.root.position.set(-1.08, 0.29, -1.15);
  holder.root.rotation.set(0, Math.PI / 2, 0);
  tool.add(holder.root);
  const W = new THREE.Vector3(-0.5, 0.45, 4.8);
  const yaw = Math.PI - 0.08;
  const cutAt = new THREE.Vector3(W.x + 0.08, 0.45, W.z + 0.05);
  ctx.fx.lean(new THREE.Vector3(-0.3, 0.3, 3.4), new THREE.Vector3(0.8, 8.0, 7.6), 3);
  let cutDone = false;
  const puddle = pool();
  const STRIKE = 1.62;
  const HIT = STRIKE + 0.08;
  return scene(ctx, [ph.root, pin.root, severed.root, stump, tool, puddle.mesh], 4.4, HIT, (t) => {
    const slide = phase(t, 0, 0.5);
    ph.root.position.copy(W).add(new THREE.Vector3(0, 0, (1 - slide) * 3));
    ph.root.rotation.set(0.02, yaw, 0, 'YXZ');
    // Il saisit tes doigts et les plaque au feutre ; après la coupe, il emporte la main vers lui.
    const take = phase(t, 2.1, 3.3);
    const grab = phase(t, 0.35, 0.65);
    pin.root.position.set(W.x + 0.15, 1.15 + (1 - grab) * 1.6 + take * 0.9, W.z - 4.6 - take * 2.6);
    pin.root.rotation.set(0.25 - take * 0.15, 0, 0, 'YXZ');
    pin.curl.fill(0.25 + grab * 0.25);
    pin.pose();
    // Le hachoir monte, hésite, tremble, puis tombe d'un coup sur le poignet et se plante dans la table.
    const raise = phase(t, 0.5, 1.4);
    const lift = phase(t, 2.7, 3.6);
    const rest = new THREE.Vector3(cutAt.x + 0.28, 1.3, cutAt.z);
    const start = rest.clone().add(new THREE.Vector3(2.2, 2.2, -3.4));
    const high = rest.clone().add(new THREE.Vector3(0.4, 2.3, -0.8));
    const p = new THREE.Vector3();
    let tilt: number;
    if (t < STRIKE) {
      p.copy(start).lerp(high, raise);
      if (t > 1.4) p.addScaledVector(new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, 0), 0.05);
      tilt = 0.3 * raise;
    } else if (t < HIT) {
      const k = (t - STRIKE) / (HIT - STRIKE);
      p.copy(high).lerp(rest, k * k);
      tilt = 0.3 * (1 - k) - 0.1 * k;
    } else {
      // Planté : il vibre, puis il est arraché du feutre.
      const shiver = Math.max(0, 1 - (t - HIT) / 0.5);
      p.copy(rest).add(new THREE.Vector3(lift * 1.5, lift * 2.2, -lift * 3.5)).addScaledVector(new THREE.Vector3(1, 0, 0), Math.sin(t * 90) * 0.03 * shiver);
      tilt = -0.1 + 0.3 * lift;
    }
    tool.position.copy(p);
    tool.rotation.set(0, -Math.PI / 2, tilt);
    if (t >= HIT && !cutDone) {
      cutDone = true;
      ph.root.visible = false;
      severed.root.visible = true;
      stump.visible = true;
      ctx.fx.jolt(1.7);
      ctx.fx.tear(1);
      ctx.fx.aberration(0.018);
      ctx.fx.splatter(0.5, 0.95, 0.8);
      spurt(ctx.blood, cutAt.clone().add(new THREE.Vector3(0, 0.3, 0)), new THREE.Vector3(0.3, 1, 0.5), 160, 5.5, 2.4);
      spurt(ctx.blood, cutAt.clone().add(new THREE.Vector3(0, 0.3, 0)), new THREE.Vector3(-0.6, 0.5, -0.3), 60, 4, 1.4);
    }
    if (cutDone) {
      // La main part dans sa poigne ; le bras recule vers toi en pissant le sang par saccades.
      severed.root.position.copy(W).add(new THREE.Vector3(0, take * 0.9, -take * 2.6));
      severed.root.rotation.set(0.02 - take * 0.15, yaw, 0, 'YXZ');
      const back = phase(t, 2.3, 3.8);
      stump.position.copy(W).add(new THREE.Vector3(0, back * 0.35, back * 2.2));
      stump.rotation.set(-back * 0.1, yaw, 0, 'YXZ');
      const face = stump.localToWorld(new THREE.Vector3(0, 0, -0.1 * S));
      if (t < 3.9 && Math.sin(t * 17) > 0.1) spurt(ctx.blood, face, new THREE.Vector3(0.05, 0.7, -0.7), 7, 3.4, 0.9);
      // Le poignet coupé de la main emportée goutte encore.
      if (Math.random() < 0.6) spurt(ctx.blood, severed.root.localToWorld(new THREE.Vector3(0, 0, -0.2)), new THREE.Vector3(0, -1, 0), 2, 0.8, 0.3);
      puddle.mesh.position.set(cutAt.x, 0.015, cutAt.z - 0.2);
      puddle.grow(phase(t, HIT, 3.9) * 3.6);
    }
  }, [puddle.mesh]);
}

// ---------------------------------------------------------------- le visage : tout se passe sous tes yeux

type V3 = [number, number, number];
/** Une pose d'outil dans le repère de ta tête : x à droite, y en haut, z devant toi. */
interface Key {
  t: number;
  /** Où est l'outil. */
  p: V3;
  /** Vers quoi pointe sa pointe. */
  aim: V3;
  roll?: number;
}

/** Repère de la tête : un point devant les yeux, en coordonnées du monde. */
function headSpace(ctx: CutsceneCtx) {
  return (x: number, y: number, z: number) => ctx.camera.localToWorld(new THREE.Vector3(x, y, -z));
}

/** La pose à l'instant t, interpolée entre les clés. */
function track(keys: Key[], t: number) {
  let i = 0;
  while (i < keys.length - 2 && t >= keys[i + 1].t) i++;
  const a = keys[i];
  const b = keys[Math.min(i + 1, keys.length - 1)];
  const k = b.t > a.t ? ease(clamp01((t - a.t) / (b.t - a.t))) : 1;
  const mix = (x: V3, y: V3): V3 => [x[0] + (y[0] - x[0]) * k, x[1] + (y[1] - x[1]) * k, x[2] + (y[2] - x[2]) * k];
  return { p: mix(a.p, b.p), aim: mix(a.aim, b.aim), roll: (a.roll ?? 0) + ((b.roll ?? 0) - (a.roll ?? 0)) * k };
}

function pose(obj: THREE.Object3D, head: ReturnType<typeof headSpace>, k: ReturnType<typeof track>, shake = 0) {
  const j = () => (Math.random() - 0.5) * shake;
  obj.position.copy(head(k.p[0] + j(), k.p[1] + j(), k.p[2]));
  obj.lookAt(head(...k.aim));
  obj.rotateZ(k.roll);
}

/**
 * Une main qui te montre quelque chose : poignet en `p`, doigts vers `f` (repère de la tête),
 * paume tournée vers tes yeux.
 */
function present(obj: THREE.Object3D, ctx: CutsceneCtx, k: ReturnType<typeof track>, shake = 0) {
  const head = headSpace(ctx);
  const j = () => (Math.random() - 0.5) * shake;
  // Repère local de la caméra (z vers l'arrière) : on retourne le z de la tête.
  const z = new THREE.Vector3(k.aim[0], k.aim[1], -k.aim[2]).normalize();
  const toEye = new THREE.Vector3(-k.p[0], -k.p[1], k.p[2]).normalize();
  // La paume est la face -y de la main : le dos regarde à l'opposé de tes yeux.
  const y = toEye.negate();
  y.addScaledVector(z, -y.dot(z)).normalize();
  const x = new THREE.Vector3().crossVectors(y, z);
  const local = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, y, z));
  obj.quaternion.copy(ctx.camera.getWorldQuaternion(new THREE.Quaternion())).multiply(local);
  obj.position.copy(head(k.p[0] + j(), k.p[1] + j(), k.p[2]));
}

/** Direction dans le repère de la tête, en coordonnées du monde. */
function headDir(head: ReturnType<typeof headSpace>, x: number, y: number, z: number) {
  return head(x, y, z).sub(head(0, 0, 0)).normalize();
}

/** Un outil tenu par une main du créancier, dont le bras repart vers son côté de la table. */
function held<T extends { group: THREE.Object3D }>(tool: T, scale = 0.34): T {
  const fist = creditorFist(0.9, scale);
  fist.root.position.set(0, 0.1, -1.3);
  tool.group.add(fist.root);
  return tool;
}

/** Ce qu'il vient de prendre, posé au bout de l'outil, qui goutte. */
function trophy(part: BodyPartId, parent: THREE.Object3D, at: V3, scale: number) {
  const piece = buildPiece(part);
  piece.scale.multiplyScalar(scale);
  piece.position.set(...at);
  piece.visible = false;
  parent.add(piece);
  return piece;
}

/** La lumière de la scène : une lampe qu'il approche de ton visage, pour que tu voies tout. */
function lamp(ctx: CutsceneCtx, t: number, duration: number, level = 1, at: V3 = [0.3, 0.8, -0.4]) {
  const head = headSpace(ctx);
  // Par défaut au-dessus et un peu derrière toi : elle éclaire ce qu'il te montre sans brûler ce qui frôle ton œil.
  ctx.light.position.copy(head(...at));
  ctx.light.intensity = 3.5 * level * phase(t, 0, 0.4) * (1 - phase(t, duration - 0.4, duration));
}

function cutFx(ctx: CutsceneCtx, amount: number, u: number, v: number) {
  // Au visage, l'image cogne fort mais reste lisible : peu de déchirure ; le sang, lui, te saute aux yeux.
  ctx.fx.jolt(1.3 * amount);
  ctx.fx.tear(0.45 * amount);
  ctx.fx.aberration(0.01 * amount);
  ctx.fx.splatter(u, v, amount);
}

/** La pince : elle entre par le bas, mord, tourne, arrache ; puis il te montre la molaire. */
function toothScene(ctx: CutsceneCtx): Cutscene {
  const head = headSpace(ctx);
  ctx.fx.lean(null);
  const tool = held(pliers());
  const tooth = trophy('dent', tool.group, [0, 0, 0.38], 0.6);
  const MOUTH: V3 = [0, -0.72, 0.3];
  const show: Key = { t: 2.5, p: [0.12, -0.12, 1.25], aim: [-0.55, 0.12, 1.1], roll: 0.2 };
  const keys: Key[] = [
    { t: 0, p: [1.1, -1.2, 2.2], aim: [0.2, -0.8, 0.6] },
    { t: 0.9, p: [0.42, -0.42, 1.25], aim: [0.05, -0.75, 0.45] },
    { t: 1.35, p: [0.16, -0.55, 0.95], aim: MOUTH },
    { t: 1.7, p: [0.16, -0.56, 0.96], aim: MOUTH, roll: 0.7 },
    { t: 1.85, p: [0.5, -0.85, 1.4], aim: [0.1, -0.9, 0.6], roll: 0.3 },
    show,
    { ...show, t: 3.2, p: [0.1, -0.08, 1.2] },
    { t: 3.9, p: [1.2, -0.9, 2.4], aim: [0.6, -0.6, 1.4] },
  ];
  let cutDone = false;
  return scene(ctx, [tool.group], 3.9, 1.72, (t) => {
    lamp(ctx, t, 3.9);
    // Il tourne la dent dans sa gencive avant de tirer : la pince tremble de l'effort.
    pose(tool.group, head, track(keys, t), t > 1.35 && t < 1.72 ? 0.025 : 0.004);
    tool.open(t < 1.25 ? phase(t, 0.5, 1.0) : 0);
    if (t >= 1.72 && !cutDone) {
      cutDone = true;
      tooth.visible = true;
      cutFx(ctx, 1.1, 0.5, 0.88);
      spurt(ctx.blood, head(0, -0.55, 1.0), headDir(head, 0.1, 0.45, 1), 120, 3.0, 1.0, 0.16);
    }
    if (cutDone) {
      // Le sang coule de ta bouche par saccades ; la molaire goutte au bout de la pince.
      if (t < 2.8 && Math.sin(t * 15) > 0.5) spurt(ctx.blood, head(0, -0.6, 0.9), headDir(head, 0, 0.2, 1), 3, 1.6, 0.5, 0.14);
      if (Math.random() < 0.5) spurt(ctx.blood, tooth.getWorldPosition(new THREE.Vector3()), new THREE.Vector3(0, -1, 0), 1, 0.6, 0.2, 0.14);
    }
  });
}

/** La langue : la pince la tire hors de ta bouche, toute tendue, et le sécateur la coupe en deux fois. */
function tongueScene(ctx: CutsceneCtx): Cutscene {
  const head = headSpace(ctx);
  ctx.fx.lean(null);
  const puller = held(pliers());
  const cutter = held(shears());
  cutter.group.scale.setScalar(0.5);
  const MOUTH: V3 = [0, -0.68, 0.32];
  // La langue tirée : un ruban de chair entre ta bouche et la pince.
  const flesh = new THREE.MeshStandardMaterial({ color: 0x9a3438, roughness: 0.25, map: grimeTexture() });
  const strip = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.11, 1, 8).rotateX(Math.PI / 2).translate(0, 0, 0.5), flesh);
  strip.scale.set(1.15, 0.7, 0.01);
  strip.visible = false;
  const tongue = trophy('langue', puller.group, [0, -0.02, 0.62], 0.75);
  tongue.rotation.set(0, Math.PI, 0);
  const pull: Key[] = [
    { t: 0, p: [-1.0, -1.1, 2.0], aim: [-0.2, -0.8, 0.5] },
    { t: 0.8, p: [-0.15, -0.5, 1.05], aim: MOUTH },
    { t: 1.0, p: [-0.12, -0.52, 1.0], aim: MOUTH },
    // Il tire : la langue sort, s'étire jusqu'au milieu de ta vue, tremble.
    { t: 1.55, p: [-0.22, 0.05, 1.75], aim: MOUTH },
    { t: 2.05, p: [-0.24, 0.07, 1.8], aim: MOUTH },
    // Coupée : la pince recule d'un coup, puis te la montre.
    { t: 2.2, p: [-0.45, -0.1, 1.9], aim: [0.0, -0.4, 1.0] },
    { t: 2.9, p: [-0.05, -0.08, 1.4], aim: [0.6, 0.0, 1.5], roll: -0.3 },
    { t: 3.5, p: [-0.02, -0.06, 1.35], aim: [0.6, 0.02, 1.45], roll: -0.3 },
    { t: 4.2, p: [-1.2, -0.9, 2.4], aim: [-0.6, -0.6, 1.4] },
  ];
  const snip: Key[] = [
    { t: 0, p: [1.4, -0.9, 2.2], aim: [0.4, -0.6, 1.4], roll: Math.PI / 2 },
    { t: 1.1, p: [1.2, -0.8, 2.0], aim: [0.3, -0.5, 1.2], roll: Math.PI / 2 },
    { t: 1.7, p: [0.24, -0.27, 1.14], aim: [-0.12, -0.28, 1.1], roll: Math.PI / 2 },
    { t: 2.0, p: [0.22, -0.27, 1.12], aim: [-0.14, -0.28, 1.08], roll: Math.PI / 2 },
    { t: 2.8, p: [1.4, -1.0, 2.2], aim: [0.6, -0.6, 1.5], roll: Math.PI / 2 },
  ];
  const CUT = 2.05;
  let first = false;
  let cutDone = false;
  return scene(ctx, [puller.group, cutter.group, strip], 4.2, CUT, (t) => {
    lamp(ctx, t, 4.2);
    pose(puller.group, head, track(pull, t), t > 1.0 && t < CUT ? 0.02 : 0.004);
    pose(cutter.group, head, track(snip, t), 0.004);
    puller.open(t < 0.85 ? phase(t, 0.3, 0.7) : 0);
    // Deux coups : le premier entaille, le second tranche.
    cutter.open(t < 1.75 ? phase(t, 1.2, 1.6) : t < 1.82 ? 0.3 : t < CUT - 0.06 ? 0.9 : 0);
    if (t > 1.0 && !cutDone) {
      // La langue va de ta bouche aux mâchoires de la pince.
      strip.visible = true;
      const root = head(...MOUTH);
      const tip = puller.group.localToWorld(new THREE.Vector3(0, 0, 0.36));
      strip.position.copy(root);
      strip.lookAt(tip);
      strip.scale.z = root.distanceTo(tip);
    }
    if (t >= 1.82 && !first) {
      first = true;
      cutFx(ctx, 0.5, 0.55, 0.86);
      spurt(ctx.blood, head(-0.12, -0.28, 1.1), headDir(head, 0.2, 0.5, 0.3), 40, 2.0, 0.8, 0.16);
    }
    if (t >= CUT && !cutDone) {
      cutDone = true;
      strip.visible = false;
      tongue.visible = true;
      cutFx(ctx, 1.2, 0.5, 0.86);
      spurt(ctx.blood, head(0, -0.55, 1.0), headDir(head, 0, 0.45, 1), 150, 3.2, 1.1, 0.16);
    }
    if (cutDone) {
      if (t < 3.2 && Math.sin(t * 14) > 0.3) spurt(ctx.blood, head(0, -0.6, 0.9), headDir(head, 0, 0.3, 1), 4, 2, 0.6, 0.14);
      if (Math.random() < 0.6) spurt(ctx.blood, tongue.getWorldPosition(new THREE.Vector3()), new THREE.Vector3(0, -1, 0), 1, 0.6, 0.25, 0.14);
    }
  });
}

/** L'oreille : le rasoir passe à ta droite, scie, et sa main revient avec ce qu'il a coupé. */
function earScene(ctx: CutsceneCtx): Cutscene {
  const head = headSpace(ctx);
  ctx.fx.lean(null);
  const blade = held({ group: razor() });
  const taker = creditorFist(0.25, 0.42);
  // Posée dans la paume, à plat contre elle.
  const ear = trophy('oreille', taker.root, [0, -0.4, 1.3], 0.8 / 0.42);
  ear.rotation.set(Math.PI / 2, 0, 0.4);
  ear.visible = true;
  const EAR: V3 = [0.95, -0.05, 0.05];
  // Il est à ta droite : la lame vient de devant, file vers ton oreille, au bord de l'image.
  const slice: Key[] = [
    { t: 0, p: [1.5, 0.35, 2.7], aim: [1.15, 0.15, 1.0] },
    { t: 1.0, p: [0.78, 0.18, 1.25], aim: [EAR[0], 0.12, EAR[2]], roll: -0.4 },
    // Deux allers-retours de scie, puis le dernier, appuyé.
    { t: 1.15, p: [0.8, -0.05, 1.2], aim: [EAR[0], -0.12, EAR[2]], roll: -0.4 },
    { t: 1.3, p: [0.76, 0.16, 1.27], aim: [EAR[0], 0.08, EAR[2]], roll: -0.4 },
    { t: 1.5, p: [0.82, -0.3, 1.2], aim: [EAR[0], -0.36, EAR[2]], roll: -0.4 },
    { t: 2.1, p: [1.6, -0.5, 2.4], aim: [1.3, -0.5, 1.0], roll: -0.4 },
  ];
  // L'autre main monte du bas de l'image, paume vers toi, l'oreille posée dedans. (aim = sens des doigts)
  const show: Key[] = [
    { t: 0, p: [1.3, -1.8, 2.6], aim: [-0.3, 0.9, -0.2] },
    { t: 1.9, p: [1.2, -1.7, 2.6], aim: [-0.3, 0.9, -0.2] },
    { t: 2.6, p: [0.1, -0.85, 2.3], aim: [0, 0.92, -0.38] },
    { t: 3.3, p: [0.08, -0.83, 2.28], aim: [0, 0.92, -0.38] },
    { t: 3.9, p: [1.2, -1.9, 2.8], aim: [-0.3, 0.9, -0.2] },
  ];
  let cutDone = false;
  return scene(ctx, [blade.group, taker.root], 3.9, 1.5, (t) => {
    lamp(ctx, t, 3.9);
    pose(blade.group, head, track(slice, t), 0.006);
    present(taker.root, ctx, track(show, t), 0.004);
    if (t > 1.0 && t < 1.5 && Math.random() < 0.4) spurt(ctx.blood, head(0.72, 0.0, 0.9), headDir(head, -0.6, 0.3, 0.6), 2, 1.5, 0.5, 0.14);
    if (t >= 1.5 && !cutDone) {
      cutDone = true;
      cutFx(ctx, 1.0, 0.9, 0.5);
      // Ça gicle depuis le bord droit de l'image, en travers de ta vue.
      spurt(ctx.blood, head(0.75, -0.1, 0.9), headDir(head, -1, 0.3, 0.6), 110, 3.0, 1.0, 0.16);
    }
    if (cutDone && t < 3.0 && Math.sin(t * 13) > 0.4) spurt(ctx.blood, head(0.72, -0.12, 0.9), headDir(head, -0.7, 0.2, 0.5), 4, 2.2, 0.6, 0.14);
    if (cutDone && Math.random() < 0.5) spurt(ctx.blood, ear.getWorldPosition(new THREE.Vector3()), new THREE.Vector3(0, -1, 0), 1, 0.6, 0.25, 0.14);
  });
}

/** L'œil : la cuillère approche, tremblante, jusqu'à remplir la vue ; puis la moitié du monde s'éteint. */
function eyeScene(ctx: CutsceneCtx): Cutscene {
  const head = headSpace(ctx);
  ctx.fx.lean(null);
  // Le premier œil est le gauche (la moitié gauche du monde disparaît), le second le droit.
  const side = ctx.body.eyes >= 2 ? 1 : -1;
  const tool = held({ group: spoon() });
  const eye = trophy('oeil', tool.group, [0, -0.04, 0.3], 0.62);
  const EYE: V3 = [side * 0.12, 0.02, 0.0];
  const keys: Key[] = [
    { t: 0, p: [side * 0.5, -0.9, 2.6], aim: [side * 0.2, -0.3, 1.0] },
    { t: 1.0, p: [side * 0.25, -0.18, 1.0], aim: EYE },
    // Le dernier centimètre, très lent.
    { t: 1.75, p: [side * 0.16, -0.06, 0.42], aim: EYE },
    { t: 1.95, p: [side * 0.13, -0.02, 0.14], aim: EYE },
    { t: 2.1, p: [side * 0.13, -0.02, 0.16], aim: EYE, roll: 1.2 },
    // Elle ressort, le globe dans le creux, le nerf qui pend.
    { t: 2.9, p: [-side * 0.05, -0.28, 1.25], aim: [-side * 0.02, -0.12, 0], roll: Math.PI },
    { t: 3.6, p: [-side * 0.04, -0.26, 1.2], aim: [-side * 0.02, -0.1, 0], roll: Math.PI },
    { t: 4.3, p: [side * 0.6, -1.0, 2.6], aim: [side * 0.2, -0.4, 1.2], roll: Math.PI },
  ];
  let cutDone = false;
  return scene(ctx, [tool.group], 4.3, 2.0, (t) => {
    lamp(ctx, t, 4.3);
    pose(tool.group, head, track(keys, t), t < 2.0 ? 0.012 : 0.004);
    if (t >= 2.0 && !cutDone) {
      cutDone = true;
      eye.visible = true;
      cutFx(ctx, 1.3, 0.5 + side * 0.22, 0.48);
      ctx.fx.eyes(ctx.body.eyes);
      spurt(ctx.blood, head(side * 0.1, -0.05, 0.9), headDir(head, -side * 0.3, 0.25, 1), 110, 2.8, 1.0, 0.16);
    }
    if (cutDone) {
      if (t < 3.0 && Math.sin(t * 16) > 0.4) spurt(ctx.blood, head(side * 0.12, -0.12, 0.9), headDir(head, 0, -0.2, 1), 3, 1.4, 0.4, 0.14);
      if (Math.random() < 0.55) spurt(ctx.blood, eye.getWorldPosition(new THREE.Vector3()), new THREE.Vector3(0, -1, 0), 1, 0.6, 0.2, 0.14);
    }
  });
}

/** Le cœur : sa main nue s'enfonce sous ta vue, fouille, et remonte avec ce qui bat encore. */
function heartScene(ctx: CutsceneCtx): Cutscene {
  const head = headSpace(ctx);
  ctx.fx.lean(null);
  const hand = creditorFist(0.15, 0.5);
  // Au creux de la paume, la pointe vers le poignet.
  const heart = trophy('coeur', hand.root, [0, -0.9, 1.6], 1.6);
  heart.rotation.set(Math.PI / 2, 0, 0);
  const CHEST: V3 = [0, -1.1, 0.5];
  const keys: Key[] = [
    { t: 0, p: [0.2, 0.1, 3.4], aim: [0.1, -0.6, 0.8] },
    { t: 1.0, p: [0.05, -0.38, 1.6], aim: CHEST },
    { t: 1.35, p: [0.0, -0.75, 1.15], aim: CHEST },
    // Dedans : il fouille.
    { t: 1.55, p: [0.0, -0.95, 0.95], aim: CHEST },
    { t: 2.5, p: [0.02, -0.97, 0.95], aim: CHEST },
  ];
  // Il remonte du bas de l'image, paume vers toi, et te le tend : il bat encore. (aim = sens des doigts)
  const reveal: Key[] = [
    { t: 2.5, p: [0.0, -1.7, 1.6], aim: [0, 0.95, -0.3] },
    { t: 3.2, p: [0.0, -0.78, 2.6], aim: [0, 0.92, -0.4] },
    { t: 4.0, p: [0.0, -0.76, 2.55], aim: [0, 0.92, -0.4] },
    { t: 4.8, p: [0.1, -1.9, 2.9], aim: [0, 0.9, -0.3] },
  ];
  const CUT = 1.55;
  let cutDone = false;
  let squeezed = false;
  return scene(ctx, [hand.root], 4.8, CUT, (t) => {
    // Il le tient à contre-jour de l'ampoule : la lampe vient tout près, pour que tu le voies battre.
    lamp(ctx, t, 4.8, t < 2.5 ? 1 : 2.4, [0.25, 0.25, 0.7]);
    const inside = t > CUT && t < 2.5;
    // Hors du champ pendant qu'il fouille : on change de geste sans que ça se voie.
    if (t < 2.5) pose(hand.root, head, track(keys, t), inside ? 0.05 : 0.004);
    else present(hand.root, ctx, track(reveal, t), 0.004);
    // Doigts tendus en griffe pour entrer, refermés pour ressortir, serrés à la fin.
    const curl = t < 1.4 ? -0.1 : t < 2.4 ? 0.3 + Math.sin(t * 20) * 0.2 : t < 3.9 ? 0.35 : 0.35 + phase(t, 3.9, 4.15) * 0.6;
    hand.curl.fill(curl);
    hand.pose();
    if (t >= CUT && !cutDone) {
      cutDone = true;
      cutFx(ctx, 1.4, 0.5, 0.97);
      spurt(ctx.blood, head(0, -0.6, 1.1), headDir(head, 0, 0.55, 1), 200, 3.4, 1.3, 0.18);
    }
    if (inside) {
      // Il fouille : la vue cogne à chaque prise.
      if (Math.sin(t * 9) > 0.92) ctx.fx.jolt(0.6);
      if (Math.random() < 0.5) spurt(ctx.blood, head(0, -0.62, 1.1), headDir(head, (Math.random() - 0.5) * 0.6, 0.5, 1), 4, 2.4, 0.7, 0.16);
    }
    if (t > 2.6) {
      heart.visible = true;
      // Il bat encore, de plus en plus lentement ; puis la main se referme et l'écrase.
      const rate = 2.4 - (t - 2.6) * 0.5;
      const beat = ((t - 2.6) * rate) % 1;
      const pump = beat < 0.15 ? beat / 0.15 : Math.max(0, 1 - (beat - 0.15) / 0.25);
      const crush = phase(t, 3.9, 4.15);
      heart.scale.setScalar(1.6 * (1 + pump * 0.14) * (1 - crush * 0.35));
      if (pump > 0.9 && Math.random() < 0.5) spurt(ctx.blood, heart.getWorldPosition(new THREE.Vector3()), headDir(head, 0, 0.6, 0.3), 6, 1.5, 0.5, 0.16);
      if (Math.random() < 0.6) spurt(ctx.blood, heart.getWorldPosition(new THREE.Vector3()), new THREE.Vector3(0, -1, 0), 1, 0.8, 0.3, 0.16);
      if (t >= 4.0 && !squeezed) {
        squeezed = true;
        cutFx(ctx, 0.8, 0.5, 0.7);
        spurt(ctx.blood, heart.getWorldPosition(new THREE.Vector3()), headDir(head, 0, 0.3, 1), 90, 2.6, 1.2, 0.16);
      }
    }
  });
}
