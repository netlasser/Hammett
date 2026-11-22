import { useEffect, useRef, useState } from 'react';
import { Activity, CheckCircle2, Loader2, MinusCircle, XCircle } from 'lucide-react';
import { int16ToBase64 } from '../utils/pcm';
import { fetchLiveToken, probeLiveRoundTrip } from '../utils/geminiLiveBrowser';

type CheckState = 'idle' | 'running' | 'pass' | 'fail' | 'skipped';

interface SelfTestCheck {
  id: string;
  label: string;
  state: CheckState;
  detail?: string;
}

const INITIAL_CHECKS: SelfTestCheck[] = [
  { id: 'key', label: 'Server GEMINI_API_KEY set', state: 'idle' },
  { id: 'live', label: 'Server mints ephemeral Live token', state: 'idle' },
  { id: 'mic', label: 'Microphone permission granted', state: 'idle' },
  { id: 'ctx', label: 'AudioContext created and resumed', state: 'idle' },
  { id: 'ws', label: 'Browser connects directly to Gemini Live', state: 'idle' },
  { id: 'roundtrip', label: 'Test audio sent, response received', state: 'idle' },
];

function logSelfTest(...args: unknown[]) {
  console.log('[Jarvis Voice] self-test:', ...args);
}

function createTonePcmBase64(): string {
  const sampleRate = 16000;
  const durationSeconds = 0.8;
  const samples = new Int16Array(Math.round(sampleRate * durationSeconds));
  for (let i = 0; i < samples.length; i++) {
    samples[i] = Math.round(Math.sin((2 * Math.PI * 440 * i) / sampleRate) * 2600);
  }
  return int16ToBase64(samples);
}

function StateWord({ state }: { state: CheckState }) {
  const styles: Record<CheckState, string> = {
    idle: 'text-neutral-600',
    running: 'text-sky-400',
    pass: 'text-emerald-400',
    fail: 'text-rose-400',
    skipped: 'text-neutral-500',
  };
  const words: Record<CheckState, string> = {
    idle: 'idle',
    running: '...',
    pass: 'PASS',
    fail: 'FAIL',
    skipped: 'SKIP',
  };
  return (
    <span className={`shrink-0 font-mono text-[10px] font-semibold tracking-wider ${styles[state]}`}>
      {words[state]}
    </span>
  );
}

function StateIcon({ state }: { state: CheckState }) {
  if (state === 'pass') {
    return <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-400" aria-hidden="true" />;
  }
  if (state === 'fail') {
    return <XCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-rose-400" aria-hidden="true" />;
  }
  if (state === 'running') {
    return <Loader2 className="mt-0.5 h-3.5 w-3.5 shrink-0 animate-spin text-sky-400" aria-hidden="true" />;
  }
  return <MinusCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-neutral-500" aria-hidden="true" />;
}

export function VoiceSelfTest() {
  const [checks, setChecks] = useState<SelfTestCheck[]>(() => INITIAL_CHECKS.map((c) => ({ ...c })));
  const [running, setRunning] = useState(false);
  const startedRef = useRef(false);

  const update = (id: string, patch: Partial<SelfTestCheck>) =>
    setChecks((prev) => prev.map((c) => (c.id === id ? { ...c, ...patch } : c)));

  const skip = (id: string, detail: string) => update(id, { state: 'skipped', detail });

  const runAll = async () => {
    setRunning(true);
    setChecks(INITIAL_CHECKS.map((c) => ({ ...c })));
    logSelfTest('started');

    update('key', { state: 'running' });
    try {
      const res = await fetch('/api/jarvis/selftest/key');
      const data = (await res.json()) as { configured?: boolean };
      if (data.configured) {
        update('key', { state: 'pass', detail: 'Yes (value never shown)' });
        logSelfTest('key: configured');
      } else {
        update('key', { state: 'fail', detail: 'No - GEMINI_API_KEY is not set on the server' });
        logSelfTest('key: not configured');
        skip('live', 'Skipped: no API key on server');
        skip('ws', 'Skipped: no API key on server');
        skip('roundtrip', 'Skipped: no API key on server');
        setRunning(false);
        return;
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Key status request failed';
      update('key', { state: 'fail', detail: message });
      logSelfTest('key: request failed', message);
      skip('live', 'Skipped: key status request failed');
      skip('ws', 'Skipped: key status request failed');
      skip('roundtrip', 'Skipped: key status request failed');
      setRunning(false);
      return;
    }

    update('live', { state: 'running' });
    let tokenOk = false;
    try {
      const res = await fetch('/api/jarvis/selftest/live', { method: 'POST' });
      const data = (await res.json()) as {
        ok?: boolean;
        error?: string;
        model?: string;
        mode?: string;
      };
      if (data.ok) {
        tokenOk = true;
        update('live', {
          state: 'pass',
          detail: `Token minted (${data.model || 'gemini-3.8-live'})`,
        });
        logSelfTest('server live token: ok', data.mode);
      } else {
        update('live', { state: 'fail', detail: data.error || 'Live token request failed' });
        logSelfTest('server live token: fail', data.error);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Live status request failed';
      update('live', { state: 'fail', detail: message });
      logSelfTest('server live token: fail', message);
    }
    if (!tokenOk) {
      skip('ws', 'Skipped: server cannot mint a Live token');
      skip('roundtrip', 'Skipped: server cannot mint a Live token');
    }

    update('mic', { state: 'running' });
    try {
      if (!navigator.mediaDevices?.getUserMedia) {
        throw new Error('getUserMedia is not supported in this browser');
      }
      try {
        const perm = await navigator.permissions?.query?.({ name: 'microphone' as PermissionName });
        if (perm?.state === 'denied') {
          throw new Error('Microphone permission blocked in browser or iframe settings');
        }
      } catch (permErr) {
        if (permErr instanceof Error && permErr.message.includes('blocked')) throw permErr;
      }
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      update('mic', { state: 'pass', detail: 'Granted' });
      logSelfTest('mic: granted');
      stream.getTracks().forEach((track) => track.stop());
    } catch (err) {
      update('mic', {
        state: 'fail',
        detail: err instanceof Error ? err.message : 'Microphone unavailable',
      });
      logSelfTest('mic: fail', err);
    }

    update('ctx', { state: 'running' });
    let ctx: AudioContext | null = null;
    try {
      const Ctx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctx) throw new Error('AudioContext not supported in this browser');
      ctx = new Ctx();
      if (ctx.state === 'suspended') await ctx.resume();
      if (ctx.state !== 'running') {
        throw new Error(`AudioContext stuck in state "${ctx.state}" (autoplay policy or no user gesture)`);
      }
      update('ctx', { state: 'pass', detail: `Running at ${ctx.sampleRate} Hz` });
      logSelfTest('audiocontext: running', ctx.sampleRate);
    } catch (err) {
      update('ctx', {
        state: 'fail',
        detail: err instanceof Error ? err.message : 'AudioContext failed',
      });
      logSelfTest('audiocontext: fail', err);
    } finally {
      try {
        await ctx?.close();
      } catch {
        // ignore
      }
    }

    update('ws', { state: 'running' });
    if (tokenOk) {
      let token: string | null = null;
      try {
        const liveToken = await fetchLiveToken();
        token = liveToken.token;
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Live token request failed';
        update('ws', { state: 'fail', detail: message });
        logSelfTest('browser live: token fail', message);
        skip('roundtrip', 'Skipped: could not fetch Live token');
        setRunning(false);
        return;
      }

      try {
        const result = await probeLiveRoundTrip(token!, createTonePcmBase64());
        if (result.ok) {
          update('ws', { state: 'pass', detail: 'Connected directly (v1beta)' });
          logSelfTest('browser live: connect ok');
          update('roundtrip', {
            state: 'pass',
            detail: result.receivedAudio
              ? 'Response audio received'
              : `Response received (text)${result.receivedText ? '' : ' (indirect)'}`,
          });
          logSelfTest('roundtrip: response received', result);
        } else if (result.error && result.error.startsWith('No response')) {
          update('ws', { state: 'pass', detail: 'Connected directly (v1beta)' });
          logSelfTest('browser live: connect ok, no response');
          update('roundtrip', { state: 'fail', detail: result.error });
          logSelfTest('roundtrip: fail', result.error);
        } else {
          update('ws', {
            state: 'fail',
            detail: result.closeCode !== null
              ? `Connection failed (close code ${result.closeCode})${result.error ? `: ${result.error}` : ''}`
              : result.error || 'Connection failed',
          });
          logSelfTest('browser live: connect fail', result.error, result.closeCode);
          skip('roundtrip', 'Skipped: browser Live connect failed');
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Browser Live probe crashed';
        update('ws', { state: 'fail', detail: message });
        logSelfTest('browser live: probe error', err);
        skip('roundtrip', 'Skipped: browser Live probe crashed');
      }
    }
    setRunning(false);
    logSelfTest('finished');
  };

  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;
    void runAll();
  }, []);

  return (
    <div
      aria-label="Voice self-test results"
      className="border-b border-white/10 px-6 py-4 dark:border-sky-400/15"
    >
      <div className="flex items-center justify-between gap-2">
        <h3 className="font-display text-[11px] font-semibold uppercase tracking-widest text-neutral-300 dark:text-sky-200">
          Voice self-test
        </h3>
        <button
          type="button"
          onClick={() => void runAll()}
          disabled={running}
          className="inline-flex items-center gap-1.5 rounded-full border border-white/15 px-3 py-1 text-[11px] font-medium text-neutral-200 transition-colors hover:bg-white/10 hover:text-white disabled:opacity-50 dark:border-sky-400/25"
        >
          {running ? (
            <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />
          ) : (
            <Activity className="h-3 w-3" aria-hidden="true" />
          )}
          <span>{running ? 'Running...' : 'Run again'}</span>
        </button>
      </div>
      <ul className="mt-3 space-y-2">
        {checks.map((check) => (
          <li key={check.id} className="flex items-start gap-2">
            <StateIcon state={check.state} />
            <div className="min-w-0 flex-1">
              <div className="flex items-baseline justify-between gap-2">
                <p
                  className={`text-xs font-medium ${
                    check.state === 'fail' ? 'text-rose-300' : 'text-neutral-200 dark:text-neutral-100'
                  }`}
                >
                  {check.label}
                </p>
                <StateWord state={check.state} />
              </div>
              {check.detail && (
                <p
                  className={`mt-0.5 break-words text-[11px] ${
                    check.state === 'fail'
                      ? 'text-rose-400/90'
                      : 'text-neutral-500 dark:text-neutral-400'
                  }`}
                >
                  {check.detail}
                </p>
              )}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

