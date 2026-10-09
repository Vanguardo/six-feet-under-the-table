import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';

const CrtShader = {
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    uTime: { value: 0 },
    uResolution: { value: new THREE.Vector2(1, 1) },
    uAberration: { value: 0.0015 },
    uGrain: { value: 0.15 },
    uTear: { value: 0 },
    uCurvature: { value: 0.06 },
    uDim: { value: 1 },
    uEyes: { value: 0 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }`,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float uTime;
    uniform vec2 uResolution;
    uniform float uAberration;
    uniform float uGrain;
    uniform float uTear;
    uniform float uCurvature;
    uniform float uDim;
    uniform float uEyes;
    varying vec2 vUv;

    float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }

    float bayer4(vec2 p) {
      int x = int(mod(p.x, 4.0));
      int y = int(mod(p.y, 4.0));
      int i = x + y * 4;
      int m[16] = int[16](0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5);
      return float(m[i]) / 16.0 - 0.5;
    }

    void main() {
      // Courbure de l'écran cathodique.
      vec2 c = vUv * 2.0 - 1.0;
      c += c * (c.yx * c.yx) * uCurvature;
      vec2 uv = c * 0.5 + 0.5;
      if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) {
        gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0);
        return;
      }

      // Déchirure : bandes décalées horizontalement (frappe du créancier, mort).
      float band = floor(uv.y * 24.0 + uTime * 30.0);
      uv.x += uTear * (hash(vec2(band, floor(uTime * 20.0))) - 0.5) * 0.12;
      // Tremblement VHS permanent, plus fort sous pression.
      uv.x += sin(uv.y * 900.0 + uTime * 12.0) * 0.0004 * uGrain;

      // Aberration chromatique, plus forte vers les bords.
      vec2 dir = (uv - 0.5) * uAberration * 2.0;
      vec3 col;
      col.r = texture2D(tDiffuse, uv + dir).r;
      col.g = texture2D(tDiffuse, uv).g;
      col.b = texture2D(tDiffuse, uv - dir).b;

      // Ligne de tracking qui défile lentement.
      float roll = fract(uTime * 0.07);
      float tracking = smoothstep(0.012 * (0.5 + uGrain), 0.0, abs(uv.y - roll));
      col += tracking * (hash(uv * uTime) - 0.3) * 0.35 * uGrain;

      // Grain.
      col += (hash(uv * uResolution + fract(uTime) * 100.0) - 0.5) * uGrain * 0.18;

      // Scanlines et masque de phosphore.
      float scan = 0.5 + 0.5 * sin(uv.y * uResolution.y * 3.14159);
      col *= mix(1.0, scan, 0.22);
      float mask = mod(gl_FragCoord.x, 3.0);
      col *= mask < 1.0 ? vec3(1.06, 0.96, 0.96) : mask < 2.0 ? vec3(0.96, 1.06, 0.96) : vec3(0.96, 0.96, 1.06);

      // Vignette.
      col *= smoothstep(1.35, 0.35, length(c));
      col *= uDim;

      // Un œil en moins : la moitié gauche du monde disparaît, bord flou et irrégulier.
      float oneEye = clamp(uEyes, 0.0, 1.0);
      float edge = 0.42 + sin(uv.y * 9.0 + uTime * 0.7) * 0.02;
      col *= mix(1.0, smoothstep(edge - 0.12, edge + 0.08, uv.x), oneEye);
      // Plus d'yeux du tout : seules les lumières fortes percent encore le noir.
      float blind = clamp(uEyes - 1.0, 0.0, 1.0);
      float lum = dot(col, vec3(0.3, 0.59, 0.11));
      col *= mix(1.0, smoothstep(0.32, 0.7, lum) * 0.85 + 0.02, blind);

      // Palette 15 bits tramée, comme une console de 1995.
      col = floor(col * 31.0 + 0.5 + bayer4(gl_FragCoord.xy)) / 31.0;
      gl_FragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
    }`,
};

/**
 * Chaîne de rendu : scène → bloom → sortie sRGB → CRT. Les effets de dégradation ne lisent
 * que deux choses : la pression de l'échéance et le sang versé (pas de santé mentale).
 */
export class PostFx {
  private readonly composer: EffectComposer;
  private readonly crt: ShaderPass;
  private aberrationKick = 0;
  private tearKick = 0;
  private pressure = 0;
  private dimTarget = 1;

  constructor(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera) {
    this.composer = new EffectComposer(renderer);
    this.composer.addPass(new RenderPass(scene, camera));
    this.composer.addPass(new UnrealBloomPass(new THREE.Vector2(256, 256), 0.6, 0.45, 0.93));
    this.composer.addPass(new OutputPass());
    this.crt = new ShaderPass(CrtShader);
    this.composer.addPass(this.crt);
    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  private resize() {
    this.composer.setSize(window.innerWidth, window.innerHeight);
    const size = new THREE.Vector2();
    this.composer.renderer.getDrawingBufferSize(size);
    this.crt.uniforms.uResolution.value.copy(size);
  }

  /** 0 = calme, 1 = dernière main et presque rien de payé. */
  setPressure(p: number) {
    this.pressure = THREE.MathUtils.clamp(p, 0, 1);
  }

  kickAberration(amount: number) {
    this.aberrationKick = Math.max(this.aberrationKick, amount);
  }

  tear(amount: number) {
    this.tearKick = Math.max(this.tearKick, amount);
  }

  private eyesTarget = 0;

  /** Yeux perdus : 0, 1 ou 2. La transition prend quelques secondes. */
  setEyes(lost: number) {
    this.eyesTarget = lost;
  }

  /** Luminosité globale : baisse à la mort. */
  setDim(value: number) {
    this.dimTarget = value;
  }

  render(time: number, dt: number) {
    const u = this.crt.uniforms;
    this.aberrationKick = Math.max(0, this.aberrationKick - dt * 0.012);
    this.tearKick = Math.max(0, this.tearKick - dt * 2.5);
    u.uTime.value = time;
    u.uGrain.value = THREE.MathUtils.lerp(u.uGrain.value, 0.12 + this.pressure * 0.55, 0.05);
    u.uAberration.value = 0.0012 + this.pressure * 0.0018 + this.aberrationKick;
    u.uTear.value = this.tearKick;
    u.uDim.value = THREE.MathUtils.lerp(u.uDim.value, this.dimTarget, 0.04);
    u.uEyes.value = THREE.MathUtils.lerp(u.uEyes.value, this.eyesTarget, 0.02);
    this.composer.render(dt);
  }
}
