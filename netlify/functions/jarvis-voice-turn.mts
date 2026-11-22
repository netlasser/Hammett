import type { Config } from '@netlify/functions';
import {
  extractCleanErrorMessage,
  getAiClient,
  getVersionedAiClient,
  isTtsQuotaCoolingDown,
  normalizeAudioMime,
  runJarvisCommand,
  sanitizeHistory,
  sanitizeTasksSummary,
  synthesizeJarvisSpeech,
  transcribeAudioBuffer,
} from './_lib/jarvis-core';

export default async (req: Request) => {
  const ai = getAiClient();
  const aiTts = getVersionedAiClient('v1alpha');
  if (!ai) {
    return Response.json(
      {
        error:
          'Gemini API key is not configured on the server. Add GEMINI_API_KEY in Netlify > Site configuration > Environment variables to enable Jarvis.',
      },
      { status: 503 },
    );
  }

  const body = (await req.json().catch(() => null)) as {
    audioBase64?: unknown;
    mimeType?: unknown;
    tasksSummary?: unknown;
    conversationHistory?: unknown;
    localTime?: unknown;
    includeTts?: unknown;
  } | null;

  if (typeof body?.audioBase64 !== 'string' || !body.audioBase64.trim()) {
    return Response.json({ error: 'Audio payload is required.' }, { status: 400 });
  }

  const audioBase64 = body.audioBase64;
  const rawMime = typeof body.mimeType === 'string' ? body.mimeType : 'audio/webm';
  const normalizedMime = normalizeAudioMime(rawMime);
  if (!normalizedMime) {
    return Response.json(
      { error: `Unsupported audio MIME type: ${rawMime}` },
      { status: 400 },
    );
  }

  const localTime =
    typeof body.localTime === 'string' && body.localTime.trim()
      ? body.localTime.trim().slice(0, 64)
      : new Date().toISOString();

  try {
    const transcript = await transcribeAudioBuffer(audioBase64, normalizedMime);
    if (!transcript) {
      return Response.json({
        transcript: '',
        inaudible: true,
        reply: 'I did not catch that clearly, sir. Please speak a bit closer or try again.',
        actions: [],
        followUpExpected: false,
      });
    }

    const commandResult = await runJarvisCommand(ai, {
      transcript,
      tasksSummary: sanitizeTasksSummary(body.tasksSummary),
      conversationHistory: sanitizeHistory(body.conversationHistory),
      localTime,
    });

    let audioPayload: { audioBase64: string; mimeType: string } | null = null;
    if (body.includeTts !== false && aiTts && !isTtsQuotaCoolingDown()) {
      try {
        audioPayload = await synthesizeJarvisSpeech(aiTts, commandResult.reply);
      } catch {
        audioPayload = null;
      }
    }

    return Response.json({
      transcript,
      inaudible: false,
      ...commandResult,
      audioBase64: audioPayload?.audioBase64 ?? null,
      mimeType: audioPayload?.mimeType ?? null,
      ttsFallback: body.includeTts !== false && !audioPayload ? 'browser' : null,
    });
  } catch (err) {
    const message = extractCleanErrorMessage(err, 'Voice turn failed.');
    return Response.json({ error: message }, { status: 502 });
  }
};

export const config: Config = { method: ['POST'] };
