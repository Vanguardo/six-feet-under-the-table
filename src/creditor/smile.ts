import * as THREE from 'three';

const HALF_W = 1.6;
const OPEN = 0.7;
const TEETH = 22;
export const SMILE_Y = 5.2;
const SMILE_SCALE = 1.35;

const top = (x: number) => 0.45 * (x / HALF_W) ** 2;
const gap = (x: number) => OPEN * (1 - (x / HALF_W) ** 2);

/**
 * Un sourire qui flotte dans le noir, sans visage autour : trop de dents,
 * toutes parfaitement alignées. Matériaux non éclairés, il se voit même dans l'ombre.
 */
export class Smile {
  readonly group = new THREE.Group();
  private readonly materials: THREE.MeshBasicMaterial[] = [];
  /** 0 = neutre et étroit, 1 = sourire immense. */
  private grin = 0.3;
  private grinTarget = 0.3;
  private grinUntil = 0;
  private tight = 0;
  private tightTarget = 0;
  private opacity = 1;
  private opacityTarget = 1;
  private lift = 0;
  private liftTarget = 0;

  constructor() {
    const mouth = new THREE.Shape();
    const steps = 24;
    for (let i = 0; i <= steps; i++) {
      const x = -HALF_W + (2 * HALF_W * i) / steps;
      if (i === 0) mouth.moveTo(x, top(x));
      else mouth.lineTo(x, top(x));
    }
    for (let i = steps; i >= 0; i--) {
      const x = -HALF_W + (2 * HALF_W * i) / steps;
      mouth.lineTo(x, top(x) - gap(x));
    }
    const cavity = this.material(0x1c0303);
    this.group.add(new THREE.Mesh(new THREE.ShapeGeometry(mouth), cavity));

    const tooth = this.material(0xbdb39c);
    const span = HALF_W * 1.84;
    const w = (span / TEETH) * 0.86;
    for (let i = 0; i < TEETH; i++) {
      const x = -span / 2 + (span * (i + 0.5)) / TEETH;
      const h = Math.min(0.24, gap(x) * 0.48);
      if (h < 0.03) continue;
      const geo = new THREE.BoxGeometry(w, h, 0.02);
      const upper = new THREE.Mesh(geo, tooth);
      upper.position.set(x, top(x) - h / 2, 0.01);
      const lower = new THREE.Mesh(geo, tooth);
      lower.position.set(x, top(x) - gap(x) + h / 2, 0.01);
      this.group.add(upper, lower);
    }
  }

  private material(color: number) {
    const m = new THREE.MeshBasicMaterial({ color, fog: false, transparent: true, side: THREE.DoubleSide });
    this.materials.push(m);
    return m;
  }

  /** S'élargit lentement, puis revient au neutre après `hold` secondes. */
  widen(amount: number, clock: number, hold = 2.5) {
    this.grinTarget = amount;
    this.grinUntil = clock + hold;
  }

  /** Se crispe : la bouche se ferme presque. */
  clench(on: boolean) {
    this.tightTarget = on ? 1 : 0;
  }

  /** Lève la tête : le sourire monte au-dessus de la main qui grave. */
  raise(on: boolean) {
    this.liftTarget = on ? 1 : 0;
  }

  setVisible(on: boolean) {
    this.opacityTarget = on ? 1 : 0;
  }

  update(dt: number, clock: number, camera: THREE.Camera) {
    if (clock > this.grinUntil) this.grinTarget = 0.3;
    const k = 1 - Math.exp(-dt * 1.6);
    this.grin += (this.grinTarget - this.grin) * k;
    this.tight += (this.tightTarget - this.tight) * (1 - Math.exp(-dt * 5));
    this.opacity += (this.opacityTarget - this.opacity) * (1 - Math.exp(-dt * 1.2));

    const width = (0.8 + this.grin * 0.65) * SMILE_SCALE;
    const open = (0.55 + this.grin * 0.75) * (1 - this.tight * 0.75) * SMILE_SCALE;
    this.group.scale.set(width, open, 1);
    this.lift += (this.liftTarget - this.lift) * (1 - Math.exp(-dt * 3));
    this.group.position.y = SMILE_Y + this.lift * 1.3 + Math.sin(clock * 0.5) * 0.12;
    this.group.lookAt(camera.position);
    for (const m of this.materials) m.opacity = this.opacity;
    this.group.visible = this.opacity > 0.01;
  }
}
