import crypto from 'node:crypto';
import { fetchWithTelemetry } from '@aaa/observability';

export const OPENAI_REALTIME_CALLS_URL = 'https://api.openai.com/v1/realtime/calls';

/** Stable per-user id sent as OpenAI-Safety-Identifier. The raw user id is not sent. */
export function openAiSafetyIdentifier(userId: string): string {
  return crypto.createHash('sha256').update(userId).digest('hex');
}

export interface RealtimeSdpExchangeRequest {
  apiKey: string;
  userId: string;
  sdp: string;
  sessionConfig: unknown;
  telemetry: {
    component: string;
    eventPrefix: string;
    logResponseBodyOnFailure: boolean;
  };
}

export type RealtimeSdpExchangeResult =
  | { ok: true; answerSdp: string }
  | { ok: false; status: number; responseBody: string };

/**
 * Proxies a browser SDP offer to OpenAI Realtime and returns the answer SDP.
 *
 * Voice and Listener build different session configs, but they share this POST.
 * Callers map a failed exchange onto their own error code and logs.
 */
export async function exchangeRealtimeSdp(
  request: RealtimeSdpExchangeRequest,
): Promise<RealtimeSdpExchangeResult> {
  const formData = new FormData();
  formData.set('sdp', request.sdp);
  formData.set('session', JSON.stringify(request.sessionConfig));

  const response = await fetchWithTelemetry(
    OPENAI_REALTIME_CALLS_URL,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${request.apiKey}`,
        'OpenAI-Safety-Identifier': openAiSafetyIdentifier(request.userId),
      },
      body: formData,
    },
    {
      component: request.telemetry.component,
      provider: 'openai',
      eventPrefix: request.telemetry.eventPrefix,
      logResponseBodyOnFailure: request.telemetry.logResponseBodyOnFailure,
    },
  );

  if (!response.ok) {
    const responseBody = await response.text().catch(() => '');
    return { ok: false, status: response.status, responseBody };
  }

  return { ok: true, answerSdp: await response.text() };
}
