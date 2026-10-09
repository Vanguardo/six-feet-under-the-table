import * as THREE from 'three';

/** Caméra assise : respiration, micro-tremblement, sursauts. Jamais de déplacement libre. */
export class CameraRig {
  private readonly base: THREE.Vector3;
  private readonly target: THREE.Vector3;
  private shake = 0;
  /** Penché en avant (0 = assis, 1 = penché sur la cible). */
  private lean = 0;
  private leanTarget = 0;
  private readonly leanPosition = new THREE.Vector3();
  private readonly leanLook = new THREE.Vector3();

  constructor(private readonly camera: THREE.PerspectiveCamera, target: THREE.Vector3) {
    this.base = camera.position.clone();
    this.target = target.clone();
  }

  /** Débogage : fige la caméra (gros plans). */
  frozen = false;

  /** Sursaut : `amount` ≈ 1 pour une frappe sur la table. */
  jolt(amount: number) {
    this.shake = Math.max(this.shake, amount);
  }

  /** Se pencher au-dessus d'un point de la table (lire le contrat), ou se rasseoir (`null`). */
  leanOver(point: THREE.Vector3 | null) {
    if (!point) {
      this.leanTarget = 0;
      return;
    }
    this.leanLook.copy(point);
    this.leanPosition.set(point.x, point.y + 7, point.z + 5);
    this.leanTarget = 1;
  }

  update(time: number, dt: number) {
    if (this.frozen) return;
    this.shake = Math.max(0, this.shake - dt * 2.2);
    this.lean += (this.leanTarget - this.lean) * (1 - Math.exp(-dt * 2.5));
    const k = this.lean * this.lean * (3 - 2 * this.lean);
    const breath = Math.sin(time * 1.4) * 0.06;
    const sway = Math.sin(time * 0.37) * 0.05;
    const s = this.shake * this.shake;
    const pos = this.base.clone().lerp(this.leanPosition, k);
    const look = this.target.clone().lerp(this.leanLook, k);
    this.camera.position.set(
      pos.x + sway + (Math.random() - 0.5) * s * 0.5,
      pos.y + breath + (Math.random() - 0.5) * s * 0.5,
      pos.z + (Math.random() - 0.5) * s * 0.2,
    );
    this.camera.lookAt(look.x + sway * 0.3, look.y + breath * 0.4, look.z);
  }
}
