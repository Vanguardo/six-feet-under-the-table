import * as THREE from 'three';
import { ps1ify } from './ps1';
import { grimeTexture, leatherTexture, repeated } from './textures';

/**
 * Le côté du créancier : son registre ouvert, couvert de noms rayés à l'encre rouge,
 * un encrier et sa plume, et ses propres piles de pièces, bien plus hautes que les tiennes.
 */
export function buildCreditorDesk(scene: THREE.Scene) {
  const desk = new THREE.Group();
  const PLANK = 0.8;

  // Le registre : couverture de cuir, deux pages bombées.
  const leather = repeated(leatherTexture(), 1, 1);
  const cover = new THREE.Mesh(
    new THREE.BoxGeometry(3.4, 0.12, 2.3),
    new THREE.MeshStandardMaterial({ map: leather, bumpMap: leather, bumpScale: 1.5, color: 0x5a2418, roughness: 0.7 }),
  );
  cover.position.set(0, PLANK + 0.06, 0);
  desk.add(cover);
  const pages = ledgerPages();
  for (const side of [-1, 1]) {
    const page = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.16, 2.1), [
      paperEdge, paperEdge, new THREE.MeshStandardMaterial({ map: side < 0 ? pages.left : pages.right, color: 0x9a8a6a, roughness: 0.95 }), paperEdge, paperEdge, paperEdge,
    ]);
    page.position.set(side * 0.82, PLANK + 0.19, 0);
    page.rotation.z = side * -0.05;
    page.castShadow = page.receiveShadow = true;
    desk.add(page);
  }
  // Ruban marque-page.
  const ribbon = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.01, 1.4), new THREE.MeshStandardMaterial({ color: 0x7a0c10 }));
  ribbon.position.set(0.05, PLANK + 0.28, 1.4);
  ribbon.rotation.x = 0.4;
  desk.add(ribbon);

  // Encrier et plume.
  const glass = new THREE.MeshStandardMaterial({ color: 0x1a1a22, metalness: 0.3, roughness: 0.1 });
  const well = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.34, 0.4, 10), glass);
  well.position.set(2.3, PLANK + 0.2, -0.3);
  const ink = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 0.02, 10), new THREE.MeshStandardMaterial({ color: 0x3a0406, roughness: 0.05 }));
  ink.position.set(2.3, PLANK + 0.41, -0.3);
  const quill = new THREE.Group();
  const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.025, 1.6, 4), new THREE.MeshStandardMaterial({ color: 0xd8d0c0 }));
  shaft.position.y = 0.8;
  const vane = new THREE.Mesh(new THREE.PlaneGeometry(0.28, 1.1), new THREE.MeshStandardMaterial({ color: 0x1a1612, side: THREE.DoubleSide, roughness: 0.9 }));
  vane.position.set(0.08, 1.05, 0);
  quill.add(shaft, vane);
  quill.position.set(2.3, PLANK + 0.3, -0.3);
  quill.rotation.set(0.35, 0, -0.4);
  desk.add(well, ink, quill);

  // Ses pièces : hautes piles, quelques pièces couchées autour.
  const gold = new THREE.MeshStandardMaterial({ color: 0xd8ac40, metalness: 0.85, roughness: 0.3, map: grimeTexture() });
  const coin = new THREE.CylinderGeometry(0.34, 0.34, 0.1, 10);
  const stacks: [number, number, number][] = [
    [3.5, -0.4, 14],
    [4.15, 0.1, 9],
    [3.8, 0.6, 17],
    [4.5, -0.6, 6],
  ];
  for (const [x, z, n] of stacks) {
    for (let i = 0; i < n; i++) {
      const c = new THREE.Mesh(coin, gold);
      c.position.set(x + (Math.random() - 0.5) * 0.04, PLANK + 0.05 + i * 0.1, z + (Math.random() - 0.5) * 0.04);
      c.rotation.y = Math.random() * Math.PI;
      c.castShadow = true;
      desk.add(c);
    }
  }
  for (let i = 0; i < 5; i++) {
    const c = new THREE.Mesh(coin, gold);
    c.position.set(3.9 + (Math.random() - 0.5) * 1.6, PLANK + 0.05, (Math.random() - 0.5) * 1.6);
    c.rotation.set((Math.random() - 0.5) * 0.3, Math.random() * Math.PI, 0);
    desk.add(c);
  }

  desk.position.set(7.4, 0, -9.7);
  desk.rotation.y = -0.18;
  ps1ify(desk);
  scene.add(desk);
}

const paperEdge = new THREE.MeshStandardMaterial({ color: 0x8a7a5a, roughness: 1 });

/** Deux pages de comptes : colonnes de noms, sommes, et des lignes barrées en rouge. */
function ledgerPages() {
  const draw = (seed: number) => {
    const c = document.createElement('canvas');
    c.width = 128;
    c.height = 160;
    const g = c.getContext('2d')!;
    g.fillStyle = '#d8ccaa';
    g.fillRect(0, 0, 128, 160);
    for (let i = 0; i < 200; i++) {
      g.fillStyle = `rgba(110, 80, 40, ${Math.random() * 0.12})`;
      g.fillRect(Math.random() * 128, Math.random() * 160, 2, 2);
    }
    // Marge rouge et lignes de compte.
    g.strokeStyle = 'rgba(140, 20, 20, 0.5)';
    g.beginPath();
    g.moveTo(18, 0);
    g.lineTo(18, 160);
    g.moveTo(96, 0);
    g.lineTo(96, 160);
    g.stroke();
    for (let y = 14; y < 160; y += 9) {
      g.strokeStyle = 'rgba(60, 50, 90, 0.18)';
      g.beginPath();
      g.moveTo(4, y);
      g.lineTo(124, y);
      g.stroke();
      // Un nom griffonné, une somme ; certains sont rayés à l'encre rouge : remboursés à leur façon.
      g.strokeStyle = 'rgba(30, 20, 15, 0.8)';
      g.beginPath();
      let x = 22 + ((y * 7 + seed) % 5);
      g.moveTo(x, y - 3);
      const end = 60 + ((y * 13 + seed) % 30);
      while (x < end) {
        x += 2 + Math.random() * 2;
        g.lineTo(x, y - 2 - Math.random() * 4);
      }
      g.stroke();
      g.fillStyle = 'rgba(30, 20, 15, 0.8)';
      g.font = '7px monospace';
      g.fillText(String(100 + ((y * 37 + seed * 11) % 9000)), 99, y - 1);
      if ((y + seed) % 3 === 0) {
        g.strokeStyle = 'rgba(150, 10, 10, 0.85)';
        g.lineWidth = 1.5;
        g.beginPath();
        g.moveTo(20, y - 4);
        g.lineTo(end + 4, y - 3);
        g.stroke();
        g.lineWidth = 1;
      }
    }
    // Une empreinte de pouce sanglante dans le coin.
    g.fillStyle = 'rgba(120, 8, 8, 0.6)';
    g.beginPath();
    g.ellipse(104, 140, 8, 11, 0.3, 0, Math.PI * 2);
    g.fill();
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  };
  return { left: draw(3), right: draw(8) };
}
