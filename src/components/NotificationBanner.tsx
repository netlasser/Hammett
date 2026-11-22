import { BellRing, Check, Clock, X } from 'lucide-react';
import type { NotificationAlert } from '../types/task';
import { QUADRANT_META } from '../utils/matrix';

interface NotificationBannerProps {
  alerts: NotificationAlert[];
  onDismiss: (alertId: string) => void;
  onCompleteTask: (taskId: string, alertId: string) => void;
  onSnoozeTask: (taskId: string, alertId: string) => void;
}

export function NotificationBanner({
  alerts,
  onDismiss,
  onCompleteTask,
  onSnoozeTask,
}: NotificationBannerProps) {
  if (alerts.length === 0) return null;

  return (
    <aside
      aria-label="Active reminders"
      aria-live="polite"
      className="fixed bottom-4 right-4 z-40 flex w-full max-w-sm flex-col gap-2.5 px-4 transition-all sm:px-0"
    >
      {alerts.map((alert) => (
        <div
          key={alert.id}
          role="status"
          className="rounded-2xl border border-neutral-200 bg-white p-4 shadow-lg dark:border-white/15 dark:bg-[#0F131A] dark:shadow-2xl"
        >
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-start gap-2.5 min-w-0">
              <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-neutral-100 text-neutral-700 dark:bg-sky-400/15 dark:text-sky-300">
                <BellRing className="h-3.5 w-3.5" aria-hidden="true" />
              </div>
              <div className="min-w-0">
                <p className="text-sm font-medium text-neutral-950 dark:text-white">{alert.title}</p>
                <p className="mt-0.5 text-xs text-neutral-500 dark:text-neutral-300">{alert.body}</p>
                {alert.quadrant && (
                  <p className={`mt-1 text-[11px] font-medium ${QUADRANT_META[alert.quadrant].accentText}`}>
                    {QUADRANT_META[alert.quadrant].title}
                  </p>
                )}
              </div>
            </div>

            <button
              type="button"
              onClick={() => onDismiss(alert.id)}
              aria-label={`Dismiss alert "${alert.title}"`}
              className="rounded-md p-1 text-neutral-400 hover:bg-neutral-100 hover:text-neutral-800 dark:hover:bg-white/10 dark:hover:text-white"
            >
              <X className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
          </div>

          {alert.taskId && (
            <div className="mt-3 flex items-center gap-2 border-t border-neutral-100 pt-2.5 dark:border-white/10">
              <button
                type="button"
                onClick={() => onCompleteTask(alert.taskId!, alert.id)}
                className="inline-flex items-center gap-1 rounded-lg bg-neutral-950 px-2.5 py-1 text-xs font-medium text-white hover:bg-neutral-800 dark:bg-white dark:text-neutral-950 dark:hover:bg-neutral-200"
              >
                <Check className="h-3 w-3" aria-hidden="true" />
                <span>Mark Done</span>
              </button>
              <button
                type="button"
                onClick={() => onSnoozeTask(alert.taskId!, alert.id)}
                className="inline-flex items-center gap-1 rounded-lg border border-neutral-200 bg-white px-2.5 py-1 text-xs font-medium text-neutral-700 hover:bg-neutral-50 dark:border-white/15 dark:bg-[#141922] dark:text-neutral-200 dark:hover:bg-[#1B222E]"
              >
                <Clock className="h-3 w-3" aria-hidden="true" />
                <span>Snooze 10m</span>
              </button>
            </div>
          )}
        </div>
      ))}
    </aside>
  );
}
