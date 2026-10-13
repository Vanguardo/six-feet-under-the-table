import * as THREE from 'three';

/** Volume de lumière : additif, dense au cœur du faisceau et près de la source, effacé sur les bords. */
export function volumeMaterial(color: number, opacity: number) {
  return new THREE.ShaderMaterial({
    uniforms: { uColor: { value: new THREE.Color(color) }, uOpacity: { value: opacity }, uTime: { value: 0 } },
    vertexShader: /* glsl */ `
      varying vec3 vNormal;
      varying vec3 vView;
      varying float vH;
      void main() {
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vNormal = normalize(normalMatrix * normal);
        vView = normalize(-mv.xyz);
        vH = position.y;
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor;
      uniform float uOpacity;
      uniform float uTime;
      varying vec3 vNormal;
      varying vec3 vView;
      varying float vH;
      void main() {
        // Face au regard = on traverse beaucoup d'air éclairé ; sur la tranche, presque rien.
        float core = pow(abs(dot(vNormal, vView)), 2.2);
        // Plus dense près de l'ampoule (vH = 0), s'évanouit vers le sol.
        float fall = exp(vH * 0.16);
        float shimmer = 0.85 + 0.15 * sin(vH * 2.3 + uTime * 0.7);
        gl_FragColor = vec4(uColor * core * fall * shimmer * uOpacity * 9.0, 1.0);
      }`,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
}

/** Tache de lumière douce, pour les halos. */
export function glowTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, 'rgba(255,255,255,0.9)');
  grad.addColorStop(0.2, 'rgba(255,255,255,0.35)');
  grad.addColorStop(0.55, 'rgba(255,255,255,0.08)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

