import { createChaosHandlers } from '@/lib/chaos-handlers';

const handlers = createChaosHandlers('memory-leak', '/internal/gateway/chaos/memory-leak');

export const POST = handlers.cleanup;
