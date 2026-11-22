import { useState, type DragEvent } from 'react';
import { Plus } from 'lucide-react';
import type { QuadrantId, Task } from '../types/task';
import { getQuadrantTasks, QUADRANT_META, QUADRANT_ORDER } from '../utils/matrix';
import { TaskCard } from './TaskCard';

interface EisenhowerMatrixProps {
  tasks: Task[];
  nowMs: number;
  searchQuery: string;
  onMoveTask: (taskId: string, targetQuadrant: QuadrantId, targetIndex?: number) => void;
  onToggleComplete: (taskId: string) => void;
  onEditTask: (task: Task) => void;
  onDeleteTask: (taskId: string) => void;
  onCreateInQuadrant: (quadrant: QuadrantId) => void;
}

export function EisenhowerMatrix({
  tasks,
  nowMs,
  searchQuery,
  onMoveTask,
  onToggleComplete,
  onEditTask,
  onDeleteTask,
  onCreateInQuadrant,
}: EisenhowerMatrixProps) {
  const [draggingTaskId, setDraggingTaskId] = useState<string | null>(null);
  const [dragOverQuadrant, setDragOverQuadrant] = useState<QuadrantId | null>(null);

  const handleDragStart = (e: DragEvent<HTMLElement>, taskId: string) => {
    setDraggingTaskId(taskId);
    e.dataTransfer.setData('text/plain', taskId);
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleDragEnd = () => {
    setDraggingTaskId(null);
    setDragOverQuadrant(null);
  };

  const handleDropOnQuadrant = (e: DragEvent<HTMLElement>, targetQuadrant: QuadrantId) => {
    e.preventDefault();
    const droppedId = e.dataTransfer.getData('text/plain') || draggingTaskId;
    setDragOverQuadrant(null);
    setDraggingTaskId(null);
    if (!droppedId) return;
    onMoveTask(droppedId, targetQuadrant);
  };

  const handleDropOnTask = (
    e: DragEvent<HTMLElement>,
    targetQuadrant: QuadrantId,
    targetTaskId: string,
  ) => {
    e.preventDefault();
    const droppedId = e.dataTransfer.getData('text/plain') || draggingTaskId;
    setDragOverQuadrant(null);
    setDraggingTaskId(null);
    if (!droppedId || droppedId === targetTaskId) return;

    const quadrantTasks = getQuadrantTasks(tasks, targetQuadrant);
    const targetIndex = quadrantTasks.findIndex((t) => t.id === targetTaskId);
    onMoveTask(droppedId, targetQuadrant, targetIndex >= 0 ? targetIndex : undefined);
  };

  const renderQuadrant = (qId: QuadrantId, borderClasses: string) => {
    const meta = QUADRANT_META[qId];
    const qTasks = getQuadrantTasks(tasks, qId);
    const isOver = dragOverQuadrant === qId;

    return (
      <section
        key={qId}
        aria-labelledby={`quadrant-heading-${qId}`}
        data-quadrant={qId}
        onDragOver={(e) => {
          e.preventDefault();
          e.dataTransfer.dropEffect = 'move';
          if (dragOverQuadrant !== qId) setDragOverQuadrant(qId);
        }}
        onDragLeave={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node)) {
            setDragOverQuadrant(null);
          }
        }}
        onDrop={(e) => handleDropOnQuadrant(e, qId)}
        className={`flex min-h-[290px] flex-col p-5 sm:p-6 transition-colors ${borderClasses} ${
          isOver
            ? 'bg-neutral-50/90 dark:bg-sky-500/[0.08]'
            : 'bg-white dark:bg-[#0C0F14]'
        }`}
      >
        <div className="mb-4 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5 min-w-0">
            <span
              aria-hidden="true"
              className={`h-2 w-2 shrink-0 rounded-full ${meta.accentDot}`}
            />
            <h2
              id={`quadrant-heading-${qId}`}
              className="font-display text-sm font-semibold text-neutral-900 truncate dark:text-white"
            >
              {meta.title}
            </h2>
            <span className="hidden sm:inline text-xs text-neutral-400 truncate dark:text-neutral-400">
              · {meta.subtitle}
            </span>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <span className="font-mono text-xs tabular-nums text-neutral-400 dark:text-neutral-400">
              {qTasks.length}
            </span>
            <button
              type="button"
              onClick={() => onCreateInQuadrant(qId)}
              aria-label={`Add task to ${meta.title}`}
              className="inline-flex h-7 w-7 items-center justify-center rounded-lg text-neutral-400 transition-colors hover:bg-neutral-100 hover:text-neutral-900 focus-visible:outline-2 focus-visible:outline-neutral-900 dark:text-neutral-400 dark:hover:bg-white/10 dark:hover:text-white dark:focus-visible:outline-sky-400"
            >
              <Plus className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
          </div>
        </div>

        {qTasks.length === 0 ? (
          <div className="flex flex-1 flex-col items-center justify-center rounded-xl border border-dashed border-neutral-200/80 px-4 py-10 text-center dark:border-white/12">
            <p className="text-xs text-neutral-400 dark:text-neutral-500">
              {searchQuery ? 'No matching tasks' : 'Drop a task here'}
            </p>
          </div>
        ) : (
          <div className="flex flex-1 flex-col divide-y divide-neutral-100 dark:divide-white/[0.08]">
            {qTasks.map((task) => (
              <TaskCard
                key={task.id}
                task={task}
                nowMs={nowMs}
                isDragging={draggingTaskId === task.id}
                onDragStart={handleDragStart}
                onDragEnd={handleDragEnd}
                onDropOnTask={(e, targetTaskId) =>
                  handleDropOnTask(e, qId, targetTaskId)
                }
                onToggleComplete={onToggleComplete}
                onMoveQuadrant={(id, nextQ) => onMoveTask(id, nextQ)}
                onEdit={onEditTask}
                onDelete={onDeleteTask}
              />
            ))}
          </div>
        )}
      </section>
    );
  };

  return (
    <div className="space-y-2.5">
      <div className="hidden lg:grid lg:grid-cols-[20px_1fr_1fr] lg:gap-4 px-1">
        <div aria-hidden="true" />
        <div className="text-center text-[11px] font-medium tracking-wide text-neutral-400 dark:text-neutral-400">
          Urgent
        </div>
        <div className="text-center text-[11px] font-medium tracking-wide text-neutral-400 dark:text-neutral-400">
          Not Urgent
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[20px_1fr] lg:gap-3">
        <div className="hidden lg:grid lg:grid-rows-2">
          <div className="flex items-center justify-center">
            <span className="-rotate-90 whitespace-nowrap text-[11px] font-medium tracking-wide text-neutral-400 dark:text-neutral-400">
              Important
            </span>
          </div>
          <div className="flex items-center justify-center">
            <span className="-rotate-90 whitespace-nowrap text-[11px] font-medium tracking-wide text-neutral-400 dark:text-neutral-400">
              Not Important
            </span>
          </div>
        </div>

        <div className="grid grid-cols-1 overflow-hidden rounded-2xl border border-neutral-200/90 bg-white lg:grid-cols-2 dark:border-white/15 dark:bg-[#0C0F14]">
          {renderQuadrant(QUADRANT_ORDER[0], 'border-b border-neutral-200/80 lg:border-r dark:border-white/12')}
          {renderQuadrant(QUADRANT_ORDER[1], 'border-b border-neutral-200/80 dark:border-white/12')}
          {renderQuadrant(QUADRANT_ORDER[2], 'border-b border-neutral-200/80 lg:border-b-0 lg:border-r dark:border-white/12')}
          {renderQuadrant(QUADRANT_ORDER[3], '')}
        </div>
      </div>
    </div>
  );
}
