import * as THREE from 'three';
import { CUP_HEIGHT } from '../config';
import { repeated, woodTexture } from '../render/textures';
import { Hand, HAND_REACH } from './hand';
import { Smile, SMILE_Y } from './smile';

/** Sons et effets que le créancier déclenche ; fournis par le jeu. */
export interface CreditorFx {
  tap(): void;
  scratch(): void;
  clap(): void;
  slam(): void;
  /** Copeaux et sciure qui jaillissent d'un trou fraîchement creusé (position monde). */
  chips(at: THREE.Vector3): void;
  /** Papier qu'on déchire. */
  tear(): void;
}

interface Pose {
  position: THREE.Vector3;
  yaw: number;
  pitch: number;
  roll: number;
  curl: number[];
}

interface Action {
  duration: number;
  t: number;
  /** Modifie les poses désirées des deux mains. `t` va de 0 à 1. */
  apply(t: number, left: Pose, right: Pose): void;
  events: { at: number; fn: () => void; done?: boolean }[];
  /** Vitesse de suivi des mains : plus haut = mouvements secs. */
  stiffness: number;
  onEnd?: () => void;
  /** Si un autre geste coupe celui-ci : remettre le visage et l'ardoise en ordre. */
  interrupt?: () => void;
}

// Les mains reposent sur la planche du créancier, de l'autre côté de la table.
const PLANK_Y = 0.8;
const REST_RIGHT: Pose = { position: new THREE.Vector3(3.9, PLANK_Y + 0.1, -10.2), yaw: -0.25, pitch: 0, roll: 0, curl: [0.3, 0.3, 0.3, 0.3, 0.3] };
const REST_LEFT: Pose = { position: new THREE.Vector3(-3.9, PLANK_Y + 0.1, -10.2), yaw: 0.25, pitch: 0, roll: 0, curl: [0.3, 0.3, 0.3, 0.3, 0.3] };
// Ardoise de bois penchée vers le joueur, où l'objectif est gravé.
const BOARD = { y: 1.7, z: -8.5, w: 5.6, h: 2.0, tilt: -0.35 };
// Pianotage : la main passe par-dessus le rail et vient pianoter sur le feutre,
// dans la lumière de l'ampoule, pour que le geste se lise depuis la place du joueur.
const DRUM = { position: new THREE.Vector3(4.0, 2.08, -8.4), yaw: -0.2, pitch: 0.3 };
// Profondeur de la feuille du contrat (voir pact.ts).
export const PAPER_DEPTH = 4.6;

const clonePose = (p: Pose): Pose => ({ ...p, position: p.position.clone(), curl: [...p.curl] });
const ease = (t: number) => t * t * (3 - 2 * t);

// Résolution de la face de l'ardoise : 80 px par unité, même proportion que la planche.
const FACE_W = 448;
const FACE_H = 160;
// Trous serrés : ils se chevauchent et forment des sillons continus aux bords perforés.
const HOLE_STEP = 6;

interface Hole {
  x: number;
  y: number;
  r: number;
}

const layer = () => {
  const c = document.createElement('canvas');
  c.width = FACE_W;
  c.height = FACE_H;
  return c;
};

/**
 * L'objectif creusé dans le bois : des trous percés à l'ongle, assez serrés pour former
 * des sillons. Le bois frais mis à nu autour du sillon est clair, le creux est noir :
 * c'est ce contraste qui rend le chiffre lisible de loin.
 * Les trous des dettes précédentes restent, à peine visibles, comme des cicatrices.
 */
class Engraving {
  readonly material: THREE.MeshStandardMaterial;
  // Couches composées à chaque trou : bois (+ cicatrices), bois frais, creux.
  private readonly base = layer();
  private readonly fresh = layer();
  private readonly cores = layer();
  private readonly color = layer();
  private readonly bumpFresh = layer();
  private readonly bumpCores = layer();
  private readonly bump = layer();
  /** Le sang qui remplit les sillons à mesure que la dette est payée. */
  private readonly blood = layer();
  private bloodShown = 0;
  private bloodTarget = 0;
  private readonly colorTex: THREE.CanvasTexture;
  private readonly bumpTex: THREE.CanvasTexture;
  private holes: Hole[] = [];
  private scars: Hole[] = [];
  private drawn = 0;

  constructor() {
    this.colorTex = new THREE.CanvasTexture(this.color);
    this.colorTex.colorSpace = THREE.SRGBColorSpace;
    this.bumpTex = new THREE.CanvasTexture(this.bump);
    for (const t of [this.colorTex, this.bumpTex]) {
      t.magFilter = THREE.NearestFilter;
      t.minFilter = THREE.NearestFilter;
      t.generateMipmaps = false;
    }
    this.material = new THREE.MeshStandardMaterial({
      map: this.colorTex,
      bumpMap: this.bumpTex,
      bumpScale: 6,
      roughness: 0.9,
      // Une pointe d'émission pour que la gravure se lise même quand l'ampoule vacille.
      emissive: 0x4a3018,
      emissiveMap: this.colorTex,
      emissiveIntensity: 0.3,
      flatShading: true,
    });
    this.paintBase();
    this.compose();
  }

  /** Prépare les trous qui dessineront `text` ; l'ancien objectif devient une cicatrice. */
  write(text: string) {
    this.scars.push(...this.holes.slice(0, this.drawn));
    // Assez de cicatrices pour sentir les dettes passées, sans brouiller le nouveau chiffre.
    if (this.scars.length > 500) this.scars = this.scars.slice(-500);
    this.holes = layoutHoles(text);
    this.drawn = 0;
    this.bloodShown = this.bloodTarget = 0;
    for (const c of [this.fresh, this.cores, this.bumpFresh, this.bumpCores, this.blood]) c.getContext('2d')!.clearRect(0, 0, FACE_W, FACE_H);
    this.paintBase();
    this.compose();
  }

  /** Creuse les trous jusqu'à la proportion `p` ; renvoie les nouveaux trous (en pixels). */
  reveal(p: number): Hole[] {
    const target = Math.floor(THREE.MathUtils.clamp(p, 0, 1) * this.holes.length);
    if (target <= this.drawn) return [];
    const added = this.holes.slice(this.drawn, target);
    const f = this.fresh.getContext('2d')!;
    const c = this.cores.getContext('2d')!;
    const bf = this.bumpFresh.getContext('2d')!;
    const bc = this.bumpCores.getContext('2d')!;
    for (const h of added) {
      drawFresh(f, bf, h);
      drawCore(c, bc, h);
    }
    this.drawn = target;
    this.compose();
    return added;
  }

  /** Part de la dette déjà payée (0 → 1) : le sang monte dans la gravure, de gauche à droite. */
  setPaid(p: number) {
    this.bloodTarget = THREE.MathUtils.clamp(p, 0, 1);
  }

  /** Le sang coule doucement vers sa cible ; renvoie vrai tant qu'il coule. */
  tick(dt: number): boolean {
    if (Math.abs(this.bloodTarget - this.bloodShown) < 0.001) return false;
    const before = Math.floor(this.bloodShown * this.drawn);
    const diff = this.bloodTarget - this.bloodShown;
    const step = diff * Math.min(1, dt * 2.2) + Math.sign(diff) * dt * 0.05;
    this.bloodShown = Math.abs(step) >= Math.abs(diff) ? this.bloodTarget : this.bloodShown + step;
    const after = Math.floor(this.bloodShown * this.drawn);
    if (after === before) return true;
    const g = this.blood.getContext('2d')!;
    // Les trous sont rangés de gauche à droite : le sang suit le même chemin que l'ongle.
    // On n'ajoute que les nouveaux ; on ne repart de zéro que si le sang recule.
    let from = before;
    if (after < before) {
      g.clearRect(0, 0, FACE_W, FACE_H);
      from = 0;
    }
    for (const h of this.holes.slice(from, after)) {
      const grad = g.createRadialGradient(h.x - h.r * 0.35, h.y - h.r * 0.35, 0, h.x, h.y, h.r * 0.95);
      grad.addColorStop(0, 'rgb(230, 70, 60)');
      grad.addColorStop(0.35, 'rgb(150, 10, 10)');
      grad.addColorStop(1, 'rgb(60, 0, 0)');
      g.fillStyle = grad;
      g.beginPath();
      g.arc(h.x, h.y, h.r * 0.95, 0, Math.PI * 2);
      g.fill();
    }
    this.compose();
    return true;
  }

  /** Le trou en train d'être creusé (repère de l'ardoise) : la main suit cette position. */
  head() {
    const h = this.holes[Math.min(this.drawn, this.holes.length - 1)];
    return h ? this.holeLocal(h) : new THREE.Vector3();
  }

  /** Position d'un trou dans le repère de l'ardoise. */
  holeLocal(h: Hole) {
    return new THREE.Vector3((h.x / FACE_W - 0.5) * BOARD.w, (0.5 - h.y / FACE_H) * BOARD.h, 0.08);
  }

  private paintBase() {
    const g = this.base.getContext('2d')!;
    const wood = woodTexture(true).image as HTMLCanvasElement;
    g.fillStyle = g.createPattern(wood, 'repeat')!;
    g.fillRect(0, 0, FACE_W, FACE_H);
    // Vieilles cicatrices : de simples piqûres sombres, très discrètes.
    g.fillStyle = 'rgba(0, 0, 0, 0.22)';
    for (const h of this.scars) {
      g.beginPath();
      g.arc(h.x, h.y, h.r * 0.7, 0, Math.PI * 2);
      g.fill();
    }
  }

  private compose() {
    const g = this.color.getContext('2d')!;
    g.drawImage(this.base, 0, 0);
    g.drawImage(this.fresh, 0, 0);
    g.drawImage(this.cores, 0, 0);
    g.drawImage(this.blood, 0, 0);
    const b = this.bump.getContext('2d')!;
    b.fillStyle = 'rgb(200, 200, 200)';
    b.fillRect(0, 0, FACE_W, FACE_H);
    b.drawImage(this.bumpFresh, 0, 0);
    b.drawImage(this.bumpCores, 0, 0);
    this.colorTex.needsUpdate = true;
    this.bumpTex.needsUpdate = true;
  }
}

/** Échantillonne le texte sur une grille : un trou par case couverte par un chiffre. */
function layoutHoles(text: string): Hole[] {
  const mask = layer();
  const g = mask.getContext('2d')!;
  g.fillStyle = '#fff';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  let size = 150;
  g.font = `bold ${size}px "Courier New", monospace`;
  // Réduit la police si le nombre est trop long pour l'ardoise.
  while (g.measureText(text).width > FACE_W * 0.9 && size > 40) {
    size -= 6;
    g.font = `bold ${size}px "Courier New", monospace`;
  }
  g.fillText(text, FACE_W / 2, FACE_H / 2 + 8);
  const data = g.getImageData(0, 0, FACE_W, FACE_H).data;
  const holes: Hole[] = [];
  for (let y = HOLE_STEP / 2; y < FACE_H; y += HOLE_STEP) {
    for (let x = HOLE_STEP / 2; x < FACE_W; x += HOLE_STEP) {
      if (data[(Math.floor(y) * FACE_W + Math.floor(x)) * 4 + 3] < 128) continue;
      holes.push({ x: x + (Math.random() - 0.5) * 2, y: y + (Math.random() - 0.5) * 2, r: 2.6 + Math.random() * 0.8 });
    }
  }
  // De gauche à droite, comme l'ongle avance ; légèrement brouillé pour un geste humain.
  const key = new Map(holes.map((h) => [h, h.x + Math.random() * 6]));
  return holes.sort((a, b) => key.get(a)! - key.get(b)!);
}

/** Bois frais mis à nu autour du trou : clair, avec des éclats arrachés. */
function drawFresh(g: CanvasRenderingContext2D, b: CanvasRenderingContext2D, h: Hole) {
  const { x, y, r } = h;
  g.fillStyle = 'rgb(186, 136, 88)';
  g.beginPath();
  g.arc(x, y, r * 2.1, 0, Math.PI * 2);
  g.fill();
  for (let k = 0; k < 3; k++) {
    const a = Math.random() * Math.PI * 2;
    const d = r * (2 + Math.random() * 0.8);
    g.fillStyle = 'rgba(205, 160, 110, 0.85)';
    g.fillRect(x + Math.cos(a) * d - 1, y + Math.sin(a) * d - 1, 2 + Math.random() * 2, 1 + Math.random());
  }
  // Relief : le bois frais est légèrement en retrait de la surface.
  b.fillStyle = 'rgb(170, 170, 170)';
  b.beginPath();
  b.arc(x, y, r * 2.1, 0, Math.PI * 2);
  b.fill();
}

/** Le creux : noir au centre, la paroi basse attrape un peu de lumière. */
function drawCore(g: CanvasRenderingContext2D, b: CanvasRenderingContext2D, h: Hole) {
  const { x, y, r } = h;
  const grad = g.createRadialGradient(x - r * 0.2, y - r * 0.3, 0, x, y, r);
  grad.addColorStop(0, 'rgb(2, 1, 0)');
  grad.addColorStop(0.8, 'rgb(10, 5, 2)');
  grad.addColorStop(1, 'rgb(40, 22, 10)');
  g.fillStyle = grad;
  g.beginPath();
  g.arc(x, y, r, 0, Math.PI * 2);
  g.fill();
  const bg = b.createRadialGradient(x, y, 0, x, y, r);
  bg.addColorStop(0, 'rgb(0, 0, 0)');
  bg.addColorStop(1, 'rgb(120, 120, 120)');
  b.fillStyle = bg;
  b.beginPath();
  b.arc(x, y, r, 0, Math.PI * 2);
  b.fill();
}

/**
 * Le créancier : deux mains et un sourire. Il ne parle jamais ; tout passe par ses gestes,
 * qui servent aussi d'interface (objectifs gravés, impatience, verdicts).
 */
export class Creditor {
  // Le créancier nous fait face : la main à notre droite est sa main gauche (pouce vers le centre).
  private readonly right = new Hand(true);
  private readonly left = new Hand(false);
  private readonly smile = new Smile();
  private readonly engraving = new Engraving();
  private readonly current = { right: clonePose(REST_RIGHT), left: clonePose(REST_LEFT) };
  private action: Action | null = null;
  private impatience = 0;
  private tapPhase = 0;
  private lastTapPhase = [0, 0, 0, 0];
  private retreat = 0;
  private retreatTarget = 0;
  private clock = 0;

  private readonly board = new THREE.Group();

  constructor(private readonly scene: THREE.Scene, private readonly fx: CreditorFx) {
    // La face avant (+Z, 5e groupe de la boîte) porte la gravure ; les autres faces sont du bois brut.
    const raw = new THREE.MeshStandardMaterial({ map: repeated(woodTexture(true), 1.5, 0.6), roughness: 0.9, flatShading: true });
    const slab = new THREE.Mesh(new THREE.BoxGeometry(BOARD.w, BOARD.h, 0.15), [raw, raw, raw, raw, this.engraving.material, raw]);
    slab.castShadow = slab.receiveShadow = true;
    this.board.add(slab);
    this.board.position.set(0, BOARD.y, BOARD.z);
    this.board.rotation.x = BOARD.tilt;
    scene.add(this.right.root, this.left.root, this.smile.group, this.board);
    this.smile.group.position.set(0, SMILE_Y, -11);
  }

  /** Objets 3D du créancier, pour leur appliquer le rendu PS1. */
  get objects() {
    return [this.right.root, this.left.root, this.board];
  }

  get busy() {
    return this.action !== null;
  }

  // ---------------------------------------------------------------- réactions

  /** Grave l'objectif dans le bois avec un ongle, de gauche à droite. */
  engrave(text: string) {
    this.engraving.write(text);
    this.smile.raise(true);
    let lastScratch = -1;
    this.play({
      duration: 2.0,
      stiffness: 14,
      apply: (t, _l, r) => {
        // Approche (20 %), gravure (65 %), retour (15 %).
        const write = THREE.MathUtils.clamp((t - 0.2) / 0.65, 0, 1);
        const approach = ease(Math.min(1, t / 0.2));
        const away = ease(THREE.MathUtils.clamp((t - 0.85) / 0.15, 0, 1));
        // La main passe par-dessus l'ardoise, les doigts pendent sur sa face avant.
        const head = this.board.localToWorld(this.engraving.head());
        const x = head.x + Math.sin(t * 90) * 0.08 * (write > 0 && write < 1 ? 1 : 0);
        const target = new THREE.Vector3(x + 0.56, head.y + 3.25 + Math.abs(Math.sin(t * 45)) * 0.06, -9.9);
        r.position.lerp(target, approach * (1 - away));
        r.yaw = THREE.MathUtils.lerp(r.yaw, 0, approach * (1 - away));
        r.pitch = 1.05 * approach * (1 - away);
        r.curl = [0.02, 0.95, 0.95, 0.95, 0.7].map((c, i) => THREE.MathUtils.lerp(r.curl[i], c, approach * (1 - away)));
        // Chaque trou neuf crache des copeaux ; on en limite le nombre par image.
        this.engraving.reveal(write).slice(0, 3).forEach((h) => this.fx.chips(this.board.localToWorld(this.engraving.holeLocal(h))));
        if (write > 0 && write < 1 && t - lastScratch > 0.05) {
          lastScratch = t;
          this.fx.scratch();
        }
      },
      events: [],
      onEnd: () => {
        this.engraving.reveal(1);
        this.smile.raise(false);
      },
      interrupt: () => {
        this.engraving.reveal(1);
        this.smile.raise(false);
      },
    });
  }

  /** La dette payée remplit de sang le chiffre gravé. */
  setPaid(p: number) {
    this.engraving.setPaid(p);
  }

  /** Mauvais lancer : le sourire s'élargit lentement. */
  sneer(amount = 0.9) {
    this.smile.widen(amount, this.clock);
  }

  /** Bon lancer : le sourire se referme un peu. */
  wince() {
    this.smile.widen(0.05, this.clock, 1.5);
  }

  /** Gros combo : une main se referme, le sourire se crispe. */
  clench() {
    this.smile.clench(true);
    this.play({
      duration: 1.8,
      stiffness: 6,
      apply: (t, _l, r) => {
        const k = t < 0.7 ? ease(t / 0.7) : 1 - ease((t - 0.7) / 0.3);
        r.curl = r.curl.map((c) => THREE.MathUtils.lerp(c, 1, k));
        r.position.y += k * 0.15;
      },
      events: [],
      onEnd: () => this.smile.clench(false),
      interrupt: () => this.smile.clench(false),
    });
  }

  /** Un Cinq : trois applaudissements lents. */
  clap() {
    const claps = [0.35, 0.58, 0.81];
    this.play({
      duration: 2.6,
      stiffness: 12,
      apply: (t, l, r) => {
        const up = ease(Math.min(1, t / 0.25)) * (1 - ease(THREE.MathUtils.clamp((t - 0.9) / 0.1, 0, 1)));
        // Les mains se rapprochent à chaque applaudissement.
        let together = 0;
        for (const c of claps) together = Math.max(together, 1 - Math.min(1, Math.abs(t - c) / 0.08));
        const gap = 0.62 + (1 - together) * 1.3;
        r.position.lerp(new THREE.Vector3(gap, 3.7, -9.4), up);
        l.position.lerp(new THREE.Vector3(-gap, 3.7, -9.4), up);
        r.roll = 1.35 * up;
        l.roll = -1.35 * up;
        r.yaw = THREE.MathUtils.lerp(r.yaw, 0, up);
        l.yaw = THREE.MathUtils.lerp(l.yaw, 0, up);
        r.pitch = l.pitch = -0.3 * up;
        r.curl = r.curl.map((c) => THREE.MathUtils.lerp(c, 0.1, up));
        l.curl = l.curl.map((c) => THREE.MathUtils.lerp(c, 0.1, up));
      },
      events: claps.map((at) => ({ at, fn: () => this.fx.clap() })),
    });
  }

  /** Frappe la table du poing, `times` fois. */
  knock(times: number, onDone?: () => void) {
    const per = 0.75;
    this.smile.widen(1, this.clock, 6);
    this.play({
      duration: per * times + 0.3,
      stiffness: 30,
      apply: (t, _l, r) => {
        const local = (t * (per * times + 0.3)) % per;
        const raise = local < 0.45 ? ease(local / 0.45) : 1 - Math.min(1, (local - 0.45) / 0.06);
        r.position.set(3.7, PLANK_Y + 0.15 + raise * 2.6, -9.6);
        r.yaw = 0;
        r.pitch = -0.4 * raise;
        r.curl = [1, 1, 1, 1, 0.9];
      },
      events: Array.from({ length: times }, (_, i) => ({ at: (per * i + 0.51) / (per * times + 0.3), fn: () => this.fx.slam() })),
      onEnd: onDone,
    });
  }

  /**
   * Fait glisser une feuille sur la table, du bout des doigts posés sur son bord arrière.
   * `onMove` reçoit à chaque image la position du centre de la feuille.
   */
  slidePaper(from: THREE.Vector3, to: THREE.Vector3, duration: number, onMove: (center: THREE.Vector3) => void, onDone?: () => void) {
    this.play({
      duration,
      stiffness: 20,
      apply: (t, _l, r) => {
        const center = from.clone().lerp(to, ease(t));
        // La feuille glisse sur la planche, passe le rail, puis se pose sur le feutre.
        center.y = Math.max(0.02, Math.min(PLANK_Y + 0.03, PLANK_Y + 0.03 - (center.z + 7) * 0.9));
        onMove(center);
        // Doigts presque tendus, posés sur le bord arrière de la feuille.
        r.position.set(center.x + 1.4, center.y + 0.32, center.z - PAPER_DEPTH / 2 + 0.7 - HAND_REACH);
        r.yaw = 0;
        r.pitch = 0.06;
        r.curl = [0.12, 0.15, 0.18, 0.2, 0.4];
      },
      events: [],
      onEnd: onDone,
    });
  }

  /**
   * Intro du tutoriel : la main droite recule dans l'ombre de sa manche, en revient avec
   * le gobelet et le pousse sur le feutre. `onMove` reçoit la base du gobelet tant qu'il le tient ;
   * `onRelease` est appelé au moment où il le lâche, lancé vers le joueur.
   */
  pullCup(from: THREE.Vector3, to: THREE.Vector3, cupRadius: number, onMove: (base: THREE.Vector3) => void, onRelease: () => void) {
    // La main tient le gobelet par le rebord, par-dessus : les doigts pendent sur le cuir, côté joueur.
    const behind = (base: THREE.Vector3) => new THREE.Vector3(base.x + 0.4, base.y + CUP_HEIGHT + 2.3, base.z - cupRadius * 0.9);
    this.play({
      duration: 3.2,
      stiffness: 10,
      apply: (t, _l, r) => {
        const back = ease(Math.min(1, t / 0.3));
        const drag = ease(THREE.MathUtils.clamp((t - 0.42) / 0.5, 0, 1));
        const base = from.clone().lerp(to, drag);
        // Le gobelet glisse sur la planche, franchit le rail et se pose sur le feutre.
        base.y = Math.max(0, Math.min(PLANK_Y, PLANK_Y - (base.z + 7) * 0.9));
        // Le gobelet n'apparaît qu'une fois dans sa main, tiré de l'ombre de la manche.
        if (t >= 0.36) onMove(base);
        const grip = behind(base);
        r.position.lerp(grip, t < 0.3 ? back : 1);
        r.yaw = 0;
        const close = THREE.MathUtils.clamp((t - 0.3) / 0.12, 0, 1);
        r.pitch = THREE.MathUtils.lerp(0.2, 0.95, close);
        // Les doigts s'ouvrent dans l'ombre, puis se referment sur le cuir.
        r.curl = [0, 0, 0, 0, 0.2].map((open, i) => THREE.MathUtils.lerp(open, [0.55, 0.6, 0.65, 0.7, 0.45][i], close));
        // Petite poussée finale : la main suit le gobelet un instant avant de le lâcher.
        if (t > 0.92) r.position.z += (t - 0.92) * 12;
      },
      events: [{ at: 0.95, fn: onRelease }],
    });
  }

  /**
   * Tutoriel : l'index tendu vient tapoter chaque dé désigné, deux fois.
   * C'est sa seule façon d'expliquer : « garde ceux-là ».
   */
  point(targets: THREE.Vector3[]) {
    if (targets.length === 0) return;
    const per = 1.1;
    const duration = per * targets.length + 0.6;
    this.play({
      duration,
      stiffness: 9,
      apply: (t, _l, r) => {
        const time = t * duration;
        const i = Math.min(targets.length - 1, Math.floor(time / per));
        const local = time - i * per;
        const away = ease(Math.min(1, Math.max(0, (time - per * targets.length) / 0.6)));
        // Deux petits coups d'ongle sur le dé.
        const tap = local > 0.35 && local < 0.95 ? Math.abs(Math.sin((local - 0.35) * Math.PI * 3.3)) * 0.35 : 0.35;
        const target = targets[i];
        const hover = new THREE.Vector3(target.x + 0.56, target.y + 3.25 + tap, target.z - 1.8);
        r.position.lerp(hover, 1 - away);
        r.yaw = 0;
        r.pitch = 1.05 * (1 - away);
        r.curl = [0.02, 0.95, 0.95, 0.95, 0.7].map((c, k) => THREE.MathUtils.lerp(r.curl[k], c, 1 - away));
        if (local > 0.4 && local < 0.42) this.fx.tap();
        if (local > 0.72 && local < 0.74) this.fx.tap();
      },
      events: [],
    });
  }

  /**
   * Vente d'une relique : sa main traverse la table, ramasse l'objet et le fait disparaître
   * dans sa manche. `object` est une copie posée à la place de la relique vendue.
   */
  snatch(object: THREE.Object3D, onDone?: () => void) {
    const from = object.position.clone();
    // Le bras arrive en biais depuis la droite, pour contourner la valise ouverte.
    const yaw = -0.75;
    const dir = new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw));
    const reach = from.clone().addScaledVector(dir, -HAND_REACH * 0.62).add(new THREE.Vector3(0, 2.0, 0));
    const home = new THREE.Vector3(REST_RIGHT.position.x, PLANK_Y + 1.2, -15);
    let carried = false;
    this.leftovers.push(object);
    this.play({
      duration: 2.3,
      stiffness: 11,
      apply: (t, _l, r) => {
        const go = ease(Math.min(1, t / 0.4));
        const back = ease(THREE.MathUtils.clamp((t - 0.5) / 0.5, 0, 1));
        r.position.copy(REST_RIGHT.position).lerp(reach, go).lerp(home, back);
        r.yaw = yaw * go * (1 - back);
        r.pitch = 0.9 * (1 - back * 0.6);
        // Les doigts s'ouvrent au-dessus, puis se referment d'un coup sur l'objet.
        const grab = t > 0.42 ? 1 : 0;
        r.curl = [0, 0, 0, 0, 0.1].map((open, i) => THREE.MathUtils.lerp(open, [0.85, 0.9, 0.92, 0.95, 0.7][i], grab));
        if (t > 0.45) {
          carried = true;
          object.position.copy(r.position).addScaledVector(dir, HAND_REACH * 0.5 * (1 - back)).add(new THREE.Vector3(0, -1.4 + back * 0.6, HAND_REACH * 0.5 * back));
          object.rotation.y += 0.04;
          object.scale.setScalar(Math.max(0.01, 1 - back * 0.9));
        }
      },
      events: [],
      onEnd: () => {
        if (carried) this.scene.remove(object);
        onDone?.();
      },
    });
  }

  /**
   * Victoire finale : les deux mains montent le contrat dans la lumière et le déchirent en deux.
   * Les moitiés tombent sur la table, puis les mains reculent dans le noir.
   */
  tearContract(onDone?: () => void) {
    const tex = contractTexture();
    const halfW = 1.2;
    const h = 1.7;
    const halves = [0, 1].map((side) => {
      const tx = tex.clone();
      tx.needsUpdate = true;
      tx.repeat.set(0.5, 1);
      tx.offset.set(side * 0.5, 0);
      const m = new THREE.Mesh(new THREE.PlaneGeometry(halfW, h), new THREE.MeshStandardMaterial({ map: tx, emissiveMap: tx, emissive: 0x2e2618, roughness: 0.9, side: THREE.DoubleSide }));
      m.castShadow = true;
      this.scene.add(m);
      this.leftovers.push(m);
      return m;
    });
    const fall = halves.map(() => ({ y: 0, rot: 0 }));
    const z = -9.4 + HAND_REACH * 0.55;
    this.smile.widen(1, this.clock, 4);
    this.play({
      duration: 3.4,
      stiffness: 12,
      apply: (t, l, r) => {
        const up = ease(Math.min(1, t / 0.22));
        const rip = ease(THREE.MathUtils.clamp((t - 0.38) / 0.16, 0, 1));
        const gap = 1.2 + rip * 1.4;
        const open = t > 0.62;
        r.position.lerp(new THREE.Vector3(gap, 3.4 + rip * 0.3, -9.4), up);
        l.position.lerp(new THREE.Vector3(-gap, 3.4 + rip * 0.3, -9.4), up);
        r.roll = 1.35 * up;
        l.roll = -1.35 * up;
        r.yaw = THREE.MathUtils.lerp(r.yaw, 0, up);
        l.yaw = THREE.MathUtils.lerp(l.yaw, 0, up);
        r.pitch = l.pitch = -0.15 * up;
        const pinch = open ? 0 : 0.75;
        r.curl = r.curl.map((c) => THREE.MathUtils.lerp(c, pinch, up));
        l.curl = l.curl.map((c) => THREE.MathUtils.lerp(c, pinch, up));
        halves.forEach((m, side) => {
          const dir = side === 0 ? -1 : 1;
          const f = fall[side];
          if (!open) {
            // Chaque moitié est pincée par une main ; la déchirure les écarte en biais.
            m.position.set(dir * (gap - halfW / 2 - 0.05), 3.4 + 1.3 + rip * 0.3, z);
            m.rotation.set(0, 0, -dir * rip * 0.35);
            f.y = m.position.y;
          } else {
            // Les doigts s'ouvrent : les moitiés tombent en tournoyant et se couchent sur la table.
            const ft = (t - 0.62) * 3.4;
            m.position.y = Math.max(0.02, f.y - 2.6 * ft * ft);
            f.rot = Math.min(1, ft / 1.3);
            m.rotation.set(-Math.PI / 2 * f.rot, 0, -dir * (0.35 + f.rot * 0.8));
          }
        });
      },
      events: [{ at: 0.4, fn: () => this.fx.tear() }],
      onEnd: onDone,
    });
  }

  /**
   * La paie : la main droite se referme sur une poignée de pièces, recule, puis la lance
   * vers le joueur en s'ouvrant. `onRelease` est appelé quand les doigts lâchent.
   */
  toss(onRelease: () => void) {
    const windup = new THREE.Vector3(2.6, PLANK_Y + 3.0, -11.2);
    const fling = new THREE.Vector3(1.8, PLANK_Y + 1.6, -7.6);
    this.play({
      duration: 1.5,
      stiffness: 16,
      apply: (t, _l, r) => {
        const up = ease(Math.min(1, t / 0.35));
        const go = ease(THREE.MathUtils.clamp((t - 0.38) / 0.14, 0, 1));
        const back = ease(THREE.MathUtils.clamp((t - 0.7) / 0.3, 0, 1));
        r.position.copy(REST_RIGHT.position).lerp(windup, up).lerp(fling, go).lerp(REST_RIGHT.position, back);
        r.yaw = 0;
        r.pitch = THREE.MathUtils.lerp(-0.5 * up, 0.35, go) * (1 - back);
        const open = t > 0.5 ? 1 : 0;
        r.curl = r.curl.map((_, i) => THREE.MathUtils.lerp(i === 4 ? 0.8 : 1, -0.3, open));
      },
      events: [{ at: 0.5, fn: onRelease }],
    });
  }

  /** Moitiés de contrat restées sur la table après la victoire. */
  private readonly leftovers: THREE.Object3D[] = [];

  /** Le sourire n'apparaît qu'à la première échéance payée du tutoriel. */
  showSmile(on: boolean) {
    this.smile.setVisible(on);
    if (on) this.smile.widen(0.9, this.clock, 3);
  }

  /** Les scènes de pacte jouent leurs propres mains : les siennes s'effacent le temps de la scène. */
  hideHands(hidden: boolean) {
    this.right.root.visible = this.left.root.visible = !hidden;
  }

  /** Victoire : le sourire disparaît, les mains reculent dans le noir. */
  vanish() {
    this.smile.setVisible(false);
    this.retreatTarget = 1;
  }

  reset() {
    this.action?.interrupt?.();
    for (const o of this.leftovers) this.scene.remove(o);
    this.leftovers.length = 0;
    this.action = null;
    this.retreat = this.retreatTarget = 0;
    this.smile.setVisible(true);
    this.smile.clench(false);
    this.smile.raise(false);
  }

  /** 0 = patient ; monte quand le joueur hésite. Les doigts tapotent de plus en plus vite. */
  setImpatience(level: number) {
    this.impatience = level;
  }

  // ---------------------------------------------------------------- animation

  private play(a: Omit<Action, 't'>) {
    this.action?.interrupt?.();
    this.action = { ...a, t: 0 };
  }

  update(dt: number, clock: number, camera: THREE.Camera) {
    this.clock = clock;
    const right = clonePose(REST_RIGHT);
    const left = clonePose(REST_LEFT);

    // Repos : respiration et doigts qui frémissent.
    const breathe = Math.sin(clock * 1.1) * 0.03;
    right.position.y += breathe;
    left.position.y += breathe;
    for (let f = 0; f < 5; f++) {
      right.curl[f] += Math.sin(clock * 0.7 + f * 1.3) * 0.08;
      left.curl[f] += Math.sin(clock * 0.6 + f * 1.7 + 2) * 0.08;
    }

    const tapping = this.impatience > 0 && !this.action;
    if (tapping) this.applyTapping(right, dt);

    let stiffness = 8;
    // Les doigts doivent frapper sec quand ils pianotent.
    const fingerStiffness = tapping ? 40 : 12;
    if (this.action) {
      const a = this.action;
      a.t += dt / a.duration;
      const t = Math.min(1, a.t);
      a.apply(t, left, right);
      for (const e of a.events) {
        if (!e.done && t >= e.at) {
          e.done = true;
          e.fn();
        }
      }
      stiffness = a.stiffness;
      if (a.t >= 1) {
        this.action = null;
        a.onEnd?.();
      }
    }

    // Recul dans l'ombre (victoire).
    this.retreat += (this.retreatTarget - this.retreat) * (1 - Math.exp(-dt * 0.8));
    for (const p of [right, left]) {
      p.position.z -= this.retreat * 8;
      p.position.y -= this.retreat * 1.5;
    }

    this.follow(this.right, this.current.right, right, stiffness, this.action ? stiffness * 1.5 : fingerStiffness, dt);
    this.follow(this.left, this.current.left, left, stiffness, this.action ? stiffness * 1.5 : 12, dt);
    this.smile.update(dt, clock, camera);
    this.engraving.tick(dt);
  }

  /**
   * Pianotage : la main se pose sur le rail, poignet relevé ; les doigts se lèvent puis
   * frappent un à un, de l'auriculaire à l'index. Le rythme s'accélère avec l'impatience.
   */
  private applyTapping(right: Pose, dt: number) {
    right.position.copy(DRUM.position);
    right.yaw = DRUM.yaw;
    right.pitch = DRUM.pitch;
    right.curl[4] = 0.5;

    const rate = 0.7 + this.impatience * 1.4; // vagues de quatre doigts par seconde
    this.tapPhase += dt * rate;
    right.position.y += Math.sin(this.tapPhase * Math.PI * 2) * 0.04;
    for (let k = 0; k < 4; k++) {
      const f = 3 - k; // auriculaire d'abord
      const phase = (((this.tapPhase - k * 0.16) % 1) + 1) % 1;
      let curl = 0.35;
      // Levée lente et haute, puis frappe sèche.
      if (phase < 0.22) curl = THREE.MathUtils.lerp(0.35, -0.6, ease(phase / 0.22));
      else if (phase < 0.28) curl = THREE.MathUtils.lerp(-0.6, 0.42, (phase - 0.22) / 0.06);
      right.curl[f] = curl;
      // Le clac du doigt sur le bois, au moment de l'impact.
      if (this.lastTapPhase[f] < 0.28 && phase >= 0.28) this.fx.tap();
      this.lastTapPhase[f] = phase;
    }
    if (this.impatience > 0.6) this.smile.widen(0.6, this.clock, 0.5);
  }

  private follow(hand: Hand, current: Pose, target: Pose, stiffness: number, fingerStiffness: number, dt: number) {
    const k = 1 - Math.exp(-dt * stiffness);
    const kf = 1 - Math.exp(-dt * fingerStiffness);
    current.position.lerp(target.position, k);
    current.yaw += (target.yaw - current.yaw) * k;
    current.pitch += (target.pitch - current.pitch) * k;
    current.roll += (target.roll - current.roll) * k;
    for (let f = 0; f < 5; f++) current.curl[f] += (target.curl[f] - current.curl[f]) * kf;
    hand.root.position.copy(current.position);
    hand.root.rotation.set(current.pitch, current.yaw, current.roll, 'YXZ');
    for (let f = 0; f < 5; f++) hand.curl[f] = THREE.MathUtils.clamp(current.curl[f], -0.6, 1);
    hand.pose();
  }
}

/** Le contrat de la dette : papier jauni, lignes serrées, une empreinte de pouce en sang. */
function contractTexture() {
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = 96;
  const g = c.getContext('2d')!;
  g.fillStyle = '#c8b890';
  g.fillRect(0, 0, 128, 96);
  for (let i = 0; i < 120; i++) {
    g.fillStyle = `rgba(90, 60, 30, ${Math.random() * 0.2})`;
    g.fillRect(Math.random() * 128, Math.random() * 96, 2, 2);
  }
  g.fillStyle = '#2a1a10';
  g.font = 'bold 10px "Courier New", monospace';
  g.fillText('66 600', 44, 16);
  g.strokeStyle = 'rgba(40, 25, 15, 0.7)';
  for (let y = 26; y < 76; y += 6) {
    g.beginPath();
    g.moveTo(12, y);
    for (let x = 12; x < 116; x += 4) g.lineTo(x, y + Math.random() * 1.5);
    g.stroke();
  }
  // Toutes les empreintes signées pendant la run.
  for (let i = 0; i < 4; i++) {
    g.fillStyle = 'rgba(110, 8, 8, 0.75)';
    g.beginPath();
    g.ellipse(24 + i * 26, 85, 6, 8, 0.2, 0, Math.PI * 2);
    g.fill();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.magFilter = THREE.NearestFilter;
  return tex;
}
