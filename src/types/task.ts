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


