export type Parameter = {
  name: string;
  kind: 'integer' | 'number' | 'string';
  unit?: 'bytes';
  required?: boolean;
  default?: number | string;
  options?: readonly string[];
  min?: number;
  max?: number;
  maxLength?: number;
};

export type Scenario = {
  scenario: string;
  targetService: string;
  targetOperation: string;
  maxDurationSec: number;
  recoveryStrategy: string;
  allowManualCleanup: boolean;
  parameters: Parameter[];
};

export type FaultRun = {
  faultRunId: string;
  scenario: string;
  targetService: string;
  targetOperation: string;
  state: string;
  expiresAt: string;
  createdAt: string;
  operatorAuditId?: number | null;
};

export type Event = { id: number; eventType: string; payload?: unknown; createdAt: string };
export type ConsoleData = { scenarios: Scenario[]; runs: FaultRun[] };
export type FaultRunDetails = { run: FaultRun; events: Event[] };
