import test from 'node:test';
import assert from 'node:assert/strict';
import {
  arrayBufferToBase64,
  base64PcmToFloat32,
  computeRmsLevel,
  encodeWavPcm16,
  int16ToBase64,
  mergeFloat32Chunks,
  pickSupportedRecorderMime,
  resampleFloat32ToInt16,
} from './pcm';

test('resampleFloat32ToInt16 preserves length at 16kHz and clamps out-of-range samples', () => {
  const input = new Float32Array([0, 0.5, -0.5, 1.5, -1.5]);
  const pcm = resampleFloat32ToInt16(input, 16000, 16000);
  assert.equal(pcm.length, 5);
  assert.equal(pcm[0], 0);
  assert.ok(pcm[1] > 16000 && pcm[1] <= 16400);
  assert.ok(pcm[2] < -16000 && pcm[2] >= -16400);
  assert.equal(pcm[3], 32767);
  assert.equal(pcm[4], -32768);
});

test('resampleFloat32ToInt16 downsamples 48kHz to 16kHz accurately', () => {
  const input = new Float32Array(480);
  for (let i = 0; i < input.length; i++) {
    input[i] = Math.sin((2 * Math.PI * 440 * i) / 48000) * 0.5;
  }
  const pcm = resampleFloat32ToInt16(input, 48000, 16000);
  assert.equal(pcm.length, 160);
});

test('int16ToBase64 and base64PcmToFloat32 round-trip signed 16-bit PCM cleanly', () => {
  const original = new Int16Array([0, 16384, -16384, 32767, -32768]);
  const b64 = int16ToBase64(original);
  const decoded = base64PcmToFloat32(b64);
  assert.equal(decoded.length, original.length);
  assert.equal(decoded[0], 0);
  assert.ok(Math.abs(decoded[1] - 0.5) < 0.001);
  assert.ok(Math.abs(decoded[2] + 0.5) < 0.001);
  assert.ok(Math.abs(decoded[3] - 1) < 0.001);
  assert.equal(decoded[4], -1);
});

test('computeRmsLevel returns bounded [0, 1] acoustic energy', () => {
  assert.equal(computeRmsLevel(new Float32Array(0)), 0);
  assert.equal(computeRmsLevel(new Float32Array([0, 0, 0])), 0);
  const loud = computeRmsLevel(new Float32Array([0.8, -0.8, 0.8, -0.8]));
  assert.equal(loud, 1);
  const quiet = computeRmsLevel(new Float32Array([0.05, -0.05]));
  assert.ok(quiet > 0 && quiet < 1);
});

test('pickSupportedRecorderMime prefers opus webm and falls back cleanly', () => {
  assert.equal(
    pickSupportedRecorderMime((m) => m === 'audio/mp4'),
    'audio/mp4',
  );
  assert.equal(
    pickSupportedRecorderMime((m) => m.startsWith('audio/webm')),
    'audio/webm;codecs=opus',
  );
  assert.equal(
    pickSupportedRecorderMime(() => false),
    undefined,
  );
});

test('mergeFloat32Chunks concatenates audio chunks in order', () => {
  assert.equal(mergeFloat32Chunks([]).length, 0);
  const merged = mergeFloat32Chunks([
    new Float32Array([0.1, 0.2]),
    new Float32Array([0.3]),
  ]);
  assert.equal(merged.length, 3);
  assert.ok(Math.abs(merged[0] - 0.1) < 1e-6);
  assert.ok(Math.abs(merged[2] - 0.3) < 1e-6);
});

test('encodeWavPcm16 produces a valid 44-byte RIFF/WAVE PCM file', () => {
  const pcm = new Int16Array([0, 1000, -1000, 32767]);
  const wav = encodeWavPcm16(pcm, 16000);
  assert.equal(wav.byteLength, 44 + pcm.byteLength);

  const view = new DataView(wav);
  const ascii = (offset: number, len: number) =>
    String.fromCharCode(...new Uint8Array(wav, offset, len));

  assert.equal(ascii(0, 4), 'RIFF');
  assert.equal(view.getUint32(4, true), 36 + pcm.byteLength);
  assert.equal(ascii(8, 4), 'WAVE');
  assert.equal(ascii(12, 4), 'fmt ');
  assert.equal(view.getUint16(20, true), 1); // PCM
  assert.equal(view.getUint16(22, true), 1); // Mono
  assert.equal(view.getUint32(24, true), 16000);
  assert.equal(view.getUint32(28, true), 32000);
  assert.equal(view.getUint16(34, true), 16);
  assert.equal(ascii(36, 4), 'data');
  assert.equal(view.getUint32(40, true), pcm.byteLength);

  const b64 = arrayBufferToBase64(wav);
  assert.ok(b64.startsWith('UklGR')); // RIFF header in base64
});

