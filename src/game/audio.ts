export type SoundName = "break" | "place" | "step" | "jump" | "hurt" | "pickup" | "ui" | "ambient";
export type SoundMaterial = string | number;
export type AmbientKind = "plains" | "forest" | "desert" | "alpine" | "cave" | "night";

export interface AudioPlayOptions {
  volume?: number;
  /** Expressive strength multiplier, useful for partial break progress. */
  intensity?: number;
  /** Pitch multiplier. One is the authored pitch. */
  pitch?: number;
  /** Stereo position from -1 (left) to 1 (right). */
  pan?: number;
  /** Suppress repeated instances of the same sound/material within this window. */
  throttleMs?: number;
}

export interface VoxelAudioOptions {
  volume?: number;
  effectsVolume?: number;
  ambientVolume?: number;
  autoUnlock?: boolean;
}

export interface VoxelAudioState {
  supported: boolean;
  unlocked: boolean;
  muted: boolean;
  volume: number;
  effectsVolume: number;
  ambientVolume: number;
  ambientPlaying: boolean;
}

export type AudioStateListener = (state: Readonly<VoxelAudioState>) => void;

interface AmbientGraph {
  noise: AudioBufferSourceNode;
  noiseFilter: BiquadFilterNode;
  drone: OscillatorNode;
  droneFilter: BiquadFilterNode;
  lfo: OscillatorNode;
  lfoGain: GainNode;
  output: GainNode;
}

interface MaterialProfile {
  filter: BiquadFilterType;
  frequency: number;
  resonance: number;
  noiseColor: number;
  tone: number;
}

type SynthOptions = Required<Pick<AudioPlayOptions, "volume" | "pitch" | "pan">>;

const MATERIAL_PROFILES: Record<string, MaterialProfile> = {
  generic: { filter: "bandpass", frequency: 1050, resonance: 0.7, noiseColor: 0.2, tone: 105 },
  grass: { filter: "lowpass", frequency: 760, resonance: 0.5, noiseColor: 0.78, tone: 92 },
  dirt: { filter: "lowpass", frequency: 620, resonance: 0.45, noiseColor: 0.88, tone: 82 },
  stone: { filter: "highpass", frequency: 1350, resonance: 1.4, noiseColor: 0.08, tone: 148 },
  sand: { filter: "bandpass", frequency: 1450, resonance: 0.42, noiseColor: 0.96, tone: 72 },
  water: { filter: "lowpass", frequency: 430, resonance: 1.1, noiseColor: 0.96, tone: 68 },
  wood: { filter: "bandpass", frequency: 820, resonance: 1.1, noiseColor: 0.34, tone: 118 },
  leaves: { filter: "highpass", frequency: 1850, resonance: 0.35, noiseColor: 0.9, tone: 80 },
  metal: { filter: "highpass", frequency: 2450, resonance: 2.4, noiseColor: 0.04, tone: 226 },
  glass: { filter: "highpass", frequency: 3300, resonance: 2.8, noiseColor: 0.02, tone: 410 },
  snow: { filter: "bandpass", frequency: 1250, resonance: 0.28, noiseColor: 0.98, tone: 76 },
};

const BLOCK_MATERIALS: Record<number, keyof typeof MATERIAL_PROFILES> = {
  1: "grass",
  2: "dirt",
  3: "stone",
  4: "sand",
  5: "water",
  6: "wood",
  7: "leaves",
  8: "stone",
  9: "metal",
  10: "metal",
  11: "wood",
  12: "stone",
  13: "glass",
  14: "snow",
  15: "glass",
  16: "stone",
  17: "dirt",
  18: "stone",
  19: "grass",
};

function clamp(value: number, min = 0, max = 1): number {
  return Math.min(max, Math.max(min, Number.isFinite(value) ? value : min));
}

function audioContextConstructor(): typeof AudioContext | null {
  if (typeof window === "undefined") return null;
  const browserWindow = window as typeof window & { webkitAudioContext?: typeof AudioContext };
  return window.AudioContext ?? browserWindow.webkitAudioContext ?? null;
}

function materialProfile(material: SoundMaterial = "generic"): MaterialProfile {
  const key = typeof material === "number"
    ? BLOCK_MATERIALS[material] ?? "generic"
    : material.toLowerCase();
  if (key.includes("ore") || key.includes("iron") || key.includes("copper")) return MATERIAL_PROFILES.metal;
  if (key.includes("plank") || key.includes("log") || key.includes("wood")) return MATERIAL_PROFILES.wood;
  return MATERIAL_PROFILES[key] ?? MATERIAL_PROFILES.generic;
}

/**
 * Small procedural sound engine. Every effect is synthesized at runtime and
 * intentionally uses no sampled or copyrighted game audio.
 */
export class VoxelAudio {
  private context: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private effectsGain: GainNode | null = null;
  private ambientGain: GainNode | null = null;
  private ambient: AmbientGraph | null = null;
  private readonly listeners = new Set<AudioStateListener>();
  private readonly lastPlayedAt = new Map<string, number>();
  private removeGestureListeners: (() => void) | null = null;
  private noiseState = (Date.now() ^ 0x5f3759df) >>> 0;
  private volume: number;
  private effectsVolume: number;
  private ambientVolume: number;
  private muted = false;
  private unlocked = false;
  private disposed = false;

  constructor(options: VoxelAudioOptions = {}) {
    this.volume = clamp(options.volume ?? 0.55);
    this.effectsVolume = clamp(options.effectsVolume ?? 0.9);
    this.ambientVolume = clamp(options.ambientVolume ?? 0.36);
    if (options.autoUnlock !== false && typeof document !== "undefined") this.installGestureUnlock(document);
  }

  get state(): Readonly<VoxelAudioState> {
    return {
      supported: audioContextConstructor() !== null,
      unlocked: this.unlocked,
      muted: this.muted,
      volume: this.volume,
      effectsVolume: this.effectsVolume,
      ambientVolume: this.ambientVolume,
      ambientPlaying: this.ambient !== null,
    };
  }

  subscribe(listener: AudioStateListener): () => void {
    this.listeners.add(listener);
    listener(this.state);
    return () => this.listeners.delete(listener);
  }

  private emitState(): void {
    const state = this.state;
    for (const listener of this.listeners) listener(state);
  }

  private ensureContext(): AudioContext | null {
    if (this.disposed) return null;
    if (this.context) return this.context;
    const AudioContextClass = audioContextConstructor();
    if (!AudioContextClass) return null;
    const context = new AudioContextClass({ latencyHint: "interactive" });
    const master = context.createGain();
    const effects = context.createGain();
    const ambient = context.createGain();
    const compressor = context.createDynamicsCompressor();
    compressor.threshold.value = -18;
    compressor.knee.value = 12;
    compressor.ratio.value = 4;
    compressor.attack.value = 0.004;
    compressor.release.value = 0.18;
    effects.connect(master);
    ambient.connect(master);
    master.connect(compressor);
    compressor.connect(context.destination);
    this.context = context;
    this.masterGain = master;
    this.effectsGain = effects;
    this.ambientGain = ambient;
    this.applyVolumes();
    context.addEventListener("statechange", () => {
      const wasUnlocked = this.unlocked;
      this.unlocked = context.state === "running";
      if (this.unlocked !== wasUnlocked) this.emitState();
    });
    return context;
  }

  installGestureUnlock(target: EventTarget): () => void {
    this.removeGestureListeners?.();
    const trigger = () => {
      void this.unlock().then((success) => {
        if (success) this.removeGestureListeners?.();
      });
    };
    const events = ["pointerdown", "touchstart", "keydown"] as const;
    for (const event of events) target.addEventListener(event, trigger, { passive: true });
    const remove = () => {
      for (const event of events) target.removeEventListener(event, trigger);
      if (this.removeGestureListeners === remove) this.removeGestureListeners = null;
    };
    this.removeGestureListeners = remove;
    return remove;
  }

  async unlock(): Promise<boolean> {
    const context = this.ensureContext();
    if (!context) return false;
    try {
      if (context.state === "suspended") await context.resume();
      if (context.state === "running") {
        const silent = context.createBuffer(1, 1, context.sampleRate);
        const source = context.createBufferSource();
        source.buffer = silent;
        source.connect(context.destination);
        source.addEventListener("ended", () => source.disconnect(), { once: true });
        source.start();
        this.unlocked = true;
        this.emitState();
        return true;
      }
    } catch {
      // A later trusted gesture can retry unlock.
    }
    return false;
  }

  setVolume(value: number): void {
    this.volume = clamp(value);
    this.applyVolumes();
    this.emitState();
  }

  getVolume(): number {
    return this.volume;
  }

  setEffectsVolume(value: number): void {
    this.effectsVolume = clamp(value);
    this.applyVolumes();
    this.emitState();
  }

  setAmbientVolume(value: number): void {
    this.ambientVolume = clamp(value);
    this.applyVolumes();
    this.emitState();
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    this.applyVolumes();
    this.emitState();
  }

  toggleMuted(): boolean {
    this.setMuted(!this.muted);
    return this.muted;
  }

  private applyVolumes(): void {
    const now = this.context?.currentTime ?? 0;
    if (this.masterGain) this.masterGain.gain.setTargetAtTime(this.muted ? 0 : this.volume, now, 0.015);
    if (this.effectsGain) this.effectsGain.gain.setTargetAtTime(this.effectsVolume, now, 0.015);
    if (this.ambientGain) this.ambientGain.gain.setTargetAtTime(this.ambientVolume, now, 0.08);
  }

  private random(): number {
    this.noiseState = (Math.imul(this.noiseState, 1664525) + 1013904223) >>> 0;
    return this.noiseState / 0x100000000;
  }

  private noiseBuffer(context: AudioContext, seconds: number, color: number): AudioBuffer {
    const length = Math.max(1, Math.ceil(context.sampleRate * seconds));
    const buffer = context.createBuffer(1, length, context.sampleRate);
    const samples = buffer.getChannelData(0);
    let brown = 0;
    let previous = 0;
    for (let index = 0; index < length; index += 1) {
      const white = this.random() * 2 - 1;
      brown = (brown + white * 0.055) / 1.055;
      previous = previous * 0.72 + white * 0.28;
      const warm = brown * 3.1;
      samples[index] = white * (1 - color) + (previous * 0.55 + warm * 0.45) * color;
    }
    return buffer;
  }

  private connectVoice(node: AudioNode, gain: GainNode, pan: number): () => void {
    const context = this.context;
    if (!context || !this.effectsGain) return () => undefined;
    node.connect(gain);
    if (typeof context.createStereoPanner === "function") {
      const panner = context.createStereoPanner();
      panner.pan.value = clamp(pan, -1, 1);
      gain.connect(panner);
      panner.connect(this.effectsGain);
      return () => {
        gain.disconnect();
        panner.disconnect();
      };
    } else {
      gain.connect(this.effectsGain);
      return () => gain.disconnect();
    }
  }

  private noiseBurst(
    at: number,
    duration: number,
    profile: MaterialProfile,
    peak: number,
    options: SynthOptions,
  ): void {
    const context = this.context;
    if (!context) return;
    const source = context.createBufferSource();
    const filter = context.createBiquadFilter();
    const gain = context.createGain();
    source.buffer = this.noiseBuffer(context, duration + 0.03, profile.noiseColor);
    source.playbackRate.value = options.pitch * (0.92 + this.random() * 0.16);
    filter.type = profile.filter;
    filter.frequency.value = profile.frequency * options.pitch * (0.88 + this.random() * 0.24);
    filter.Q.value = profile.resonance;
    source.connect(filter);
    const disconnectVoice = this.connectVoice(filter, gain, options.pan);
    gain.gain.setValueAtTime(0.0001, at);
    gain.gain.exponentialRampToValueAtTime(Math.max(0.0001, peak * options.volume), at + 0.005);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + duration);
    source.start(at);
    source.stop(at + duration + 0.025);
    source.addEventListener("ended", () => {
      source.disconnect();
      filter.disconnect();
      disconnectVoice();
    }, { once: true });
  }

  private tone(
    at: number,
    duration: number,
    startFrequency: number,
    endFrequency: number,
    peak: number,
    type: OscillatorType,
    options: SynthOptions,
  ): void {
    const context = this.context;
    if (!context) return;
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.type = type;
    oscillator.frequency.setValueAtTime(Math.max(20, startFrequency * options.pitch), at);
    oscillator.frequency.exponentialRampToValueAtTime(Math.max(20, endFrequency * options.pitch), at + duration);
    const disconnectVoice = this.connectVoice(oscillator, gain, options.pan);
    gain.gain.setValueAtTime(0.0001, at);
    gain.gain.exponentialRampToValueAtTime(Math.max(0.0001, peak * options.volume), at + Math.min(0.008, duration * 0.2));
    gain.gain.exponentialRampToValueAtTime(0.0001, at + duration);
    oscillator.start(at);
    oscillator.stop(at + duration + 0.01);
    oscillator.addEventListener("ended", () => {
      oscillator.disconnect();
      disconnectVoice();
    }, { once: true });
  }

  play(name: SoundName, material: SoundMaterial = "generic", options: AudioPlayOptions = {}): boolean {
    if (name === "ambient") {
      const ambientKinds: readonly string[] = ["plains", "forest", "desert", "alpine", "cave", "night"];
      const kind = typeof material === "string" && ambientKinds.includes(material) ? material as AmbientKind : "plains";
      this.startAmbient(kind);
      return this.ambient !== null;
    }
    const context = this.ensureContext();
    if (!context || !this.effectsGain) return false;
    if (context.state === "suspended") void context.resume().catch(() => undefined);
    const throttleMs = clamp(options.throttleMs ?? 0, 0, 60_000);
    if (throttleMs > 0) {
      const throttleKey = `${name}:${String(material).toLowerCase()}`;
      const timestamp = typeof performance !== "undefined" ? performance.now() : Date.now();
      const previous = this.lastPlayedAt.get(throttleKey) ?? -Infinity;
      if (timestamp - previous < throttleMs) return false;
      this.lastPlayedAt.set(throttleKey, timestamp);
    }
    const normalized: SynthOptions = {
      volume: clamp((options.volume ?? 1) * (options.intensity ?? 1), 0, 2),
      pitch: clamp(options.pitch ?? 1, 0.35, 2.5),
      pan: clamp(options.pan ?? 0, -1, 1),
    };
    const profile = materialProfile(material);
    const now = context.currentTime + 0.004;

    switch (name) {
      case "break":
        this.noiseBurst(now, 0.19, profile, 0.72, normalized);
        for (let index = 0; index < 3; index += 1) {
          const offset = index * 0.037 + this.random() * 0.012;
          this.tone(now + offset, 0.055, profile.tone * (1.25 + this.random() * 0.35), profile.tone * 0.72, 0.12, "triangle", normalized);
        }
        break;
      case "place":
        this.noiseBurst(now, 0.085, profile, 0.44, normalized);
        this.tone(now, 0.105, profile.tone * 1.08, profile.tone * 0.62, 0.2, "triangle", normalized);
        break;
      case "step":
        this.noiseBurst(now, 0.075, profile, 0.31, { ...normalized, pitch: normalized.pitch * (0.92 + this.random() * 0.16) });
        this.tone(now, 0.045, profile.tone * 0.8, profile.tone * 0.58, 0.055, "sine", normalized);
        break;
      case "jump":
        this.tone(now, 0.15, 118, 235, 0.16, "triangle", normalized);
        this.noiseBurst(now, 0.06, MATERIAL_PROFILES.grass, 0.12, normalized);
        break;
      case "hurt":
        this.tone(now, 0.23, 184, 74, 0.3, "sawtooth", normalized);
        this.tone(now + 0.012, 0.19, 246, 102, 0.18, "square", { ...normalized, pitch: normalized.pitch * 0.98 });
        this.noiseBurst(now, 0.12, MATERIAL_PROFILES.generic, 0.16, normalized);
        break;
      case "pickup":
        [587, 784, 1175].forEach((frequency, index) => {
          this.tone(now + index * 0.055, 0.12, frequency, frequency * 1.025, 0.13, "sine", normalized);
        });
        break;
      case "ui":
        this.tone(now, 0.052, 520, 390, 0.12, "sine", normalized);
        this.tone(now + 0.012, 0.035, 1040, 820, 0.04, "triangle", normalized);
        break;
    }
    return true;
  }

  startAmbient(kind: AmbientKind = "plains", intensity = 1): void {
    const context = this.ensureContext();
    if (!context || !this.ambientGain) return;
    this.stopAmbient(0.08);
    const now = context.currentTime;
    const output = context.createGain();
    const noise = context.createBufferSource();
    const noiseFilter = context.createBiquadFilter();
    const drone = context.createOscillator();
    const droneFilter = context.createBiquadFilter();
    const lfo = context.createOscillator();
    const lfoGain = context.createGain();
    const profile = {
      plains: { cutoff: 680, drone: 58, rate: 0.075, level: 0.052 },
      forest: { cutoff: 520, drone: 49, rate: 0.11, level: 0.058 },
      desert: { cutoff: 920, drone: 66, rate: 0.055, level: 0.046 },
      alpine: { cutoff: 1200, drone: 73, rate: 0.09, level: 0.044 },
      cave: { cutoff: 310, drone: 41, rate: 0.045, level: 0.065 },
      night: { cutoff: 430, drone: 52, rate: 0.065, level: 0.04 },
    }[kind];
    noise.buffer = this.noiseBuffer(context, 5, 0.94);
    noise.loop = true;
    noiseFilter.type = "lowpass";
    noiseFilter.frequency.value = profile.cutoff;
    noiseFilter.Q.value = kind === "cave" ? 2.8 : 0.75;
    drone.type = "sine";
    drone.frequency.value = profile.drone;
    droneFilter.type = "lowpass";
    droneFilter.frequency.value = 150;
    lfo.type = "sine";
    lfo.frequency.value = profile.rate;
    lfoGain.gain.value = profile.level * 0.32;
    output.gain.setValueAtTime(0.0001, now);
    output.gain.exponentialRampToValueAtTime(Math.max(0.0001, profile.level * clamp(intensity, 0, 1.5)), now + 1.2);
    noise.connect(noiseFilter);
    noiseFilter.connect(output);
    drone.connect(droneFilter);
    droneFilter.connect(output);
    lfo.connect(lfoGain);
    lfoGain.connect(output.gain);
    output.connect(this.ambientGain);
    noise.start(now);
    drone.start(now);
    lfo.start(now);
    this.ambient = { noise, noiseFilter, drone, droneFilter, lfo, lfoGain, output };
    this.emitState();
  }

  stopAmbient(fadeSeconds = 0.5): void {
    const graph = this.ambient;
    const context = this.context;
    if (!graph || !context) return;
    this.ambient = null;
    const now = context.currentTime;
    const stopAt = now + clamp(fadeSeconds, 0.02, 3);
    graph.output.gain.cancelScheduledValues(now);
    graph.output.gain.setValueAtTime(Math.max(0.0001, graph.output.gain.value), now);
    graph.output.gain.exponentialRampToValueAtTime(0.0001, stopAt);
    graph.noise.stop(stopAt + 0.02);
    graph.drone.stop(stopAt + 0.02);
    graph.lfo.stop(stopAt + 0.02);
    graph.noise.addEventListener("ended", () => {
      graph.noise.disconnect();
      graph.noiseFilter.disconnect();
      graph.drone.disconnect();
      graph.droneFilter.disconnect();
      graph.lfo.disconnect();
      graph.lfoGain.disconnect();
      graph.output.disconnect();
    }, { once: true });
    this.emitState();
  }

  async dispose(): Promise<void> {
    if (this.disposed) return;
    this.removeGestureListeners?.();
    this.stopAmbient(0.02);
    const context = this.context;
    this.disposed = true;
    this.listeners.clear();
    this.context = null;
    this.masterGain = null;
    this.effectsGain = null;
    this.ambientGain = null;
    if (context && context.state !== "closed") await context.close();
  }
}

export const audio = new VoxelAudio();
export const audioEngine = audio;
