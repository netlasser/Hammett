import type { Config, Context } from '@netlify/functions';
import { getStore } from '@netlify/blobs';

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
      `Eisenhower Quadrant: ${qMeta.code} \u00b7 ${qMeta.title} (${qMeta.subtitle})`,
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
      `SUMMARY:${escapeFeedText(`[${qMeta.code} \u00b7 ${qMeta.title}] ${t.title}`)}`,
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

async function getFeed(feedId: string): Promise<StoredCalendarFeed | undefined> {
  const store = getStore('arcmatrix-calendar-feeds');
  const raw = await store.get(`feed:${feedId}`, { type: 'text' });
  return raw ? (JSON.parse(raw) as StoredCalendarFeed) : undefined;
}

export default async (req: Request, context: Context) => {
  const method = req.method;

  if (method === 'POST') {
    const body = (await req.json().catch(() => null)) as {
      feedId?: unknown;
      tasks?: unknown;
      includeCompleted?: unknown;
    } | null;

    const requestedFeedId =
      typeof body?.feedId === 'string' && /^[a-zA-Z0-9_-]{8,64}$/.test(body.feedId)
        ? body.feedId
        : crypto.randomUUID().replace(/-/g, '');

    const rawTasks = Array.isArray(body?.tasks) ? body.tasks.slice(0, 200) : [];
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
    const record: StoredCalendarFeed = {
      tasks: sanitized,
      includeCompleted: Boolean(body?.includeCompleted),
      updatedAt,
    };

    await getStore('arcmatrix-calendar-feeds').setJSON(`feed:${requestedFeedId}`, record);

    return Response.json({
      feedId: requestedFeedId,
      syncedAt: updatedAt,
      count: sanitized.length,
    });
  }

  if (method === 'GET') {
    const url = new URL(req.url);
    const feedId = decodeURIComponent(url.searchParams.get('feedId') ?? context.params.feedId ?? '')
      .replace(/\.ics$/i, '');
    if (!/^[a-zA-Z0-9_-]{8,64}$/.test(feedId.replace(/\.ics$/i, ''))) {
      return new Response('Invalid calendar feed ID.', { status: 400 });
    }

    const feed = await getFeed(feedId);
    if (!feed) {
      return new Response('Calendar feed not found. Open ArcMatrix to re-sync.', { status: 404 });
    }

    return new Response(renderFeedIcs(feed), {
      status: 200,
      headers: {
        'Content-Type': 'text/calendar; charset=utf-8',
        'Content-Disposition': 'inline; filename="arcmatrix-deadlines.ics"',
        'Cache-Control': 'no-cache, no-store, must-revalidate',
      },
    });
  }

  return new Response('Method Not Allowed', { status: 405 });
};

export const config: Config = { method: ['GET', 'POST'] };
