import { createChaosHandlers } from '@/lib/chaos-handlers';

const handlers = createChaosHandlers('deadlock', '/internal/gateway/chaos/deadlock');

export const POST = handlers.enable;
