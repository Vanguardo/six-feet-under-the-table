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
import { buildDecor } from './render/decor';
import { buildCreditorDesk } from './render/creditorDesk';
import { glowTexture, volumeMaterial } from './render/volume';
import { brickTexture, feltTexture, floorTexture, grimeTexture, leatherTexture, repeated, woodTexture } from './render/textures';

const BULB_INTENSITY = 1150;
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
  /** Le reste de la cave qui vit : néon, lune, gouttes. */
  animateDecor: (time: number) => void;
  /** Sursaut de l'ampoule sur un gros score : 0 = calme, 1 = elle s'emballe. Retombe toute seule. */
  flare: { value: number };
  feltColliders: Set<number>;
  woodColliders: Set<number>;
}

export function createStage(container: HTMLElement, world: RAPIER.World): Stage {
  const renderer = new THREE.WebGLRenderer({ antialias: false });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1) * RENDER_SCALE);
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  container.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x000000);
  scene.fog = new THREE.FogExp2(0x060403, 0.018);

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
  scene.add(new THREE.HemisphereLight(0x3a342a, 0x080504, 0.38));
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
    new THREE.ConeGeometry(6.6, BULB_Y, 32, 12, true).translate(0, -BULB_Y / 2, 0),
    volumeMaterial(0xffc07a, LIGHT_CONE_OPACITY),
  );
  lightCone.renderOrder = 2;
  scene.add(lightCone);
  // Halo autour de l'ampoule : la lumière « bave » dans l'air poussiéreux.
  const halo = new THREE.Sprite(
    new THREE.SpriteMaterial({ map: glowTexture(), color: 0xffd8a0, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }),
  );
  halo.scale.setScalar(3.6);
  bulbMesh.add(halo);
  // Réflecteur émaillé au-dessus de l'ampoule : la lumière part vers la table, le plafond reste noir.
  const enamel = new THREE.MeshStandardMaterial({ color: 0x2a3a30, map: grimeTexture(), metalness: 0.4, roughness: 0.55, side: THREE.DoubleSide });
  const reflector = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 1.25, 0.42, 18, 1, true), enamel);
  reflector.position.y = 0.95;
  reflector.castShadow = true;
  const inside = new THREE.Mesh(
    new THREE.CylinderGeometry(0.2, 1.22, 0.4, 18, 1, true),
    new THREE.MeshBasicMaterial({ color: 0xd8cbb0, side: THREE.BackSide, fog: false }),
  );
  inside.position.y = 0.94;
  bulbMesh.add(reflector, inside);
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
  const fill = new THREE.DirectionalLight(0xc8a880, 0.32);
  fill.position.set(0, 9, 22);
  fill.target.position.set(0, 0, 0);
  scene.add(fill, fill.target);

  const rim = new THREE.SpotLight(0x8a0010, 120, 40, Math.PI / 5, 0.6, 1.5);
  rim.position.set(0, 6, -16);
  rim.target.position.set(0, 0, -4);
  scene.add(rim, rim.target);

  const felt = new THREE.MeshStandardMaterial({ map: feltTexture(), bumpMap: feltTexture(), bumpScale: 1.2, roughness: 1 });
  // Chaque pièce de bois a sa propre répétition, pour que les veines gardent leur taille.
  const wood = (length: number, dark = false) => {
    const tex = repeated(woodTexture(dark), length / 4, 1);
    return new THREE.MeshStandardMaterial({ map: tex, bumpMap: tex, bumpScale: 2.5, roughness: 0.7, metalness: 0.05, color: 0xd8b8a0 });
  };

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

  const neon = buildCellar(scene);
  const decor = buildDecor(scene);
  buildCreditorDesk(scene);
  const animateDecor = (time: number) => {
    neon(time);
    decor(time);
  };
  buildPaddedRail(scene, railX, railZ);

  return { renderer, scene, camera, bulb, bulbMesh, lightCone, dust, lightLevel: { value: 1 }, flare: { value: 0 }, animateDecor, feltColliders, woodColliders };
}

/**
 * Rail capitonné de cuir sang-de-bœuf sur trois côtés, clouté de laiton : une vraie table de jeu,
 * usée par des années de mains moites. Le côté du créancier reste en bois nu.
 */
function buildPaddedRail(scene: THREE.Scene, railX: number, railZ: number) {
  const y = 1.0;
  const r = 0.9;
  const path = new THREE.CurvePath<THREE.Vector3>();
  const v = (x: number, z: number) => new THREE.Vector3(x, y, z);
  path.add(new THREE.LineCurve3(v(-railX, -railZ), v(-railX, railZ - r)));
  path.add(new THREE.QuadraticBezierCurve3(v(-railX, railZ - r), v(-railX, railZ), v(-railX + r, railZ)));
  path.add(new THREE.LineCurve3(v(-railX + r, railZ), v(railX - r, railZ)));
  path.add(new THREE.QuadraticBezierCurve3(v(railX - r, railZ), v(railX, railZ), v(railX, railZ - r)));
  path.add(new THREE.LineCurve3(v(railX, railZ - r), v(railX, -railZ)));
  const leatherTex = repeated(leatherTexture(), 24, 1);
  const leather = new THREE.MeshStandardMaterial({ map: leatherTex, bumpMap: leatherTex, bumpScale: 1.5, color: 0xc05a48, roughness: 0.5 });
  const tube = new THREE.Mesh(new THREE.TubeGeometry(path, 160, 0.42, 10, false), leather);
  tube.scale.set(1, 0.72, 1);
  tube.position.y = y * 0.28;
  tube.castShadow = tube.receiveShadow = true;
  scene.add(tube);
  for (const end of [v(-railX, -railZ), v(railX, -railZ)]) {
    const cap = new THREE.Mesh(new THREE.SphereGeometry(0.42, 10, 8), leather);
    cap.position.set(end.x, y, end.z);
    cap.scale.set(1, 0.72, 1);
    scene.add(cap);
  }
  // Clous de tapissier en laiton, réguliers, sur le flanc intérieur du rail.
  const brass = new THREE.MeshStandardMaterial({ color: 0xc9a040, metalness: 0.9, roughness: 0.3, map: grimeTexture() });
  const stud = new THREE.SphereGeometry(0.075, 6, 4);
  const length = path.getLength();
  const n = Math.floor(length / 0.75);
  const studs = new THREE.InstancedMesh(stud, brass, n);
  const m = new THREE.Matrix4();
  for (let i = 0; i < n; i++) {
    const t = (i + 0.5) / n;
    const p = path.getPointAt(t);
    const tan = path.getTangentAt(t);
    const inward = new THREE.Vector3(-tan.z, 0, tan.x).multiplyScalar(-1);
    if (inward.dot(new THREE.Vector3(-p.x, 0, -p.z)) < 0) inward.negate();
    m.makeTranslation(p.x + inward.x * 0.36, y * 0.28 + y * 0.72 - 0.04, p.z + inward.z * 0.36);
    studs.setMatrixAt(i, m);
  }
  scene.add(studs);
  // Coins du rebord renforcés de laiton.
  for (const x of [-railX - 0.1, railX + 0.1]) {
    const corner = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.62, 0.9), brass);
    corner.position.set(x, -0.29, 10.65);
    scene.add(corner);
  }
}

/**
 * La cave : briques humides et béton, à peine visibles dans la pénombre.
 * Un néon rouge au fond découpe la silhouette du créancier en contre-jour.
 */
function buildCellar(scene: THREE.Scene): (time: number) => void {
  const wall = (w: number, h: number, back = false) =>
    new THREE.MeshStandardMaterial({
      map: repeated(brickTexture(), w / 5, h / 5),
      bumpMap: repeated(brickTexture(), w / 5, h / 5),
      bumpScale: 4,
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
  // Le gaz rougeoie autour du tube : un halo qui bave sur les briques.
  const neonGlow = new THREE.Sprite(
    new THREE.SpriteMaterial({ map: glowTexture(), color: 0xff2030, blending: THREE.AdditiveBlending, depthWrite: false, fog: false, opacity: 0.7 }),
  );
  neonGlow.position.copy(neon.position).add(new THREE.Vector3(0, 0, 0.4));
  neonGlow.scale.set(11, 3.2, 1);
  scene.add(neonGlow);
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

  // Le néon est mal fixé : il tient, puis bégaie, s'éteint une fraction de seconde, repart.
  const neonMat = neon.material as THREE.MeshBasicMaterial;
  const neonBase = neonMat.color.clone();
  let stutterUntil = 0;
  return (time: number) => {
    if (time > stutterUntil && Math.random() < 0.004) stutterUntil = time + 0.15 + Math.random() * 0.5;
    const off = time < stutterUntil && Math.sin(time * 60) > 0.1;
    const level = off ? 0.12 : 0.92 + Math.sin(time * 7.3) * 0.04;
    neonMat.color.copy(neonBase).multiplyScalar(level);
    neonGlow.material.opacity = 0.7 * level;
    glow.intensity = 45 * level;
  };
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
  stage.flare.value = Math.max(0, stage.flare.value - 0.02);
  const level = stage.lightLevel.value * (dark ? 0.25 : 1) * (1 + stage.flare.value * 0.9);
  stage.bulb.intensity = BULB_INTENSITY * level;
  (stage.bulbMesh.material as THREE.MeshBasicMaterial).color.setScalar(0.3 + 0.7 * level);
  const cone = stage.lightCone.material as THREE.ShaderMaterial;
  cone.uniforms.uOpacity.value = LIGHT_CONE_OPACITY * level;
  cone.uniforms.uTime.value = time;
  const halo = stage.bulbMesh.children.find((c) => (c as THREE.Sprite).isSprite) as THREE.Sprite | undefined;
  if (halo) halo.material.opacity = 0.15 + 0.85 * level;

  const pos = stage.dust.geometry.getAttribute('position') as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    let y = pos.getY(i) - 0.002;
    if (y < 0.3) y = BULB_Y - 0.5;
    pos.setXYZ(i, pos.getX(i) + Math.sin(time * 0.3 + i) * 0.0015, y, pos.getZ(i) + Math.cos(time * 0.25 + i) * 0.0015);
  }
  pos.needsUpdate = true;
  stage.animateDecor(time);
  return dark;
}
