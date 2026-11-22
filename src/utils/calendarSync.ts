import type { QuadrantId, Task } from '../types/task';
import { QUADRANT_META } from './matrix';

const DEFAULT_DURATION_MINUTES = 30;
const DEFAULT_ALARM_MINUTES = 10;

const QUADRANT_ICS_PRIORITY: Record<QuadrantId, number> = {
  q1: 1, // Urgent & Important -> High priority (RFC 5545 1-4)
  q2: 3, // Not Urgent & Important -> High-Medium
  q3: 5, // Urgent & Not Important -> Normal
  q4: 9, // Not Urgent & Not Important -> Low
};

export interface IcsExportOptions {
  includeCompleted?: boolean;
  calendarName?: string;
  durationMinutes?: number;
  alarmMinutesBefore?: number;
  nowMs?: number;
  prodId?: string;
}

/**
 * Formats a Unix epoch timestamp (ms) into an RFC 5545 UTC timestamp: YYYYMMDDTHHMMSSZ
 */
export function formatIcsTimestampUtc(ms: number): string {
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, '0');
  return (
    `${d.getUTCFullYear()}` +
    `${pad(d.getUTCMonth() + 1)}` +
    `${pad(d.getUTCDate())}T` +
    `${pad(d.getUTCHours())}` +
    `${pad(d.getUTCMinutes())}` +
    `${pad(d.getUTCSeconds())}Z`
  );
}

/**
 * Escapes special characters per RFC 5545 Section 3.3.11 (TEXT values).
 */
export function escapeIcsText(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/\r\n|\r|\n/g, '\\n')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,');
}

/**
 * Folds lines exceeding 75 characters using CRLF + single SPACE per RFC 5545 Section 3.1.
 */
export function foldIcsLine(line: string): string {
  if (line.length <= 75) return line;
  const segments: string[] = [];
  segments.push(line.slice(0, 75));
  let offset = 75;
  while (offset < line.length) {
    segments.push(' ' + line.slice(offset, offset + 74));
    offset += 74;
  }
  return segments.join('\r\n');
}

/**
 * Filters and sorts tasks that carry a reminder timestamp for calendar sync/export.
 */
export function getExportableReminderTasks(
  tasks: Task[],
  includeCompleted = false,
): Task[] {
  return tasks
    .filter(
      (task) =>
        task.reminderAt !== null &&
        task.reminderAt !== undefined &&
        Number.isFinite(task.reminderAt) &&
        (includeCompleted || !task.completed),
    )
    .sort((a, b) => (a.reminderAt ?? 0) - (b.reminderAt ?? 0));
}

function buildTaskDescription(task: Task): string {
  const qMeta = QUADRANT_META[task.quadrant];
  const lines = [
    `Eisenhower Quadrant: ${qMeta.code} · ${qMeta.title} (${qMeta.subtitle})`,
    `Status: ${task.completed ? 'Completed' : 'Active'}`,
  ];
  if (task.notes?.trim()) {
    lines.push('', task.notes.trim());
  }
  lines.push('', 'Synced via ArcMatrix');
  return lines.join('\n');
}

/**
 * Generates VEVENT lines for a single task with a reminder.
 */
export function taskToIcsEventLines(
  task: Task,
  options: Pick<IcsExportOptions, 'durationMinutes' | 'alarmMinutesBefore' | 'nowMs'> = {},
): string[] {
  if (task.reminderAt === null || task.reminderAt === undefined || !Number.isFinite(task.reminderAt)) {
    throw new Error(`Task "${task.title}" does not have a valid reminder timestamp.`);
  }

  const durationMinutes = Math.max(5, options.durationMinutes ?? DEFAULT_DURATION_MINUTES);
  const alarmMinutesBefore = Math.max(0, options.alarmMinutesBefore ?? DEFAULT_ALARM_MINUTES);
  const stampMs = options.nowMs ?? task.updatedAt ?? Date.now();
  const startMs = task.reminderAt;
  const endMs = startMs + durationMinutes * 60_000;
  const qMeta = QUADRANT_META[task.quadrant];

  const summary = `[${qMeta.code} · ${qMeta.title}] ${task.title}`;
  const description = buildTaskDescription(task);
  const categories = `Eisenhower-${qMeta.code},${qMeta.title},${qMeta.urgencyLabel},${qMeta.importanceLabel}`;

  const rawLines = [
    'BEGIN:VEVENT',
    `UID:${task.id.replace(/[^a-zA-Z0-9._-]/g, '-')}@arcmatrix.app`,
    `DTSTAMP:${formatIcsTimestampUtc(stampMs)}`,
    `DTSTART:${formatIcsTimestampUtc(startMs)}`,
    `DTEND:${formatIcsTimestampUtc(endMs)}`,
    `SUMMARY:${escapeIcsText(summary)}`,
    `DESCRIPTION:${escapeIcsText(description)}`,
    `CATEGORIES:${escapeIcsText(qMeta.code)},${escapeIcsText(qMeta.title)},Eisenhower Matrix`,
    `PRIORITY:${QUADRANT_ICS_PRIORITY[task.quadrant]}`,
    `STATUS:${task.completed ? 'COMPLETED' : 'CONFIRMED'}`,
    `X-ARCMATRIX-QUADRANT:${qMeta.code}`,
    'BEGIN:VALARM',
    'ACTION:DISPLAY',
    `DESCRIPTION:${escapeIcsText(`ArcMatrix Reminder (${qMeta.code}): ${task.title}`)}`,
    alarmMinutesBefore > 0 ? `TRIGGER:-PT${alarmMinutesBefore}M` : 'TRIGGER:PT0S',
    'END:VALARM',
    'END:VEVENT',
  ];

  // Replace generic categories line with escaped category list
  const catIdx = rawLines.findIndex((line) => line.startsWith('CATEGORIES:'));
  if (catIdx >= 0) {
    rawLines[catIdx] = `CATEGORIES:${categories
      .split(',')
      .map((c) => escapeIcsText(c))
      .join(',')}`;
  }

  return rawLines.map(foldIcsLine);
}

/**
 * Generates an RFC 5545 compliant iCalendar (.ics) string containing all matching tasks with reminders.
 */
export function generateIcsCalendar(tasks: Task[], options: IcsExportOptions = {}): string {
  const includeCompleted = Boolean(options.includeCompleted);
  const calendarName = options.calendarName?.trim() || 'ArcMatrix Eisenhower Deadlines';
  const prodId = options.prodId?.trim() || '-//ArcMatrix//Eisenhower Matrix Calendar Sync//EN';

  const exportable = getExportableReminderTasks(tasks, includeCompleted);

  const headerLines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    `PRODID:${prodId}`,
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${escapeIcsText(calendarName)}`,
    'X-WR-CALDESC:Eisenhower Matrix deadlines and push reminders synced from ArcMatrix.',
    'REFRESH-INTERVAL;VALUE=DURATION:PT15M',
    'X-PUBLISHED-TTL:PT15M',
  ].map(foldIcsLine);

  const eventLines = exportable.flatMap((task) =>
    taskToIcsEventLines(task, {
      durationMinutes: options.durationMinutes,
      alarmMinutesBefore: options.alarmMinutesBefore,
      nowMs: options.nowMs,
    }),
  );

  return [...headerLines, ...eventLines, 'END:VCALENDAR', ''].join('\r\n');
}

/**
 * Builds a Google Calendar event creation URL for direct one-click addition without OAuth setup.
 */
export function buildGoogleCalendarTemplateUrl(
  task: Task,
  durationMinutes: number = DEFAULT_DURATION_MINUTES,
): string | null {
  if (task.reminderAt === null || task.reminderAt === undefined || !Number.isFinite(task.reminderAt)) {
    return null;
  }

  const qMeta = QUADRANT_META[task.quadrant];
  const startUtc = formatIcsTimestampUtc(task.reminderAt);
  const endUtc = formatIcsTimestampUtc(task.reminderAt + Math.max(5, durationMinutes) * 60_000);

  const params = new URLSearchParams({
    action: 'TEMPLATE',
    text: `[${qMeta.code} · ${qMeta.title}] ${task.title}`,
    dates: `${startUtc}/${endUtc}`,
    details: buildTaskDescription(task),
  });

  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}

/**
 * Builds an Outlook on the Web event compose URL for direct one-click addition.
 */
export function buildOutlookCalendarUrl(
  task: Task,
  durationMinutes: number = DEFAULT_DURATION_MINUTES,
): string | null {
  if (task.reminderAt === null || task.reminderAt === undefined || !Number.isFinite(task.reminderAt)) {
    return null;
  }

  const qMeta = QUADRANT_META[task.quadrant];
  const startIso = new Date(task.reminderAt).toISOString();
  const endIso = new Date(
    task.reminderAt + Math.max(5, durationMinutes) * 60_000,
  ).toISOString();

  const params = new URLSearchParams({
    path: '/calendar/action/compose',
    rru: 'addevent',
    subject: `[${qMeta.code} · ${qMeta.title}] ${task.title}`,
    startdt: startIso,
    enddt: endIso,
    body: buildTaskDescription(task),
  });

  return `https://outlook.live.com/calendar/0/deeplink/compose?${params.toString()}`;
}

/**
 * Triggers a browser download of an .ics file for the given tasks.
 */
export function downloadTasksAsIcs(
  tasks: Task[],
  options: IcsExportOptions & { filename?: string } = {},
): { exportedCount: number; filename: string } {
  const exportable = getExportableReminderTasks(tasks, Boolean(options.includeCompleted));
  const filename = options.filename?.trim() || 'arcmatrix-deadlines.ics';
  if (exportable.length === 0) {
    return { exportedCount: 0, filename };
  }

  const icsContent = generateIcsCalendar(exportable, options);
  const blob = new Blob([icsContent], { type: 'text/calendar;charset=utf-8' });
  const url = URL.createObjectURL(blob);

  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.style.display = 'none';
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);

  window.setTimeout(() => {
    URL.revokeObjectURL(url);
  }, 1_000);

  return { exportedCount: exportable.length, filename };
}

export function buildFeedUrls(feedId: string, origin?: string): {
  httpsUrl: string;
  webcalUrl: string;
} {
  const baseOrigin =
    origin ?? (typeof window !== 'undefined' ? window.location.origin : 'http://localhost:3000');
  const httpsUrl = `${baseOrigin}/api/calendar/feed/${encodeURIComponent(feedId)}.ics`;
  const webcalUrl = httpsUrl.replace(/^https?:\/\//i, 'webcal://');
  return { httpsUrl, webcalUrl };
}
