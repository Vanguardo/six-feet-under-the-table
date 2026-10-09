import * as THREE from 'three';
import type { OwnedRelic } from './rules/relics';

// Les reliques sont posées sur le rebord, entre le tapis de garde et le gobelet.
const SLOT_X0 = -1.9;
const SLOT_DX = 1.3;
const SLOT_Z = 9.0;

const mat = (color: number, extra: Partial<THREE.MeshStandardMaterialParameters> = {}) =>
  new THREE.MeshStandardMaterial({ color, roughness: 0.7, flatShading: true, ...extra });

/** Objets low-poly provisoires : chaque relique a une silhouette reconnaissable. */
function buildMesh(id: string): THREE.Object3D {
  const g = new THREE.Group();
  const add = (geo: THREE.BufferGeometry, m: THREE.Material, pos: [number, number, number], rot?: [number, number, number]) => {
    const mesh = new THREE.Mesh(geo, m);
    mesh.position.set(...pos);
    if (rot) mesh.rotation.set(...rot);
    mesh.castShadow = true;
    g.add(mesh);
    return mesh;
  };
  const gold = mat(0xc9a03a, { metalness: 0.8, roughness: 0.35 });
  const bone = mat(0xd6ccae);
  const paper = mat(0xcfc2a0);
  const red = mat(0x7a0d12);
  switch (id) {
    case 'dentEnOr':
      add(new THREE.ConeGeometry(0.22, 0.6, 5), gold, [0, 0.3, 0], [Math.PI, 0, 0]);
      add(new THREE.BoxGeometry(0.42, 0.22, 0.32), gold, [0, 0.62, 0]);
      break;
    case 'mainCoupee':
      add(new THREE.BoxGeometry(0.5, 0.16, 0.55), mat(0x9a7a68), [0, 0.08, 0]);
      for (let i = 0; i < 4; i++) add(new THREE.BoxGeometry(0.1, 0.1, 0.38), mat(0x9a7a68), [-0.18 + i * 0.12, 0.07, -0.42]);
      add(new THREE.BoxGeometry(0.5, 0.17, 0.12), red, [0, 0.08, 0.3]);
      break;
    case 'chapelet':
      for (let i = 0; i < 9; i++) {
        const a = (i / 9) * Math.PI * 2;
        add(new THREE.SphereGeometry(0.07, 5, 4), mat(0x4a2a1a), [Math.cos(a) * 0.32, 0.07, Math.sin(a) * 0.32]);
      }
      add(new THREE.BoxGeometry(0.06, 0.04, 0.3), gold, [0, 0.05, 0.5]);
      add(new THREE.BoxGeometry(0.2, 0.04, 0.06), gold, [0, 0.05, 0.44]);
      break;
    case 'megot':
      add(new THREE.CylinderGeometry(0.06, 0.06, 0.55, 6), paper, [0, 0.06, 0], [0, 0, Math.PI / 2]);
      add(new THREE.CylinderGeometry(0.065, 0.065, 0.18, 6), mat(0xb87a3a), [0.32, 0.06, 0], [0, 0, Math.PI / 2]);
      add(new THREE.CylinderGeometry(0.062, 0.062, 0.04, 6), mat(0xff5010, { emissive: 0xff3000, emissiveIntensity: 0.8 }), [-0.29, 0.06, 0], [0, 0, Math.PI / 2]);
      break;
    case 'ticketFroisse':
      add(new THREE.BoxGeometry(0.42, 0.03, 0.7), paper, [0, 0.03, 0], [0.08, 0.3, 0.06]);
      add(new THREE.BoxGeometry(0.3, 0.031, 0.04), mat(0x22150f), [0, 0.05, -0.15], [0.08, 0.3, 0.06]);
      break;
    case 'ampouleNue':
      add(new THREE.SphereGeometry(0.27, 7, 6), mat(0xfff0c8, { emissive: 0xffc070, emissiveIntensity: 0.6 }), [0, 0.32, 0]);
      add(new THREE.CylinderGeometry(0.12, 0.12, 0.2, 6), mat(0x888070, { metalness: 0.7 }), [0, 0.6, 0]);
      break;
    case 'allumette':
      add(new THREE.BoxGeometry(0.06, 0.06, 0.6), mat(0xc8a070), [0, 0.04, 0], [0, 0.4, 0]);
      add(new THREE.SphereGeometry(0.06, 5, 4), red, [0.12, 0.05, -0.27]);
      break;
    case 'cleRouillee':
      add(new THREE.TorusGeometry(0.15, 0.05, 4, 8), mat(0x7a4a2a), [0, 0.06, 0.25], [Math.PI / 2, 0, 0]);
      add(new THREE.BoxGeometry(0.07, 0.07, 0.5), mat(0x7a4a2a), [0, 0.05, -0.12]);
      add(new THREE.BoxGeometry(0.16, 0.07, 0.07), mat(0x7a4a2a), [0.08, 0.05, -0.32]);
      break;
    case 'craie':
      add(new THREE.BoxGeometry(0.14, 0.14, 0.55), mat(0xeeeadf, { roughness: 1 }), [0, 0.07, 0], [0, 0.6, 0]);
      break;
    case 'pieceTrouee':
      add(new THREE.TorusGeometry(0.22, 0.11, 4, 10), mat(0x8a7040, { metalness: 0.7, roughness: 0.4 }), [0, 0.06, 0], [Math.PI / 2, 0, 0]);
      break;
    case 'montreArretee':
      add(new THREE.CylinderGeometry(0.3, 0.3, 0.1, 10), gold, [0, 0.05, 0]);
      add(new THREE.CylinderGeometry(0.25, 0.25, 0.11, 10), bone, [0, 0.06, 0]);
      add(new THREE.BoxGeometry(0.03, 0.02, 0.18), mat(0x111111), [0, 0.12, -0.07]);
      add(new THREE.TorusGeometry(0.07, 0.025, 4, 6), gold, [0, 0.05, -0.36], [Math.PI / 2, 0, 0]);
      break;
    case 'photoDeFamille':
      add(new THREE.BoxGeometry(0.5, 0.62, 0.05), mat(0x3a2a1a), [0, 0.32, 0], [-0.25, 0, 0]);
      add(new THREE.BoxGeometry(0.4, 0.5, 0.01), mat(0x8a7a60), [0, 0.32, 0.035], [-0.25, 0, 0]);
      break;
    case 'sablier':
      add(new THREE.ConeGeometry(0.2, 0.3, 6), mat(0xc8d8d0, { transparent: true, opacity: 0.7 }), [0, 0.2, 0], [Math.PI, 0, 0]);
      add(new THREE.ConeGeometry(0.2, 0.3, 6), mat(0xc8d8d0, { transparent: true, opacity: 0.7 }), [0, 0.5, 0]);
      add(new THREE.CylinderGeometry(0.25, 0.25, 0.05, 6), mat(0x3a2214), [0, 0.03, 0]);
      add(new THREE.CylinderGeometry(0.25, 0.25, 0.05, 6), mat(0x3a2214), [0, 0.67, 0]);
      break;
    case 'leContrat':
      add(new THREE.BoxGeometry(0.5, 0.03, 0.68), paper, [0, 0.03, 0], [0, -0.2, 0]);
      add(new THREE.CylinderGeometry(0.08, 0.08, 0.04, 8), red, [0.12, 0.06, 0.2]);
      break;
    case 'cinqCouronnes':
      for (let i = 0; i < 5; i++) {
        const a = (i / 5) * Math.PI * 2;
        add(new THREE.ConeGeometry(0.08, 0.28, 4), gold, [Math.cos(a) * 0.25, 0.28, Math.sin(a) * 0.25]);
      }
      add(new THREE.CylinderGeometry(0.32, 0.32, 0.14, 10, 1, true), gold, [0, 0.07, 0]);
      break;
    default:
      add(new THREE.BoxGeometry(0.4, 0.4, 0.4), red, [0, 0.2, 0]);
  }
  return g;
}

interface Slot {
  uid: number;
  object: THREE.Object3D;
  pulseAt: number;
}

/** Affiche les reliques possédées, dans l'ordre où elles s'activent. */
export class RelicShelf {
  private slots: Slot[] = [];

  constructor(private readonly scene: THREE.Scene) {}

  sync(relics: OwnedRelic[]) {
    const keep = new Set(relics.map((r) => r.uid));
    for (const s of this.slots) if (!keep.has(s.uid)) this.scene.remove(s.object);
    this.slots = relics.map((r) => {
      const existing = this.slots.find((s) => s.uid === r.uid);
      if (existing) return existing;
      const object = buildMesh(r.def.id);
      object.userData.relicUid = r.uid;
      this.scene.add(object);
      return { uid: r.uid, object, pulseAt: -10 };
    });
  }

  position(index: number) {
    return new THREE.Vector3(SLOT_X0 + index * SLOT_DX, 0, SLOT_Z);
  }

  pulse(index: number, clock: number) {
    const s = this.slots[index];
    if (s) s.pulseAt = clock;
  }

  /** Index de la relique sous le rayon, ou -1. */
  pick(raycaster: THREE.Raycaster): number {
    const hit = raycaster.intersectObjects(this.slots.map((s) => s.object), true)[0];
    if (!hit) return -1;
    let o: THREE.Object3D | null = hit.object;
    while (o && o.userData.relicUid === undefined) o = o.parent;
    return o ? this.slots.findIndex((s) => s.uid === o!.userData.relicUid) : -1;
  }

  update(clock: number) {
    this.slots.forEach((s, i) => {
      const t = clock - s.pulseAt;
      // Petit saut + gonflement quand la relique se déclenche.
      const jump = t >= 0 && t < 0.35 ? Math.sin((t / 0.35) * Math.PI) : 0;
      const target = this.position(i);
      s.object.position.lerp(new THREE.Vector3(target.x, jump * 0.5, target.z), 0.25);
      s.object.position.y = jump * 0.5;
      s.object.scale.setScalar(1 + jump * 0.35);
      s.object.rotation.y = Math.sin(clock * 0.6 + i) * 0.15 + jump * 0.4;
    });
  }
}
