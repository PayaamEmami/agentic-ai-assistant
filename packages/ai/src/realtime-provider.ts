export interface RealtimeTool {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export interface RealtimeExchangeTelemetry {
  component: string;
  eventPrefix: string;
  logResponseBodyOnFailure: boolean;
}

export type RealtimeExchangeResult =
  | { ok: true; answerSdp: string }
  | { ok: false; status: number; responseBody: string };

export interface RealtimeVoiceConnectInput {
  userId: string;
  sdp: string;
  model: string;
  voice: string;
  transcriptionModel: string;
  instructions: string;
  tools: RealtimeTool[];
  telemetry: RealtimeExchangeTelemetry;
}

export interface RealtimeListenerConnectInput {
  userId: string;
  sdp: string;
  model: string;
  telemetry: RealtimeExchangeTelemetry;
}

/**
 * Live voice and listener sessions. The browser keeps the WebRTC connection.
 * The provider turns an SDP offer plus a session description into the answer SDP.
 */
export interface RealtimeProvider {
  /** Tool name as this provider sends it on the live session. */
  toolName(name: string): string;
  connectVoice(input: RealtimeVoiceConnectInput): Promise<RealtimeExchangeResult>;
  connectListener(input: RealtimeListenerConnectInput): Promise<RealtimeExchangeResult>;
}
