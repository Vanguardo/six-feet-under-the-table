import * as THREE from 'three';
import { ps1ify } from './render/ps1';
import { grimeTexture, repeated, woodTexture } from './render/textures';
import type { Sfx } from './sfx';

/**
 * L'imprimante à ticket, posée sur une caisse à droite de la table : tout ce que le jeu a à dire
 * s'imprime sur un ticket de caisse matriciel. À côté, les pièces du joueur, empilées pour de vrai.
 */

export interface TicketLine {
  left: string;
  right?: string;
  kind?: 'title' | 'sep' | 'warn' | 'big' | 'small';
}

const MAX_LINES = 40;
const LINE_PX = 18;
const CANVAS_W = 256;
const PAPER_W = 2.5;
/** Hauteur d'une ligne sur le papier, en unités du monde. */
const LINE_H = (PAPER_W / CANVAS_W) * LINE_PX;
const PRINT_RATE = 7; // lignes par seconde
/** Avant de réimprimer, on laisse à la caméra le temps de se pencher. */
const REPRINT_DELAY = 0.9;
const COIN_STACK = 10;
const MAX_COINS = 60;

export class Printer {
  readonly root = new THREE.Group();
  private readonly canvas = document.createElement('canvas');
  private readonly texture: THREE.CanvasTexture;
  private readonly paper: THREE.Mesh;
  private readonly paperPivot = new THREE.Group();
  private readonly paperMat: THREE.MeshStandardMaterial;
  private readonly led = new THREE.MeshBasicMaterial({ color: 0x30ff40 });
  private readonly coins: THREE.Mesh[] = [];
  private readonly coinGeo = new THREE.CylinderGeometry(0.46, 0.46, 0.13, 10);
  private readonly coinMat = new THREE.MeshStandardMaterial({ color: 0xc9a03a, metalness: 0.85, roughness: 0.35, map: grimeTexture() });
  private lines: TicketLine[] = [];
  private key = '';
  /** Lignes déjà sorties de la fente (animées). */
  private printed = 0;
  private target = 0;
  private glow = false;
  private wait = 0;
  /** Une lueur chaude au-dessus de la caisse : le ticket et les pièces doivent se lire. */
  private readonly lamp = new THREE.PointLight(0xffc080, 16, 9, 1.5);
  private clock = 0;

  constructor(
    scene: THREE.Scene,
    private readonly sfx: Sfx,
  ) {
    this.root.position.set(13.1, 0, 2.2);
    this.root.rotation.y = -0.55; // tourné vers le joueur
    this.buildCrate();
    this.lamp.position.set(-0.6, 4.2, 3.2);
    this.root.add(this.lamp);
    this.buildPrinter();

    this.canvas.width = CANVAS_W;
    this.canvas.height = MAX_LINES * LINE_PX;
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.texture.magFilter = THREE.LinearFilter;
    this.texture.minFilter = THREE.LinearFilter;
    this.paperMat = new THREE.MeshStandardMaterial({
      map: this.texture,
      emissiveMap: this.texture,
      emissive: 0x403830,
      roughness: 0.95,
      side: THREE.DoubleSide,
    });
    const geo = new THREE.PlaneGeometry(PAPER_W, 1).translate(0, 0.5, 0);
    this.paper = new THREE.Mesh(geo, this.paperMat);
    this.paper.castShadow = true;
    // Le papier sort de la fente et se cambre vers le joueur.
    this.paperPivot.position.set(0, 1.42, 0.15);
    this.paperPivot.rotation.x = -0.32;
    this.paperPivot.add(this.paper);
    this.root.add(this.paperPivot);
    this.setPaperHeight(0);

    ps1ify(this.root);
    scene.add(this.root);
  }

  private buildCrate() {
    const wood = new THREE.MeshStandardMaterial({ map: repeated(woodTexture(true), 1, 1), color: 0x9a8070, roughness: 0.95 });
    const crate = new THREE.Mesh(new THREE.BoxGeometry(4.2, 10.6, 5.2), wood);
    crate.position.set(-0.3, -5.3, 1.0);
    crate.receiveShadow = true;
    this.root.add(crate);
  }

  private buildPrinter() {
    const plastic = new THREE.MeshStandardMaterial({ color: 0x8a8270, map: grimeTexture(), roughness: 0.8, flatShading: true });
    const dark = new THREE.MeshStandardMaterial({ color: 0x2a2620, roughness: 0.9, flatShading: true });
    const add = (geo: THREE.BufferGeometry, mat: THREE.Material, pos: [number, number, number], rot: [number, number, number] = [0, 0, 0]) => {
      const m = new THREE.Mesh(geo, mat);
      m.position.set(...pos);
      m.rotation.set(...rot);
      m.castShadow = m.receiveShadow = true;
      this.root.add(m);
      return m;
    };
    // Corps, capot incliné, fente, rouleau de papier visible à l'arrière.
    add(new THREE.BoxGeometry(3.0, 1.0, 2.2), plastic, [0, 0.5, 0]);
    add(new THREE.BoxGeometry(3.0, 0.35, 1.2), plastic, [0, 1.15, -0.45], [-0.25, 0, 0]);
    add(new THREE.BoxGeometry(2.7, 0.06, 0.12), dark, [0, 1.36, 0.15]);
    add(new THREE.CylinderGeometry(0.42, 0.42, 2.5, 10), new THREE.MeshStandardMaterial({ color: 0xe0d8c0, roughness: 1 }), [0, 1.2, -0.75], [0, 0, Math.PI / 2]);
    // Barre de découpe en dents de scie.
    add(new THREE.BoxGeometry(2.8, 0.05, 0.08), new THREE.MeshStandardMaterial({ color: 0x8a8a8a, metalness: 0.8, roughness: 0.3 }), [0, 1.4, 0.24]);
    // Bouton et voyant.
    add(new THREE.BoxGeometry(0.3, 0.12, 0.3), dark, [1.1, 1.02, 0.85]);
    add(new THREE.SphereGeometry(0.07, 6, 4), this.led, [0.6, 1.03, 0.9]);
    // Câble qui pend dans le noir.
    add(new THREE.CylinderGeometry(0.04, 0.04, 3, 4), dark, [-1.3, -0.9, -0.9], [0.2, 0, 0.1]);
  }

  /** Point à regarder pour lire le ticket, et d'où le regarder. */
  focus(): { look: THREE.Vector3; from: THREE.Vector3 } {
    this.root.updateMatrixWorld(true);
    const h = Math.max(this.target, 12) * LINE_H;
    const look = this.paperPivot.localToWorld(new THREE.Vector3(0, h * 0.5, 0));
    const from = this.paperPivot.localToWorld(new THREE.Vector3(0, h * 0.5, 4.2 + h * 0.4));
    return { look, from };
  }

  /** Le ticket est-il sous la souris ? */
  pick(raycaster: THREE.Raycaster) {
    return raycaster.intersectObject(this.paper, false).length > 0;
  }

  /** Suit la grande ampoule. */
  setLight(level: number) {
    this.lamp.intensity = 16 * level;
  }

  /** Le tutoriel fait luire le ticket : c'est là qu'on valide la main. */
  setGlow(on: boolean) {
    this.glow = on;
  }

  /**
   * Contenu complet du ticket. `reprint` : le ticket est arraché et réimprimé depuis le début
   * (nouvelle échéance) ; sinon seules les lignes nouvelles sortent de la fente.
   */
  setContent(lines: TicketLine[], reprint = false) {
    const key = JSON.stringify(lines);
    if (key === this.key && !reprint) return;
    this.key = key;
    this.lines = lines.slice(0, MAX_LINES);
    this.draw();
    if (reprint) {
      this.printed = 0;
      this.wait = REPRINT_DELAY;
      this.setPaperHeight(0);
    }
    this.target = this.lines.length;
    if (this.printed > this.target) this.printed = this.target;
  }

  get printing() {
    return this.printed < this.target;
  }

  /** Temps qu'il faut pour sortir tout le ticket. */
  get printTime() {
    return this.wait + (this.target - this.printed) / PRINT_RATE;
  }

  private coinLocal(i: number) {
    const stack = Math.floor(Math.min(i, MAX_COINS - 1) / COIN_STACK);
    const level = i % COIN_STACK;
    return new THREE.Vector3(-1.6 + (stack % 3) * 1.0, 0.07 + level * 0.135, 2.1 + Math.floor(stack / 3) * 1.0);
  }

  /** Où se pose la i-ème pièce de la pile, dans le monde. */
  coinWorld(i: number) {
    this.root.updateMatrixWorld(true);
    return this.root.localToWorld(this.coinLocal(i));
  }

  /** Les pièces du joueur, en piles de dix. */
  setCoins(n: number, drop = true) {
    const count = Math.min(MAX_COINS, Math.max(0, n));
    while (this.coins.length < count) {
      const i = this.coins.length;
      const coin = new THREE.Mesh(this.coinGeo, this.coinMat);
      const lift = drop ? 1.5 : 0;
      coin.position.copy(this.coinLocal(i)).add(new THREE.Vector3(0, lift, 0));
      coin.rotation.y = Math.random() * Math.PI;
      coin.userData.dropFrom = lift;
      coin.castShadow = true;
      ps1ify(coin);
      this.root.add(coin);
      this.coins.push(coin);
    }
    while (this.coins.length > count) this.root.remove(this.coins.pop()!);
  }

  update(dt: number) {
    this.clock += dt;
    if (this.wait > 0) this.wait -= dt;
    else if (this.printed < this.target) {
      const before = Math.floor(this.printed);
      this.printed = Math.min(this.target, this.printed + dt * PRINT_RATE);
      if (Math.floor(this.printed) !== before) this.chatter();
      this.setPaperHeight(this.printed);
    }
    // Les pièces neuves tombent sur leur pile.
    for (const c of this.coins) {
      const d = c.userData.dropFrom as number;
      if (d > 0) {
        c.userData.dropFrom = Math.max(0, d - dt * 6);
        c.position.y += (c.userData.dropFrom - d);
        if (c.userData.dropFrom === 0) this.sfx.tone(1900 + Math.random() * 300, 0.04, 0.08, 'square');
      }
    }
    const pulse = this.glow ? 0.5 + 0.5 * Math.sin(this.clock * 6) : 0;
    this.paperMat.emissive.setRGB(0.17 + pulse * 0.45, 0.15 + pulse * 0.35, 0.13 + pulse * 0.1);
    this.led.color.setHex(this.printing || Math.sin(this.clock * 3) > 0.9 ? 0xffb030 : 0x30ff40);
  }

  /** Le bruit d'une tête matricielle qui frappe une ligne. */
  private chatter() {
    for (let k = 0; k < 4; k++) this.sfx.burst({ type: 'bandpass', freq: 2400 + k * 180, q: 4, duration: 0.025, volume: 0.22, delay: k * 0.022 });
  }

  private setPaperHeight(lines: number) {
    const h = Math.max(0.001, lines * LINE_H);
    this.paper.scale.y = h;
    this.paper.visible = lines > 0.05;
    // On ne montre que la part du canevas déjà imprimée, en partant du haut.
    const frac = lines / MAX_LINES;
    this.texture.repeat.set(1, frac);
    this.texture.offset.set(0, 1 - frac);
  }

  private draw() {
    const g = this.canvas.getContext('2d')!;
    g.fillStyle = '#e4dccb';
    g.fillRect(0, 0, CANVAS_W, this.canvas.height);
    // Papier thermique un peu sale.
    for (let i = 0; i < 160; i++) {
      g.fillStyle = `rgba(90, 70, 40, ${Math.random() * 0.08})`;
      g.fillRect(Math.random() * CANVAS_W, Math.random() * this.canvas.height, 2, 2);
    }
    this.lines.forEach((line, i) => {
      const y = i * LINE_PX + LINE_PX * 0.72;
      g.fillStyle = line.kind === 'warn' ? '#8a0c0c' : '#1e1812';
      if (line.kind === 'sep') {
        g.fillStyle = '#4a4036';
        for (let x = 10; x < CANVAS_W - 10; x += 8) g.fillRect(x, y - 5, 4, 2);
        return;
      }
      const size = line.kind === 'big' ? 17 : line.kind === 'small' ? 12 : 14;
      g.font = `${line.kind === 'title' || line.kind === 'big' ? 'bold ' : ''}${size}px "Courier New", monospace`;
      if (line.kind === 'title') {
        g.textAlign = 'center';
        g.fillText(line.left, CANVAS_W / 2, y);
        g.textAlign = 'left';
        return;
      }
      g.textAlign = 'left';
      g.fillText(line.left, 12, y);
      if (line.right !== undefined) {
        g.textAlign = 'right';
        g.fillText(line.right, CANVAS_W - 12, y);
        g.textAlign = 'left';
      }
    });
    this.texture.needsUpdate = true;
  }

  /** Nouvelle run : ticket arraché, pièces ramassées. */
  reset() {
    this.key = '';
    this.lines = [];
    this.printed = this.target = 0;
    this.setPaperHeight(0);
    this.setCoins(0);
  }
}
