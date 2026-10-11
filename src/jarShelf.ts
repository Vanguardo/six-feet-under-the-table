import * as THREE from 'three';
import { Hand, PLAYER_HANDS } from './creditor/hand';
import { ps1ify } from './render/ps1';
import { grimeTexture, repeated, skinTexture, woodTexture } from './render/textures';
import type { BodyPartId } from './rules/body';

/**
 * L'étagère à gauche de la table : un bocal par partie du corps, vides au début de la run.
 * Chaque morceau pris par le créancier vient flotter dans le formol, sous une petite ampoule.
 */

type JarPart = BodyPartId;

// Rangée du haut : les petits morceaux ; rangée du bas : les gros.
const LAYOUT: Record<JarPart, { shelf: 0 | 1; x: number; big?: boolean }> = {
  doigt: { shelf: 1, x: -2.4 },
  dent: { shelf: 1, x: -0.8 },
  oreille: { shelf: 1, x: 0.8 },
  langue: { shelf: 1, x: 2.4 },
  oeil: { shelf: 0, x: -2.35 },
  coeur: { shelf: 0, x: -0.6 },
  main: { shelf: 0, x: 1.6, big: true },
};
const SHELF_Y = [0.6, 3.6];
const SHELF_W = 6.8;

const glassMat = new THREE.MeshStandardMaterial({ color: 0xc8d8c0, transparent: true, opacity: 0.12, roughness: 0.08, depthWrite: false, side: THREE.DoubleSide });
const liquidMat = new THREE.MeshStandardMaterial({ color: 0x7a8a38, transparent: true, opacity: 0.16, emissive: 0x060900, depthWrite: false });
const lidMat = new THREE.MeshStandardMaterial({ color: 0x4a4030, metalness: 0.7, roughness: 0.55, map: grimeTexture() });
const skinMat = () => new THREE.MeshStandardMaterial({ color: 0xd0a890, map: skinTexture(), roughness: 0.6, flatShading: true });
const fleshMat = new THREE.MeshStandardMaterial({ color: 0x6a0c0c, roughness: 0.3 });
const boneMat = new THREE.MeshStandardMaterial({ color: 0xc8bca4, roughness: 0.6 });

interface Jar {
  group: THREE.Group;
  pieces: THREE.Object3D[];
  radius: number;
  height: number;
}

export class JarShelf {
  readonly root = new THREE.Group();
  private readonly jars = new Map<JarPart, Jar>();
  private heart: THREE.Object3D | null = null;
  private clock = 0;
  private readonly lights: { light: THREE.PointLight; base: number }[] = [];
  private bulbMat: THREE.MeshBasicMaterial | null = null;

  constructor(scene: THREE.Scene) {
    // Debout dans la pénombre, à gauche de la table, tourné vers le joueur.
    this.root.position.set(-14.3, -2.0, 2.6);
    this.root.rotation.y = 0.8;
    this.root.scale.setScalar(0.85);
    this.buildShelf();
    for (const part of Object.keys(LAYOUT) as JarPart[]) this.jars.set(part, this.buildJar(part));
    ps1ify(this.root);
    scene.add(this.root);
  }

  private buildShelf() {
    const wood = new THREE.MeshStandardMaterial({ map: repeated(woodTexture(true), 2, 0.5), color: 0x9a8070, roughness: 0.9 });
    const add = (geo: THREE.BufferGeometry, pos: [number, number, number]) => {
      const m = new THREE.Mesh(geo, wood);
      m.position.set(...pos);
      m.castShadow = m.receiveShadow = true;
      this.root.add(m);
    };
    for (const y of SHELF_Y) add(new THREE.BoxGeometry(SHELF_W, 0.18, 1.9), [0, y - 0.09, 0]);
    add(new THREE.BoxGeometry(SHELF_W, 0.18, 1.9), [0, 6.6, 0]);
    // Montants qui descendent jusqu'au sol de la cave, et un fond de planches.
    for (const x of [-SHELF_W / 2, SHELF_W / 2]) add(new THREE.BoxGeometry(0.22, 17, 1.9), [x, -1.8, 0]);
    add(new THREE.BoxGeometry(SHELF_W, 17, 0.1), [0, -1.8, -0.95]);

    // Une petite ampoule nue au-dessus des bocaux, assez pour lire ce qu'il y a dedans.
    this.bulbMat = new THREE.MeshBasicMaterial({ color: 0xffd08a });
    const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.16, 6, 5), this.bulbMat);
    bulb.position.set(-0.4, 6.15, 0.4);
    const wire = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.3, 4), new THREE.MeshBasicMaterial({ color: 0x111111 }));
    wire.position.set(-0.4, 6.4, 0.4);
    this.root.add(bulb, wire);
    const light = new THREE.PointLight(0xffb868, 15, 9, 1.6);
    light.position.set(-0.4, 5.9, 1.2);
    this.root.add(light);
    // Un reste de lumière pour la rangée du bas, sous la planche.
    const low = new THREE.PointLight(0xffa860, 9, 5, 1.8);
    low.position.set(0, 2.8, 1.4);
    this.root.add(low);
    this.lights.push({ light, base: light.intensity }, { light: low, base: low.intensity });
  }

  private buildJar(part: JarPart): Jar {
    const spot = LAYOUT[part];
    const radius = spot.big ? 0.95 : 0.62;
    const height = spot.big ? 2.2 : 1.55;
    const group = new THREE.Group();
    group.position.set(spot.x, SHELF_Y[spot.shelf], 0.1);
    const add = (geo: THREE.BufferGeometry, mat: THREE.Material, y: number) => {
      const m = new THREE.Mesh(geo, mat);
      m.position.y = y;
      group.add(m);
      return m;
    };
    add(new THREE.CylinderGeometry(radius, radius, height, 12, 1, true), glassMat, height / 2);
    add(new THREE.CircleGeometry(radius, 12).rotateX(-Math.PI / 2), glassMat, 0.01);
    add(new THREE.CylinderGeometry(radius * 0.94, radius * 0.94, height * 0.82, 12), liquidMat, height * 0.41 + 0.02);
    add(new THREE.CylinderGeometry(radius * 1.06, radius * 1.06, 0.18, 12), lidMat, height + 0.06);
    // Étiquette jaunie, griffonnée à la main.
    const label = add(new THREE.CylinderGeometry(radius * 1.01, radius * 1.01, 0.22, 12, 1, true, -0.6, 1.2), new THREE.MeshStandardMaterial({ map: labelTexture(part), roughness: 1, side: THREE.DoubleSide }), 0.16);
    label.rotation.y = 0;
    this.root.add(group);
    return { group, pieces: [], radius, height };
  }

  /** Le créancier range ce qu'il a pris. */
  add(part: BodyPartId) {
    const jar = this.jars.get(part as JarPart);
    if (!jar) return;
    const piece = buildPiece(part);
    const n = jar.pieces.length;
    if (part === 'main') {
      piece.position.set(0, jar.height * 0.42, 0);
    } else if (part === 'coeur') {
      piece.position.set(0, jar.height * 0.45, 0);
      this.heart = piece;
    } else {
      // Les morceaux s'empilent en spirale, légèrement de travers, comme s'ils flottaient.
      const a = n * 2.3;
      const r = n === 0 ? 0 : jar.radius * 0.42;
      piece.position.set(Math.cos(a) * r, 0.42 + (n % 4) * 0.26, Math.sin(a) * r);
      piece.rotation.set(Math.random() * 1.2 - 0.6, Math.random() * Math.PI * 2, Math.random() * 1.2 - 0.6);
      piece.scale.multiplyScalar(part === 'langue' ? 1.7 : 1.35);
    }
    piece.userData.baseY = piece.position.y;
    piece.userData.phase = Math.random() * 6;
    ps1ify(piece);
    jar.group.add(piece);
    jar.pieces.push(piece);
  }

  /** Les morceaux dérivent doucement ; le cœur bat encore, de plus en plus faiblement. */
  update(dt: number) {
    this.clock += dt;
    for (const jar of this.jars.values()) {
      for (const p of jar.pieces) {
        p.position.y = p.userData.baseY + Math.sin(this.clock * 0.6 + p.userData.phase) * 0.04;
        p.rotation.y += dt * 0.05;
      }
    }
    if (this.heart) {
      const beat = this.clock % 2.6;
      const pulse = beat < 0.12 ? beat / 0.12 : beat < 0.3 ? 1 - (beat - 0.12) / 0.18 : 0;
      this.heart.scale.setScalar(1 + pulse * 0.08);
    }
  }

  /** La petite ampoule suit la grande : quand la cave s'éteint, l'étagère aussi. */
  setLight(level: number) {
    for (const { light, base } of this.lights) light.intensity = base * level;
    this.bulbMat?.color.setRGB(1 * (0.2 + 0.8 * level), 0.82 * (0.2 + 0.8 * level), 0.54 * (0.2 + 0.8 * level));
  }

  /** Nouvelle run : les bocaux sont vidés. */
  reset() {
    for (const jar of this.jars.values()) {
      for (const p of jar.pieces) jar.group.remove(p);
      jar.pieces.length = 0;
    }
    this.heart = null;
  }
}

// ---------------------------------------------------------------- morceaux

function buildPiece(part: BodyPartId): THREE.Object3D {
  const g = new THREE.Group();
  const add = (geo: THREE.BufferGeometry, mat: THREE.Material, pos: [number, number, number] = [0, 0, 0], rot: [number, number, number] = [0, 0, 0], parent: THREE.Object3D = g) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(...pos);
    m.rotation.set(...rot);
    parent.add(m);
    return m;
  };
  switch (part) {
    case 'doigt': {
      // Trois phalanges légèrement pliées, un ongle, une coupe nette à la base.
      const skin = skinMat();
      let joint: THREE.Object3D = g;
      const lens = [0.26, 0.2, 0.17];
      lens.forEach((len, i) => {
        const j = new THREE.Group();
        if (i > 0) {
          j.position.y = lens[i - 1];
          j.rotation.x = 0.35;
        }
        const r = 0.1 - i * 0.01;
        add(new THREE.CylinderGeometry(r * 0.92, r, len, 6), skin, [0, len / 2, 0], [0, 0, 0], j);
        add(new THREE.SphereGeometry(r * 1.05, 6, 4), skin, [0, 0, 0], [0, 0, 0], j);
        if (i === lens.length - 1) {
          add(new THREE.SphereGeometry(r, 6, 4), skin, [0, len, 0], [0, 0, 0], j);
          add(new THREE.BoxGeometry(r * 1.3, 0.12, 0.02), new THREE.MeshStandardMaterial({ color: 0xe8d8c8, roughness: 0.3 }), [0, len * 0.8, r * 0.95], [0, 0, 0], j);
        }
        joint.add(j);
        joint = j;
      });
      add(new THREE.CircleGeometry(0.074, 6), fleshMat, [0, -0.001, 0], [Math.PI / 2, 0, 0]);
      add(new THREE.CircleGeometry(0.025, 5), boneMat, [0, -0.003, 0], [Math.PI / 2, 0, 0]);
      g.position.y -= 0.2;
      break;
    }
    case 'dent': {
      // Molaire : couronne bosselée, deux racines tachées de sang.
      const enamel = new THREE.MeshStandardMaterial({ color: 0xc8bca0, roughness: 0.55 });
      add(new THREE.BoxGeometry(0.2, 0.14, 0.18), enamel, [0, 0.1, 0]);
      for (const [x, z] of [[-0.05, -0.04], [0.05, -0.04], [-0.05, 0.05], [0.05, 0.05]]) add(new THREE.SphereGeometry(0.055, 5, 4), enamel, [x, 0.17, z]);
      const root = new THREE.MeshStandardMaterial({ color: 0xc8a080, roughness: 0.6 });
      for (const x of [-0.055, 0.055]) {
        add(new THREE.ConeGeometry(0.045, 0.2, 5), root, [x, -0.06, 0], [Math.PI, 0, x * 2]);
        add(new THREE.SphereGeometry(0.03, 4, 3), fleshMat, [x * 1.4, -0.15, 0]);
      }
      g.scale.setScalar(1.3);
      break;
    }
    case 'oreille': {
      // Pavillon : contour en C épais, conque creusée, lobe charnu, bord arraché.
      const skin = skinMat();
      const shape = new THREE.Shape();
      shape.moveTo(0, -0.28);
      shape.bezierCurveTo(-0.16, -0.26, -0.2, -0.1, -0.14, 0.02);
      shape.bezierCurveTo(-0.2, 0.18, -0.08, 0.32, 0.06, 0.3);
      shape.bezierCurveTo(0.2, 0.28, 0.22, 0.1, 0.12, -0.02);
      shape.bezierCurveTo(0.08, -0.1, 0.1, -0.22, 0, -0.28);
      const hole = new THREE.Path();
      hole.moveTo(0.02, -0.08);
      hole.bezierCurveTo(-0.08, -0.06, -0.08, 0.14, 0.04, 0.18);
      hole.bezierCurveTo(0.12, 0.16, 0.1, 0.02, 0.02, -0.08);
      shape.holes.push(hole);
      add(new THREE.ExtrudeGeometry(shape, { depth: 0.05, bevelEnabled: true, bevelThickness: 0.02, bevelSize: 0.02, bevelSegments: 1, curveSegments: 5 }), skin);
      add(new THREE.CircleGeometry(0.1, 7), new THREE.MeshStandardMaterial({ color: 0x9a6a5a, roughness: 0.7 }), [0.03, 0.05, 0.005]);
      add(new THREE.SphereGeometry(0.07, 6, 4), skin, [0, -0.25, 0.03]);
      add(new THREE.BoxGeometry(0.04, 0.3, 0.06), fleshMat, [-0.15, -0.02, 0.03]);
      g.scale.setScalar(1.25);
      break;
    }
    case 'langue': {
      // Langue épaisse, sillon central, bout arrondi, racine coupée à vif.
      const tongue = new THREE.MeshStandardMaterial({ color: 0xb04848, roughness: 0.35, map: grimeTexture() });
      const body = add(new THREE.SphereGeometry(0.2, 8, 6), tongue);
      body.scale.set(0.95, 0.38, 2.0);
      add(new THREE.BoxGeometry(0.02, 0.02, 0.6), new THREE.MeshStandardMaterial({ color: 0x6a1a1a }), [0, 0.075, 0.02]);
      add(new THREE.CircleGeometry(0.17, 7), fleshMat, [0, 0, -0.38], [0, Math.PI, 0]).scale.set(1, 0.42, 1);
      g.rotation.x = 0.5;
      break;
    }
    case 'oeil': {
      // Globe veiné, iris et pupille, nerf optique qui pend derrière.
      add(new THREE.SphereGeometry(0.2, 10, 8), new THREE.MeshStandardMaterial({ map: eyeTexture(), roughness: 0.25 }), [0, 0, 0], [0, -Math.PI / 2, 0]);
      const nerve = new THREE.CatmullRomCurve3([new THREE.Vector3(0, 0, -0.18), new THREE.Vector3(0.05, -0.08, -0.32), new THREE.Vector3(-0.02, -0.22, -0.4)]);
      add(new THREE.TubeGeometry(nerve, 6, 0.035, 5), new THREE.MeshStandardMaterial({ color: 0xc89080, roughness: 0.5 }));
      add(new THREE.SphereGeometry(0.04, 4, 3), fleshMat, [-0.02, -0.22, -0.4]);
      g.scale.setScalar(1.4);
      break;
    }
    case 'coeur': {
      // Cœur : deux lobes, pointe, aorte et artères tranchées sur le dessus.
      const muscle = new THREE.MeshStandardMaterial({ color: 0x7a1010, roughness: 0.35, map: grimeTexture() });
      add(new THREE.SphereGeometry(0.24, 8, 6), muscle, [-0.09, 0.08, 0]);
      add(new THREE.SphereGeometry(0.22, 8, 6), muscle, [0.1, 0.06, 0.02]);
      add(new THREE.ConeGeometry(0.27, 0.42, 8), muscle, [0, -0.22, 0], [Math.PI, 0, 0.2]);
      const vessel = new THREE.MeshStandardMaterial({ color: 0xa04848, roughness: 0.45 });
      add(new THREE.CylinderGeometry(0.08, 0.09, 0.32, 6), vessel, [0.02, 0.36, 0], [0, 0, -0.2]);
      add(new THREE.CylinderGeometry(0.05, 0.06, 0.22, 6), vessel, [-0.14, 0.32, 0.05], [0, 0, 0.5]);
      add(new THREE.CylinderGeometry(0.045, 0.05, 0.2, 6), vessel, [0.16, 0.3, -0.04], [0.3, 0, -0.6]);
      add(new THREE.CylinderGeometry(0.06, 0.06, 0.01, 6), fleshMat, [0.05, 0.52, 0], [0, 0, -0.2]);
      // Graisse jaunâtre et vaisseaux coronaires.
      add(new THREE.BoxGeometry(0.3, 0.06, 0.04), new THREE.MeshStandardMaterial({ color: 0xc8a860, roughness: 0.6 }), [0, 0.02, 0.22], [0, 0, 0.4]);
      g.scale.setScalar(1.3);
      break;
    }
    case 'main': {
      // Ta main, paume vers le ciel, doigts à demi refermés.
      const hand = new Hand(true, PLAYER_HANDS, true);
      hand.curl.fill(0.5);
      hand.curl[4] = 0.2;
      hand.pose();
      hand.root.scale.setScalar(0.38);
      hand.root.rotation.set(-Math.PI / 2 + 0.3, 0.4, Math.PI);
      hand.root.position.set(0, -0.35, 0);
      g.add(hand.root);
      break;
    }
  }
  return g;
}

// ---------------------------------------------------------------- textures

function eyeTexture() {
  const c = document.createElement('canvas');
  c.width = 64;
  c.height = 32;
  const g = c.getContext('2d')!;
  g.fillStyle = '#ece4d6';
  g.fillRect(0, 0, 64, 32);
  // Veines rouges qui convergent vers l'iris.
  g.strokeStyle = 'rgba(160, 20, 20, 0.7)';
  for (let i = 0; i < 26; i++) {
    let x = Math.random() * 64;
    let y = Math.random() < 0.5 ? 2 : 30;
    g.beginPath();
    g.moveTo(x, y);
    for (let k = 0; k < 5; k++) {
      x += (32 - x) * 0.18 + (Math.random() - 0.5) * 4;
      y += (16 - y) * 0.2 + (Math.random() - 0.5) * 3;
      g.lineTo(x, y);
    }
    g.stroke();
  }
  // Iris au centre de la texture (face +X une fois enroulé, tourné vers l'avant).
  g.fillStyle = '#3a5a3a';
  g.beginPath();
  g.ellipse(32, 16, 6, 7, 0, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = '#050505';
  g.beginPath();
  g.ellipse(32, 16, 2.6, 3, 0, 0, Math.PI * 2);
  g.fill();
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.magFilter = THREE.NearestFilter;
  return tex;
}

function labelTexture(part: BodyPartId) {
  const c = document.createElement('canvas');
  c.width = 64;
  c.height = 24;
  const g = c.getContext('2d')!;
  g.fillStyle = '#b8a880';
  g.fillRect(0, 0, 64, 24);
  for (let i = 0; i < 60; i++) {
    g.fillStyle = `rgba(80, 50, 20, ${Math.random() * 0.25})`;
    g.fillRect(Math.random() * 64, Math.random() * 24, 2, 2);
  }
  // Griffonnage illisible et un numéro d'inventaire.
  g.strokeStyle = 'rgba(30, 15, 10, 0.85)';
  g.beginPath();
  let x = 8;
  g.moveTo(x, 10);
  while (x < 54) {
    x += 2 + Math.random() * 3;
    g.lineTo(x, 7 + Math.random() * 6);
  }
  g.stroke();
  g.fillStyle = 'rgba(110, 10, 10, 0.9)';
  g.font = 'bold 8px monospace';
  g.fillText(`N°${['doigt', 'dent', 'oreille', 'langue', 'oeil', 'coeur', 'main'].indexOf(part) + 1}`, 8, 21);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
