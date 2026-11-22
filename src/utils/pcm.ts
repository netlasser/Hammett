/**
 * Pure PCM audio resampling, encoding/decoding, and microphone level utilities.
 */

export const LIVE_INPUT_SAMPLE_RATE = 16000;
export const LIVE_OUTPUT_SAMPLE_RATE = 24000;

/**
 * Downsamples or resamples a mono Float32Array from `sourceSampleRate` to `targetSampleRate`
 * (default 16kHz) and converts samples to signed 16-bit PCM (`Int16Array`).
 */
export function resampleFloat32ToInt16(
  input: Float32Array,
  sourceSampleRate: number,
  targetSampleRate = LIVE_INPUT_SAMPLE_RATE,
): Int16Array {
  if (input.length === 0) {
    return new Int16Array(0);
  }

  const safeSourceRate = sourceSampleRate > 0 ? sourceSampleRate : targetSampleRate;

  if (safeSourceRate === targetSampleRate) {
    const out = new Int16Array(input.length);
    for (let i = 0; i < input.length; i++) {
      const clamped = Math.max(-1, Math.min(1, input[i]));
      out[i] = clamped < 0 ? Math.round(clamped * 32768) : Math.round(clamped * 32767);
    }
    return out;
  }

  const ratio = safeSourceRate / targetSampleRate;
  const targetLength = Math.max(1, Math.round(input.length / ratio));
  const out = new Int16Array(targetLength);

  for (let i = 0; i < targetLength; i++) {
    const srcPos = i * ratio;
    const idx0 = Math.floor(srcPos);
    const idx1 = Math.min(input.length - 1, idx0 + 1);
    const frac = srcPos - idx0;
    const sample = input[idx0] * (1 - frac) + input[idx1] * frac;
    const clamped = Math.max(-1, Math.min(1, sample));
    out[i] = clamped < 0 ? Math.round(clamped * 32768) : Math.round(clamped * 32767);
  }

  return out;
}

/**
 * Encodes an `Int16Array` (little-endian 16-bit PCM) into a base64 string.
 */
export function int16ToBase64(pcm: Int16Array): string {
  const bytes = new Uint8Array(pcm.buffer, pcm.byteOffset, pcm.byteLength);
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const slice = bytes.subarray(i, Math.min(bytes.length, i + chunkSize));
    binary += String.fromCharCode(...slice);
  }
  return btoa(binary);
}

/**
 * Decodes a base64-encoded little-endian 16-bit PCM chunk into normalized `Float32Array` samples.
 */
export function base64PcmToFloat32(base64: string): Float32Array {
  if (!base64) return new Float32Array(0);
  const binary = atob(base64);
  const byteLength = binary.length - (binary.length % 2);
  const sampleCount = byteLength / 2;
  const out = new Float32Array(sampleCount);

  for (let i = 0; i < sampleCount; i++) {
    const lo = binary.charCodeAt(i * 2);
    const hi = binary.charCodeAt(i * 2 + 1);
    let value = (hi << 8) | lo;
    if (value >= 0x8000) {
      value -= 0x10000;
    }
    out[i] = value / 32768;
  }

  return out;
}

/**
 * Computes normalized RMS energy [0, 1] for driving acoustic orb & mic level indicators.
 */
export function computeRmsLevel(samples: Float32Array): number {
  if (samples.length === 0) return 0;
  let sumSq = 0;
  for (let i = 0; i < samples.length; i++) {
    const v = samples[i];
    sumSq += v * v;
  }
  const rms = Math.sqrt(sumSq / samples.length);
  return Math.min(1, rms * 4.5);
}

const RECORDER_MIME_CANDIDATES = [
  'audio/webm;codecs=opus',
  'audio/webm',
  'audio/mp4',
  'audio/ogg;codecs=opus',
  'audio/ogg',
];

/**
 * Picks the best supported `MediaRecorder` MIME type for the current browser.
 */
export function pickSupportedRecorderMime(
  isTypeSupported?: (mime: string) => boolean,
): string | undefined {
  if (!isTypeSupported) return undefined;
  for (const candidate of RECORDER_MIME_CANDIDATES) {
    try {
      if (isTypeSupported(candidate)) {
        return candidate;
      }
    } catch {
      // ignore invalid mime probe
    }
  }
  return undefined;
}

/**
 * Merges a sequence of captured Float32Array audio buffers into a single contiguous array.
 */
export function mergeFloat32Chunks(chunks: readonly Float32Array[]): Float32Array {
  let totalLength = 0;
  for (const chunk of chunks) {
    totalLength += chunk.length;
  }
  if (totalLength === 0) return new Float32Array(0);
  const merged = new Float32Array(totalLength);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.length;
  }
  return merged;
}

/**
 * Wraps signed 16-bit mono PCM samples into a standard 44-byte RIFF/WAVE container.
 */
export function encodeWavPcm16(
  samples: Int16Array,
  sampleRate = LIVE_INPUT_SAMPLE_RATE,
): ArrayBuffer {
  const safeRate = Math.max(8000, Math.round(sampleRate || LIVE_INPUT_SAMPLE_RATE));
  const dataByteLength = samples.byteLength;
  const buffer = new ArrayBuffer(44 + dataByteLength);
  const view = new DataView(buffer);

  const writeAscii = (offset: number, str: string) => {
    for (let i = 0; i < str.length; i++) {
      view.setUint8(offset + i, str.charCodeAt(i));
    }
  };

  writeAscii(0, 'RIFF');
  view.setUint32(4, 36 + dataByteLength, true);
  writeAscii(8, 'WAVE');
  writeAscii(12, 'fmt ');
  view.setUint32(16, 16, true); // PCM chunk size
  view.setUint16(20, 1, true); // PCM format
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, safeRate, true);
  view.setUint32(28, safeRate * 2, true); // byte rate = sampleRate * numChannels * 2 bytes
  view.setUint16(32, 2, true); // block align
  view.setUint16(34, 16, true); // bits per sample
  writeAscii(36, 'data');
  view.setUint32(40, dataByteLength, true);

  const payload = new Uint8Array(buffer, 44);
  payload.set(new Uint8Array(samples.buffer, samples.byteOffset, samples.byteLength));
  return buffer;
}

/**
 * Encodes an ArrayBuffer into a base64 string without FileReader overhead.
 */
export function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const slice = bytes.subarray(i, Math.min(bytes.length, i + chunkSize));
    binary += String.fromCharCode(...slice);
  }
  return btoa(binary);
}

