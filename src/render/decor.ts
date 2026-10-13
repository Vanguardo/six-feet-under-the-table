import * as THREE from 'three';
import { glowTexture, volumeMaterial } from './volume';
import { grimeTexture } from './textures';

/**
 * Le décor de la cave, au-delà de la table : une lucarne grillagée d'où tombe une lumière froide,
 * des tuyaux qui suintent, des chaînes et des crochets qui pendent du plafond, des toiles d'araignée.
 * Le bleu de la lune répond à l'ambre de l'ampoule et au rouge du néon.
 */

const BACK = -23.8;

export function buildDecor(scene: THREE.Scene) {
  buildWindow(scene);
  buildPipes(scene);
  buildChains(scene);
  buildShelf(scene);
  buildCobwebs(scene);
}

const iron = () => new THREE.MeshStandardMaterial({ color: 0x5a4a40, map: grimeTexture(), metalness: 0.7, roughness: 0.6 });
const rust = () => new THREE.MeshStandardMaterial({ color: 0x6a3a22, map: grimeTexture(), bumpMap: grimeTexture(), bumpScale: 2, metalness: 0.5, roughness: 0.75 });

/** Lucarne haute, barreaux, et le faisceau de lune qui traverse la poussière. */
function buildWindow(scene: THREE.Scene) {
  const at = new THREE.Vector3(13.5, 6.6, BACK + 0.05);
  const glass = new THREE.Mesh(new THREE.PlaneGeometry(3.4, 2.2), new THREE.MeshBasicMaterial({ color: 0x8aa8d8, fog: false }));
  glass.position.copy(at);
  scene.add(glass);
  const frame = rust();
  const add = (geo: THREE.BufferGeometry, x: number, y: number) => {
    const m = new THREE.Mesh(geo, frame);
    m.position.set(at.x + x, at.y + y, at.z + 0.12);
    scene.add(m);
  };
  // Cadre et barreaux.
  add(new THREE.BoxGeometry(3.8, 0.22, 0.24), 0, 1.2);
  add(new THREE.BoxGeometry(3.8, 0.22, 0.24), 0, -1.2);
  add(new THREE.BoxGeometry(0.22, 2.6, 0.24), -1.8, 0);
  add(new THREE.BoxGeometry(0.22, 2.6, 0.24), 1.8, 0);
  for (const x of [-1.05, -0.35, 0.35, 1.05]) add(new THREE.BoxGeometry(0.09, 2.3, 0.09), x, 0);
  const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color: 0x6a88c8, blending: THREE.AdditiveBlending, depthWrite: false, fog: false, opacity: 0.55 }));
  halo.position.copy(at).add(new THREE.Vector3(0, 0, 0.3));
  halo.scale.set(9, 6, 1);
  scene.add(halo);

  // Le faisceau : un tronc de cône qui part de la lucarne et plonge vers le sol, derrière la table.
  const target = new THREE.Vector3(7, -6, -9);
  const dir = target.clone().sub(at);
  const length = dir.length();
  const beamGeo = new THREE.CylinderGeometry(1.5, 4.2, length, 16, 10, true).translate(0, -length / 2, 0);
  const beam = new THREE.Mesh(beamGeo, volumeMaterial(0x7a98d8, 0.022));
  beam.position.copy(at);
  beam.quaternion.setFromUnitVectors(new THREE.Vector3(0, -1, 0), dir.normalize());
  beam.renderOrder = 2;
  scene.add(beam);

  // La lumière elle-même : froide, faible, elle ourle les mains du créancier et le bord de la table.
  const moon = new THREE.SpotLight(0x7090d0, 140, 60, 0.42, 0.7, 1.4);
  moon.position.copy(at).add(new THREE.Vector3(0, 0, 0.5));
  moon.target.position.copy(target);
  scene.add(moon, moon.target);
}

/** Tuyaux rouillés le long du mur du fond, avec brides et vanne. */
function buildPipes(scene: THREE.Scene) {
  const mat = rust();
  const y = 10.2;
  const z = BACK + 0.45;
  const pipe = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.32, 56, 10).rotateZ(Math.PI / 2), mat);
  pipe.position.set(0, y, z);
  pipe.castShadow = true;
  scene.add(pipe);
  const thin = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, 56, 8).rotateZ(Math.PI / 2), mat);
  thin.position.set(0, y - 0.8, z - 0.05);
  scene.add(thin);
  for (let x = -24; x <= 24; x += 6) {
    const flange = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.45, 0.22, 10).rotateZ(Math.PI / 2), mat);
    flange.position.set(x, y, z);
    scene.add(flange);
  }
  // Une conduite qui descend vers le sol, à droite.
  const drop = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.32, 22, 10), mat);
  drop.position.set(20, y - 11, z);
  scene.add(drop);
  const elbow = new THREE.Mesh(new THREE.SphereGeometry(0.42, 10, 8), mat);
  elbow.position.set(20, y, z);
  scene.add(elbow);
  // Vanne à volant.
  const wheel = new THREE.Mesh(new THREE.TorusGeometry(0.55, 0.07, 5, 12), iron());
  wheel.position.set(-7, y + 0.75, z + 0.25);
  scene.add(wheel);
  const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 0.7, 6), iron());
  stem.position.set(-7, y + 0.4, z + 0.25);
  scene.add(stem);
}

/** Chaînes et crochets qui pendent du plafond, à peine visibles dans le contre-jour du néon. */
function buildChains(scene: THREE.Scene) {
  const mat = iron();
  const link = new THREE.TorusGeometry(0.16, 0.045, 4, 8);
  const chains: [number, number, number][] = [
    [-8.5, -15, 7.8],
    [9.5, -17, 6.2],
    [-18, -20, 5.2],
  ];
  for (const [x, z, bottom] of chains) {
    const top = 22;
    const n = Math.floor((top - bottom) / 0.27);
    for (let i = 0; i < n; i++) {
      const m = new THREE.Mesh(link, mat);
      m.position.set(x, top - i * 0.27, z);
      m.rotation.set(0, i % 2 ? Math.PI / 2 : 0, Math.PI / 2);
      scene.add(m);
    }
    // Le crochet de boucher au bout.
    const hook = new THREE.Mesh(new THREE.TorusGeometry(0.42, 0.07, 5, 10, Math.PI * 1.4), mat);
    hook.position.set(x, bottom - 0.55, z);
    hook.rotation.z = Math.PI * 0.8;
    scene.add(hook);
    const shank = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.5, 5), mat);
    shank.position.set(x, bottom - 0.05, z);
    scene.add(shank);
  }
}

/** Une étagère murale sous la lucarne : bouteilles et bocaux qui accrochent la lune. */
function buildShelf(scene: THREE.Scene) {
  const wood = new THREE.MeshStandardMaterial({ color: 0x3a2618, roughness: 0.9, map: grimeTexture() });
  const board = new THREE.Mesh(new THREE.BoxGeometry(6, 0.18, 1.1), wood);
  board.position.set(13.5, 2.4, BACK + 0.6);
  scene.add(board);
  const glass = new THREE.MeshStandardMaterial({ color: 0x4a6a48, transparent: true, opacity: 0.75, roughness: 0.1, metalness: 0.2 });
  const amber = new THREE.MeshStandardMaterial({ color: 0x6a3a14, transparent: true, opacity: 0.8, roughness: 0.1, metalness: 0.2 });
  [-2.3, -1.4, -0.4, 0.7, 1.6, 2.4].forEach((x, i) => {
    const h = 0.7 + (i % 3) * 0.25;
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.22, h, 8), i % 2 ? amber : glass);
    body.position.set(13.5 + x, 2.5 + h / 2, BACK + 0.6);
    const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.12, 0.35, 6), i % 2 ? amber : glass);
    neck.position.set(13.5 + x, 2.5 + h + 0.17, BACK + 0.6);
    scene.add(body, neck);
  });
}

/** Toiles d'araignée dans les angles hauts. */
function buildCobwebs(scene: THREE.Scene) {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d')!;
  g.strokeStyle = 'rgba(220, 215, 200, 0.55)';
  g.lineWidth = 1;
  // Rayons depuis le coin, puis la spirale qui les relie en festons.
  const rays = 9;
  for (let i = 0; i <= rays; i++) {
    const a = (i / rays) * (Math.PI / 2);
    g.beginPath();
    g.moveTo(0, 0);
    g.lineTo(Math.cos(a) * 128, Math.sin(a) * 128);
    g.stroke();
  }
  for (let r = 14; r < 128; r += 12) {
    g.beginPath();
    for (let i = 0; i <= rays; i++) {
      const a = (i / rays) * (Math.PI / 2);
      const rr = r + Math.sin(i * 1.7 + r) * 2;
      const x = Math.cos(a) * rr;
      const y = Math.sin(a) * rr;
      if (i === 0) g.moveTo(x, y);
      else g.quadraticCurveTo(Math.cos(a - 0.08) * (rr - 4), Math.sin(a - 0.08) * (rr - 4), x, y);
    }
    g.stroke();
  }
  const tex = new THREE.CanvasTexture(c);
  const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, side: THREE.DoubleSide, color: 0x9a9080 });
  const corners: [number, number, number, number][] = [
    [-25.6, 11.5, BACK + 0.2, 0],
    [25.6, 11.5, BACK + 0.2, Math.PI / 2],
  ];
  for (const [x, y, z, rot] of corners) {
    const web = new THREE.Mesh(new THREE.PlaneGeometry(6, 6), mat);
    web.position.set(x + (rot ? -3 : 3), y - 3, z);
    web.rotation.z = Math.PI + (rot ? -Math.PI / 2 : 0);
    if (rot) web.rotation.z = -Math.PI / 2;
    scene.add(web);
  }
}
