import { base64PcmToFloat32, LIVE_OUTPUT_SAMPLE_RATE } from './pcm';

let sharedAudioCtx: AudioContext | null = null;

function getAudioContext(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  const Ctx =
    window.AudioContext ||
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctx) return null;
  if (!sharedAudioCtx || sharedAudioCtx.state === 'closed') {
    sharedAudioCtx = new Ctx();
  }
  if (sharedAudioCtx.state === 'suspended') {
    sharedAudioCtx.resume().catch(() => {});
  }
  return sharedAudioCtx;
}

/**
 * Call synchronously inside user click / submit handlers to unlock browser audio playback
 * before asynchronous network requests resolve.
 */
export function unlockAudioOutput(): void {
  getAudioContext();
}

export function playJarvisChime(kind: 'activate' | 'confirm' | 'reminder'): void {
  const ctx = getAudioContext();
  if (!ctx) return;

  const now = ctx.currentTime;
  const playTone = (freq: number, startOffset: number, duration: number, gainPeak: number) => {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(freq, now + startOffset);
    gain.gain.setValueAtTime(0.0001, now + startOffset);
    gain.gain.exponentialRampToValueAtTime(gainPeak, now + startOffset + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + startOffset + duration);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now + startOffset);
    osc.stop(now + startOffset + duration + 0.02);
  };

  if (kind === 'activate') {
    playTone(587.33, 0, 0.07, 0.04);
    playTone(880, 0.035, 0.09, 0.035);
  } else if (kind === 'confirm') {
    playTone(523.25, 0, 0.12, 0.035);
    playTone(659.25, 0.07, 0.14, 0.035);
    playTone(1046.5, 0.14, 0.22, 0.03);
  } else {
    playTone(659.25, 0, 0.18, 0.05);
    playTone(880, 0.15, 0.25, 0.05);
    playTone(659.25, 0.36, 0.18, 0.04);
  }
}

export interface PlaybackHandle {
  promise: Promise<void>;
  stop: () => void;
}

/**
 * Plays unary WAV base64 audio via the unlocked shared AudioContext with an AnalyserNode
 * so browser autoplay locks do not swallow delayed API replies, falling back to `<audio>`.
 */
export function playWavBase64(
  base64: string,
  mimeType: string,
  amplitudeRef: { current: number },
  onStart?: () => void,
): PlaybackHandle {
  let stopped = false;
  let rafId = 0;
  let sourceNode: AudioBufferSourceNode | null = null;
  let htmlAudio: HTMLAudioElement | null = null;
  let objectUrl: string | null = null;
  let resolvePromise: (() => void) | null = null;

  const stop = () => {
    if (stopped) return;
    stopped = true;
    if (rafId) {
      cancelAnimationFrame(rafId);
      rafId = 0;
    }
    amplitudeRef.current = 0;
    if (sourceNode) {
      try {
        sourceNode.onended = null;
        sourceNode.stop();
        sourceNode.disconnect();
      } catch {
        // already stopped
      }
      sourceNode = null;
    }
    if (htmlAudio) {
      try {
        htmlAudio.pause();
        htmlAudio.src = '';
      } catch {
        // ignore
      }
      htmlAudio = null;
    }
    if (objectUrl) {
      URL.revokeObjectURL(objectUrl);
      objectUrl = null;
    }
    resolvePromise?.();
  };

  const promise = new Promise<void>((resolve) => {
    resolvePromise = resolve;

    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }

    const ctx = getAudioContext();
    if (ctx) {
      const copy = bytes.buffer.slice(0);
      ctx
        .decodeAudioData(copy)
        .then((audioBuffer) => {
          if (stopped) {
            resolve();
            return;
          }
          if (ctx.state === 'suspended') {
            void ctx.resume();
          }

          const src = ctx.createBufferSource();
          src.buffer = audioBuffer;
          const analyser = ctx.createAnalyser();
          analyser.fftSize = 128;
          src.connect(analyser);
          analyser.connect(ctx.destination);
          sourceNode = src;

          const data = new Uint8Array(analyser.frequencyBinCount);
          const tick = () => {
            if (stopped || !sourceNode) return;
            analyser.getByteTimeDomainData(data);
            let sum = 0;
            for (let i = 0; i < data.length; i++) {
              const v = (data[i] - 128) / 128;
              sum += v * v;
            }
            const rms = Math.sqrt(sum / data.length);
            amplitudeRef.current = Math.min(1, rms * 3.5);
            rafId = requestAnimationFrame(tick);
          };

          src.onended = () => stop();
          onStart?.();
          tick();
          src.start(0);
        })
        .catch(() => {
          if (stopped) {
            resolve();
            return;
          }
          playWithHtmlAudio(bytes);
        });
    } else {
      playWithHtmlAudio(bytes);
    }

    function playWithHtmlAudio(audioBytes: Uint8Array<ArrayBuffer>) {
      const blob = new Blob([audioBytes], { type: mimeType || 'audio/wav' });
      objectUrl = URL.createObjectURL(blob);
      const audio = new Audio(objectUrl);
      htmlAudio = audio;

      let phase = 0;
      const tick = () => {
        if (stopped || !htmlAudio || htmlAudio.paused) return;
        phase += 0.22;
        amplitudeRef.current = 0.35 + Math.abs(Math.sin(phase) * 0.45);
        rafId = requestAnimationFrame(tick);
      };

      const safety = window.setTimeout(() => stop(), 20000);
      audio.onplay = () => {
        onStart?.();
        tick();
      };
      audio.onended = () => {
        window.clearTimeout(safety);
        stop();
      };
      audio.onerror = () => {
        window.clearTimeout(safety);
        stop();
      };
      audio.play().catch(() => {
        window.clearTimeout(safety);
        stop();
      });
    }
  });

  return { promise, stop };
}

/**
 * Gapless 24kHz PCM audio scheduler for Gemini Live streaming responses,
 * supporting instant barge-in interruption and live waveform reactivity.
 */
export class LiveAudioPlayer {
  private ctx: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private activeSources = new Set<AudioBufferSourceNode>();
  private nextStartTime = 0;
  private rafId = 0;
  private amplitudeRef: { current: number };
  private onSpeakingChange?: (speaking: boolean) => void;

  constructor(
    amplitudeRef: { current: number },
    onSpeakingChange?: (speaking: boolean) => void,
  ) {
    this.amplitudeRef = amplitudeRef;
    this.onSpeakingChange = onSpeakingChange;
  }

  private ensureContext(): AudioContext | null {
    if (typeof window === 'undefined') return null;
    const Ctx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return null;

    if (!this.ctx || this.ctx.state === 'closed') {
      // Use native device sample rate (AudioBuffer carries explicit 24kHz rate) to prevent
      // Safari/Firefox hardware clock mismatches while resuming cleanly inside user gestures.
      this.ctx = new Ctx();
      this.analyser = this.ctx.createAnalyser();
      this.analyser.fftSize = 128;
      this.analyser.connect(this.ctx.destination);
    }

    if (this.ctx.state === 'suspended') {
      this.ctx.resume().catch(() => {});
    }
    return this.ctx;
  }

  unlock(): void {
    this.ensureContext();
  }

  isSpeaking(): boolean {
    return this.activeSources.size > 0;
  }

  enqueuePcmBase64(base64: string): void {
    const ctx = this.ensureContext();
    if (!ctx || !this.analyser) return;

    const samples = base64PcmToFloat32(base64);
    if (samples.length === 0) return;

    const buffer = ctx.createBuffer(1, samples.length, LIVE_OUTPUT_SAMPLE_RATE);
    buffer.copyToChannel(new Float32Array(samples), 0);

    const src = ctx.createBufferSource();
    src.buffer = buffer;
    src.connect(this.analyser);

    const startAt = Math.max(ctx.currentTime + 0.02, this.nextStartTime);
    this.nextStartTime = startAt + buffer.duration;

    this.activeSources.add(src);
    if (this.activeSources.size === 1) {
      this.onSpeakingChange?.(true);
      this.startMeter();
    }

    src.onended = () => {
      this.activeSources.delete(src);
      if (this.activeSources.size === 0) {
        this.stopMeter();
        this.onSpeakingChange?.(false);
      }
    };

    src.start(startAt);
  }

  interrupt(): void {
    for (const src of this.activeSources) {
      try {
        src.onended = null;
        src.stop();
        src.disconnect();
      } catch {
        // ignore
      }
    }
    this.activeSources.clear();
    this.nextStartTime = 0;
    this.stopMeter();
    this.onSpeakingChange?.(false);
  }

  close(): void {
    this.interrupt();
    if (this.ctx && this.ctx.state !== 'closed') {
      this.ctx.close().catch(() => {});
    }
    this.ctx = null;
    this.analyser = null;
  }

  private startMeter(): void {
    if (this.rafId || !this.analyser) return;
    const data = new Uint8Array(this.analyser.frequencyBinCount);
    const tick = () => {
      if (!this.analyser || this.activeSources.size === 0) {
        this.amplitudeRef.current = 0;
        this.rafId = 0;
        return;
      }
      this.analyser.getByteTimeDomainData(data);
      let sum = 0;
      for (let i = 0; i < data.length; i++) {
        const v = (data[i] - 128) / 128;
        sum += v * v;
      }
      const rms = Math.sqrt(sum / data.length);
      this.amplitudeRef.current = Math.min(1, rms * 3.8);
      this.rafId = requestAnimationFrame(tick);
    };
    this.rafId = requestAnimationFrame(tick);
  }

  private stopMeter(): void {
    if (this.rafId) {
      cancelAnimationFrame(this.rafId);
      this.rafId = 0;
    }
    this.amplitudeRef.current = 0;
  }
}

let activeSpeechSafetyTimer: number | null = null;

export function cancelBrowserSpeech(): void {
  if (activeSpeechSafetyTimer !== null && typeof window !== 'undefined') {
    window.clearTimeout(activeSpeechSafetyTimer);
    activeSpeechSafetyTimer = null;
  }
  if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
    try {
      window.speechSynthesis.cancel();
    } catch {
      // ignore
    }
  }
}

export function speakWithBrowserSynthesis(
  text: string,
  onStart?: () => void,
  onEnd?: () => void,
): boolean {
  if (typeof window === 'undefined' || !('speechSynthesis' in window)) {
    return false;
  }

  let finished = false;
  const finishOnce = () => {
    if (finished) return;
    finished = true;
    if (activeSpeechSafetyTimer !== null) {
      window.clearTimeout(activeSpeechSafetyTimer);
      activeSpeechSafetyTimer = null;
    }
    onEnd?.();
  };

  try {
    cancelBrowserSpeech();
    window.speechSynthesis.resume();

    const utterance = new SpeechSynthesisUtterance(text);
    const voices = window.speechSynthesis.getVoices();
    const britishVoice =
      voices.find(
        (v) =>
          v.lang.toLowerCase().startsWith('en-gb') &&
          /male|daniel|george|ryan|arthur|oliver/i.test(v.name),
      ) ||
      voices.find((v) => v.lang.toLowerCase().startsWith('en-gb')) ||
      voices.find((v) => v.lang.toLowerCase().startsWith('en'));

    if (britishVoice) {
      utterance.voice = britishVoice;
    }
    utterance.rate = 1.02;
    utterance.pitch = 0.94;
    utterance.onstart = () => onStart?.();
    utterance.onend = finishOnce;
    utterance.onerror = finishOnce;

    // Guard against browsers where speechSynthesis never fires onend/onerror
    const words = text.trim().split(/\s+/).filter(Boolean).length;
    const maxWaitMs = Math.max(4500, Math.min(20000, words * 650 + 2500));
    activeSpeechSafetyTimer = window.setTimeout(finishOnce, maxWaitMs);

    onStart?.();
    window.speechSynthesis.speak(utterance);
    return true;
  } catch {
    finishOnce();
    return false;
  }
}
