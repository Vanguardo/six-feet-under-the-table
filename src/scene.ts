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
import { brickTexture, feltTexture, floorTexture, grimeTexture, repeated, woodTexture } from './render/textures';

const BULB_INTENSITY = 950;
// L'ampoule pend assez bas pour rester dans le champ, au-dessus du créancier.
export const BULB_Y = 9.8;
// Le regard vise un peu au-dessus de la table pour voir l'ampoule et le sourire.
export const LOOK_AT = new THREE.Vector3(0, 2.75, 1.5);
const DUST_COUNT = 260;
const CELLAR = { back: 24, side: 26, floor: -10 };
const LIGHT_CONE_OPACITY = 0.022;

export interface Stage {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  bulb: THREE.PointLight;
  bulbMesh: THREE.Mesh;
  lightCone: THREE.Mesh;
  dust: THREE.Points;
  /** Multiplicateur de la lumière de l'ampoule (baisse à la mort). */
  lightLevel: { value: number };
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
  scene.fog = new THREE.Fog(0x000000, 24, 58);

  // Assis à la table, regard plongeant vers le créancier.
  const camera = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 0.1, 100);
  camera.position.set(0, 13, 20);
  camera.lookAt(LOOK_AT);

  window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });

  // Lumière : une ampoule nue qui se balance, presque rien d'autre.
  scene.add(new THREE.HemisphereLight(0x3a342a, 0x080504, 0.6));
  const bulb = new THREE.PointLight(0xffc98a, BULB_INTENSITY, 45, 2);
  bulb.position.set(0, BULB_Y, 0);
  bulb.castShadow = true;
  // Ombres : assez de résolution pour les dés, et un décalage le long de la normale
  // plutôt qu'en profondeur, pour éviter l'acné sans décoller l'ombre du dé.
  bulb.shadow.mapSize.set(1024, 1024);
  bulb.shadow.bias = -0.0004;
  bulb.shadow.normalBias = 0.05;
  bulb.shadow.camera.near = 1;
  bulb.shadow.camera.far = 30;
  scene.add(bulb);
  // Ampoule nue : verre, douille et fil qui remonte dans le noir.
  const bulbMesh = new THREE.Mesh(
    new THREE.SphereGeometry(0.32, 8, 6),
    new THREE.MeshBasicMaterial({ color: 0xfff0c8, fog: false }),
  );
  const socket = new THREE.Mesh(
    new THREE.CylinderGeometry(0.16, 0.2, 0.36, 6).translate(0, 0.42, 0),
    new THREE.MeshStandardMaterial({ color: 0x5a4a38, map: grimeTexture(), metalness: 0.6, roughness: 0.5 }),
  );
  const cord = new THREE.Mesh(
    new THREE.CylinderGeometry(0.025, 0.025, 14, 4).translate(0, 7.6, 0),
    new THREE.MeshStandardMaterial({ color: 0x0c0a08, roughness: 1 }),
  );
  bulbMesh.add(socket, cord);
  scene.add(bulbMesh);

  // Cône de lumière poussiéreuse sous l'ampoule.
  const lightCone = new THREE.Mesh(
    new THREE.ConeGeometry(6.4, BULB_Y, 18, 1, true).translate(0, -BULB_Y / 2, 0),
    new THREE.MeshBasicMaterial({
      color: 0xffc98a,
      transparent: true,
      opacity: LIGHT_CONE_OPACITY,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
      fog: false,
    }),
  );
  scene.add(lightCone);
  const dustGeo = new THREE.BufferGeometry();
  const dustPos = new Float32Array(DUST_COUNT * 3);
  for (let i = 0; i < DUST_COUNT; i++) {
    const r = Math.sqrt(Math.random()) * 6;
    const a = Math.random() * Math.PI * 2;
    dustPos.set([Math.cos(a) * r, 0.5 + Math.random() * (BULB_Y - 1), Math.sin(a) * r], i * 3);
  }
  dustGeo.setAttribute('position', new THREE.BufferAttribute(dustPos, 3));
  const dust = new THREE.Points(
    dustGeo,
    new THREE.PointsMaterial({ color: 0xffe0b0, size: 0.06, transparent: true, opacity: 0.5, depthWrite: false }),
  );
  scene.add(dust);

  // Appoint très faible depuis la place du joueur : les faces tournées vers lui
  // ne sont plus noires et ne se confondent plus avec l'ombre des dés.
  const fill = new THREE.DirectionalLight(0xc8a880, 0.45);
  fill.position.set(0, 9, 22);
  fill.target.position.set(0, 0, 0);
  scene.add(fill, fill.target);

  const rim = new THREE.SpotLight(0x8a0010, 120, 40, Math.PI / 5, 0.6, 1.5);
  rim.position.set(0, 6, -16);
  rim.target.position.set(0, 0, -4);
  scene.add(rim, rim.target);

  const felt = new THREE.MeshStandardMaterial({ map: feltTexture(), roughness: 1 });
  // Chaque pièce de bois a sa propre répétition, pour que les veines gardent leur taille.
  const wood = (length: number, dark = false) =>
    new THREE.MeshStandardMaterial({ map: repeated(woodTexture(dark), length / 4, 1), roughness: 0.85, flatShading: true });

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
  box([RAIL_THICKNESS, 1, D + RAIL_THICKNESS * 2], [-railX, 0.3, 0], wood(D), null);
  box([RAIL_THICKNESS, 1, D + RAIL_THICKNESS * 2], [railX, 0.3, 0], wood(D), null);
  box([outerW, 1, RAIL_THICKNESS], [0, 0.3, -railZ], wood(outerW), null);
  box([outerW, 1, RAIL_THICKNESS], [0, 0.3, railZ], wood(outerW), null);
  // Murs invisibles : hauts sur trois côtés, bas côté joueur pour laisser passer le lancer.
  box([RAIL_THICKNESS, WALL_HEIGHT, D + RAIL_THICKNESS * 2], [-railX, WALL_HEIGHT / 2 - 0.2, 0], null, 'wood');
  box([RAIL_THICKNESS, WALL_HEIGHT, D + RAIL_THICKNESS * 2], [railX, WALL_HEIGHT / 2 - 0.2, 0], null, 'wood');
  box([outerW, WALL_HEIGHT, RAIL_THICKNESS], [0, WALL_HEIGHT / 2 - 0.2, -railZ], null, 'wood');
  box([outerW, FRONT_WALL_HEIGHT, RAIL_THICKNESS], [0, FRONT_WALL_HEIGHT / 2 - 0.2, railZ], null, 'wood');
  box([outerW, 1, W], [0, WALL_HEIGHT, 0], null, 'wood');
  // Rebord côté joueur.
  box([outerW, 0.6, LEDGE_DEPTH], [0, -0.3, LEDGE_Z], wood(outerW, true), 'wood');
  // Tapis de garde, à gauche sur le rebord.
  const tray = new THREE.Mesh(
    new THREE.BoxGeometry(7.2, 0.05, 1.8),
    new THREE.MeshStandardMaterial({ map: repeated(feltTexture(true), 1, 0.25), roughness: 1 }),
  );
  tray.position.set(-6.3, 0.03, 9.0);
  tray.receiveShadow = true;
  scene.add(tray);

  // Le côté du créancier : une planche à hauteur du rail, où reposent ses mains.
  const plank = new THREE.Mesh(
    new THREE.BoxGeometry(outerW, 1.6, 5),
    wood(outerW, true),
  );
  plank.position.set(0, 0, -TABLE_HALF_D - RAIL_THICKNESS - 2.5);
  plank.receiveShadow = true;
  scene.add(plank);

  buildCellar(scene);

  return { renderer, scene, camera, bulb, bulbMesh, lightCone, dust, lightLevel: { value: 1 }, feltColliders, woodColliders };
}

/**
 * La cave : briques humides et béton, à peine visibles dans la pénombre.
 * Un néon rouge au fond découpe la silhouette du créancier en contre-jour.
 */
function buildCellar(scene: THREE.Scene) {
  const wall = (w: number, h: number, back = false) =>
    new THREE.MeshStandardMaterial({
      map: repeated(brickTexture(), w / 5, h / 5),
      // Le mur du fond est plus sombre et se perd dans le brouillard, derrière le sourire.
      color: back ? 0x5a5a5a : 0xffffff,
      roughness: 1,
      fog: back,
    });
  const add = (geo: THREE.BufferGeometry, mat: THREE.Material, pos: [number, number, number], rotY = 0, rotX = 0) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(...pos);
    m.rotation.set(rotX, rotY, 0);
    m.receiveShadow = true;
    scene.add(m);
  };
  add(new THREE.PlaneGeometry(64, 44), wall(64, 44, true), [0, 12, -CELLAR.back]);
  add(new THREE.PlaneGeometry(70, 44), wall(70, 44), [-CELLAR.side, 12, 6], Math.PI / 2);
  add(new THREE.PlaneGeometry(70, 44), wall(70, 44), [CELLAR.side, 12, 6], -Math.PI / 2);
  add(
    new THREE.PlaneGeometry(64, 70),
    new THREE.MeshStandardMaterial({ map: repeated(floorTexture(), 6, 7), roughness: 1, fog: false }),
    [0, CELLAR.floor, 6],
    0,
    -Math.PI / 2,
  );

  const neon = new THREE.Mesh(
    new THREE.CylinderGeometry(0.1, 0.1, 7, 6),
    new THREE.MeshBasicMaterial({ color: 0xff2a36, fog: false }),
  );
  // Décalé et penché, comme une enseigne à moitié décrochée.
  neon.rotation.z = Math.PI / 2 + 0.12;
  neon.position.set(-12.5, 6.5, -CELLAR.back + 0.3);
  scene.add(neon);
  // Lueur courte : elle rougit les briques autour du néon, pas le fond derrière le créancier.
  const glow = new THREE.PointLight(0xff1020, 45, 11, 2);
  glow.position.set(-11.5, 6.5, -CELLAR.back + 1.5);
  scene.add(glow);

  // Ombre derrière le sourire : un noir dense au centre qui s'estompe vers les bords,
  // pour que le sourire flotte dans le vide et non devant un mur.
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 128;
  const g = canvas.getContext('2d')!;
  const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grad.addColorStop(0, 'rgba(0, 0, 0, 1)');
  grad.addColorStop(0.55, 'rgba(0, 0, 0, 0.92)');
  grad.addColorStop(1, 'rgba(0, 0, 0, 0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  const shadow = new THREE.Mesh(
    new THREE.PlaneGeometry(20, 15),
    new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(canvas), transparent: true, depthWrite: false, fog: false }),
  );
  shadow.position.set(0.5, 5.5, -CELLAR.back + 2);
  scene.add(shadow);
}

let flickerUntil = 0;

/** Balancement lent de l'ampoule et grésillements. Renvoie vrai quand elle vacille. */
export function animateBulb(stage: Stage, time: number): boolean {
  stage.bulb.position.set(Math.sin(time * 0.9) * 0.8, BULB_Y, Math.cos(time * 0.7) * 0.3);
  // L'ampoule et son fil se balancent ensemble autour du point d'accroche.
  stage.bulbMesh.rotation.z = -Math.sin(time * 0.9) * 0.05;
  stage.bulbMesh.position.copy(stage.bulb.position);
  // Le cône suit l'ampoule en s'inclinant avec le fil.
  stage.lightCone.position.copy(stage.bulb.position);
  stage.lightCone.rotation.z = Math.sin(time * 0.9) * 0.07;

  // Grésillement : de brèves coupures, parfois en rafale.
  if (time > flickerUntil && Math.random() < 0.006) flickerUntil = time + 0.05 + Math.random() * 0.25;
  const dark = time < flickerUntil && Math.sin(time * 90) > -0.2;
  const level = stage.lightLevel.value * (dark ? 0.25 : 1);
  stage.bulb.intensity = BULB_INTENSITY * level;
  (stage.bulbMesh.material as THREE.MeshBasicMaterial).color.setScalar(0.3 + 0.7 * level);
  (stage.lightCone.material as THREE.MeshBasicMaterial).opacity = LIGHT_CONE_OPACITY * level;

  const pos = stage.dust.geometry.getAttribute('position') as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    let y = pos.getY(i) - 0.002;
    if (y < 0.3) y = BULB_Y - 0.5;
    pos.setXYZ(i, pos.getX(i) + Math.sin(time * 0.3 + i) * 0.0015, y, pos.getZ(i) + Math.cos(time * 0.25 + i) * 0.0015);
  }
  pos.needsUpdate = true;
  return dark;
}
