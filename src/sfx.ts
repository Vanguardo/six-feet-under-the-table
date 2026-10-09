// Sons procéduraux de chocs : du bruit filtré, en attendant de vrais enregistrements.

export type SfxKind = 'click' | 'cup' | 'felt' | 'wood';

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
};

const MIN_INTERVAL = 0.012;

export class Sfx {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  private readonly lastPlayed = new Map<SfxKind, number>();

  /** Les navigateurs exigent un geste de l'utilisateur avant de jouer du son. */
  unlock() {
    if (this.ctx) {
      void this.ctx.resume();
      return;
    }
    this.ctx = new AudioContext();
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.6;
    this.master.connect(this.ctx.destination);
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
