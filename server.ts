import 'dotenv/config';
import crypto from 'crypto';
import express from 'express';
import fs from 'fs';
import { createServer } from 'http';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  GoogleGenAI,
  Modality,
  ThinkingLevel,
  Type,
  type FunctionDeclaration,
  type LiveServerMessage,
} from '@google/genai';
import { WebSocket, WebSocketServer } from 'ws';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.PORT) || 3000;

function getAiClient(): GoogleGenAI | null {
  const apiKey = process.env.GEMINI_API_KEY?.trim();
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

function getVersionedAiClient(apiVersion: 'v1alpha' | 'v1beta'): GoogleGenAI | null {
  const apiKey = process.env.GEMINI_API_KEY?.trim();
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

const JARVIS_SYSTEM_INSTRUCTION = `You are J.A.R.V.I.S. (Just A Rather Very Intelligent System), the poised, articulate, subtly dry-witted British AI assistant from the Marvel Cinematic Universe, integrated into ArcMatrix (an Eisenhower Matrix task manager).

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

const JARVIS_LIVE_TOOLS: FunctionDeclaration[] = [
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

function normalizeAudioMime(rawMime: string): string | null {
  const base = rawMime.split(';')[0].trim().toLowerCase();
  if (!base) return 'audio/webm';
  return ALLOWED_AUDIO_MIMES.get(base) ?? null;
}

function extractCleanErrorMessage(err: unknown, fallback: string): string {
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

async function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
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

async function withGeminiRetry<T>(
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

interface SanitizedTaskSummary {
  title: string;
  quadrant: string;
  completed: boolean;
  reminderAt: string | null;
}

function sanitizeTasksSummary(raw: unknown): SanitizedTaskSummary[] {
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

function sanitizeHistory(raw: unknown): { role: string; text: string }[] {
  const rawHistory = Array.isArray(raw) ? raw.slice(-8) : [];
  return rawHistory
    .filter((m): m is Record<string, unknown> => Boolean(m && typeof m === 'object'))
    .map((m) => ({
      role: m.role === 'jarvis' ? 'J.A.R.V.I.S.' : 'User',
      text: typeof m.text === 'string' ? m.text.slice(0, 300) : '',
    }))
    .filter((m) => m.text.length > 0);
}

function formatTasksContextBlock(
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

const COMMAND_RESPONSE_SCHEMA = {
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

async function runJarvisCommand(
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

function isQuotaError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err ?? '');
  return /429|RESOURCE_EXHAUSTED|quota|rate limit/i.test(msg);
}

async function transcribeAudioBuffer(
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

async function synthesizeJarvisSpeech(
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

async function startServer() {
  const app = express();
  const httpServer = createServer(app);
  app.use(express.json({ limit: '12mb' }));

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true });
  });

  // --- Live ICS Calendar Feed Sync Endpoints ---
  interface FeedTaskRecord {
    id: string;
    title: string;
    notes?: string;
    quadrant: 'q1' | 'q2' | 'q3' | 'q4';
    completed: boolean;
    updatedAt: number;
    reminderAt: number;
  }

  interface StoredCalendarFeed {
    tasks: FeedTaskRecord[];
    includeCompleted: boolean;
    updatedAt: number;
  }

  const FEED_STORE_PATH = path.join(os.tmpdir(), 'arcmatrix-calendar-feeds.json');
  const calendarFeedStore = new Map<string, StoredCalendarFeed>();

  try {
    if (fs.existsSync(FEED_STORE_PATH)) {
      const parsed = JSON.parse(fs.readFileSync(FEED_STORE_PATH, 'utf8')) as Record<
        string,
        StoredCalendarFeed
      >;
      for (const [key, val] of Object.entries(parsed)) {
        if (val && Array.isArray(val.tasks)) {
          calendarFeedStore.set(key, val);
        }
      }
    }
  } catch {
    // ignore corrupt cache file
  }

  const persistFeedStore = () => {
    try {
      const obj: Record<string, StoredCalendarFeed> = {};
      for (const [k, v] of calendarFeedStore.entries()) {
        obj[k] = v;
      }
      fs.writeFileSync(FEED_STORE_PATH, JSON.stringify(obj), 'utf8');
    } catch {
      // non-fatal if tmp write fails
    }
  };

  const FEED_QUADRANT_META: Record<
    'q1' | 'q2' | 'q3' | 'q4',
    { code: string; title: string; subtitle: string; priority: number }
  > = {
    q1: { code: 'Q1', title: 'Do First', subtitle: 'Urgent & Important', priority: 1 },
    q2: { code: 'Q2', title: 'Schedule', subtitle: 'Not Urgent & Important', priority: 3 },
    q3: { code: 'Q3', title: 'Delegate', subtitle: 'Urgent & Not Important', priority: 5 },
    q4: { code: 'Q4', title: 'Eliminate', subtitle: 'Not Urgent & Not Important', priority: 9 },
  };

  const formatFeedUtc = (ms: number): string => {
    const d = new Date(ms);
    const pad = (n: number) => String(n).padStart(2, '0');
    return (
      `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T` +
      `${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`
    );
  };

  const escapeFeedText = (val: string): string =>
    val
      .replace(/\\/g, '\\\\')
      .replace(/\r\n|\r|\n/g, '\\n')
      .replace(/;/g, '\\;')
      .replace(/,/g, '\\,');

  const foldFeedLine = (line: string): string => {
    if (line.length <= 75) return line;
    const parts = [line.slice(0, 75)];
    for (let i = 75; i < line.length; i += 74) {
      parts.push(' ' + line.slice(i, i + 74));
    }
    return parts.join('\r\n');
  };

  const renderFeedIcs = (feed: StoredCalendarFeed): string => {
    const header = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//ArcMatrix//Eisenhower Matrix Calendar Sync//EN',
      'CALSCALE:GREGORIAN',
      'METHOD:PUBLISH',
      'X-WR-CALNAME:ArcMatrix Eisenhower Deadlines',
      'X-WR-CALDESC:Eisenhower Matrix deadlines and push reminders synced from ArcMatrix.',
      'REFRESH-INTERVAL;VALUE=DURATION:PT15M',
      'X-PUBLISHED-TTL:PT15M',
    ].map(foldFeedLine);

    const activeTasks = feed.tasks
      .filter((t) => feed.includeCompleted || !t.completed)
      .sort((a, b) => a.reminderAt - b.reminderAt);

    const events = activeTasks.flatMap((t) => {
      const qMeta = FEED_QUADRANT_META[t.quadrant];
      const startMs = t.reminderAt;
      const endMs = startMs + 30 * 60_000;
      const desc = [
        `Eisenhower Quadrant: ${qMeta.code} · ${qMeta.title} (${qMeta.subtitle})`,
        `Status: ${t.completed ? 'Completed' : 'Active'}`,
        ...(t.notes ? ['', t.notes] : []),
        '',
        'Synced via ArcMatrix',
      ].join('\n');

      return [
        'BEGIN:VEVENT',
        `UID:${t.id.replace(/[^a-zA-Z0-9._-]/g, '-')}@arcmatrix.app`,
        `DTSTAMP:${formatFeedUtc(t.updatedAt)}`,
        `DTSTART:${formatFeedUtc(startMs)}`,
        `DTEND:${formatFeedUtc(endMs)}`,
        `SUMMARY:${escapeFeedText(`[${qMeta.code} · ${qMeta.title}] ${t.title}`)}`,
        `DESCRIPTION:${escapeFeedText(desc)}`,
        `CATEGORIES:${escapeFeedText(`Eisenhower-${qMeta.code}`)},${escapeFeedText(qMeta.title)}`,
        `PRIORITY:${qMeta.priority}`,
        `STATUS:${t.completed ? 'COMPLETED' : 'CONFIRMED'}`,
        `X-ARCMATRIX-QUADRANT:${qMeta.code}`,
        'BEGIN:VALARM',
        'ACTION:DISPLAY',
        `DESCRIPTION:${escapeFeedText(`ArcMatrix Reminder (${qMeta.code}): ${t.title}`)}`,
        'TRIGGER:-PT10M',
        'END:VALARM',
        'END:VEVENT',
      ].map(foldFeedLine);
    });

    return [...header, ...events, 'END:VCALENDAR', ''].join('\r\n');
  };

  app.post('/api/calendar/feed', (req, res) => {
    const body = req.body as {
      feedId?: unknown;
      tasks?: unknown;
      includeCompleted?: unknown;
    };

    const requestedFeedId =
      typeof body.feedId === 'string' && /^[a-zA-Z0-9_-]{8,64}$/.test(body.feedId)
        ? body.feedId
        : `am_${crypto.randomBytes(12).toString('hex')}`;

    const rawTasks = Array.isArray(body.tasks) ? body.tasks.slice(0, 200) : [];
    const sanitized: FeedTaskRecord[] = rawTasks
      .filter((t): t is Record<string, unknown> => Boolean(t && typeof t === 'object'))
      .map((t) => {
        const q: 'q1' | 'q2' | 'q3' | 'q4' =
          t.quadrant === 'q1' || t.quadrant === 'q2' || t.quadrant === 'q3' || t.quadrant === 'q4'
            ? t.quadrant
            : 'q2';
        return {
          id: typeof t.id === 'string' && t.id.trim() ? t.id.trim().slice(0, 80) : crypto.randomUUID(),
          title: typeof t.title === 'string' ? t.title.trim().slice(0, 160) : '',
          notes: typeof t.notes === 'string' && t.notes.trim() ? t.notes.trim().slice(0, 500) : undefined,
          quadrant: q,
          completed: Boolean(t.completed),
          updatedAt:
            typeof t.updatedAt === 'number' && Number.isFinite(t.updatedAt)
              ? t.updatedAt
              : Date.now(),
          reminderAt:
            typeof t.reminderAt === 'number' && Number.isFinite(t.reminderAt)
              ? t.reminderAt
              : NaN,
        };
      })
      .filter((t) => t.title.length > 0 && Number.isFinite(t.reminderAt));

    const updatedAt = Date.now();
    calendarFeedStore.set(requestedFeedId, {
      tasks: sanitized,
      includeCompleted: Boolean(body.includeCompleted),
      updatedAt,
    });

    // Keep store bounded to 50 most recent feeds
    if (calendarFeedStore.size > 50) {
      const oldestKey = calendarFeedStore.keys().next().value;
      if (oldestKey) calendarFeedStore.delete(oldestKey);
    }
    persistFeedStore();

    res.json({
      feedId: requestedFeedId,
      syncedAt: updatedAt,
      count: sanitized.length,
    });
  });

  app.get('/api/calendar/feed/:feedParam', (req, res) => {
    const feedId = req.params.feedParam.replace(/\.ics$/i, '');
    if (!/^[a-zA-Z0-9_-]{8,64}$/.test(feedId)) {
      res.status(400).type('text/plain').send('Invalid calendar feed ID.');
      return;
    }

    const feed = calendarFeedStore.get(feedId);
    if (!feed) {
      res.status(404).type('text/plain').send('Calendar feed not found. Open ArcMatrix to re-sync.');
      return;
    }

    res
      .status(200)
      .set({
        'Content-Type': 'text/calendar; charset=utf-8',
        'Content-Disposition': 'inline; filename="arcmatrix-deadlines.ics"',
        'Cache-Control': 'no-cache, no-store, must-revalidate',
      })
      .send(renderFeedIcs(feed));
  });

  app.post('/api/jarvis/command', async (req, res) => {
    const ai = getAiClient();
    if (!ai) {
      res.status(503).json({
        error:
          'Gemini API key is not configured on the server. Add GEMINI_API_KEY in Settings > Secrets to enable Jarvis.',
      });
      return;
    }

    const body = req.body as {
      transcript?: unknown;
      tasksSummary?: unknown;
      conversationHistory?: unknown;
      localTime?: unknown;
    };

    if (typeof body.transcript !== 'string' || !body.transcript.trim()) {
      res.status(400).json({ error: 'Please provide a spoken or typed command.' });
      return;
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
      res.json(result);
    } catch (err) {
      const message = extractCleanErrorMessage(err, 'Failed to process Jarvis command.');
      res.status(502).json({ error: message });
    }
  });

  app.post('/api/jarvis/voice-turn', async (req, res) => {
    const ai = getAiClient();
    const aiTts = getVersionedAiClient('v1alpha');
    if (!ai) {
      res.status(503).json({
        error:
          'Gemini API key is not configured on the server. Add GEMINI_API_KEY in Settings > Secrets to enable Jarvis.',
      });
      return;
    }

    const body = req.body as {
      audioBase64?: unknown;
      mimeType?: unknown;
      tasksSummary?: unknown;
      conversationHistory?: unknown;
      localTime?: unknown;
      includeTts?: unknown;
    };

    if (typeof body.audioBase64 !== 'string' || !body.audioBase64.trim()) {
      res.status(400).json({ error: 'Audio payload is required.' });
      return;
    }

    const audioBase64 = body.audioBase64;
    const rawMime = typeof body.mimeType === 'string' ? body.mimeType : 'audio/webm';
    const normalizedMime = normalizeAudioMime(rawMime);
    if (!normalizedMime) {
      res.status(400).json({ error: `Unsupported audio MIME type: ${rawMime}` });
      return;
    }

    const localTime =
      typeof body.localTime === 'string' && body.localTime.trim()
        ? body.localTime.trim().slice(0, 64)
        : new Date().toISOString();

    try {
      const transcript = await transcribeAudioBuffer(audioBase64, normalizedMime);
      if (!transcript) {
        res.json({
          transcript: '',
          inaudible: true,
          reply: 'I did not catch that clearly, sir. Please speak a bit closer or try again.',
          actions: [],
          followUpExpected: false,
        });
        return;
      }

      const commandResult = await runJarvisCommand(ai, {
        transcript,
        tasksSummary: sanitizeTasksSummary(body.tasksSummary),
        conversationHistory: sanitizeHistory(body.conversationHistory),
        localTime,
      });

      let audioPayload: { audioBase64: string; mimeType: string } | null = null;
      if (body.includeTts !== false && aiTts && Date.now() >= ttsQuotaCooldownUntil) {
        try {
          audioPayload = await synthesizeJarvisSpeech(aiTts, commandResult.reply);
        } catch {
          audioPayload = null;
        }
      }

      res.json({
        transcript,
        inaudible: false,
        ...commandResult,
        audioBase64: audioPayload?.audioBase64 ?? null,
        mimeType: audioPayload?.mimeType ?? null,
        ttsFallback: body.includeTts !== false && !audioPayload ? 'browser' : null,
      });
    } catch (err) {
      const message = extractCleanErrorMessage(err, 'Voice turn failed.');
      res.status(502).json({ error: message });
    }
  });

  app.post('/api/jarvis/speak', async (req, res) => {
    const aiTts = getVersionedAiClient('v1alpha');
    if (!aiTts) {
      res.status(503).json({
        error: 'Gemini API key is not configured on the server.',
      });
      return;
    }

    const body = req.body as { text?: unknown };
    if (typeof body.text !== 'string' || !body.text.trim()) {
      res.status(400).json({ error: 'Text is required for speech synthesis.' });
      return;
    }

    if (Date.now() < ttsQuotaCooldownUntil) {
      res.json({ audioBase64: null, mimeType: null, fallback: 'browser' });
      return;
    }

    try {
      const audio = await synthesizeJarvisSpeech(aiTts, body.text);
      res.json({ ...audio, fallback: null });
    } catch {
      res.json({ audioBase64: null, mimeType: null, fallback: 'browser' });
    }
  });

  app.post('/api/jarvis/transcribe', async (req, res) => {
    const ai = getAiClient();
    if (!ai) {
      res.status(503).json({
        error: 'Gemini API key is not configured on the server.',
      });
      return;
    }

    const body = req.body as { audioBase64?: unknown; mimeType?: unknown };
    if (typeof body.audioBase64 !== 'string' || !body.audioBase64.trim()) {
      res.status(400).json({ error: 'Audio payload is required.' });
      return;
    }

    const audioBase64 = body.audioBase64;
    const rawMime = typeof body.mimeType === 'string' ? body.mimeType : 'audio/webm';
    const normalizedMime = normalizeAudioMime(rawMime);
    if (!normalizedMime) {
      res.status(400).json({ error: 'Unsupported audio MIME type.' });
      return;
    }

    try {
      const transcript = await transcribeAudioBuffer(audioBase64, normalizedMime);
      res.json({ transcript });
    } catch (err) {
      const message = extractCleanErrorMessage(err, 'Audio transcription failed.');
      res.status(502).json({ error: message });
    }
  });

  // Real-Time Gemini Live API WebSocket bridge (explicit upgrade routing avoids interfering with any other paths)
  const wss = new WebSocketServer({ noServer: true });

  httpServer.on('upgrade', (request, socket, head) => {
    const pathname = (request.url ?? '').split('?')[0];
    if (pathname === '/api/jarvis/live') {
      wss.handleUpgrade(request, socket, head, (ws) => {
        wss.emit('connection', ws, request);
      });
    } else {
      socket.destroy();
    }
  });

  wss.on('connection', (clientWs) => {
    const aiAlpha = getVersionedAiClient('v1alpha');
    const aiBeta = getVersionedAiClient('v1beta');
    if (!aiAlpha && !aiBeta) {
      clientWs.send(
        JSON.stringify({
          type: 'error',
          message:
            'Gemini API key is not configured on the server. Add GEMINI_API_KEY in Settings > Secrets.',
        }),
      );
      clientWs.close();
      return;
    }

    let liveSession: Awaited<ReturnType<GoogleGenAI['live']['connect']>> | null = null;
    let isClosing = false;
    let sessionReady = false;
    const pendingAudioChunks: string[] = [];
    const pendingTextTurns: string[] = [];
    const wsPingTimer = setInterval(() => {
      if (clientWs.readyState === WebSocket.OPEN) {
        try {
          clientWs.ping();
        } catch {
          // ignore ping failures
        }
      }
    }, 15_000);

    const safeSend = (payload: Record<string, unknown>) => {
      if (clientWs.readyState === WebSocket.OPEN) {
        clientWs.send(JSON.stringify(payload));
      }
    };

    const closeAll = () => {
      if (isClosing) return;
      isClosing = true;
      clearInterval(wsPingTimer);
      if (liveSession) {
        try {
          liveSession.close();
        } catch {
          // ignore close errors
        }
        liveSession = null;
      }
      if (
        clientWs.readyState === WebSocket.OPEN ||
        clientWs.readyState === WebSocket.CONNECTING
      ) {
        clientWs.close();
      }
    };

    const connectLive = async (
      aiClient: GoogleGenAI,
      liveInstruction: string,
    ): Promise<Awaited<ReturnType<GoogleGenAI['live']['connect']>>> => {
      return aiClient.live.connect({
        model: 'gemini-3.8-live',
        config: {
          responseModalities: [Modality.AUDIO],
          speechConfig: {
            voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Charon' } },
          },
          inputAudioTranscription: {},
          outputAudioTranscription: {},
          systemInstruction: liveInstruction,
          tools: [{ functionDeclarations: JARVIS_LIVE_TOOLS }],
        },
        callbacks: {
          onopen: () => {
            // Wait until connect() resolves and liveSession is assigned before signaling ready
          },
          onmessage: (message: LiveServerMessage) => {
            const content = message.serverContent;
            if (content?.inputTranscription?.text) {
              safeSend({
                type: 'input_transcript',
                text: content.inputTranscription.text,
              });
            }
            if (content?.outputTranscription?.text) {
              safeSend({
                type: 'output_transcript',
                text: content.outputTranscription.text,
              });
            }

            for (const part of content?.modelTurn?.parts ?? []) {
              if (part.inlineData?.data) {
                safeSend({ type: 'audio', data: part.inlineData.data });
              }
            }

            if (content?.interrupted) {
              safeSend({ type: 'interrupted' });
            }

            if (content?.turnComplete) {
              safeSend({ type: 'turn_complete' });
            }

            const calls = message.toolCall?.functionCalls ?? [];
            if (calls.length > 0 && liveSession) {
              const actionsToApply: Record<string, unknown>[] = [];
              const functionResponses = calls.map((call) => {
                const args = (call.args ?? {}) as Record<string, unknown>;
                if (
                  call.name === 'add_task' ||
                  call.name === 'move_task' ||
                  call.name === 'complete_task' ||
                  call.name === 'delete_task' ||
                  call.name === 'set_reminder'
                ) {
                  actionsToApply.push({
                    type: call.name,
                    title: typeof args.title === 'string' ? args.title : undefined,
                    quadrant: typeof args.quadrant === 'string' ? args.quadrant : undefined,
                    targetTaskTitle:
                      typeof args.targetTaskTitle === 'string'
                        ? args.targetTaskTitle
                        : undefined,
                    reminderMinutesFromNow:
                      typeof args.reminderMinutesFromNow === 'number'
                        ? args.reminderMinutesFromNow
                        : undefined,
                    reminderIso:
                      typeof args.reminderIso === 'string' ? args.reminderIso : undefined,
                    notes: typeof args.notes === 'string' ? args.notes : undefined,
                  });
                }
                return {
                  id: call.id,
                  name: call.name,
                  response: { ok: true },
                };
              });

              if (actionsToApply.length > 0) {
                safeSend({ type: 'actions', actions: actionsToApply });
              }

              try {
                liveSession.sendToolResponse({ functionResponses });
              } catch {
                // ignore if session already closed
              }
            }
          },
          onerror: (err) => {
            if (!sessionReady) return;
            const msg = extractCleanErrorMessage(
              err,
              'Live voice connection encountered an error.',
            );
            safeSend({ type: 'error', message: msg });
          },
          onclose: (ev) => {
            if (!sessionReady) return;
            if (ev && typeof ev.code === 'number' && ev.code !== 1000) {
              safeSend({
                type: 'error',
                message: ev.reason
                  ? `Live voice closed (${ev.code}): ${ev.reason}`
                  : `Live voice connection interrupted (code ${ev.code}).`,
              });
            }
            safeSend({ type: 'closed' });
            closeAll();
          },
        },
      });
    };

    const startLiveSession = async (tasksSummary: SanitizedTaskSummary[], localTime: string) => {
      if (liveSession || isClosing) return;
      const liveInstruction = [
        JARVIS_SYSTEM_INSTRUCTION,
        'In live voice conversation, speak naturally and concisely like MCU JARVIS. Whenever the user asks to add, move, complete, delete, or set a reminder on tasks, invoke the matching tool immediately and confirm succinctly.',
        formatTasksContextBlock(tasksSummary, localTime),
      ].join('\n\n');

      const candidates = [aiBeta, aiAlpha].filter((c): c is GoogleGenAI => Boolean(c));
      let lastErr: unknown;

      for (const client of candidates) {
        if (isClosing) return;
        try {
          const session = await connectLive(client, liveInstruction);
          if (isClosing) {
            session.close();
            return;
          }
          liveSession = session;
          sessionReady = true;
          safeSend({ type: 'ready' });

          while (pendingAudioChunks.length > 0) {
            const chunk = pendingAudioChunks.shift();
            if (chunk) {
              session.sendRealtimeInput({
                audio: { data: chunk, mimeType: 'audio/pcm;rate=16000' },
              });
            }
          }
          while (pendingTextTurns.length > 0) {
            const textTurn = pendingTextTurns.shift();
            if (textTurn) {
              session.sendRealtimeInput({ text: textTurn });
            }
          }
          return;
        } catch (err) {
          lastErr = err;
        }
      }

      const msg = extractCleanErrorMessage(lastErr, 'Unable to start live voice session.');
      safeSend({ type: 'error', message: msg });
      closeAll();
    };

    clientWs.on('message', (raw) => {
      try {
        const msg = JSON.parse(raw.toString()) as {
          type?: string;
          data?: string;
          text?: string;
          tasksSummary?: unknown;
          localTime?: string;
        };

        if (msg.type === 'init') {
          const tasksSummary = sanitizeTasksSummary(msg.tasksSummary);
          const localTime =
            typeof msg.localTime === 'string' && msg.localTime.trim()
              ? msg.localTime.slice(0, 64)
              : new Date().toISOString();
          void startLiveSession(tasksSummary, localTime);
          return;
        }

        if (msg.type === 'audio' && typeof msg.data === 'string' && msg.data.length > 0) {
          if (liveSession && sessionReady) {
            liveSession.sendRealtimeInput({
              audio: { data: msg.data, mimeType: 'audio/pcm;rate=16000' },
            });
          } else if (pendingAudioChunks.length < 30) {
            pendingAudioChunks.push(msg.data);
          }
          return;
        }

        if (msg.type === 'audio_end') {
          if (liveSession && sessionReady) {
            try {
              liveSession.sendRealtimeInput({ audioStreamEnd: true });
            } catch {
              // ignore if unsupported or closing
            }
          }
          return;
        }

        if (msg.type === 'text' && typeof msg.text === 'string' && msg.text.trim()) {
          const clean = msg.text.trim().slice(0, 1000);
          if (liveSession && sessionReady) {
            liveSession.sendRealtimeInput({ text: clean });
          } else if (pendingTextTurns.length < 10) {
            pendingTextTurns.push(clean);
          }
        }
      } catch {
        // ignore malformed websocket payloads
      }
    });

    clientWs.on('close', closeAll);
    clientWs.on('error', closeAll);
  });

  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        host: '0.0.0.0',
        allowedHosts: true,
        hmr: false,
      },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(__dirname, 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  httpServer.listen(PORT, '0.0.0.0', () => {
    console.log(`ArcMatrix server listening on 0.0.0.0:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
