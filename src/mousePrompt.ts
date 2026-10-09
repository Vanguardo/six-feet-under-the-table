import * as THREE from 'three';

/** Dessine une souris de profil haut : corps, deux boutons, le gauche enfoncé ou non. */
function mouseTexture(pressed: boolean) {
  const canvas = document.createElement('canvas');
  canvas.width = 64;
  canvas.height = 96;
  const g = canvas.getContext('2d')!;
  const body = new Path2D('M32 8 C50 8 56 24 56 44 L56 66 C56 82 46 90 32 90 C18 90 8 82 8 66 L8 44 C8 24 14 8 32 8 Z');
  g.fillStyle = '#e8dcc0';
  g.fill(body);
  g.lineWidth = 4;
  g.strokeStyle = '#1a0e08';
  g.stroke(body);
  // Bouton gauche : rouge quand il est enfoncé.
  const left = new Path2D('M30 10 C16 11 10 24 10 42 L30 42 Z');
  g.fillStyle = pressed ? '#c8102e' : '#d0c4a8';
  g.fill(left);
  g.lineWidth = 3;
  g.beginPath();
  g.moveTo(32, 10);
  g.lineTo(32, 42);
  g.moveTo(10, 43);
  g.lineTo(54, 43);
  g.stroke();
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.magFilter = THREE.NearestFilter;
  return tex;
}

/** Flèches de secousse, de part et d'autre de la souris. */
function shakeTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 160;
  canvas.height = 48;
  const g = canvas.getContext('2d')!;
  g.fillStyle = '#ffcc33';
  for (const dir of [-1, 1]) {
    const x = 80 + dir * 62;
    g.beginPath();
    g.moveTo(x + dir * 14, 24);
    g.lineTo(x - dir * 4, 8);
    g.lineTo(x - dir * 4, 40);
    g.closePath();
    g.fill();
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.magFilter = THREE.NearestFilter;
  return tex;
}

const sprite = (map: THREE.Texture) =>
  new THREE.Sprite(new THREE.SpriteMaterial({ map, transparent: true, depthTest: false, depthWrite: false, fog: false }));

/**
 * Petite souris au-dessus du gobelet : le bouton s'enfonce, puis elle se secoue.
 * « Clic maintenu, secoue, relâche », sans un mot.
 */
export class MousePrompt {
  private readonly group = new THREE.Group();
  private readonly mouse: THREE.Sprite;
  private readonly arrows: THREE.Sprite;
  private readonly idle = mouseTexture(false);
  private readonly pressed = mouseTexture(true);
  private alpha = 0;
  private alphaTarget = 0;

  constructor(scene: THREE.Scene) {
    this.mouse = sprite(this.idle);
    this.mouse.scale.set(1.1, 1.65, 1);
    this.arrows = sprite(shakeTexture());
    this.arrows.scale.set(3, 0.9, 1);
    this.group.add(this.arrows, this.mouse);
    this.group.renderOrder = 30;
    this.mouse.renderOrder = this.arrows.renderOrder = 30;
    this.group.visible = false;
    scene.add(this.group);
  }

  show(on: boolean) {
    this.alphaTarget = on ? 1 : 0;
  }

  update(dt: number, clock: number, anchor: THREE.Vector3) {
    this.alpha += (this.alphaTarget - this.alpha) * (1 - Math.exp(-dt * 8));
    this.group.visible = this.alpha > 0.01;
    if (!this.group.visible) return;
    // Cycle de 2 s : clic (0–0,5), secousse (0,5–1,6), relâche (1,6–2).
    const t = clock % 2;
    const holding = t > 0.25 && t < 1.6;
    const shaking = t > 0.5 && t < 1.6;
    this.mouse.material.map = holding ? this.pressed : this.idle;
    const shake = shaking ? Math.sin((t - 0.5) * 22) * 0.35 : 0;
    this.group.position.set(anchor.x, anchor.y + 5.6 + Math.sin(clock * 2) * 0.08, anchor.z);
    this.mouse.position.set(shake, 0, 0);
    this.arrows.position.set(0, 0, 0);
    this.mouse.material.opacity = this.alpha;
    this.arrows.material.opacity = this.alpha * (shaking ? 1 : 0.25);
  }
}
