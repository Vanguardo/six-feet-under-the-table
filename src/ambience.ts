import type { Sfx } from './sfx';

/**
 * Fond sonore : bourdonnement de l'ampoule, ventilation lointaine, gouttes qui résonnent.
 * Pas de musique en jeu, sauf une nappe lo-fi dans la boutique.
 */
export class Ambience {
  private started = false;
  private hum: GainNode | null = null;
  private pad: GainNode | null = null;
  private echo: AudioNode | null = null;
  private nextDrip = 3;
  private time = 0;

  constructor(private readonly sfx: Sfx) {}

  start() {
    const ctx = this.sfx.context;
    const out = this.sfx.output;
    if (this.started || !ctx || !out) return;
    this.started = true;

    // Bourdonnement électrique : 50 Hz et son harmonique.
    this.hum = ctx.createGain();
    this.hum.gain.value = 0.035;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 320;
    const saw = ctx.createOscillator();
    saw.type = 'sawtooth';
    saw.frequency.value = 50;
    const sine = ctx.createOscillator();
    sine.frequency.value = 100;
    const sineGain = ctx.createGain();
    sineGain.gain.value = 0.5;
    saw.connect(lp).connect(this.hum);
    sine.connect(sineGain).connect(this.hum);
    this.hum.connect(out);
    saw.start();
    sine.start();

    // Ventilation : bruit très filtré, en boucle.
    const noise = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const data = noise.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    const vent = ctx.createBufferSource();
    vent.buffer = noise;
    vent.loop = true;
    const ventLp = ctx.createBiquadFilter();
    ventLp.type = 'lowpass';
    ventLp.frequency.value = 240;
    const ventGain = ctx.createGain();
    ventGain.gain.value = 0.05;
    vent.connect(ventLp).connect(ventGain).connect(out);
    vent.start();

    // Écho de cave pour les gouttes.
    const delay = ctx.createDelay(1);
    delay.delayTime.value = 0.23;
    const feedback = ctx.createGain();
    feedback.gain.value = 0.38;
    delay.connect(feedback).connect(delay);
    delay.connect(out);
    this.echo = delay;

    // Nappe de la boutique : accord mineur désaccordé, coupé tant qu'on joue.
    this.pad = ctx.createGain();
    this.pad.gain.value = 0;
    const padLp = ctx.createBiquadFilter();
    padLp.type = 'lowpass';
    padLp.frequency.value = 700;
    for (const [freq, detune] of [[110, -6], [130.8, 5], [164.8, -3], [220, 7]]) {
      const o = ctx.createOscillator();
      o.type = 'triangle';
      o.frequency.value = freq;
      o.detune.value = detune;
      o.connect(padLp);
      o.start();
    }
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.15;
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = 250;
    lfo.connect(lfoGain).connect(padLp.frequency);
    lfo.start();
    padLp.connect(this.pad).connect(out);
  }

  /** L'ampoule grésille : le bourdonnement chute au même moment. */
  flicker(dark: boolean) {
    const ctx = this.sfx.context;
    if (!this.hum || !ctx) return;
    this.hum.gain.setTargetAtTime(dark ? 0.006 : 0.035, ctx.currentTime, 0.01);
  }

  setShop(on: boolean) {
    const ctx = this.sfx.context;
    if (!this.pad || !ctx) return;
    this.pad.gain.setTargetAtTime(on ? 0.05 : 0, ctx.currentTime, 0.6);
  }

  update(dt: number) {
    this.time += dt;
    if (!this.started || this.time < this.nextDrip) return;
    this.nextDrip = this.time + 4 + Math.random() * 7;
    this.drip();
  }

  private drip() {
    const ctx = this.sfx.context;
    if (!ctx || !this.echo) return;
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.frequency.setValueAtTime(1500 + Math.random() * 500, now);
    osc.frequency.exponentialRampToValueAtTime(450, now + 0.07);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.07, now + 0.005);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.09);
    osc.connect(gain).connect(this.echo);
    osc.start(now);
    osc.stop(now + 0.1);
  }
}
