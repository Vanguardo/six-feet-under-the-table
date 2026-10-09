import * as THREE from 'three';
import { grimeTexture, skinTexture } from '../render/textures';

// Une phalange de trop à chaque doigt : quatre segments au lieu de trois.
// Ordre : index, majeur, annulaire, auriculaire (le pouce est du côté +X).
const FINGERS = [
  { x: 0.33, lengths: [0.32, 0.28, 0.25, 0.2] },
  { x: 0.11, lengths: [0.36, 0.31, 0.27, 0.22] },
  { x: -0.11, lengths: [0.34, 0.29, 0.26, 0.21] },
  { x: -0.33, lengths: [0.27, 0.23, 0.2, 0.17] },
];
const THUMB = { x: 0.5, z: 0.35, yaw: 0.8, lengths: [0.28, 0.24, 0.2] };
// Angle de flexion de chaque segment pour une courbure de 1 (poing).
// Une courbure négative relève le doigt (pianotage).
const CURL_ANGLES = [0.55, 0.85, 0.8, 0.7];
const PALM = { w: 0.95, h: 0.2, l: 1.05 };
/** Les mains sont plus grandes que nature : elles doivent se lire de l'autre bout de la table. */
export const HAND_SCALE = 1.7;
/** Longueur poignet → bout de l'index, à l'échelle. */
export const HAND_REACH = (PALM.l + FINGERS[0].lengths.reduce((a, b) => a + b, 0)) * HAND_SCALE;

/** Teintes d'une paire de mains : le créancier est pâle, le marchand crasseux. */
export interface HandLook {
  skin: number;
  knuckle: number;
  nail: number;
  sleeve: number;
  cuff: number;
}

export const CREDITOR_HANDS: HandLook = { skin: 0xffffff, knuckle: 0xb8aaa0, nail: 0x8c7a3c, sleeve: 0x0b0808, cuff: 0x4a4038 };
export const MERCHANT_HANDS: HandLook = { skin: 0x6a6450, knuckle: 0x7a6a50, nail: 0x1a1410, sleeve: 0x2a1e12, cuff: 0x3a2c1c };

const materialsFor = (look: HandLook) => ({
  skin: new THREE.MeshStandardMaterial({ map: skinTexture(), color: look.skin, roughness: 0.75, flatShading: true }),
  // Articulations et tendons un peu plus sombres : ils dessinent le relief de la main.
  knuckleSkin: new THREE.MeshStandardMaterial({ map: skinTexture(), color: look.knuckle, roughness: 0.7, flatShading: true }),
  nail: new THREE.MeshStandardMaterial({ color: look.nail, map: grimeTexture(), roughness: 0.4, flatShading: true }),
  sleeve: new THREE.MeshStandardMaterial({ color: look.sleeve, roughness: 1, flatShading: true }),
  cuff: new THREE.MeshStandardMaterial({ color: look.cuff, map: grimeTexture(), roughness: 1, flatShading: true }),
});

/** Paume trapézoïdale : plus large aux jointures qu'au poignet, bombée sur le dessus. */
function palmGeometry() {
  const geo = new THREE.BoxGeometry(PALM.w, PALM.h, PALM.l, 2, 1, 2);
  const pos = geo.getAttribute('position') as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    const z = pos.getZ(i) / PALM.l + 0.5; // 0 au poignet, 1 aux jointures
    pos.setX(i, pos.getX(i) * (0.78 + z * 0.3));
    if (pos.getY(i) > 0 && Math.abs(pos.getX(i)) < 0.2) pos.setY(i, pos.getY(i) + 0.04);
  }
  geo.computeVertexNormals();
  return geo;
}

/** Main articulée : poignet à l'origine, doigts vers +Z, paume vers le bas. */
export class Hand {
  readonly root = new THREE.Group();
  /** Courbure de chaque doigt (-0.6 = relevé, 0 = tendu, 1 = poing) : index, majeur, annulaire, auriculaire, pouce. */
  readonly curl = [0.3, 0.3, 0.3, 0.3, 0.3];
  private readonly joints: THREE.Group[][] = [];

  private readonly m: ReturnType<typeof materialsFor>;

  constructor(mirror: boolean, look: HandLook = CREDITOR_HANDS) {
    this.m = materialsFor(look);
    const { skin, knuckleSkin, sleeve, cuff } = this.m;
    const body = new THREE.Group();
    body.scale.set(mirror ? -HAND_SCALE : HAND_SCALE, HAND_SCALE, HAND_SCALE);
    this.root.add(body);

    const add = (geo: THREE.BufferGeometry, mat: THREE.Material, pos: [number, number, number], parent: THREE.Object3D = body) => {
      const m = new THREE.Mesh(geo, mat);
      m.position.set(...pos);
      m.castShadow = true;
      parent.add(m);
      return m;
    };

    add(palmGeometry(), skin, [0, 0, PALM.l / 2]);
    // Tendons qui courent du poignet vers chaque jointure.
    for (const f of FINGERS) {
      const t = add(new THREE.BoxGeometry(0.035, 0.03, PALM.l * 0.85), knuckleSkin, [f.x * 0.8, PALM.h / 2 + 0.02, PALM.l * 0.5]);
      t.rotation.y = -f.x * 0.2;
    }
    // Os du poignet, manchette de chemise sale, manche noire qui s'enfonce dans l'ombre.
    add(new THREE.BoxGeometry(0.64, 0.3, 0.3), skin, [0, 0, -0.08]);
    add(new THREE.SphereGeometry(0.07, 5, 4), knuckleSkin, [0.3, 0.1, -0.05]);
    add(new THREE.BoxGeometry(0.78, 0.5, 0.3), cuff, [0, 0.03, -0.38]);
    add(new THREE.BoxGeometry(0.72, 0.48, 5), sleeve, [0, 0.05, -3.0]);

    for (const f of FINGERS) {
      // Jointure saillante à la base de chaque doigt.
      add(new THREE.BoxGeometry(0.17, 0.1, 0.15), knuckleSkin, [f.x, PALM.h / 2 + 0.01, PALM.l - 0.05]);
      this.joints.push(this.buildFinger(body, new THREE.Vector3(f.x, 0, PALM.l), 0, f.lengths));
    }
    this.joints.push(this.buildFinger(body, new THREE.Vector3(THUMB.x, -0.02, THUMB.z), THUMB.yaw, THUMB.lengths));
  }

  private buildFinger(parent: THREE.Object3D, base: THREE.Vector3, yaw: number, lengths: number[]) {
    const joints: THREE.Group[] = [];
    let attach: THREE.Object3D = parent;
    lengths.forEach((len, i) => {
      const joint = new THREE.Group();
      if (i === 0) {
        joint.position.copy(base);
        joint.rotation.y = yaw;
      } else {
        joint.position.z = lengths[i - 1];
      }
      const thick = 0.13 - i * 0.014;
      // Segment légèrement effilé vers le bout.
      const seg = new THREE.Mesh(new THREE.CylinderGeometry(thick * 0.45, thick * 0.55, len * 0.96, 5).rotateX(Math.PI / 2), this.m.skin);
      seg.position.z = len / 2;
      seg.castShadow = true;
      joint.add(seg);
      // Articulation noueuse entre deux phalanges.
      if (i > 0) {
        const knot = new THREE.Mesh(new THREE.SphereGeometry(thick * 0.62, 5, 4), this.m.knuckleSkin);
        knot.scale.set(1, 0.85, 0.8);
        joint.add(knot);
      }
      if (i === lengths.length - 1) {
        // Ongle long, jaune, qui dépasse et se recourbe.
        const n = new THREE.Mesh(new THREE.BoxGeometry(thick * 0.85, 0.025, 0.26), this.m.nail);
        n.position.set(0, thick * 0.4, len * 0.85);
        n.rotation.x = 0.25;
        joint.add(n);
      }
      attach.add(joint);
      attach = joint;
      joints.push(joint);
    });
    return joints;
  }

  /** Applique les courbures courantes aux articulations. */
  pose() {
    this.joints.forEach((finger, f) => {
      const c = this.curl[f];
      finger.forEach((joint, i) => {
        // Relevé : surtout la première phalange, les autres restent presque droites.
        const angle = c >= 0 ? c * CURL_ANGLES[i] : c * (i === 0 ? 1.25 : 0.2);
        joint.rotation.x = angle * (f === 4 ? 0.7 : 1);
      });
    });
  }
}
