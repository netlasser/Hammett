import 'dotenv/config';
import crypto from 'crypto';
import express from 'express';
import fs from 'fs';
import { createServer } from 'http';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  createLiveAuthToken,
  extractCleanErrorMessage,
  getAiClient,
  getVersionedAiClient,
  isTtsQuotaCoolingDown,
  LIVE_MODEL_ID,
  normalizeAudioMime,
  runJarvisCommand,
  sanitizeHistory,
  sanitizeTasksSummary,
  synthesizeJarvisSpeech,
  transcribeAudioBuffer,
  withTimeout,
} from './netlify/functions/_lib/jarvis-core';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.PORT) || 3000;

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
      if (body.includeTts !== false && aiTts && !isTtsQuotaCoolingDown()) {
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

    if (isTtsQuotaCoolingDown()) {
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

  app.get('/api/jarvis/selftest/key', (_req, res) => {
    res.json({ configured: getAiClient() !== null });
  });

  app.post('/api/jarvis/selftest/live', async (_req, res) => {
    try {
      const token = await withTimeout(createLiveAuthToken(), 10000, 'Ephemeral token request');
      if (!token?.name) {
        throw new Error('Ephemeral token response did not include a token name.');
      }
      res.json({ ok: true, model: LIVE_MODEL_ID, mode: 'ephemeral-token' });
    } catch (err) {
      res.status(502).json({
        ok: false,
        model: LIVE_MODEL_ID,
        mode: 'ephemeral-token',
        error: extractCleanErrorMessage(err, 'Live session setup failed.'),
      });
    }
  });

  app.post('/api/jarvis/live-token', async (_req, res) => {
    try {
      const token = await createLiveAuthToken();
      res.json({ token: token.name, model: LIVE_MODEL_ID, expiresInSeconds: 1800 });
    } catch (err) {
      res.status(502).json({ error: extractCleanErrorMessage(err, 'Live token request failed.') });
    }
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
    console.log(
      `[Jarvis] GEMINI_API_KEY: ${
        getAiClient() ? 'configured' : 'NOT configured - Jarvis voice will report errors until it is set'
      }`,
    );
  });
}

startServer().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
