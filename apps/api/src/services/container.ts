import { OpenAIProvider } from '@aaa/ai';
import type { AppConfig } from '../config.js';
import { ApprovalService } from './approval-service.js';
import { AppService } from './app-service.js';
import { configureAppSyncQueue } from './app-queue.js';
import { ChatService } from './chat-service.js';
import { PersonalizationService } from './personalization-service.js';
import { RetrievalBridge } from './retrieval-bridge.js';
import { configureToolExecutionQueue } from './tool-execution-queue.js';
import { UploadService } from './upload-service.js';
import { VoiceService } from './voice-service.js';

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
    config.openaiModel,
    config.openaiEmbeddingModel,
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
