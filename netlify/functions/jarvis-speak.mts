import type { Config } from '@netlify/functions';
import {
  getVersionedAiClient,
  isTtsQuotaCoolingDown,
  synthesizeJarvisSpeech,
} from './_lib/jarvis-core';

export default async (req: Request) => {
  const aiTts = getVersionedAiClient('v1alpha');
  if (!aiTts) {
    return Response.json({ error: 'Gemini API key is not configured on the server.' }, { status: 503 });
  }

  const body = (await req.json().catch(() => null)) as { text?: unknown } | null;
  if (typeof body?.text !== 'string' || !body.text.trim()) {
    return Response.json({ error: 'Text is required for speech synthesis.' }, { status: 400 });
  }

  if (isTtsQuotaCoolingDown()) {
    return Response.json({ audioBase64: null, mimeType: null, fallback: 'browser' });
  }

  try {
    const audio = await synthesizeJarvisSpeech(aiTts, body.text);
    return Response.json({ ...audio, fallback: null });
  } catch {
    return Response.json({ audioBase64: null, mimeType: null, fallback: 'browser' });
  }
};

export const config: Config = { method: ['POST'] };
