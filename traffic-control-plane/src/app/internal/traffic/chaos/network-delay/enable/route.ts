import { createChaosHandlers } from '@/lib/chaos-handlers';

const handlers = createChaosHandlers('network-delay', '/internal/gateway/network-delay');

export const POST = handlers.enable;
