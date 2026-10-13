import * as THREE from 'three';
import { ps1ify } from './render/ps1';
import { VIALS, type VialId } from './rules/vials';

/** Une fiole de verre bouchée de liège ; le liquide luit un peu dans la pénombre. */
export function buildVialMesh(id: VialId): THREE.Group {
  const g = new THREE.Group();
  const def = VIALS[id];
  const glass = new THREE.MeshStandardMaterial({ color: 0xd8e8e0, transparent: true, opacity: 0.35, roughness: 0.05, metalness: 0.1, depthWrite: false });
  const liquid = new THREE.MeshStandardMaterial({ color: def.color, emissive: def.color, emissiveIntensity: 0.35, roughness: 0.2 });
  const cork = new THREE.MeshStandardMaterial({ color: 0x8a6a40, roughness: 0.9 });
  const add = (geo: THREE.BufferGeometry, m: THREE.Material, y: number) => {
    const mesh = new THREE.Mesh(geo, m);
    mesh.position.y = y;
    mesh.castShadow = true;
    g.add(mesh);
    return mesh;
  };
  add(new THREE.SphereGeometry(0.34, 10, 8), liquid, 0.32).scale.set(0.92, 0.85, 0.92);
  add(new THREE.SphereGeometry(0.38, 10, 8), glass, 0.34);
  add(new THREE.CylinderGeometry(0.11, 0.13, 0.42, 8), glass, 0.86);
  add(new THREE.CylinderGeometry(0.12, 0.1, 0.18, 8), cork, 1.12);
  // Étiquette de papier, nouée au col.
  const tag = add(new THREE.BoxGeometry(0.22, 0.14, 0.02), new THREE.MeshStandardMaterial({ color: 0xd8ccac, roughness: 1 }), 0.78);
  tag.position.set(0.18, 0.78, 0.14);
  tag.rotation.set(0, 0.6, 0.3);
  return g;
}

/**
 * Les fioles du joueur, rangées sur la caisse de l'imprimante. Un clic dessus pour la boire
 * (ou la verser, pour l'encre). `parent` = le repère de la caisse.
 */
export class VialRack {
  private readonly slots: { id: VialId; object: THREE.Group }[] = [];
  private clock = 0;

  constructor(private readonly parent: THREE.Object3D) {}

  sync(vials: VialId[]) {
    for (const s of this.slots) this.parent.remove(s.object);
    this.slots.length = 0;
    vials.forEach((id, i) => {
      const object = buildVialMesh(id);
      object.position.set(1.15, 0, 2.0 + i * 1.0);
      object.userData.vialIndex = i;
      ps1ify(object);
      this.parent.add(object);
      this.slots.push({ id, object });
    });
  }

  /** Index de la fiole sous le rayon, ou -1. */
  pick(raycaster: THREE.Raycaster): number {
    const hit = raycaster.intersectObjects(this.slots.map((s) => s.object), true)[0];
    if (!hit) return -1;
    let o: THREE.Object3D | null = hit.object;
    while (o && o.userData.vialIndex === undefined) o = o.parent;
    return o ? (o.userData.vialIndex as number) : -1;
  }

  /** La fiole visée se soulève un peu : on sait qu'on peut la prendre. */
  update(dt: number, hovered: number) {
    this.clock += dt;
    this.slots.forEach((s, i) => {
      const lift = i === hovered ? 0.35 : 0;
      s.object.position.y += (lift + Math.sin(this.clock * 2 + i) * 0.02 - s.object.position.y) * Math.min(1, dt * 10);
      s.object.rotation.y += dt * 0.3;
    });
  }
}
