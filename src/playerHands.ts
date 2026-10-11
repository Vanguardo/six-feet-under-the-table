import * as THREE from 'three';
import { CUP_HEIGHT } from './config';
import { Hand, PLAYER_HANDS } from './creditor/hand';
import { ps1ify } from './render/ps1';
import { grimeTexture } from './render/textures';
import type { Body } from './rules/body';

/**
 * Les mains du joueur, en bas du cadre : la droite tient le gobelet, la gauche attend près
 * du tapis de garde. Elles portent l'historique de la run : doigts coupés, pansements, sang,
 * puis un moignon bandé quand la main gauche a été prise.
 */

const SCALE = 1.4;
// Au repos : avant-bras sur le rail, mains posées à plat sur le bord du feutre.
const REST_RIGHT = { pos: new THREE.Vector3(10.4, 1.2, 8.7), yaw: Math.PI + 0.1 };
const REST_LEFT = { pos: new THREE.Vector3(-11.1, 1.2, 9.0), yaw: Math.PI - 0.12 };

export class PlayerHands {
  // Paume vers le bas, doigts vers le créancier : le pouce est du côté intérieur.
  private readonly right = new Hand(false, PLAYER_HANDS, false, true);
  private readonly left = new Hand(true, PLAYER_HANDS, false, true);
  private readonly stump = buildStump();
  private readonly blood: THREE.Object3D[] = [];
  private readonly rightPose = { pos: REST_RIGHT.pos.clone(), quat: new THREE.Quaternion() };
  private visible = true;
  /** Le reflet de l'ampoule sur tes mains : sans lui, elles disparaissent dans l'ombre du rebord. */
  private readonly lights = [new THREE.PointLight(0xffc890, 22, 9, 1.5), new THREE.PointLight(0xffc890, 22, 9, 1.5)];

  constructor(scene: THREE.Scene) {
    for (const hand of [this.right, this.left]) {
      hand.root.scale.setScalar(SCALE);
      ps1ify(hand.root);
      scene.add(hand.root);
    }
    this.lights[0].position.set(-8.5, 4, 11.5);
    this.lights[1].position.set(8.5, 4, 11.5);
    scene.add(...this.lights);
    this.stump.position.copy(REST_LEFT.pos);
    this.stump.rotation.y = REST_LEFT.yaw;
    this.stump.visible = false;
    ps1ify(this.stump);
    scene.add(this.stump);
    // Taches de sang séché sur le dos de la main droite, révélées pacte après pacte.
    const mat = new THREE.MeshStandardMaterial({ color: 0x4a0606, roughness: 0.4 });
    [[0.25, 0.32, 0.9], [-0.3, 0.3, 1.3], [0.05, 0.33, 0.5], [-0.1, 0.28, 1.7]].forEach(([x, y, z], i) => {
      const m = new THREE.Mesh(new THREE.SphereGeometry(0.16 + (i % 2) * 0.06, 6, 4), mat);
      m.scale.set(1, 0.25, 1.4);
      m.position.set(x, y, z);
      m.visible = false;
      this.right.root.add(m);
      this.blood.push(m);
    });
    this.left.root.position.copy(REST_LEFT.pos);
    this.left.root.rotation.set(0.05, REST_LEFT.yaw, 0, 'YXZ');
    this.left.curl.fill(0.3);
    this.left.curl[4] = 0.2;
    this.left.pose();
  }

  /** Ce que la run a pris se voit sur les mains. */
  setBody(body: Body) {
    const order = [3, 2, 1, 0]; // l'auriculaire part en premier
    this.left.setMissing(order.slice(0, body.leftFingersLost));
    this.right.setMissing(order.slice(0, Math.max(0, body.rightFingersLost)));
    this.left.root.visible = this.visible && !body.hand;
    this.stump.visible = this.visible && body.hand;
    this.blood.forEach((b, i) => (b.visible = i < body.pacts));
  }

  /** Suit la grande ampoule : quand la cave s'éteint, tes mains aussi. */
  setLight(level: number) {
    for (const l of this.lights) l.intensity = 22 * level;
  }

  setVisible(on: boolean) {
    this.visible = on;
    this.right.root.visible = on;
    if (!on) {
      this.left.root.visible = false;
      this.stump.visible = false;
    }
  }

  /**
   * `cup` : le gobelet, quand il est de ton côté de la table (la main reste posée dessus) ;
   * null pendant l'intro, quand il est encore chez le créancier. `holding` : la main le serre.
   */
  update(dt: number, clock: number, cup: { position: THREE.Vector3; quaternion: THREE.Quaternion } | null, holding = false) {
    let targetPos: THREE.Vector3;
    let targetQuat: THREE.Quaternion;
    let curl: number;
    if (cup && holding) {
      // On secoue les dés la paume plaquée sur l'ouverture, les doigts repliés sur le rebord.
      const offset = new THREE.Vector3(0.75, CUP_HEIGHT + 0.22, 1.4).applyQuaternion(cup.quaternion);
      targetPos = cup.position.clone().add(offset);
      targetQuat = cup.quaternion.clone().multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(0.06, Math.PI + 0.4, 0, 'YXZ')));
      curl = 0.5;
    } else {
      const breathe = Math.sin(clock * 1.1) * 0.03;
      targetPos = REST_RIGHT.pos.clone().add(new THREE.Vector3(0, breathe, 0));
      targetQuat = new THREE.Quaternion().setFromEuler(new THREE.Euler(0.05, REST_RIGHT.yaw, 0, 'YXZ'));
      curl = 0.3;
    }
    const k = 1 - Math.exp(-dt * (holding ? 30 : 10));
    this.rightPose.pos.lerp(targetPos, k);
    this.rightPose.quat.slerp(targetQuat, k);
    this.right.root.position.copy(this.rightPose.pos);
    this.right.root.quaternion.copy(this.rightPose.quat);
    for (let f = 0; f < 5; f++) this.right.curl[f] += ((f === 4 ? curl * 0.6 : curl) + Math.sin(clock * 0.7 + f) * 0.03 - this.right.curl[f]) * k;
    this.right.pose();
    // La main gauche respire à peine ; ses doigts frémissent.
    this.left.root.position.y = REST_LEFT.pos.y + Math.sin(clock * 1.1 + 1) * 0.03;
    for (let f = 0; f < 4; f++) this.left.curl[f] = 0.3 + Math.sin(clock * 0.6 + f * 1.7) * 0.05;
    this.left.pose();
  }
}

/** Ce qui reste du bras gauche : une manche, un poignet bandé, du sang qui a traversé. */
function buildStump() {
  const g = new THREE.Group();
  const sleeve = new THREE.MeshStandardMaterial({ color: PLAYER_HANDS.sleeve, roughness: 1, flatShading: true });
  const bandage = new THREE.MeshStandardMaterial({ color: 0xd0c6ae, map: grimeTexture(), roughness: 1, flatShading: true });
  const blood = new THREE.MeshStandardMaterial({ color: 0x5a0606, roughness: 0.35 });
  const add = (geo: THREE.BufferGeometry, mat: THREE.Material, pos: [number, number, number]) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(...pos);
    m.castShadow = true;
    g.add(m);
  };
  add(new THREE.BoxGeometry(1.2, 0.8, 7), sleeve, [0, 0.1, -4.2]);
  add(new THREE.CylinderGeometry(0.45, 0.5, 0.9, 7).rotateX(Math.PI / 2), bandage, [0, 0, -0.35]);
  add(new THREE.SphereGeometry(0.42, 7, 5), bandage, [0, 0, 0.1]);
  add(new THREE.SphereGeometry(0.3, 6, 4), blood, [0, 0.08, 0.32]);
  add(new THREE.BoxGeometry(0.5, 0.05, 0.6), blood, [0.1, 0.38, -0.2]);
  return g;
}
