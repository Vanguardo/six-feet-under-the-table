import RAPIER from '@dimforge/rapier3d-compat';
import { GRAVITY, MAX_STEPS_PER_FRAME, PHYSICS_DT } from './config';
import { Cup } from './cup';
import { Die } from './dice';
import { Game } from './game';
import { Hud } from './hud';
import { CameraRig } from './render/cameraRig';
import { PostFx } from './render/post';
import { ps1ify, setSnapResolution } from './render/ps1';
import { animateBulb, createStage, LOOK_AT } from './scene';
import { Sfx } from './sfx';

await RAPIER.init();

const world = new RAPIER.World({ x: 0, y: GRAVITY, z: 0 });
world.timestep = PHYSICS_DT;
world.numSolverIterations = 8;
const events = new RAPIER.EventQueue(true);

const stage = createStage(document.getElementById('app')!, world);
const cup = new Cup(world, stage.scene);
const dice = Array.from({ length: 5 }, () => new Die(world, stage.scene));
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
  dim: (v) => post.setDim(v),
  pressure: (p) => post.setPressure(p),
});

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
    simulate(seconds: number) {
      for (let i = 0; i < seconds / PHYSICS_DT; i++) stepPhysics();
      game!.render();
    },
    renderOnce() {
      rig.update(time, 0.016);
      animateBulb(stage, time);
      post.render(time, 0.016);
    },
  });
}

let last = performance.now();
let accumulator = 0;
let time = 0;

function frame(now: number) {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  time += dt;
  accumulator += dt;
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
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
