import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { CUP_BOTTOM, CUP_HEIGHT, CUP_INNER_RADIUS, CUP_REST, CUP_WALL } from './config';
import { KinematicTween } from './tween';

const WALL_SEGMENTS = 16;
const OUTER = CUP_INNER_RADIUS + CUP_WALL;

// Emplacements des dés dans le gobelet (repère local) : 3 au fond, 2 au-dessus.
const SLOTS = [
  new THREE.Vector3(0.75, CUP_BOTTOM + 0.55, 0),
  new THREE.Vector3(-0.375, CUP_BOTTOM + 0.55, 0.65),
  new THREE.Vector3(-0.375, CUP_BOTTOM + 0.55, -0.65),
  new THREE.Vector3(0, CUP_BOTTOM + 1.75, 0.55),
  new THREE.Vector3(0, CUP_BOTTOM + 1.75, -0.55),
];

/** Gobelet : corps cinématique creux, avec un couvercle invisible quand il est tenu. */
export class Cup {
  readonly mesh: THREE.Group;
  readonly body: RAPIER.RigidBody;
  readonly colliders: RAPIER.Collider[] = [];
  private readonly lid: RAPIER.Collider;
  private readonly materials: THREE.MeshStandardMaterial[] = [];
  tween: KinematicTween | null = null;

  constructor(world: RAPIER.World, scene: THREE.Scene) {
    this.mesh = this.buildMesh();
    scene.add(this.mesh);

    this.body = world.createRigidBody(
      RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(CUP_REST.x, CUP_REST.y, CUP_REST.z),
    );
    const add = (desc: RAPIER.ColliderDesc) => {
      const c = world.createCollider(desc.setFriction(0.5).setRestitution(0.2), this.body);
      this.colliders.push(c);
      return c;
    };

    add(RAPIER.ColliderDesc.cylinder(CUP_BOTTOM / 2, OUTER).setTranslation(0, CUP_BOTTOM / 2, 0));
    const r = CUP_INNER_RADIUS + CUP_WALL / 2;
    const halfLen = r * Math.tan(Math.PI / WALL_SEGMENTS) + 0.06;
    for (let i = 0; i < WALL_SEGMENTS; i++) {
      const a = (i / WALL_SEGMENTS) * Math.PI * 2;
      // Rotation autour de Y de -a : l'axe X local du mur pointe vers l'extérieur.
      const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), -a);
      add(
        RAPIER.ColliderDesc.cuboid(CUP_WALL / 2, CUP_HEIGHT / 2, halfLen)
          .setTranslation(r * Math.cos(a), CUP_HEIGHT / 2, r * Math.sin(a))
          .setRotation(q),
      );
    }
    this.lid = add(
      RAPIER.ColliderDesc.cylinder(0.12, OUTER).setTranslation(0, CUP_HEIGHT + 0.12, 0),
    );
    this.setLid(false);
  }

  private buildMesh(): THREE.Group {
    const group = new THREE.Group();
    // Profil tourné : paroi extérieure légèrement évasée, intérieur, fond.
    const profile = [
      new THREE.Vector2(0, 0),
      new THREE.Vector2(OUTER - 0.05, 0),
      new THREE.Vector2(OUTER + 0.05, CUP_HEIGHT),
      new THREE.Vector2(CUP_INNER_RADIUS + 0.02, CUP_HEIGHT),
      new THREE.Vector2(CUP_INNER_RADIUS, CUP_BOTTOM),
      new THREE.Vector2(0, CUP_BOTTOM),
    ];
    const leather = new THREE.MeshStandardMaterial({
      color: 0x3a1610,
      roughness: 0.85,
      side: THREE.DoubleSide,
      flatShading: true,
    });
    const body = new THREE.Mesh(new THREE.LatheGeometry(profile, 14), leather);
    body.castShadow = true;
    body.receiveShadow = true;
    group.add(body);

    const brass = new THREE.MeshStandardMaterial({ color: 0x8a6a2a, roughness: 0.4, metalness: 0.8 });
    const rim = new THREE.Mesh(new THREE.TorusGeometry(OUTER + 0.05, 0.07, 4, 14), brass);
    rim.rotation.x = Math.PI / 2;
    rim.position.y = CUP_HEIGHT - 0.05;
    group.add(rim);

    this.materials.push(leather, brass);
    return group;
  }

  get position(): THREE.Vector3 {
    const t = this.body.translation();
    return new THREE.Vector3(t.x, t.y, t.z);
  }

  get quaternion(): THREE.Quaternion {
    const r = this.body.rotation();
    return new THREE.Quaternion(r.x, r.y, r.z, r.w);
  }

  restPose() {
    return {
      position: new THREE.Vector3(CUP_REST.x, CUP_REST.y, CUP_REST.z),
      quaternion: new THREE.Quaternion(),
    };
  }

  /** Remet le gobelet au repos, sur le rebord, sans animation. */
  teleportRest() {
    const rest = this.restPose();
    this.tween = null;
    this.body.setTranslation(rest.position, true);
    this.body.setRotation(rest.quaternion, true);
    this.setSolid(true);
    this.setLid(false);
  }

  /** Position monde de l'emplacement n° `i` à l'intérieur du gobelet. */
  slotWorld(i: number): THREE.Vector3 {
    return SLOTS[i % SLOTS.length].clone().applyQuaternion(this.quaternion).add(this.position);
  }

  setLid(on: boolean) {
    this.lid.setEnabled(on);
  }

  setSolid(on: boolean) {
    for (const c of this.colliders) if (c !== this.lid) c.setEnabled(on);
    if (!on) this.lid.setEnabled(false);
  }

  drive(pos: THREE.Vector3, rot: THREE.Quaternion) {
    this.body.setNextKinematicTranslation(pos);
    this.body.setNextKinematicRotation(rot);
  }

  moveTo(pos: THREE.Vector3, rot: THREE.Quaternion, duration: number, onDone?: () => void, ease?: (t: number) => number) {
    this.tween = new KinematicTween(this.position, this.quaternion, pos, rot, duration, onDone, ease);
  }

  step(dt: number) {
    if (!this.tween) return;
    const tween = this.tween;
    const pose = tween.advance(dt);
    this.drive(pose.position, pose.quaternion);
    if (tween.done) {
      this.tween = null;
      tween.onDone?.();
    }
  }

  setHighlight(on: boolean) {
    this.materials[0].emissive.setHex(on ? 0x2a0c04 : 0x000000);
  }

  syncMesh() {
    const t = this.body.translation();
    const r = this.body.rotation();
    this.mesh.position.set(t.x, t.y, t.z);
    this.mesh.quaternion.set(r.x, r.y, r.z, r.w);
  }
}
