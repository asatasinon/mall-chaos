export type Severity = 'critical' | 'warning' | 'info';
export type Match = 'all' | Severity;
export type SourceKind = 'prometheus-rules' | 'alertmanager';
export type AlertTab = 'rules' | 'routing' | 'yaml';
export type CreateAlertMode = 'rule' | 'prometheus-rules';

export interface Rule {
  id?: number;
  isDraft?: boolean;
  ruleName: string;
  groupName: string;
  intervalSec: number;
  expression: string;
  forDuration: string;
  severity: Severity;
  summary: string;
  description: string;
  enabled: boolean;
}

export interface Receiver {
  id?: number;
  isDraft?: boolean;
  receiverName: string;
  receiverType: 'webhook';
  endpoint: string;
  basicAuthUsername?: string;
  basicAuthPassword?: string;
  basicAuthPasswordSet?: boolean;
  severityMatch: Match;
  sendResolved: boolean;
  enabled: boolean;
}

export interface AlertRoute {
  isDraft?: boolean;
  receiver: string;
  match: Record<string, string>;
  groupBy?: string[];
  groupWait?: string;
  groupInterval?: string;
  repeatInterval?: string;
  continue: boolean;
}

export interface AlertRouteConfig {
  receiver: string;
  groupBy: string[];
  groupWait: string;
  groupInterval: string;
  repeatInterval: string;
  continue: boolean;
  routes: AlertRoute[];
}

export interface AlertConfig {
  version: number;
  rules: Rule[];
  receivers: Receiver[];
  updatedAt: string | null;
  route: AlertRouteConfig;
}

export const blankRule = (): Rule => ({
  ruleName: 'NewAlert',
  groupName: 'castrel-custom',
  intervalSec: 30,
  expression: 'up == 0',
  forDuration: '1m',
  severity: 'warning',
  summary: 'Service issue',
  description: 'Service unavailable.',
  enabled: true,
});

export const blankReceiver = (): Receiver => ({
  receiverName: 'custom-receiver',
  receiverType: 'webhook',
  endpoint: 'https://example.com/webhook',
  basicAuthUsername: '',
  basicAuthPassword: '',
  severityMatch: 'all',
  sendResolved: true,
  enabled: true,
});

export const blankRoute = (): AlertRoute => ({ receiver: 'custom-receiver', match: { severity: 'warning' }, continue: false });
export const DRAFT_WRAPPER_CLASS = 'rounded-xl bg-amber-500/10 p-1 ring-2 ring-amber-500/60 scroll-mt-24 focus:outline-none';
export const INPUT_CLASS = 'w-full h-8 rounded-md border border-input bg-background px-2.5 text-sm outline-none focus:ring-2 focus:ring-ring/40';
export const AREA_CLASS = 'w-full min-h-20 rounded-md border border-input bg-background px-2.5 py-1.5 text-sm font-mono outline-none focus:ring-2 focus:ring-ring/40';
