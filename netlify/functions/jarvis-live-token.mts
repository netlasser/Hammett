import type { Config } from '@netlify/functions';
import { createLiveAuthToken, LIVE_MODEL_ID } from './_lib/jarvis-core';

export default async () => {
  try {
    const token = await createLiveAuthToken();
    return Response.json({ token: token.name, model: LIVE_MODEL_ID, expiresInSeconds: 1800 });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : 'Server could not provision a Live ephemeral token.';
    return Response.json({ error: message }, { status: 502 });
  }
};

export const config: Config = { method: ['POST'] };
