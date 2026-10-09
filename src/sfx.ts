// Sons procéduraux de chocs : du bruit filtré, en attendant de vrais enregistrements.

export type SfxKind = 'click' | 'cup' | 'felt' | 'wood' | 'tap' | 'scratch' | 'clap' | 'knock';

interface Preset {
  type: BiquadFilterType;
  freq: number;
  q: number;
  duration: number;
  volume: number;
}

const PRESETS: Record<SfxKind, Preset> = {
  click: { type: 'bandpass', freq: 3800, q: 4, duration: 0.03, volume: 0.9 },
  cup: { type: 'bandpass', freq: 750, q: 2.5, duration: 0.06, volume: 1.1 },
  felt: { type: 'lowpass', freq: 520, q: 0.8, duration: 0.07, volume: 1.0 },
  wood: { type: 'bandpass', freq: 1600, q: 3, duration: 0.05, volume: 0.9 },
  tap: { type: 'bandpass', freq: 1100, q: 2, duration: 0.04, volume: 0.5 },
  scratch: { type: 'bandpass', freq: 2900, q: 7, duration: 0.05, volume: 0.35 },
  clap: { type: 'bandpass', freq: 1300, q: 1.2, duration: 0.12, volume: 1.0 },
  knock: { type: 'lowpass', freq: 380, q: 1, duration: 0.35, volume: 1.0 },
};

const MIN_INTERVAL = 0.012;

export class Sfx {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  private readonly lastPlayed = new Map<SfxKind, number>();
  private ear: BiquadFilterNode | null = null;
  private pan: StereoPannerNode | null = null;
  private tinnitus: OscillatorNode | null = null;
  private deaf = false;

  /** Oreille perdue : son étouffé, d'un seul côté, avec un sifflement permanent. */
  setDeaf(on: boolean) {
    this.deaf = on;
    const { ctx, ear, pan } = this;
    if (!ctx || !ear || !pan) return;
    ear.frequency.setTargetAtTime(on ? 1700 : 20000, ctx.currentTime, 0.3);
    pan.pan.setTargetAtTime(on ? 0.85 : 0, ctx.currentTime, 0.3);
    if (on && !this.tinnitus) {
      this.tinnitus = ctx.createOscillator();
      this.tinnitus.frequency.value = 6800;
      const g = ctx.createGain();
      g.gain.value = 0.004;
      this.tinnitus.connect(g).connect(ctx.destination);
      this.tinnitus.start();
    } else if (!on && this.tinnitus) {
      this.tinnitus.stop();
      this.tinnitus = null;
    }
  }

  /** Rafale de bruit filtré, éventuellement différée, avec une fréquence qui glisse. */
  burst(o: { type: BiquadFilterType; freq: number; freqEnd?: number; q?: number; duration: number; volume: number; delay?: number }) {
    const { ctx, master, noise } = this;
    if (!ctx || !master || !noise) return;
    const t = ctx.currentTime + (o.delay ?? 0);
    const src = ctx.createBufferSource();
    src.buffer = noise;
    src.loop = true;
    const filter = ctx.createBiquadFilter();
    filter.type = o.type;
    filter.Q.value = o.q ?? 1;
    filter.frequency.setValueAtTime(o.freq, t);
    if (o.freqEnd) filter.frequency.exponentialRampToValueAtTime(o.freqEnd, t + o.duration);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(o.volume, t + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + o.duration);
    src.connect(filter).connect(gain).connect(master);
    src.start(t, Math.random() * 0.2);
    src.stop(t + o.duration + 0.05);
  }

  /** Note différée : pour les séquences (battements de cœur, cri étouffé). */
  toneAt(delay: number, freq: number, freqEnd: number, duration: number, volume: number, type: OscillatorType = 'sine') {
    const { ctx, master } = this;
    if (!ctx || !master) return;
    const t = ctx.currentTime + delay;
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    osc.frequency.exponentialRampToValueAtTime(freqEnd, t + duration);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(volume, t + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + duration);
    osc.connect(gain).connect(master);
    osc.start(t);
    osc.stop(t + duration + 0.05);
  }

  get context() {
    return this.ctx;
  }

  get output() {
    return this.master;
  }

  /** Coup de poing sur la table : bruit sourd et une basse qui chute. */
  knock() {
    this.play('knock', 1);
    const { ctx, master } = this;
    if (!ctx || !master) return;
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.frequency.setValueAtTime(90, now);
    osc.frequency.exponentialRampToValueAtTime(32, now + 0.4);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.9, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.5);
    osc.connect(gain).connect(master);
    osc.start(now);
    osc.stop(now + 0.55);
  }

  /** Les navigateurs exigent un geste de l'utilisateur avant de jouer du son. */
  unlock() {
    if (this.ctx) {
      void this.ctx.resume();
      return;
    }
    this.ctx = new AudioContext();
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.6;
    // Chaîne de l'oreille : un filtre et un panoramique, neutres tant qu'on a ses deux oreilles.
    this.ear = this.ctx.createBiquadFilter();
    this.ear.type = 'lowpass';
    this.ear.frequency.value = 20000;
    this.pan = this.ctx.createStereoPanner();
    this.master.connect(this.ear).connect(this.pan).connect(this.ctx.destination);
    if (this.deaf) this.setDeaf(true);
    const length = Math.floor(this.ctx.sampleRate * 0.25);
    this.noise = this.ctx.createBuffer(1, length, this.ctx.sampleRate);
    const data = this.noise.getChannelData(0);
    for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1;
  }

  play(kind: SfxKind, intensity: number) {
    const { ctx, master, noise } = this;
    if (!ctx || !master || !noise || intensity <= 0.01) return;
    const now = ctx.currentTime;
    if (now - (this.lastPlayed.get(kind) ?? 0) < MIN_INTERVAL) return;
    this.lastPlayed.set(kind, now);

    const p = PRESETS[kind];
    const src = ctx.createBufferSource();
    src.buffer = noise;
    src.playbackRate.value = 0.8 + Math.random() * 0.4;
    const filter = ctx.createBiquadFilter();
    filter.type = p.type;
    filter.frequency.value = p.freq * (0.85 + Math.random() * 0.3);
    filter.Q.value = p.q;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(Math.min(1, intensity) * p.volume, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + p.duration);
    src.connect(filter).connect(gain).connect(master);
    src.start(now, Math.random() * 0.2);
    src.stop(now + p.duration + 0.02);
  }

  /** Note courte, pour la révélation des dés et du score. */
  tone(freq: number, duration = 0.12, volume = 0.25, type: OscillatorType = 'triangle') {
    const { ctx, master } = this;
    if (!ctx || !master) return;
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, now);
    osc.frequency.exponentialRampToValueAtTime(freq * 1.02, now + duration);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(volume, now + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
    osc.connect(gain).connect(master);
    osc.start(now);
    osc.stop(now + duration + 0.02);
  }
}
