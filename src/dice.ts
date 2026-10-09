import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { FLAT_ALIGNMENT } from './config';
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

const PIPS: Record<number, [number, number][]> = {
  1: [[0.5, 0.5]],
  2: [[0.27, 0.27], [0.73, 0.73]],
  3: [[0.27, 0.27], [0.5, 0.5], [0.73, 0.73]],
  4: [[0.27, 0.27], [0.73, 0.27], [0.27, 0.73], [0.73, 0.73]],
  5: [[0.27, 0.27], [0.73, 0.27], [0.5, 0.5], [0.27, 0.73], [0.73, 0.73]],
  6: [[0.27, 0.25], [0.73, 0.25], [0.27, 0.5], [0.73, 0.5], [0.27, 0.75], [0.73, 0.75]],
};

function pipTexture(value: number): THREE.Texture {
  const size = 64;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const g = canvas.getContext('2d')!;
  g.fillStyle = '#d6ccae';
  g.fillRect(0, 0, size, size);
  // Salissures : os jauni, pas un dé de casino propre.
  for (let i = 0; i < 90; i++) {
    g.fillStyle = `rgba(70, 50, 30, ${Math.random() * 0.12})`;
    g.fillRect(Math.random() * size, Math.random() * size, 2, 2);
  }
  g.fillStyle = value === 1 ? '#6e0d12' : '#22150f';
  for (const [x, y] of PIPS[value]) {
    g.beginPath();
    g.arc(x * size, y * size, value === 1 ? 8 : 5.5, 0, Math.PI * 2);
    g.fill();
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

let textures: THREE.Texture[] | null = null;
const geometry = new RoundedBoxGeometry(1, 1, 1, 2, 0.12);

export function readTopFace(q: THREE.Quaternion): { value: number; alignment: number } {
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
  return { value: FACE_VALUES[best], alignment };
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

  constructor(world: RAPIER.World, scene: THREE.Scene) {
    textures ??= FACE_VALUES.map(pipTexture);
    this.materials = textures.map(
      (map) => new THREE.MeshStandardMaterial({ map, roughness: 0.55, metalness: 0 }),
    );
    this.mesh = new THREE.Mesh(geometry, this.materials);
    this.mesh.castShadow = true;
    this.mesh.receiveShadow = true;
    scene.add(this.mesh);

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

  get quaternion(): THREE.Quaternion {
    const r = this.body.rotation();
    return new THREE.Quaternion(r.x, r.y, r.z, r.w);
  }

  get position(): THREE.Vector3 {
    const t = this.body.translation();
    return new THREE.Vector3(t.x, t.y, t.z);
  }

  top(): { value: number; alignment: number } {
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
    if (this.glow <= 0) return;
    this.glow = Math.max(0, this.glow - dt * 3.5);
    this.applyGlow();
  }

  private applyGlow() {
    const intensity = Math.max(this.highlighted ? 0.22 : 0, this.glow * 0.8);
    for (const m of this.materials) {
      m.emissive.setHex(0xff9a30);
      m.emissiveIntensity = intensity;
    }
  }

  syncMesh() {
    const t = this.body.translation();
    const r = this.body.rotation();
    this.mesh.position.set(t.x, t.y, t.z);
    this.mesh.quaternion.set(r.x, r.y, r.z, r.w);
  }
}
