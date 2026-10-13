import * as THREE from 'three';

const textures = new Map<string, THREE.Texture>();

function digitTexture(value: number, scoring: boolean): THREE.Texture {
  const key = `${value}-${scoring}`;
  const cached = textures.get(key);
  if (cached) return cached;
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const g = canvas.getContext('2d')!;
  // Chiffre gravé à l'ancienne : contour d'encre, dorure qui luit si le dé marque.
  g.font = '104px "IM Fell English SC", Georgia, serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  const y = size / 2 + 8;
  if (scoring) {
    g.shadowColor = 'rgba(255, 190, 70, 0.9)';
    g.shadowBlur = 18;
  }
  g.lineWidth = 12;
  g.strokeStyle = '#0a0503';
  g.strokeText(String(value), size / 2, y);
  g.shadowBlur = 0;
  const grad = g.createLinearGradient(0, 20, 0, 110);
  if (scoring) {
    grad.addColorStop(0, '#fff2b8');
    grad.addColorStop(0.5, '#f2c14e');
    grad.addColorStop(1, '#a8701a');
  } else {
    grad.addColorStop(0, '#d8cfb8');
    grad.addColorStop(1, '#7a7060');
  }
  g.fillStyle = grad;
  g.fillText(String(value), size / 2, y);
  const tex = new THREE.CanvasTexture(canvas);
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearFilter;
  tex.colorSpace = THREE.SRGBColorSpace;
  textures.set(key, tex);
  return tex;
}

// Dépassement en fin de course : le chiffre « claque » avant de se poser.
const easeOutBack = (t: number) => {
  const c = 1.9;
  return 1 + (c + 1) * (t - 1) ** 3 + c * (t - 1) ** 2;
};

const POP_DURATION = 0.32;

/** Chiffre flottant au-dessus d'un dé, révélé avec un rebond. */
export class DieLabel {
  private readonly sprite: THREE.Sprite;
  private shownAt = -1;
  private size = 1;

  constructor(scene: THREE.Scene) {
    this.sprite = new THREE.Sprite(
      new THREE.SpriteMaterial({ transparent: true, depthTest: false, depthWrite: false }),
    );
    this.sprite.renderOrder = 10;
    this.sprite.visible = false;
    scene.add(this.sprite);
  }

  show(value: number, scoring: boolean, at: number) {
    this.sprite.material.map = digitTexture(value, scoring);
    this.sprite.material.needsUpdate = true;
    this.size = scoring ? 1.5 : 1.05;
    this.shownAt = at;
    this.sprite.visible = true;
    this.sprite.scale.setScalar(0);
  }

  hide() {
    this.shownAt = -1;
    this.sprite.visible = false;
  }

  update(clock: number, diePosition: THREE.Vector3) {
    if (this.shownAt < 0) return;
    const t = (clock - this.shownAt) / POP_DURATION;
    const k = t <= 0 ? 0 : t >= 1 ? 1 : easeOutBack(t);
    const bob = t >= 1 ? Math.sin(clock * 3 + diePosition.x) * 0.06 : 0;
    this.sprite.scale.setScalar(this.size * k);
    this.sprite.position.set(diePosition.x, diePosition.y + 1.05 + 0.25 * k + bob, diePosition.z);
  }
}
