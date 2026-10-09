import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import {
  FRONT_WALL_HEIGHT,
  LEDGE_DEPTH,
  LEDGE_Z,
  RAIL_THICKNESS,
  RENDER_SCALE,
  TABLE_HALF_D,
  TABLE_HALF_W,
  WALL_HEIGHT,
} from './config';

const BULB_INTENSITY = 1600;

export interface Stage {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  bulb: THREE.PointLight;
  bulbMesh: THREE.Mesh;
  feltColliders: Set<number>;
  woodColliders: Set<number>;
}

export function createStage(container: HTMLElement, world: RAPIER.World): Stage {
  const renderer = new THREE.WebGLRenderer({ antialias: false });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1) * RENDER_SCALE);
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  container.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x000000);
  scene.fog = new THREE.Fog(0x000000, 18, 42);

  // Assis à la table, regard plongeant vers le créancier.
  const camera = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 0.1, 100);
  camera.position.set(0, 13, 20);
  camera.lookAt(0, 0, 1.5);

  window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });

  // Lumière : une ampoule nue qui se balance, presque rien d'autre.
  scene.add(new THREE.HemisphereLight(0x3a342a, 0x080504, 0.6));
  const bulb = new THREE.PointLight(0xffc98a, BULB_INTENSITY, 45, 2);
  bulb.position.set(0, 11, 0);
  bulb.castShadow = true;
  bulb.shadow.mapSize.set(512, 512);
  bulb.shadow.bias = -0.002;
  scene.add(bulb);
  const bulbMesh = new THREE.Mesh(
    new THREE.SphereGeometry(0.35, 8, 6),
    new THREE.MeshBasicMaterial({ color: 0xfff0c8 }),
  );
  scene.add(bulbMesh);

  const rim = new THREE.SpotLight(0x8a0010, 120, 40, Math.PI / 5, 0.6, 1.5);
  rim.position.set(0, 6, -16);
  rim.target.position.set(0, 0, -4);
  scene.add(rim, rim.target);

  const felt = new THREE.MeshStandardMaterial({ color: 0x163222, roughness: 1 });
  const wood = new THREE.MeshStandardMaterial({ color: 0x3a2214, roughness: 0.8, flatShading: true });
  const darkWood = new THREE.MeshStandardMaterial({ color: 0x24150c, roughness: 0.9, flatShading: true });

  const feltColliders = new Set<number>();
  const woodColliders = new Set<number>();
  const fixed = world.createRigidBody(RAPIER.RigidBodyDesc.fixed());

  const box = (
    size: [number, number, number],
    pos: [number, number, number],
    material: THREE.Material | null,
    kind: 'felt' | 'wood' | null,
  ) => {
    if (material) {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(...size), material);
      mesh.position.set(...pos);
      mesh.receiveShadow = true;
      mesh.castShadow = kind === 'wood';
      scene.add(mesh);
    }
    if (kind) {
      const c = world.createCollider(
        RAPIER.ColliderDesc.cuboid(size[0] / 2, size[1] / 2, size[2] / 2)
          .setTranslation(...pos)
          .setFriction(kind === 'felt' ? 0.7 : 0.4)
          .setRestitution(kind === 'felt' ? 0.15 : 0.45),
        fixed,
      );
      (kind === 'felt' ? feltColliders : woodColliders).add(c.handle);
    }
  };

  const W = TABLE_HALF_W * 2;
  const D = TABLE_HALF_D * 2;
  const outerW = W + RAIL_THICKNESS * 2;
  const railX = TABLE_HALF_W + RAIL_THICKNESS / 2;
  const railZ = TABLE_HALF_D + RAIL_THICKNESS / 2;

  box([W, 0.4, D], [0, -0.2, 0], felt, 'felt');
  // Rails visibles.
  box([RAIL_THICKNESS, 1, D + RAIL_THICKNESS * 2], [-railX, 0.3, 0], wood, null);
  box([RAIL_THICKNESS, 1, D + RAIL_THICKNESS * 2], [railX, 0.3, 0], wood, null);
  box([outerW, 1, RAIL_THICKNESS], [0, 0.3, -railZ], wood, null);
  box([outerW, 1, RAIL_THICKNESS], [0, 0.3, railZ], wood, null);
  // Murs invisibles : hauts sur trois côtés, bas côté joueur pour laisser passer le lancer.
  box([RAIL_THICKNESS, WALL_HEIGHT, D + RAIL_THICKNESS * 2], [-railX, WALL_HEIGHT / 2 - 0.2, 0], null, 'wood');
  box([RAIL_THICKNESS, WALL_HEIGHT, D + RAIL_THICKNESS * 2], [railX, WALL_HEIGHT / 2 - 0.2, 0], null, 'wood');
  box([outerW, WALL_HEIGHT, RAIL_THICKNESS], [0, WALL_HEIGHT / 2 - 0.2, -railZ], null, 'wood');
  box([outerW, FRONT_WALL_HEIGHT, RAIL_THICKNESS], [0, FRONT_WALL_HEIGHT / 2 - 0.2, railZ], null, 'wood');
  box([outerW, 1, W], [0, WALL_HEIGHT, 0], null, 'wood');
  // Rebord côté joueur.
  box([outerW, 0.6, LEDGE_DEPTH], [0, -0.3, LEDGE_Z], darkWood, 'wood');
  // Tapis de garde, à gauche sur le rebord.
  const tray = new THREE.Mesh(
    new THREE.BoxGeometry(7.2, 0.05, 1.8),
    new THREE.MeshStandardMaterial({ color: 0x3d0a0c, roughness: 1 }),
  );
  tray.position.set(-6.3, 0.03, 9.0);
  tray.receiveShadow = true;
  scene.add(tray);

  // Le côté du créancier : une masse sombre au fond, pour l'instant.
  const shadowSide = new THREE.Mesh(
    new THREE.BoxGeometry(outerW, 0.8, 4),
    new THREE.MeshStandardMaterial({ color: 0x0c0806, roughness: 1 }),
  );
  shadowSide.position.set(0, -0.4, -TABLE_HALF_D - RAIL_THICKNESS - 2);
  scene.add(shadowSide);

  return { renderer, scene, camera, bulb, bulbMesh, feltColliders, woodColliders };
}

/** Balancement lent de l'ampoule, avec un léger grésillement. */
export function animateBulb(stage: Stage, time: number) {
  stage.bulb.position.set(Math.sin(time * 0.9) * 0.8, 11, Math.cos(time * 0.7) * 0.3);
  stage.bulbMesh.position.copy(stage.bulb.position);
  const flicker = Math.random() < 0.015 ? 0.35 : 1;
  stage.bulb.intensity = BULB_INTENSITY * flicker;
}
