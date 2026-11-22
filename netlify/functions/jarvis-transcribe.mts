import type { Config } from '@netlify/functions';
import {
  extractCleanErrorMessage,
  getAiClient,
  normalizeAudioMime,
  transcribeAudioBuffer,
} from './_lib/jarvis-core';

export default async (req: Request) => {
  const ai = getAiClient();
  if (!ai) {
    return Response.json({ error: 'Gemini API key is not configured on the server.' }, { status: 503 });
  }

  const body = (await req.json().catch(() => null)) as {
    audioBase64?: unknown;
    mimeType?: unknown;
  } | null;

  if (typeof body?.audioBase64 !== 'string' || !body.audioBase64.trim()) {
    return Response.json({ error: 'Audio payload is required.' }, { status: 400 });
  }

  const rawMime = typeof body.mimeType === 'string' ? body.mimeType : 'audio/webm';
  const normalizedMime = normalizeAudioMime(rawMime);
  if (!normalizedMime) {
    return Response.json({ error: 'Unsupported audio MIME type.' }, { status: 400 });
  }

  try {
    const transcript = await transcribeAudioBuffer(body.audioBase64, normalizedMime);
    return Response.json({ transcript });
  } catch (err) {
    const message = extractCleanErrorMessage(err, 'Audio transcription failed.');
    return Response.json({ error: message }, { status: 502 });
  }
};

export const config: Config = { method: ['POST'] };
