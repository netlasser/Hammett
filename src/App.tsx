import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CalendarSyncModal } from './components/CalendarSyncModal';
import { EisenhowerMatrix } from './components/EisenhowerMatrix';
import { NotificationBanner } from './components/NotificationBanner';
import { QuickAddBar } from './components/QuickAddBar';
import { TaskListView } from './components/TaskListView';
import { TaskModal } from './components/TaskModal';
import { TopBar } from './components/TopBar';
import type {
  AppView,
  NotificationAlert,
  QuadrantId,
  Task,
} from './types/task';
import { playJarvisChime } from './utils/audio';
import { downloadTasksAsIcs } from './utils/calendarSync';
import {
  clearCompletedTasks,
  createInitialSeedTasks,
  createTask,
  deleteTask,
  filterTasks,
  getDueReminders,
  markReminderFired,
  moveTaskToQuadrant,
  QUADRANT_META,
  snoozeTaskReminder,
  toggleTaskCompletion,
  updateTask,
} from './utils/matrix';
import {
  getNotificationPermission,
  requestNotificationPermission,
  sendBrowserNotification,
  type PushPermissionState,
} from './utils/notifications';

const STORAGE_KEY = 'arcmatrix_tasks_v1';
const THEME_STORAGE_KEY = 'arcmatrix_theme_v1';
const CALENDAR_FEED_KEY = 'arcmatrix_calendar_feed_v1';

type ThemeMode = 'light' | 'dark';

function loadInitialFeedId(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    const saved = window.localStorage.getItem(CALENDAR_FEED_KEY);
    return saved && /^[a-zA-Z0-9_-]{8,64}$/.test(saved) ? saved : null;
  } catch {
    return null;
  }
}

function loadInitialTheme(): ThemeMode {
  if (typeof window === 'undefined') return 'light';
  try {
    const saved = window.localStorage.getItem(THEME_STORAGE_KEY);
    if (saved === 'dark' || saved === 'light') return saved;
  } catch {
    // ignore storage access errors
  }
  return 'light';
}

function loadInitialTasks(): Task[] {
  if (typeof window === 'undefined') {
    return createInitialSeedTasks();
  }
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return createInitialSeedTasks();
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return parsed;
    }
  } catch {
    // ignore corrupted storage
  }
  return createInitialSeedTasks();
}

export default function App() {
  const [tasks, setTasks] = useState<Task[]>(loadInitialTasks);
  const [theme, setTheme] = useState<ThemeMode>(loadInitialTheme);
  const [activeView, setActiveView] = useState<AppView>('matrix');
  const [searchQuery, setSearchQuery] = useState('');
  const [nowMs, setNowMs] = useState<number>(() => Date.now());

  const [modalOpen, setModalOpen] = useState(false);
  const [editingTask, setEditingTask] = useState<Task | null>(null);
  const [modalDefaultQuadrant, setModalDefaultQuadrant] = useState<QuadrantId>('q1');

  const [calendarModalOpen, setCalendarModalOpen] = useState(false);
  const [calendarFeedId, setCalendarFeedId] = useState<string | null>(loadInitialFeedId);
  const [includeCompletedInFeed, setIncludeCompletedInFeed] = useState(false);
  const [feedSyncing, setFeedSyncing] = useState(false);
  const [feedLastSyncedAt, setFeedLastSyncedAt] = useState<number | null>(null);

  const [notificationPermission, setNotificationPermission] =
    useState<PushPermissionState>(() => getNotificationPermission());
  const [alerts, setAlerts] = useState<NotificationAlert[]>([]);

  const tasksRef = useRef(tasks);
  useEffect(() => {
    tasksRef.current = tasks;
  }, [tasks]);

  // Sync Tailwind dark class and persist theme preference
  useEffect(() => {
    const root = document.documentElement;
    if (theme === 'dark') {
      root.classList.add('dark');
    } else {
      root.classList.remove('dark');
    }
    try {
      window.localStorage.setItem(THEME_STORAGE_KEY, theme);
    } catch {
      // ignore storage quota errors
    }
  }, [theme]);

  // Persist tasks to localStorage
  useEffect(() => {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(tasks));
    } catch {
      // ignore storage quota errors
    }
  }, [tasks]);

  // Poll reminders every 5 seconds & keep relative time labels fresh
  useEffect(() => {
    const checkReminders = () => {
      const current = Date.now();
      setNowMs(current);

      const due = getDueReminders(tasksRef.current, current);
      if (due.length === 0) return;

      due.forEach((task) => {
        const qMeta = QUADRANT_META[task.quadrant];
        const body = `${qMeta.code} · ${qMeta.title}${task.notes ? ` — ${task.notes}` : ''}`;
        sendBrowserNotification(`Reminder: ${task.title}`, body, `task-${task.id}`);
        setAlerts((prev) => [
          {
            id: `alert-${task.id}-${current}`,
            taskId: task.id,
            title: task.title,
            body: 'Scheduled reminder is due now.',
            quadrant: task.quadrant,
            triggeredAt: current,
          },
          ...prev.slice(0, 3),
        ]);
      });

      playJarvisChime('reminder');
      setTasks((prev) => {
        let updated = prev;
        for (const task of due) {
          updated = markReminderFired(updated, task.id);
        }
        return updated;
      });
    };

    checkReminders();
    const interval = window.setInterval(checkReminders, 5_000);
    return () => window.clearInterval(interval);
  }, []);

  const handleQuickAdd = useCallback(
    (input: { title: string; quadrant: QuadrantId; reminderAt: number | null }) => {
      setTasks((prev) => createTask(prev, input).tasks);
    },
    [],
  );

  const handleMoveTask = useCallback(
    (taskId: string, targetQuadrant: QuadrantId, targetIndex?: number) => {
      setTasks((prev) => moveTaskToQuadrant(prev, taskId, targetQuadrant, targetIndex));
    },
    [],
  );

  const handleToggleComplete = useCallback((taskId: string) => {
    setTasks((prev) => toggleTaskCompletion(prev, taskId));
  }, []);

  const handleDeleteTask = useCallback((taskId: string) => {
    setTasks((prev) => deleteTask(prev, taskId));
  }, []);

  const handleClearCompleted = useCallback(() => {
    setTasks((prev) => clearCompletedTasks(prev));
  }, []);

  const handleOpenCreateModal = useCallback((quadrant: QuadrantId) => {
    setEditingTask(null);
    setModalDefaultQuadrant(quadrant);
    setModalOpen(true);
  }, []);

  const handleOpenEditModal = useCallback((task: Task) => {
    setEditingTask(task);
    setModalDefaultQuadrant(task.quadrant);
    setModalOpen(true);
  }, []);

  const handleSaveModal = useCallback(
    (data: {
      id?: string;
      title: string;
      notes: string;
      quadrant: QuadrantId;
      reminderAt: number | null;
    }) => {
      if (data.id) {
        setTasks((prev) =>
          updateTask(prev, data.id!, {
            title: data.title,
            notes: data.notes,
            quadrant: data.quadrant,
            reminderAt: data.reminderAt,
          }),
        );
      } else {
        setTasks((prev) =>
          createTask(prev, {
            title: data.title,
            notes: data.notes,
            quadrant: data.quadrant,
            reminderAt: data.reminderAt,
          }).tasks,
        );
      }
    },
    [],
  );

  const handleEnableNotifications = useCallback(async () => {
    const result = await requestNotificationPermission();
    setNotificationPermission(result);
    if (result === 'granted') {
      sendBrowserNotification(
        'ArcMatrix Push Alerts Active',
        'You will receive reminders when scheduled tasks come due.',
      );
      setAlerts((prev) => [
        {
          id: `perm-granted-${Date.now()}`,
          title: 'Browser Push Enabled',
          body: 'You will receive desktop notifications when reminders come due.',
          triggeredAt: Date.now(),
          isTest: true,
        },
        ...prev.slice(0, 3),
      ]);
    } else if (result === 'denied') {
      setAlerts((prev) => [
        {
          id: `perm-denied-${Date.now()}`,
          title: 'Browser Push Blocked',
          body: 'Allow notifications in your browser site settings for OS banners. In-app reminder banners remain active.',
          triggeredAt: Date.now(),
          isTest: true,
        },
        ...prev.slice(0, 3),
      ]);
    }
  }, []);

  const handleTestNotification = useCallback(async () => {
    let perm = getNotificationPermission();
    if (perm === 'default') {
      perm = await requestNotificationPermission();
      setNotificationPermission(perm);
    }
    const now = Date.now();
    const sentNative = sendBrowserNotification(
      'ArcMatrix Reminder Check',
      'Push notifications are armed and ready for your Eisenhower tasks.',
      `test-${now}`,
    );
    playJarvisChime('reminder');
    setAlerts((prev) => [
      {
        id: `test-${now}`,
        title: 'Push Reminder Check',
        body: sentNative
          ? 'Browser notification dispatched and in-app alerts are active.'
          : 'In-app reminder alerts are active. Grant browser notification permission for OS banners.',
        triggeredAt: now,
        isTest: true,
      },
      ...prev.slice(0, 3),
    ]);
  }, []);

  const syncCalendarFeed = useCallback(
    async (feedIdOverride?: string | null, includeCompletedOverride?: boolean) => {
      setFeedSyncing(true);
      try {
        const res = await fetch('/api/calendar/feed', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            feedId: feedIdOverride ?? calendarFeedId ?? undefined,
            includeCompleted: includeCompletedOverride ?? includeCompletedInFeed,
            tasks: tasksRef.current
              .filter((t) => t.reminderAt !== null && t.reminderAt !== undefined)
              .map((t) => ({
                id: t.id,
                title: t.title,
                notes: t.notes,
                quadrant: t.quadrant,
                completed: t.completed,
                updatedAt: t.updatedAt,
                reminderAt: t.reminderAt,
              })),
          }),
        });
        if (!res.ok) {
          throw new Error('Failed to sync live calendar feed.');
        }
        const data = (await res.json()) as { feedId: string; syncedAt: number };
        setCalendarFeedId(data.feedId);
        setFeedLastSyncedAt(data.syncedAt);
        try {
          window.localStorage.setItem(CALENDAR_FEED_KEY, data.feedId);
        } catch {
          // ignore storage quota errors
        }
      } finally {
        setFeedSyncing(false);
      }
    },
    [calendarFeedId, includeCompletedInFeed],
  );

  // Auto-sync live ICS feed whenever tasks or feed inclusion setting change
  useEffect(() => {
    if (!calendarFeedId) return;
    const timer = window.setTimeout(() => {
      void syncCalendarFeed(calendarFeedId, includeCompletedInFeed).catch(() => {
        // silent background retry on next change
      });
    }, 400);
    return () => window.clearTimeout(timer);
  }, [tasks, calendarFeedId, includeCompletedInFeed, syncCalendarFeed]);

  const handleExportAllIcs = useCallback(() => {
    const result = downloadTasksAsIcs(tasksRef.current, {
      includeCompleted: includeCompletedInFeed,
      filename: 'arcmatrix-deadlines.ics',
      nowMs: Date.now(),
    });
    if (result.exportedCount > 0) {
      setAlerts((prev) => [
        {
          id: `ics-export-${Date.now()}`,
          title: 'Calendar Export Ready',
          body: `Exported ${result.exportedCount} deadline${result.exportedCount === 1 ? '' : 's'} to ${result.filename}.`,
          triggeredAt: Date.now(),
          isTest: true,
        },
        ...prev.slice(0, 3),
      ]);
    }
  }, [includeCompletedInFeed]);

  const counts = useMemo(() => {
    const active = tasks.filter((t) => !t.completed).length;
    const today = filterTasks(tasks, '', 'today', nowMs).length;
    const reminders = filterTasks(tasks, '', 'reminders', nowMs).length;
    const completed = tasks.filter((t) => t.completed).length;
    return { active, today, reminders, completed };
  }, [tasks, nowMs]);

  const visibleTasks = useMemo(
    () => filterTasks(tasks, searchQuery, activeView, nowMs),
    [tasks, searchQuery, activeView, nowMs],
  );

  return (
    <div
      id="top"
      className="min-h-screen bg-neutral-50/80 text-neutral-950 transition-colors duration-200 dark:bg-[#050608] dark:text-neutral-50"
    >
      <TopBar
        activeView={activeView}
        onSelectView={setActiveView}
        theme={theme}
        onToggleTheme={() => setTheme((prev) => (prev === 'dark' ? 'light' : 'dark'))}
        counts={counts}
      />

      <QuickAddBar
        onAddTask={handleQuickAdd}
        searchQuery={searchQuery}
        onSearchChange={setSearchQuery}
        notificationPermission={notificationPermission}
        onEnableNotifications={handleEnableNotifications}
        onTestNotification={handleTestNotification}
        onOpenCalendarSync={() => setCalendarModalOpen(true)}
      />

      <main className="mx-auto max-w-[1320px] px-5 py-6 sm:px-8">
        {activeView === 'matrix' ? (
          <EisenhowerMatrix
            tasks={visibleTasks}
            nowMs={nowMs}
            searchQuery={searchQuery}
            onMoveTask={handleMoveTask}
            onToggleComplete={handleToggleComplete}
            onEditTask={handleOpenEditModal}
            onDeleteTask={handleDeleteTask}
            onCreateInQuadrant={handleOpenCreateModal}
          />
        ) : (
          <TaskListView
            view={activeView}
            tasks={visibleTasks}
            nowMs={nowMs}
            searchQuery={searchQuery}
            onToggleComplete={handleToggleComplete}
            onMoveTask={(id, q) => handleMoveTask(id, q)}
            onEditTask={handleOpenEditModal}
            onDeleteTask={handleDeleteTask}
            onClearCompleted={handleClearCompleted}
            onBackToMatrix={() => setActiveView('matrix')}
            onTestNotification={handleTestNotification}
            onOpenCalendarSync={() => setCalendarModalOpen(true)}
            onExportIcs={handleExportAllIcs}
          />
        )}
      </main>

      <TaskModal
        isOpen={modalOpen}
        editingTask={editingTask}
        defaultQuadrant={modalDefaultQuadrant}
        onClose={() => setModalOpen(false)}
        onSave={handleSaveModal}
      />

      <CalendarSyncModal
        isOpen={calendarModalOpen}
        onClose={() => setCalendarModalOpen(false)}
        tasks={tasks}
        nowMs={nowMs}
        feedId={calendarFeedId}
        feedSyncing={feedSyncing}
        feedLastSyncedAt={feedLastSyncedAt}
        includeCompleted={includeCompletedInFeed}
        onToggleIncludeCompleted={setIncludeCompletedInFeed}
        onSyncFeed={() => syncCalendarFeed()}
      />

      <NotificationBanner
        alerts={alerts}
        onDismiss={(alertId) =>
          setAlerts((prev) => prev.filter((a) => a.id !== alertId))
        }
        onCompleteTask={(taskId, alertId) => {
          handleToggleComplete(taskId);
          setAlerts((prev) => prev.filter((a) => a.id !== alertId));
        }}
        onSnoozeTask={(taskId, alertId) => {
          setTasks((prev) => snoozeTaskReminder(prev, taskId, 10));
          setAlerts((prev) => prev.filter((a) => a.id !== alertId));
        }}
      />
    </div>
  );
}
