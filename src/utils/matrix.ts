import type {
  AppView,
  QuadrantId,
  QuadrantMeta,
  Task,
} from '../types/task';

export const QUADRANT_META: Record<QuadrantId, QuadrantMeta> = {
  q1: {
    id: 'q1',
    code: 'Q1',
    title: 'Do First',
    subtitle: 'Urgent & Important',
    urgencyLabel: 'Urgent',
    importanceLabel: 'Important',
    accentText: 'text-rose-700 dark:text-rose-400',
    accentDot: 'bg-rose-600 dark:bg-rose-500',
    dropHighlight: 'bg-rose-50/70 ring-2 ring-rose-500/40 dark:bg-rose-500/10',
  },
  q2: {
    id: 'q2',
    code: 'Q2',
    title: 'Schedule',
    subtitle: 'Not Urgent & Important',
    urgencyLabel: 'Not Urgent',
    importanceLabel: 'Important',
    accentText: 'text-sky-700 dark:text-sky-400',
    accentDot: 'bg-sky-600 dark:bg-sky-400',
    dropHighlight: 'bg-sky-50/70 ring-2 ring-sky-500/40 dark:bg-sky-500/10',
  },
  q3: {
    id: 'q3',
    code: 'Q3',
    title: 'Delegate',
    subtitle: 'Urgent & Not Important',
    urgencyLabel: 'Urgent',
    importanceLabel: 'Not Important',
    accentText: 'text-amber-700 dark:text-amber-400',
    accentDot: 'bg-amber-600 dark:bg-amber-400',
    dropHighlight: 'bg-amber-50/70 ring-2 ring-amber-500/40 dark:bg-amber-500/10',
  },
  q4: {
    id: 'q4',
    code: 'Q4',
    title: 'Eliminate',
    subtitle: 'Not Urgent & Not Important',
    urgencyLabel: 'Not Urgent',
    importanceLabel: 'Not Important',
    accentText: 'text-slate-600 dark:text-neutral-400',
    accentDot: 'bg-slate-400 dark:bg-neutral-500',
    dropHighlight: 'bg-slate-100/80 ring-2 ring-slate-400/50 dark:bg-white/5',
  },
};

export const QUADRANT_ORDER: QuadrantId[] = ['q1', 'q2', 'q3', 'q4'];

export function createInitialSeedTasks(nowMs: number = Date.now()): Task[] {
  return [
    {
      id: 'seed-1',
      title: 'Approve Q4 production deployment checklist',
      notes: 'Verify rollback plan and database migration sign-off before 5 PM.',
      quadrant: 'q1',
      completed: false,
      createdAt: nowMs - 3600_000 * 4,
      updatedAt: nowMs - 3600_000 * 4,
      order: 0,
      reminderAt: nowMs + 60_000 * 45,
      reminderFired: false,
    },
    {
      id: 'seed-2',
      title: 'Respond to security compliance questionnaire',
      notes: 'Legal needs final sign-off before enterprise renewal closes.',
      quadrant: 'q1',
      completed: false,
      createdAt: nowMs - 3600_000 * 3,
      updatedAt: nowMs - 3600_000 * 3,
      order: 1,
      reminderAt: null,
      reminderFired: false,
    },
    {
      id: 'seed-3',
      title: 'Draft next-quarter architecture roadmap',
      notes: 'Outline service boundaries, latency targets, and hiring milestones.',
      quadrant: 'q2',
      completed: false,
      createdAt: nowMs - 3600_000 * 5,
      updatedAt: nowMs - 3600_000 * 5,
      order: 0,
      reminderAt: nowMs + 3600_000 * 4,
      reminderFired: false,
    },
    {
      id: 'seed-4',
      title: 'Schedule 1:1 career reviews with engineering leads',
      quadrant: 'q2',
      completed: false,
      createdAt: nowMs - 3600_000 * 2,
      updatedAt: nowMs - 3600_000 * 2,
      order: 1,
      reminderAt: null,
      reminderFired: false,
    },
    {
      id: 'seed-5',
      title: 'Route vendor invoice questions to finance ops',
      notes: 'Forward PO #4821 thread to Sarah for routine reconciliation.',
      quadrant: 'q3',
      completed: false,
      createdAt: nowMs - 3600_000 * 2,
      updatedAt: nowMs - 3600_000 * 2,
      order: 0,
      reminderAt: null,
      reminderFired: false,
    },
    {
      id: 'seed-6',
      title: 'Audit unused Slack webhook integrations',
      quadrant: 'q4',
      completed: false,
      createdAt: nowMs - 3600_000 * 6,
      updatedAt: nowMs - 3600_000 * 6,
      order: 0,
      reminderAt: null,
      reminderFired: false,
    },
  ];
}

export interface CreateTaskInput {
  title: string;
  notes?: string;
  quadrant: QuadrantId;
  reminderAt?: number | null;
}

export function generateTaskId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `task-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

export function computeReminderTimestamp(
  offsetMinutes: number | null | undefined,
  nowMs: number = Date.now(),
): number | null {
  if (offsetMinutes === null || offsetMinutes === undefined || !Number.isFinite(offsetMinutes)) {
    return null;
  }
  if (offsetMinutes <= 0) {
    return nowMs + 5_000;
  }
  return nowMs + Math.round(offsetMinutes * 60_000);
}

export function createTask(
  tasks: Task[],
  input: CreateTaskInput,
  nowMs: number = Date.now(),
  idOverride?: string,
): { tasks: Task[]; created: Task } {
  const trimmedTitle = input.title.trim();
  if (!trimmedTitle) {
    throw new Error('Task title cannot be empty.');
  }

  const quadrantTasks = tasks.filter((t) => t.quadrant === input.quadrant && !t.completed);
  const nextOrder =
    quadrantTasks.length > 0
      ? Math.max(...quadrantTasks.map((t) => t.order)) + 1
      : 0;

  const newTask: Task = {
    id: idOverride ?? generateTaskId(),
    title: trimmedTitle,
    notes: input.notes?.trim() ? input.notes.trim() : undefined,
    quadrant: input.quadrant,
    completed: false,
    createdAt: nowMs,
    updatedAt: nowMs,
    order: nextOrder,
    reminderAt: input.reminderAt ?? null,
    reminderFired: false,
  };

  return {
    tasks: [...tasks, newTask],
    created: newTask,
  };
}

export function normalizeQuadrantOrders(tasks: Task[], quadrant: QuadrantId): Task[] {
  const inQuadrant = tasks
    .filter((t) => t.quadrant === quadrant)
    .sort((a, b) => a.order - b.order);

  const orderMap = new Map<string, number>();
  inQuadrant.forEach((t, idx) => {
    orderMap.set(t.id, idx);
  });

  return tasks.map((t) =>
    orderMap.has(t.id) ? { ...t, order: orderMap.get(t.id)! } : t,
  );
}

export function moveTaskToQuadrant(
  tasks: Task[],
  taskId: string,
  targetQuadrant: QuadrantId,
  targetIndex?: number,
  nowMs: number = Date.now(),
): Task[] {
  const movingTask = tasks.find((t) => t.id === taskId);
  if (!movingTask) return tasks;

  const withoutMoving = tasks.filter((t) => t.id !== taskId);
  const targetList = withoutMoving
    .filter((t) => t.quadrant === targetQuadrant && !t.completed)
    .sort((a, b) => a.order - b.order);

  const clampedIndex =
    targetIndex === undefined || targetIndex < 0
      ? targetList.length
      : Math.min(targetIndex, targetList.length);

  const updatedMoving: Task = {
    ...movingTask,
    quadrant: targetQuadrant,
    updatedAt: nowMs,
  };

  const reorderedTarget = [
    ...targetList.slice(0, clampedIndex),
    updatedMoving,
    ...targetList.slice(clampedIndex),
  ].map((t, idx) => ({ ...t, order: idx }));

  const reorderedIds = new Set(reorderedTarget.map((t) => t.id));
  const others = withoutMoving.filter((t) => !reorderedIds.has(t.id));

  return normalizeQuadrantOrders([...others, ...reorderedTarget], movingTask.quadrant);
}

export function toggleTaskCompletion(
  tasks: Task[],
  taskId: string,
  nowMs: number = Date.now(),
): Task[] {
  return tasks.map((t) =>
    t.id === taskId
      ? {
          ...t,
          completed: !t.completed,
          updatedAt: nowMs,
        }
      : t,
  );
}

export function updateTask(
  tasks: Task[],
  taskId: string,
  patch: Partial<Pick<Task, 'title' | 'notes' | 'quadrant' | 'reminderAt' | 'reminderFired'>>,
  nowMs: number = Date.now(),
): Task[] {
  const target = tasks.find((t) => t.id === taskId);
  if (!target) return tasks;

  const nextTitle = patch.title !== undefined ? patch.title.trim() : target.title;
  if (!nextTitle) {
    throw new Error('Task title cannot be empty.');
  }

  let updated = tasks.map((t) => {
    if (t.id !== taskId) return t;
    const reminderChanged =
      patch.reminderAt !== undefined && patch.reminderAt !== t.reminderAt;
    return {
      ...t,
      title: nextTitle,
      notes: patch.notes !== undefined ? (patch.notes.trim() || undefined) : t.notes,
      reminderAt: patch.reminderAt !== undefined ? patch.reminderAt : t.reminderAt,
      reminderFired:
        patch.reminderFired !== undefined
          ? patch.reminderFired
          : reminderChanged
            ? false
            : t.reminderFired,
      updatedAt: nowMs,
    };
  });

  if (patch.quadrant && patch.quadrant !== target.quadrant) {
    updated = moveTaskToQuadrant(updated, taskId, patch.quadrant, undefined, nowMs);
  }

  return updated;
}

export function deleteTask(tasks: Task[], taskId: string): Task[] {
  return tasks.filter((t) => t.id !== taskId);
}

export function clearCompletedTasks(tasks: Task[]): Task[] {
  return tasks.filter((t) => !t.completed);
}

export function getQuadrantTasks(
  tasks: Task[],
  quadrant: QuadrantId,
  includeCompleted = false,
): Task[] {
  return tasks
    .filter((t) => t.quadrant === quadrant && (includeCompleted || !t.completed))
    .sort((a, b) => a.order - b.order);
}

export function filterTasks(
  tasks: Task[],
  query: string,
  view: AppView,
  nowMs: number = Date.now(),
): Task[] {
  const q = query.trim().toLowerCase();
  const endOfToday = new Date(nowMs);
  endOfToday.setHours(23, 59, 59, 999);
  const endOfTodayMs = endOfToday.getTime();

  return tasks.filter((task) => {
    if (view === 'completed') {
      if (!task.completed) return false;
    } else if (view === 'today') {
      if (task.completed) return false;
      const isUrgentImportant = task.quadrant === 'q1';
      const isDueToday = task.reminderAt != null && task.reminderAt <= endOfTodayMs;
      if (!isUrgentImportant && !isDueToday) return false;
    } else if (view === 'reminders') {
      if (task.completed || task.reminderAt == null) return false;
    } else {
      if (task.completed) return false;
    }

    if (!q) return true;
    return (
      task.title.toLowerCase().includes(q) ||
      (task.notes ? task.notes.toLowerCase().includes(q) : false)
    );
  });
}

export function getDueReminders(tasks: Task[], nowMs: number = Date.now()): Task[] {
  return tasks.filter(
    (t) =>
      !t.completed &&
      t.reminderAt !== null &&
      t.reminderAt !== undefined &&
      t.reminderAt <= nowMs &&
      !t.reminderFired,
  );
}

export function markReminderFired(tasks: Task[], taskId: string): Task[] {
  return tasks.map((t) => (t.id === taskId ? { ...t, reminderFired: true } : t));
}

export function snoozeTaskReminder(
  tasks: Task[],
  taskId: string,
  minutes: number,
  nowMs: number = Date.now(),
): Task[] {
  return tasks.map((t) =>
    t.id === taskId
      ? {
          ...t,
          reminderAt: nowMs + minutes * 60_000,
          reminderFired: false,
          updatedAt: nowMs,
        }
      : t,
  );
}

export function formatReminderTime(reminderAt: number | null | undefined, nowMs: number = Date.now()): string {
  if (!reminderAt) return '';
  const diffMs = reminderAt - nowMs;
  const timeStr = new Date(reminderAt).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
  });

  if (diffMs < -60_000) {
    return `Overdue · ${timeStr}`;
  }
  if (diffMs <= 60_000) {
    return `Due now · ${timeStr}`;
  }
  const mins = Math.round(diffMs / 60_000);
  if (mins < 60) {
    return `In ${mins}m · ${timeStr}`;
  }
  const hours = Math.round(mins / 60);
  if (hours < 24) {
    return `In ${hours}h · ${timeStr}`;
  }
  const dateStr = new Date(reminderAt).toLocaleDateString([], {
    month: 'short',
    day: 'numeric',
  });
  return `${dateStr} · ${timeStr}`;
}
