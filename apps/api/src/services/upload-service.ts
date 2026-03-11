import type { MultipartFile } from '@fastify/multipart';
import { logger } from '../lib/logger.js';

export class UploadService {
  async handleUpload(_userId: string, file: MultipartFile) {
    // TODO: implement file upload:
    // 1. Validate file type and size
    // 2. Upload to S3
    // 3. Create attachment record in database
    // 4. Return attachment metadata

    logger.info(
      { fileName: file.filename, mimeType: file.mimetype },
      'Processing upload',
    );

    const attachmentId = crypto.randomUUID();
    const buffer = await file.toBuffer();

    return {
      attachmentId,
      fileName: file.filename,
      mimeType: file.mimetype,
      sizeBytes: buffer.byteLength,
    };
  }
}
