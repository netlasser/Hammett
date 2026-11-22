import test from 'node:test';
import assert from 'node:assert/strict';
import type { Task } from '../types/task';
import {
  buildFeedUrls,
  buildGoogleCalendarTemplateUrl,
  buildOutlookCalendarUrl,
  escapeIcsText,
  foldIcsLine,
  formatIcsTimestampUtc,
  generateIcsCalendar,
  getExportableReminderTasks,
} from './calendarSync';

const BASE_MS = Date.UTC(2026, 10, 22, 14, 30, 0); // 2026-11-22T14:30:00Z

const SAMPLE_TASKS: Task[] = [
  {
    id: 't1',
    title: 'Deploy hotfix; verify rollback, check metrics',
    notes: 'Line one\nLine two with \\ backslash',
    quadrant: 'q1',
    completed: false,
    createdAt: BASE_MS - 3600_000,
    updatedAt: BASE_MS - 1800_000,
    order: 0,
    reminderAt: BASE_MS + 3600_000, // 15:30Z
    reminderFired: false,
  },
  {
    id: 't2',
    title: 'No reminder task',
    quadrant: 'q2',
    completed: false,
    createdAt: BASE_MS - 3600_000,
    updatedAt: BASE_MS - 3600_000,
    order: 0,
    reminderAt: null,
    reminderFired: false,
  },
  {
    id: 't3',
    title: 'Completed scheduled task',
    quadrant: 'q3',
    completed: true,
    createdAt: BASE_MS - 7200_000,
    updatedAt: BASE_MS - 1000_000,
    order: 0,
    reminderAt: BASE_MS + 1800_000, // 15:00Z (earlier)
    reminderFired: true,
  },
  {
    id: 't4',
    title: 'Strategic roadmap review',
    quadrant: 'q2',
    completed: false,
    createdAt: BASE_MS - 3600_000,
    updatedAt: BASE_MS - 900_000,
    order: 1,
    reminderAt: BASE_MS + 7200_000, // 16:30Z
    reminderFired: false,
  },
];

test('formatIcsTimestampUtc formats UTC dates to RFC 5545 basic format', () => {
  assert.equal(formatIcsTimestampUtc(BASE_MS), '20261122T143000Z');
});

test('escapeIcsText escapes backslashes, newlines, semicolons, and commas', () => {
  assert.equal(
    escapeIcsText('A; B, C\\D\nNext'),
    'A\\; B\\, C\\\\D\\nNext',
  );
});

test('foldIcsLine folds lines longer than 75 chars with CRLF + space', () => {
  const longLine = 'DESCRIPTION:' + 'x'.repeat(120);
  const folded = foldIcsLine(longLine);
  const parts = folded.split('\r\n');
  assert.equal(parts.length, 2);
  assert.equal(parts[0].length, 75);
  assert.ok(parts[1].startsWith(' '));
});

test('getExportableReminderTasks filters out tasks without reminders and sorts chronologically', () => {
  const activeOnly = getExportableReminderTasks(SAMPLE_TASKS, false);
  assert.deepEqual(
    activeOnly.map((t) => t.id),
    ['t1', 't4'],
  );

  const withCompleted = getExportableReminderTasks(SAMPLE_TASKS, true);
  assert.deepEqual(
    withCompleted.map((t) => t.id),
    ['t3', 't1', 't4'],
  );
});

test('generateIcsCalendar outputs valid RFC 5545 VCALENDAR with VEVENTs, priorities, and VALARM', () => {
  const ics = generateIcsCalendar(SAMPLE_TASKS, {
    includeCompleted: false,
    durationMinutes: 45,
    alarmMinutesBefore: 15,
    nowMs: BASE_MS,
  });

  assert.ok(ics.includes('\r\n'));
  assert.ok(ics.startsWith('BEGIN:VCALENDAR\r\n'));
  assert.ok(ics.endsWith('END:VCALENDAR\r\n'));

  // Should contain t1 and t4, not t2 or t3
  assert.equal((ics.match(/BEGIN:VEVENT/g) ?? []).length, 2);
  assert.ok(ics.includes('UID:t1@arcmatrix.app'));
  assert.ok(ics.includes('UID:t4@arcmatrix.app'));
  assert.ok(!ics.includes('UID:t2@arcmatrix.app'));
  assert.ok(!ics.includes('UID:t3@arcmatrix.app'));

  // Escaped summary, priority 1 for Q1 and 3 for Q2, and 15m VALARM trigger
  assert.ok(ics.includes('DTSTART:20261122T153000Z'));
  assert.ok(ics.includes('DTEND:20261122T161500Z'));
  assert.ok(ics.includes('PRIORITY:1'));
  assert.ok(ics.includes('PRIORITY:3'));
  assert.ok(ics.includes('TRIGGER:-PT15M'));
  assert.ok(ics.includes('Deploy hotfix\\; verify rollback\\, check metrics'));
});

test('buildGoogleCalendarTemplateUrl and buildOutlookCalendarUrl build direct sync URLs', () => {
  const googleUrl = buildGoogleCalendarTemplateUrl(SAMPLE_TASKS[0], 30);
  assert.ok(googleUrl);
  const parsedGoogle = new URL(googleUrl);
  assert.equal(parsedGoogle.hostname, 'calendar.google.com');
  assert.equal(parsedGoogle.searchParams.get('action'), 'TEMPLATE');
  assert.equal(
    parsedGoogle.searchParams.get('dates'),
    '20261122T153000Z/20261122T160000Z',
  );
  assert.ok(parsedGoogle.searchParams.get('text')?.includes('[Q1 · Do First]'));

  const outlookUrl = buildOutlookCalendarUrl(SAMPLE_TASKS[0], 30);
  assert.ok(outlookUrl);
  const parsedOutlook = new URL(outlookUrl);
  assert.equal(parsedOutlook.hostname, 'outlook.live.com');
  assert.equal(parsedOutlook.searchParams.get('startdt'), '2026-11-22T15:30:00.000Z');
  assert.equal(parsedOutlook.searchParams.get('enddt'), '2026-11-22T16:00:00.000Z');

  assert.equal(buildGoogleCalendarTemplateUrl(SAMPLE_TASKS[1]), null);
  assert.equal(buildOutlookCalendarUrl(SAMPLE_TASKS[1]), null);
});

test('buildFeedUrls creates HTTPS and webcal subscription URLs', () => {
  const { httpsUrl, webcalUrl } = buildFeedUrls('feed_abc123', 'https://arcmatrix.example.com');
  assert.equal(httpsUrl, 'https://arcmatrix.example.com/api/calendar/feed/feed_abc123.ics');
  assert.equal(webcalUrl, 'webcal://arcmatrix.example.com/api/calendar/feed/feed_abc123.ics');
});
