import type { FastifyInstance } from 'fastify';
import {
  CreateMemoryRequest,
  UpdateMemoryRequest,
  UpdatePersonalizationProfileRequest,
} from '@aaa/shared';
import { authenticate } from '../middleware/auth.js';
import { PersonalizationService } from '../services/personalization-service.js';

function toProfileResponse(profile: { writingStyle: string | null; tonePreference: string | null }) {
  return {
    writingStyle: profile.writingStyle,
    tonePreference: profile.tonePreference,
  };
}

function toMemoryResponse(memory: {
  id: string;
  kind: string;
  content: string;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: memory.id,
    kind: memory.kind,
    content: memory.content,
    createdAt: memory.createdAt.toISOString(),
    updatedAt: memory.updatedAt.toISOString(),
  };
}

export async function personalizationRoutes(app: FastifyInstance) {
  const personalizationService = new PersonalizationService();

  app.addHook('preHandler', authenticate);

  app.get('/personalization', async (request, reply) => {
    const personalization = await personalizationService.getPersonalization(request.user!.id);
    return reply.status(200).send({
      profile: toProfileResponse(personalization.profile),
      memories: personalization.memories.map(toMemoryResponse),
    });
  });

  app.put('/personalization/profile', async (request, reply) => {
    const parsed = UpdatePersonalizationProfileRequest.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({
        error: { code: 'VALIDATION_ERROR', message: parsed.error.message },
      });
    }

    const profile = await personalizationService.updateProfile(request.user!.id, parsed.data);
    return reply.status(200).send({
      profile: toProfileResponse(profile),
    });
  });

  app.post('/personalization/memories', async (request, reply) => {
    const parsed = CreateMemoryRequest.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({
        error: { code: 'VALIDATION_ERROR', message: parsed.error.message },
      });
    }

    const memory = await personalizationService.createMemory(
      request.user!.id,
      parsed.data.kind,
      parsed.data.content,
    );
    return reply.status(201).send({ memory: toMemoryResponse(memory) });
  });

  app.patch<{ Params: { id: string } }>(
    '/personalization/memories/:id',
    async (request, reply) => {
      const parsed = UpdateMemoryRequest.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({
          error: { code: 'VALIDATION_ERROR', message: parsed.error.message },
        });
      }

      const memory = await personalizationService.updateMemory(
        request.user!.id,
        request.params.id,
        parsed.data.content,
      );
      return reply.status(200).send({ memory: toMemoryResponse(memory) });
    },
  );

  app.delete<{ Params: { id: string } }>(
    '/personalization/memories/:id',
    async (request, reply) => {
      await personalizationService.deleteMemory(request.user!.id, request.params.id);
      return reply.status(200).send({ ok: true });
    },
  );
}
