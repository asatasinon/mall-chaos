import { createChaosHandlers } from '@/lib/chaos-handlers';

const handlers = createChaosHandlers('network-reset', '/internal/gateway/network-reset');

export const POST = handlers.enable;
