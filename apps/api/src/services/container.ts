import { OpenAIProvider } from '@aaa/ai';
import type { AppConfig } from '../config.js';
import { ApprovalService } from './approval-service.js';
import { AppService } from './app-service.js';
import { ChatService } from './chat-service.js';
import { McpService } from './mcp-service.js';
import { PersonalizationService } from './personalization-service.js';
import { RetrievalBridge } from './retrieval-bridge.js';
import { UploadService } from './upload-service.js';
import { VoiceService } from './voice-service.js';

export interface ApiServices {
  approvalService: ApprovalService;
  appService: AppService;
  chatService: ChatService;
  mcpService: McpService;
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
  const retrievalBridge = new RetrievalBridge(modelProvider, {
    embeddingModel: config.openaiEmbeddingModel,
  });

  return {
    approvalService: new ApprovalService(),
    appService: new AppService({ config }),
    chatService: new ChatService({
      config,
      modelProvider,
      personalizationService,
      retrievalBridge,
    }),
    mcpService: new McpService(),
    personalizationService,
    uploadService: new UploadService(modelProvider, {
      embeddingModel: config.openaiEmbeddingModel,
    }),
    voiceService: new VoiceService(personalizationService, retrievalBridge, { config }),
  };
}
