/**
 * Du sang sur tes yeux : des éclaboussures dessinées à même l'écran, qui coulent lentement
 * vers le bas puis s'effacent. Placées du côté de la plaie (la bouche en bas, l'oreille à droite…).
 */
interface Drip {
  x: number;
  y: number;
  speed: number;
  width: number;
  left: number;
}

const SCALE = 0.5; // demi-résolution : le flou de l'écran fait le reste

export class LensBlood {
  private readonly canvas = document.createElement('canvas');
  private readonly g: CanvasRenderingContext2D;
  private drips: Drip[] = [];
  private active = 0;

  constructor() {
    const c = this.canvas;
    c.style.cssText = 'position:fixed;inset:0;width:100%;height:100%;pointer-events:none;z-index:3;filter:blur(1.2px);opacity:0.92';
    document.body.appendChild(c);
    this.g = c.getContext('2d')!;
    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  private resize() {
    this.canvas.width = Math.max(1, Math.round(window.innerWidth * SCALE));
    this.canvas.height = Math.max(1, Math.round(window.innerHeight * SCALE));
  }

  private blob(x: number, y: number, r: number, alpha: number) {
    const g = this.g;
    const grad = g.createRadialGradient(x, y, 0, x, y, r);
    grad.addColorStop(0, `rgba(150, 6, 6, ${alpha})`);
    grad.addColorStop(0.7, `rgba(118, 2, 2, ${alpha * 0.92})`);
    grad.addColorStop(1, 'rgba(60, 0, 0, 0)');
    g.fillStyle = grad;
    g.beginPath();
    g.arc(x, y, r, 0, Math.PI * 2);
    g.fill();
    // Un reflet sur les grosses gouttes : c'est liquide, et c'est sur toi.
    if (r > 7) {
      g.fillStyle = 'rgba(255, 200, 190, 0.28)';
      g.beginPath();
      g.ellipse(x - r * 0.3, y - r * 0.35, r * 0.22, r * 0.12, -0.5, 0, Math.PI * 2);
      g.fill();
    }
  }

  /**
   * Une giclée centrée en (u, v) (0..1, depuis le coin haut gauche), de force `amount` (≈ 1).
   */
  splash(u: number, v: number, amount = 1) {
    const w = this.canvas.width;
    const h = this.canvas.height;
    const unit = Math.min(w, h);
    const cx = u * w;
    const cy = v * h;
    const n = Math.round(14 + amount * 30);
    for (let i = 0; i < n; i++) {
      // Les grosses gouttes près du point d'impact, les fines plus loin.
      const a = Math.random() * Math.PI * 2;
      const d = Math.pow(Math.random(), 1.6) * unit * 0.42 * amount;
      const r = (1 - d / (unit * 0.42 * amount + 1)) * unit * (0.018 + Math.random() * 0.07) * Math.sqrt(amount);
      const x = cx + Math.cos(a) * d * 1.4;
      const y = cy + Math.sin(a) * d;
      this.blob(x, y, Math.max(1.5, r), 0.9);
      // Éclats en couronne autour des grosses gouttes.
      if (r > unit * 0.03) {
        for (let k = 0; k < 5; k++) {
          const b = Math.random() * Math.PI * 2;
          this.blob(x + Math.cos(b) * r * 1.3, y + Math.sin(b) * r * 1.3, r * (0.12 + Math.random() * 0.15), 0.85);
        }
        if (Math.random() < 0.7) this.drips.push({ x, y: y + r * 0.6, speed: unit * (0.03 + Math.random() * 0.07), width: r * (0.25 + Math.random() * 0.25), left: 1.5 + Math.random() * 3 });
      }
    }
    this.active = 7;
  }

  update(dt: number) {
    if (this.active <= 0) return;
    this.active -= dt;
    const g = this.g;
    // Les coulures descendent en laissant leur trace, de plus en plus lentement.
    for (const d of this.drips) {
      const step = d.speed * dt;
      g.fillStyle = 'rgba(128, 4, 4, 0.9)';
      g.beginPath();
      g.ellipse(d.x, d.y, d.width, d.width * 1.4, 0, 0, Math.PI * 2);
      g.fill();
      d.y += step;
      d.x += (Math.random() - 0.5) * step * 0.3;
      d.speed *= Math.exp(-dt * 0.5);
      d.width *= Math.exp(-dt * 0.12);
      d.left -= dt;
    }
    this.drips = this.drips.filter((d) => d.left > 0 && d.y < this.canvas.height);
    // Tout s'efface doucement.
    g.globalCompositeOperation = 'destination-out';
    g.fillStyle = `rgba(0, 0, 0, ${Math.min(1, dt * (this.active < 2.5 ? 1.2 : 0.18))})`;
    g.fillRect(0, 0, this.canvas.width, this.canvas.height);
    g.globalCompositeOperation = 'source-over';
    if (this.active <= 0) this.clear();
  }

  clear() {
    this.g.clearRect(0, 0, this.canvas.width, this.canvas.height);
    this.drips = [];
    this.active = 0;
  }
}
