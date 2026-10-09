import * as THREE from 'three';

/**
 * Résolution de la grille sur laquelle les sommets sont « aimantés » : le tremblement
 * caractéristique de la PS1, qui n'avait pas de précision sub-pixel.
 */
const SNAP = { value: new THREE.Vector2(320, 180) };

const patched = new WeakSet<THREE.Material>();

function patch(material: THREE.Material) {
  if (patched.has(material) || !(material instanceof THREE.MeshStandardMaterial)) return;
  patched.add(material);
  const previous = material.onBeforeCompile;
  material.onBeforeCompile = (shader, renderer) => {
    previous.call(material, shader, renderer);
    shader.uniforms.uSnap = SNAP;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nuniform vec2 uSnap;')
      .replace(
        '#include <project_vertex>',
        `#include <project_vertex>
        gl_Position.xy = floor(gl_Position.xy / gl_Position.w * uSnap + 0.5) / uSnap * gl_Position.w;`,
      );
  };
  material.customProgramCacheKey = () => 'ps1';
  material.needsUpdate = true;
}

/** Applique le tremblement PS1 à tous les matériaux d'un objet et de ses enfants. */
export function ps1ify(root: THREE.Object3D) {
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    mats.forEach(patch);
  });
}

export function setSnapResolution(width: number, height: number) {
  // NDC couvre 2 unités : la grille fait donc environ un quart de la résolution affichée.
  SNAP.value.set(Math.max(160, Math.round(width / 8)), Math.max(90, Math.round(height / 8)));
}
