import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { Mic, Phone, PhoneOff, RotateCcw, Send, Square, Volume2, VolumeX, X } from 'lucide-react';
import type { JarvisAction, JarvisCommandResponse, JarvisMessage, Task } from '../types/task';
import {
  cancelBrowserSpeech,
  LiveAudioPlayer,
  playJarvisChime,
  playWavBase64,
  speakWithBrowserSynthesis,
  unlockAudioOutput,
  type PlaybackHandle,
} from '../utils/audio';
import {
  arrayBufferToBase64,
  computeRmsLevel,
  encodeWavPcm16,
  int16ToBase64,
  LIVE_INPUT_SAMPLE_RATE,
  mergeFloat32Chunks,
  pickSupportedRecorderMime,
  resampleFloat32ToInt16,
} from '../utils/pcm';
import { JarvisOrbCanvas, type JarvisStatus } from './JarvisOrbCanvas';

interface JarvisConsoleProps {
  isOpen: boolean;
  onClose: () => void;
  tasks: Task[];
  onApplyActions: (actions: JarvisAction[]) => string[];
}

type VoiceMode = 'live' | 'ptt';

interface VoiceTurnResponse extends Partial<JarvisCommandResponse> {
  transcript?: string;
  inaudible?: boolean;
  audioBase64?: string | null;
  mimeType?: string | null;
  ttsFallback?: 'browser' | null;
  error?: string;
}

interface SpeechRecognitionAlternativeLike {
  transcript: string;
}

interface SpeechRecognitionResultLike {
  isFinal: boolean;
  0?: SpeechRecognitionAlternativeLike;
}

interface SpeechRecognitionEventLike {
  results: ArrayLike<SpeechRecognitionResultLike>;
}

interface SpeechRecognitionLike {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onerror: (() => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
  abort: () => void;
}

type SpeechRecognitionConstructor = new () => SpeechRecognitionLike;

const SUGGESTED_PROMPTS = [
  'Add urgent client bug fix to Do First',
  'Remind me in 15 minutes to call Pepper',
  'Brief me on my urgent tasks',
];

const WELCOME_MESSAGE: JarvisMessage = {
  id: 'jarvis-welcome',
  role: 'jarvis',
  text: 'Good day. Start a live voice call, tap Push-to-Talk, or type a command below to organize your matrix.',
  timestamp: Date.now(),
};

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const result = typeof reader.result === 'string' ? reader.result : '';
      const commaIdx = result.indexOf(',');
      if (commaIdx === -1) {
        reject(new Error('Failed to encode audio recording.'));
        return;
      }
      resolve(result.slice(commaIdx + 1));
    };
    reader.onerror = () => reject(new Error('Failed to read recorded audio.'));
    reader.readAsDataURL(blob);
  });
}

function formatDuration(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

function getAudioContextConstructor(): typeof AudioContext | null {
  if (typeof window === 'undefined') return null;
  return (
    window.AudioContext ||
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext ||
    null
  );
}

function getSpeechRecognitionConstructor(): SpeechRecognitionConstructor | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as {
    SpeechRecognition?: SpeechRecognitionConstructor;
    webkitSpeechRecognition?: SpeechRecognitionConstructor;
  };
  return w.SpeechRecognition || w.webkitSpeechRecognition || null;
}

export function JarvisConsole({
  isOpen,
  onClose,
  tasks,
  onApplyActions,
}: JarvisConsoleProps) {
  const [voiceMode, setVoiceMode] = useState<VoiceMode>('live');
  const [status, setStatus] = useState<JarvisStatus>('idle');
  const [liveActive, setLiveActive] = useState(false);
  const [liveConnecting, setLiveConnecting] = useState(false);
  const [voiceEnabled, setVoiceEnabled] = useState(true);
  const [commandInput, setCommandInput] = useState('');
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const [micLevel, setMicLevel] = useState(0);
  const [liveUserCaption, setLiveUserCaption] = useState('');
  const [liveJarvisCaption, setLiveJarvisCaption] = useState('');
  const [messages, setMessages] = useState<JarvisMessage[]>([WELCOME_MESSAGE]);
  const [voiceStage, setVoiceStage] = useState<string>('idle');

  const amplitudeRef = useRef<number>(0);
  const firstLiveAudioSentRef = useRef<boolean>(false);
  const firstLiveAudioReceivedRef = useRef<boolean>(false);

  // Capture & recording refs
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const captureAudioCtxRef = useRef<AudioContext | null>(null);
  const scriptProcessorRef = useRef<ScriptProcessorNode | null>(null);
  const captureSourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const captureSilentGainRef = useRef<GainNode | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const pttPcmChunksRef = useRef<Float32Array[]>([]);
  const pttPeakLevelRef = useRef<number>(0);
  const pttStopRequestedRef = useRef<boolean>(false);
  const discardRecordingRef = useRef<boolean>(false);
  const recordingStartMsRef = useRef<number>(0);
  const recordingTimerRef = useRef<number | null>(null);
  const lastMeterUiUpdateRef = useRef<number>(0);
  const speechRecRef = useRef<SpeechRecognitionLike | null>(null);
  const browserSpeechDraftRef = useRef<string>('');

  // Playback & Live WS refs
  const activePlaybackRef = useRef<PlaybackHandle | null>(null);
  const livePlayerRef = useRef<LiveAudioPlayer | null>(null);
  const liveWsRef = useRef<WebSocket | null>(null);
  const liveReadyRef = useRef<boolean>(false);
  const liveAwaitingToolReplyRef = useRef<boolean>(false);
  const liveToolTimeoutRef = useRef<number | null>(null);
  const liveUserDraftRef = useRef<string>('');
  const liveJarvisDraftRef = useRef<string>('');
  const livePendingSummariesRef = useRef<string[]>([]);
  const ttsCooldownUntilRef = useRef<number>(0);

  // Reactive state mirrors for async callbacks
  const tasksRef = useRef<Task[]>(tasks);
  const messagesRef = useRef<JarvisMessage[]>(messages);
  const voiceEnabledRef = useRef<boolean>(voiceEnabled);
  const onApplyActionsRef = useRef(onApplyActions);
  const feedEndRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    tasksRef.current = tasks;
  }, [tasks]);

  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  useEffect(() => {
    voiceEnabledRef.current = voiceEnabled;
  }, [voiceEnabled]);

  useEffect(() => {
    onApplyActionsRef.current = onApplyActions;
  }, [onApplyActions]);

  useEffect(() => {
    feedEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, liveUserCaption, liveJarvisCaption]);

  const appendMessage = useCallback((msg: JarvisMessage) => {
    setMessages((prev) => [...prev, msg]);
  }, []);

  const logStage = useCallback((stage: string, detail?: unknown) => {
    console.log(`[Jarvis Voice] stage: ${stage}`, detail ?? '');
    setVoiceStage(stage);
  }, []);

  const updateMicMeter = useCallback((level: number) => {
    const now = performance.now();
    if (now - lastMeterUiUpdateRef.current >= 75) {
      lastMeterUiUpdateRef.current = now;
      setMicLevel(Math.round(Math.min(1, Math.max(0, level)) * 100));
    }
  }, []);

  const stopSpeechRecognition = useCallback(() => {
    if (speechRecRef.current) {
      const rec = speechRecRef.current;
      speechRecRef.current = null;
      rec.onresult = null;
      rec.onerror = null;
      rec.onend = null;
      try {
        rec.stop();
      } catch {
        // ignore already stopped
      }
    }
  }, []);

  const stopCaptureResources = useCallback(() => {
    if (recordingTimerRef.current !== null) {
      window.clearInterval(recordingTimerRef.current);
      recordingTimerRef.current = null;
    }
    stopSpeechRecognition();

    if (scriptProcessorRef.current) {
      try {
        scriptProcessorRef.current.onaudioprocess = null;
        scriptProcessorRef.current.disconnect();
      } catch {
        // ignore
      }
      scriptProcessorRef.current = null;
    }
    if (captureSilentGainRef.current) {
      try {
        captureSilentGainRef.current.disconnect();
      } catch {
        // ignore
      }
      captureSilentGainRef.current = null;
    }
    if (captureSourceRef.current) {
      try {
        captureSourceRef.current.disconnect();
      } catch {
        // ignore
      }
      captureSourceRef.current = null;
    }
    if (captureAudioCtxRef.current) {
      if (captureAudioCtxRef.current.state !== 'closed') {
        captureAudioCtxRef.current.close().catch(() => {});
      }
      captureAudioCtxRef.current = null;
    }
    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach((track) => track.stop());
      mediaStreamRef.current = null;
    }
    amplitudeRef.current = 0;
    setMicLevel(0);
    setRecordingSeconds(0);
  }, [stopSpeechRecognition]);

  const stopUnaryPlayback = useCallback(() => {
    if (activePlaybackRef.current) {
      activePlaybackRef.current.stop();
      activePlaybackRef.current = null;
    }
    cancelBrowserSpeech();
    amplitudeRef.current = 0;
  }, []);

  const commitLiveTurnDrafts = useCallback((forceFlushSummaries = false) => {
    const uText = liveUserDraftRef.current.trim();
    const jText = liveJarvisDraftRef.current.trim();
    const shouldCommitJarvis =
      Boolean(jText) || (forceFlushSummaries && livePendingSummariesRef.current.length > 0);
    const summaries = shouldCommitJarvis ? [...livePendingSummariesRef.current] : [];

    liveUserDraftRef.current = '';
    setLiveUserCaption('');

    if (shouldCommitJarvis) {
      liveJarvisDraftRef.current = '';
      livePendingSummariesRef.current = [];
      setLiveJarvisCaption('');
    }

    if (!uText && !shouldCommitJarvis) return;

    setMessages((prev) => {
      const next = [...prev];
      const baseTs = Date.now();
      if (uText) {
        next.push({
          id: `live-user-${baseTs}`,
          role: 'user',
          text: uText,
          timestamp: baseTs,
        });
      }
      if (shouldCommitJarvis) {
        next.push({
          id: `live-jarvis-${baseTs + 1}`,
          role: 'jarvis',
          text: jText || 'Matrix updated, sir.',
          timestamp: baseTs + 1,
          appliedSummaries: summaries.length > 0 ? summaries : undefined,
        });
      }
      return next;
    });
  }, []);

  const stopLiveSession = useCallback(() => {
    if (liveToolTimeoutRef.current !== null) {
      window.clearTimeout(liveToolTimeoutRef.current);
      liveToolTimeoutRef.current = null;
    }
    liveReadyRef.current = false;
    liveAwaitingToolReplyRef.current = false;

    if (liveWsRef.current) {
      const ws = liveWsRef.current;
      liveWsRef.current = null;
      try {
        ws.onopen = null;
        ws.onmessage = null;
        ws.onerror = null;
        ws.onclose = null;
        if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
          ws.close(1000, 'Session ended');
        }
      } catch {
        // ignore
      }
    }
    if (livePlayerRef.current) {
      livePlayerRef.current.close();
      livePlayerRef.current = null;
    }
    stopCaptureResources();
    commitLiveTurnDrafts(true);
    setLiveActive(false);
    setLiveConnecting(false);
    setStatus('idle');
  }, [commitLiveTurnDrafts, stopCaptureResources]);

  const processPttCaptureRef = useRef<
    ((discard: boolean, recorderBlob?: Blob, recorderMime?: string) => Promise<void>) | null
  >(null);

  const stopPttRecorder = useCallback(
    (discard: boolean) => {
      if (pttStopRequestedRef.current && !discard) return;
      pttStopRequestedRef.current = true;
      discardRecordingRef.current = discard;

      const recorder = mediaRecorderRef.current;
      if (recorder && recorder.state !== 'inactive') {
        try {
          recorder.stop();
          return;
        } catch {
          // Fall through to direct PCM finalization
        }
      }

      if (processPttCaptureRef.current) {
        void processPttCaptureRef.current(discard);
      } else {
        stopCaptureResources();
        setStatus('idle');
      }
    },
    [stopCaptureResources],
  );

  const stopAllSessions = useCallback(() => {
    stopLiveSession();
    stopPttRecorder(true);
    stopUnaryPlayback();
  }, [stopLiveSession, stopPttRecorder, stopUnaryPlayback]);

  useEffect(() => {
    if (!isOpen) {
      stopAllSessions();
    }
  }, [isOpen, stopAllSessions]);

  useEffect(() => {
    return () => {
      stopAllSessions();
    };
  }, [stopAllSessions]);

  const playJarvisReplyAudio = useCallback(
    async (
      text: string,
      cachedBase64?: string | null,
      cachedMime?: string | null,
      skipServerTts = false,
    ) => {
      if (!voiceEnabledRef.current) {
        setStatus('idle');
        return;
      }

      stopUnaryPlayback();
      setStatus('speaking');

      let base64 = cachedBase64 ?? null;
      let mimeType = cachedMime ?? 'audio/wav';

      try {
        if (!base64 && !skipServerTts && Date.now() >= ttsCooldownUntilRef.current) {
          const speakController = new AbortController();
          const speakTimeout = window.setTimeout(() => speakController.abort(), 11000);
          const res = await fetch('/api/jarvis/speak', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ text }),
            signal: speakController.signal,
          });
          window.clearTimeout(speakTimeout);

          if (res.ok) {
            const data = (await res.json()) as {
              audioBase64?: string | null;
              mimeType?: string | null;
              fallback?: 'browser' | null;
            };
            if (data.fallback === 'browser' || !data.audioBase64) {
              ttsCooldownUntilRef.current = Date.now() + 5 * 60_000;
              throw new Error('Use browser synthesis');
            }
            base64 = data.audioBase64;
            mimeType = data.mimeType || 'audio/wav';
          } else {
            throw new Error('TTS unavailable');
          }
        } else if (!base64) {
          throw new Error('Use browser synthesis');
        }

        const handle = playWavBase64(base64, mimeType, amplitudeRef, () => {
          logStage('playback-started', { mimeType });
          setStatus('speaking');
        });
        activePlaybackRef.current = handle;
        await handle.promise;
        activePlaybackRef.current = null;
        setStatus((prev) => (prev === 'speaking' ? 'idle' : prev));
      } catch {
        const spokeFallback = speakWithBrowserSynthesis(
          text,
          () => {
            logStage('playback-started-fallback-browser-tts');
            setStatus('speaking');
            amplitudeRef.current = 0.42;
          },
          () => {
            amplitudeRef.current = 0;
            setStatus((prev) => (prev === 'speaking' ? 'idle' : prev));
          },
        );
        if (!spokeFallback) {
          amplitudeRef.current = 0;
          setStatus((prev) => (prev === 'speaking' ? 'idle' : prev));
        }
      }
    },
    [stopUnaryPlayback],
  );

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

      unlockAudioOutput();

      // If a Live Voice session is actively open, route turn straight through it
      if (liveWsRef.current && liveWsRef.current.readyState === WebSocket.OPEN) {
        appendMessage({
          id: `user-${Date.now()}`,
          role: 'user',
          text: cleaned,
          timestamp: Date.now(),
        });
        setStatus('thinking');
        liveWsRef.current.send(JSON.stringify({ type: 'text', text: cleaned }));
        return;
      }

      stopUnaryPlayback();
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

        await playJarvisReplyAudio(replyText);
      } catch (err) {
        const isAbort = err instanceof Error && err.name === 'AbortError';
        const errMessage = isAbort
          ? 'The request timed out awaiting the central server. Please try again.'
          : err instanceof Error
            ? err.message
            : 'My connection to the central server encountered an interruption.';
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
    [appendMessage, playJarvisReplyAudio, stopUnaryPlayback],
  );

  // --- LIVE VOICE MODE (Gemini Live API over WebSocket) ---
  const startLiveVoiceCall = async () => {
    if (liveActive || liveConnecting) {
      stopLiveSession();
      return;
    }

    // Synchronous user-gesture audio unlock BEFORE any async calls (getUserMedia / WS)
    logStage('start-clicked', { secureContext: window.isSecureContext, iframe: window.self !== window.top });
    unlockAudioOutput();
    stopUnaryPlayback();
    stopPttRecorder(true);

    if (!window.isSecureContext) {
      logStage('failed-insecure-context');
      appendMessage({
        id: `jarvis-https-${Date.now()}`,
        role: 'jarvis',
        text: 'Microphone access requires HTTPS. Reopen this page over HTTPS (or use localhost while developing).',
        timestamp: Date.now(),
        isError: true,
      });
      return;
    }

    try {
      const perm = await navigator.permissions?.query?.({ name: 'microphone' as PermissionName });
      if (perm && perm.state === 'denied') {
        logStage('failed-mic-permission-blocked');
        appendMessage({
          id: `jarvis-perm-${Date.now()}`,
          role: 'jarvis',
          text: 'Microphone is blocked at the browser or iframe level. Allow mic access in the address bar / parent page settings, or open the app outside the preview iframe.',
          timestamp: Date.now(),
          isError: true,
        });
        return;
      }
    } catch {
      // Permissions query unsupported; getUserMedia result is authoritative
    }

    if (!navigator.mediaDevices?.getUserMedia) {
      logStage('failed-getusermedia-unsupported');
      appendMessage({
        id: `jarvis-nomic-${Date.now()}`,
        role: 'jarvis',
        text: 'Microphone access requires HTTPS or a supported browser with audio input. Switch to Push-to-Talk or type a command below.',
        timestamp: Date.now(),
        isError: true,
      });
      return;
    }

    const AudioCtx = getAudioContextConstructor();
    let captureCtx: AudioContext | null = null;
    if (AudioCtx) {
      try {
        // Always use native sample rate on capture context to prevent Safari/Firefox errors
        captureCtx = new AudioCtx();
        if (captureCtx.state === 'suspended') {
          captureCtx.resume().catch(() => {});
        }
        captureAudioCtxRef.current = captureCtx;
      } catch {
        captureCtx = null;
      }
    }

    const player = new LiveAudioPlayer(amplitudeRef, (isSpeaking) => {
      if (isSpeaking) logStage('playback-started');
      setStatus((prev) => {
        if (!liveWsRef.current) return 'idle';
        if (isSpeaking) return 'speaking';
        if (liveAwaitingToolReplyRef.current) return 'thinking';
        return prev === 'speaking' ? 'listening' : prev;
      });
    });
    player.unlock();
    livePlayerRef.current = player;

    setLiveConnecting(true);
    setStatus('thinking');

    let stream: MediaStream;
    try {
      logStage('mic-permission-requested');
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      logStage('mic-granted', { track: stream.getAudioTracks()[0]?.label || 'unknown' });
      mediaStreamRef.current = stream;
    } catch (err) {
      const errName = err instanceof Error ? err.name : 'UnknownError';
      logStage('mic-denied-or-failed', { name: errName, message: err instanceof Error ? err.message : String(err) });
      if (captureCtx && captureCtx.state !== 'closed') {
        captureCtx.close().catch(() => {});
      }
      captureAudioCtxRef.current = null;
      player.close();
      livePlayerRef.current = null;

      const inIframe = window.self !== window.top;
      const detail = /notfound|device/i.test(errName)
        ? 'No microphone device was detected. Connect a microphone or type your command below.'
        : /notallowed|permission/i.test(errName)
          ? inIframe
            ? 'Microphone permission was blocked, likely by the embedded preview iframe. Allow microphone in your browser address bar, or open this app in its own tab.'
            : 'Microphone permission was declined. Allow microphone access in the address bar or type below.'
          : 'Microphone could not be opened. Check that it is not in use by another app, or type below.';
      appendMessage({
        id: `jarvis-mic-err-${Date.now()}`,
        role: 'jarvis',
        text: detail,
        timestamp: Date.now(),
        isError: true,
      });
      setLiveConnecting(false);
      setStatus('idle');
      return;
    }

    const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${proto}//${window.location.host}/api/jarvis/live`;
    logStage('ws-connecting', { url: wsUrl });
    const ws = new WebSocket(wsUrl);
    liveWsRef.current = ws;
    liveReadyRef.current = false;
    liveAwaitingToolReplyRef.current = false;
    firstLiveAudioSentRef.current = false;
    firstLiveAudioReceivedRef.current = false;

    const connectTimeout = window.setTimeout(() => {
      if (!liveReadyRef.current && liveWsRef.current === ws) {
        appendMessage({
          id: `live-timeout-${Date.now()}`,
          role: 'jarvis',
          text: 'Live voice connection timed out. Switching to Push-to-Talk works reliably on restricted networks.',
          timestamp: Date.now(),
          isError: true,
        });
        stopLiveSession();
      }
    }, 12000);

    ws.onopen = () => {
      logStage('ws-open-sending-init');
      ws.send(
        JSON.stringify({
          type: 'init',
          tasksSummary: buildTasksPayload(),
          localTime: new Date().toString(),
        }),
      );

      if (captureCtx && mediaStreamRef.current) {
        try {
          if (captureCtx.state === 'suspended') {
            captureCtx.resume().catch(() => {});
          }
          const source = captureCtx.createMediaStreamSource(mediaStreamRef.current);
          captureSourceRef.current = source;

          const processor = captureCtx.createScriptProcessor(4096, 1, 1);
          scriptProcessorRef.current = processor;

          // Zero-gain node prevents mic loopback echo into local speakers
          const silentGain = captureCtx.createGain();
          silentGain.gain.value = 0;
          captureSilentGainRef.current = silentGain;

          source.connect(processor);
          processor.connect(silentGain);
          silentGain.connect(captureCtx.destination);

          logStage('audio-capture-started', { captureSampleRate: captureCtx.sampleRate });

          processor.onaudioprocess = (ev) => {
            if (!liveWsRef.current || liveWsRef.current.readyState !== WebSocket.OPEN) return;
            const channel = ev.inputBuffer.getChannelData(0);
            const level = computeRmsLevel(channel);
            updateMicMeter(level);

            const jarvisSpeaking = livePlayerRef.current?.isSpeaking() ?? false;
            if (!jarvisSpeaking && (!livePlayerRef.current || amplitudeRef.current < level)) {
              amplitudeRef.current = level;
            }

            // Do not stream audio until session signals ready; attenuate speaker echo unless louder barge-in
            if (!liveReadyRef.current) return;
            if (jarvisSpeaking && level < 0.16) return;

            const pcm16 = resampleFloat32ToInt16(channel, captureCtx.sampleRate, LIVE_INPUT_SAMPLE_RATE);
            if (pcm16.length > 0) {
              liveWsRef.current.send(
                JSON.stringify({
                  type: 'audio',
                  data: int16ToBase64(pcm16),
                }),
              );
              if (!firstLiveAudioSentRef.current) {
                firstLiveAudioSentRef.current = true;
                logStage('audio-sent', {
                  captureSampleRate: captureCtx.sampleRate,
                  upsampledTo: LIVE_INPUT_SAMPLE_RATE,
                });
              }
            }
          };
        } catch (err) {
          window.clearTimeout(connectTimeout);
          logStage('failed-capture-init', { message: err instanceof Error ? err.message : String(err) });
          appendMessage({
            id: `jarvis-ctx-err-${Date.now()}`,
            role: 'jarvis',
            text: 'Could not initialize browser audio capture for Live Voice. Switching to Push-to-Talk instead.',
            timestamp: Date.now(),
            isError: true,
          });
          stopLiveSession();
          setVoiceMode('ptt');
        }
      } else {
        window.clearTimeout(connectTimeout);
        logStage('failed-capture-unavailable');
        appendMessage({
          id: `jarvis-ctx-null-${Date.now()}`,
          role: 'jarvis',
          text: 'Web Audio capture is unavailable in this browser. Switching to Push-to-Talk instead.',
          timestamp: Date.now(),
          isError: true,
        });
        stopLiveSession();
        setVoiceMode('ptt');
      }
    };

    ws.onmessage = (event) => {
      try {
        const payload = JSON.parse(event.data as string) as {
          type?: string;
          text?: string;
          data?: string;
          sampleRate?: number;
          actions?: JarvisAction[];
          message?: string;
        };

        if (payload.type === 'ready') {
          window.clearTimeout(connectTimeout);
          logStage('ai-session-ready');
          liveReadyRef.current = true;
          setLiveConnecting(false);
          setLiveActive(true);
          setStatus('listening');
          playJarvisChime('activate');
          return;
        }

        if (payload.type === 'input_transcript' && payload.text) {
          liveUserDraftRef.current += payload.text;
          setLiveUserCaption(liveUserDraftRef.current.trim());
          return;
        }

        if (payload.type === 'output_transcript' && payload.text) {
          liveAwaitingToolReplyRef.current = false;
          if (liveToolTimeoutRef.current !== null) {
            window.clearTimeout(liveToolTimeoutRef.current);
            liveToolTimeoutRef.current = null;
          }
          if (liveUserDraftRef.current.trim() && !liveJarvisDraftRef.current) {
            const committedUser = liveUserDraftRef.current.trim();
            liveUserDraftRef.current = '';
            setLiveUserCaption('');
            appendMessage({
              id: `live-user-${Date.now()}`,
              role: 'user',
              text: committedUser,
              timestamp: Date.now(),
            });
          }
          liveJarvisDraftRef.current += payload.text;
          setLiveJarvisCaption(liveJarvisDraftRef.current.trim());
          return;
        }

        if (payload.type === 'audio' && payload.data) {
          liveAwaitingToolReplyRef.current = false;
          if (liveToolTimeoutRef.current !== null) {
            window.clearTimeout(liveToolTimeoutRef.current);
            liveToolTimeoutRef.current = null;
          }
          if (voiceEnabledRef.current && livePlayerRef.current) {
            if (!firstLiveAudioReceivedRef.current) {
              firstLiveAudioReceivedRef.current = true;
              logStage('response-audio-received', { sampleRate: payload.sampleRate ?? null });
            }
            livePlayerRef.current.enqueuePcmBase64(payload.data, payload.sampleRate);
          }
          return;
        }

        if (payload.type === 'actions' && Array.isArray(payload.actions)) {
          const summaries = onApplyActionsRef.current(payload.actions);
          if (summaries.length > 0) {
            livePendingSummariesRef.current.push(...summaries);
            playJarvisChime('confirm');
          }
          liveAwaitingToolReplyRef.current = true;
          setStatus('thinking');
          if (liveToolTimeoutRef.current !== null) {
            window.clearTimeout(liveToolTimeoutRef.current);
          }
          liveToolTimeoutRef.current = window.setTimeout(() => {
            if (liveAwaitingToolReplyRef.current) {
              liveAwaitingToolReplyRef.current = false;
              commitLiveTurnDrafts(true);
              setStatus((prev) =>
                liveWsRef.current && prev === 'thinking' ? 'listening' : prev,
              );
            }
          }, 5000);
          return;
        }

        if (payload.type === 'interrupted') {
          liveAwaitingToolReplyRef.current = false;
          livePlayerRef.current?.interrupt();
          commitLiveTurnDrafts(true);
          setStatus('listening');
          return;
        }

        if (payload.type === 'turn_complete') {
          // Gemini Live emits an immediate turn_complete right after emitting toolCall before speaking
          if (
            liveAwaitingToolReplyRef.current &&
            !liveJarvisDraftRef.current.trim() &&
            !livePlayerRef.current?.isSpeaking()
          ) {
            return;
          }
          liveAwaitingToolReplyRef.current = false;
          commitLiveTurnDrafts(true);
          setStatus((prev) => (prev === 'speaking' ? prev : 'listening'));
          return;
        }

        if (payload.type === 'error') {
          window.clearTimeout(connectTimeout);
          logStage('ai-session-error', { message: payload.message || 'unknown' });
          appendMessage({
            id: `live-err-${Date.now()}`,
            role: 'jarvis',
            text:
              payload.message ||
              'Live voice session encountered an issue. Try Push-to-Talk or reconnect.',
            timestamp: Date.now(),
            isError: true,
          });
          stopLiveSession();
          return;
        }

        if (payload.type === 'closed') {
          window.clearTimeout(connectTimeout);
          stopLiveSession();
        }
      } catch {
        // ignore malformed websocket payload
      }
    };

    ws.onerror = () => {
      window.clearTimeout(connectTimeout);
      logStage('ws-error');
      if (liveWsRef.current === ws) {
        appendMessage({
          id: `live-ws-err-${Date.now()}`,
          role: 'jarvis',
          text: 'Live voice WebSocket connection dropped. Try Push-to-Talk mode for instant turn-based voice.',
          timestamp: Date.now(),
          isError: true,
        });
        stopLiveSession();
      }
    };

    ws.onclose = (ev) => {
      window.clearTimeout(connectTimeout);
      logStage('ws-closed', { code: ev.code, reason: ev.reason || 'none' });
      if (liveWsRef.current === ws) {
        const failedHandshake = !liveReadyRef.current;
        const abnormalClose = ev.code !== 1000 && ev.code !== 1005;
        if (failedHandshake || abnormalClose) {
          appendMessage({
            id: `live-ws-closed-${Date.now()}`,
            role: 'jarvis',
            text: failedHandshake
              ? 'Could not establish a Live Voice stream. Switch to Push-to-Talk mode or try again.'
              : `Live voice call disconnected (code ${ev.code}).`,
            timestamp: Date.now(),
            isError: true,
          });
        }
        stopLiveSession();
      }
    };
  };

  const finishLiveUserTurn = () => {
    if (!liveWsRef.current || liveWsRef.current.readyState !== WebSocket.OPEN) return;
    setStatus('thinking');
    liveWsRef.current.send(JSON.stringify({ type: 'audio_end' }));
  };

  // --- PUSH-TO-TALK MODE (Direct 16kHz PCM WAV + MediaRecorder backup -> /api/jarvis/voice-turn) ---
  const startPttRecording = async () => {
    if (status === 'listening') {
      stopPttRecorder(false);
      return;
    }

    // Synchronous user-gesture unlock BEFORE async getUserMedia
    logStage('ptt-start-clicked');
    unlockAudioOutput();
    stopUnaryPlayback();
    playJarvisChime('activate');

    if (!window.isSecureContext) {
      logStage('failed-insecure-context');
      appendMessage({
        id: `jarvis-https-${Date.now()}`,
        role: 'jarvis',
        text: 'Microphone recording requires HTTPS. Reopen this page over HTTPS (or use localhost while developing).',
        timestamp: Date.now(),
        isError: true,
      });
      return;
    }

    if (!navigator.mediaDevices?.getUserMedia) {
      appendMessage({
        id: `jarvis-ptt-unsupported-${Date.now()}`,
        role: 'jarvis',
        text: 'Microphone recording is unavailable in this browser. Type your command below.',
        timestamp: Date.now(),
        isError: true,
      });
      return;
    }

    const AudioCtx = getAudioContextConstructor();
    let captureCtx: AudioContext | null = null;
    if (AudioCtx) {
      try {
        captureCtx = new AudioCtx();
        if (captureCtx.state === 'suspended') {
          captureCtx.resume().catch(() => {});
        }
        captureAudioCtxRef.current = captureCtx;
      } catch {
        captureCtx = null;
      }
    }

    let stream: MediaStream;
    try {
      logStage('mic-permission-requested');
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      logStage('mic-granted', { track: stream.getAudioTracks()[0]?.label || 'unknown' });
      mediaStreamRef.current = stream;
    } catch (err) {
      const errName = err instanceof Error ? err.name : 'UnknownError';
      logStage('mic-denied-or-failed', { name: errName, message: err instanceof Error ? err.message : String(err) });
      if (captureCtx && captureCtx.state !== 'closed') {
        captureCtx.close().catch(() => {});
      }
      captureAudioCtxRef.current = null;

      const inIframe = window.self !== window.top;
      const detail = /notfound|device/i.test(errName)
        ? 'No microphone device was detected. Connect a microphone or type below.'
        : /notallowed|permission/i.test(errName)
          ? inIframe
            ? 'Microphone permission was blocked, likely by the embedded preview iframe. Allow microphone in your browser address bar, or open this app in its own tab.'
            : 'Microphone permission was declined. Allow microphone access in the address bar or type below.'
          : 'Microphone could not be opened. Check that it is not in use by another app, or type below.';
      appendMessage({
        id: `jarvis-mic-err-${Date.now()}`,
        role: 'jarvis',
        text: detail,
        timestamp: Date.now(),
        isError: true,
      });
      setStatus('idle');
      return;
    }

    pttPcmChunksRef.current = [];
    pttPeakLevelRef.current = 0;
    pttStopRequestedRef.current = false;
    discardRecordingRef.current = false;
    browserSpeechDraftRef.current = '';
    recordingStartMsRef.current = Date.now();
    setRecordingSeconds(0);
    setMicLevel(0);

    const captureSampleRate = captureCtx?.sampleRate ?? 48000;

    // Direct Web Audio PCM capture (guaranteed clean WAV across Chrome, Safari, Firefox)
    if (captureCtx) {
      try {
        if (captureCtx.state === 'suspended') {
          captureCtx.resume().catch(() => {});
        }
        const source = captureCtx.createMediaStreamSource(stream);
        captureSourceRef.current = source;

        const processor = captureCtx.createScriptProcessor(4096, 1, 1);
        scriptProcessorRef.current = processor;

        const silentGain = captureCtx.createGain();
        silentGain.gain.value = 0;
        captureSilentGainRef.current = silentGain;

        source.connect(processor);
        processor.connect(silentGain);
        silentGain.connect(captureCtx.destination);

        logStage('audio-capture-started', { captureSampleRate: captureCtx.sampleRate });

        processor.onaudioprocess = (ev) => {
          if (discardRecordingRef.current) return;
          const channel = ev.inputBuffer.getChannelData(0);
          pttPcmChunksRef.current.push(new Float32Array(channel));
          const level = computeRmsLevel(channel);
          if (level > pttPeakLevelRef.current) {
            pttPeakLevelRef.current = level;
          }
          amplitudeRef.current = level;
          updateMicMeter(level);
        };
      } catch {
        // MediaRecorder fallback remains active below
      }
    }

    // Optional parallel browser SpeechRecognition backup for silent/noisy environments
    const SpeechRecCtor = getSpeechRecognitionConstructor();
    if (SpeechRecCtor) {
      try {
        const rec = new SpeechRecCtor();
        rec.continuous = true;
        rec.interimResults = true;
        rec.lang = 'en-US';
        rec.onresult = (ev) => {
          let combined = '';
          for (let i = 0; i < ev.results.length; i++) {
            const text = ev.results[i]?.[0]?.transcript;
            if (text) combined += `${text} `;
          }
          browserSpeechDraftRef.current = combined.trim();
        };
        rec.onerror = () => {};
        rec.start();
        speechRecRef.current = rec;
      } catch {
        // SpeechRecognition optional
      }
    }

    // Finalize callback shared between MediaRecorder.onstop and direct fallback
    processPttCaptureRef.current = async (
      discard: boolean,
      recorderBlob?: Blob,
      recorderMime?: string,
    ) => {
      const durationMs = Date.now() - recordingStartMsRef.current;
      const pcmChunks = [...pttPcmChunksRef.current];
      const peakLevel = pttPeakLevelRef.current;
      const speechBackup = browserSpeechDraftRef.current.trim();

      pttPcmChunksRef.current = [];
      mediaRecorderRef.current = null;
      stopCaptureResources();

      if (discard) {
        setStatus('idle');
        return;
      }

      if (durationMs < 300) {
        appendMessage({
          id: `jarvis-short-${Date.now()}`,
          role: 'jarvis',
          text: 'Recording was too brief. Tap Speak to Jarvis, state your command, then tap Send Voice.',
          timestamp: Date.now(),
        });
        setStatus('idle');
        return;
      }

      let audioBase64 = '';
      let mimeType = 'audio/wav';

      if (pcmChunks.length > 0) {
        const merged = mergeFloat32Chunks(pcmChunks);
        if (merged.length > 0) {
          const pcm16 = resampleFloat32ToInt16(merged, captureSampleRate, 16000);
          const wavBuffer = encodeWavPcm16(pcm16, 16000);
          audioBase64 = arrayBufferToBase64(wavBuffer);
          mimeType = 'audio/wav';
        }
      }

      if (!audioBase64 && recorderBlob && recorderBlob.size >= 400) {
        audioBase64 = await blobToBase64(recorderBlob);
        mimeType = recorderMime || 'audio/webm';
      }

      if (!audioBase64 && speechBackup) {
        await submitTextCommand(speechBackup);
        return;
      }

      // If hardware microphone produced flat zero signal and no SpeechRecognition transcript, report clearly
      if (pcmChunks.length > 0 && peakLevel < 0.002 && !speechBackup) {
        appendMessage({
          id: `jarvis-silent-mic-${Date.now()}`,
          role: 'jarvis',
          text: 'No microphone sound was detected (0% input level). Check that your microphone is unmuted and selected in browser/OS audio settings.',
          timestamp: Date.now(),
          isError: true,
        });
        setStatus('idle');
        return;
      }

      if (!audioBase64) {
        appendMessage({
          id: `jarvis-empty-clip-${Date.now()}`,
          role: 'jarvis',
          text: 'Could not capture audio from your microphone. Check permissions or type your command below.',
          timestamp: Date.now(),
          isError: true,
        });
        setStatus('idle');
        return;
      }

      setStatus('thinking');
      try {
        const controller = new AbortController();
        const timeoutId = window.setTimeout(() => controller.abort(), 25000);
        logStage('voice-clip-uploading', { mimeType, bytes: Math.round((audioBase64.length * 3) / 4) });
        const shouldSkipServerTts =
          !voiceEnabledRef.current || Date.now() < ttsCooldownUntilRef.current;

        const res = await fetch('/api/jarvis/voice-turn', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            audioBase64,
            mimeType,
            tasksSummary: buildTasksPayload(),
            conversationHistory: buildHistoryPayload(),
            localTime: new Date().toString(),
            includeTts: !shouldSkipServerTts,
          }),
          signal: controller.signal,
        });
        window.clearTimeout(timeoutId);

        const data = (await res.json()) as VoiceTurnResponse;
        if (!res.ok) {
          throw new Error(data.error || 'Unable to process voice command.');
        }
        logStage('response-received', { status: res.status, inaudible: data.inaudible ?? false });

        if (data.ttsFallback === 'browser') {
          ttsCooldownUntilRef.current = Date.now() + 5 * 60_000;
        }

        if (data.inaudible || !data.transcript?.trim()) {
          if (speechBackup) {
            await submitTextCommand(speechBackup);
            return;
          }
          appendMessage({
            id: `jarvis-inaudible-${Date.now()}`,
            role: 'jarvis',
            text:
              data.reply ||
              'I did not catch any clear words in that clip, sir. Could you speak a little louder or try again?',
            timestamp: Date.now(),
          });
          setStatus('idle');
          return;
        }

        appendMessage({
          id: `user-ptt-${Date.now()}`,
          role: 'user',
          text: data.transcript.trim(),
          timestamp: Date.now(),
        });

        const actions = Array.isArray(data.actions) ? data.actions : [];
        const appliedSummaries = onApplyActionsRef.current(actions);
        if (appliedSummaries.length > 0) {
          playJarvisChime('confirm');
        }

        const replyText =
          typeof data.reply === 'string' && data.reply.trim()
            ? data.reply.trim()
            : 'Done, sir. Matrix updated.';

        appendMessage({
          id: `jarvis-ptt-${Date.now() + 1}`,
          role: 'jarvis',
          text: replyText,
          timestamp: Date.now() + 1,
          appliedSummaries,
          audioBase64: data.audioBase64 ?? null,
          audioMimeType: data.mimeType ?? null,
        });

        await playJarvisReplyAudio(
          replyText,
          data.audioBase64,
          data.mimeType,
          data.ttsFallback === 'browser' || shouldSkipServerTts,
        );
      } catch (err) {
        if (speechBackup) {
          await submitTextCommand(speechBackup);
          return;
        }
        const isAbort = err instanceof Error && err.name === 'AbortError';
        appendMessage({
          id: `jarvis-ptt-err-${Date.now()}`,
          role: 'jarvis',
          text: isAbort
            ? 'Voice processing timed out. Please try a shorter command.'
            : err instanceof Error
              ? err.message
              : 'Voice processing failed.',
          timestamp: Date.now(),
          isError: true,
        });
        setStatus('idle');
      }
    };

    if (recordingTimerRef.current !== null) {
      window.clearInterval(recordingTimerRef.current);
    }
    recordingTimerRef.current = window.setInterval(() => {
      setRecordingSeconds(Math.floor((Date.now() - recordingStartMsRef.current) / 1000));
    }, 500);

    // Keep MediaRecorder running cleanly without timeslice fragmentation as a secondary backup
    if (typeof MediaRecorder !== 'undefined') {
      const preferredMime = pickSupportedRecorderMime((m) => MediaRecorder.isTypeSupported(m));
      let recorder: MediaRecorder | null = null;
      try {
        recorder = preferredMime
          ? new MediaRecorder(stream, { mimeType: preferredMime })
          : new MediaRecorder(stream);
      } catch {
        try {
          recorder = new MediaRecorder(stream);
        } catch {
          recorder = null;
        }
      }

      if (recorder) {
        mediaRecorderRef.current = recorder;
        const chunks: BlobPart[] = [];
        recorder.ondataavailable = (ev) => {
          if (ev.data && ev.data.size > 0) {
            chunks.push(ev.data);
          }
        };
        recorder.onstop = () => {
          const actualMime = recorder?.mimeType || preferredMime || 'audio/webm';
          const blob = new Blob(chunks, { type: actualMime });
          void processPttCaptureRef.current?.(
            discardRecordingRef.current,
            blob,
            actualMime,
          );
        };
        recorder.start();
      }
    }

    setStatus('listening');
  };

  const handleModeSwitch = (nextMode: VoiceMode) => {
    if (nextMode === voiceMode) return;
    stopLiveSession();
    stopPttRecorder(true);
    stopUnaryPlayback();
    setVoiceMode(nextMode);
    setStatus('idle');
  };

  const handleFormSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (!commandInput.trim() || status === 'thinking') return;
    const text = commandInput.trim();
    setCommandInput('');
    void submitTextCommand(text);
  };

  if (!isOpen) return null;

  const statusLabel = liveConnecting
    ? 'Connecting'
    : liveActive
      ? status === 'speaking'
        ? 'Live · Speaking'
        : status === 'thinking'
          ? 'Live · Thinking'
          : 'Live · Listening'
      : status === 'listening'
        ? `Recording · ${formatDuration(recordingSeconds)}`
        : status === 'thinking'
          ? 'Processing'
          : status === 'speaking'
            ? 'Speaking'
            : 'Ready';

  const showMicMeter =
    (liveActive && status === 'listening') || (!liveActive && status === 'listening');

  return (
    <aside
      aria-label="Jarvis Voice Assistant"
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
              const next = !voiceEnabled;
              setVoiceEnabled(next);
              if (!next) {
                stopUnaryPlayback();
                livePlayerRef.current?.interrupt();
                if (status === 'speaking') {
                  setStatus(liveActive ? 'listening' : 'idle');
                }
              }
            }}
            aria-label={voiceEnabled ? 'Mute Jarvis voice' : 'Enable Jarvis voice'}
            className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-neutral-400 transition-colors hover:bg-white/10 hover:text-white dark:hover:bg-sky-400/15"
          >
            {voiceEnabled ? (
              <Volume2 className="h-4 w-4 text-sky-400" aria-hidden="true" />
            ) : (
              <VolumeX className="h-4 w-4 text-neutral-500" aria-hidden="true" />
            )}
          </button>

          <button
            type="button"
            onClick={() => {
              stopUnaryPlayback();
              setMessages([WELCOME_MESSAGE]);
              if (!liveActive) setStatus('idle');
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

      {/* Minimal Acoustic Core + Mode Switcher */}
      <div className="flex flex-col items-center border-b border-white/10 px-6 py-5 dark:border-sky-400/15">
        <div
          role="tablist"
          aria-label="Voice chat mode"
          className="mb-3 inline-flex rounded-full border border-white/10 bg-white/[0.04] p-0.5 text-[11px] dark:border-sky-400/20 dark:bg-sky-500/[0.06]"
        >
          <button
            type="button"
            role="tab"
            aria-selected={voiceMode === 'live'}
            onClick={() => handleModeSwitch('live')}
            className={`rounded-full px-3 py-1 font-medium transition-colors ${
              voiceMode === 'live'
                ? 'bg-white text-neutral-950 dark:bg-sky-300 dark:text-neutral-950'
                : 'text-neutral-400 hover:text-white dark:text-neutral-300'
            }`}
          >
            Live Voice
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={voiceMode === 'ptt'}
            onClick={() => handleModeSwitch('ptt')}
            className={`rounded-full px-3 py-1 font-medium transition-colors ${
              voiceMode === 'ptt'
                ? 'bg-white text-neutral-950 dark:bg-sky-300 dark:text-neutral-950'
                : 'text-neutral-400 hover:text-white dark:text-neutral-300'
            }`}
          >
            Push-to-Talk
          </button>
        </div>

        <JarvisOrbCanvas status={status} amplitudeRef={amplitudeRef} />

        <div className="mt-2 flex flex-col items-center gap-0.5">
          <span className="font-mono text-[11px] tracking-wider tabular-nums text-neutral-400 dark:text-sky-300">
            {statusLabel}
          </span>
          {voiceStage !== 'idle' && (
            <span
              aria-live="polite"
              className="max-w-full truncate font-mono text-[10px] text-neutral-500 dark:text-neutral-400"
              title={`Last voice pipeline stage: ${voiceStage}`}
            >
              stage: {voiceStage}
            </span>
          )}
        </div>

        {showMicMeter && (
          <div className="mt-2 flex w-40 items-center gap-2" aria-label={`Microphone level ${micLevel}%`}>
            <div className="h-1 flex-1 overflow-hidden rounded-full bg-white/10">
              <div
                className="h-full rounded-full bg-sky-400 transition-[width] duration-75"
                style={{ width: `${Math.max(4, micLevel)}%` }}
              />
            </div>
            <span className="w-8 text-right font-mono text-[10px] tabular-nums text-neutral-500">
              {micLevel}%
            </span>
          </div>
        )}

        {voiceMode === 'live' ? (
          <div className="mt-4 flex items-center gap-2">
            <button
              type="button"
              onClick={() => void startLiveVoiceCall()}
              className={`inline-flex items-center gap-2 rounded-full px-5 py-2 text-xs font-medium transition-colors whitespace-nowrap shrink-0 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white dark:focus-visible:outline-sky-300 ${
                liveActive || liveConnecting
                  ? 'bg-rose-600 text-white hover:bg-rose-700'
                  : 'bg-white text-neutral-950 hover:bg-neutral-200 dark:bg-sky-400 dark:text-neutral-950 dark:hover:bg-sky-300'
              }`}
            >
              {liveActive || liveConnecting ? (
                <>
                  <PhoneOff className="h-3.5 w-3.5" aria-hidden="true" />
                  <span>{liveConnecting ? 'Connecting...' : 'End Live Call'}</span>
                </>
              ) : (
                <>
                  <Phone className="h-3.5 w-3.5" aria-hidden="true" />
                  <span>Start Live Voice</span>
                </>
              )}
            </button>

            {liveActive && status === 'listening' && (
              <button
                type="button"
                onClick={finishLiveUserTurn}
                className="inline-flex items-center rounded-full border border-white/15 px-3.5 py-2 text-xs font-medium text-neutral-200 transition-colors hover:bg-white/10 hover:text-white whitespace-nowrap shrink-0 dark:border-sky-400/25"
              >
                Send Turn
              </button>
            )}
          </div>
        ) : (
          <div className="mt-4 flex items-center gap-2">
            {status === 'listening' ? (
              <>
                <button
                  type="button"
                  onClick={() => stopPttRecorder(false)}
                  className="inline-flex items-center gap-2 rounded-full bg-white px-5 py-2 text-xs font-medium text-neutral-950 transition-colors hover:bg-neutral-200 whitespace-nowrap shrink-0 dark:bg-sky-400 dark:hover:bg-sky-300"
                >
                  <Square className="h-3 w-3 fill-current" aria-hidden="true" />
                  <span>Send Voice</span>
                </button>
                <button
                  type="button"
                  onClick={() => stopPttRecorder(true)}
                  className="inline-flex items-center rounded-full border border-white/15 px-3.5 py-2 text-xs font-medium text-neutral-300 transition-colors hover:bg-white/10 hover:text-white whitespace-nowrap shrink-0 dark:border-sky-400/25"
                >
                  Cancel
                </button>
              </>
            ) : (
              <button
                type="button"
                onClick={() => void startPttRecording()}
                disabled={status === 'thinking'}
                className="inline-flex items-center gap-2 rounded-full bg-white px-5 py-2 text-xs font-medium text-neutral-950 transition-colors hover:bg-neutral-200 disabled:opacity-50 whitespace-nowrap shrink-0 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white dark:bg-sky-400 dark:hover:bg-sky-300 dark:focus-visible:outline-sky-300"
              >
                <Mic className="h-3.5 w-3.5" aria-hidden="true" />
                <span>Speak to Jarvis</span>
              </button>
            )}
          </div>
        )}
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
                {!msg.isError && msg.id !== 'jarvis-welcome' && (
                  <button
                    type="button"
                    onClick={() => {
                      unlockAudioOutput();
                      void playJarvisReplyAudio(msg.text, msg.audioBase64, msg.audioMimeType);
                    }}
                    aria-label="Replay Jarvis response"
                    className="mt-1.5 inline-flex items-center gap-1 text-[11px] text-neutral-500 transition-colors hover:text-neutral-200 dark:text-neutral-400 dark:hover:text-sky-200"
                  >
                    <Volume2 className="h-3 w-3" aria-hidden="true" />
                    <span>Replay</span>
                  </button>
                )}
              </div>
            )}
          </div>
        ))}

        {liveUserCaption && (
          <div className="flex flex-col items-end">
            <div className="max-w-[85%] rounded-2xl border border-white/10 bg-white/5 px-4 py-2.5 text-sm italic leading-relaxed text-neutral-300 dark:border-sky-400/25 dark:bg-sky-500/10">
              {liveUserCaption}
            </div>
          </div>
        )}

        {liveJarvisCaption && (
          <div className="flex flex-col items-start">
            <div className="max-w-[92%] text-sm leading-relaxed text-neutral-200 dark:text-neutral-100">
              <p>{liveJarvisCaption}</p>
            </div>
          </div>
        )}

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
              onClick={() => {
                unlockAudioOutput();
                void submitTextCommand(prompt);
              }}
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
            placeholder={liveActive ? 'Message or speak to Jarvis...' : 'Ask Jarvis...'}
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
