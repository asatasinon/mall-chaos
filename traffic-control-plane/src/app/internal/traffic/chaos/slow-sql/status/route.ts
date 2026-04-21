import { createChaosHandlers } from '@/lib/chaos-handlers';

const handlers = createChaosHandlers('slow-sql', '/internal/gateway/chaos/slow-sql');

export const GET = handlers.status;
