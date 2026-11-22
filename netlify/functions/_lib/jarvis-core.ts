import {
  GoogleGenAI,
  ThinkingLevel,
  Type,
  type FunctionDeclaration,
} from '@google/genai';

function getEnvApiKey(): string | undefined {
  try {
    const env = (globalThis as {
      Netlify?: { env?: { get?: (key: string) => string | undefined } };
    }).Netlify;
    const fromNetlify = env?.env?.get?.('GEMINI_API_KEY');
    if (fromNetlify) return fromNetlify;
  } catch {
    // not running on Netlify; fall back to process.env
  }
  return typeof process !== 'undefined' ? process.env.GEMINI_API_KEY : undefined;
}

export function getAiClient(): GoogleGenAI | null {
  const apiKey = getEnvApiKey()?.trim();
  if (!apiKey || apiKey === 'MY_GEMINI_API_KEY') {
    return null;
  }
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

export function getVersionedAiClient(apiVersion: 'v1alpha' | 'v1beta'): GoogleGenAI | null {
  const apiKey = getEnvApiKey()?.trim();
  if (!apiKey || apiKey === 'MY_GEMINI_API_KEY') {
    return null;
  }
  return new GoogleGenAI({
    apiKey,
    apiVersion,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

export const LIVE_MODEL_ID = 'gemini-3.8-live';

export const JARVIS_SYSTEM_INSTRUCTION = `You are J.A.R.V.I.S. (Just A Rather Very Intelligent System), the poised, articulate, subtly dry-witted British AI assistant from the Marvel Cinematic Universe, integrated into ArcMatrix (an Eisenhower Matrix task manager).

Persona & Tone:
- Address the user respectfully as "sir" or "ma'am" sparingly (or naturally as a composed British AI butler—polished, calm, efficient, warm, with subtle understated wit).
- Keep spoken replies concise (1 to 3 sentences, under 45 words when possible) so they sound effortless and natural when spoken aloud.
- Never use markdown bullets, asterisks, or emojis in your spoken reply—write natural spoken prose.

Eisenhower Matrix Classification Rules:
- q1 ("Do First"): Urgent & Important — crises, strict deadlines today, critical blockers, immediate meetings/calls.
- q2 ("Schedule"): Not Urgent & Important — strategic planning, architecture, fitness, deep work, future goals.
- q3 ("Delegate"): Urgent & Not Important — routine requests, scheduling handoffs, administrative coordination.
- q4 ("Eliminate"): Not Urgent & Not Important — low-value clutter, optional busywork.

Tool/Action Semantics:
- Return structured JSON matching the schema.
- Emit ONLY ONE action per distinct task the user asked to add, move, complete, or update. Never emit duplicate, placeholder, or confirmation-filler items in the actions array.
- When the user asks to add one or more tasks, emit an "add_task" action for each task with a concise imperative title (e.g. "Apply urgent server patch"), exact lowercase quadrant ("q1", "q2", "q3", or "q4" — if they say "Do First" or "urgent", use "q1"), and reminderMinutesFromNow (a number, e.g. 15 when they say "in 15 minutes") or reminderIso (ISO 8601 timestamp using localTime if they specify a clock time).
- When the user asks to move/reprioritize an existing task, emit "move_task" with targetTaskTitle matching one of the current tasks and the new quadrant.
- When the user asks to mark a task complete/done, emit "complete_task".
- When the user asks to remove/delete a task, emit "delete_task".
- When the user asks to set/update a reminder on an existing task, emit "set_reminder".
- When the user is just asking for a status briefing, advice on what to focus on next, or making conversation ("What should I do first?", "Brief me", "Thank you, Jarvis"), return actions: [] and answer concisely using the provided task list.`;

export const JARVIS_LIVE_TOOLS: FunctionDeclaration[] = [
  {
    name: 'add_task',
    description:
      'Add a new task to the Eisenhower Matrix. Use q1 (Do First), q2 (Schedule), q3 (Delegate), or q4 (Eliminate).',
    parameters: {
      type: Type.OBJECT,
      properties: {
        title: {
          type: Type.STRING,
          description: 'Concise imperative task title without quadrant labels.',
        },
        quadrant: {
          type: Type.STRING,
          description: 'Exact lowercase quadrant ID: q1, q2, q3, or q4.',
        },
        reminderMinutesFromNow: {
          type: Type.NUMBER,
          description: 'Minutes from now for a reminder, if requested.',
        },
        reminderIso: {
          type: Type.STRING,
          description: 'ISO-8601 timestamp if a specific clock time was requested.',
        },
        notes: {
          type: Type.STRING,
          description: 'Optional brief note for the task.',
        },
      },
      required: ['title', 'quadrant'],
    },
  },
  {
    name: 'move_task',
    description: 'Move an existing task to a different Eisenhower quadrant.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        targetTaskTitle: {
          type: Type.STRING,
          description: 'Existing task title to move.',
        },
        quadrant: {
          type: Type.STRING,
          description: 'Target lowercase quadrant ID: q1, q2, q3, or q4.',
        },
      },
      required: ['targetTaskTitle', 'quadrant'],
    },
  },
  {
    name: 'complete_task',
    description: 'Mark an existing task as completed.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        targetTaskTitle: {
          type: Type.STRING,
          description: 'Existing task title to mark complete.',
        },
      },
      required: ['targetTaskTitle'],
    },
  },
  {
    name: 'delete_task',
    description: 'Delete an existing task from the matrix.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        targetTaskTitle: {
          type: Type.STRING,
          description: 'Existing task title to delete.',
        },
      },
      required: ['targetTaskTitle'],
    },
  },
  {
    name: 'set_reminder',
    description: 'Set or update a push reminder on an existing task.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        targetTaskTitle: {
          type: Type.STRING,
          description: 'Existing task title to update.',
        },
        reminderMinutesFromNow: {
          type: Type.NUMBER,
          description: 'Minutes from now for the reminder.',
        },
        reminderIso: {
          type: Type.STRING,
          description: 'ISO-8601 timestamp if a specific clock time was requested.',
        },
      },
      required: ['targetTaskTitle'],
    },
  },
];

const ALLOWED_AUDIO_MIMES = new Map<string, string>([
  ['audio/webm', 'audio/webm'],
  ['video/webm', 'audio/webm'],
  ['audio/mp4', 'audio/mp4'],
  ['audio/x-m4a', 'audio/mp4'],
  ['audio/m4a', 'audio/mp4'],
  ['audio/aac', 'audio/aac'],
  ['audio/ogg', 'audio/ogg'],
  ['audio/wav', 'audio/wav'],
  ['audio/wave', 'audio/wav'],
  ['audio/x-wav', 'audio/wav'],
  ['audio/mpeg', 'audio/mpeg'],
  ['audio/mp3', 'audio/mp3'],
  ['audio/flac', 'audio/flac'],
]);

export function normalizeAudioMime(rawMime: string): string | null {
  const base = rawMime.split(';')[0].trim().toLowerCase();
  if (!base) return 'audio/webm';
  return ALLOWED_AUDIO_MIMES.get(base) ?? null;
}

export function extractCleanErrorMessage(err: unknown, fallback: string): string {
  const raw = err instanceof Error ? err.message : fallback;
  try {
    const parsed = JSON.parse(raw) as { error?: { message?: string } };
    if (parsed?.error?.message) {
      return parsed.error.message;
    }
  } catch {
    // not JSON, use raw message
  }
  return raw || fallback;
}

export async function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export async function withGeminiRetry<T>(
  fn: () => Promise<T>,
  options: { timeoutMs?: number; maxAttempts?: number; label?: string } = {},
): Promise<T> {
  const timeoutMs = options.timeoutMs ?? 6000;
  const maxAttempts = options.maxAttempts ?? 2;
  const label = options.label ?? 'Gemini request';

  let lastError: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await withTimeout(fn(), timeoutMs, label);
    } catch (err) {
      lastError = err;
      const msg = err instanceof Error ? err.message : '';
      const isTransient = /503|429|UNAVAILABLE|RESOURCE_EXHAUSTED|high demand|timed out/i.test(msg);
      if (!isTransient || attempt === maxAttempts) {
        throw err;
      }
      await new Promise((resolve) => setTimeout(resolve, 250 * attempt));
    }
  }
  throw lastError;
}

export interface SanitizedTaskSummary {
  title: string;
  quadrant: string;
  completed: boolean;
  reminderAt: string | null;
}

export function sanitizeTasksSummary(raw: unknown): SanitizedTaskSummary[] {
  const rawTasks = Array.isArray(raw) ? raw.slice(0, 80) : [];
  return rawTasks
    .filter((t): t is Record<string, unknown> => Boolean(t && typeof t === 'object'))
    .map((t) => ({
      title: typeof t.title === 'string' ? t.title.slice(0, 160) : '',
      quadrant: typeof t.quadrant === 'string' ? t.quadrant.slice(0, 8) : 'q2',
      completed: Boolean(t.completed),
      reminderAt: typeof t.reminderAt === 'string' ? t.reminderAt.slice(0, 64) : null,
    }))
    .filter((t) => t.title.length > 0);
}

export function sanitizeHistory(raw: unknown): { role: string; text: string }[] {
  const rawHistory = Array.isArray(raw) ? raw.slice(-8) : [];
  return rawHistory
    .filter((m): m is Record<string, unknown> => Boolean(m && typeof m === 'object'))
    .map((m) => ({
      role: m.role === 'jarvis' ? 'J.A.R.V.I.S.' : 'User',
      text: typeof m.text === 'string' ? m.text.slice(0, 300) : '',
    }))
    .filter((m) => m.text.length > 0);
}

export function formatTasksContextBlock(
  sanitizedTasks: SanitizedTaskSummary[],
  localTime: string,
): string {
  return [
    `Current local time: ${localTime}`,
    `Current Eisenhower Matrix tasks (${sanitizedTasks.length}):`,
    sanitizedTasks.length > 0
      ? sanitizedTasks
          .map(
            (t) =>
              `- [${t.quadrant.toUpperCase()}]${t.completed ? ' (completed)' : ''} ${t.title}${t.reminderAt ? ` (reminder: ${t.reminderAt})` : ''}`,
          )
          .join('\n')
      : '(Matrix is currently empty)',
  ].join('\n\n');
}

export const COMMAND_RESPONSE_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    reply: {
      type: Type.STRING,
      description:
        'Spoken response in the calm, articulate, subtly dry-witted British AI persona of JARVIS.',
    },
    followUpExpected: {
      type: Type.BOOLEAN,
      description:
        'True only if Jarvis asked a direct follow-up question expecting an immediate spoken reply.',
    },
    actions: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          type: {
            type: Type.STRING,
            description:
              'Exact string from: add_task, move_task, complete_task, delete_task, set_reminder, none',
          },
          title: {
            type: Type.STRING,
            description: 'Short, clean task title only (no quadrant code or numbers appended).',
          },
          notes: {
            type: Type.STRING,
            description: 'Optional brief note or context for the task.',
          },
          quadrant: {
            type: Type.STRING,
            description: 'Lowercase quadrant ID: q1, q2, q3, or q4.',
          },
          targetTaskTitle: {
            type: Type.STRING,
            description:
              'Existing task title to match for move_task, complete_task, delete_task, or set_reminder.',
          },
          reminderMinutesFromNow: {
            type: Type.NUMBER,
            description:
              'Numeric minutes from now when user specifies a relative time like "in 15 minutes".',
          },
          reminderIso: {
            type: Type.STRING,
            description: 'ISO-8601 timestamp if user specified a concrete clock time or date.',
          },
        },
        propertyOrdering: [
          'type',
          'title',
          'quadrant',
          'reminderMinutesFromNow',
          'reminderIso',
          'targetTaskTitle',
          'notes',
        ],
        required: ['type'],
      },
    },
  },
  propertyOrdering: ['reply', 'actions', 'followUpExpected'],
  required: ['reply', 'actions', 'followUpExpected'],
};

export async function runJarvisCommand(
  ai: GoogleGenAI,
  params: {
    transcript: string;
    tasksSummary: SanitizedTaskSummary[];
    conversationHistory: { role: string; text: string }[];
    localTime: string;
  },
) {
  const promptPayload = [
    formatTasksContextBlock(params.tasksSummary, params.localTime),
    params.conversationHistory.length > 0
      ? `Recent conversation:\n${params.conversationHistory.map((h) => `${h.role}: ${h.text}`).join('\n')}`
      : '',
    `Latest user command: "${params.transcript}"`,
  ]
    .filter(Boolean)
    .join('\n\n');

  let response;
  try {
    response = await withGeminiRetry(
      () =>
        ai.models.generateContent({
          model: 'gemini-4-hydrogen',
          contents: promptPayload,
          config: {
            systemInstruction: JARVIS_SYSTEM_INSTRUCTION,
            thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
            responseMimeType: 'application/json',
            responseSchema: COMMAND_RESPONSE_SCHEMA,
          },
        }),
      { timeoutMs: 5500, maxAttempts: 1, label: 'Gemini command request' },
    );
  } catch (primaryErr) {
    const msg = primaryErr instanceof Error ? primaryErr.message : '';
    if (/503|429|UNAVAILABLE|high demand|timed out/i.test(msg)) {
      response = await withTimeout(
        ai.models.generateContent({
          model: 'gemini-3.1-flash-lite',
          contents: promptPayload,
          config: {
            systemInstruction: JARVIS_SYSTEM_INSTRUCTION,
            responseMimeType: 'application/json',
            responseSchema: COMMAND_RESPONSE_SCHEMA,
          },
        }),
        9000,
        'Gemini fallback request',
      );
    } else {
      throw primaryErr;
    }
  }

  const rawText = (response.text ?? '{}').trim();
  const parsed = JSON.parse(rawText);
  return {
    reply:
      typeof parsed.reply === 'string' && parsed.reply.trim()
        ? parsed.reply.trim()
        : 'Very good, sir. Matrix updated.',
    actions: Array.isArray(parsed.actions) ? parsed.actions : [],
    followUpExpected: Boolean(parsed.followUpExpected),
  };
}

let ttsQuotaCooldownUntil = 0;

export function isTtsQuotaCoolingDown(): boolean {
  return Date.now() < ttsQuotaCooldownUntil;
}

function isQuotaError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err ?? '');
  return /429|RESOURCE_EXHAUSTED|quota|rate limit/i.test(msg);
}

export async function transcribeAudioBuffer(
  audioBase64: string,
  mimeType: string,
): Promise<string> {
  const promptParts = [
    {
      inlineData: {
        mimeType,
        data: audioBase64,
      },
    },
    {
      text: 'Transcribe all spoken words in this audio accurately into plain text. Return only the transcript with no commentary. If there is only silence or noise with no intelligible speech, return an empty string.',
    },
  ];

  // Try gemini-3.5-transcribe on v1alpha, then v1beta, then multimodal fallback on gemini-4-hydrogen
  const attempts: Array<{ client: GoogleGenAI | null; model: string }> = [
    { client: getVersionedAiClient('v1alpha'), model: 'gemini-3.5-transcribe' },
    { client: getVersionedAiClient('v1beta'), model: 'gemini-3.5-transcribe' },
    { client: getAiClient(), model: 'gemini-4-hydrogen' },
  ];

  let lastError: unknown;
  let sawEmptySuccess = false;
  for (const { client, model } of attempts) {
    if (!client) continue;
    try {
      const response = await withGeminiRetry(
        () =>
          client.models.generateContent({
            model,
            contents: { parts: promptParts },
          }),
        { timeoutMs: 12000, maxAttempts: 1, label: `Transcription (${model})` },
      );
      const text = (response.text ?? '').trim();
      if (text) {
        return text;
      }
      // If transcribe model returned empty string, try multimodal fallback before giving up
      sawEmptySuccess = true;
    } catch (err) {
      lastError = err;
    }
  }

  if (sawEmptySuccess) {
    return '';
  }

  throw lastError ?? new Error('Audio transcription failed.');
}

export async function synthesizeJarvisSpeech(
  aiTts: GoogleGenAI,
  rawText: string,
): Promise<{ audioBase64: string; mimeType: string }> {
  if (Date.now() < ttsQuotaCooldownUntil) {
    throw new Error('TTS quota cooldown active');
  }

  const text = rawText.trim().slice(0, 600);
  try {
    const response = await withGeminiRetry(
      () =>
        aiTts.models.generateContent({
          model: 'gemini-3.8-flash-lite-tts',
          contents: [
            {
              role: 'user',
              parts: [
                {
                  text,
                  speechMetadata: {
                    style:
                      'Calm, composed, articulate British AI butler, warm yet precise, subtle dry wit',
                  },
                },
              ],
            },
          ],
          config: {
            responseModalities: ['AUDIO'],
            speechConfig: {
              voiceConfig: {
                prebuiltVoiceConfig: { voiceName: 'Charon' },
              },
            },
          },
        }),
      { timeoutMs: 10000, maxAttempts: 1, label: 'Gemini speech synthesis' },
    );

    const base64Audio = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
    if (!base64Audio) {
      throw new Error('No audio data returned by speech synthesis.');
    }

    return {
      audioBase64: base64Audio,
      mimeType: 'audio/wav',
    };
  } catch (err) {
    if (isQuotaError(err)) {
      ttsQuotaCooldownUntil = Date.now() + 5 * 60_000;
    }
    throw err;
  }
}

export async function createLiveAuthToken(): Promise<{ name: string }> {
  const ai = getVersionedAiClient('v1beta');
  if (!ai) {
    throw new Error('GEMINI_API_KEY is not configured on the server.');
  }
  const token = await withTimeout(
    ai.authTokens.create({
      config: {
        uses: 1,
        expireTime: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
        newSessionExpireTime: new Date(Date.now() + 2 * 60 * 1000).toISOString(),
      },
    }),
    10000,
    'Ephemeral token request',
  );
  return token as { name: string };
}
