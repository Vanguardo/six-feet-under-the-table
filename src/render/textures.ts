import * as THREE from 'three';
import { Rng } from '../rules/rng';

/**
 * Textures dessinées par le code, en basse résolution et sans lissage : le grain PS1.
 * Graine fixe, pour que la cave soit la même à chaque partie.
 */

type Paint = (g: CanvasRenderingContext2D, size: number, rng: Rng) => void;

const cache = new Map<string, THREE.CanvasTexture>();

function make(key: string, size: number, paint: Paint): THREE.CanvasTexture {
  const cached = cache.get(key);
  if (cached) return cached;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const g = canvas.getContext('2d')!;
  paint(g, size, new Rng(hash(key)));
  const tex = new THREE.CanvasTexture(canvas);
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  cache.set(key, tex);
  return tex;
}

/** Copie qui partage l'image mais répète la texture autrement. */
export function repeated(tex: THREE.Texture, x: number, y: number): THREE.Texture {
  const t = tex.clone();
  t.repeat.set(x, y);
  t.needsUpdate = true;
  return t;
}

function hash(s: string) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

const rgb = (r: number, g: number, b: number, a = 1) => `rgba(${r | 0}, ${g | 0}, ${b | 0}, ${a})`;

/** Bruit de base : chaque pixel varie un peu autour de la couleur. */
function speckle(g: CanvasRenderingContext2D, size: number, rng: Rng, base: [number, number, number], amount: number) {
  const img = g.createImageData(size, size);
  for (let i = 0; i < size * size; i++) {
    const n = (rng.next() - 0.5) * amount;
    img.data[i * 4] = base[0] + n;
    img.data[i * 4 + 1] = base[1] + n;
    img.data[i * 4 + 2] = base[2] + n;
    img.data[i * 4 + 3] = 255;
  }
  g.putImageData(img, 0, 0);
}

function stain(g: CanvasRenderingContext2D, x: number, y: number, r: number, color: string) {
  const grad = g.createRadialGradient(x, y, 0, x, y, r);
  grad.addColorStop(0, color);
  grad.addColorStop(1, 'rgba(0, 0, 0, 0)');
  g.fillStyle = grad;
  g.beginPath();
  g.arc(x, y, r, 0, Math.PI * 2);
  g.fill();
}

// ---------------------------------------------------------------- bois

/** Planches : veines dans le sens de la longueur (axe U), nœuds, entailles. */
export function woodTexture(dark = false) {
  return make(`wood-${dark}`, 128, (g, size, rng) => {
    const base: [number, number, number] = dark ? [34, 21, 12] : [64, 38, 22];
    speckle(g, size, rng, base, 10);
    // Veines : lignes ondulées horizontales.
    for (let i = 0; i < 46; i++) {
      const y0 = rng.next() * size;
      const amp = 1 + rng.next() * 3;
      const freq = 0.02 + rng.next() * 0.05;
      const shade = rng.next() < 0.5 ? 0 : 255;
      g.strokeStyle = shade ? rgb(200, 150, 100, 0.08) : rgb(0, 0, 0, 0.22);
      g.lineWidth = 1;
      g.beginPath();
      for (let x = 0; x <= size; x += 4) g.lineTo(x, y0 + Math.sin(x * freq + i) * amp);
      g.stroke();
    }
    // Joints entre les planches.
    for (let y = 0; y < size; y += 32) {
      g.fillStyle = rgb(0, 0, 0, 0.55);
      g.fillRect(0, y, size, 1);
    }
    // Nœuds.
    for (let i = 0; i < 3; i++) {
      const x = rng.next() * size;
      const y = rng.next() * size;
      for (let r = 7; r > 1; r -= 2) {
        g.strokeStyle = rgb(10, 5, 2, 0.35);
        g.beginPath();
        g.ellipse(x, y, r * 1.8, r * 0.7, 0, 0, Math.PI * 2);
        g.stroke();
      }
    }
    // Entailles claires et éclats.
    for (let i = 0; i < 14; i++) {
      const x = rng.next() * size;
      const y = rng.next() * size;
      g.strokeStyle = rgb(170, 120, 80, 0.35);
      g.beginPath();
      g.moveTo(x, y);
      g.lineTo(x + (rng.next() - 0.5) * 18, y + (rng.next() - 0.5) * 6);
      g.stroke();
    }
  });
}

// ---------------------------------------------------------------- feutre

/** Feutre de jeu usé : taches de sang séché, brûlures de cigarette, zones râpées. */
export function feltTexture(red = false) {
  return make(`felt-${red}`, 256, (g, size, rng) => {
    speckle(g, size, rng, red ? [62, 12, 14] : [24, 52, 36], 14);
    // Usure : zones plus claires et râpées.
    for (let i = 0; i < 10; i++) stain(g, rng.next() * size, rng.next() * size, 20 + rng.next() * 40, red ? rgb(90, 40, 30, 0.18) : rgb(70, 90, 60, 0.16));
    if (red) return;
    // Sang séché : brun sombre, irrégulier, avec des éclaboussures autour.
    for (let i = 0; i < 6; i++) {
      const x = rng.next() * size;
      const y = rng.next() * size;
      for (let k = 0; k < 6; k++) stain(g, x + (rng.next() - 0.5) * 22, y + (rng.next() - 0.5) * 14, 4 + rng.next() * 11, rgb(45, 6, 4, 0.55));
      for (let k = 0; k < 10; k++) {
        g.fillStyle = rgb(50, 8, 6, 0.7);
        g.fillRect(x + (rng.next() - 0.5) * 50, y + (rng.next() - 0.5) * 40, 1 + rng.next() * 2, 1 + rng.next() * 2);
      }
    }
    // Brûlures de cigarette : cœur noir, auréole brune.
    for (let i = 0; i < 5; i++) {
      const x = rng.next() * size;
      const y = rng.next() * size;
      stain(g, x, y, 6, rgb(70, 45, 20, 0.6));
      g.fillStyle = rgb(8, 6, 4, 0.9);
      g.beginPath();
      g.arc(x, y, 1.6 + rng.next(), 0, Math.PI * 2);
      g.fill();
    }
  });
}

// ---------------------------------------------------------------- cuir

/** Cuir craquelé du gobelet. */
export function leatherTexture() {
  return make('leather', 128, (g, size, rng) => {
    speckle(g, size, rng, [92, 40, 26], 16);
    // Réseau de craquelures.
    for (let i = 0; i < 60; i++) {
      let x = rng.next() * size;
      let y = rng.next() * size;
      g.strokeStyle = rgb(12, 4, 2, 0.6);
      g.beginPath();
      g.moveTo(x, y);
      for (let k = 0; k < 4; k++) {
        x += (rng.next() - 0.5) * 16;
        y += (rng.next() - 0.5) * 16;
        g.lineTo(x, y);
      }
      g.stroke();
    }
    // Usure claire là où les doigts tiennent le gobelet.
    for (let i = 0; i < 8; i++) stain(g, rng.next() * size, size * (0.3 + rng.next() * 0.4), 12, rgb(120, 70, 50, 0.2));
  });
}

// ---------------------------------------------------------------- peau

/** Peau du créancier : pâle, marbrée, veinée. */
export function skinTexture() {
  return make('skin', 64, (g, size, rng) => {
    speckle(g, size, rng, [196, 184, 170], 14);
    // Marbrures grises et jaunâtres.
    for (let i = 0; i < 12; i++) stain(g, rng.next() * size, rng.next() * size, 5 + rng.next() * 10, rng.next() < 0.5 ? rgb(130, 140, 120, 0.3) : rgb(170, 150, 100, 0.25));
    // Veines bleu-vert, fines et ramifiées.
    for (let i = 0; i < 7; i++) {
      let x = rng.next() * size;
      let y = rng.next() * size;
      g.strokeStyle = rgb(70, 90, 110, 0.45);
      g.beginPath();
      g.moveTo(x, y);
      for (let k = 0; k < 6; k++) {
        x += (rng.next() - 0.5) * 10;
        y += rng.next() * 8;
        g.lineTo(x, y);
      }
      g.stroke();
    }
  });
}

// ---------------------------------------------------------------- cave

/** Briques humides, joints sombres, coulures. */
export function brickTexture() {
  return make('brick', 128, (g, size, rng) => {
    g.fillStyle = rgb(14, 11, 9);
    g.fillRect(0, 0, size, size);
    const rows = 8;
    const h = size / rows;
    const w = size / 4;
    for (let r = 0; r < rows; r++) {
      const offset = r % 2 ? w / 2 : 0;
      for (let c = -1; c < 5; c++) {
        const shade = 0.6 + rng.next() * 0.5;
        g.fillStyle = rgb(70 * shade, 36 * shade, 26 * shade);
        g.fillRect(c * w + offset + 1, r * h + 1, w - 2, h - 2);
        // Grain de la brique.
        for (let k = 0; k < 12; k++) {
          g.fillStyle = rgb(0, 0, 0, rng.next() * 0.3);
          g.fillRect(c * w + offset + rng.next() * w, r * h + rng.next() * h, 2, 1);
        }
      }
    }
    // Humidité : coulures verticales sombres et salpêtre clair.
    for (let i = 0; i < 9; i++) {
      const x = rng.next() * size;
      const grad = g.createLinearGradient(0, 0, 0, size);
      grad.addColorStop(0, rgb(0, 0, 0, 0.5));
      grad.addColorStop(1, rgb(0, 0, 0, 0));
      g.fillStyle = grad;
      g.fillRect(x, 0, 3 + rng.next() * 6, size * (0.4 + rng.next() * 0.6));
    }
    for (let i = 0; i < 6; i++) stain(g, rng.next() * size, size * 0.8 + rng.next() * size * 0.2, 14, rgb(120, 120, 100, 0.12));
  });
}

/** Sol de béton taché. */
export function floorTexture() {
  return make('floor', 128, (g, size, rng) => {
    speckle(g, size, rng, [26, 24, 22], 12);
    for (let i = 0; i < 10; i++) stain(g, rng.next() * size, rng.next() * size, 10 + rng.next() * 26, rgb(0, 0, 0, 0.35));
    for (let i = 0; i < 4; i++) stain(g, rng.next() * size, rng.next() * size, 8 + rng.next() * 10, rgb(40, 5, 3, 0.5));
    g.strokeStyle = rgb(0, 0, 0, 0.5);
    for (let i = 0; i < 6; i++) {
      g.beginPath();
      let x = rng.next() * size;
      let y = rng.next() * size;
      g.moveTo(x, y);
      for (let k = 0; k < 5; k++) {
        x += (rng.next() - 0.5) * 30;
        y += (rng.next() - 0.5) * 30;
        g.lineTo(x, y);
      }
      g.stroke();
    }
  });
}

/**
 * Crasse : gris clair taché, à multiplier par la couleur d'un objet (reliques, laiton).
 * Garde la teinte de l'objet, ajoute rouille, poussière et usure.
 */
export function grimeTexture() {
  return make('grime', 64, (g, size, rng) => {
    speckle(g, size, rng, [205, 200, 190], 40);
    for (let i = 0; i < 10; i++) stain(g, rng.next() * size, rng.next() * size, 3 + rng.next() * 8, rgb(90, 50, 25, 0.45));
    for (let i = 0; i < 6; i++) stain(g, rng.next() * size, rng.next() * size, 4 + rng.next() * 6, rgb(30, 25, 20, 0.4));
  });
}
