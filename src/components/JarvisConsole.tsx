import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { RotateCcw, Send, X } from 'lucide-react';
import type { JarvisAction, JarvisCommandResponse, JarvisMessage, Task } from '../types/task';
import { playJarvisChime } from '../utils/audio';
import { JarvisOrbCanvas, type JarvisStatus } from './JarvisOrbCanvas';

interface JarvisConsoleProps {
  isOpen: boolean;
  onClose: () => void;
  tasks: Task[];
  onApplyActions: (actions: JarvisAction[]) => string[];
}

const SUGGESTED_PROMPTS = [
  'Add urgent client bug fix to Do First',
  'Remind me in 15 minutes to call Pepper',
  'Brief me on my urgent tasks',
];

const WELCOME_MESSAGE: JarvisMessage = {
  id: 'jarvis-welcome',
  role: 'jarvis',
  text: 'Good day. Type a command below to organize your matrix.',
  timestamp: Date.now(),
};

export function JarvisConsole({
  isOpen,
  onClose,
  tasks,
  onApplyActions,
}: JarvisConsoleProps) {
  const [status, setStatus] = useState<JarvisStatus>('idle');
  const [commandInput, setCommandInput] = useState('');
  const [messages, setMessages] = useState<JarvisMessage[]>([WELCOME_MESSAGE]);

  const amplitudeRef = useRef<number>(0);

  const tasksRef = useRef<Task[]>(tasks);
  const messagesRef = useRef<JarvisMessage[]>(messages);
  const onApplyActionsRef = useRef(onApplyActions);
  const feedEndRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    tasksRef.current = tasks;
  }, [tasks]);

  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  useEffect(() => {
    onApplyActionsRef.current = onApplyActions;
  }, [onApplyActions]);

  useEffect(() => {
    feedEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const appendMessage = useCallback((msg: JarvisMessage) => {
    setMessages((prev) => [...prev, msg]);
  }, []);

  const buildTasksPayload = () =>
    tasksRef.current.map((t) => ({
      title: t.title,
      quadrant: t.quadrant,
      completed: t.completed,
      reminderAt: t.reminderAt ? new Date(t.reminderAt).toISOString() : null,
    }));

  const buildHistoryPayload = () =>
    messagesRef.current
      .filter((m) => m.id !== 'jarvis-welcome' && !m.isError)
      .slice(-6)
      .map((m) => ({ role: m.role, text: m.text }));

  const submitTextCommand = useCallback(
    async (rawText: string) => {
      const cleaned = rawText.trim();
      if (!cleaned) return;

      setStatus('thinking');

      appendMessage({
        id: `user-${Date.now()}`,
        role: 'user',
        text: cleaned,
        timestamp: Date.now(),
      });

      try {
        const cmdController = new AbortController();
        const cmdTimeout = window.setTimeout(() => cmdController.abort(), 20000);
        const response = await fetch('/api/jarvis/command', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            transcript: cleaned,
            tasksSummary: buildTasksPayload(),
            conversationHistory: buildHistoryPayload(),
            localTime: new Date().toString(),
          }),
          signal: cmdController.signal,
        });
        window.clearTimeout(cmdTimeout);

        const payload = (await response.json()) as Partial<JarvisCommandResponse> & {
          error?: string;
        };

        if (!response.ok) {
          throw new Error(payload.error || 'Unable to reach Jarvis.');
        }

        const actions = Array.isArray(payload.actions) ? payload.actions : [];
        const appliedSummaries = onApplyActionsRef.current(actions);
        if (appliedSummaries.length > 0) {
          playJarvisChime('confirm');
        }

        const replyText =
          typeof payload.reply === 'string' && payload.reply.trim()
            ? payload.reply.trim()
            : 'Done. Your matrix has been updated.';

        appendMessage({
          id: `jarvis-${Date.now()}`,
          role: 'jarvis',
          text: replyText,
          timestamp: Date.now(),
          appliedSummaries,
        });

        setStatus('idle');
      } catch (err) {
        const isAbort = err instanceof Error && err.name === 'AbortError';
        const errMessage = isAbort
          ? 'Processing timed out. Please try a shorter command.'
          : err instanceof Error
            ? err.message
            : 'Command failed.';
        appendMessage({
          id: `jarvis-err-${Date.now()}`,
          role: 'jarvis',
          text: errMessage,
          timestamp: Date.now(),
          isError: true,
        });
        setStatus('idle');
      }
    },
    [appendMessage],
  );

  const handleFormSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (!commandInput.trim() || status === 'thinking') return;
    const text = commandInput.trim();
    setCommandInput('');
    void submitTextCommand(text);
  };

  if (!isOpen) return null;

  const statusLabel =
    status === 'thinking' ? 'Processing' : 'Ready';

  return (
    <aside
      aria-label="Jarvis Assistant"
      className="fixed inset-y-0 right-0 z-50 flex w-full max-w-[400px] flex-col border-l border-white/10 bg-[#0A0A0C] text-neutral-100 shadow-2xl transition-colors duration-200 dark:border-sky-400/25 dark:bg-[#05070A]"
    >
      <div className="flex items-center justify-between border-b border-white/10 px-6 py-4 dark:border-sky-400/15">
        <h2 className="font-display text-sm font-semibold tracking-wide text-white">
          J.A.R.V.I.S.
        </h2>

        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => {
              setMessages([WELCOME_MESSAGE]);
              setStatus('idle');
            }}
            aria-label="Reset Jarvis conversation"
            className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-neutral-400 transition-colors hover:bg-white/10 hover:text-white dark:hover:bg-sky-400/15"
          >
            <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
          </button>

          <button
            type="button"
            onClick={onClose}
            aria-label="Close Jarvis panel"
            className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-neutral-400 transition-colors hover:bg-white/10 hover:text-white dark:hover:bg-sky-400/15"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
      </div>

      {/* Minimal Acoustic Core */}
      <div className="flex flex-col items-center border-b border-white/10 px-6 py-5 dark:border-sky-400/15">
        <JarvisOrbCanvas status={status} amplitudeRef={amplitudeRef} />

        <span className="mt-2 font-mono text-[11px] tracking-wider tabular-nums text-neutral-400 dark:text-sky-300">
          {statusLabel}
        </span>
      </div>

      {/* Clean Dialogue Feed */}
      <div className="flex-1 space-y-5 overflow-y-auto px-6 py-5">
        {messages.map((msg) => (
          <div
            key={msg.id}
            className={`flex flex-col ${
              msg.role === 'user' ? 'items-end' : 'items-start'
            }`}
          >
            {msg.role === 'user' ? (
              <div className="max-w-[85%] rounded-2xl bg-white/10 px-4 py-2.5 text-sm leading-relaxed text-white dark:border dark:border-sky-400/25 dark:bg-sky-500/15">
                {msg.text}
              </div>
            ) : (
              <div
                className={`max-w-[92%] text-sm leading-relaxed ${
                  msg.isError ? 'text-rose-300' : 'text-neutral-200 dark:text-neutral-100'
                }`}
              >
                <p>{msg.text}</p>
                {msg.appliedSummaries && msg.appliedSummaries.length > 0 && (
                  <ul className="mt-2 space-y-1 text-xs text-sky-300">
                    {msg.appliedSummaries.map((summary, idx) => (
                      <li key={idx}>· {summary}</li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </div>
        ))}

        <div ref={feedEndRef} />
      </div>

      {/* Minimal Command Input & Quick Prompts */}
      <div className="border-t border-white/10 px-6 py-4 dark:border-sky-400/15">
        <div className="mb-3 flex flex-wrap gap-x-3 gap-y-1">
          {SUGGESTED_PROMPTS.map((prompt) => (
            <button
              key={prompt}
              type="button"
              disabled={status === 'thinking'}
              onClick={() => void submitTextCommand(prompt)}
              className="text-left text-[11px] text-neutral-500 transition-colors hover:text-neutral-200 disabled:opacity-40 dark:text-neutral-400 dark:hover:text-sky-200"
            >
              “{prompt}”
            </button>
          ))}
        </div>

        <form onSubmit={handleFormSubmit} className="flex items-center gap-2">
          <label htmlFor="jarvis-command-input" className="sr-only">
            Command for Jarvis
          </label>
          <input
            id="jarvis-command-input"
            type="text"
            value={commandInput}
            onChange={(e) => setCommandInput(e.target.value)}
            placeholder="Ask Jarvis..."
            className="h-10 flex-1 rounded-xl border border-white/10 bg-white/5 px-3.5 text-sm text-white placeholder:text-neutral-500 focus:border-white/30 focus:outline-none dark:border-sky-400/25 dark:bg-[#0B1018] dark:placeholder:text-neutral-400 dark:focus:border-sky-400"
          />
          <button
            type="submit"
            disabled={!commandInput.trim() || status === 'thinking'}
            aria-label="Send command to Jarvis"
            className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white text-neutral-950 transition-colors hover:bg-neutral-200 disabled:cursor-not-allowed disabled:opacity-30 dark:bg-sky-400 dark:hover:bg-sky-300"
          >
            <Send className="h-4 w-4" aria-hidden="true" />
          </button>
        </form>
      </div>
    </aside>
  );
}
