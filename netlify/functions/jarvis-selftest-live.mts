import type { Config } from '@netlify/functions';
import { createLiveAuthToken, LIVE_MODEL_ID } from './_lib/jarvis-core';

export default async () => {
  try {
    const token = await createLiveAuthToken();
    return Response.json({ ok: true, model: LIVE_MODEL_ID, mode: 'ephemeral-token' });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : 'Server could not provision a Live ephemeral token.';
    return Response.json(
      { ok: false, model: LIVE_MODEL_ID, mode: 'ephemeral-token', error: message },
      { status: 502 },
    );
  }
};

export const config: Config = { method: ['POST'] };
