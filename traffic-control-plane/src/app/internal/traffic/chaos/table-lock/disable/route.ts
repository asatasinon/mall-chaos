import { createChaosHandlers } from '@/lib/chaos-handlers';

const handlers = createChaosHandlers('table-lock', '/internal/gateway/chaos/table-lock');

export const POST = handlers.disable;
