import { useEffect, useState, type FormEvent } from 'react';
import { Download, ExternalLink, X } from 'lucide-react';
import type { QuadrantId, Task } from '../types/task';
import { buildGoogleCalendarTemplateUrl, downloadTasksAsIcs } from '../utils/calendarSync';
import { QUADRANT_META, QUADRANT_ORDER } from '../utils/matrix';

interface TaskModalProps {
  isOpen: boolean;
  editingTask: Task | null;
  defaultQuadrant: QuadrantId;
  onClose: () => void;
  onSave: (data: {
    id?: string;
    title: string;
    notes: string;
    quadrant: QuadrantId;
    reminderAt: number | null;
  }) => void;
}

function toDatetimeLocalValue(ms: number | null | undefined): string {
  if (!ms) return '';
  const date = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function TaskModal({
  isOpen,
  editingTask,
  defaultQuadrant,
  onClose,
  onSave,
}: TaskModalProps) {
  const [title, setTitle] = useState('');
  const [notes, setNotes] = useState('');
  const [quadrant, setQuadrant] = useState<QuadrantId>(defaultQuadrant);
  const [reminderValue, setReminderValue] = useState('');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    if (editingTask) {
      setTitle(editingTask.title);
      setNotes(editingTask.notes ?? '');
      setQuadrant(editingTask.quadrant);
      setReminderValue(toDatetimeLocalValue(editingTask.reminderAt));
    } else {
      setTitle('');
      setNotes('');
      setQuadrant(defaultQuadrant);
      setReminderValue('');
    }
    setErrorMsg(null);
  }, [isOpen, editingTask, defaultQuadrant]);

  useEffect(() => {
    if (!isOpen) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const setRelativeReminder = (minutes: number) => {
    setReminderValue(toDatetimeLocalValue(Date.now() + minutes * 60_000));
  };

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (!title.trim()) {
      setErrorMsg('Task title is required.');
      return;
    }
    let reminderAt: number | null = null;
    if (reminderValue) {
      const parsed = Date.parse(reminderValue);
      if (!Number.isNaN(parsed)) {
        reminderAt = parsed;
      }
    }
    onSave({
      id: editingTask?.id,
      title: title.trim(),
      notes: notes.trim(),
      quadrant,
      reminderAt,
    });
    onClose();
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="task-modal-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-neutral-950/40 p-4 backdrop-blur-xs dark:bg-black/75"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="w-full max-w-lg rounded-2xl border border-neutral-200 bg-white p-6 shadow-xl dark:border-white/15 dark:bg-[#0C0F14] dark:shadow-2xl">
        <div className="mb-5 flex items-center justify-between border-b border-neutral-100 pb-3.5 dark:border-white/10">
          <h2 id="task-modal-title" className="font-display text-base font-semibold text-neutral-950 dark:text-white">
            {editingTask ? 'Edit Task' : 'New Task'}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close task dialog"
            className="rounded-lg p-1.5 text-neutral-400 transition-colors hover:bg-neutral-100 hover:text-neutral-800 dark:hover:bg-white/10 dark:hover:text-white"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4" noValidate>
          <div>
            <label htmlFor="modal-task-title" className="block text-xs font-medium text-neutral-700 dark:text-neutral-300">
              Task title
            </label>
            <input
              id="modal-task-title"
              type="text"
              autoFocus
              value={title}
              onChange={(e) => {
                setTitle(e.target.value);
                if (errorMsg) setErrorMsg(null);
              }}
              placeholder="What needs to be accomplished?"
              className="mt-1.5 w-full rounded-xl border border-neutral-200 bg-white px-3.5 py-2 text-sm text-neutral-950 placeholder:text-neutral-400 focus:border-neutral-500 focus:outline-none dark:border-white/15 dark:bg-[#121720] dark:text-white dark:placeholder:text-neutral-400 dark:focus:border-sky-400"
            />
            {errorMsg && <p className="mt-1 text-xs font-medium text-rose-600 dark:text-rose-400">{errorMsg}</p>}
          </div>

          <div>
            <label htmlFor="modal-task-notes" className="block text-xs font-medium text-neutral-700 dark:text-neutral-300">
              Notes (optional)
            </label>
            <textarea
              id="modal-task-notes"
              rows={3}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Add context, links, or next steps..."
              className="mt-1.5 w-full rounded-xl border border-neutral-200 bg-white px-3.5 py-2 text-sm text-neutral-950 placeholder:text-neutral-400 focus:border-neutral-500 focus:outline-none dark:border-white/15 dark:bg-[#121720] dark:text-white dark:placeholder:text-neutral-400 dark:focus:border-sky-400"
            />
          </div>

          <div>
            <label htmlFor="modal-task-quadrant" className="block text-xs font-medium text-neutral-700 dark:text-neutral-300">
              Eisenhower Quadrant
            </label>
            <select
              id="modal-task-quadrant"
              value={quadrant}
              onChange={(e) => setQuadrant(e.target.value as QuadrantId)}
              className="mt-1.5 h-10 w-full rounded-xl border border-neutral-200 bg-white px-3 text-sm font-medium text-neutral-900 focus:border-neutral-500 focus:outline-none dark:border-white/15 dark:bg-[#121720] dark:text-white dark:focus:border-sky-400"
            >
              {QUADRANT_ORDER.map((qId) => (
                <option key={qId} value={qId} className="bg-white text-neutral-900 dark:bg-[#121720] dark:text-white">
                  {QUADRANT_META[qId].title} · {QUADRANT_META[qId].subtitle}
                </option>
              ))}
            </select>
          </div>

          <div>
            <div className="flex items-center justify-between">
              <label htmlFor="modal-task-reminder" className="block text-xs font-medium text-neutral-700 dark:text-neutral-300">
                Push Reminder
              </label>
              {reminderValue && (
                <button
                  type="button"
                  onClick={() => setReminderValue('')}
                  className="text-xs font-medium text-neutral-500 hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-white"
                >
                  Clear reminder
                </button>
              )}
            </div>
            <input
              id="modal-task-reminder"
              type="datetime-local"
              value={reminderValue}
              onChange={(e) => setReminderValue(e.target.value)}
              className="mt-1.5 h-10 w-full rounded-xl border border-neutral-200 bg-white px-3 font-mono text-sm text-neutral-900 focus:border-neutral-500 focus:outline-none dark:border-white/15 dark:bg-[#121720] dark:text-white dark:focus:border-sky-400"
            />
            <div className="mt-2 flex flex-wrap gap-1.5">
              {[
                { label: 'In 5m', mins: 5 },
                { label: 'In 15m', mins: 15 },
                { label: 'In 1h', mins: 60 },
                { label: 'Tomorrow 9 AM', mins: null },
              ].map((preset) => (
                <button
                  key={preset.label}
                  type="button"
                  onClick={() => {
                    if (preset.mins !== null) {
                      setRelativeReminder(preset.mins);
                    } else {
                      const d = new Date();
                      d.setDate(d.getDate() + 1);
                      d.setHours(9, 0, 0, 0);
                      setReminderValue(toDatetimeLocalValue(d.getTime()));
                    }
                  }}
                  className="rounded-lg border border-neutral-200 bg-neutral-50 px-2.5 py-1 text-xs font-medium text-neutral-600 transition-colors hover:bg-neutral-100 hover:text-neutral-950 dark:border-white/15 dark:bg-[#121720] dark:text-neutral-200 dark:hover:border-white/25 dark:hover:bg-[#19202B] dark:hover:text-white"
                >
                  {preset.label}
                </button>
              ))}
            </div>
            {(() => {
              const parsedReminder = reminderValue ? Date.parse(reminderValue) : NaN;
              if (Number.isNaN(parsedReminder) || !title.trim()) return null;
              const draftTask: Task = {
                id: editingTask?.id ?? `draft-${Date.now()}`,
                title: title.trim(),
                notes: notes.trim() || undefined,
                quadrant,
                completed: editingTask?.completed ?? false,
                createdAt: editingTask?.createdAt ?? Date.now(),
                updatedAt: Date.now(),
                order: editingTask?.order ?? 0,
                reminderAt: parsedReminder,
                reminderFired: false,
              };
              const googleUrl = buildGoogleCalendarTemplateUrl(draftTask);
              return (
                <div className="mt-2.5 flex flex-wrap items-center gap-2 text-[11px] text-neutral-500 dark:text-neutral-400">
                  <span>Calendar:</span>
                  <button
                    type="button"
                    onClick={() =>
                      downloadTasksAsIcs([draftTask], {
                        includeCompleted: true,
                        filename: `${draftTask.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'task'}.ics`,
                      })
                    }
                    className="inline-flex items-center gap-1 rounded-md border border-neutral-200 bg-white px-2 py-0.5 font-medium text-neutral-700 transition-colors hover:bg-neutral-50 dark:border-white/15 dark:bg-[#121720] dark:text-neutral-200 dark:hover:bg-[#19202B]"
                  >
                    <Download className="h-3 w-3" aria-hidden="true" />
                    <span>Export .ics</span>
                  </button>
                  {googleUrl && (
                    <a
                      href={googleUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 rounded-md border border-neutral-200 bg-white px-2 py-0.5 font-medium text-neutral-700 transition-colors hover:bg-neutral-50 dark:border-white/15 dark:bg-[#121720] dark:text-neutral-200 dark:hover:bg-[#19202B]"
                    >
                      <span>Add to Google</span>
                      <ExternalLink className="h-2.5 w-2.5" aria-hidden="true" />
                    </a>
                  )}
                </div>
              );
            })()}
          </div>

          <div className="flex items-center justify-end gap-2.5 border-t border-neutral-100 pt-4 dark:border-white/10">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-neutral-200 bg-white px-4 py-2 text-sm font-medium text-neutral-700 transition-colors hover:bg-neutral-50 dark:border-white/15 dark:bg-[#121720] dark:text-neutral-200 dark:hover:bg-[#19202B]"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="rounded-lg bg-neutral-950 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-neutral-800 dark:bg-white dark:text-neutral-950 dark:hover:bg-neutral-200"
            >
              {editingTask ? 'Save Changes' : 'Create Task'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
