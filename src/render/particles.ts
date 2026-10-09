import * as THREE from 'three';
import { RENDER_SCALE } from '../config';

export interface ParticleStyle {
  max: number;
  /** Durée de vie en secondes, tirée entre les deux bornes. */
  life: [number, number];
  /** Taille au début et à la fin de la vie (unités du monde). */
  size: [number, number];
  /** Opacité maximale. */
  alpha: number;
  gravity: number;
  /** Freinage par seconde (0 = aucun). */
  drag: number;
  additive?: boolean;
  /** Bord du disque : 0 = net (éclats), 1 = très flou (fumée). */
  softness: number;
}

export interface Emit {
  position: THREE.Vector3;
  velocity: THREE.Vector3;
  color: THREE.Color;
  /** Multiplie la taille de la particule. */
  scale?: number;
}

const vertexShader = /* glsl */ `
  attribute float aSize;
  attribute float aAlpha;
  attribute vec3 aColor;
  uniform float uScale;
  varying float vAlpha;
  varying vec3 vColor;
  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = aSize * uScale / -mv.z;
    gl_Position = projectionMatrix * mv;
    vAlpha = aAlpha;
    vColor = aColor;
  }`;

const fragmentShader = /* glsl */ `
  uniform float uSoftness;
  varying float vAlpha;
  varying vec3 vColor;
  void main() {
    float d = length(gl_PointCoord - 0.5) * 2.0;
    float a = 1.0 - smoothstep(1.0 - uSoftness, 1.0, d);
    if (a <= 0.01 || vAlpha <= 0.01) discard;
    gl_FragColor = vec4(vColor, a * vAlpha);
  }`;

/** Petit système de particules : fumée de feutre, copeaux de bois. */
export class Particles {
  private readonly points: THREE.Points;
  private readonly pos: Float32Array;
  private readonly vel: Float32Array;
  private readonly age: Float32Array;
  private readonly life: Float32Array;
  private readonly scale: Float32Array;
  private readonly sizeAttr: THREE.BufferAttribute;
  private readonly alphaAttr: THREE.BufferAttribute;
  private readonly colorAttr: THREE.BufferAttribute;
  private next = 0;

  constructor(scene: THREE.Scene, private readonly style: ParticleStyle) {
    const n = style.max;
    this.pos = new Float32Array(n * 3);
    this.vel = new Float32Array(n * 3);
    this.age = new Float32Array(n).fill(1);
    this.life = new Float32Array(n).fill(1);
    this.scale = new Float32Array(n).fill(1);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    this.sizeAttr = new THREE.BufferAttribute(new Float32Array(n), 1);
    this.alphaAttr = new THREE.BufferAttribute(new Float32Array(n), 1);
    this.colorAttr = new THREE.BufferAttribute(new Float32Array(n * 3), 3);
    geo.setAttribute('aSize', this.sizeAttr);
    geo.setAttribute('aAlpha', this.alphaAttr);
    geo.setAttribute('aColor', this.colorAttr);
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1000);
    this.points = new THREE.Points(
      geo,
      new THREE.ShaderMaterial({
        vertexShader,
        fragmentShader,
        uniforms: { uScale: { value: 600 }, uSoftness: { value: style.softness } },
        transparent: true,
        depthWrite: false,
        blending: style.additive ? THREE.AdditiveBlending : THREE.NormalBlending,
      }),
    );
    this.points.frustumCulled = false;
    scene.add(this.points);
    window.addEventListener('resize', () => this.resize());
    this.resize();
  }

  private resize() {
    // Taille en pixels d'une unité à distance 1 : hauteur du rendu / (2 tan(fov / 2)), fov = 50°.
    const height = window.innerHeight * Math.min(window.devicePixelRatio, 1) * RENDER_SCALE;
    (this.points.material as THREE.ShaderMaterial).uniforms.uScale.value = height / (2 * Math.tan(THREE.MathUtils.degToRad(25)));
  }

  emit(e: Emit) {
    const i = this.next;
    this.next = (this.next + 1) % this.style.max;
    this.pos.set([e.position.x, e.position.y, e.position.z], i * 3);
    this.vel.set([e.velocity.x, e.velocity.y, e.velocity.z], i * 3);
    this.colorAttr.setXYZ(i, e.color.r, e.color.g, e.color.b);
    const [a, b] = this.style.life;
    this.life[i] = a + Math.random() * (b - a);
    this.age[i] = 0;
    this.scale[i] = e.scale ?? 1;
  }

  update(dt: number) {
    const s = this.style;
    const damp = Math.exp(-s.drag * dt);
    for (let i = 0; i < s.max; i++) {
      if (this.age[i] >= this.life[i]) {
        this.alphaAttr.setX(i, 0);
        continue;
      }
      this.age[i] += dt;
      const t = Math.min(1, this.age[i] / this.life[i]);
      const k = i * 3;
      this.vel[k + 1] += s.gravity * dt;
      for (let c = 0; c < 3; c++) {
        this.vel[k + c] *= damp;
        this.pos[k + c] += this.vel[k + c] * dt;
      }
      // Les copeaux s'arrêtent sur la table au lieu de passer à travers.
      if (s.gravity < 0 && this.pos[k + 1] < 0.03) {
        this.pos[k + 1] = 0.03;
        this.vel[k] *= 0.5;
        this.vel[k + 1] = 0;
        this.vel[k + 2] *= 0.5;
      }
      this.sizeAttr.setX(i, (s.size[0] + (s.size[1] - s.size[0]) * t) * this.scale[i]);
      // Apparition rapide, disparition lente.
      this.alphaAttr.setX(i, s.alpha * Math.min(1, t * 8) * (1 - t) ** 1.5);
    }
    (this.points.geometry.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
    this.sizeAttr.needsUpdate = true;
    this.alphaAttr.needsUpdate = true;
    this.colorAttr.needsUpdate = true;
  }
}
