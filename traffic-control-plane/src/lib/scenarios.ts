import { getGatewayClient } from '@/lib/gateway-client';
import pino from 'pino';

const log = pino({ name: 'scenarios' });

export interface Scenario {
  id: string;
  name: string;
  description: string;
  steps: ScenarioStep[];
}

export interface ScenarioStep {
  type: 'chaos' | 'network';
  action: 'enable' | 'disable' | 'cleanup';
  path: string;
  body: unknown;
}

export const PRESET_SCENARIOS: Scenario[] = [
  {
    id: 's1',
    name: 'Slow SQL Cascade',
    description: 'Enable slow SQL on order + payment services',
    steps: [
      {
        type: 'chaos',
        action: 'enable',
        path: '/internal/gateway/chaos/slow-sql/enable',
        body: {
          targets: ['order-service', 'payment-service'],
          joinTable: 'user_behavior_log',
          limitRows: 1,
          offsetRows: 200000,
          durationSec: 300,
        },
      },
    ],
  },
  {
    id: 's2',
    name: 'Memory Pressure',
    description: 'Inject memory leak on order-service',
    steps: [
      {
        type: 'chaos',
        action: 'enable',
        path: '/internal/gateway/chaos/memory-leak/enable',
        body: {
          targets: ['order-service'],
          chunkSizeKb: 512,
          intervalMs: 500,
          maxMb: 256,
          durationSec: 300,
        },
      },
    ],
  },
  {
    id: 's3',
    name: 'Deadlock Storm',
    description: 'Trigger deadlocks on payment-service',
    steps: [
      {
        type: 'chaos',
        action: 'enable',
        path: '/internal/gateway/chaos/deadlock/enable',
        body: {
          targets: ['payment-service'],
          injectRate: 0.5,
          scope: 'ALL',
          durationSec: 300,
        },
      },
    ],
  },
  {
    id: 's4',
    name: 'Network Partition',
    description: 'Inject network delay on inventory-service proxy',
    steps: [
      {
        type: 'network',
        action: 'enable',
        path: '/internal/gateway/network-delay/enable',
        body: {
          proxyName: 'order-to-inventory',
          latencyMs: 5000,
          jitter: 2000,
        },
      },
    ],
  },
  {
    id: 's5',
    name: 'Table Lock Contention',
    description: 'Lock orders table on order-service',
    steps: [
      {
        type: 'chaos',
        action: 'enable',
        path: '/internal/gateway/chaos/table-lock/enable',
        body: {
          targetService: 'order-service',
          targetTable: 'orders',
          durationSec: 300,
        },
      },
    ],
  },
  {
    id: 's6',
    name: 'Full Chaos',
    description: 'Enable all chaos types simultaneously',
    steps: [
      {
        type: 'chaos',
        action: 'enable',
        path: '/internal/gateway/chaos/slow-sql/enable',
        body: {
          targets: ['order-service', 'payment-service'],
          joinTable: 'user_behavior_log',
          limitRows: 1,
          offsetRows: 200000,
          durationSec: 300,
        },
      },
      {
        type: 'chaos',
        action: 'enable',
        path: '/internal/gateway/chaos/memory-leak/enable',
        body: {
          targets: ['order-service'],
          chunkSizeKb: 256,
          intervalMs: 1000,
          maxMb: 128,
          durationSec: 300,
        },
      },
      {
        type: 'chaos',
        action: 'enable',
        path: '/internal/gateway/chaos/deadlock/enable',
        body: {
          targets: ['payment-service'],
          injectRate: 0.3,
          scope: 'PARTIAL',
          durationSec: 300,
        },
      },
    ],
  },
];

export async function executeScenario(scenario: Scenario, traceId: string): Promise<{
  scenarioId: string;
  results: { step: number; success: boolean; error?: string }[];
}> {
  const gateway = getGatewayClient();
  const results: { step: number; success: boolean; error?: string }[] = [];

  for (let i = 0; i < scenario.steps.length; i++) {
    const step = scenario.steps[i];
    try {
      await gateway.post(step.path, step.body, traceId);
      results.push({ step: i, success: true });
    } catch (e: any) {
      log.error({ error: e.message, step: i, scenarioId: scenario.id }, 'Scenario step failed');
      results.push({ step: i, success: false, error: e.message });
    }
  }

  return { scenarioId: scenario.id, results };
}

export async function recoverAll(traceId: string): Promise<{
  results: { type: string; success: boolean; error?: string }[];
}> {
  const gateway = getGatewayClient();
  const disableActions = [
    { type: 'slow-sql', path: '/internal/gateway/chaos/slow-sql/disable', body: { targets: [] } },
    { type: 'memory-leak', path: '/internal/gateway/chaos/memory-leak/disable', body: { targets: [] } },
    { type: 'memory-leak-cleanup', path: '/internal/gateway/chaos/memory-leak/cleanup', body: { targets: [] } },
    { type: 'deadlock', path: '/internal/gateway/chaos/deadlock/disable', body: { targets: [] } },
    { type: 'deadlock-cleanup', path: '/internal/gateway/chaos/deadlock/cleanup', body: { targets: [] } },
    {
      type: 'table-lock',
      path: '/internal/gateway/chaos/table-lock/disable',
      body: { targetService: 'order-service', targetTable: 'orders' },
    },
    { type: 'network-delay-order-payment', path: '/internal/gateway/network-delay/disable', body: { proxyName: 'order-to-payment' } },
    { type: 'network-delay-order-inventory', path: '/internal/gateway/network-delay/disable', body: { proxyName: 'order-to-inventory' } },
    { type: 'network-delay-gateway-order', path: '/internal/gateway/network-delay/disable', body: { proxyName: 'gateway-to-order' } },
    { type: 'network-reset-order-payment', path: '/internal/gateway/network-reset/disable', body: { proxyName: 'order-to-payment' } },
    { type: 'network-reset-order-inventory', path: '/internal/gateway/network-reset/disable', body: { proxyName: 'order-to-inventory' } },
    { type: 'network-reset-gateway-order', path: '/internal/gateway/network-reset/disable', body: { proxyName: 'gateway-to-order' } },
  ];

  const results: { type: string; success: boolean; error?: string }[] = [];

  // Execute all disable actions in parallel
  await Promise.allSettled(
    disableActions.map(async ({ type, path, body }) => {
      try {
        await gateway.post(path, body, traceId);
        results.push({ type, success: true });
      } catch (e: any) {
        results.push({ type, success: false, error: e.message });
      }
    })
  );

  return { results };
}

export async function recoverScenario(scenario: Scenario, traceId: string): Promise<{
  scenarioId: string;
  results: { path: string; success: boolean; error?: string }[];
}> {
  const gateway = getGatewayClient();
  const results: { path: string; success: boolean; error?: string }[] = [];

  const recoverActions: { path: string; body: unknown }[] = [];
  for (const step of scenario.steps) {
    if (step.action !== 'enable') continue;
    const disablePath = step.path.replace('/enable', '/disable');
    recoverActions.push({ path: disablePath, body: step.body });
    // memory-leak and deadlock also need cleanup
    if (step.path.includes('/memory-leak/') || step.path.includes('/deadlock/')) {
      const cleanupPath = step.path.replace('/enable', '/cleanup');
      recoverActions.push({ path: cleanupPath, body: step.body });
    }
  }

  await Promise.allSettled(
    recoverActions.map(async ({ path, body }) => {
      try {
        await gateway.post(path, body, traceId);
        results.push({ path, success: true });
      } catch (e: any) {
        log.warn({ error: e.message, path, scenarioId: scenario.id }, 'Scenario recover step failed');
        results.push({ path, success: false, error: e.message });
      }
    })
  );

  return { scenarioId: scenario.id, results };
}
