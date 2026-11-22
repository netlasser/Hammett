import { useEffect, useMemo, useState } from 'react';
import {
  Calendar,
  Check,
  Copy,
  Download,
  ExternalLink,
  RefreshCw,
  X,
} from 'lucide-react';
import type { Task } from '../types/task';
import {
  buildFeedUrls,
  buildGoogleCalendarTemplateUrl,
  buildOutlookCalendarUrl,
  downloadTasksAsIcs,
  getExportableReminderTasks,
} from '../utils/calendarSync';
import { formatReminderTime, QUADRANT_META } from '../utils/matrix';

interface CalendarSyncModalProps {
  isOpen: boolean;
  onClose: () => void;
  tasks: Task[];
  nowMs: number;
  feedId: string | null;
  feedSyncing: boolean;
  feedLastSyncedAt: number | null;
  includeCompleted: boolean;
  onToggleIncludeCompleted: (next: boolean) => void;
  onSyncFeed: () => Promise<void>;
}

export function CalendarSyncModal({
  isOpen,
  onClose,
  tasks,
  nowMs,
  feedId,
  feedSyncing,
  feedLastSyncedAt,
  includeCompleted,
  onToggleIncludeCompleted,
  onSyncFeed,
}: CalendarSyncModalProps) {
  const [copiedUrl, setCopiedUrl] = useState(false);
  const [exportStatus, setExportStatus] = useState<string | null>(null);
  const [syncError, setSyncError] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [isOpen, onClose]);

  useEffect(() => {
    if (!isOpen) {
      setExportStatus(null);
      setSyncError(null);
      setCopiedUrl(false);
    }
  }, [isOpen]);

  const exportableTasks = useMemo(
    () => getExportableReminderTasks(tasks, includeCompleted),
    [tasks, includeCompleted],
  );

  const feedUrls = useMemo(() => {
    if (!feedId) return null;
    return buildFeedUrls(feedId);
  }, [feedId]);

  if (!isOpen) return null;

  const handleExportAll = () => {
    const result = downloadTasksAsIcs(tasks, {
      includeCompleted,
      filename: 'arcmatrix-deadlines.ics',
      nowMs,
    });
    if (result.exportedCount === 0) {
      setExportStatus('No tasks with reminders match the export filter.');
    } else {
      setExportStatus(
        `Downloaded ${result.exportedCount} deadline${result.exportedCount === 1 ? '' : 's'} to ${result.filename}.`,
      );
    }
  };

  const handleTriggerSync = async () => {
    setSyncError(null);
    try {
      await onSyncFeed();
    } catch (err) {
      setSyncError(err instanceof Error ? err.message : 'Unable to sync calendar feed.');
    }
  };

  const handleCopyFeedUrl = async () => {
    if (!feedUrls) return;
    try {
      await navigator.clipboard.writeText(feedUrls.httpsUrl);
      setCopiedUrl(true);
      window.setTimeout(() => setCopiedUrl(false), 2000);
    } catch {
      setSyncError('Copy failed. Select and copy the feed URL manually.');
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="calendar-sync-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-neutral-950/40 p-4 backdrop-blur-xs dark:bg-black/75"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="flex max-h-[88vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-neutral-200 bg-white shadow-xl dark:border-white/15 dark:bg-[#0C0F14] dark:shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-neutral-100 px-6 py-4 dark:border-white/10">
          <div className="flex items-center gap-2.5">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-neutral-100 text-neutral-800 dark:bg-sky-400/15 dark:text-sky-300">
              <Calendar className="h-4 w-4" aria-hidden="true" />
            </div>
            <div>
              <h2
                id="calendar-sync-title"
                className="font-display text-base font-semibold text-neutral-950 dark:text-white"
              >
                Calendar Sync &amp; .ics Export
              </h2>
              <p className="text-xs text-neutral-500 dark:text-neutral-400">
                Keep Eisenhower deadlines synced with Google Calendar, Apple Calendar, or Outlook.
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            aria-label="Close calendar sync dialog"
            className="rounded-lg p-1.5 text-neutral-400 transition-colors hover:bg-neutral-100 hover:text-neutral-800 dark:hover:bg-white/10 dark:hover:text-white"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>

        {/* Scrollable Content */}
        <div className="flex-1 space-y-6 overflow-y-auto px-6 py-5">
          {/* Section 1: Direct .ics File Export */}
          <section aria-labelledby="ics-export-heading" className="rounded-xl border border-neutral-200/80 bg-neutral-50/70 p-4 dark:border-white/12 dark:bg-[#10151E]">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h3 id="ics-export-heading" className="text-sm font-semibold text-neutral-950 dark:text-white">
                  Export iCalendar (.ics) File
                </h3>
                <p className="mt-0.5 text-xs text-neutral-500 dark:text-neutral-400">
                  RFC 5545 export with Eisenhower priorities and 10-minute VALARM reminders ({exportableTasks.length}{' '}
                  {exportableTasks.length === 1 ? 'task' : 'tasks'}).
                </p>
              </div>

              <button
                type="button"
                onClick={handleExportAll}
                disabled={exportableTasks.length === 0}
                className="inline-flex h-9 items-center justify-center gap-1.5 rounded-lg bg-neutral-950 px-4 text-xs font-medium text-white transition-colors hover:bg-neutral-800 disabled:cursor-not-allowed disabled:opacity-40 whitespace-nowrap shrink-0 dark:bg-white dark:text-neutral-950 dark:hover:bg-neutral-200"
              >
                <Download className="h-3.5 w-3.5" aria-hidden="true" />
                <span>Download .ics ({exportableTasks.length})</span>
              </button>
            </div>

            <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-neutral-200/70 pt-3 dark:border-white/10">
              <label className="inline-flex cursor-pointer items-center gap-2 text-xs text-neutral-600 dark:text-neutral-300">
                <input
                  type="checkbox"
                  checked={includeCompleted}
                  onChange={(e) => onToggleIncludeCompleted(e.target.checked)}
                  className="h-3.5 w-3.5 rounded border-neutral-300 accent-neutral-950 dark:border-white/25 dark:accent-sky-400"
                />
                <span>Include completed tasks</span>
              </label>

              {exportStatus && (
                <p role="status" className="text-xs font-medium text-sky-700 dark:text-sky-300">
                  {exportStatus}
                </p>
              )}
            </div>
          </section>

          {/* Section 2: Live Calendar Subscription Feed */}
          <section aria-labelledby="live-feed-heading" className="rounded-xl border border-neutral-200/80 bg-neutral-50/70 p-4 dark:border-white/12 dark:bg-[#10151E]">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <h3 id="live-feed-heading" className="text-sm font-semibold text-neutral-950 dark:text-white">
                  Live Calendar Subscription Feed
                </h3>
                <p className="mt-0.5 text-xs text-neutral-500 dark:text-neutral-400">
                  Subscribe once via URL in Google Calendar, Apple Calendar, or Outlook. Changes in ArcMatrix sync automatically.
                </p>
              </div>

              <button
                type="button"
                onClick={() => void handleTriggerSync()}
                disabled={feedSyncing}
                className="inline-flex h-9 items-center justify-center gap-1.5 rounded-lg border border-neutral-200 bg-white px-3.5 text-xs font-medium text-neutral-800 transition-colors hover:bg-neutral-100 disabled:opacity-50 whitespace-nowrap shrink-0 dark:border-white/15 dark:bg-[#151B26] dark:text-neutral-100 dark:hover:bg-[#1D2534]"
              >
                <RefreshCw className={`h-3.5 w-3.5 ${feedSyncing ? 'animate-spin' : ''}`} aria-hidden="true" />
                <span>{feedId ? (feedSyncing ? 'Syncing...' : 'Sync Feed Now') : 'Create Live Feed'}</span>
              </button>
            </div>

            {feedUrls && (
              <div className="mt-3 space-y-2.5 border-t border-neutral-200/70 pt-3 dark:border-white/10">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                  <label htmlFor="ics-feed-url" className="sr-only">
                    Calendar subscription feed URL
                  </label>
                  <input
                    id="ics-feed-url"
                    type="text"
                    readOnly
                    value={feedUrls.httpsUrl}
                    onFocus={(e) => e.currentTarget.select()}
                    className="h-9 flex-1 rounded-lg border border-neutral-200 bg-white px-3 font-mono text-[11px] text-neutral-700 focus:border-neutral-400 focus:outline-none dark:border-white/15 dark:bg-[#0B1018] dark:text-neutral-200 dark:focus:border-sky-400"
                  />
                  <div className="flex items-center gap-1.5 shrink-0">
                    <button
                      type="button"
                      onClick={() => void handleCopyFeedUrl()}
                      className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-neutral-200 bg-white px-3 text-xs font-medium text-neutral-700 transition-colors hover:bg-neutral-100 dark:border-white/15 dark:bg-[#151B26] dark:text-neutral-200 dark:hover:bg-[#1D2534]"
                    >
                      {copiedUrl ? (
                        <>
                          <Check className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" aria-hidden="true" />
                          <span>Copied</span>
                        </>
                      ) : (
                        <>
                          <Copy className="h-3.5 w-3.5" aria-hidden="true" />
                          <span>Copy URL</span>
                        </>
                      )}
                    </button>
                    <a
                      href={feedUrls.webcalUrl}
                      className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-neutral-950 px-3 text-xs font-medium text-white transition-colors hover:bg-neutral-800 dark:bg-sky-400 dark:text-neutral-950 dark:hover:bg-sky-300"
                    >
                      <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
                      <span>Subscribe</span>
                    </a>
                  </div>
                </div>

                {feedLastSyncedAt && (
                  <p className="font-mono text-[11px] text-neutral-400 dark:text-neutral-400">
                    Last synced {new Date(feedLastSyncedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                  </p>
                )}
              </div>
            )}

            {syncError && (
              <p role="alert" className="mt-2 text-xs font-medium text-rose-600 dark:text-rose-400">
                {syncError}
              </p>
            )}
          </section>

          {/* Section 3: Direct Per-Deadline Sync */}
          <section aria-labelledby="direct-links-heading">
            <div className="mb-2.5 flex items-center justify-between">
              <h3 id="direct-links-heading" className="text-xs font-semibold uppercase tracking-wider text-neutral-500 dark:text-neutral-400">
                Direct Add to External Calendar
              </h3>
              <span className="font-mono text-[11px] tabular-nums text-neutral-400 dark:text-neutral-500">
                {exportableTasks.length} scheduled
              </span>
            </div>

            {exportableTasks.length === 0 ? (
              <div className="rounded-xl border border-dashed border-neutral-200 px-4 py-8 text-center dark:border-white/15">
                <p className="text-xs font-medium text-neutral-700 dark:text-neutral-200">
                  No scheduled deadlines yet
                </p>
                <p className="mt-1 text-xs text-neutral-500 dark:text-neutral-400">
                  Add a reminder time to any task to export or sync it here.
                </p>
              </div>
            ) : (
              <ul className="divide-y divide-neutral-100 rounded-xl border border-neutral-200/80 bg-white dark:divide-white/10 dark:border-white/12 dark:bg-[#0F141C]">
                {exportableTasks.map((task) => {
                  const qMeta = QUADRANT_META[task.quadrant];
                  const googleUrl = buildGoogleCalendarTemplateUrl(task);
                  const outlookUrl = buildOutlookCalendarUrl(task);
                  return (
                    <li
                      key={task.id}
                      className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:justify-between"
                    >
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span className={`h-2 w-2 shrink-0 rounded-full ${qMeta.accentDot}`} aria-hidden="true" />
                          <p className="truncate text-sm font-medium text-neutral-900 dark:text-neutral-100">
                            {task.title}
                          </p>
                        </div>
                        <p className="mt-0.5 pl-4 font-mono text-[11px] text-neutral-500 dark:text-neutral-400">
                          {qMeta.code} · {qMeta.title} · {formatReminderTime(task.reminderAt, nowMs)}
                        </p>
                      </div>

                      <div className="flex items-center gap-1.5 pl-4 sm:pl-0 shrink-0">
                        {googleUrl && (
                          <a
                            href={googleUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            aria-label={`Add "${task.title}" to Google Calendar`}
                            className="inline-flex h-7 items-center gap-1 rounded-md border border-neutral-200 bg-white px-2.5 text-[11px] font-medium text-neutral-700 transition-colors hover:bg-neutral-50 hover:text-neutral-950 dark:border-white/15 dark:bg-[#151B26] dark:text-neutral-200 dark:hover:bg-[#1D2534] dark:hover:text-white"
                          >
                            <span>Google</span>
                            <ExternalLink className="h-2.5 w-2.5" aria-hidden="true" />
                          </a>
                        )}
                        {outlookUrl && (
                          <a
                            href={outlookUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            aria-label={`Add "${task.title}" to Outlook Calendar`}
                            className="inline-flex h-7 items-center gap-1 rounded-md border border-neutral-200 bg-white px-2.5 text-[11px] font-medium text-neutral-700 transition-colors hover:bg-neutral-50 hover:text-neutral-950 dark:border-white/15 dark:bg-[#151B26] dark:text-neutral-200 dark:hover:bg-[#1D2534] dark:hover:text-white"
                          >
                            <span>Outlook</span>
                            <ExternalLink className="h-2.5 w-2.5" aria-hidden="true" />
                          </a>
                        )}
                        <button
                          type="button"
                          onClick={() =>
                            downloadTasksAsIcs([task], {
                              includeCompleted: true,
                              filename: `${task.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'task'}.ics`,
                              nowMs,
                            })
                          }
                          aria-label={`Export "${task.title}" to .ics`}
                          className="inline-flex h-7 items-center gap-1 rounded-md border border-neutral-200 bg-white px-2.5 text-[11px] font-medium text-neutral-700 transition-colors hover:bg-neutral-50 hover:text-neutral-950 dark:border-white/15 dark:bg-[#151B26] dark:text-neutral-200 dark:hover:bg-[#1D2534] dark:hover:text-white"
                        >
                          <Download className="h-2.5 w-2.5" aria-hidden="true" />
                          <span>.ics</span>
                        </button>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end border-t border-neutral-100 px-6 py-3.5 dark:border-white/10">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-neutral-200 bg-white px-4 py-1.5 text-xs font-medium text-neutral-700 transition-colors hover:bg-neutral-50 dark:border-white/15 dark:bg-[#121720] dark:text-neutral-200 dark:hover:bg-[#19202B]"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
