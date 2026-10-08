// Durable admission replaces process-local IDs, fingerprints and locks.
// The same text with a different WhatsApp ID is a separate event.
export { MessageIdempotencyService } from '../whatsapp/MessageIdempotencyService.js'
