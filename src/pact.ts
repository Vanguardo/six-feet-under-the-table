import * as THREE from 'three';
import type { Creditor } from './creditor/creditor';
import { PAPER_DEPTH } from './creditor/creditor';
import { Hand } from './creditor/hand';
import { ps1ify } from './render/ps1';
import { grimeTexture, skinTexture } from './render/textures';
import { BODY_PARTS, type BodyPartId } from './rules/body';
import type { Sfx } from './sfx';

/** Effets d'image que la mise en scène déclenche. */
export interface PactFx {
  jolt(amount: number): void;
  /** Le joueur se penche sur un point de la table, ou se rassoit (`null`). */
  lean(point: THREE.Vector3 | null): void;
  tear(amount: number): void;
  aberration(amount: number): void;
}

// La feuille : 7 × 4,6 unités, dessinée à 100 px par unité.
const PAPER_W = 7;
const PX = 100;
const CW = PAPER_W * PX;
const CH = PAPER_DEPTH * PX;
// Elle part de la planche du créancier et vient se poser devant le joueur.
const PAPER_FROM = new THREE.Vector3(0, 0.83, -9);
const PAPER_TO = new THREE.Vector3(0, 0.02, 4.4);
const INK = '#3a0808';

/** Silhouettes des parties du corps, dessinées dans un carré de 100 × 100. */
const ICONS: Record<BodyPartId, (g: CanvasRenderingContext2D) => void> = {
  doigt: (g) => {
    g.fill(new Path2D('M40 24 A10 10 0 0 1 60 24 V70 A10 10 0 0 1 40 70 Z'));
    g.fillStyle = '#d8c8a8';
    g.fill(new Path2D('M43 22 A7 7 0 0 1 57 22 V30 H43 Z'));
  },
  dent: (g) => g.fill(new Path2D('M30 30 Q50 14 70 30 L66 58 Q62 80 56 60 L50 50 L44 60 Q38 80 34 58 Z')),
  oreille: (g) => {
    g.lineWidth = 7;
    g.stroke(new Path2D('M58 16 C30 14 26 48 40 58 C46 64 42 78 52 82 C64 84 74 60 72 40 C70 24 64 18 58 16 Z M52 34 C46 36 46 48 52 50'));
  },
  langue: (g) => g.fill(new Path2D('M30 26 L70 26 L70 52 Q70 82 50 82 Q30 82 30 52 Z')),
  oeil: (g) => {
    g.fill(new Path2D('M14 48 Q50 10 86 48 Q50 86 14 48 Z'));
    g.fillStyle = '#d8c8a8';
    g.beginPath();
    g.arc(50, 48, 14, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = INK;
    g.beginPath();
    g.arc(50, 48, 6, 0, Math.PI * 2);
    g.fill();
  },
  main: (g) => g.fill(new Path2D('M28 48 H72 V80 H28 Z M28 14 H37 V50 H28 Z M40 10 H49 V50 H40 Z M52 12 H61 V50 H52 Z M64 20 H72 V50 H64 Z M12 50 H30 V59 H12 Z')),
  coeur: (g) => g.fill(new Path2D('M50 82 C20 60 14 40 26 28 C36 18 48 24 50 34 C52 24 64 18 74 28 C86 40 80 60 50 82 Z')),
};

interface Zone {
  x: number;
  y: number;
  w: number;
  h: number;
  part: BodyPartId | 'refus';
}

/** Le contrat : un papier taché, des silhouettes, de la place pour un pouce. */
class ContractPaper {
  readonly mesh: THREE.Mesh;
  readonly zones: Zone[] = [];
  private readonly canvas = document.createElement('canvas');
  private readonly texture: THREE.CanvasTexture;
  private readonly stains: [number, number, number][] = [];
  hovered = -1;
  private stamp: Zone | null = null;

  constructor(readonly options: BodyPartId[]) {
    this.canvas.width = CW;
    this.canvas.height = CH;
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(PAPER_W, PAPER_DEPTH),
      // Teinte sombre : sous l'ampoule, un papier clair serait brûlé par le bloom.
      new THREE.MeshStandardMaterial({ map: this.texture, color: 0x6e6658, roughness: 1, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2 }),
    );
    this.mesh.rotation.set(-Math.PI / 2, 0, (Math.random() - 0.5) * 0.08);
    this.mesh.receiveShadow = true;
    for (let i = 0; i < 9; i++) this.stains.push([Math.random() * CW, Math.random() * CH, 10 + Math.random() * 40]);
    const n = options.length;
    const w = 190;
    const gap = 26;
    const x0 = (CW - (n * w + (n - 1) * gap)) / 2;
    options.forEach((part, i) => this.zones.push({ x: x0 + i * (w + gap), y: 112, w, h: 230, part }));
    this.zones.push({ x: CW - 150, y: CH - 62, w: 120, h: 42, part: 'refus' });
    this.draw();
  }

  draw() {
    const g = this.canvas.getContext('2d')!;
    g.fillStyle = '#d6c6a2';
    g.fillRect(0, 0, CW, CH);
    // Papier vieilli : taches, auréoles, bords plus sombres.
    for (const [x, y, r] of this.stains) {
      const grad = g.createRadialGradient(x, y, 0, x, y, r);
      grad.addColorStop(0, 'rgba(110, 70, 30, 0.22)');
      grad.addColorStop(1, 'rgba(110, 70, 30, 0)');
      g.fillStyle = grad;
      g.fillRect(x - r, y - r, r * 2, r * 2);
    }
    const edge = g.createRadialGradient(CW / 2, CH / 2, CH * 0.3, CW / 2, CH / 2, CW * 0.62);
    edge.addColorStop(0, 'rgba(60, 35, 15, 0)');
    edge.addColorStop(1, 'rgba(60, 35, 15, 0.45)');
    g.fillStyle = edge;
    g.fillRect(0, 0, CW, CH);

    g.fillStyle = '#1a0e08';
    g.textAlign = 'center';
    g.font = 'bold 44px "Courier New", monospace';
    g.fillText('C O N T R A T', CW / 2, 56);
    g.font = '18px "Courier New", monospace';
    g.fillText("L'échéance est payée. En contrepartie, le débiteur cède :", CW / 2, 92);

    this.zones.forEach((z, i) => {
      if (z.part === 'refus') {
        g.strokeStyle = i === this.hovered ? '#8a1010' : '#5a3a1e';
        g.lineWidth = 2;
        g.strokeRect(z.x, z.y, z.w, z.h);
        g.fillStyle = i === this.hovered ? '#8a1010' : '#5a3a1e';
        g.font = 'bold 20px "Courier New", monospace';
        g.fillText('Refuser', z.x + z.w / 2, z.y + 28);
        return;
      }
      // Cadre pointillé ; la zone survolée se teinte de rouge.
      if (i === this.hovered) {
        g.fillStyle = 'rgba(140, 20, 20, 0.22)';
        g.fillRect(z.x, z.y, z.w, z.h);
      }
      g.setLineDash([6, 5]);
      g.strokeStyle = '#5a3a1e';
      g.lineWidth = 2;
      g.strokeRect(z.x, z.y, z.w, z.h);
      g.setLineDash([]);
      g.save();
      g.translate(z.x + z.w / 2 - 55, z.y + 12);
      g.scale(1.1, 1.1);
      g.fillStyle = INK;
      g.strokeStyle = INK;
      ICONS[z.part](g);
      g.restore();
      g.fillStyle = '#1a0e08';
      g.font = 'bold 20px "Courier New", monospace';
      g.fillText(BODY_PARTS[z.part].name, z.x + z.w / 2, z.y + 150);
      g.font = '15px "Courier New", monospace';
      wrap(g, BODY_PARTS[z.part].effect, z.x + z.w / 2, z.y + 176, z.w - 16, 18);
    });

    g.fillStyle = '#3a2a1a';
    g.font = 'italic 16px "Courier New", monospace';
    g.fillText('Appose ton pouce sur ce que tu donnes.', CW / 2 - 60, CH - 34);
    if (this.stamp) drawThumbprint(g, this.stamp.x + this.stamp.w / 2, this.stamp.y + 70);
    this.texture.needsUpdate = true;
  }

  /** Zone sous le rayon (index dans `zones`), ou -1. */
  pick(raycaster: THREE.Raycaster): number {
    const hit = raycaster.intersectObject(this.mesh, false)[0];
    if (!hit?.uv) return -1;
    const x = hit.uv.x * CW;
    const y = (1 - hit.uv.y) * CH;
    return this.zones.findIndex((z) => x >= z.x && x <= z.x + z.w && y >= z.y && y <= z.y + z.h);
  }

  setHover(i: number) {
    if (i === this.hovered) return;
    this.hovered = i;
    this.draw();
  }

  /** Point monde au centre de la silhouette d'une zone (là où le pouce appuie). */
  zonePoint(i: number) {
    const z = this.zones[i];
    const local = new THREE.Vector3((z.x + z.w / 2) / PX - PAPER_W / 2, PAPER_DEPTH / 2 - (z.y + 70) / PX, 0);
    return this.mesh.localToWorld(local);
  }

  /** L'empreinte du pouce, en sang. */
  sign(i: number) {
    this.stamp = this.zones[i];
    this.hovered = -1;
    this.draw();
  }
}

function wrap(g: CanvasRenderingContext2D, text: string, x: number, y: number, max: number, line: number) {
  const words = text.split(' ');
  let current = '';
  for (const w of words) {
    const test = current ? `${current} ${w}` : w;
    if (g.measureText(test).width > max && current) {
      g.fillText(current, x, y);
      current = w;
      y += line;
    } else current = test;
  }
  g.fillText(current, x, y);
}

/** Empreinte de pouce : ovale de sang, crêtes concentriques, bavures. */
function drawThumbprint(g: CanvasRenderingContext2D, x: number, y: number) {
  g.save();
  g.translate(x, y);
  g.rotate(-0.25);
  g.fillStyle = 'rgba(120, 6, 6, 0.85)';
  g.beginPath();
  g.ellipse(0, 0, 34, 46, 0, 0, Math.PI * 2);
  g.fill();
  g.strokeStyle = 'rgba(60, 0, 0, 0.8)';
  g.lineWidth = 2.5;
  for (let r = 6; r < 44; r += 6) {
    g.beginPath();
    g.ellipse(2, 4, r * 0.72, r, 0.1, Math.PI * 0.1, Math.PI * 1.9);
    g.stroke();
  }
  g.fillStyle = 'rgba(120, 6, 6, 0.7)';
  for (let i = 0; i < 6; i++) g.fillRect(-30 + Math.random() * 60, 40 + Math.random() * 18, 3, 4 + Math.random() * 10);
  g.restore();
}

/**
 * Le pouce du joueur : il entre par le bas de l'image, appuie sur le papier, repart.
 * (Premier morceau du joueur à l'écran ; ses mains complètes viendront ensuite.)
 */
class PlayerThumb {
  readonly root = new THREE.Group();
  private t = -1;
  private target = new THREE.Vector3();
  private onPress: (() => void) | null = null;
  private onDone: (() => void) | null = null;
  private pressed = false;

  constructor(scene: THREE.Scene) {
    const skin = new THREE.MeshStandardMaterial({ map: skinTexture(), color: 0xe0c0a8, roughness: 0.7, flatShading: true });
    const nail = new THREE.MeshStandardMaterial({ color: 0xd8c0b0, map: grimeTexture(), roughness: 0.4 });
    const sleeve = new THREE.MeshStandardMaterial({ color: 0x2a2420, roughness: 1, flatShading: true });
    // Le pouce pointe vers +Z ; le poing et la manche sont derrière.
    const thumb = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.3, 1.5, 6).rotateX(Math.PI / 2), skin);
    thumb.position.z = 0.75;
    const tip = new THREE.Mesh(new THREE.SphereGeometry(0.25, 6, 5), skin);
    tip.position.z = 1.5;
    const nailMesh = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.06, 0.4), nail);
    nailMesh.position.set(0, 0.22, 1.35);
    // Poing fermé : dos de la main arrondi, quatre doigts repliés sous le pouce.
    const back = new THREE.Mesh(new THREE.SphereGeometry(0.7, 7, 5), skin);
    back.scale.set(1, 0.65, 1.05);
    back.position.set(-0.55, 0.05, -0.35);
    const knuckle = new THREE.MeshStandardMaterial({ map: skinTexture(), color: 0xc8a890, roughness: 0.7, flatShading: true });
    const fingers: THREE.Mesh[] = [];
    for (let i = 0; i < 4; i++) {
      const f = new THREE.Mesh(new THREE.CapsuleGeometry(0.17, 0.35, 2, 5).rotateZ(Math.PI / 2), knuckle);
      f.position.set(-0.55, -0.32, 0.18 - i * 0.29);
      fingers.push(f);
    }
    const cuff = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.55, 0.35, 7).rotateX(Math.PI / 2), sleeve);
    cuff.position.set(-0.55, -0.05, -1.05);
    const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.5, 5, 7).rotateX(Math.PI / 2), sleeve);
    arm.position.set(-0.55, -0.05, -3.6);
    this.root.add(thumb, tip, nailMesh, back, ...fingers, cuff, arm);
    this.root.traverse((o) => ((o as THREE.Mesh).castShadow = true));
    ps1ify(this.root);
    this.root.visible = false;
    scene.add(this.root);
  }

  press(target: THREE.Vector3, onPress: () => void, onDone: () => void) {
    this.target.copy(target);
    this.onPress = onPress;
    this.onDone = onDone;
    this.pressed = false;
    this.t = 0;
    this.root.visible = true;
  }

  update(dt: number) {
    if (this.t < 0) return;
    this.t += dt;
    const t = this.t;
    // Le pouce pointe vers le bas et vers l'avant : sa pointe touche la cible.
    const pitch = 0.95;
    const reach = new THREE.Vector3(0, -Math.sin(pitch) * 1.75, Math.cos(pitch) * 1.75);
    const touching = this.target.clone().sub(reach);
    const above = touching.clone().add(new THREE.Vector3(0, 0.8, 0.3));
    const away = touching.clone().add(new THREE.Vector3(1.5, 6, 9));
    const s = (a: number, b: number) => Math.min(1, Math.max(0, (t - a) / (b - a)));
    const e = (k: number) => k * k * (3 - 2 * k);
    let pos: THREE.Vector3;
    if (t < 0.5) pos = away.clone().lerp(above, e(s(0, 0.5)));
    else if (t < 0.7) pos = above.clone().lerp(touching, e(s(0.5, 0.7)));
    else if (t < 1.05) pos = touching.clone().add(new THREE.Vector3(0, -0.04 * Math.sin((t - 0.7) * 30), 0));
    else pos = touching.clone().lerp(away, e(s(1.05, 1.5)));
    if (!this.pressed && t >= 0.7) {
      this.pressed = true;
      this.onPress?.();
    }
    this.root.position.copy(pos);
    this.root.rotation.set(pitch, -0.15, 0.2, 'YXZ');
    if (t >= 1.5) {
      this.t = -1;
      this.root.visible = false;
      const done = this.onDone;
      this.onDone = null;
      done?.();
    }
  }
}

interface Timed {
  at: number;
  fn: () => void;
}

/**
 * Le pacte : le créancier glisse un contrat sur la table, le joueur signe de son pouce,
 * puis la coupure. Ce qui est pris finit dans un bocal ; le sang reste sur le feutre.
 */
export class PactScene {
  private readonly blackout = document.getElementById('blackout')!;
  private readonly bloodScreen = document.getElementById('bloodscreen')!;
  private timeline: Timed[] = [];
  private clock = 0;
  private readonly jars = new Map<BodyPartId, THREE.Group>();
  private readonly stains: THREE.Mesh[] = [];
  private readonly trophies: THREE.Object3D[] = [];
  private paper: ContractPaper | null = null;
  private readonly thumb: PlayerThumb;
  /** Le contrat est posé devant le joueur et attend une signature. */
  private waiting: { onSign: (part: BodyPartId) => void; onRefuse: () => void } | null = null;

  constructor(
    private readonly scene: THREE.Scene,
    private readonly sfx: Sfx,
    private readonly fx: PactFx,
    private readonly creditor: Creditor,
  ) {
    this.thumb = new PlayerThumb(scene);
  }

  get busy() {
    return this.timeline.length > 0;
  }

  /** Le contrat attend une signature : le jeu transmet survols et clics. */
  get awaitingSignature() {
    return this.waiting !== null;
  }

  // ---------------------------------------------------------------- contrat

  /** Le créancier fait glisser ses conditions jusqu'au joueur. */
  offer(options: BodyPartId[], onSign: (part: BodyPartId) => void, onRefuse: () => void) {
    this.removePaper();
    const paper = new ContractPaper(options);
    this.paper = paper;
    paper.mesh.position.copy(PAPER_FROM);
    this.scene.add(paper.mesh);
    this.sfx.burst({ type: 'bandpass', freq: 1200, freqEnd: 700, q: 0.8, duration: 1.3, volume: 0.25 }); // papier qui glisse
    this.creditor.slidePaper(PAPER_FROM, PAPER_TO, 1.5, (c) => paper.mesh.position.copy(c), () => {
      this.waiting = { onSign, onRefuse };
      // On se penche pour lire ce qu'il demande.
      this.fx.lean(PAPER_TO);
    });
  }

  /** Survol du contrat : la silhouette visée se teinte. Renvoie vrai si une zone est visée. */
  hover(raycaster: THREE.Raycaster): boolean {
    if (!this.waiting || !this.paper) return false;
    const i = this.paper.pick(raycaster);
    this.paper.setHover(i);
    return i >= 0;
  }

  /** Clic sur le contrat : signer d'un pouce, ou refuser. */
  click(raycaster: THREE.Raycaster) {
    const paper = this.paper;
    const waiting = this.waiting;
    if (!paper || !waiting) return;
    const i = paper.pick(raycaster);
    if (i < 0) return;
    const zone = paper.zones[i];
    this.waiting = null;
    paper.setHover(-1);
    if (zone.part === 'refus') {
      this.fx.lean(null);
      // Il reprend son papier, sans un mot.
      this.creditor.slidePaper(PAPER_TO, PAPER_FROM, 1.0, (c) => paper.mesh.position.copy(c), () => {
        this.removePaper();
        waiting.onRefuse();
      });
      return;
    }
    const part = zone.part;
    this.thumb.press(
      paper.zonePoint(i),
      () => {
        paper.sign(i);
        this.sfx.burst({ type: 'lowpass', freq: 600, duration: 0.25, volume: 0.6 }); // le pouce sur le papier
      },
      () => waiting.onSign(part),
    );
  }

  private removePaper() {
    if (this.paper) this.scene.remove(this.paper.mesh);
    this.paper = null;
    this.waiting = null;
  }

  // ---------------------------------------------------------------- mise en scène

  /** Noir, l'outil, la coupure, le cri étouffé ; puis la lumière revient sur le sang. */
  play(part: BodyPartId, onDone: () => void) {
    const cut = part === 'coeur' ? 1.4 : 1.0;
    this.at(0, () => this.blackout.classList.add('show'));
    this.at(0.3, () => {
      this.removePaper();
      this.fx.lean(null);
    });
    this.at(0.2, () => this.toolSounds(part, cut - 0.2));
    this.at(cut, () => {
      this.fx.tear(1);
      this.fx.aberration(0.014);
      this.fx.jolt(1.3);
      this.blackout.classList.add('red');
    });
    this.at(cut + 0.12, () => this.blackout.classList.remove('red'));
    this.at(cut + 0.3, () => this.scream(part));
    this.at(cut + 2.0, () => {
      this.addTrophy(part);
      this.addStain();
      this.blackout.classList.remove('show');
      this.bloodScreen.classList.remove('show');
      void this.bloodScreen.offsetWidth;
      this.bloodScreen.classList.add('show');
      this.breathing();
    });
    this.at(cut + 2.8, onDone);
  }

  private at(delay: number, fn: () => void) {
    this.timeline.push({ at: this.clock + delay, fn });
    this.timeline.sort((a, b) => a.at - b.at);
  }

  update(dt: number) {
    this.clock += dt;
    this.thumb.update(dt);
    while (this.timeline.length > 0 && this.clock >= this.timeline[0].at) this.timeline.shift()!.fn();
  }

  private toolSounds(part: BodyPartId, cutIn: number) {
    const s = this.sfx;
    const snip = (d: number) => {
      s.burst({ type: 'bandpass', freq: 5200, q: 3, duration: 0.06, volume: 0.9, delay: d });
      s.burst({ type: 'bandpass', freq: 3800, q: 4, duration: 0.05, volume: 0.6, delay: d + 0.07 });
    };
    const crunch = (d: number) => {
      s.burst({ type: 'lowpass', freq: 900, duration: 0.28, volume: 1, delay: d });
      s.toneAt(d, 130, 45, 0.32, 0.6);
    };
    const wet = (d: number, len = 0.45) => s.burst({ type: 'bandpass', freq: 480, freqEnd: 220, q: 5, duration: len, volume: 0.9, delay: d });
    switch (part) {
      case 'doigt':
        snip(cutIn - 0.02);
        crunch(cutIn);
        break;
      case 'dent':
        s.burst({ type: 'bandpass', freq: 1400, freqEnd: 700, q: 6, duration: cutIn, volume: 0.45 }); // la pince force
        s.burst({ type: 'bandpass', freq: 2600, q: 2, duration: 0.08, volume: 1, delay: cutIn });
        crunch(cutIn + 0.02);
        break;
      case 'oreille':
        s.burst({ type: 'bandpass', freq: 3000, freqEnd: 6500, q: 4, duration: 0.3, volume: 0.7, delay: cutIn - 0.1 });
        wet(cutIn + 0.15);
        break;
      case 'langue':
        snip(cutIn - 0.2);
        snip(cutIn);
        wet(cutIn + 0.1, 0.6);
        break;
      case 'oeil':
        wet(cutIn - 0.5, 0.9);
        s.burst({ type: 'bandpass', freq: 900, q: 8, duration: 0.06, volume: 1, delay: cutIn });
        break;
      case 'main':
        s.knock();
        s.burst({ type: 'lowpass', freq: 500, duration: 0.4, volume: 1, delay: cutIn });
        crunch(cutIn + 0.01);
        break;
      case 'coeur':
        wet(cutIn - 0.6, 1.2);
        // Le cœur bat encore dans la main du créancier, de plus en plus lentement.
        [0.3, 0.55, 1.25, 1.5, 2.4, 2.7, 3.9].forEach((t) => s.toneAt(cutIn + t, 62, 38, 0.16, 0.9));
        break;
    }
  }

  /** Cri étouffé, comme à travers des dents serrées. */
  private scream(part: BodyPartId) {
    if (part === 'coeur') return;
    this.sfx.burst({ type: 'bandpass', freq: 900, freqEnd: 650, q: 1.5, duration: 1.4, volume: 0.35 });
    this.sfx.toneAt(0, 340, 230, 1.3, 0.12, 'sawtooth');
  }

  private breathing() {
    [0, 0.9, 1.7, 2.6].forEach((d) => this.sfx.burst({ type: 'lowpass', freq: 700, duration: 0.55, volume: 0.25, delay: d }));
  }

  // ---------------------------------------------------------------- bocaux et sang

  private jar(part: BodyPartId): THREE.Group {
    const existing = this.jars.get(part);
    if (existing) return existing;
    const order: BodyPartId[] = ['doigt', 'dent', 'oreille', 'langue', 'oeil', 'coeur'];
    const g = new THREE.Group();
    g.position.set(-6 - order.indexOf(part) * 1.05, 0.8, -10.6);
    const glass = new THREE.MeshStandardMaterial({ color: 0xb8c8b0, transparent: true, opacity: 0.22, roughness: 0.1, depthWrite: false });
    const liquid = new THREE.MeshStandardMaterial({ color: 0x8a9a40, transparent: true, opacity: 0.35, emissive: 0x1a2008, depthWrite: false });
    const lid = new THREE.MeshStandardMaterial({ color: 0x3a3428, metalness: 0.6, roughness: 0.6 });
    const add = (geo: THREE.BufferGeometry, mat: THREE.Material, y: number) => {
      const m = new THREE.Mesh(geo, mat);
      m.position.y = y;
      g.add(m);
    };
    add(new THREE.CylinderGeometry(0.42, 0.42, 1.1, 10, 1, true), glass, 0.55);
    add(new THREE.CylinderGeometry(0.38, 0.38, 0.8, 10), liquid, 0.42);
    add(new THREE.CylinderGeometry(0.45, 0.45, 0.12, 10), lid, 1.14);
    ps1ify(g);
    this.scene.add(g);
    this.trophies.push(g);
    this.jars.set(part, g);
    return g;
  }

  private addTrophy(part: BodyPartId) {
    if (part === 'main') {
      // La main est trop grande pour un bocal : elle est posée à côté, paume en l'air.
      const hand = new Hand(true);
      hand.root.scale.setScalar(0.42);
      hand.root.position.set(-4.6, 0.95, -11);
      hand.root.rotation.set(0, 0.6, Math.PI);
      hand.curl.fill(0.55);
      hand.pose();
      ps1ify(hand.root);
      this.scene.add(hand.root);
      this.trophies.push(hand.root);
      return;
    }
    const jar = this.jar(part);
    const skin = new THREE.MeshStandardMaterial({ map: skinTexture(), roughness: 0.7, flatShading: true });
    let piece: THREE.Mesh;
    switch (part) {
      case 'doigt':
        piece = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.07, 0.42, 5), skin);
        break;
      case 'dent':
        piece = new THREE.Mesh(new THREE.ConeGeometry(0.07, 0.2, 5), new THREE.MeshStandardMaterial({ color: 0xe8e0c8 }));
        break;
      case 'oreille':
        piece = new THREE.Mesh(new THREE.TorusGeometry(0.15, 0.05, 4, 8, Math.PI * 1.5), skin);
        break;
      case 'langue':
        piece = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.06, 0.38), new THREE.MeshStandardMaterial({ color: 0x8a2a2a, roughness: 0.4 }));
        break;
      case 'oeil': {
        piece = new THREE.Mesh(new THREE.SphereGeometry(0.15, 8, 6), new THREE.MeshStandardMaterial({ color: 0xe8e0d0, roughness: 0.3 }));
        const iris = new THREE.Mesh(new THREE.CircleGeometry(0.07, 8), new THREE.MeshBasicMaterial({ color: 0x2a3a2a }));
        iris.position.z = 0.151;
        piece.add(iris);
        break;
      }
      default:
        piece = new THREE.Mesh(new THREE.SphereGeometry(0.24, 7, 6), new THREE.MeshStandardMaterial({ color: 0x6a0a0a, roughness: 0.35 }));
    }
    // Chaque morceau flotte à sa place dans le bocal, légèrement de travers.
    const n = jar.children.length - 3;
    piece.position.set(Math.cos(n * 2.4) * 0.18, 0.25 + (n % 4) * 0.13, Math.sin(n * 2.4) * 0.18);
    piece.rotation.set(Math.random() * 3, Math.random() * 3, Math.random() * 3);
    ps1ify(piece);
    jar.add(piece);
  }

  /** Une flaque de sang sur le feutre, côté joueur. Elle reste jusqu'à la fin de la run. */
  private addStain() {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 128;
    const g = canvas.getContext('2d')!;
    const blob = (x: number, y: number, r: number, a: number) => {
      const grad = g.createRadialGradient(x, y, 0, x, y, r);
      grad.addColorStop(0, `rgba(70, 4, 4, ${a})`);
      grad.addColorStop(0.7, `rgba(55, 3, 3, ${a * 0.9})`);
      grad.addColorStop(1, 'rgba(40, 2, 2, 0)');
      g.fillStyle = grad;
      g.beginPath();
      g.arc(x, y, r, 0, Math.PI * 2);
      g.fill();
    };
    blob(64, 64, 34, 0.95);
    for (let i = 0; i < 14; i++) blob(64 + (Math.random() - 0.5) * 90, 64 + (Math.random() - 0.5) * 90, 3 + Math.random() * 10, 0.9);
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    const mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(2.6, 2.6),
      new THREE.MeshStandardMaterial({ map: tex, transparent: true, roughness: 0.25, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 }),
    );
    mesh.rotation.set(-Math.PI / 2, 0, Math.random() * Math.PI * 2);
    mesh.position.set((Math.random() - 0.5) * 10, 0.012, 3 + Math.random() * 3);
    this.scene.add(mesh);
    this.stains.push(mesh);
  }

  /** Nouvelle run : bocaux vidés, feutre nettoyé. */
  reset() {
    for (const o of [...this.trophies, ...this.stains]) this.scene.remove(o);
    this.trophies.length = 0;
    this.stains.length = 0;
    this.jars.clear();
    this.timeline = [];
    this.removePaper();
    this.blackout.classList.remove('show', 'red');
    this.bloodScreen.classList.remove('show');
  }
}
