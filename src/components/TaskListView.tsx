import { BellRing, Calendar, Download, Trash2 } from 'lucide-react';
import type { AppView, QuadrantId, Task } from '../types/task';
import { TaskCard } from './TaskCard';

interface TaskListViewProps {
  view: Exclude<AppView, 'matrix'>;
  tasks: Task[];
  nowMs: number;
  searchQuery: string;
  onToggleComplete: (taskId: string) => void;
  onMoveTask: (taskId: string, quadrant: QuadrantId) => void;
  onEditTask: (task: Task) => void;
  onDeleteTask: (taskId: string) => void;
  onClearCompleted: () => void;
  onBackToMatrix: () => void;
  onTestNotification: () => void;
  onOpenCalendarSync?: () => void;
  onExportIcs?: () => void;
}

const VIEW_HEADERS: Record<
  Exclude<AppView, 'matrix'>,
  { title: string; subtitle: string; emptyTitle: string; emptyHint: string }
> = {
  today: {
    title: 'Today & Urgent Focus',
    subtitle: 'Urgent & Important tasks alongside reminders due before midnight.',
    emptyTitle: 'Clear runway for today',
    emptyHint: 'No urgent tasks or today-due reminders remain.',
  },
  reminders: {
    title: 'Scheduled Push Reminders',
    subtitle: 'Tasks with active alert timers. Notifications trigger automatically when due.',
    emptyTitle: 'No scheduled reminders',
    emptyHint: 'Set a reminder when creating a task to see it here.',
  },
  completed: {
    title: 'Completed Archive',
    subtitle: 'Finished tasks retained for review. Uncheck any task to restore it to the matrix.',
    emptyTitle: 'No completed tasks yet',
    emptyHint: 'Tasks you check off in the matrix will appear here.',
  },
};

export function TaskListView({
  view,
  tasks,
  nowMs,
  searchQuery,
  onToggleComplete,
  onMoveTask,
  onEditTask,
  onDeleteTask,
  onClearCompleted,
  onBackToMatrix,
  onTestNotification,
  onOpenCalendarSync,
  onExportIcs,
}: TaskListViewProps) {
  const header = VIEW_HEADERS[view];
  const sortedTasks = [...tasks].sort((a, b) => {
    if (view === 'reminders') {
      return (a.reminderAt ?? Number.MAX_SAFE_INTEGER) - (b.reminderAt ?? Number.MAX_SAFE_INTEGER);
    }
    return b.updatedAt - a.updatedAt;
  });

  return (
    <section
      aria-labelledby="list-view-heading"
      className="rounded-2xl border border-neutral-200/90 bg-white p-6 transition-colors duration-200 sm:p-8 dark:border-white/15 dark:bg-[#0C0F14]"
    >
      <div className="mb-6 flex flex-col gap-3 border-b border-neutral-100 pb-5 sm:flex-row sm:items-center sm:justify-between dark:border-white/10">
        <div>
          <h1 id="list-view-heading" className="font-display text-base font-semibold text-neutral-950 dark:text-white">
            {header.title}
          </h1>
          <p className="mt-0.5 text-sm text-neutral-500 dark:text-neutral-300">{header.subtitle}</p>
        </div>

        <div className="flex flex-wrap items-center gap-2 shrink-0">
          {view === 'reminders' && (
            <>
              {onExportIcs && sortedTasks.length > 0 && (
                <button
                  type="button"
                  onClick={onExportIcs}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-neutral-200 bg-white px-3.5 py-2 text-xs font-medium text-neutral-700 transition-colors hover:bg-neutral-50 whitespace-nowrap shrink-0 dark:border-white/15 dark:bg-[#121720] dark:text-neutral-100 dark:hover:border-white/25 dark:hover:bg-[#19202B]"
                >
                  <Download className="h-3.5 w-3.5 text-sky-600 dark:text-sky-400" aria-hidden="true" />
                  <span>Export .ics</span>
                </button>
              )}
              {onOpenCalendarSync && (
                <button
                  type="button"
                  onClick={onOpenCalendarSync}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-neutral-200 bg-white px-3.5 py-2 text-xs font-medium text-neutral-700 transition-colors hover:bg-neutral-50 whitespace-nowrap shrink-0 dark:border-white/15 dark:bg-[#121720] dark:text-neutral-100 dark:hover:border-white/25 dark:hover:bg-[#19202B]"
                >
                  <Calendar className="h-3.5 w-3.5 text-neutral-600 dark:text-neutral-300" aria-hidden="true" />
                  <span>Calendar Sync</span>
                </button>
              )}
              <button
                type="button"
                onClick={onTestNotification}
                className="inline-flex items-center gap-1.5 rounded-lg border border-neutral-200 bg-white px-3.5 py-2 text-xs font-medium text-neutral-700 transition-colors hover:bg-neutral-50 whitespace-nowrap shrink-0 dark:border-white/15 dark:bg-[#121720] dark:text-neutral-100 dark:hover:border-white/25 dark:hover:bg-[#19202B]"
              >
                <BellRing className="h-3.5 w-3.5 text-amber-600 dark:text-amber-400" aria-hidden="true" />
                <span>Send Test Alert</span>
              </button>
            </>
          )}

          {view === 'completed' && sortedTasks.length > 0 && (
            <button
              type="button"
              onClick={onClearCompleted}
              className="inline-flex items-center gap-1.5 rounded-lg border border-rose-200 bg-rose-50 px-3.5 py-2 text-xs font-medium text-rose-700 transition-colors hover:bg-rose-100 whitespace-nowrap shrink-0 dark:border-rose-500/35 dark:bg-rose-500/15 dark:text-rose-300 dark:hover:bg-rose-500/25"
            >
              <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
              <span>Clear Completed</span>
            </button>
          )}
        </div>
      </div>

      {sortedTasks.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-neutral-200/80 px-6 py-16 text-center dark:border-white/15">
          <p className="font-display text-sm font-medium text-neutral-900 dark:text-white">
            {searchQuery ? 'No tasks match your filter' : header.emptyTitle}
          </p>
          <p className="mt-1 max-w-md text-xs text-neutral-500 dark:text-neutral-300">{header.emptyHint}</p>
          <button
            type="button"
            onClick={onBackToMatrix}
            className="mt-5 rounded-full bg-neutral-950 px-5 py-2 text-xs font-medium text-white transition-colors hover:bg-neutral-800 dark:bg-white dark:text-neutral-950 dark:hover:bg-neutral-200"
          >
            View Eisenhower Matrix
          </button>
        </div>
      ) : (
        <div className="divide-y divide-neutral-100 dark:divide-white/10">
          {sortedTasks.map((task) => (
            <TaskCard
              key={task.id}
              task={task}
              nowMs={nowMs}
              isDragging={false}
              onDragStart={() => {}}
              onDragEnd={() => {}}
              onDropOnTask={() => {}}
              onToggleComplete={onToggleComplete}
              onMoveQuadrant={onMoveTask}
              onEdit={onEditTask}
              onDelete={onDeleteTask}
              showQuadrantLabel
            />
          ))}
        </div>
      )}
    </section>
  );
}
