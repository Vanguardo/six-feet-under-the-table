import * as THREE from 'three';
import { Hand, MERCHANT_HANDS } from './creditor/hand';
import { displayDie } from './dice';
import { ps1ify } from './render/ps1';
import { feltTexture, grimeTexture, leatherTexture, repeated } from './render/textures';
import { buildRelicMesh } from './relicShelf';
import { COMBOS } from './rules/combos';
import { DIE_TYPES, FACE_MODS } from './rules/dice';
import type { ShopItem } from './rules/run';
import type { Sfx } from './sfx';

// La valise est posée au milieu du feutre, couvercle vers le créancier.
const CASE = { x: 0, z: -0.6, w: 10, h: 1, d: 5.2 };
const LID_OPEN = -1.95;
const BELL = new THREE.Vector3(6.4, 0, 1.4);
const ITEM_Y = CASE.h + 0.25;

export type SuitcaseTarget = { kind: 'item'; index: number } | { kind: 'bell' } | { kind: 'lid' } | null;

type State = 'hidden' | 'arriving' | 'open' | 'leaving';

interface Slot {
  object: THREE.Object3D;
  tag: THREE.Sprite;
  home: THREE.Vector3;
  fly: { from: THREE.Vector3; to: THREE.Vector3; t: number; onArrive: () => void } | null;
  bornAt: number;
}

const ease = (t: number) => t * t * (3 - 2 * t);
const clamp01 = (t: number) => Math.min(1, Math.max(0, t));

/** Étiquette de prix : un bout de papier, prix en rouge si on ne peut pas payer. */
function priceTag(text: string, affordable: boolean): THREE.Sprite {
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 56;
  const g = canvas.getContext('2d')!;
  g.fillStyle = '#d8c8a8';
  g.fillRect(4, 4, 120, 48);
  g.fillStyle = 'rgba(80, 50, 20, 0.25)';
  for (let i = 0; i < 40; i++) g.fillRect(Math.random() * 128, Math.random() * 56, 2, 2);
  g.font = 'bold 36px "Courier New", monospace';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillStyle = affordable ? '#1a0e08' : '#8a1010';
  g.fillText(text, 64, 30);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.magFilter = THREE.NearestFilter;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthWrite: false }));
  sprite.scale.set(1.7, 0.75, 1);
  return sprite;
}

/** Plaque de bronze gravée du nom de la combinaison. */
function gravurePlate(name: string): THREE.Object3D {
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 80;
  const g = canvas.getContext('2d')!;
  g.fillStyle = '#7a5a2a';
  g.fillRect(0, 0, 128, 80);
  g.strokeStyle = '#3a2810';
  g.lineWidth = 4;
  g.strokeRect(5, 5, 118, 70);
  g.fillStyle = '#2a1a08';
  g.font = 'bold 20px "Courier New", monospace';
  g.textAlign = 'center';
  g.fillText(name.toUpperCase(), 64, 38);
  g.font = 'bold 18px "Courier New", monospace';
  g.fillText('+1 NIV.', 64, 62);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  const bronze = new THREE.MeshStandardMaterial({ color: 0x8a6a30, metalness: 0.75, roughness: 0.45, map: grimeTexture() });
  const top = new THREE.MeshStandardMaterial({ map: tex, metalness: 0.6, roughness: 0.5 });
  const plate = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.08, 0.95), [bronze, bronze, top, bronze, bronze, bronze]);
  plate.rotation.x = -0.35;
  plate.position.y = 0.25;
  const g2 = new THREE.Group();
  g2.add(plate);
  return g2;
}

/** Ciseau à bois dont la pointe a la couleur de la gravure. */
function chisel(color: string): THREE.Object3D {
  const g = new THREE.Group();
  const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.13, 0.75, 6), new THREE.MeshStandardMaterial({ color: 0x5a3a1e, map: grimeTexture(), flatShading: true }));
  handle.rotation.z = Math.PI / 2;
  handle.position.x = -0.45;
  const blade = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.05, 0.2), new THREE.MeshStandardMaterial({ color: 0x9a9aa0, metalness: 0.8, roughness: 0.35 }));
  blade.position.x = 0.25;
  const tip = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.055, 0.21), new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.35 }));
  tip.position.x = 0.62;
  g.add(handle, blade, tip);
  g.rotation.y = 0.6;
  g.position.y = 0.12;
  return g;
}

function itemMesh(item: ShopItem): THREE.Object3D {
  switch (item.kind) {
    case 'relic': {
      const o = buildRelicMesh(item.def.id);
      o.userData.baseScale = 2.1;
      return o;
    }
    case 'die': {
      const d = displayDie(DIE_TYPES[item.type]);
      d.position.y = 0.6;
      d.rotation.set(0.5, 0.7, 0.2);
      const g = new THREE.Group();
      g.add(d);
      g.userData.baseScale = 1.25;
      return g;
    }
    case 'gravure': {
      const o = gravurePlate(COMBOS[item.combo].name);
      o.userData.baseScale = 1.3;
      return o;
    }
    case 'burin': {
      const o = chisel(FACE_MODS[item.mod].color);
      o.userData.baseScale = 1.6;
      return o;
    }
  }
}

/**
 * La valise du marchand. Il la pousse sur la table, l'ouvre de ses mains crasseuses ;
 * les articles reposent sur du velours. On achète en cliquant, on relance avec la sonnette,
 * on repart en refermant le couvercle.
 */
export class Suitcase {
  private readonly root = new THREE.Group();
  private readonly lid = new THREE.Group();
  private readonly bell = new THREE.Group();
  private readonly bellTag: { sprite: THREE.Sprite | null } = { sprite: null };
  private readonly left = new Hand(false, MERCHANT_HANDS);
  private readonly right = new Hand(true, MERCHANT_HANDS);
  private slots: (Slot | null)[] = [];
  private state: State = 'hidden';
  private t = 0;
  private clock = 0;
  private hovered: SuitcaseTarget = null;
  private onLeft: (() => void) | null = null;
  private readonly lidMaterials: THREE.MeshStandardMaterial[] = [];

  constructor(
    private readonly scene: THREE.Scene,
    private readonly sfx: Sfx,
  ) {
    this.build();
    scene.add(this.root, this.bell, this.left.root, this.right.root);
    this.setVisible(false);
  }

  get isOpen() {
    return this.state === 'open';
  }

  get isHidden() {
    return this.state === 'hidden';
  }

  private build() {
    const leather = new THREE.MeshStandardMaterial({ map: repeated(leatherTexture(), 3, 1), color: 0x8a6a5a, roughness: 0.85, flatShading: true });
    const brass = new THREE.MeshStandardMaterial({ color: 0x9a7a32, map: grimeTexture(), metalness: 0.75, roughness: 0.4 });
    const velvet = new THREE.MeshStandardMaterial({ map: repeated(feltTexture(true), 1, 0.5), roughness: 1 });
    this.lidMaterials.push(leather);

    const base = new THREE.Mesh(new THREE.BoxGeometry(CASE.w, CASE.h, CASE.d), leather);
    base.position.y = CASE.h / 2;
    const lining = new THREE.Mesh(new THREE.BoxGeometry(CASE.w - 0.5, 0.05, CASE.d - 0.5), velvet);
    lining.position.y = CASE.h + 0.01;
    this.root.add(base, lining);
    // Coins et fermoirs en laiton terni.
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        const corner = new THREE.Mesh(new THREE.BoxGeometry(0.4, CASE.h + 0.05, 0.4), brass);
        corner.position.set((sx * CASE.w) / 2, CASE.h / 2, (sz * CASE.d) / 2);
        this.root.add(corner);
      }
      const latch = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.35, 0.12), brass);
      latch.position.set(sx * 2.6, CASE.h - 0.1, CASE.d / 2 + 0.05);
      this.root.add(latch);
    }

    // Couvercle : pivote autour de l'arête arrière.
    const lidBox = new THREE.Mesh(new THREE.BoxGeometry(CASE.w, 0.6, CASE.d), leather);
    lidBox.position.set(0, 0.3, CASE.d / 2);
    const lidLining = new THREE.Mesh(new THREE.PlaneGeometry(CASE.w - 0.5, CASE.d - 0.5), velvet);
    lidLining.rotation.x = Math.PI / 2;
    lidLining.position.set(0, -0.01, CASE.d / 2);
    const handle = new THREE.Mesh(new THREE.TorusGeometry(0.55, 0.09, 4, 10, Math.PI), brass);
    handle.position.set(0, 0.6, CASE.d - 0.2);
    this.lid.add(lidBox, lidLining, handle);
    this.lid.position.set(0, CASE.h, -CASE.d / 2);
    this.root.add(this.lid);
    this.root.position.set(CASE.x, 0, CASE.z);
    this.root.traverse((o) => ((o as THREE.Mesh).castShadow = (o as THREE.Mesh).receiveShadow = true));

    // Sonnette de comptoir : on la frappe pour relancer la valise.
    const bellBase = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.6, 0.18, 10), new THREE.MeshStandardMaterial({ color: 0x1a1210, roughness: 0.6 }));
    bellBase.position.y = 0.09;
    const dome = new THREE.Mesh(new THREE.SphereGeometry(0.45, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2), brass);
    dome.position.y = 0.18;
    const knob = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.22, 6), brass);
    knob.position.y = 0.72;
    this.bell.add(bellBase, dome, knob);
    this.bell.position.copy(BELL);
    ps1ify(this.root);
    ps1ify(this.bell);
    for (const h of [this.left, this.right]) ps1ify(h.root);
  }

  private setVisible(on: boolean) {
    this.root.visible = this.bell.visible = this.left.root.visible = this.right.root.visible = on;
  }

  // ---------------------------------------------------------------- articles

  /** Remplit la valise ; `affordable(i)` colore les prix. */
  setItems(items: (ShopItem | null)[], affordable: (i: number) => boolean, rerollCost: number, canReroll: boolean) {
    for (const s of this.slots) if (s) this.root.remove(s.object, s.tag);
    const n = Math.max(1, items.length);
    const spacing = (CASE.w - 1.4) / n;
    this.slots = items.map((item, i) => {
      if (!item) return null;
      const object = itemMesh(item);
      ps1ify(object);
      object.traverse((o) => ((o as THREE.Mesh).castShadow = true));
      const home = new THREE.Vector3(-(CASE.w - 1.4) / 2 + spacing * (i + 0.5), ITEM_Y, -0.3);
      object.position.copy(home);
      object.userData.slot = i;
      const tag = priceTag(item.price === 0 ? 'offert' : `${item.price} $`, affordable(i));
      tag.position.set(home.x, CASE.h + 0.3, 1.9);
      this.root.add(object, tag);
      return { object, tag, home, fly: null, bornAt: this.clock };
    });
    if (this.bellTag.sprite) this.bell.remove(this.bellTag.sprite);
    this.bellTag.sprite = priceTag(`↻ ${rerollCost} $`, canReroll);
    this.bellTag.sprite.position.set(0, 1.25, 0);
    this.bell.add(this.bellTag.sprite);
  }

  /** Recolore les prix (après un achat, les pièces ont changé). */
  refreshTags(items: (ShopItem | null)[], affordable: (i: number) => boolean, rerollCost: number, canReroll: boolean) {
    this.slots.forEach((s, i) => {
      const item = items[i];
      if (!s || s.fly || !item) return;
      this.root.remove(s.tag);
      s.tag = priceTag(item.price === 0 ? 'offert' : `${item.price} $`, affordable(i));
      s.tag.position.set(s.home.x, CASE.h + 0.3, 1.9);
      this.root.add(s.tag);
    });
    if (this.bellTag.sprite) this.bell.remove(this.bellTag.sprite);
    this.bellTag.sprite = priceTag(`↻ ${rerollCost} $`, canReroll);
    this.bellTag.sprite.position.set(0, 1.25, 0);
    this.bell.add(this.bellTag.sprite);
  }

  /** L'article acheté s'envole vers sa place (rebord, tapis, ardoise). */
  flyAway(index: number, to: THREE.Vector3, onArrive: () => void) {
    const slot = this.slots[index];
    if (!slot) return onArrive();
    this.root.remove(slot.tag);
    const world = slot.object.getWorldPosition(new THREE.Vector3());
    this.root.remove(slot.object);
    this.scene.add(slot.object);
    slot.object.position.copy(world);
    slot.fly = { from: world, to: to.clone(), t: 0, onArrive };
  }

  // ---------------------------------------------------------------- arrivée / départ

  open() {
    this.state = 'arriving';
    this.t = 0;
    this.setVisible(true);
    this.lid.rotation.x = 0;
    this.sfx.burst({ type: 'lowpass', freq: 400, duration: 0.7, volume: 0.5 }); // la valise glisse sur le feutre
  }

  /** Nouvelle run : la valise disparaît sans animation. */
  reset() {
    for (const s of this.slots) if (s) this.root.remove(s.object, s.tag);
    this.slots = [];
    this.state = 'hidden';
    this.onLeft = null;
    this.setVisible(false);
  }

  close(onLeft: () => void) {
    if (this.state !== 'open') return;
    this.state = 'leaving';
    this.t = 0;
    this.onLeft = onLeft;
    this.hover(null);
  }

  // ---------------------------------------------------------------- interaction

  pick(raycaster: THREE.Raycaster): SuitcaseTarget {
    if (this.state !== 'open') return null;
    const objects: THREE.Object3D[] = [this.bell, this.lid];
    for (const s of this.slots) if (s && !s.fly) objects.push(s.object);
    const hit = raycaster.intersectObjects(objects, true)[0];
    if (!hit) return null;
    for (let o: THREE.Object3D | null = hit.object; o; o = o.parent) {
      if (o === this.bell) return { kind: 'bell' };
      if (o === this.lid) return { kind: 'lid' };
      if (o.userData.slot !== undefined) return { kind: 'item', index: o.userData.slot };
    }
    return null;
  }

  hover(target: SuitcaseTarget) {
    this.hovered = target;
    for (const m of this.lidMaterials) m.emissive.setHex(target?.kind === 'lid' ? 0x2a1006 : 0x000000);
  }

  /** La sonnette sonne (relance) : les articles s'enfoncent puis remontent. */
  ring() {
    this.sfx.toneAt(0, 2400, 2350, 0.9, 0.18);
    this.sfx.toneAt(0, 3600, 3550, 0.6, 0.08);
  }

  // ---------------------------------------------------------------- animation

  update(dt: number, clock: number) {
    this.clock = clock;
    this.t += dt;
    const t = this.t;
    const rest = { l: new THREE.Vector3(-6.6, 0.9, -1.8), r: new THREE.Vector3(6.4, 0.9, -2.4) };
    let caseZ = CASE.z;
    let lid = LID_OPEN;
    let l = rest.l.clone();
    let r = rest.r.clone();
    let pitch = 0;
    let curl = 0.35;

    if (this.state === 'arriving') {
      // Poussée (0–0.7 s), mains sur le couvercle (0.7–1.1), ouverture (1.1–1.8), repos.
      const push = ease(clamp01(t / 0.7));
      caseZ = THREE.MathUtils.lerp(-7, CASE.z, push);
      const lift = ease(clamp01((t - 1.1) / 0.7));
      lid = LID_OPEN * lift;
      const front = this.lidFront(caseZ, lid);
      const behind = new THREE.Vector3(0, CASE.h + 0.3, caseZ - CASE.d / 2 - 1.6);
      const toLid = ease(clamp01((t - 0.7) / 0.4));
      const toRest = ease(clamp01((t - 1.8) / 0.5));
      for (const [hand, side] of [[l, -1], [r, 1]] as const) {
        const grip = behind.clone().setX(side * 1.8).lerp(front.clone().setX(side * 1.6), toLid);
        hand.copy(grip.lerp(side < 0 ? rest.l : rest.r, toRest));
      }
      pitch = THREE.MathUtils.lerp(-0.2, 0.6, toLid) * (1 - toRest);
      curl = THREE.MathUtils.lerp(0.1, 0.6, toLid);
      if (t > 1.1 && t - dt <= 1.1) this.sfx.burst({ type: 'bandpass', freq: 300, freqEnd: 180, q: 3, duration: 0.6, volume: 0.6 }); // charnière
      if (t > 2.3) this.state = 'open';
    } else if (this.state === 'leaving') {
      // Mains sur le couvercle (0–0.4), fermeture (0.4–0.9), retrait (0.9–1.6).
      const shut = ease(clamp01((t - 0.4) / 0.5));
      lid = LID_OPEN * (1 - shut);
      const pull = ease(clamp01((t - 0.9) / 0.7));
      caseZ = THREE.MathUtils.lerp(CASE.z, -7, pull);
      const front = this.lidFront(caseZ, lid);
      const grab = ease(clamp01(t / 0.4)) * (1 - ease(clamp01((t - 1.3) / 0.3)));
      l = rest.l.clone().lerp(front.clone().setX(-1.6), grab);
      r = rest.r.clone().lerp(front.clone().setX(1.6), grab);
      pitch = 0.6 * grab;
      curl = 0.6;
      if (t > 0.9 && t - dt <= 0.9) this.sfx.knock(); // le couvercle claque
      if (t > 1.7) {
        this.state = 'hidden';
        this.setVisible(false);
        for (const s of this.slots) if (s) this.root.remove(s.object, s.tag);
        this.slots = [];
        const done = this.onLeft;
        this.onLeft = null;
        done?.();
      }
    } else if (this.state === 'open') {
      // Les doigts du marchand pianotent doucement sur le feutre en attendant.
      const breathe = Math.sin(clock * 1.3) * 0.04;
      l.y += breathe;
      r.y += breathe;
    }

    this.root.position.z = caseZ;
    this.lid.rotation.x = lid;
    this.poseHand(this.left, l, 0.2, pitch, curl);
    this.poseHand(this.right, r, -0.2, pitch, curl);
    this.updateSlots(dt);
    // La sonnette frémit quand on la survole.
    this.bell.scale.setScalar(this.hovered?.kind === 'bell' ? 1.12 : 1);
  }

  /** Position monde du bord avant du couvercle (là où le marchand l'attrape). */
  private lidFront(caseZ: number, lidAngle: number) {
    const p = new THREE.Vector3(0, 0.7, CASE.d);
    p.applyAxisAngle(new THREE.Vector3(1, 0, 0), lidAngle);
    return p.add(new THREE.Vector3(CASE.x, CASE.h, caseZ - CASE.d / 2));
  }

  private poseHand(hand: Hand, pos: THREE.Vector3, yaw: number, pitch: number, curl: number) {
    // Les bras viennent de derrière : la main pointe vers le joueur.
    hand.root.position.copy(pos);
    hand.root.rotation.set(pitch, yaw, 0, 'YXZ');
    hand.curl.fill(curl);
    hand.curl[4] = 0.5;
    hand.pose();
  }

  private updateSlots(dt: number) {
    this.slots.forEach((s, i) => {
      if (!s) return;
      if (s.fly) {
        s.fly.t += dt / 0.55;
        const k = ease(Math.min(1, s.fly.t));
        s.object.position.lerpVectors(s.fly.from, s.fly.to, k);
        s.object.position.y += Math.sin(k * Math.PI) * 2.5;
        s.object.scale.setScalar((s.object.userData.baseScale ?? 1) * (1 - k * 0.5));
        if (s.fly.t >= 1) {
          this.scene.remove(s.object);
          this.slots[i] = null;
          s.fly.onArrive();
        }
        return;
      }
      // Apparition, flottement léger, soulèvement au survol.
      const born = clamp01((this.clock - s.bornAt) / 0.4);
      const hovered = this.hovered?.kind === 'item' && this.hovered.index === i;
      const lift = hovered ? 0.35 : 0;
      s.object.position.set(s.home.x, s.home.y + lift + Math.sin(this.clock * 1.2 + i) * 0.04, s.home.z);
      s.object.rotation.y += dt * (hovered ? 1.4 : 0.25);
      s.object.scale.setScalar(ease(born) * (hovered ? 1.12 : 1) * (s.object.userData.baseScale ?? 1));
    });
  }
}
