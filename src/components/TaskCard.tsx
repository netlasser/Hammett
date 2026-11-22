import { useState, type DragEvent } from 'react';
import { Bell, Check, Pencil, Trash2 } from 'lucide-react';
import type { QuadrantId, Task } from '../types/task';
import { formatReminderTime, QUADRANT_META, QUADRANT_ORDER } from '../utils/matrix';

interface TaskCardProps {
  task: Task;
  nowMs: number;
  isDragging: boolean;
  onDragStart: (e: DragEvent<HTMLElement>, taskId: string) => void;
  onDragEnd: () => void;
  onDropOnTask: (e: DragEvent<HTMLElement>, targetTaskId: string) => void;
  onToggleComplete: (taskId: string) => void;
  onMoveQuadrant: (taskId: string, quadrant: QuadrantId) => void;
  onEdit: (task: Task) => void;
  onDelete: (taskId: string) => void;
  showQuadrantLabel?: boolean;
}

export function TaskCard({
  task,
  nowMs,
  isDragging,
  onDragStart,
  onDragEnd,
  onDropOnTask,
  onToggleComplete,
  onMoveQuadrant,
  onEdit,
  onDelete,
  showQuadrantLabel = false,
}: TaskCardProps) {
  const [isDragOverCard, setIsDragOverCard] = useState(false);

  const reminderLabel = formatReminderTime(task.reminderAt, nowMs);
  const isOverdue =
    !task.completed &&
    task.reminderAt !== null &&
    task.reminderAt !== undefined &&
    task.reminderAt <= nowMs;

  return (
    <article
      draggable={!task.completed}
      data-task-id={task.id}
      onDragStart={(e) => onDragStart(e, task.id)}
      onDragEnd={onDragEnd}
      onDragOver={(e) => {
        if (task.completed) return;
        e.preventDefault();
        e.stopPropagation();
        if (!isDragOverCard) setIsDragOverCard(true);
      }}
      onDragLeave={() => {
        if (isDragOverCard) setIsDragOverCard(false);
      }}
      onDrop={(e) => {
        if (task.completed) return;
        e.stopPropagation();
        setIsDragOverCard(false);
        onDropOnTask(e, task.id);
      }}
      className={`group flex flex-col gap-1.5 rounded-lg px-2.5 py-3 sm:flex-row sm:items-start sm:justify-between sm:gap-3 sm:py-2.5 transition-colors duration-150 ${
        !task.completed ? 'cursor-grab active:cursor-grabbing' : ''
      } ${
        isDragging
          ? 'bg-neutral-100 opacity-45 dark:bg-white/10'
          : isDragOverCard
            ? 'bg-sky-50/70 ring-1 ring-sky-400/50 dark:bg-sky-500/15 dark:ring-sky-400/60'
            : 'hover:bg-neutral-50 dark:hover:bg-white/[0.04]'
      }`}
    >
      <div className="flex items-start gap-3 min-w-0 flex-1">
        <button
          type="button"
          role="checkbox"
          aria-checked={task.completed}
          aria-label={
            task.completed
              ? `Mark "${task.title}" as incomplete`
              : `Mark "${task.title}" as complete`
          }
          onClick={() => onToggleComplete(task.id)}
          className={`mt-0.5 flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full border transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-neutral-900 dark:focus-visible:outline-sky-400 ${
            task.completed
              ? 'border-neutral-900 bg-neutral-900 text-white dark:border-sky-400 dark:bg-sky-400 dark:text-neutral-950'
              : 'border-neutral-300 bg-white text-transparent hover:border-neutral-500 dark:border-white/30 dark:bg-transparent dark:hover:border-sky-400'
          }`}
        >
          <Check className="h-3 w-3" strokeWidth={2.5} aria-hidden="true" />
        </button>

        <div className="min-w-0 flex-1">
          <p
            className={`text-sm leading-snug ${
              task.completed
                ? 'text-neutral-400 line-through dark:text-neutral-500'
                : 'font-medium text-neutral-900 dark:text-neutral-50'
            }`}
          >
            {task.title}
          </p>

          {task.notes && (
            <p className="mt-0.5 line-clamp-1 text-xs text-neutral-500 dark:text-neutral-400">
              {task.notes}
            </p>
          )}

          {(reminderLabel || showQuadrantLabel) && (
            <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-neutral-400 dark:text-neutral-400">
              {showQuadrantLabel && (
                <span className={`font-medium ${QUADRANT_META[task.quadrant].accentText}`}>
                  {QUADRANT_META[task.quadrant].title}
                </span>
              )}
              {showQuadrantLabel && reminderLabel && (
                <span aria-hidden="true">·</span>
              )}
              {reminderLabel && (
                <span
                  className={`inline-flex items-center gap-1 whitespace-nowrap font-mono tabular-nums ${
                    isOverdue
                      ? 'font-medium text-rose-600 dark:text-rose-400'
                      : 'text-neutral-400 dark:text-neutral-400'
                  }`}
                >
                  <Bell className="h-2.5 w-2.5 shrink-0" aria-hidden="true" />
                  <span>{reminderLabel}</span>
                </span>
              )}
            </div>
          )}
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-1 pl-[30px] sm:pl-0 opacity-100 sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100 transition-opacity duration-150">
        <div>
          <label htmlFor={`move-${task.id}`} className="sr-only">
            Move "{task.title}" to quadrant
          </label>
          <select
            id={`move-${task.id}`}
            aria-label={`Move "${task.title}" to quadrant`}
            value={task.quadrant}
            onChange={(e) => onMoveQuadrant(task.id, e.target.value as QuadrantId)}
            className="h-7 rounded-md bg-transparent px-1.5 text-[11px] font-medium text-neutral-500 transition-colors hover:bg-neutral-200/60 hover:text-neutral-900 focus:bg-neutral-200/60 focus:outline-none dark:text-neutral-300 dark:hover:bg-white/10 dark:hover:text-white dark:focus:bg-[#141922]"
          >
            {QUADRANT_ORDER.map((qId) => (
              <option key={qId} value={qId} className="dark:bg-[#0C0F14] dark:text-white">
                {QUADRANT_META[qId].title}
              </option>
            ))}
          </select>
        </div>

        <button
          type="button"
          onClick={() => onEdit(task)}
          aria-label={`Edit "${task.title}"`}
          className="inline-flex h-7 w-7 items-center justify-center rounded-md text-neutral-400 transition-colors hover:bg-neutral-200/60 hover:text-neutral-900 focus-visible:outline-2 focus-visible:outline-neutral-900 dark:text-neutral-400 dark:hover:bg-white/10 dark:hover:text-white dark:focus-visible:outline-sky-400"
        >
          <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
        </button>

        <button
          type="button"
          onClick={() => onDelete(task.id)}
          aria-label={`Delete "${task.title}"`}
          className="inline-flex h-7 w-7 items-center justify-center rounded-md text-neutral-400 transition-colors hover:bg-rose-50 hover:text-rose-600 focus-visible:outline-2 focus-visible:outline-rose-600 dark:text-neutral-400 dark:hover:bg-rose-500/15 dark:hover:text-rose-400 dark:focus-visible:outline-rose-400"
        >
          <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
        </button>
      </div>
    </article>
  );
}
