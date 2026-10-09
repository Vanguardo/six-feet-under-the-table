import * as THREE from 'three';

const easeInOut = (t: number) => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2);

/** Interpolation de pose pour les corps cinématiques (gobelet, dés gardés). */
export class KinematicTween {
  private elapsed = 0;
  done = false;
  private readonly pose = { position: new THREE.Vector3(), quaternion: new THREE.Quaternion() };

  constructor(
    private readonly fromPos: THREE.Vector3,
    private readonly fromRot: THREE.Quaternion,
    private readonly toPos: THREE.Vector3,
    private readonly toRot: THREE.Quaternion,
    private readonly duration: number,
    readonly onDone?: () => void,
    private readonly ease: (t: number) => number = easeInOut,
  ) {}

  advance(dt: number) {
    this.elapsed += dt;
    const t = Math.min(1, this.elapsed / this.duration);
    this.done = t >= 1;
    const k = this.ease(t);
    this.pose.position.lerpVectors(this.fromPos, this.toPos, k);
    this.pose.quaternion.slerpQuaternions(this.fromRot, this.toRot, k);
    return this.pose;
  }
}
