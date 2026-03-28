export interface OpenAiUsageSample {
  model: string;
  promptTokens?: number;
  completionTokens?: number;
  inputTokens?: number;
  outputTokens?: number;
}

interface ModelPricing {
  inputPer1kUsd?: number;
  outputPer1kUsd?: number;
}

const DEFAULT_PRICING: Record<string, ModelPricing> = {
  'gpt-5-mini': { inputPer1kUsd: 0.00025, outputPer1kUsd: 0.002 },
  'text-embedding-3-small': { inputPer1kUsd: 0.00002 },
  'gpt-4o-mini-transcribe': { inputPer1kUsd: 0.0003 },
  'gpt-4o-mini-tts': { inputPer1kUsd: 0.0006 },
  'gpt-realtime-1.5': { inputPer1kUsd: 0.0003, outputPer1kUsd: 0.0012 },
};

function parseOverrides(): Record<string, ModelPricing> {
  const raw = process.env['OPENAI_PRICING_OVERRIDES_JSON'];
  if (!raw) {
    return {};
  }

  try {
    const parsed = JSON.parse(raw) as Record<string, ModelPricing>;
    return parsed;
  } catch {
    return {};
  }
}

export function estimateOpenAiCost(sample: OpenAiUsageSample): number {
  const pricing = {
    ...DEFAULT_PRICING,
    ...parseOverrides(),
  }[sample.model];

  if (!pricing) {
    return 0;
  }

  const promptTokens = sample.promptTokens ?? sample.inputTokens ?? 0;
  const completionTokens = sample.completionTokens ?? sample.outputTokens ?? 0;
  const inputUsd = (promptTokens / 1000) * (pricing.inputPer1kUsd ?? 0);
  const outputUsd = (completionTokens / 1000) * (pricing.outputPer1kUsd ?? 0);
  return Number((inputUsd + outputUsd).toFixed(8));
}
