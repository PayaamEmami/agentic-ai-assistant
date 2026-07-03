// Thin back-compat facade. The API surface is now split by domain under
// `lib/api/*`; this module re-exports everything so existing
// `@/lib/api-client` imports keep working.
export * from './api';
