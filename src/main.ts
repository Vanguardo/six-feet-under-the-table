import RAPIER from '@dimforge/rapier3d-compat';
import { GRAVITY, MAX_STEPS_PER_FRAME, PHYSICS_DT, RENDER_SCALE } from './config';
import { Cup } from './cup';
import { Die } from './dice';
import { Game } from './game';
import { Hud } from './hud';
import { setLang } from './i18n';
import { Progress } from './progress';
import { CameraRig } from './render/cameraRig';
import { PostFx } from './render/post';
import { ps1ify, setSnapResolution } from './render/ps1';
import { animateBulb, createStage, LOOK_AT } from './scene';
import { Sfx } from './sfx';

// Écran de chargement : remplacé par un message clair si le navigateur ne suit pas (WebGL, WASM).
const loading = document.getElementById('loading');
const fail = () => {
  if (!loading?.isConnected) return;
  loading.className = 'error';
  loading.textContent = 'This game needs WebGL 2 and WebAssembly. Try a recent Chrome, Firefox or Edge.';
};
window.addEventListener('error', fail);
window.addEventListener('unhandledrejection', fail);

await RAPIER.init();
// Les polices des chiffres gravés doivent être là avant qu'on les dessine dans les textures.
await Promise.race([Promise.all([document.fonts.load('48px "IM Fell English SC"'), document.fonts.load('16px "Special Elite"')]), new Promise((r) => setTimeout(r, 2500))]).catch(() => {});

// Sauvegarde et langue avant tout affichage.
const progress = new Progress();
setLang(progress.settings.lang);

const world = new RAPIER.World({ x: 0, y: GRAVITY, z: 0 });
world.timestep = PHYSICS_DT;
world.numSolverIterations = 8;
const events = new RAPIER.EventQueue(true);

const stage = createStage(document.getElementById('app')!, world);
const cup = new Cup(world, stage.scene);
// Six dés physiques : le sixième ne sert qu'avec la relique Sixième doigt.
const dice = Array.from({ length: 6 }, () => new Die(world, stage.scene));
ps1ify(stage.scene);
setSnapResolution(window.innerWidth, window.innerHeight);
window.addEventListener('resize', () => setSnapResolution(window.innerWidth, window.innerHeight));

const post = new PostFx(stage.renderer, stage.scene, stage.camera);
const rig = new CameraRig(stage.camera, LOOK_AT);

let game: Game | null = null;
const hud = new Hud(() => game?.validate());
game = new Game(stage, cup, dice, new Sfx(), hud, {
  jolt: (a) => rig.jolt(a),
  tear: (a) => post.tear(a),
  aberration: (a) => post.kickAberration(a),
  dim: (v, instant) => post.setDim(v, instant),
  pressure: (p) => post.setPressure(p),
  eyes: (n) => post.setEyes(n),
  lean: (p, from, speed) => rig.leanOver(p, from, speed),
  kick: (d) => rig.kick(d),
  pulse: (a) => post.pulse(a),
}, progress, world);
loading?.remove();

function stepPhysics() {
  game!.step(PHYSICS_DT);
  world.step(events);
  game!.afterStep(events);
}

// Débogage : `simulate(2)` avance la physique de 2 s sans attendre l'affichage.
if (import.meta.env.DEV) {
  Object.assign(window, {
    game,
    post,
    rig,
    simulate,
    renderOnce,
  });
  const { createBot } = await import('./dev/bot');
  Object.assign(window, { bot: createBot(game, simulate, renderOnce) });
  // Débogage visuel : une table en cours de partie, dés lancés, prête à être capturée.
  Object.assign(window, {
    devScene: async (roll = true) => {
      (document.querySelector('#menu [data-action="accept"]') as HTMLElement | null)?.click();
      const g = game as unknown as { startRun(o: object): void; endTicketZoom(): void };
      g.startRun({ cup: 'cuir', stake: 0 });
      g.endTicketZoom();
      simulate(2.5);
      if (roll) (window as unknown as { bot: { roll(): void } }).bot.roll();
      simulate(1);
      for (let i = 0; i < 20; i++) game!.render();
      renderOnce();
      renderOnce();
    },
  });
}

function simulate(seconds: number) {
  for (let i = 0; i < seconds / PHYSICS_DT; i++) stepPhysics();
  game!.render();
}

function renderOnce() {
  rig.update(time, 0.016);
  animateBulb(stage, time);
  post.render(time, 0.016);
}

let last = performance.now();
let accumulator = 0;
let time = 0;

function frame(now: number) {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  time += dt;
  accumulator += dt * game!.timeScale;
  let steps = 0;
  while (accumulator >= PHYSICS_DT && steps < MAX_STEPS_PER_FRAME) {
    stepPhysics();
    accumulator -= PHYSICS_DT;
    steps++;
  }
  if (steps === MAX_STEPS_PER_FRAME) accumulator = 0;

  rig.update(time, dt);
  game!.render();
  game!.onFlicker(animateBulb(stage, time));
  post.render(time, dt);
  adaptQuality(dt);
  requestAnimationFrame(frame);
}

// Qualité adaptative : si le PC peine (sous ~45 images/s pendant 3 s), on allège
// d'abord les ombres de l'ampoule, puis la résolution interne. Jamais l'inverse.
let slowFor = 0;
let quality = 0;
function adaptQuality(dt: number) {
  if (document.hidden || dt >= 0.1 || quality >= 2) return;
  slowFor = dt > 1 / 45 ? slowFor + dt : Math.max(0, slowFor - dt * 0.5);
  if (slowFor < 3) return;
  slowFor = 0;
  quality++;
  if (quality === 1) {
    stage.bulb.shadow.mapSize.set(512, 512);
    stage.bulb.shadow.map?.dispose();
    stage.bulb.shadow.map = null;
  } else {
    post.setPixelRatio(Math.min(window.devicePixelRatio, 1) * RENDER_SCALE * 0.75);
  }
}
requestAnimationFrame(frame);
