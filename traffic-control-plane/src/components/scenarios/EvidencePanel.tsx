'use client';

import { useFormatter, useLocale, useTranslations } from 'next-intl';
import React from 'react';
import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { Check, Copy, RefreshCw, Search, Send } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import ConfirmDialog from '@/components/ConfirmDialog';
import { createClientId } from '@/lib/client-id';
import {
  classifyEvidencePanelLoadFailure,
  EvidencePanelRequestError,
  getEvidencePanelErrorCode,
  loadEvidencePanelMetadata,
  submitEvidenceNote,
  submitEvidenceReport,
} from './evidence-panel-client';
import {
  buildEvidencePanelProjection,
  copyFrozenEvidenceQuery,
  parseEvidenceLiveReport,
  parseEvidenceNoteHistory,
  type EvidencePanelMetadata,
  type EvidencePanelProjection,
  type EvidenceLiveReportView,
  type EvidenceManifestView,
  type EvidenceMetricSummaryView,
  type EvidenceRecipeView,
} from './evidence-view';

type PanelState =
  | { readonly kind: 'loading'; readonly requestKey: string }
  | { readonly kind: 'legacy'; readonly requestKey: string }
  | { readonly kind: 'not-terminal'; readonly requestKey: string }
  | { readonly kind: 'disabled'; readonly requestKey: string }
  | { readonly kind: 'error'; readonly code: string; readonly requestKey: string }
  | { readonly kind: 'ready'; readonly metadata: EvidencePanelMetadata; readonly manifestId: string; readonly requestKey: string };

type ReportNotice = 'metadataReplay' | 'noLiveSummary';

interface PendingReportRequest {
  readonly manifest: EvidenceManifestView;
  readonly idempotencyKey: string;
}

interface PendingNoteRequest extends PendingReportRequest {
  readonly text: string;
}

export function EvidencePanel({ faultRunId, controlState }: {
  readonly faultRunId: string;
  readonly controlState: string;
}) {
  const t = useTranslations('Scenarios');
  const format = useFormatter();
  const locale = useLocale();
  const [reload, setReload] = useState(0);
  const [state, setState] = useState<PanelState>({ kind: 'loading', requestKey: '' });
  const [reportConfirmation, setReportConfirmation] = useState<PendingReportRequest | null>(null);
  const [reportRetry, setReportRetry] = useState<PendingReportRequest | null>(null);
  const [reportBusy, setReportBusy] = useState(false);
  const [reportError, setReportError] = useState<string | null>(null);
  const [liveReport, setLiveReport] = useState<EvidenceLiveReportView | null>(null);
  const [noteText, setNoteText] = useState('');
  const [noteRetry, setNoteRetry] = useState<PendingNoteRequest | null>(null);
  const [noteBusy, setNoteBusy] = useState(false);
  const [noteError, setNoteError] = useState<string | null>(null);
  const [reportNotice, setReportNotice] = useState<ReportNotice | null>(null);
  const [copiedRecipeId, setCopiedRecipeId] = useState<string | null>(null);
  const [copyError, setCopyError] = useState(false);
  const selectedManifestId = useRef<string | null>(null);
  const selectedManifestRecord = useRef<EvidenceManifestView | null>(null);
  const activeActionController = useRef<AbortController | null>(null);
  const requestKey = `${faultRunId}:${reload}`;
  const panelState = useMemo(() => state.requestKey === requestKey
    ? state
    : { kind: 'loading' as const, requestKey }, [requestKey, state]);

  useEffect(() => {
    const controller = new AbortController();
    void loadEvidencePanelMetadata(faultRunId, controller.signal).then((result) => {
      if (controller.signal.aborted) return;
      if (result.state === 'unavailable') {
        setState({ kind: 'legacy', requestKey });
        return;
      }
      const selectedId = selectedManifestId.current;
      const selectedFromPage = selectedId
        ? result.metadata.manifests.find((entry) => entry.manifestId === selectedId)
        : null;
      const selectedManifest = selectedFromPage
        ?? (selectedManifestRecord.current?.sourceFaultRunId === faultRunId
          && selectedManifestRecord.current.manifestId === selectedId
          ? selectedManifestRecord.current
          : null)
        ?? result.metadata.latestManifest;
      const manifestId = selectedManifest.manifestId;
      const manifests = result.metadata.manifests.some((entry) => entry.manifestId === manifestId)
        ? result.metadata.manifests
        : [selectedManifest, ...result.metadata.manifests].slice(0, 100);
      selectedManifestRecord.current = selectedManifest;
      selectedManifestId.current = manifestId;
      setState({
        kind: 'ready',
        metadata: { ...result.metadata, manifests },
        manifestId,
        requestKey,
      });
    }).catch((error: unknown) => {
      if (controller.signal.aborted) return;
      const failure = classifyEvidencePanelLoadFailure(error);
      if (failure.kind === 'not-terminal') setState({ kind: 'not-terminal', requestKey });
      else if (failure.kind === 'disabled') setState({ kind: 'disabled', requestKey });
      else setState({ kind: 'error', code: failure.code, requestKey });
    });
    return () => controller.abort();
  }, [faultRunId, requestKey]);

  useEffect(() => () => activeActionController.current?.abort(), []);

  const manifest = panelState.kind === 'ready'
    ? panelState.metadata.manifests.find((entry) => entry.manifestId === panelState.manifestId)
      ?? (panelState.metadata.latestManifest.manifestId === panelState.manifestId
        ? panelState.metadata.latestManifest
        : null)
    : null;
  const selectedLiveReport = manifest && liveReport?.manifestId === manifest.manifestId
    && liveReport.manifestHash === manifest.manifestHash
    ? liveReport
    : null;
  const projection = useMemo(() => manifest && panelState.kind === 'ready'
    ? buildEvidencePanelProjection(manifest, panelState.metadata.reports, selectedLiveReport)
    : null, [manifest, panelState, selectedLiveReport]);

  function selectManifest(manifestId: string) {
    if (panelState.kind !== 'ready') return;
    const selected = panelState.metadata.manifests.find((entry) => entry.manifestId === manifestId)
      ?? (panelState.metadata.latestManifest.manifestId === manifestId
        ? panelState.metadata.latestManifest
        : null);
    if (!selected) {
      setState({ kind: 'error', code: 'MANIFEST_NOT_FOUND', requestKey });
      return;
    }
    selectedManifestRecord.current = selected;
    setReportConfirmation(null);
    setReportError(null);
    setReportNotice(null);
    setLiveReport(null);
    setNoteError(null);
    setCopiedRecipeId(null);
    setCopyError(false);
    selectedManifestId.current = selected.manifestId;
    setState({ ...panelState, manifestId: selected.manifestId });
  }

  function requestLiveReport() {
    if (!manifest || reportBusy || noteBusy) return;
    setReportError(null);
    setReportNotice(null);
    setReportRetry(null);
    setReportConfirmation({
      manifest,
      idempotencyKey: `evidence-report-${createClientId()}`,
    });
  }

  async function executeLiveReport(request: PendingReportRequest): Promise<void> {
    const controller = new AbortController();
    activeActionController.current = controller;
    setReportBusy(true);
    setReportError(null);
    setLiveReport(null);
    try {
      const result: unknown = await submitEvidenceReport(
        faultRunId,
        request.manifest.manifestId,
        request.manifest.manifestHash,
        request.idempotencyKey,
        controller.signal,
      );
      if (!isRecord(result) || typeof result.replayed !== 'boolean') {
        throw new EvidencePanelRequestError(502, 'EVIDENCE_RESPONSE_INVALID');
      }
      const parsedReport = result.report === null
        ? null
        : parseEvidenceLiveReport(result.report, request.manifest);
      if (result.report !== null && !parsedReport) {
        throw new EvidencePanelRequestError(502, 'EVIDENCE_RESPONSE_INVALID');
      }
      setLiveReport(parsedReport);
      setReportNotice(result.replayed
        ? 'metadataReplay'
        : parsedReport ? null : 'noLiveSummary');
      setReportRetry(null);
      setReload((value) => value + 1);
    } catch (error) {
      if (controller.signal.aborted) return;
      const code = getEvidencePanelErrorCode(error);
      setReportError(code);
      if (shouldOfferSameRequestRetry(error)) setReportRetry(request);
    } finally {
      if (activeActionController.current === controller) {
        activeActionController.current = null;
        if (!controller.signal.aborted) setReportBusy(false);
      }
    }
  }

  async function executeNote(request: PendingNoteRequest): Promise<void> {
    const controller = new AbortController();
    activeActionController.current = controller;
    setNoteBusy(true);
    setNoteError(null);
    try {
      const result: unknown = await submitEvidenceNote(
        faultRunId,
        request.manifest.manifestId,
        request.manifest.manifestHash,
        request.idempotencyKey,
        request.text,
        controller.signal,
      );
      if (!isRecord(result) || typeof result.created !== 'boolean') {
        throw new EvidencePanelRequestError(502, 'EVIDENCE_RESPONSE_INVALID');
      }
      const notes = parseEvidenceNoteHistory({ notes: [result.note] }, faultRunId);
      if (!notes || notes[0]?.manifestId !== request.manifest.manifestId) {
        throw new EvidencePanelRequestError(502, 'EVIDENCE_RESPONSE_INVALID');
      }
      setNoteText('');
      setNoteRetry(null);
      setReload((value) => value + 1);
    } catch (error) {
      if (controller.signal.aborted) return;
      const code = getEvidencePanelErrorCode(error);
      setNoteError(code);
      if (shouldOfferSameRequestRetry(error)) setNoteRetry(request);
    } finally {
      if (activeActionController.current === controller) {
        activeActionController.current = null;
        if (!controller.signal.aborted) setNoteBusy(false);
      }
    }
  }

  async function copyFrozenRecipe(recipeId: string, query: string): Promise<void> {
    setCopyError(false);
    const result = await copyFrozenEvidenceQuery(query, (value) => navigator.clipboard.writeText(value));
    if (result === 'COPIED') setCopiedRecipeId(recipeId);
    else setCopyError(true);
  }

  function submitNote(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!manifest || noteBusy || reportBusy) return;
    setNoteError(null);
    setNoteRetry(null);
    void executeNote({
      manifest,
      idempotencyKey: `evidence-note-${createClientId()}`,
      text: noteText,
    });
  }

  const noteBytes = new TextEncoder().encode(noteText).byteLength;

  return <>
    <section
    aria-labelledby="evidence-panel-title"
    aria-busy={panelState.kind === 'loading'}
    className="space-y-4 rounded-lg border border-border bg-background/30 p-4"
  >
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div>
        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-primary">{t('evidence.panelLabel')}</p>
        <h3 id="evidence-panel-title" className="mt-1 text-sm font-medium">{t('evidence.title')}</h3>
        <p className="mt-1 text-xs text-muted-foreground">{t('evidence.browseOnly')}</p>
      </div>
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => setReload((value) => value + 1)}
        disabled={panelState.kind === 'loading'}
      >
        <RefreshCw className="size-3.5" />
        {t('evidence.refreshMetadata')}
      </Button>
    </div>

    {panelState.kind === 'loading' && <p role="status" aria-live="polite" className="text-sm text-muted-foreground">{t('evidence.loading')}</p>}
    {panelState.kind === 'legacy' && <StatusMessage>{t('evidence.legacyUnavailable')}</StatusMessage>}
    {panelState.kind === 'not-terminal' && <StatusMessage>{t('evidence.runNotTerminal')}</StatusMessage>}
    {panelState.kind === 'disabled' && <StatusMessage>{t('evidence.disabled')}</StatusMessage>}
    {panelState.kind === 'error' && <p role="alert" className="text-sm text-destructive">{t('evidence.loadFailed')} · {panelState.code}</p>}

    {panelState.kind === 'ready' && manifest && projection && <>
      <label className="block text-xs text-muted-foreground">
        <span className="mb-1 block">{t('evidence.selectManifest')}</span>
        <select
          className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm text-foreground"
          value={manifest.manifestId}
          onChange={(event) => selectManifest(event.target.value)}
          disabled={reportBusy || noteBusy}
        >
          {panelState.metadata.manifests.map((entry) => (
            <option key={entry.manifestId} value={entry.manifestId}>
              {t('evidence.revision', { revision: entry.manifestRevision })}
              {entry.sourceRunRetained ? '' : ` · ${t('evidence.sourceRunRetainedFalse')}`}
            </option>
          ))}
        </select>
      </label>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatusCard label={t('evidence.controlState')} value={controlState} />
        <StatusCard
          label={t('evidence.telemetryStatus')}
          value={translateState(t, selectedLiveReport?.evidenceStatus ?? projection.telemetryStatus)}
        />
        <StatusCard
          label={t('evidence.currentChecks')}
          value={projection.currentChecks.length === 0
            ? t('evidence.notDefined')
            : t('evidence.checkCount', { count: projection.currentChecks.length })}
        />
        <StatusCard label={t('evidence.effectAssessment')} value={projection.effectAssessment === 'NOT_ASSESSED'
          ? t('evidence.notAssessed')
          : translateState(t, projection.effectAssessment)} />
      </div>

      {!manifest.sourceRunRetained && <p className="text-xs text-muted-foreground">{t('evidence.sourceRunRetainedFalse')}</p>}
      <p className="text-xs text-muted-foreground">
        {t('evidence.manifestHash')}: <code className="break-all">{manifest.manifestHash}</code>
        {' · '}{t('evidence.materializedAt')}: {format.dateTime(new Date(manifest.materializedAt), 'compact')}
      </p>

      <section aria-labelledby="evidence-report-history-title" className="space-y-2">
        <h4 id="evidence-report-history-title" className="text-sm font-medium">{t('evidence.reportHistory')}</h4>
        {panelState.metadata.reports.length === 0
          ? <p className="text-xs text-muted-foreground">{t('evidence.noReports')}</p>
          : <div className="space-y-2">{panelState.metadata.reports.map((report) => (
            <div key={report.attemptId} className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-border/70 p-3">
              <div>
                <p className="text-xs font-medium">
                  {t('evidence.revision', { revision: report.manifestRevision })}
                  {' · '}{translateState(t, report.evidenceStatus ?? report.state)}
                </p>
                <p className="mt-1 text-[11px] text-muted-foreground">
                  {format.dateTime(new Date(report.requestedAt), 'compact')}
                  {report.totalDurationMs === null ? '' : ` · ${t('evidence.durationMs', { duration: report.totalDurationMs })}`}
                </p>
              </div>
              {report.operatorAuditId !== null && <Badge variant="outline">#{report.operatorAuditId}</Badge>}
            </div>
          ))}</div>}
        {panelState.metadata.omittedReportCount > 0 && <p className="text-xs text-muted-foreground">
          {t('evidence.omittedHistory', { count: panelState.metadata.omittedReportCount })}
        </p>}
      </section>

      <section aria-labelledby="evidence-live-report-title" className="space-y-3 rounded-md border border-primary/20 bg-primary/[0.025] p-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h4 id="evidence-live-report-title" className="text-sm font-medium">{t('evidence.liveReport')}</h4>
            <p className="mt-1 text-xs text-muted-foreground">{t('evidence.liveReportWarning')}</p>
          </div>
          <Button type="button" size="sm" onClick={requestLiveReport} disabled={reportBusy || noteBusy}>
            <Search className="size-3.5" />
            {reportBusy ? t('evidence.reportRunning') : t('evidence.runReport')}
          </Button>
        </div>
        {reportError && <p role="alert" className="text-xs text-destructive">
          {t('evidence.reportFailed')} · {reportError}
        </p>}
        {reportNotice && <p role="status" aria-live="polite" className="text-xs text-muted-foreground">
          {reportNotice === 'metadataReplay'
            ? t('evidence.metadataReplay')
            : reportNotice === 'noLiveSummary'
              ? t('evidence.noLiveSummary')
              : null}
        </p>}
        {reportRetry && <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => void executeLiveReport(reportRetry)}
          disabled={reportBusy || noteBusy}
        >
          {t('evidence.retrySameRequest', { revision: reportRetry.manifest.manifestRevision })}
        </Button>}
        {selectedLiveReport && <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="outline">{translateState(t, selectedLiveReport.evidenceStatus)}</Badge>
              <Badge variant="secondary">{translateState(t, selectedLiveReport.effectAssessment)}</Badge>
              <span className="text-xs text-muted-foreground">
                {selectedLiveReport.evaluatedAt
                  ? format.dateTime(new Date(selectedLiveReport.evaluatedAt), 'compact')
                  : t('notReported')}
              </span>
            </div>
            <p className="text-[11px] text-muted-foreground">{t('evidence.liveSummaryMemoryOnly')}</p>
            <div className="space-y-1">
              {selectedLiveReport.items.map((item) => {
                const recipeSummary = selectedLiveReport.recipeSummaries.find((candidate) =>
                  candidate.recipeId === item.recipeId
                  && candidate.source === item.source
                  && candidate.window === item.window);
                return <div
                  key={`${item.recipeId}:${item.window}`}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-sm bg-muted/40 px-2 py-1.5 text-xs"
                >
                  <div className="min-w-0">
                    <p className="break-all font-mono">{item.recipeId} · {translateWindow(t, item.window)}</p>
                    <p className="mt-1 text-[11px] text-muted-foreground">
                      {translateState(t, item.availability)} · {translateState(t, item.coverage)}
                      {' · '}{translateState(t, item.predicateOutcome)}
                      {item.reasonCode ? ` · ${item.reasonCode}` : ''}
                      {item.queriedAt ? ` · ${format.dateTime(new Date(item.queriedAt), 'compact')}` : ''}
                    </p>
                    {recipeSummary?.summary && <p className="mt-1 text-[11px] text-muted-foreground">
                      {formatMetricSummary(t, recipeSummary.summary, recipeSummary.valueUnit, locale)}
                    </p>}
                  </div>
                </div>;
              })}
            </div>
          </div>}
      </section>

      <section aria-labelledby="evidence-window-title" className="space-y-2">
        <h4 id="evidence-window-title" className="text-sm font-medium">{t('evidence.windows')}</h4>
        <div className="grid gap-2 sm:grid-cols-2">
          {manifest.windows.map((window) => {
            const actual = projection.executedRanges.filter((item) => item.window === window.name);
            return <div key={window.name} className="rounded-md border border-border/70 p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-xs font-medium">{translateWindow(t, window.name)}</span>
                <Badge variant="outline">{translateState(t, window.state)}</Badge>
              </div>
              <p className="mt-2 text-xs text-muted-foreground">
                {t('evidence.canonicalRange')}: {formatRange(window.canonicalStartAt, window.canonicalEndAt, format)}
              </p>
              {window.reasonCode && <p className="mt-1 font-mono text-[11px] text-muted-foreground">{window.reasonCode}</p>}
              {actual.map((item) => <p key={`${item.recipeId}:${item.window}`} className="mt-1 text-xs text-muted-foreground">
                {item.recipeId}: {formatRange(item.executedStartAt, item.executedEndAt, format)}
              </p>)}
            </div>;
          })}
        </div>
      </section>

      <section aria-labelledby="evidence-comparison-title" className="space-y-2">
        <h4 id="evidence-comparison-title" className="text-sm font-medium">{t('evidence.baselineActive')}</h4>
        {projection.comparisons.length === 0
          ? <p className="text-xs text-muted-foreground">{t('evidence.noComparisons')}</p>
          : <div className="space-y-2">{projection.comparisons.map((comparison) => (
            <div key={comparison.recipeId} className="rounded-md border border-border/70 p-3">
              <p className="font-mono text-xs">{comparison.recipeId}</p>
              <p className="mt-1 text-xs text-muted-foreground">
                {comparison.source} · {comparison.valueUnit} · {t('evidence.lookback', { seconds: comparison.lookbackSec })}
              </p>
              <div className="mt-2 grid gap-2 sm:grid-cols-2">
                <ComparisonCell
                  label={t('evidence.baseline')}
                  item={comparison.baseline}
                  summary={comparison.numeric?.baseline ?? null}
                  valueUnit={comparison.valueUnit}
                  locale={locale}
                  t={t}
                />
                <ComparisonCell
                  label={t('evidence.active')}
                  item={comparison.active}
                  summary={comparison.numeric?.active ?? null}
                  valueUnit={comparison.valueUnit}
                  locale={locale}
                  t={t}
                />
              </div>
              {comparison.numeric?.status === 'AVAILABLE' && comparison.numeric.delta && <p className="mt-2 text-xs text-muted-foreground">
                {t('evidence.delta')}: {formatMetricSummary(t, comparison.numeric.delta, comparison.valueUnit, locale)}
                {comparison.numeric.percentDelta && ` · ${t('evidence.percentDeltaSummary', {
                  minimum: formatPercent(comparison.numeric.percentDelta.minimum, locale, t),
                  maximum: formatPercent(comparison.numeric.percentDelta.maximum, locale, t),
                  latest: formatPercent(comparison.numeric.percentDelta.latest, locale, t),
                })}`}
              </p>}
              {comparison.numeric?.reasonCode && <p className="mt-1 font-mono text-[11px] text-muted-foreground">
                {comparison.numeric.reasonCode}
              </p>}
            </div>
          ))}</div>}
      </section>

      <section aria-labelledby="evidence-recipes-title" className="space-y-2">
        <h4 id="evidence-recipes-title" className="text-sm font-medium">{t('evidence.frozenRecipes')}</h4>
        {manifest.recipes.filter((recipe) => recipe.renderedQuery !== null).length === 0
          ? <p className="text-xs text-muted-foreground">{t('evidence.noFrozenRecipes')}</p>
          : <div className="space-y-2">{manifest.recipes
            .filter((recipe): recipe is EvidenceRecipeView & { readonly renderedQuery: string } => recipe.renderedQuery !== null)
            .map((recipe) => <details key={`${recipe.recipeId}:${recipe.window}`} className="rounded-md border border-border/70 p-3">
              <summary className="cursor-pointer text-xs font-medium">
                {recipe.recipeId} · {translateState(t, recipe.source)} · {translateWindow(t, recipe.window)}
              </summary>
              <pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap break-all rounded-sm bg-muted/40 p-2 text-[11px]">{recipe.renderedQuery}</pre>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="mt-2"
                onClick={() => void copyFrozenRecipe(recipe.recipeId, recipe.renderedQuery)}
              >
                {copiedRecipeId === recipe.recipeId ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
                {copiedRecipeId === recipe.recipeId ? t('evidence.recipeCopied') : t('evidence.copyRecipe')}
              </Button>
            </details>)}</div>}
        {copyError && <p role="alert" className="text-xs text-destructive">{t('evidence.copyRecipeFailed')}</p>}
        {copiedRecipeId && <p role="status" aria-live="polite" className="text-xs text-muted-foreground">{t('evidence.recipeCopied')}</p>}
      </section>

      <section aria-labelledby="evidence-current-title" className="space-y-2">
        <h4 id="evidence-current-title" className="text-sm font-medium">{t('evidence.currentChecks')}</h4>
        {projection.currentChecks.length === 0
          ? <p className="text-xs text-muted-foreground">{t('evidence.noCurrentChecks')}</p>
          : <div className="space-y-2">{projection.currentChecks.map(({ recipe, item }) => (
            <div key={`${recipe.recipeId}:${recipe.window}`} className="rounded-md border border-border/70 p-3">
              <p className="font-mono text-xs">{recipe.businessCheckId ?? recipe.recipeId}</p>
              <p className="mt-1 text-xs text-muted-foreground">
                {item
                  ? `${translateState(t, item.availability)} · ${item.queriedAt
                    ? t('evidence.checkedAt', { time: format.dateTime(new Date(item.queriedAt), 'compact') })
                    : t('evidence.notChecked')}`
                  : t('evidence.notChecked')}
              </p>
            </div>
          ))}</div>}
      </section>

      <section aria-labelledby="evidence-limitations-title" className="space-y-2">
        <h4 id="evidence-limitations-title" className="text-sm font-medium">{t('evidence.limitations')}</h4>
        {manifest.limitations.length === 0 && projection.report?.items.every((item) => !item.reasonCode)
          ? <p className="text-xs text-muted-foreground">{t('evidence.noLimitations')}</p>
          : <ul className="list-disc space-y-1 pl-5 text-xs text-muted-foreground">
            {manifest.limitations.map((limitation, index) => (
              <li key={`${limitation.code}:${limitation.window}:${index}`}>
                <code>{limitation.code}</code>{limitation.window ? ` · ${translateWindow(t, limitation.window)}` : ''}
              </li>
            ))}
            {[...new Set((projection.report?.items ?? [])
              .map((item) => item.reasonCode)
              .filter((code): code is string => code !== null))]
              .map((code) => <li key={code}><code>{code}</code></li>)}
          </ul>}
      </section>

      <section aria-labelledby="evidence-notes-title" className="space-y-2">
        <h4 id="evidence-notes-title" className="text-sm font-medium">{t('evidence.notes')}</h4>
        {panelState.metadata.notes.length === 0
          ? <p className="text-xs text-muted-foreground">{t('evidence.noNotes')}</p>
          : <div className="space-y-2">{panelState.metadata.notes.map((note) => (
            <article key={note.noteId} className="rounded-md border border-border/70 p-3">
              <p className="whitespace-pre-wrap break-words text-sm">{note.text}</p>
              <p className="mt-2 text-[11px] text-muted-foreground">
                {format.dateTime(new Date(note.createdAt), 'compact')} · #{note.operatorAuditId}
              </p>
            </article>
          ))}</div>}
        {panelState.metadata.omittedNoteCount > 0 && <p className="text-xs text-muted-foreground">
          {t('evidence.omittedHistory', { count: panelState.metadata.omittedNoteCount })}
        </p>}
        <form className="space-y-2" onSubmit={submitNote}>
          <label htmlFor="evidence-note-text" className="block text-xs text-muted-foreground">
            {t('evidence.notePrompt')}
          </label>
          <textarea
            id="evidence-note-text"
            className="min-h-20 w-full resize-y rounded-md border border-input bg-background px-3 py-2 text-sm"
            value={noteText}
            onChange={(event) => setNoteText(event.target.value)}
            maxLength={2048}
            disabled={noteBusy || reportBusy || noteRetry !== null}
            aria-describedby="evidence-note-help evidence-note-size"
          />
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p id="evidence-note-help" className="text-[11px] text-muted-foreground">{t('evidence.noteSafety')}</p>
            <span id="evidence-note-size" className="text-[11px] text-muted-foreground">
              {t('evidence.noteBytes', { current: noteBytes })}
            </span>
          </div>
          {noteError && <p role="alert" className="text-xs text-destructive">{t('evidence.noteFailed')} · {noteError}</p>}
          <div className="flex flex-wrap gap-2">
            <Button type="submit" size="sm" disabled={
              noteBusy || reportBusy || noteRetry !== null || noteBytes > 2048 || noteText.trim().length === 0
            }>
              <Send className="size-3.5" />
              {noteBusy ? t('evidence.noteSaving') : t('evidence.addNote')}
            </Button>
            {noteRetry && <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => void executeNote(noteRetry)}
              disabled={noteBusy || reportBusy}
            >
              {t('evidence.retrySameRequest', { revision: noteRetry.manifest.manifestRevision })}
            </Button>}
          </div>
        </form>
      </section>

      <p className="text-xs text-muted-foreground">
        {t('evidence.effectHistoryLimitation')}
      </p>
    </>}
  </section>
  {reportConfirmation && <ConfirmDialog
    title={t('evidence.confirmReportTitle')}
    description={t('evidence.confirmReportDescription')}
    onCancel={() => setReportConfirmation(null)}
    onConfirm={async () => {
      const request = reportConfirmation;
      await executeLiveReport(request);
      setReportConfirmation(null);
    }}
  />}
  </>;
}

function StatusMessage({ children }: { readonly children: string }) {
  return <p role="status" aria-live="polite" className="rounded-md border border-border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
    {children}
  </p>;
}

function StatusCard({ label, value }: { readonly label: string; readonly value: string }) {
  return <div className="rounded-md border border-border/70 p-3">
    <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</p>
    <p className="mt-1 break-words text-sm font-medium">{value}</p>
  </div>;
}

function ComparisonCell({ label, item, summary, valueUnit, locale, t }: {
  readonly label: string;
  readonly item: EvidencePanelProjection['comparisons'][number]['active'];
  readonly summary: EvidenceMetricSummaryView | null;
  readonly valueUnit: string;
  readonly locale: string;
  readonly t: ReturnType<typeof useTranslations<'Scenarios'>>;
}) {
  return <div className="rounded-sm bg-muted/40 p-2">
    <p className="text-[11px] text-muted-foreground">{label}</p>
    <p className="mt-1 text-xs font-medium">{item ? translateState(t, item.availability) : t('evidence.notQueried')}</p>
    {item && <p className="mt-1 text-[11px] text-muted-foreground">
      {translateState(t, item.coverage)} · {translateState(t, item.predicateOutcome)}
      {item.reasonCode ? ` · ${item.reasonCode}` : ''}
    </p>}
    {summary && <p className="mt-1 text-[11px] text-muted-foreground">
      {formatMetricSummary(t, summary, valueUnit, locale)}
    </p>}
  </div>;
}

function formatMetricSummary(
  t: ReturnType<typeof useTranslations<'Scenarios'>>,
  summary: EvidenceMetricSummaryView | null,
  valueUnit: string,
  locale: string,
): string {
  if (!summary) return '';
  const format = new Intl.NumberFormat(locale, { maximumFractionDigits: 6 });
  return t('evidence.metricSummary', {
    points: summary.pointCount,
    minimum: format.format(summary.minimum),
    maximum: format.format(summary.maximum),
    latest: format.format(summary.latest),
    unit: valueUnit,
  });
}

function formatPercent(
  value: number | null,
  locale: string,
  t: ReturnType<typeof useTranslations<'Scenarios'>>,
): string {
  return value === null ? t('evidence.percentageOmitted') : `${new Intl.NumberFormat(locale, { maximumFractionDigits: 2 }).format(value)}%`;
}

function translateState(t: ReturnType<typeof useTranslations<'Scenarios'>>, value: string): string {
  const key = `evidence.states.${value}`;
  try {
    return t(key as never);
  } catch {
    return t('evidence.unknownValue');
  }
}

function translateWindow(t: ReturnType<typeof useTranslations<'Scenarios'>>, value: string): string {
  const key = `evidence.windowNames.${value}`;
  try {
    return t(key as never);
  } catch {
    return t('evidence.unknownValue');
  }
}

function formatRange(
  startAt: string | null,
  endAt: string | null,
  format: ReturnType<typeof useFormatter>,
): string {
  if (!startAt || !endAt) return '—';
  return `${format.dateTime(new Date(startAt), 'compact')} – ${format.dateTime(new Date(endAt), 'compact')}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function shouldOfferSameRequestRetry(error: unknown): boolean {
  if (error instanceof TypeError) return true;
  return error instanceof EvidencePanelRequestError
    && (error.status === 408 || error.status === 429 || error.status >= 500);
}
