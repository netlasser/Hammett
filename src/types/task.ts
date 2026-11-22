export type QuadrantId = 'q1' | 'q2' | 'q3' | 'q4';

export type AppView = 'matrix' | 'today' | 'reminders' | 'completed';

export interface Task {
  id: string;
  title: string;
  notes?: string;
  quadrant: QuadrantId;
  completed: boolean;
  createdAt: number;
  updatedAt: number;
  order: number;
  reminderAt?: number | null;
  reminderFired?: boolean;
}

export interface QuadrantMeta {
  id: QuadrantId;
  code: string;
  title: string;
  subtitle: string;
  urgencyLabel: 'Urgent' | 'Not Urgent';
  importanceLabel: 'Important' | 'Not Important';
  accentText: string;
  accentDot: string;
  dropHighlight: string;
}

export interface NotificationAlert {
  id: string;
  taskId?: string;
  title: string;
  body: string;
  quadrant?: QuadrantId;
  triggeredAt: number;
  isTest?: boolean;
}

export type JarvisActionType =
  | 'add_task'
  | 'move_task'
  | 'complete_task'
  | 'delete_task'
  | 'set_reminder'
  | 'none';

export interface JarvisAction {
  type: JarvisActionType;
  title?: string;
  notes?: string;
  quadrant?: QuadrantId;
  targetTaskTitle?: string;
  reminderMinutesFromNow?: number | null;
  reminderIso?: string | null;
}

export interface JarvisCommandResponse {
  reply: string;
  actions: JarvisAction[];
  followUpExpected: boolean;
}

export interface JarvisMessage {
  id: string;
  role: 'user' | 'jarvis';
  text: string;
  timestamp: number;
  appliedSummaries?: string[];
  isError?: boolean;
  audioBase64?: string | null;
  audioMimeType?: string | null;
}
