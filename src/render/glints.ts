import * as THREE from 'three';

/** Étoile à quatre branches : l'éclat d'une arête polie qui accroche l'ampoule. */
function starTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  const core = g.createRadialGradient(32, 32, 0, 32, 32, 10);
  core.addColorStop(0, 'rgba(255,255,255,1)');
  core.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = core;
  g.fillRect(0, 0, 64, 64);
  for (const [w, h] of [[64, 3], [3, 64]]) {
    const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    grad.addColorStop(0, 'rgba(255,255,255,0.95)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grad;
    g.fillRect(32 - w / 2, 32 - h / 2, w, h);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

interface Glint {
  sprite: THREE.Sprite;
  age: number;
  life: number;
  size: number;
}

/** Éclats brefs sur les dés qui marquent et sur l'or : ils naissent, tournent, s'éteignent. */
export class Glints {
  private readonly pool: Glint[] = [];
  private readonly material: THREE.SpriteMaterial;

  constructor(private readonly scene: THREE.Scene) {
    this.material = new THREE.SpriteMaterial({ map: starTexture(), color: 0xfff0c0, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false, fog: false });
  }

  spawn(at: THREE.Vector3, size = 1.1, life = 0.45) {
    let g = this.pool.find((p) => p.age >= p.life);
    if (!g) {
      const sprite = new THREE.Sprite(this.material.clone());
      sprite.renderOrder = 10;
      this.scene.add(sprite);
      g = { sprite, age: 0, life, size };
      this.pool.push(g);
    }
    g.age = 0;
    g.life = life;
    g.size = size;
    g.sprite.position.copy(at);
    g.sprite.material.rotation = Math.random() * Math.PI;
    g.sprite.visible = true;
  }

  update(dt: number) {
    for (const g of this.pool) {
      if (g.age >= g.life) continue;
      g.age += dt;
      const k = Math.min(1, g.age / g.life);
      // Éclat : monte vite, retombe lentement, en tournant d'un quart de tour.
      const pulse = k < 0.25 ? k / 0.25 : 1 - (k - 0.25) / 0.75;
      g.sprite.scale.setScalar(g.size * (0.3 + pulse));
      g.sprite.material.opacity = pulse;
      g.sprite.material.rotation += dt * 2.5;
      if (k >= 1) g.sprite.visible = false;
    }
  }
}
