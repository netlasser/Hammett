import type { Config } from '@netlify/functions';
import { getAiClient } from './_lib/jarvis-core';

export default async () => {
  return Response.json({ configured: getAiClient() !== null });
};

export const config: Config = { method: ['GET'] };
