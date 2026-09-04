'use client';

import { useLocale, useTranslations } from 'next-intl';
import { useState } from 'react';
import { Activity, BookOpen, Check, ChevronDown, Database, Gauge, Play, RefreshCw, Search, Square, Timer } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { formatBytes } from '@/components/scenarios/fault-run-view';
import { getRecoveryStrategyLabel, PROVIDER_OUTCOMES, SCENARIO_META } from '@/components/scenarios/meta';
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

type ParameterCopy = { labelKey: string; descriptionKey: string };

export default function LocalizedScenarioCardWithActions({ scenario, activeRun, unavailableRun, busy, onCreate, onDetails, onStop, onRestart }: ScenarioCardWithActionsProps) {
  const t = useTranslations('Scenarios');
  const commonT = useTranslations('Common');
  const translate = (key: string) => t(key as never);
  const meta = SCENARIO_META[scenario.scenario];
  const Icon = meta?.icon ?? Activity;
  const scenarioLabel = meta ? translate(`scenarioMeta.${meta.labelKey}.label`) : scenario.scenario;
  const scenarioDescription = meta ? translate(`scenarioMeta.${meta.descriptionKey}.description`) : t('runParametersFallback');
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
      <div className="flex items-start justify-between gap-4"><div className="flex min-w-0 gap-3"><span className={`mt-0.5 rounded-md bg-muted p-2 ${meta?.tone ?? 'text-primary'}`}><Icon className="size-5" /></span><div className="min-w-0"><div className="flex items-center gap-1.5"><CardTitle className="text-base">{scenarioLabel}</CardTitle><a href={`/runbooks?scenario=${encodeURIComponent(scenario.scenario)}`} title={t('openRunbook')} aria-label={t('openRunbook')} className="inline-flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"><BookOpen aria-hidden="true" className="size-3.5" /></a></div><p className="mt-1 text-xs leading-5 text-muted-foreground">{scenarioDescription}</p></div></div><Badge variant="outline">{getRecoveryStrategyLabel(scenario.recoveryStrategy, translate)}</Badge></div>
      <div className="flex flex-wrap items-center justify-between gap-3"><div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-muted-foreground"><span>{t('target')} <strong className="font-medium text-foreground">{scenario.targetService}</strong></span><span>{t('operation')} <strong className="font-medium text-foreground">{scenario.targetOperation}</strong></span><span>{t('limit')} <strong className="font-medium text-foreground">{commonT('seconds', { count: scenario.maxDurationSec })}</strong></span></div><div className="flex items-center gap-2"><Button variant={isActiveScenario ? 'destructive' : 'default'} size="sm" onClick={() => isActiveScenario && activeRun ? void onStop(activeRun) : void submit()} disabled={locked || Boolean(restartRun) || busy || !providerOutcomeIsValid}>{isActiveScenario ? <Square className="size-3.5" /> : <Play className="size-3.5" />}{busy ? (isActiveScenario ? t('scenarioStopBusy') : t('scenarioStartBusy')) : isActiveScenario ? t('scenarioStop') : restartRun ? t('scenarioUnavailable') : locked ? t('scenarioLocked') : t('scenarioStart')}</Button>{scenario.scenario === 'NOTIFICATION_HEAP_PRESSURE' && onRestart && <Button variant="destructive" size="sm" onClick={() => onRestart(restartRun)} disabled={busy}><RefreshCw className={`size-3.5 ${busy ? 'animate-spin' : ''}`} />{busy ? t('restarting') : t('restartNotificationButton')}</Button>}</div></div>
    </CardHeader>
    <CardContent className="space-y-4 pt-4">
      {['BROWSE_REPORT_SQL', 'ORDER_REPORT_SQL'].includes(scenario.scenario) && <div className="grid grid-cols-3 gap-2 rounded-md bg-muted/50 p-3 text-[11px]"><ScenarioDetail label={t('dataWindow')} value={t('todayPartitions')} /><ScenarioDetail label={t('baseline')} value={t('historicalScan')} /><ScenarioDetail label={t('fixStatus')} value={t('awaitingPlanEvidence')} /></div>}
      {isCatalogHashScenario ? <CatalogHashParameters scenario={scenario} values={values} onChange={setValue} disabled={locked || busy} /> : <div className="grid grid-cols-2 gap-3">{scenario.parameters.map((parameter) => {
        const isProviderOutcome = parameter.name === 'providerOutcome';
        const isByteParameter = parameter.unit === 'bytes';
        const copy = getParameterCopy(scenario.scenario, parameter.name);
        return <label key={parameter.name} className="space-y-1.5 text-xs"><span className="flex justify-between gap-2 text-muted-foreground"><span>{translate(`parameters.${copy.labelKey}.label`)}</span><span>{parameter.required ? commonT('required') : commonT('optional')}</span></span><span className="block min-h-8 text-[11px] leading-4 text-muted-foreground">{translate(`parameters.${copy.descriptionKey}.description`)}</span>{isProviderOutcome ? <ProviderOutcomeSelect value={values[parameter.name] || ''} onChange={(value) => setValue(parameter.name, value)} options={parameter.options} disabled={locked || Boolean(busy)} /> : <input className="h-9 w-full rounded-md border border-input bg-background px-2.5 text-sm outline-none focus-visible:ring-2 focus:ring-ring" type={parameter.kind === 'string' || isByteParameter ? 'text' : 'number'} inputMode={isByteParameter ? 'text' : undefined} min={parameter.min} max={parameter.max} maxLength={parameter.maxLength} value={values[parameter.name] || ''} onChange={(event) => setValue(parameter.name, event.target.value)} disabled={locked || busy} />}</label>;
      })}</div>}
      <div className="flex items-center justify-between gap-3"><span className="text-[11px] text-muted-foreground">{restartRun ? t('notificationRestartHelp') : locked ? t('activeRunControlHelp') : isActiveScenario ? t('activeRunStopHelp') : isCatalogHashScenario ? t('catalogHashValidationHelp') : t('catalogValidationHelp')}</span>{isActiveScenario && <button type="button" className="text-left text-xs text-primary hover:underline" onClick={() => void onDetails(activeRun)}>{t('currentRunDetails')} <span aria-hidden="true">→</span></button>}</div>
    </CardContent>
  </Card>;
}

const PARAMETER_COPY: Record<string, ParameterCopy> = {
  durationSec: { labelKey: 'durationSec', descriptionKey: 'durationSec' },
  concurrency: { labelKey: 'concurrency', descriptionKey: 'concurrency' },
  requestIntervalMs: { labelKey: 'requestIntervalMs', descriptionKey: 'requestIntervalMs' },
  pageSize: { labelKey: 'pageSize', descriptionKey: 'pageSize' },
  retainedBytesPerNotification: { labelKey: 'retainedBytesPerNotification', descriptionKey: 'retainedBytesPerNotification' },
  totalBytes: { labelKey: 'totalBytes', descriptionKey: 'totalBytes' },
  appendBytes: { labelKey: 'appendBytes', descriptionKey: 'appendBytes' },
  minFreeBytes: { labelKey: 'minFreeBytes', descriptionKey: 'minFreeBytes' },
  providerOutcome: { labelKey: 'providerOutcome', descriptionKey: 'providerOutcome' },
  effectPercentage: { labelKey: 'effectPercentage', descriptionKey: 'effectPercentage' },
};

const TRAFFIC_SURGE_PARAMETER_COPY: Record<string, ParameterCopy> = {
  durationSec: { labelKey: 'durationSec', descriptionKey: 'durationSec' },
  concurrency: { labelKey: 'concurrency', descriptionKey: 'concurrency' },
  pageSize: { labelKey: 'pageSize', descriptionKey: 'pageSize' },
};

const CATALOG_PARAMETER_COPY: Record<string, ParameterCopy> = {
  durationSec: { labelKey: 'durationSec', descriptionKey: 'durationSec' },
  concurrency: { labelKey: 'concurrency', descriptionKey: 'concurrency' },
  requestIntervalMs: { labelKey: 'requestIntervalMs', descriptionKey: 'requestIntervalMs' },
  memberCount: { labelKey: 'memberCount', descriptionKey: 'memberCount' },
  memberSizeBytes: { labelKey: 'memberSizeBytes', descriptionKey: 'memberSizeBytes' },
  keyTtlSec: { labelKey: 'keyTtlSec', descriptionKey: 'keyTtlSec' },
};

function getParameterCopy(scenario: string, parameterName: string): ParameterCopy {
  return (scenario === 'CATALOG_REDIS_LARGE_VALUE' ? CATALOG_PARAMETER_COPY[parameterName] : undefined)
    || (scenario === 'BROWSE_SURGE' || scenario === 'ORDER_QUERY_SURGE' ? TRAFFIC_SURGE_PARAMETER_COPY[parameterName] : undefined)
    || PARAMETER_COPY[parameterName]
    || { labelKey: parameterName, descriptionKey: parameterName };
}

function CatalogHashParameters({ scenario, values, onChange, disabled }: { scenario: Scenario; values: Record<string, string>; onChange: (name: string, value: string) => void; disabled: boolean }) {
  const t = useTranslations('Scenarios');
  const locale = useLocale();
  const memberCount = parseInteger(values.memberCount);
  const memberSizeBytes = parseBytes(values.memberSizeBytes);
  const logicalBytes = memberCount !== null && memberSizeBytes !== null ? memberCount * memberSizeBytes : null;
  const commonT = useTranslations('Common');
  const budgetLabel = logicalBytes === null ? t('enterValidValues') : formatBytes(logicalBytes, locale, commonT('notAvailable'));

  return <div className="space-y-4">
    <div className="overflow-hidden rounded-lg border border-primary/20 bg-primary/[0.04]">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-primary/10 px-4 py-3">
        <div className="flex items-start gap-3"><span className="flex size-9 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary"><Database className="size-4.5" /></span><div><p className="text-xs font-semibold uppercase tracking-[0.16em] text-primary">{t('configurationPreview')}</p><p className="mt-1 text-sm font-medium">{t('oneRedisHash')} <span className="text-muted-foreground">·</span> {t('skuFields', { count: memberCount ?? 'N' })}</p></div></div>
        <Badge variant="outline" className="border-primary/30 text-primary">{t('catalogOwned')}</Badge>
      </div>
      <div className="grid grid-cols-2 divide-x divide-primary/10 sm:grid-cols-4">
        <CatalogMetric icon={<Database className="size-3.5" />} label={t('fields')} value={memberCount === null ? commonT('notAvailable') : String(memberCount)} />
        <CatalogMetric icon={<Gauge className="size-3.5" />} label={t('perField')} value={memberSizeBytes === null ? commonT('notAvailable') : formatBytes(memberSizeBytes, locale, commonT('notAvailable'))} />
        <CatalogMetric icon={<Database className="size-3.5" />} label={t('logicalBudget')} value={budgetLabel} />
        <CatalogMetric icon={<Timer className="size-3.5" />} label={t('reader')} value={values.concurrency ? t('concurrent', { count: Number(values.concurrency) }) : commonT('notAvailable')} />
      </div>
    </div>
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">{scenario.parameters.map((parameter) => {
      const tKey = getParameterCopy(scenario.scenario, parameter.name);
      const isBytes = parameter.unit === 'bytes';
      return <label key={parameter.name} className="min-w-0 space-y-1.5 text-xs"><span className="block font-medium text-foreground">{t(`parameters.${tKey.labelKey}.label` as never)}</span><span className="block min-h-8 text-[11px] leading-4 text-muted-foreground">{t(`parameters.${tKey.descriptionKey}.description` as never)}</span><input aria-label={t(`parameters.${tKey.labelKey}.label` as never)} className="h-9 w-full rounded-md border border-input bg-background px-2.5 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring" type={isBytes ? 'text' : 'number'} inputMode={isBytes ? 'text' : 'numeric'} min={parameter.min} max={parameter.max} maxLength={parameter.maxLength} value={values[parameter.name] || ''} onChange={(event) => onChange(parameter.name, event.target.value)} disabled={disabled} /></label>;
    })}</div>
    <div className="flex items-start gap-2 rounded-md border border-border/70 bg-muted/40 px-3 py-2.5 text-[11px] leading-4 text-muted-foreground"><Timer className="mt-0.5 size-3.5 shrink-0 text-primary" /><span>{t('byteValueHelp')}</span></div>
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
  const t = useTranslations('Scenarios');
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const choices = PROVIDER_OUTCOMES.filter((outcome) => options?.includes(outcome.value) ?? true);
  const filteredChoices = choices.filter((outcome) => `${outcome.value} ${t(`providerOutcomes.${outcome.labelKey}` as never)}`.toLowerCase().includes(query.toLowerCase()));
  const selected = choices.find((outcome) => outcome.value === value);
  const select = (nextValue: string) => {
    onChange(nextValue);
    setQuery('');
    setOpen(false);
  };

  return <div className="relative">
    <button type="button" className="flex h-9 w-full items-center justify-between rounded-md border border-input bg-background px-2.5 text-left text-sm outline-none transition-colors hover:bg-muted/50 focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50" aria-haspopup="listbox" aria-expanded={open} onClick={() => setOpen((current) => !current)} disabled={disabled}><span className={selected ? 'text-foreground' : 'text-muted-foreground'}>{selected ? t(`providerOutcomes.${selected.labelKey}` as never) : t('selectOutcome')}</span><ChevronDown className={`size-4 text-muted-foreground transition-transform ${open ? 'rotate-180' : ''}`} /></button>
    {open && <div className="absolute left-0 right-0 top-11 z-30 overflow-hidden rounded-md border border-border bg-popover p-1.5 text-popover-foreground shadow-lg" role="listbox" aria-label={t('providerOutcomesAria')}><div className="flex items-center gap-2 rounded border border-input bg-background px-2"><Search className="size-3.5 shrink-0 text-muted-foreground" /><input autoFocus type="search" className="h-8 min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground" placeholder={t('searchOutcomes')} value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={(event) => { if (event.key === 'Escape') setOpen(false); if (event.key === 'Enter' && filteredChoices[0]) select(filteredChoices[0].value); }} /></div><div className="mt-1 space-y-0.5">{filteredChoices.length ? filteredChoices.map((outcome) => <button key={outcome.value} type="button" role="option" aria-selected={outcome.value === value} className="provider-option flex w-full items-center justify-between rounded px-2 py-1.5 text-left text-sm" onClick={() => select(outcome.value)}><span className="font-medium">{t(`providerOutcomes.${outcome.labelKey}` as never)}</span>{outcome.value === value && <Check className="provider-option-check size-4" />}</button>) : <p className="px-2 py-2 text-xs text-muted-foreground">{t('noMatchingOutcomes')}</p>}</div></div>}
  </div>;
}

function ScenarioDetail({ label, value }: { label: string; value: string }) {
  return <div><p className="text-[11px] uppercase tracking-wider text-muted-foreground">{label}</p><p className="mt-1 truncate text-sm font-medium">{value}</p></div>;
}
