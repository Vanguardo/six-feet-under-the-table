import * as THREE from 'three';

const textures = new Map<string, THREE.Texture>();

function digitTexture(value: number, scoring: boolean): THREE.Texture {
  const key = `${value}-${scoring}`;
  const cached = textures.get(key);
  if (cached) return cached;
  const size = 64;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const g = canvas.getContext('2d')!;
  g.font = 'bold 50px "Courier New", monospace';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.lineWidth = 8;
  g.strokeStyle = '#0a0503';
  g.strokeText(String(value), size / 2, size / 2 + 3);
  g.fillStyle = scoring ? '#f2c14e' : '#9c927c';
  g.fillText(String(value), size / 2, size / 2 + 3);
  const tex = new THREE.CanvasTexture(canvas);
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
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
