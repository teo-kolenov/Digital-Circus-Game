const MASTER_VOLUME = 0.62;
const FOOTSTEP_INTERVAL_SECONDS = 0.32;
const FOOTSTEP_VOLUME_MULTIPLIER = 2;
const NPC_VANISH_SOUND_URL = new URL("../../bang.mp3", import.meta.url).href;
const NPC_VANISH_VOLUME = 0.14;

type AudioGraph = {
  context: AudioContext;
  output: GainNode;
};

type WindowWithWebkitAudio = Window &
  typeof globalThis & {
    webkitAudioContext?: typeof AudioContext;
  };

export class SoundController {
  private context: AudioContext | null = null;
  private output: GainNode | null = null;
  private walkTimer = 0;
  private footstepSide = -1;
  private npcVanishBuffer: AudioBuffer | null = null;
  private npcVanishLoad: Promise<AudioBuffer | null> | null = null;
  private readonly activeTimers = new Set<number>();
  private readonly activeSources = new Set<AudioScheduledSourceNode>();

  constructor() {
    window.addEventListener("pointerdown", this.unlockAudio, { passive: true });
    window.addEventListener("keydown", this.unlockAudio, { passive: true });
  }

  updateWalking(isWalking: boolean, deltaSeconds: number): void {
    if (!isWalking) {
      this.walkTimer = 0;
      return;
    }

    this.walkTimer -= deltaSeconds;

    if (this.walkTimer <= 0) {
      this.playFootstep();
      this.walkTimer = FOOTSTEP_INTERVAL_SECONDS + Math.random() * 0.045;
    }
  }

  playDoorOpen(): void {
    const graph = this.ensureAudio();

    if (!graph) {
      return;
    }

    this.resumeAudio();

    const { context, output } = graph;
    const start = context.currentTime;
    const groan = context.createOscillator();
    const groanFilter = context.createBiquadFilter();
    const groanGain = context.createGain();

    groan.type = "sawtooth";
    groan.frequency.setValueAtTime(168, start);
    groan.frequency.exponentialRampToValueAtTime(54, start + 0.58);
    groanFilter.type = "lowpass";
    groanFilter.frequency.setValueAtTime(660, start);
    groanFilter.frequency.exponentialRampToValueAtTime(250, start + 0.58);
    groanGain.gain.setValueAtTime(0, start);
    groanGain.gain.linearRampToValueAtTime(0.16, start + 0.04);
    groanGain.gain.linearRampToValueAtTime(0.055, start + 0.34);
    groanGain.gain.linearRampToValueAtTime(0, start + 0.64);

    groan.connect(groanFilter);
    groanFilter.connect(groanGain);
    groanGain.connect(output);
    this.scheduleSource(groan, start, start + 0.66);

    const scrape = context.createBufferSource();
    const scrapeFilter = context.createBiquadFilter();
    const scrapeGain = context.createGain();
    const scrapeStart = start + 0.05;

    scrape.buffer = this.createNoiseBuffer(context, 0.5);
    scrapeFilter.type = "bandpass";
    scrapeFilter.frequency.setValueAtTime(340, scrapeStart);
    scrapeFilter.Q.value = 4.2;
    scrapeGain.gain.setValueAtTime(0, scrapeStart);
    scrapeGain.gain.linearRampToValueAtTime(0.07, scrapeStart + 0.05);
    scrapeGain.gain.linearRampToValueAtTime(0.02, scrapeStart + 0.35);
    scrapeGain.gain.linearRampToValueAtTime(0, scrapeStart + 0.5);

    scrape.connect(scrapeFilter);
    scrapeFilter.connect(scrapeGain);
    scrapeGain.connect(output);
    this.scheduleSource(scrape, scrapeStart, scrapeStart + 0.52);

    this.playTone(context, output, 620, start, 0.055, 0.055, "square");
  }

  playTake(): void {
    const graph = this.ensureAudio();

    if (!graph) {
      return;
    }

    this.resumeAudio();

    const { context, output } = graph;
    const start = context.currentTime;

    this.playTone(context, output, 660, start, 0.16, 0.105, "triangle");
    this.playTone(context, output, 920, start + 0.075, 0.15, 0.09, "sine");
    this.playTone(context, output, 1320, start + 0.15, 0.18, 0.072, "sine");

    const sparkle = context.createBufferSource();
    const sparkleFilter = context.createBiquadFilter();
    const sparkleGain = context.createGain();

    sparkle.buffer = this.createNoiseBuffer(context, 0.18);
    sparkleFilter.type = "highpass";
    sparkleFilter.frequency.value = 2400;
    sparkleGain.gain.setValueAtTime(0, start);
    sparkleGain.gain.linearRampToValueAtTime(0.028, start + 0.02);
    sparkleGain.gain.linearRampToValueAtTime(0, start + 0.16);

    sparkle.connect(sparkleFilter);
    sparkleFilter.connect(sparkleGain);
    sparkleGain.connect(output);
    this.scheduleSource(sparkle, start, start + 0.18);
  }

  playWin(delaySeconds = 0): void {
    const graph = this.ensureAudio();

    if (!graph) {
      return;
    }

    this.resumeAudio();

    const { context, output } = graph;
    const start = context.currentTime + delaySeconds;
    const notes = [
      { frequency: 523.25, offset: 0, duration: 0.18, volume: 0.14 },
      { frequency: 659.25, offset: 0.13, duration: 0.18, volume: 0.14 },
      { frequency: 783.99, offset: 0.26, duration: 0.2, volume: 0.15 },
      { frequency: 1046.5, offset: 0.42, duration: 0.46, volume: 0.18 },
    ];

    for (const note of notes) {
      this.playTone(context, output, note.frequency, start + note.offset, note.duration, note.volume, "square");
    }

    this.playTone(context, output, 261.63, start, 0.58, 0.1, "triangle");
    this.playTone(context, output, 329.63, start + 0.16, 0.48, 0.085, "triangle");
    this.playTone(context, output, 392, start + 0.31, 0.52, 0.09, "triangle");
    this.playTone(context, output, 1318.51, start + 0.52, 0.24, 0.09, "sine");
    this.playTone(context, output, 1567.98, start + 0.64, 0.3, 0.082, "sine");

    const shimmer = context.createBufferSource();
    const shimmerFilter = context.createBiquadFilter();
    const shimmerGain = context.createGain();

    shimmer.buffer = this.createNoiseBuffer(context, 0.9);
    shimmerFilter.type = "highpass";
    shimmerFilter.frequency.value = 2500;
    shimmerGain.gain.setValueAtTime(0, start + 0.08);
    shimmerGain.gain.linearRampToValueAtTime(0.055, start + 0.18);
    shimmerGain.gain.linearRampToValueAtTime(0.026, start + 0.58);
    shimmerGain.gain.linearRampToValueAtTime(0, start + 0.94);

    shimmer.connect(shimmerFilter);
    shimmerFilter.connect(shimmerGain);
    shimmerGain.connect(output);
    this.scheduleSource(shimmer, start + 0.08, start + 0.96);
  }

  playNpcVanish(delaySeconds = 0): void {
    const graph = this.ensureAudio();

    if (!graph) {
      return;
    }

    this.resumeAudio();

    if (delaySeconds <= 0) {
      this.playNpcVanishBuffer(graph);
      return;
    }

    const timer = window.setTimeout(() => {
      this.activeTimers.delete(timer);
      this.playNpcVanishBuffer(graph);
    }, delaySeconds * 1000);
    this.activeTimers.add(timer);
  }

  playGameOver(delaySeconds = 0): void {
    const graph = this.ensureAudio();

    if (!graph) {
      return;
    }

    this.resumeAudio();

    const { context, output } = graph;
    const start = context.currentTime + delaySeconds;
    const fall = context.createOscillator();
    const fallFilter = context.createBiquadFilter();
    const fallGain = context.createGain();

    fall.type = "triangle";
    fall.frequency.setValueAtTime(220, start);
    fall.frequency.exponentialRampToValueAtTime(62, start + 0.9);
    fallFilter.type = "lowpass";
    fallFilter.frequency.setValueAtTime(520, start);
    fallFilter.frequency.exponentialRampToValueAtTime(140, start + 0.9);
    fallGain.gain.setValueAtTime(0, start);
    fallGain.gain.linearRampToValueAtTime(0.18, start + 0.04);
    fallGain.gain.linearRampToValueAtTime(0.13, start + 0.42);
    fallGain.gain.linearRampToValueAtTime(0, start + 1.0);

    fall.connect(fallFilter);
    fallFilter.connect(fallGain);
    fallGain.connect(output);
    this.scheduleSource(fall, start, start + 1.02);

    this.playTone(context, output, 392, start + 0.02, 0.24, 0.07, "sawtooth");
    this.playTone(context, output, 277, start + 0.23, 0.28, 0.075, "sawtooth");
    this.playTone(context, output, 196, start + 0.48, 0.38, 0.085, "sawtooth");

    const hit = context.createBufferSource();
    const hitFilter = context.createBiquadFilter();
    const hitGain = context.createGain();

    hit.buffer = this.createNoiseBuffer(context, 0.22);
    hitFilter.type = "lowpass";
    hitFilter.frequency.value = 180;
    hitGain.gain.setValueAtTime(0, start);
    hitGain.gain.linearRampToValueAtTime(0.13, start + 0.012);
    hitGain.gain.linearRampToValueAtTime(0, start + 0.2);

    hit.connect(hitFilter);
    hitFilter.connect(hitGain);
    hitGain.connect(output);
    this.scheduleSource(hit, start, start + 0.22);
  }

  reset(): void {
    this.walkTimer = 0;

    for (const timer of this.activeTimers) {
      window.clearTimeout(timer);
    }

    this.activeTimers.clear();

    for (const source of this.activeSources) {
      try {
        source.stop();
      } catch {
        // The source may already have ended.
      }
    }

    this.activeSources.clear();
  }

  private playNpcVanishBuffer(graph: AudioGraph): void {
    const playBuffer = (buffer: AudioBuffer | null) => {
      if (!buffer) {
        return;
      }

      const source = graph.context.createBufferSource();
      const gain = graph.context.createGain();
      const start = graph.context.currentTime;

      source.buffer = buffer;
      gain.gain.setValueAtTime(NPC_VANISH_VOLUME, start);
      source.connect(gain);
      gain.connect(graph.output);
      this.scheduleSource(source, start, start + buffer.duration + 0.02);
    };

    if (this.npcVanishBuffer) {
      playBuffer(this.npcVanishBuffer);
      return;
    }

    void this.loadNpcVanishBuffer(graph.context).then(playBuffer);
  }

  private loadNpcVanishBuffer(context: AudioContext): Promise<AudioBuffer | null> {
    if (this.npcVanishBuffer) {
      return Promise.resolve(this.npcVanishBuffer);
    }

    if (!this.npcVanishLoad) {
      this.npcVanishLoad = fetch(NPC_VANISH_SOUND_URL)
        .then((response) => {
          if (!response.ok) {
            return null;
          }

          return response.arrayBuffer();
        })
        .then((buffer) => {
          if (!buffer) {
            return null;
          }

          return context.decodeAudioData(buffer);
        })
        .then((buffer) => {
          this.npcVanishBuffer = buffer;
          return buffer;
        })
        .catch(() => null);
    }

    return this.npcVanishLoad;
  }

  private playFootstep(): void {
    const graph = this.ensureAudio();

    if (!graph) {
      return;
    }

    this.resumeAudio();

    const { context, output } = graph;
    const start = context.currentTime;
    const pan = context.createStereoPanner();
    const thud = context.createOscillator();
    const thudGain = context.createGain();
    const scuff = context.createBufferSource();
    const scuffFilter = context.createBiquadFilter();
    const scuffGain = context.createGain();

    pan.pan.value = this.footstepSide * 0.14;
    this.footstepSide *= -1;
    pan.connect(output);

    thud.type = "triangle";
    thud.frequency.setValueAtTime(82 + Math.random() * 18, start);
    thud.frequency.exponentialRampToValueAtTime(48, start + 0.095);
    thudGain.gain.setValueAtTime(0, start);
    thudGain.gain.linearRampToValueAtTime(0.082 * FOOTSTEP_VOLUME_MULTIPLIER, start + 0.012);
    thudGain.gain.linearRampToValueAtTime(0, start + 0.13);
    thud.connect(thudGain);
    thudGain.connect(pan);
    this.scheduleSource(thud, start, start + 0.14);

    scuff.buffer = this.createNoiseBuffer(context, 0.105);
    scuffFilter.type = "lowpass";
    scuffFilter.frequency.value = 720;
    scuffGain.gain.setValueAtTime(0, start);
    scuffGain.gain.linearRampToValueAtTime(0.025 * FOOTSTEP_VOLUME_MULTIPLIER, start + 0.014);
    scuffGain.gain.linearRampToValueAtTime(0, start + 0.105);
    scuff.connect(scuffFilter);
    scuffFilter.connect(scuffGain);
    scuffGain.connect(pan);
    this.scheduleSource(scuff, start, start + 0.115);
  }

  private playTone(
    context: AudioContext,
    output: AudioNode,
    frequency: number,
    start: number,
    duration: number,
    volume: number,
    type: OscillatorType,
  ): void {
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    const attack = Math.min(0.025, duration * 0.35);

    oscillator.type = type;
    oscillator.frequency.setValueAtTime(frequency, start);
    gain.gain.setValueAtTime(0, start);
    gain.gain.linearRampToValueAtTime(volume, start + attack);
    gain.gain.linearRampToValueAtTime(volume * 0.42, start + duration * 0.58);
    gain.gain.linearRampToValueAtTime(0, start + duration);

    oscillator.connect(gain);
    gain.connect(output);
    this.scheduleSource(oscillator, start, start + duration + 0.02);
  }

  private createNoiseBuffer(context: AudioContext, durationSeconds: number): AudioBuffer {
    const frameCount = Math.max(1, Math.floor(context.sampleRate * durationSeconds));
    const buffer = context.createBuffer(1, frameCount, context.sampleRate);
    const data = buffer.getChannelData(0);

    for (let index = 0; index < frameCount; index += 1) {
      data[index] = Math.random() * 2 - 1;
    }

    return buffer;
  }

  private scheduleSource(source: AudioScheduledSourceNode, start: number, stop: number): void {
    this.activeSources.add(source);
    source.addEventListener("ended", () => this.activeSources.delete(source), { once: true });
    source.start(start);
    source.stop(stop);
  }

  private ensureAudio(): AudioGraph | null {
    if (this.context && this.output) {
      return {
        context: this.context,
        output: this.output,
      };
    }

    const AudioContextConstructor =
      window.AudioContext ?? (window as WindowWithWebkitAudio).webkitAudioContext;

    if (!AudioContextConstructor) {
      return null;
    }

    this.context = new AudioContextConstructor();
    this.output = this.context.createGain();
    this.output.gain.value = MASTER_VOLUME;
    this.output.connect(this.context.destination);

    return {
      context: this.context,
      output: this.output,
    };
  }

  private resumeAudio(): void {
    if (this.context?.state === "suspended") {
      void this.context.resume().catch(() => undefined);
    }
  }

  private readonly unlockAudio = (): void => {
    const graph = this.ensureAudio();

    if (!graph) {
      return;
    }

    void this.loadNpcVanishBuffer(graph.context);
    this.resumeAudio();
    window.removeEventListener("pointerdown", this.unlockAudio);
    window.removeEventListener("keydown", this.unlockAudio);
  };
}
