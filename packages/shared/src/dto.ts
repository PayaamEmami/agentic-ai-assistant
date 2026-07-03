// Back-compat barrel. DTO schemas are organized by domain under `dto/*`; this
// module re-exports them so `./dto.js` and `@aaa/shared` keep their existing
// flat surface.
export * from './dto/content.js';
export * from './dto/auth.js';
export * from './dto/chat.js';
export * from './dto/voice.js';
export * from './dto/apps.js';
export * from './dto/personalization.js';
export * from './dto/observability.js';
export * from './dto/system.js';
