import { createChaosHandlers } from '@/lib/chaos-handlers';

const handlers = createChaosHandlers('storage-growth', '/internal/gateway/chaos/storage-growth');

export const GET = handlers.status;
