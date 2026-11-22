import {
  GoogleGenAI,
  Modality,
  type LiveConnectConfig,
  type LiveServerMessage,
  type Session,
} from '@google/genai';
import {
  JARVIS_LIVE_TOOLS,
  JARVIS_SYSTEM_INSTRUCTION,
  LIVE_MODEL_ID,
  extractCleanErrorMessage,
} from '../../netlify/functions/_lib/jarvis-core';

export const LIVE_CONNECT_API_VERSION = 'v1beta';

export interface LiveTokenResult {
  token: string;
  model: string;
  expiresInSeconds: number;
}

export async function fetchLiveToken(): Promise<LiveTokenResult> {
  let res: Response;
  try {
    res = await fetch('/api/jarvis/live-token', { method: 'POST' });
  } catch {
    throw new Error('Could not reach the server to request a Live token.');
  }
  let body: { token?: string; model?: string; expiresInSeconds?: number; error?: string } | null = null;
  try {
    body = await res.json();
  } catch {
    body = null;
  }
  if (!res.ok || !body?.token) {
    throw new Error(body?.error || `Live token request failed with status ${res.status}.`);
  }
  return {
    token: body.token,
    model: body.model || LIVE_MODEL_ID,
    expiresInSeconds: body.expiresInSeconds ?? 1800,
  };
}

export function buildJarvisLiveConnectConfig(systemInstruction: string): LiveConnectConfig {
  return {
    responseModalities: [Modality.AUDIO],
    speechConfig: {
      voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Charon' } },
    },
    inputAudioTranscription: {},
    outputAudioTranscription: {},
    systemInstruction,
    tools: [{ functionDeclarations: JARVIS_LIVE_TOOLS }],
  };
}

export function buildJarvisLiveSystemInstruction(tasksContextBlock: string): string {
  return [
    JARVIS_SYSTEM_INSTRUCTION,
    'In live voice conversation, speak naturally and concisely like MCU JARVIS. Whenever the user asks to add, move, complete, delete, or set a reminder on tasks, invoke the matching tool immediately and confirm succinctly.',
    tasksContextBlock,
  ].join('\n\n');
}

export interface BrowserLiveSessionHandlers {
  onOpen?: () => void;
  onMessage: (message: LiveServerMessage) => void;
  onError?: (e: ErrorEvent) => void;
  onClose?: (e: CloseEvent) => void;
}

export async function connectJarvisLiveBrowser(
  token: string,
  systemInstruction: string,
  handlers: BrowserLiveSessionHandlers,
): Promise<Session> {
  const ai = new GoogleGenAI({
    apiKey: token,
    httpOptions: { apiVersion: LIVE_CONNECT_API_VERSION },
  });

  return ai.live.connect({
    model: LIVE_MODEL_ID,
    config: buildJarvisLiveConnectConfig(systemInstruction),
    callbacks: {
      onopen: () => handlers.onOpen?.(),
      onmessage: (message) => handlers.onMessage(message),
      onerror: (e) => handlers.onError?.(e),
      onclose: (e) => handlers.onClose?.(e),
    },
  });
}

export interface LiveRoundTripResult {
  ok: boolean;
  receivedAudio: boolean;
  receivedText: boolean;
  closeCode: number | null;
  error: string | null;
}

export async function probeLiveRoundTrip(
  token: string,
  toneBase64: string,
  timeouts: { connectMs?: number; roundTripMs?: number } = {},
): Promise<LiveRoundTripResult> {
  const connectMs = timeouts.connectMs ?? 12000;
  const roundTripMs = timeouts.roundTripMs ?? 15000;

  return new Promise<LiveRoundTripResult>((resolve) => {
    let settled = false;
    let session: Session | null = null;
    let gotReady = false;
    let activeTimer = 0;

    const finish = (result: Partial<LiveRoundTripResult>) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(activeTimer);
      if (session) {
        try {
          void Promise.resolve(session.close()).catch(() => {});
        } catch {
          // ignore close errors
        }
      }
      resolve({
        ok: result.ok ?? false,
        receivedAudio: result.receivedAudio ?? false,
        receivedText: result.receivedText ?? false,
        closeCode: result.closeCode ?? null,
        error: result.error ?? null,
      });
    };

    const armRoundTripTimer = () => {
      window.clearTimeout(activeTimer);
      activeTimer = window.setTimeout(() => {
        finish({ ok: false, error: 'No response within 15s after test audio' });
      }, roundTripMs);
    };

    activeTimer = window.setTimeout(() => {
      finish({ ok: false, error: gotReady ? 'No response after test audio' : 'Live connect timed out' });
    }, connectMs);

    connectJarvisLiveBrowser(token, JARVIS_SYSTEM_INSTRUCTION, {
      onMessage: (message) => {
        const content = message.serverContent;
        if (message.setupComplete && !gotReady) {
          gotReady = true;
          try {
            session?.sendRealtimeInput({
              audio: { data: toneBase64, mimeType: 'audio/pcm;rate=16000' },
            });
            session?.sendRealtimeInput({ audioStreamEnd: true });
            armRoundTripTimer();
          } catch (err) {
            finish({
              ok: false,
              error: err instanceof Error ? err.message : 'Failed to send test audio',
            });
          }
          return;
        }
        if (content?.modelTurn?.parts?.some((part) => part.inlineData?.data)) {
          finish({ ok: true, receivedAudio: true });
          return;
        }
        if (content?.outputTranscription?.text) {
          finish({ ok: true, receivedText: true });
        }
      },
      onError: (e) => {
        finish({ ok: false, error: e.message || 'Live session error' });
      },
      onClose: (e) => {
        if (!settled) {
          finish({
            ok: false,
            closeCode: e.code,
            error: `Live session closed (code ${e.code})${e.reason ? `: ${e.reason}` : ''}`,
          });
        }
      },
    })
      .then((s) => {
        session = s;
        if (settled) {
          // The probe already resolved (timeout/cancel); close the stray session
          try {
            void Promise.resolve(s.close()).catch(() => {});
          } catch {
            // ignore
          }
        }
      })
      .catch((err) => {
        finish({ ok: false, error: extractCleanErrorMessage(err, 'Browser Live connect failed.') });
      });
  });
}
