'use client';

import { useState } from 'react';
import { Activity, Check, ChevronDown, Database, Gauge, Play, Search, ServerCog, Square, Timer } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { PROVIDER_OUTCOMES, SCENARIO_META } from '@/components/scenarios/meta';
import { formatBytes } from '@/components/scenarios/fault-run-view';
import type { FaultRun, Scenario } from '@/components/scenarios/types';

interface ScenarioCardWithActionsProps {
  scenario: Scenario;
  activeRun?: FaultRun;
  unavailableRun?: FaultRun;
  busy: boolean;
  onCreate: (scenario: Scenario, parameters: Record<string, number | string>) => Promise<void>;
  onDetails: (run: FaultRun) => Promise<void>;
  onStop: (run: FaultRun) => Promise<void>;
  onRestart?: (run?: FaultRun) => void;
}

export default function ScenarioCardWithActions({ scenario, activeRun, unavailableRun, busy, onCreate, onDetails, onStop, onRestart }: ScenarioCardWithActionsProps) {
  const meta = SCENARIO_META[scenario.scenario] || { label: scenario.scenario, description: 'Catalog-defined scenario.', icon: Activity, tone: 'text-primary' };
  const Icon = meta.icon;
  const isCatalogHashScenario = scenario.scenario === 'CATALOG_REDIS_LARGE_VALUE';
  const [values, setValues] = useState<Record<string, string>>(() => Object.fromEntries(scenario.parameters.map((parameter) => [parameter.name, String(parameter.default ?? '')])));
  const setValue = (name: string, value: string) => setValues((current) => ({ ...current, [name]: value }));
  const submit = async () => {
    const parameters = Object.fromEntries(Object.entries(values).filter(([, value]) => value !== '').map(([key, value]) => {
      const parameter = scenario.parameters.find((item) => item.name === key);
      return [key, parameter?.kind === 'string' || parameter?.unit === 'bytes' ? value : Number(value)];
    }));
    await onCreate(scenario, parameters);
  };
  const isActiveScenario = activeRun?.scenario === scenario.scenario;
  const locked = Boolean(activeRun) && !isActiveScenario;
  const restartRun = scenario.scenario === 'NOTIFICATION_HEAP_PRESSURE' && unavailableRun?.state === 'SERVICE_UNAVAILABLE'
    ? unavailableRun : undefined;
  const providerOutcomeIsValid = !scenario.parameters.some((parameter) => parameter.name === 'providerOutcome')
    || PROVIDER_OUTCOMES.some((outcome) => outcome.value === values.providerOutcome);

  return <Card className={`!overflow-visible transition-opacity ${locked ? 'opacity-70' : ''}`}>
    <CardHeader className="gap-3 border-b border-border/70 pb-4">
      <div className="flex items-start justify-between gap-4"><div className="flex gap-3"><span className={`mt-0.5 rounded-md bg-muted p-2 ${meta.tone}`}><Icon className="size-5" /></span><div><CardTitle className="text-base">{meta.label}</CardTitle><p className="mt-1 text-xs leading-5 text-muted-foreground">{meta.description}</p></div></div><Badge variant="outline">{scenario.recoveryStrategy}</Badge></div>
      <div className="flex flex-wrap items-center justify-between gap-3"><div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-muted-foreground"><span>Target <strong className="font-medium text-foreground">{scenario.targetService}</strong></span><span>Operation <strong className="font-medium text-foreground">{scenario.targetOperation}</strong></span><span>Limit <strong className="font-medium text-foreground">{scenario.maxDurationSec}s</strong></span></div><div className="flex items-center gap-2"><Button variant={isActiveScenario ? 'destructive' : 'default'} size="sm" onClick={() => isActiveScenario && activeRun ? void onStop(activeRun) : void submit()} disabled={locked || Boolean(restartRun) || busy || !providerOutcomeIsValid}>{isActiveScenario ? <Square className="size-3.5" /> : <Play className="size-3.5" />}{busy ? (isActiveScenario ? 'Stopping...' : 'Starting...') : isActiveScenario ? 'Stop' : restartRun ? 'Unavailable' : locked ? 'Locked' : 'Start'}</Button>{scenario.scenario === 'NOTIFICATION_HEAP_PRESSURE' && onRestart && <Button variant="destructive" size="sm" onClick={() => onRestart(restartRun)} disabled={busy}><ServerCog className="size-3.5" />{busy ? 'Restarting...' : 'Restart notification'}</Button>}</div></div>
    </CardHeader>
    <CardContent className="space-y-4 pt-4">
      {['BROWSE_REPORT_SQL', 'ORDER_REPORT_SQL'].includes(scenario.scenario) && <div className="grid grid-cols-3 gap-2 rounded-md bg-muted/50 p-3 text-[11px]"><ScenarioDetail label="Data window" value="Today / 180-day partitions" /><ScenarioDetail label="Baseline" value="Historical scan" /><ScenarioDetail label="Fix status" value="Awaiting plan evidence" /></div>}
      {isCatalogHashScenario ? <CatalogHashParameters scenario={scenario} values={values} onChange={setValue} disabled={locked || busy} /> : <div className="grid grid-cols-2 gap-3">{scenario.parameters.map((parameter) => {
        const isProviderOutcome = parameter.name === 'providerOutcome';
        const isByteParameter = parameter.unit === 'bytes';
        return <label key={parameter.name} className="space-y-1.5 text-xs"><span className="flex justify-between gap-2 text-muted-foreground"><span>{isProviderOutcome ? 'Provider outcome' : parameter.name}</span><span>{parameter.required ? 'required' : 'optional'}</span></span>{isProviderOutcome ? <ProviderOutcomeSelect value={values[parameter.name] || ''} onChange={(value) => setValue(parameter.name, value)} options={parameter.options} disabled={locked || Boolean(busy)} /> : <input className="h-9 w-full rounded-md border border-input bg-background px-2.5 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring" type={parameter.kind === 'string' || isByteParameter ? 'text' : 'number'} inputMode={isByteParameter ? 'text' : undefined} min={parameter.min} max={parameter.max} maxLength={parameter.maxLength} value={values[parameter.name] || ''} onChange={(event) => setValue(parameter.name, event.target.value)} disabled={locked || busy} />}</label>;
      })}</div>}
      <div className="flex items-center justify-between gap-3"><span className="text-[11px] text-muted-foreground">{restartRun ? 'Notification service is unavailable; restart the fixed target before starting another run.' : locked ? 'An active run is already locking this control.' : isActiveScenario ? 'The active run can be stopped from the target row.' : isCatalogHashScenario ? 'One Hash, N SKU fields. The service performs the final budget and SKU validation.' : 'Parameters are validated by the scenario catalog.'}</span>{isActiveScenario && <button type="button" className="text-left text-xs text-primary hover:underline" onClick={() => void onDetails(activeRun)}>View current run details <span aria-hidden="true">→</span></button>}</div>
    </CardContent>
  </Card>;
}

const CATALOG_PARAMETER_COPY: Record<string, { label: string; description: string }> = {
  durationSec: { label: 'Run duration', description: 'How long the target stays active.' },
  concurrency: { label: 'Read concurrency', description: 'In-flight detail requests, not field count.' },
  requestIntervalMs: { label: 'Request interval', description: 'Pause between reader batches.' },
  memberCount: { label: 'Hash fields (N)', description: 'SKU fields generated in one Hash.' },
  memberSizeBytes: { label: 'Value size (S)', description: 'Logical UTF-8 bytes per field.' },
  keyTtlSec: { label: 'Safety TTL', description: 'Target-side cleanup fallback.' },
};

function CatalogHashParameters({ scenario, values, onChange, disabled }: { scenario: Scenario; values: Record<string, string>; onChange: (name: string, value: string) => void; disabled: boolean }) {
  const memberCount = parseInteger(values.memberCount);
  const memberSizeBytes = parseBytes(values.memberSizeBytes);
  const logicalBytes = memberCount !== null && memberSizeBytes !== null ? memberCount * memberSizeBytes : null;
  const budgetLabel = logicalBytes === null ? 'Enter valid N and S' : formatBytes(logicalBytes);

  return <div className="space-y-4">
    <div className="overflow-hidden rounded-lg border border-primary/20 bg-primary/[0.04]">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-primary/10 px-4 py-3">
        <div className="flex items-start gap-3"><span className="flex size-9 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary"><Database className="size-4.5" /></span><div><p className="text-xs font-semibold uppercase tracking-[0.16em] text-primary">Hash topology</p><p className="mt-1 text-sm font-medium">1 Redis Hash <span className="text-muted-foreground">·</span> {memberCount ?? 'N'} SKU fields</p></div></div>
        <Badge variant="outline" className="border-primary/30 text-primary">Catalog-owned</Badge>
      </div>
      <div className="grid grid-cols-2 divide-x divide-primary/10 sm:grid-cols-4">
        <CatalogMetric icon={<Database className="size-3.5" />} label="Fields" value={memberCount === null ? 'n/a' : String(memberCount)} />
        <CatalogMetric icon={<Gauge className="size-3.5" />} label="Per field" value={memberSizeBytes === null ? 'n/a' : formatBytes(memberSizeBytes)} />
        <CatalogMetric icon={<Database className="size-3.5" />} label="Logical budget" value={budgetLabel} />
        <CatalogMetric icon={<Timer className="size-3.5" />} label="Reader" value={values.concurrency ? `${values.concurrency} concurrent` : 'n/a'} />
      </div>
    </div>
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">{scenario.parameters.map((parameter) => {
      const copy = CATALOG_PARAMETER_COPY[parameter.name] || { label: parameter.name, description: 'Catalog-validated parameter.' };
      const isBytes = parameter.unit === 'bytes';
      return <label key={parameter.name} className="min-w-0 space-y-1.5 text-xs"><span className="block font-medium text-foreground">{copy.label}</span><span className="block min-h-8 text-[11px] leading-4 text-muted-foreground">{copy.description}</span><input aria-label={copy.label} className="h-9 w-full rounded-md border border-input bg-background px-2.5 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring" type={isBytes ? 'text' : 'number'} inputMode={isBytes ? 'text' : 'numeric'} min={parameter.min} max={parameter.max} maxLength={parameter.maxLength} value={values[parameter.name] || ''} onChange={(event) => onChange(parameter.name, event.target.value)} disabled={disabled} /></label>;
    })}</div>
    <div className="flex items-start gap-2 rounded-md border border-border/70 bg-muted/40 px-3 py-2.5 text-[11px] leading-4 text-muted-foreground"><Timer className="mt-0.5 size-3.5 shrink-0 text-primary" /><span>Logical payload = N × S. Read concurrency only controls pressure; it never creates more fields. The Catalog target rejects values outside the server budget.</span></div>
  </div>;
}

function CatalogMetric({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return <div className="min-w-0 px-3 py-2.5 first:pl-4 last:pr-4"><div className="flex items-center gap-1.5 text-[10px] uppercase tracking-[0.12em] text-muted-foreground">{icon}<span>{label}</span></div><p className="mt-1 truncate text-sm font-semibold tabular-nums text-foreground">{value}</p></div>;
}

function parseInteger(value: string | undefined): number | null {
  if (!value || !/^\d+$/.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

function parseBytes(value: string | undefined): number | null {
  if (!value) return null;
  const match = value.trim().match(/^(\d+(?:\.\d+)?)(B|KB?|MB?|GB?)?$/i);
  if (!match) return null;
  const multipliers: Record<string, number> = { B: 1, K: 1024, KB: 1024, M: 1024 ** 2, MB: 1024 ** 2, G: 1024 ** 3, GB: 1024 ** 3 };
  const parsed = Number(match[1]) * (match[2] ? multipliers[match[2].toUpperCase()] : 1);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

function ProviderOutcomeSelect({ value, onChange, options, disabled }: { value: string; onChange: (value: string) => void; options?: readonly string[]; disabled: boolean }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const choices = PROVIDER_OUTCOMES.filter((outcome) => options?.includes(outcome.value) ?? true);
  const filteredChoices = choices.filter((outcome) => `${outcome.value} ${outcome.label}`.toLowerCase().includes(query.toLowerCase()));
  const selected = choices.find((outcome) => outcome.value === value);
  const select = (nextValue: string) => {
    onChange(nextValue);
    setQuery('');
    setOpen(false);
  };

  return <div className="relative">
    <button type="button" className="flex h-9 w-full items-center justify-between rounded-md border border-input bg-background px-2.5 text-left text-sm outline-none transition-colors hover:bg-muted/50 focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50" aria-haspopup="listbox" aria-expanded={open} onClick={() => setOpen((current) => !current)} disabled={disabled}><span className={selected ? 'text-foreground' : 'text-muted-foreground'}>{selected?.label || 'Select outcome'}</span><ChevronDown className={`size-4 text-muted-foreground transition-transform ${open ? 'rotate-180' : ''}`} /></button>
    {open && <div className="absolute left-0 right-0 top-11 z-30 overflow-hidden rounded-md border border-border bg-popover p-1.5 text-popover-foreground shadow-lg" role="listbox" aria-label="Provider outcomes"><div className="flex items-center gap-2 rounded border border-input bg-background px-2"><Search className="size-3.5 shrink-0 text-muted-foreground" /><input autoFocus type="search" className="h-8 min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground" placeholder="Search outcomes" value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={(event) => { if (event.key === 'Escape') setOpen(false); if (event.key === 'Enter' && filteredChoices[0]) select(filteredChoices[0].value); }} /></div><div className="mt-1 space-y-0.5">{filteredChoices.length ? filteredChoices.map((outcome) => <button key={outcome.value} type="button" role="option" aria-selected={outcome.value === value} className="provider-option flex w-full items-center justify-between rounded px-2 py-1.5 text-left text-sm" onClick={() => select(outcome.value)}><span className="font-medium">{outcome.label}</span>{outcome.value === value && <Check className="provider-option-check size-4" />}</button>) : <p className="px-2 py-2 text-xs text-muted-foreground">No matching outcomes.</p>}</div></div>}
  </div>;
}

function ScenarioDetail({ label, value }: { label: string; value: string }) {
  return <div><p className="text-[11px] uppercase tracking-wider text-muted-foreground">{label}</p><p className="mt-1 truncate text-sm font-medium">{value}</p></div>;
}
