import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import { ps1ify } from './render/ps1';
import { grimeTexture } from './render/textures';
import type { Sfx } from './sfx';

/**
 * La paie : le créancier jette une poignée de pièces sur le feutre. Elles rebondissent,
 * roulent, tintent, puis glissent une à une jusqu'à ta pile, à côté de l'imprimante.
 */

const RADIUS = 0.42;
const HALF_H = 0.06;
/** Au-delà, une pièce jetée en vaut plusieurs : la table ne doit pas se noyer sous l'or. */
const MAX_THROWN = 18;
const SETTLE_TIME = 1.7;
const FLY_TIME = 0.45;
const FLY_GAP = 0.07;

interface Coin {
  mesh: THREE.Mesh;
  body: RAPIER.RigidBody | null;
  prevVy: number;
  age: number;
  value: number;
  fly: { from: THREE.Vector3; t: number; delay: number } | null;
}

export class CoinShower {
  private readonly coins: Coin[] = [];
  private readonly geo = new THREE.CylinderGeometry(RADIUS, RADIUS, HALF_H * 2, 12);
  private readonly mat = new THREE.MeshStandardMaterial({ color: 0xd8ac40, metalness: 0.85, roughness: 0.3, map: grimeTexture() });

  constructor(
    private readonly world: RAPIER.World,
    private readonly scene: THREE.Scene,
    private readonly sfx: Sfx,
  ) {}

  get busy() {
    return this.coins.length > 0;
  }

  /**
   * Jette `total` pièces depuis `from`. `target(i)` donne où atterrit la i-ème pièce sur la pile ;
   * `onArrive(value)` est appelé à chaque pièce rangée, avec ce qu'elle vaut.
   */
  throw(from: THREE.Vector3, total: number, target: () => THREE.Vector3, onArrive: (value: number) => void) {
    if (total <= 0) return;
    const n = Math.min(total, MAX_THROWN);
    const base = Math.floor(total / n);
    const extra = total - base * n;
    this.target = target;
    this.onArrive = onArrive;
    for (let i = 0; i < n; i++) {
      const mesh = new THREE.Mesh(this.geo, this.mat);
      mesh.castShadow = true;
      ps1ify(mesh);
      this.scene.add(mesh);
      const body = this.world.createRigidBody(
        RAPIER.RigidBodyDesc.dynamic()
          .setTranslation(from.x + (Math.random() - 0.5) * 0.8, from.y + Math.random() * 0.4, from.z + (Math.random() - 0.5) * 0.5)
          .setRotation(new THREE.Quaternion().setFromEuler(new THREE.Euler(Math.random() * 3, Math.random() * 3, Math.random() * 3)))
          .setLinvel((Math.random() - 0.5) * 8, 2.5 + Math.random() * 3, 8.5 + Math.random() * 4)
          .setAngvel({ x: (Math.random() - 0.5) * 20, y: (Math.random() - 0.5) * 10, z: (Math.random() - 0.5) * 20 })
          .setCcdEnabled(true)
          .setLinearDamping(0.1)
          .setAngularDamping(0.4),
      );
      this.world.createCollider(RAPIER.ColliderDesc.cylinder(HALF_H, RADIUS).setDensity(4).setRestitution(0.4).setFriction(0.5), body);
      this.coins.push({ mesh, body, prevVy: 0, age: 0, value: base + (i < extra ? 1 : 0), fly: null });
    }
    // La poignée qui s'ouvre : un froissement de métal.
    for (let k = 0; k < 6; k++) this.sfx.tone(2200 + Math.random() * 1600, 0.05, 0.08, 'triangle');
  }

  private target: () => THREE.Vector3 = () => new THREE.Vector3();
  private onArrive: (value: number) => void = () => {};

  update(dt: number) {
    let flyIndex = 0;
    for (const c of [...this.coins]) {
      c.age += dt;
      if (c.body) {
        const t = c.body.translation();
        const r = c.body.rotation();
        c.mesh.position.set(t.x, t.y, t.z);
        c.mesh.quaternion.set(r.x, r.y, r.z, r.w);
        // Un choc : la vitesse verticale s'inverse d'un coup. La pièce tinte.
        const vy = c.body.linvel().y;
        if (c.prevVy < -1.5 && vy > c.prevVy + 1.5) {
          const v = Math.min(1, -c.prevVy / 9);
          this.sfx.tone(2400 + Math.random() * 1400, 0.06 + v * 0.08, 0.05 + v * 0.18, 'triangle');
          this.sfx.tone(5200 + Math.random() * 900, 0.03, 0.04 + v * 0.06, 'sine');
        }
        c.prevVy = vy;
        // Tombée hors de la table : on la rattrape quand même.
        if (c.age > SETTLE_TIME || t.y < -3) {
          this.world.removeRigidBody(c.body);
          c.body = null;
          c.fly = { from: c.mesh.position.clone(), t: 0, delay: flyIndex++ * FLY_GAP };
        }
        continue;
      }
      const f = c.fly!;
      if (f.delay > 0) {
        f.delay -= dt;
        continue;
      }
      f.t = Math.min(1, f.t + dt / FLY_TIME);
      const to = this.target();
      const k = f.t * f.t * (3 - 2 * f.t);
      c.mesh.position.lerpVectors(f.from, to, k);
      c.mesh.position.y += Math.sin(k * Math.PI) * 2.2;
      c.mesh.quaternion.slerp(new THREE.Quaternion(), 0.2);
      if (f.t >= 1) {
        this.scene.remove(c.mesh);
        this.coins.splice(this.coins.indexOf(c), 1);
        this.sfx.tone(1900 + Math.random() * 300, 0.05, 0.12, 'square');
        this.onArrive(c.value);
      }
    }
  }

  /** Nouvelle run : tout disparaît, sans rien créditer. */
  clear() {
    for (const c of this.coins) {
      if (c.body) this.world.removeRigidBody(c.body);
      this.scene.remove(c.mesh);
    }
    this.coins.length = 0;
  }
}
