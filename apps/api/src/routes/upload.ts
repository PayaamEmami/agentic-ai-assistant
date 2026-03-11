import type { FastifyInstance } from 'fastify';
import { authenticate } from '../middleware/auth.js';
import { UploadService } from '../services/upload-service.js';

export async function uploadRoutes(app: FastifyInstance) {
  const uploadService = new UploadService();

  app.addHook('preHandler', authenticate);

  app.post('/upload', async (request, reply) => {
    const file = await request.file();
    if (!file) {
      return reply
        .status(400)
        .send({ error: { code: 'NO_FILE', message: 'No file provided' } });
    }

    const result = await uploadService.handleUpload(request.user!.id, file);
    return reply.status(200).send(result);
  });
}
