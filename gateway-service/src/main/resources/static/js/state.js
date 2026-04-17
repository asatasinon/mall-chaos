// Service metadata — static config used by render and action modules.

export const slowSqlServices = [
  { id: "catalog",      label: "catalog",      role: "slow-sql" },
  { id: "inventory",    label: "inventory",    role: "slow-sql" },
  { id: "order",        label: "order",        role: "slow-sql+leak+deadlock" },
  { id: "payment",      label: "payment",      role: "slow-sql+leak+deadlock" },
  { id: "promotion",    label: "promotion",    role: "slow-sql" },
  { id: "risk",         label: "risk",         role: "slow-sql" },
  { id: "fulfillment",  label: "fulfillment",  role: "slow-sql" },
  { id: "notification", label: "notification", role: "slow-sql" }
];

export const topologyServices = [
  { id: "gateway",     label: "gateway",     role: "ingress" },
  { id: "order",       label: "order",       role: "orchestration" },
  { id: "payment",     label: "payment",     role: "payment" },
  { id: "inventory",   label: "inventory",   role: "stock" },
  { id: "catalog",     label: "catalog",     role: "product" },
  { id: "promotion",   label: "promotion",   role: "coupon" },
  { id: "risk",        label: "risk",        role: "risk-check" },
  { id: "fulfillment", label: "fulfillment", role: "shipping" }
];

export const GRAFANA_BASE_STORAGE_KEY = "castrel.chaos.grafanaBaseUrl";

// Mutable runtime state shared across modules.
export const state = {
  slowSql: {},
  memory: {},
  deadlock: {},
  topology: {},
  lastTraceId: "-",
  backoffUntil: {},
  toxiproxyBackoffUntil: 0
};
