import { BookOpen, ChevronRight, Clock3, Database, GitBranch, ShieldCheck } from 'lucide-react';
import { getTranslations } from 'next-intl/server';
import { Badge } from '@/components/ui/badge';
import { SCENARIO_GROUPS, getScenarioGroupLabel, getScenarioLabel } from '@/components/scenarios/meta';
import type { RunbookEntry } from '@/lib/runbook';
import type { RunbookContentErrorCode } from '@/lib/runbook-content';
import CopyTextButton from './CopyTextButton';
import RunbookArticle from './RunbookArticle';

function QueryRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex min-w-0 items-start gap-2 border-t border-border/70 py-2.5 first:border-t-0">
      <div className="min-w-0 flex-1" data-copy-value={value}>
        <p className="mb-1 text-[11px] font-medium uppercase tracking-[0.12em] text-muted-foreground">{label}</p>
        <code className="block overflow-x-auto whitespace-pre-wrap break-words font-mono text-xs leading-5 text-foreground">{value}</code>
      </div>
      <CopyTextButton value={value} />
    </div>
  );
}

function ParameterValue({ parameter }: { parameter: RunbookEntry['parameters'][number] }) {
  const values = [
    parameter.default === undefined ? null : `default=${String(parameter.default)}`,
    parameter.min === undefined ? null : `min=${parameter.min}`,
    parameter.max === undefined ? null : `max=${parameter.max}`,
    parameter.unit === undefined ? null : `unit=${parameter.unit}`,
  ].filter((value): value is string => value !== null);
  if (values.length === 0) return <span className="text-muted-foreground">-</span>;
  return <code className="font-mono text-xs">{values.join(' · ')}</code>;
}

export default async function RunbookWorkspace({
  entries,
  entry,
  markdown,
  contentError,
}: {
  entries: RunbookEntry[];
  entry: RunbookEntry;
  markdown: string | null;
  contentError: RunbookContentErrorCode | null;
}) {
  const t = await getTranslations('Runbook');
  const scenarioT = await getTranslations('Scenarios');
  const translateScenario = (key: string) => scenarioT(key as never);
  const scenarioLabel = getScenarioLabel(entry.scenario, translateScenario);
  const entriesByScenario = new Map(entries.map((item) => [item.scenario, item]));
  const cleanupLabel = entry.allowManualCleanup ? t('manualCleanup') : t('automaticRecovery');

  return (
    <div className="mx-auto max-w-[1500px] space-y-5">
      <header className="flex flex-wrap items-end justify-between gap-4 border-b border-border pb-5">
        <div className="min-w-0">
          <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-primary">
            <BookOpen aria-hidden="true" className="size-3.5" />
            <span>{t('eyebrow')}</span>
          </div>
          <h1 className="text-3xl font-semibold tracking-tight">{t('pageTitle')}</h1>
          <p className="mt-1 max-w-3xl text-sm text-muted-foreground">{t('pageDescription')}</p>
        </div>
        <Badge variant="outline" className="gap-1.5 px-2.5 py-1">
          <ShieldCheck aria-hidden="true" className="size-3.5" />
          {t('readOnly')}
        </Badge>
      </header>

      <div className="grid min-w-0 gap-5 xl:grid-cols-[260px_minmax(0,1fr)]">
        <aside className="min-w-0 self-start rounded-lg border border-border bg-card/45 p-3 xl:sticky xl:top-4">
          <div className="mb-3 border-b border-border px-2 pb-3">
            <h2 className="text-sm font-semibold">{t('scenarioIndex')}</h2>
            <p className="mt-1 text-xs leading-5 text-muted-foreground">{t('scenarioIndexDescription')}</p>
          </div>
          <nav aria-label={t('scenarioNavigation')} className="max-h-[38vh] space-y-4 overflow-y-auto pr-1 xl:max-h-[calc(100vh-230px)]">
            {SCENARIO_GROUPS.map((group) => (
              <section key={group.labelKey}>
                <h3 className="px-2 text-[10px] font-semibold uppercase tracking-[0.15em] text-muted-foreground">
                  {getScenarioGroupLabel(group, translateScenario)}
                </h3>
                <div className="mt-1.5 space-y-0.5">
                  {group.scenarios.map((scenario) => {
                    const item = entriesByScenario.get(scenario as RunbookEntry['scenario']);
                    if (!item) return null;
                    const active = item.scenario === entry.scenario;
                    return (
                      <a
                        key={item.scenario}
                        href={`/runbooks?scenario=${encodeURIComponent(item.scenario)}`}
                        aria-current={active ? 'page' : undefined}
                        className={`group flex min-w-0 items-start gap-2 rounded-md px-2 py-2 text-xs transition-colors ${active ? 'bg-primary/10 text-foreground ring-1 ring-primary/30' : 'text-muted-foreground hover:bg-muted/60 hover:text-foreground'}`}
                      >
                        <ChevronRight aria-hidden="true" className={`mt-0.5 size-3 shrink-0 transition-transform ${active ? 'text-primary' : 'opacity-40 group-hover:translate-x-0.5'}`} />
                        <span className="min-w-0">
                          <span className="block break-words font-medium leading-4">{getScenarioLabel(item.scenario, translateScenario)}</span>
                          <span className="mt-0.5 block break-all font-mono text-[10px] leading-4 opacity-60">{item.scenario}</span>
                        </span>
                      </a>
                    );
                  })}
                </div>
              </section>
            ))}
          </nav>
        </aside>

        <div className="min-w-0 space-y-5">
          <section className="min-w-0 rounded-lg border border-border bg-card/55 p-5 sm:p-6">
            <div className="flex flex-wrap items-start justify-between gap-4 border-b border-border pb-5">
              <div className="min-w-0">
                <p className="mb-2 break-all font-mono text-xs tracking-[0.08em] text-primary">{entry.scenario}</p>
                <h2 className="text-2xl font-semibold tracking-tight">{scenarioLabel}</h2>
                <p className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground">{entry.businessPath.join(' -> ')}</p>
              </div>
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <Clock3 aria-hidden="true" className="size-3.5" />
                <span>{entry.maxDurationSec}s max</span>
              </div>
            </div>

            <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <div className="min-w-0 border-l-2 border-primary/60 pl-3">
                <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">{t('service')}</p>
                <p className="mt-1 break-all font-mono text-xs">{entry.targetService}</p>
              </div>
              <div className="min-w-0 border-l-2 border-primary/60 pl-3">
                <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">{t('operation')}</p>
                <p className="mt-1 break-all font-mono text-xs">{entry.targetOperation}</p>
              </div>
              <div className="min-w-0 border-l-2 border-primary/60 pl-3">
                <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">{t('impactScope')}</p>
                <p className="mt-1 font-mono text-xs">{entry.impactScope}</p>
              </div>
              <div className="min-w-0 border-l-2 border-primary/60 pl-3">
                <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">{t('recovery')}</p>
                <p className="mt-1 break-words text-xs">{entry.recoveryStrategy} · {cleanupLabel}</p>
              </div>
            </div>
          </section>

          <div className="grid min-w-0 gap-5 2xl:grid-cols-[minmax(0,1fr)_minmax(330px,0.42fr)]">
            <section className="min-w-0 rounded-lg border border-border bg-card/55 p-5 sm:p-6">
              {markdown ? (
                <>
                  <div className="mb-5 flex items-center gap-2 border-b border-border pb-3">
                    <GitBranch aria-hidden="true" className="size-4 text-primary" />
                    <h2 className="text-sm font-semibold">{t('articleHeading')}</h2>
                  </div>
                  <RunbookArticle markdown={markdown} mermaidLabel={t('mermaidLabel')} />
                </>
              ) : (
                <div className="rounded-md border border-destructive/30 bg-destructive/10 px-4 py-4 text-sm text-destructive" role="status">
                  <p className="font-medium">{t('articleUnavailable')}</p>
                  <p className="mt-1 text-xs opacity-85">{contentError === 'CONTENT_NOT_FOUND' || contentError === 'CONTENT_EMPTY' ? t('contentUnavailable') : t('unknownContentError')}</p>
                </div>
              )}
            </section>

            <aside className="min-w-0 space-y-5">
              <section className="min-w-0 rounded-lg border border-border bg-card/55 p-5">
                <div className="mb-4 flex items-start gap-3 border-b border-border pb-4">
                  <Database aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-primary" />
                  <div className="min-w-0">
                    <h2 className="text-sm font-semibold">{t('tempoTitle')}</h2>
                    <p className="mt-1 text-xs leading-5 text-muted-foreground">{t('tempoDescription')}</p>
                  </div>
                </div>

                <div className="space-y-4">
                  <div>
                    <p className="mb-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">{t('suggestedTimeRange')}</p>
                    <code className="font-mono text-xs">{entry.tempo.timeRange}</code>
                  </div>
                  <div>
                    <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">{t('businessPath')}</p>
                    <ol className="space-y-1.5 text-xs leading-5 text-muted-foreground">
                      {entry.tempo.businessPath.map((step, index) => <li key={`${step}-${index}`} className="flex min-w-0 gap-2"><span className="font-mono text-primary">{String(index + 1).padStart(2, '0')}</span><span className="min-w-0 break-words">{step}</span></li>)}
                    </ol>
                  </div>
                  <div>
                    <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">{t('serviceQueries')}</p>
                    <div className="overflow-hidden rounded-md border border-border/80 bg-background/60 px-3">
                      {entry.tempoQueries.map((query) => (
                        <div key={`${query.serviceName}-${query.route || 'service'}`} className="border-t border-border/70 first:border-t-0">
                          <div className="flex flex-wrap items-center gap-2 py-2.5">
                            <span className="font-mono text-xs font-medium">{query.serviceName}</span>
                            {query.route && <Badge variant="secondary" className="max-w-full break-all font-mono text-[10px]">{query.route}</Badge>}
                          </div>
                          <QueryRow label={t('serviceQuery')} value={query.serviceQuery} />
                          <QueryRow label={t('errorQuery')} value={query.errorQuery} />
                          <QueryRow label={t('slowQuery')} value={query.slowQuery} />
                          {query.routeQuery && <>
                            <QueryRow label={t('routeQuery')} value={query.routeQuery} />
                            <p className="pb-2.5 text-[11px] leading-4 text-muted-foreground">{t('routeHint')}</p>
                          </>}
                        </div>
                      ))}
                    </div>
                  </div>
                  <div>
                    <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">{t('waterfallChecks')}</p>
                    <div className="flex flex-wrap gap-1.5">
                      {entry.tempo.waterfallChecks.map((check) => <Badge key={check} variant="outline" className="font-mono text-[10px]">{check}</Badge>)}
                    </div>
                  </div>
                </div>
              </section>

              <section className="grid gap-5 sm:grid-cols-2 2xl:grid-cols-1">
                <div className="min-w-0 rounded-lg border border-border bg-card/55 p-5">
                  <h2 className="mb-3 text-sm font-semibold">{t('affectedResources')}</h2>
                  <ul className="space-y-2 text-xs leading-5 text-muted-foreground">
                    {entry.affectedResources.map((resource) => <li key={resource} className="flex gap-2"><span className="mt-2 size-1.5 shrink-0 rounded-full bg-primary" /><span className="min-w-0 break-words">{resource}</span></li>)}
                  </ul>
                </div>
                <div className="min-w-0 rounded-lg border border-border bg-card/55 p-5">
                  <h2 className="mb-3 text-sm font-semibold">{t('explicitlyExcluded')}</h2>
                  <ul className="space-y-2 text-xs leading-5 text-muted-foreground">
                    {entry.explicitlyExcluded.map((resource) => <li key={resource} className="flex gap-2"><span className="mt-2 size-1.5 shrink-0 rounded-full bg-muted-foreground/60" /><span className="min-w-0 break-words">{resource}</span></li>)}
                  </ul>
                </div>
              </section>
            </aside>
          </div>

          <section className="min-w-0 rounded-lg border border-border bg-card/45 p-5 sm:p-6">
            <div className="mb-4 flex items-center gap-2 border-b border-border pb-3">
              <ShieldCheck aria-hidden="true" className="size-4 text-primary" />
              <h2 className="text-sm font-semibold">{t('catalogParameters')}</h2>
            </div>
            {entry.parameters.length === 0 ? <p className="text-xs text-muted-foreground">{t('parametersUnavailable')}</p> : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[520px] text-left text-xs">
                  <thead className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                    <tr>
                      <th className="pb-2 pr-4 font-semibold">{t('operation')}</th>
                      <th className="pb-2 pr-4 font-semibold">{t('range')}</th>
                      <th className="pb-2 font-semibold">{t('default')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {entry.parameters.map((parameter) => (
                      <tr key={parameter.name} className="border-t border-border/70">
                        <td className="py-2.5 pr-4 align-top"><code className="font-mono">{parameter.name}</code><span className="ml-2 text-[10px] text-muted-foreground">{parameter.required ? t('required') : t('optional')}</span></td>
                        <td className="py-2.5 pr-4 align-top"><ParameterValue parameter={parameter} /></td>
                        <td className="py-2.5 align-top"><code className="font-mono text-xs">{parameter.default === undefined ? '-' : String(parameter.default)}</code></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}