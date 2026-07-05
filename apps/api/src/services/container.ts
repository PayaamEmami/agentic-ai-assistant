import { OpenAIProvider } from '@aaa/ai';
import { openAIProviderModelConfigFromApiConfig } from '@aaa/config';
import type { AppConfig } from '../config.js';
import { ApprovalService } from './approval/index.js';
import { AppService } from './app/index.js';
import { configureAppSyncQueue } from './app/index.js';
import { ChatService } from './chat/index.js';
import { PersonalizationService } from './personalization/index.js';
import { RetrievalBridge } from './retrieval/index.js';
import { configureToolExecutionQueue } from './tools/index.js';
import { UploadService } from './upload/index.js';
import { VoiceService } from './voice/index.js';

export interface ApiServices {
  approvalService: ApprovalService;
  appService: AppService;
  chatService: ChatService;
  personalizationService: PersonalizationService;
  uploadService: UploadService;
  voiceService: VoiceService;
}

export function buildApiServices(config: AppConfig): ApiServices {
  const modelProvider = new OpenAIProvider(
    config.openaiApiKey,
    openAIProviderModelConfigFromApiConfig(config),
  );
  const personalizationService = new PersonalizationService();
  const retrievalBridge = new RetrievalBridge(config, modelProvider, {
    embeddingModel: config.openaiEmbeddingModel,
  });
  const enqueueToolExecutionJob = configureToolExecutionQueue(config);
  const enqueueAppSyncJob = configureAppSyncQueue(config);

  return {
    approvalService: new ApprovalService({ enqueueToolExecutionJob }),
    appService: new AppService(config, { enqueueAppSyncJob }),
    chatService: new ChatService({
      config,
      modelProvider,
      personalizationService,
      retrievalBridge,
      enqueueToolExecutionJob,
    }),
    personalizationService,
    uploadService: new UploadService(config, modelProvider, {
      embeddingModel: config.openaiEmbeddingModel,
    }),
    voiceService: new VoiceService(config, personalizationService, retrievalBridge, {
      enqueueToolExecutionJob,
    }),
  };
}
