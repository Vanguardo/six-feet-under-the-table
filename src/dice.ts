import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { FLAT_ALIGNMENT } from './config';
import { DIE_TYPES, FACE_MODS, PIPE_FAVORITE_FACE, type DieType, type FaceModId } from './rules/dice';
import { KinematicTween } from './tween';

// Ordre des groupes de BoxGeometry : +X, -X, +Y, -Y, +Z, -Z. Les faces opposées font 7.
const FACE_VALUES = [2, 5, 1, 6, 3, 4];
const FACE_NORMALS = [
  new THREE.Vector3(1, 0, 0),
  new THREE.Vector3(-1, 0, 0),
  new THREE.Vector3(0, 1, 0),
  new THREE.Vector3(0, -1, 0),
  new THREE.Vector3(0, 0, 1),
  new THREE.Vector3(0, 0, -1),
];
const UP = new THREE.Vector3(0, 1, 0);
const HOVER_SCALE = 1.14;
const HOVER_LIFT = 0.12;
const OUTLINE_SCALE = 1.09;
// Petit dépassement à l'arrivée : le dé « répond » à la souris.
const easeOutBack = (t: number) => 1 + 2.2 * (t - 1) ** 3 + 1.2 * (t - 1) ** 2;

const PIPS: Record<number, [number, number][]> = {
  1: [[0.5, 0.5]],
  2: [[0.27, 0.27], [0.73, 0.73]],
  3: [[0.27, 0.27], [0.5, 0.5], [0.73, 0.73]],
  4: [[0.27, 0.27], [0.73, 0.27], [0.27, 0.73], [0.73, 0.73]],
  5: [[0.27, 0.27], [0.73, 0.27], [0.5, 0.5], [0.27, 0.73], [0.73, 0.73]],
  6: [[0.27, 0.25], [0.73, 0.25], [0.27, 0.5], [0.73, 0.5], [0.27, 0.75], [0.73, 0.75]],
};

const faceCache = new Map<string, THREE.Texture>();

/** Texture d'une face : matière du dé, valeur (points ou chiffre), gravure éventuelle. */
function faceTexture(type: DieType, value: number, mod: FaceModId | null, hidden: boolean): THREE.Texture {
  const key = `${type.id}:${value}:${mod}:${hidden}`;
  const cached = faceCache.get(key);
  if (cached) return cached;
  const size = 64;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const g = canvas.getContext('2d')!;
  g.fillStyle = type.look.bone;
  g.fillRect(0, 0, size, size);
  // Salissures : os jauni, pas un dé de casino propre.
  for (let i = 0; i < 90; i++) {
    g.fillStyle = `rgba(70, 50, 30, ${Math.random() * 0.14})`;
    g.fillRect(Math.random() * size, Math.random() * size, 2, 2);
  }
  if (!hidden) {
    if (mod === 'vide') {
      // Face évidée : un trou noir, rien à lire.
      g.fillStyle = '#0a0606';
      g.fillRect(10, 10, size - 20, size - 20);
    } else if (mod === 'crane') {
      g.fillStyle = '#e8e2d2';
      g.beginPath();
      g.arc(32, 28, 15, 0, Math.PI * 2);
      g.fill();
      g.fillRect(24, 36, 16, 12);
      g.fillStyle = '#120a08';
      for (const x of [26, 38]) {
        g.beginPath();
        g.arc(x, 28, 4.5, 0, Math.PI * 2);
        g.fill();
      }
      for (const x of [27, 31, 35]) g.fillRect(x, 42, 2, 6);
    } else if (type.look.numerals || value > 6 || value === 0) {
      g.font = `bold ${value >= 10 ? 34 : 44}px "Courier New", monospace`;
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillStyle = mod === 'doree' ? '#e8b830' : type.look.ink;
      g.fillText(String(value), 32, 35);
      if (value === 6 || value === 9) g.fillRect(22, 54, 20, 3); // distingue 6 et 9
    } else {
      g.fillStyle = mod === 'doree' ? '#e8b830' : value === 1 && type.id === 'os' ? '#6e0d12' : type.look.ink;
      for (const [x, y] of PIPS[value]) {
        g.beginPath();
        g.arc(x * size, y * size, value === 1 ? 8 : 5.5, 0, Math.PI * 2);
        g.fill();
      }
    }
    if (mod) drawMod(g, mod, size);
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  tex.colorSpace = THREE.SRGBColorSpace;
  faceCache.set(key, tex);
  return tex;
}

/** Marque de la gravure : cadre de couleur et petit signe dans un coin. */
function drawMod(g: CanvasRenderingContext2D, mod: FaceModId, size: number) {
  g.strokeStyle = FACE_MODS[mod].color;
  g.lineWidth = 4;
  g.strokeRect(3, 3, size - 6, size - 6);
  g.fillStyle = FACE_MODS[mod].color;
  switch (mod) {
    case 'sanglante':
      // Coulures de sang depuis le haut.
      for (const [x, h] of [[12, 14], [22, 22], [44, 10], [52, 18]]) g.fillRect(x, 4, 4, h);
      break;
    case 'clou':
      g.beginPath();
      g.arc(54, 10, 5, 0, Math.PI * 2);
      g.fill();
      break;
    case 'flamme':
      g.beginPath();
      g.moveTo(48, 16);
      g.lineTo(54, 4);
      g.lineTo(60, 16);
      g.fill();
      break;
  }
}

const geometry = new RoundedBoxGeometry(1, 1, 1, 2, 0.12);

/** Un dé d'exposition (boutique) : même matière et mêmes faces, sans physique. */
export function displayDie(type: DieType): THREE.Mesh {
  const materials = FACE_VALUES.map(
    (v) => new THREE.MeshStandardMaterial({ map: faceTexture(type, type.faces[v - 1], null, false), color: 0xb9b0a0, roughness: 0.7 }),
  );
  if (type.id === 'verre') for (const m of materials) Object.assign(m, { transparent: true, opacity: 0.72 });
  const mesh = new THREE.Mesh(geometry, materials);
  mesh.castShadow = true;
  return mesh;
}

/** Face tournée vers le haut. `value` = points d'un dé en os (1 à 6), `face` = index logique (0 à 5). */
export function readTopFace(q: THREE.Quaternion): { value: number; face: number; alignment: number } {
  let best = 0;
  let alignment = -Infinity;
  const n = new THREE.Vector3();
  FACE_NORMALS.forEach((normal, i) => {
    const dot = n.copy(normal).applyQuaternion(q).dot(UP);
    if (dot > alignment) {
      alignment = dot;
      best = i;
    }
  });
  return { value: FACE_VALUES[best], face: FACE_VALUES[best] - 1, alignment };
}

/** Orientation qui pose `value` vers le haut, tournée de `yawSteps` quarts de tour. */
export function orientationFor(value: number, yawSteps = 0): THREE.Quaternion {
  const normal = FACE_NORMALS[FACE_VALUES.indexOf(value)];
  const q = new THREE.Quaternion().setFromUnitVectors(normal, UP);
  const yaw = new THREE.Quaternion().setFromAxisAngle(UP, (yawSteps * Math.PI) / 2);
  return yaw.multiply(q);
}

export function randomOrientation(): THREE.Quaternion {
  return orientationFor(1 + Math.floor(Math.random() * 6), Math.floor(Math.random() * 4));
}

export class Die {
  readonly mesh: THREE.Mesh;
  readonly body: RAPIER.RigidBody;
  readonly collider: RAPIER.Collider;
  kept = false;
  slot = -1;
  tween: KinematicTween | null = null;
  /** Temps passé immobile, pour détecter la fin du lancer. */
  stillTime = 0;
  private readonly materials: THREE.MeshStandardMaterial[];
  private highlighted = false;
  private glow = 0;
  /** 0 → 1 quand la souris survole le dé : grossit, se soulève, contour jaune. */
  private hover = 0;
  private readonly outline: THREE.Mesh;
  private readonly outlineMaterial: THREE.MeshBasicMaterial;

  constructor(world: RAPIER.World, scene: THREE.Scene) {
    this.materials = FACE_VALUES.map(
      (v) => new THREE.MeshStandardMaterial({ map: faceTexture(DIE_TYPES.os, v, null, false), color: 0xb9b0a0, roughness: 0.7, metalness: 0 }),
    );
    this.mesh = new THREE.Mesh(geometry, this.materials);
    this.mesh.castShadow = true;
    this.mesh.receiveShadow = true;
    scene.add(this.mesh);

    // Contour : une coque un peu plus grande, retournée, dont seul le bord dépasse du dé.
    this.outlineMaterial = new THREE.MeshBasicMaterial({
      color: 0xffcc33,
      side: THREE.BackSide,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      fog: false,
    });
    this.outline = new THREE.Mesh(geometry, this.outlineMaterial);
    this.outline.scale.setScalar(OUTLINE_SCALE);
    this.outline.visible = false;
    // Le contour n'intercepte pas la souris : seul le dé lui-même est survolable.
    this.outline.raycast = () => {};
    this.mesh.add(this.outline);

    this.body = world.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic()
        .setCcdEnabled(true)
        .setLinearDamping(0.05)
        .setAngularDamping(0.25),
    );
    this.collider = world.createCollider(
      RAPIER.ColliderDesc.roundCuboid(0.4, 0.4, 0.4, 0.1)
        .setDensity(1)
        .setFriction(0.45)
        .setRestitution(0.3)
        .setActiveEvents(RAPIER.ActiveEvents.CONTACT_FORCE_EVENTS)
        .setContactForceEventThreshold(120),
      this.body,
    );
  }

  /** Dé en jeu cette échéance (sinon rangé hors de la table : main perdue, Boucher…). */
  active = true;
  private lookKey = '';

  /** Habille le dé : matière, valeurs et gravures de ses faces, faces cachées ou non. */
  setLook(type: DieType, mods: (FaceModId | null)[], hidden: boolean) {
    const key = `${type.id}:${mods.join(',')}:${hidden}`;
    if (key === this.lookKey) return;
    this.lookKey = key;
    FACE_VALUES.forEach((v, g) => {
      const face = v - 1;
      const mod = mods[face];
      const value = mod === 'vide' ? 0 : type.faces[face];
      const m = this.materials[g];
      m.map = faceTexture(type, value, mod, hidden);
      // Le verre laisse deviner ce qu'il y a derrière.
      m.transparent = type.id === 'verre';
      m.opacity = type.id === 'verre' ? 0.72 : 1;
      m.metalness = type.id === 'plomb' ? 0.6 : 0;
      m.color.setHex(type.id === 'verre' ? 0xd0f0f0 : 0xb9b0a0);
      m.needsUpdate = true;
    });
    this.setPhysics(type);
  }

  private setPhysics(type: DieType) {
    const lead = type.id === 'plomb';
    this.collider.setDensity(lead ? 3 : 1);
    this.collider.setRestitution(lead ? 0.08 : 0.3);
    // Dé pipé : du plomb coulé côté opposé à la face favorite, qui sort donc plus souvent.
    const favorite = FACE_NORMALS[FACE_VALUES.indexOf(PIPE_FAVORITE_FACE + 1)];
    const com = type.id === 'pipe' ? favorite.clone().multiplyScalar(-0.3) : new THREE.Vector3();
    const extra = type.id === 'pipe' ? 0.8 : 0;
    this.body.setAdditionalMassProperties(extra, com, { x: 0.04, y: 0.04, z: 0.04 }, { x: 0, y: 0, z: 0, w: 1 }, true);
  }

  /** Range le dé hors de la table (inactif) ou le remet en jeu. */
  setActive(on: boolean) {
    this.active = on;
    this.body.setEnabled(on);
    this.mesh.visible = on;
    if (!on) {
      this.kept = false;
      this.slot = -1;
      this.tween = null;
    }
  }

  get quaternion(): THREE.Quaternion {
    const r = this.body.rotation();
    return new THREE.Quaternion(r.x, r.y, r.z, r.w);
  }

  get position(): THREE.Vector3 {
    const t = this.body.translation();
    return new THREE.Vector3(t.x, t.y, t.z);
  }

  top(): { value: number; face: number; alignment: number } {
    return readTopFace(this.quaternion);
  }

  isFlat(): boolean {
    return this.top().alignment >= FLAT_ALIGNMENT;
  }

  /** Téléporte le dé et le rend à la physique, immobile. */
  placeDynamic(pos: THREE.Vector3, rot: THREE.Quaternion) {
    this.tween = null;
    this.body.setBodyType(RAPIER.RigidBodyType.Dynamic, true);
    this.body.setTranslation(pos, true);
    this.body.setRotation(rot, true);
    this.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    this.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
    this.stillTime = 0;
  }

  /** Passe le dé en cinématique et l'anime jusqu'à une pose. */
  moveTo(pos: THREE.Vector3, rot: THREE.Quaternion, duration: number, onDone?: () => void) {
    this.body.setBodyType(RAPIER.RigidBodyType.KinematicPositionBased, true);
    this.tween = new KinematicTween(this.position, this.quaternion, pos, rot, duration, onDone);
  }

  step(dt: number) {
    if (!this.tween) return;
    const tween = this.tween;
    const pose = tween.advance(dt);
    this.body.setNextKinematicTranslation(pose.position);
    this.body.setNextKinematicRotation(pose.quaternion);
    if (tween.done) {
      this.tween = null;
      tween.onDone?.();
    }
  }

  isResting(): boolean {
    const v = this.body.linvel();
    const w = this.body.angvel();
    return Math.hypot(v.x, v.y, v.z) < 0.08 && Math.hypot(w.x, w.y, w.z) < 0.12;
  }

  setHighlight(on: boolean) {
    this.highlighted = on;
    this.applyGlow();
  }

  /** Flash bref quand le chiffre du dé est révélé. */
  flash() {
    this.glow = 1;
    this.applyGlow();
  }

  tickGlow(dt: number) {
    // Survol : approche douce vers la cible, un peu plus rapide à l'entrée qu'à la sortie.
    const target = this.highlighted ? 1 : 0;
    if (this.hover !== target) {
      const speed = target > this.hover ? 14 : 9;
      this.hover += (target - this.hover) * (1 - Math.exp(-dt * speed));
      if (Math.abs(target - this.hover) < 0.002) this.hover = target;
      this.outlineMaterial.opacity = this.hover;
      this.outline.visible = this.hover > 0.01;
    }
    if (this.glow <= 0) return;
    this.glow = Math.max(0, this.glow - dt * 3.5);
    this.applyGlow();
  }

  private applyGlow() {
    const intensity = Math.max(this.highlighted ? 0.12 : 0, this.glow * 0.8);
    for (const m of this.materials) {
      m.emissive.setHex(0xff9a30);
      m.emissiveIntensity = intensity;
    }
  }

  syncMesh() {
    const t = this.body.translation();
    const r = this.body.rotation();
    // Le survol ne touche que l'affichage : le corps physique reste où il est.
    const k = easeOutBack(this.hover);
    this.mesh.position.set(t.x, t.y + k * HOVER_LIFT, t.z);
    this.mesh.quaternion.set(r.x, r.y, r.z, r.w);
    this.mesh.scale.setScalar(1 + k * (HOVER_SCALE - 1));
  }
}
