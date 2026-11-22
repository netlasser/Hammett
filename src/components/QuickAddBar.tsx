import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Bell, BellRing, Calendar, Plus, Search, X } from 'lucide-react';
import type { QuadrantId } from '../types/task';
import type { PushPermissionState } from '../utils/notifications';
import { computeReminderTimestamp, QUADRANT_META, QUADRANT_ORDER } from '../utils/matrix';

interface QuickAddBarProps {
  onAddTask: (input: {
    title: string;
    quadrant: QuadrantId;
    reminderAt: number | null;
  }) => void;
  searchQuery: string;
  onSearchChange: (q: string) => void;
  notificationPermission: PushPermissionState;
  onEnableNotifications: () => void;
  onTestNotification: () => void;
  onOpenCalendarSync: () => void;
}

const REMINDER_PRESETS: { value: string; label: string; minutes: number | null }[] = [
  { value: 'none', label: 'No reminder', minutes: null },
  { value: '1', label: 'In 1m', minutes: 1 },
  { value: '15', label: 'In 15m', minutes: 15 },
  { value: '60', label: 'In 1h', minutes: 60 },
  { value: '180', label: 'In 3h', minutes: 180 },
];

export function QuickAddBar({
  onAddTask,
  searchQuery,
  onSearchChange,
  notificationPermission,
  onEnableNotifications,
  onTestNotification,
  onOpenCalendarSync,
}: QuickAddBarProps) {
  const [title, setTitle] = useState('');
  const [quadrant, setQuadrant] = useState<QuadrantId>('q1');
  const [reminderPreset, setReminderPreset] = useState<string>('none');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [alertsMenuOpen, setAlertsMenuOpen] = useState(false);

  const alertsMenuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!alertsMenuOpen) return;
    const onOutsideClick = (e: MouseEvent) => {
      if (alertsMenuRef.current && !alertsMenuRef.current.contains(e.target as Node)) {
        setAlertsMenuOpen(false);
      }
    };
    const onEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setAlertsMenuOpen(false);
    };
    document.addEventListener('mousedown', onOutsideClick);
    window.addEventListener('keydown', onEscape);
    return () => {
      document.removeEventListener('mousedown', onOutsideClick);
      window.removeEventListener('keydown', onEscape);
    };
  }, [alertsMenuOpen]);

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    const trimmed = title.trim();
    if (!trimmed) {
      setErrorMsg('Enter a task title before adding.');
      return;
    }
    const preset = REMINDER_PRESETS.find((p) => p.value === reminderPreset);
    const reminderAt = computeReminderTimestamp(preset?.minutes ?? null);
    onAddTask({
      title: trimmed,
      quadrant,
      reminderAt,
    });
    setTitle('');
    setReminderPreset('none');
    setErrorMsg(null);
  };

  return (
    <section
      aria-label="Task creation and workspace controls"
      className="mx-auto max-w-[1320px] px-5 pt-6 pb-2 sm:px-8"
    >
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <form
          onSubmit={handleSubmit}
          className="flex flex-1 flex-col gap-2 rounded-xl border border-neutral-200/90 bg-white p-1.5 sm:flex-row sm:items-center focus-within:border-neutral-400 transition-colors dark:border-white/15 dark:bg-[#0C0F14] dark:focus-within:border-sky-400/60"
          noValidate
        >
          <div className="flex-1 min-w-0">
            <label htmlFor="quick-add-title" className="sr-only">
              New task title
            </label>
            <input
              id="quick-add-title"
              type="text"
              value={title}
              onChange={(e) => {
                setTitle(e.target.value);
                if (errorMsg) setErrorMsg(null);
              }}
              placeholder="Add a task..."
              className="w-full bg-transparent px-3 py-1.5 text-sm text-neutral-900 placeholder:text-neutral-400 focus:outline-none dark:text-white dark:placeholder:text-neutral-500"
            />
          </div>

          <div className="flex flex-wrap items-center gap-1.5 border-t border-neutral-100 pt-1.5 sm:border-t-0 sm:border-l sm:border-neutral-100 sm:pl-2 sm:pt-0 sm:flex-nowrap dark:border-white/10">
            <div>
              <label htmlFor="quick-add-quadrant" className="sr-only">
                Eisenhower quadrant
              </label>
              <select
                id="quick-add-quadrant"
                value={quadrant}
                onChange={(e) => setQuadrant(e.target.value as QuadrantId)}
                className="h-8 rounded-lg bg-transparent px-2 text-xs font-medium text-neutral-600 transition-colors hover:bg-neutral-100 hover:text-neutral-900 focus:bg-neutral-100 focus:outline-none dark:text-neutral-300 dark:hover:bg-white/10 dark:hover:text-white dark:focus:bg-[#141922]"
              >
                {QUADRANT_ORDER.map((qId) => (
                  <option key={qId} value={qId} className="dark:bg-[#0C0F14] dark:text-white">
                    {QUADRANT_META[qId].title}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label htmlFor="quick-add-reminder" className="sr-only">
                Reminder time
              </label>
              <select
                id="quick-add-reminder"
                value={reminderPreset}
                onChange={(e) => setReminderPreset(e.target.value)}
                className="h-8 rounded-lg bg-transparent px-2 text-xs text-neutral-500 transition-colors hover:bg-neutral-100 hover:text-neutral-900 focus:bg-neutral-100 focus:outline-none dark:text-neutral-400 dark:hover:bg-white/10 dark:hover:text-white dark:focus:bg-[#141922]"
              >
                {REMINDER_PRESETS.map((preset) => (
                  <option key={preset.value} value={preset.value} className="dark:bg-[#0C0F14] dark:text-white">
                    {preset.label}
                  </option>
                ))}
              </select>
            </div>

            <button
              type="submit"
              className="ml-auto inline-flex h-8 items-center gap-1.5 rounded-lg bg-neutral-950 px-3.5 text-xs font-medium text-white transition-colors hover:bg-neutral-800 whitespace-nowrap shrink-0 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-neutral-900 dark:bg-white dark:text-neutral-950 dark:hover:bg-neutral-200 dark:focus-visible:outline-sky-400"
            >
              <Plus className="h-3.5 w-3.5" aria-hidden="true" />
              <span>Add Task</span>
            </button>
          </div>
        </form>

        <div className="flex items-center gap-2 shrink-0">
          <div className="relative flex-1 sm:w-52 sm:flex-none">
            <Search
              className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-neutral-400 dark:text-neutral-500"
              aria-hidden="true"
            />
            <label htmlFor="task-search" className="sr-only">
              Filter tasks
            </label>
            <input
              id="task-search"
              type="search"
              value={searchQuery}
              onChange={(e) => onSearchChange(e.target.value)}
              placeholder="Filter..."
              className="h-10 w-full rounded-xl border border-neutral-200/90 bg-white pl-8 pr-8 text-sm text-neutral-900 placeholder:text-neutral-400 focus:border-neutral-400 focus:outline-none dark:border-white/15 dark:bg-[#0C0F14] dark:text-white dark:placeholder:text-neutral-500 dark:focus:border-sky-400/60"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => onSearchChange('')}
                aria-label="Clear task filter"
                className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded p-0.5 text-neutral-400 hover:text-neutral-700 dark:text-neutral-400 dark:hover:text-white"
              >
                <X className="h-3.5 w-3.5" aria-hidden="true" />
              </button>
            )}
          </div>

          <div ref={alertsMenuRef} className="relative shrink-0">
            <button
              type="button"
              onClick={() => setAlertsMenuOpen((prev) => !prev)}
              aria-expanded={alertsMenuOpen}
              aria-haspopup="true"
              aria-label="Push notification settings"
              className="inline-flex h-10 items-center gap-2 rounded-xl border border-neutral-200/90 bg-white px-3.5 text-xs font-medium text-neutral-700 transition-colors hover:border-neutral-300 hover:text-neutral-950 whitespace-nowrap shrink-0 focus-visible:outline-2 focus-visible:outline-neutral-900 dark:border-white/15 dark:bg-[#0C0F14] dark:text-neutral-200 dark:hover:border-white/30 dark:hover:text-white dark:focus-visible:outline-sky-400"
            >
              <Bell className="h-3.5 w-3.5 text-neutral-500 dark:text-neutral-400" aria-hidden="true" />
              <span>Alerts</span>
            </button>

            {alertsMenuOpen && (
              <div
                role="menu"
                aria-label="Notification actions"
                className="absolute right-0 z-40 mt-2 w-60 rounded-xl border border-neutral-200 bg-white p-2 shadow-lg dark:border-white/15 dark:bg-[#0F131A] dark:shadow-2xl"
              >
                <div className="px-2.5 py-2 text-xs text-neutral-500 border-b border-neutral-100 dark:border-white/10 dark:text-neutral-400">
                  {notificationPermission === 'granted'
                    ? 'Browser push notifications are active.'
                    : notificationPermission === 'denied'
                      ? 'Browser push is blocked; in-app alerts stay active.'
                      : notificationPermission === 'unsupported'
                        ? 'In-app reminder alerts active.'
                        : 'Enable browser alerts for background reminders.'}
                </div>

                {notificationPermission !== 'granted' && (
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      onEnableNotifications();
                      setAlertsMenuOpen(false);
                    }}
                    disabled={notificationPermission === 'unsupported'}
                    className="mt-1 flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-xs font-medium text-neutral-700 transition-colors hover:bg-neutral-100 disabled:opacity-50 dark:text-neutral-200 dark:hover:bg-white/10"
                  >
                    <Bell className="h-3.5 w-3.5 text-neutral-500 dark:text-neutral-400" aria-hidden="true" />
                    <span>
                      {notificationPermission === 'denied' ? 'Push Blocked Info' : 'Enable Browser Push'}
                    </span>
                  </button>
                )}

                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    onTestNotification();
                    setAlertsMenuOpen(false);
                  }}
                  className="mt-0.5 flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-xs font-medium text-neutral-700 transition-colors hover:bg-neutral-100 dark:text-neutral-200 dark:hover:bg-white/10"
                >
                  <BellRing className="h-3.5 w-3.5 text-amber-600 dark:text-amber-400" aria-hidden="true" />
                  <span>Send Test Alert</span>
                </button>

                <div className="my-1 border-t border-neutral-100 dark:border-white/10" />

                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    onOpenCalendarSync();
                    setAlertsMenuOpen(false);
                  }}
                  className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-xs font-medium text-neutral-700 transition-colors hover:bg-neutral-100 dark:text-neutral-200 dark:hover:bg-white/10"
                >
                  <Calendar className="h-3.5 w-3.5 text-sky-600 dark:text-sky-400" aria-hidden="true" />
                  <span>Calendar Sync &amp; .ics</span>
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {errorMsg && (
        <p role="alert" className="mt-2 px-1 text-xs font-medium text-rose-600 dark:text-rose-400">
          {errorMsg}
        </p>
      )}
    </section>
  );
}
