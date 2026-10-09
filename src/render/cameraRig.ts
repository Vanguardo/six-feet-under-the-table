import * as THREE from 'three';

/** Caméra assise : respiration, micro-tremblement, sursauts. Jamais de déplacement libre. */
export class CameraRig {
  private readonly base: THREE.Vector3;
  private readonly target: THREE.Vector3;
  private shake = 0;

  constructor(private readonly camera: THREE.PerspectiveCamera, target: THREE.Vector3) {
    this.base = camera.position.clone();
    this.target = target.clone();
  }

  /** Sursaut : `amount` ≈ 1 pour une frappe sur la table. */
  jolt(amount: number) {
    this.shake = Math.max(this.shake, amount);
  }

  /** Débogage : fige la caméra (gros plans). */
  frozen = false;

  update(time: number, dt: number) {
    if (this.frozen) return;
    this.shake = Math.max(0, this.shake - dt * 2.2);
    const breath = Math.sin(time * 1.4) * 0.06;
    const sway = Math.sin(time * 0.37) * 0.05;
    const s = this.shake * this.shake;
    this.camera.position.set(
      this.base.x + sway + (Math.random() - 0.5) * s * 0.5,
      this.base.y + breath + (Math.random() - 0.5) * s * 0.5,
      this.base.z + (Math.random() - 0.5) * s * 0.2,
    );
    this.camera.lookAt(this.target.x + sway * 0.3, this.target.y + breath * 0.4, this.target.z);
  }
}
