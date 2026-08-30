import { createChatProvider, createEmbeddingProvider } from '@aaa/ai';
import { openAIProviderModelConfigFromApiConfig } from '@aaa/config';
import type { AppConfig } from '../config.js';
import { ApprovalService } from './approval/index.js';
import { AppService } from './app/index.js';
import { configureAppSyncQueue } from './app/index.js';
import { AutomationService, configureAutomationQueue } from './automation/index.js';
import { ChatService } from './chat/index.js';
import { ListenerService } from './listener/index.js';
import { PersonalizationService } from './personalization/index.js';
import { RetrievalBridge } from './retrieval/index.js';
import { configureMcpToolCache, configureToolExecutionQueue } from './tools/index.js';
import { UploadService } from './upload/index.js';
import { VoiceService } from './voice/index.js';

export interface ApiServices {
  approvalService: ApprovalService;
  appService: AppService;
  automationService: AutomationService;
  chatService: ChatService;
  listenerService: ListenerService;
  personalizationService: PersonalizationService;
  uploadService: UploadService;
  voiceService: VoiceService;
}

export function buildApiServices(config: AppConfig): ApiServices {
  const modelConfig = openAIProviderModelConfigFromApiConfig(config);
  const chatProvider = createChatProvider(
    config.openaiApiKey,
    modelConfig,
    config.llmChatProvider,
  );
  const embeddingProvider = createEmbeddingProvider(config.openaiApiKey, modelConfig);
  const personalizationService = new PersonalizationService();
  const retrievalBridge = new RetrievalBridge(config, embeddingProvider, {
    embeddingModel: config.openaiEmbeddingModel,
  });
  const enqueueToolExecutionJob = configureToolExecutionQueue(config);
  const enqueueAppSyncJob = configureAppSyncQueue(config);
  configureMcpToolCache(config);
  configureAutomationQueue(config);

  return {
    approvalService: new ApprovalService({ enqueueToolExecutionJob }),
    appService: new AppService(config, { enqueueAppSyncJob }),
    automationService: new AutomationService(),
    chatService: new ChatService({
      config,
      modelProvider: chatProvider,
      personalizationService,
      retrievalBridge,
      enqueueToolExecutionJob,
    }),
    listenerService: new ListenerService(config, chatProvider),
    personalizationService,
    uploadService: new UploadService(config, embeddingProvider, {
      embeddingModel: config.openaiEmbeddingModel,
    }),
    voiceService: new VoiceService(config, personalizationService, retrievalBridge, {
      enqueueToolExecutionJob,
    }),
  };
}
