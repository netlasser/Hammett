import type { Config } from '@netlify/functions';
import {
  extractCleanErrorMessage,
  getAiClient,
  runJarvisCommand,
  sanitizeHistory,
  sanitizeTasksSummary,
} from './_lib/jarvis-core';

export default async (req: Request) => {
  const body = (await req.json().catch(() => null)) as {
    transcript?: unknown;
    tasksSummary?: unknown;
    conversationHistory?: unknown;
    localTime?: unknown;
  } | null;

  const ai = getAiClient();
  if (!ai) {
    return Response.json(
      {
        error:
          'Gemini API key is not configured on the server. Add GEMINI_API_KEY in Netlify > Site configuration > Environment variables to enable Jarvis.',
      },
      { status: 503 },
    );
  }

  if (typeof body?.transcript !== 'string' || !body.transcript.trim()) {
    return Response.json({ error: 'Please provide a spoken or typed command.' }, { status: 400 });
  }

  const transcript = body.transcript.trim().slice(0, 1000);
  const localTime =
    typeof body.localTime === 'string' && body.localTime.trim()
      ? body.localTime.trim().slice(0, 64)
      : new Date().toISOString();

  try {
    const result = await runJarvisCommand(ai, {
      transcript,
      tasksSummary: sanitizeTasksSummary(body.tasksSummary),
      conversationHistory: sanitizeHistory(body.conversationHistory),
      localTime,
    });
    return Response.json(result);
  } catch (err) {
    const message = extractCleanErrorMessage(err, 'Failed to process Jarvis command.');
    return Response.json({ error: message }, { status: 502 });
  }
};

export const config: Config = { method: ['POST'] };
