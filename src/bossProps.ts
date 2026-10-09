import * as THREE from 'three';
import { ps1ify } from './render/ps1';
import { grimeTexture } from './render/textures';
import type { BossId } from './rules/bosses';

const mat = (color: number, extra: Partial<THREE.MeshStandardMaterialParameters> = {}) =>
  new THREE.MeshStandardMaterial({ color, map: grimeTexture(), roughness: 0.7, flatShading: true, ...extra });

/** Objets low-poly qui annoncent le boss, sans un mot. */
function build(id: BossId): THREE.Object3D | null {
  const g = new THREE.Group();
  const add = (geo: THREE.BufferGeometry, m: THREE.Material, pos: [number, number, number], rot: [number, number, number] = [0, 0, 0]) => {
    const mesh = new THREE.Mesh(geo, m);
    mesh.position.set(...pos);
    mesh.rotation.set(...rot);
    mesh.castShadow = true;
    g.add(mesh);
  };
  const gold = mat(0xb8902a, { metalness: 0.8, roughness: 0.35 });
  const wood = mat(0x4a2a16);
  switch (id) {
    case 'aveugle':
      // Bandeau noué, posé à plat.
      add(new THREE.TorusGeometry(0.55, 0.09, 4, 12), mat(0x161010, { roughness: 1 }), [0, 0.06, 0], [Math.PI / 2, 0, 0]);
      add(new THREE.BoxGeometry(0.16, 0.08, 0.5), mat(0x161010), [0.62, 0.05, 0.3], [0, 0.5, 0]);
      break;
    case 'comptable':
      add(new THREE.BoxGeometry(1.4, 0.08, 0.08), wood, [0, 0.9, 0]);
      add(new THREE.BoxGeometry(1.4, 0.08, 0.08), wood, [0, 0.05, 0]);
      add(new THREE.BoxGeometry(0.08, 0.9, 0.08), wood, [-0.7, 0.47, 0]);
      add(new THREE.BoxGeometry(0.08, 0.9, 0.08), wood, [0.7, 0.47, 0]);
      for (let r = 0; r < 4; r++) {
        add(new THREE.CylinderGeometry(0.015, 0.015, 1.4, 4), mat(0x6a6a6a), [0, 0.22 + r * 0.19, 0], [0, 0, Math.PI / 2]);
        for (let b = 0; b < 5; b++) add(new THREE.SphereGeometry(0.06, 5, 4), mat(r % 2 ? 0x7a1010 : 0xd8c8a0), [-0.5 + b * 0.12 + (r % 2) * 0.4, 0.22 + r * 0.19, 0]);
      }
      break;
    case 'mere':
      add(new THREE.TorusGeometry(0.16, 0.04, 5, 12), gold, [0, 0.16, 0], [0.3, 0, 0]);
      break;
    case 'boucher':
      // Hachoir planté dans la planche.
      add(new THREE.BoxGeometry(0.9, 0.55, 0.04), mat(0x8a8a90, { metalness: 0.7, roughness: 0.4 }), [0, 0.2, 0], [0, 0.3, 0.15]);
      add(new THREE.BoxGeometry(0.6, 0.12, 0.1), wood, [0.65, 0.45, 0.2], [0, 0.3, 0.15]);
      add(new THREE.BoxGeometry(0.3, 0.2, 0.05), mat(0x5a0a0a), [-0.2, 0.32, 0.03], [0, 0.3, 0.15]);
      break;
    case 'horloger':
      add(new THREE.CylinderGeometry(0.32, 0.32, 0.1, 12), gold, [0, 0.05, 0]);
      add(new THREE.CylinderGeometry(0.27, 0.27, 0.11, 12), mat(0xe8e0c8), [0, 0.06, 0]);
      add(new THREE.BoxGeometry(0.03, 0.02, 0.2), mat(0x111111), [0, 0.12, -0.08]);
      for (let i = 0; i < 6; i++) add(new THREE.TorusGeometry(0.05, 0.015, 4, 6), gold, [0.35 + i * 0.09, 0.03, 0.1 + i * 0.05], [Math.PI / 2, 0, i]);
      break;
    case 'jumeau':
      add(new THREE.BoxGeometry(0.7, 1.0, 0.06), wood, [0, 0.5, 0], [-0.2, 0, 0]);
      add(new THREE.PlaneGeometry(0.58, 0.88), new THREE.MeshStandardMaterial({ color: 0xc8d0d8, metalness: 1, roughness: 0.05 }), [0, 0.5, 0.035], [-0.2, 0, 0]);
      break;
    case 'pretre':
      // Croix renversée : la traverse en bas.
      add(new THREE.BoxGeometry(0.12, 1.2, 0.12), mat(0x2a1a10), [0, 0.6, 0]);
      add(new THREE.BoxGeometry(0.6, 0.12, 0.12), mat(0x2a1a10), [0, 0.32, 0]);
      break;
    case 'sangsue':
      add(new THREE.CylinderGeometry(0.32, 0.32, 0.7, 10, 1, true), new THREE.MeshStandardMaterial({ color: 0xb8c8b0, transparent: true, opacity: 0.25, depthWrite: false }), [0, 0.35, 0]);
      for (let i = 0; i < 5; i++) add(new THREE.CapsuleGeometry(0.05, 0.16, 2, 5), mat(0x101408, { roughness: 0.2 }), [Math.cos(i * 1.3) * 0.15, 0.15 + i * 0.09, Math.sin(i * 1.3) * 0.15], [i, i * 2, 0]);
      break;
    case 'creancier':
      return null;
  }
  ps1ify(g);
  return g;
}

/** L'objet du boss en cours, posé devant l'ardoise. */
export class BossProps {
  private current: THREE.Object3D | null = null;
  private shownId: BossId | null = null;
  private appearAt = 0;

  constructor(private readonly scene: THREE.Scene) {}

  show(id: BossId | null, clock: number) {
    if (id === this.shownId) return;
    if (this.current) this.scene.remove(this.current);
    this.shownId = id;
    this.current = id ? build(id) : null;
    if (this.current) {
      this.current.position.set(-1.6, 0.8, -7.95);
      this.scene.add(this.current);
      this.appearAt = clock;
    }
  }

  update(clock: number) {
    if (!this.current) return;
    // L'objet tombe sur la planche, comme posé un peu brusquement.
    const t = Math.min(1, (clock - this.appearAt) / 0.35);
    this.current.position.y = 0.8 + (1 - t * t) * 2;
  }
}
