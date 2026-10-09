import * as THREE from 'three';

export const CHIPS_COLOR = '#5fa8e8';
export const MULT_COLOR = '#e8483f';
export const XMULT_COLOR = '#e86ae0';
export const COIN_COLOR = '#f2c14e';

const LIFETIME = 0.9;

interface Floating {
  sprite: THREE.Sprite;
  born: number;
  origin: THREE.Vector3;
  size: number;
}

function textTexture(text: string, color: string) {
  const height = 64;
  const canvas = document.createElement('canvas');
  const g = canvas.getContext('2d')!;
  const font = 'bold 46px "Courier New", monospace';
  g.font = font;
  canvas.width = Math.ceil(g.measureText(text).width + 24);
  canvas.height = height;
  g.font = font;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.lineWidth = 8;
  g.strokeStyle = '#0a0503';
  g.strokeText(text, canvas.width / 2, height / 2 + 2);
  g.fillStyle = color;
  g.fillText(text, canvas.width / 2, height / 2 + 2);
  const tex = new THREE.CanvasTexture(canvas);
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  tex.colorSpace = THREE.SRGBColorSpace;
  return { tex, aspect: canvas.width / height };
}

/** Textes qui jaillissent d'un dé ou d'une relique pendant le scoring (« +4 Mult », « ×3 »). */
export class FloatTexts {
  private readonly items: Floating[] = [];

  constructor(private readonly scene: THREE.Scene) {}

  spawn(text: string, color: string, at: THREE.Vector3, clock: number, size = 0.9) {
    const { tex, aspect } = textTexture(text, color);
    const sprite = new THREE.Sprite(
      new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false, depthWrite: false }),
    );
    sprite.renderOrder = 20;
    sprite.userData.aspect = aspect;
    this.scene.add(sprite);
    this.items.push({ sprite, born: clock, origin: at.clone(), size });
  }

  update(clock: number) {
    for (let i = this.items.length - 1; i >= 0; i--) {
      const f = this.items[i];
      const t = (clock - f.born) / LIFETIME;
      if (t >= 1) {
        this.scene.remove(f.sprite);
        f.sprite.material.map?.dispose();
        f.sprite.material.dispose();
        this.items.splice(i, 1);
        continue;
      }
      const pop = t < 0.15 ? 0.6 + (t / 0.15) * 0.55 : 1.15 - Math.min(0.15, (t - 0.15) * 0.6);
      f.sprite.scale.set(f.size * pop * f.sprite.userData.aspect, f.size * pop, 1);
      f.sprite.position.copy(f.origin).add(new THREE.Vector3(0, 1.4 + t * 1.3, 0));
      f.sprite.material.opacity = t < 0.6 ? 1 : 1 - (t - 0.6) / 0.4;
    }
  }
}
