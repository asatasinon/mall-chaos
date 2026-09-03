'use client';

import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { AlertTriangle, Plus, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { AREA_CLASS, CreateAlertMode, Match, Receiver, Rule, Severity } from '@/components/alerts/types';
import { Field } from '@/components/LocalizedAlertEditors';

interface CreateAlertModalProps {
  mode: CreateAlertMode;
  onModeChange: (mode: CreateAlertMode) => void;
  rule: Rule;
  onRuleChange: (rule: Rule) => void;
  sourceYaml: string;
  onSourceYamlChange: (yaml: string) => void;
  error: string;
  saving: boolean;
  onClose: () => void;
  onAddRule: () => void;
  onImportYaml: () => void;
}

export function CreateAlertModal({ mode, onModeChange, rule, onRuleChange, sourceYaml, onSourceYamlChange, error, saving, onClose, onAddRule, onImportYaml }: CreateAlertModalProps) {
  const t = useTranslations('Alerts');
  const commonT = useTranslations('Common');
  const setRule = (patch: Partial<Rule>) => onRuleChange({ ...rule, ...patch });
  return <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4" role="dialog" aria-modal="true" aria-labelledby="create-alert-title" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <div className="max-h-[calc(100vh-2rem)] w-full max-w-3xl overflow-y-auto rounded-lg border border-border bg-card shadow-2xl">
      <div className="flex items-start justify-between border-b border-border px-5 py-4"><div><h2 id="create-alert-title" className="text-base font-semibold">{t('newAlert')}</h2><p className="mt-0.5 text-xs text-muted-foreground">{t('newAlertHelp')}</p></div><Button variant="ghost" size="icon" title={t('close')} aria-label={t('close')} onClick={onClose}>×</Button></div>
      <div className="grid grid-cols-2 gap-2 border-b border-border p-4"><button type="button" className={`rounded-md border px-3 py-2 text-left text-sm ${mode === 'rule' ? 'border-primary bg-primary/10' : 'border-border hover:bg-muted'}`} onClick={() => onModeChange('rule')}><span className="block font-medium">{t('createRuleFromForm')}</span><span className="mt-0.5 block text-xs text-muted-foreground">{t('createRuleFromFormHelp')}</span></button><button type="button" className={`rounded-md border px-3 py-2 text-left text-sm ${mode === 'prometheus-rules' ? 'border-primary bg-primary/10' : 'border-border hover:bg-muted'}`} onClick={() => onModeChange('prometheus-rules')}><span className="block font-medium">{t('parsePrometheusYaml')}</span><span className="mt-0.5 block text-xs text-muted-foreground">{t('parsePrometheusYamlHelp')}</span></button></div>
      <div className="p-5">
        {mode === 'rule' ? <div className="grid gap-3 md:grid-cols-2"><Field label={t('ruleName')}><input className="h-8 w-full rounded-md border border-input bg-background px-2.5 text-sm outline-none focus:ring-2 focus:ring-ring/40" value={rule.ruleName} onChange={(event) => setRule({ ruleName: event.target.value })} /></Field><Field label={t('ruleGroup')}><input className="h-8 w-full rounded-md border border-input bg-background px-2.5 text-sm outline-none focus:ring-2 focus:ring-ring/40" value={rule.groupName} onChange={(event) => setRule({ groupName: event.target.value })} /></Field><Field label={t('evaluationInterval')}><input className="h-8 w-full rounded-md border border-input bg-background px-2.5 text-sm outline-none focus:ring-2 focus:ring-ring/40" type="number" min="1" value={rule.intervalSec} onChange={(event) => setRule({ intervalSec: Number(event.target.value) })} /></Field><Field label={t('durationField')}><input className="h-8 w-full rounded-md border border-input bg-background px-2.5 text-sm outline-none focus:ring-2 focus:ring-ring/40" placeholder="e.g. 2m" value={rule.forDuration} onChange={(event) => setRule({ forDuration: event.target.value })} /></Field><Field label={t('severity')}><select className="h-8 w-full rounded-md border border-input bg-background px-2.5 text-sm outline-none focus:ring-2 focus:ring-ring/40" value={rule.severity} onChange={(event) => setRule({ severity: event.target.value as Severity })}><SeverityOptions /></select></Field><Field label={t('summary')}><input className="h-8 w-full rounded-md border border-input bg-background px-2.5 text-sm outline-none focus:ring-2 focus:ring-ring/40" value={rule.summary} onChange={(event) => setRule({ summary: event.target.value })} /></Field><Field label={t('promqlExpression')} wide><textarea className="min-h-20 w-full rounded-md border border-input bg-background px-2.5 py-1.5 font-mono text-sm outline-none focus:ring-2 focus:ring-ring/40" value={rule.expression} onChange={(event) => setRule({ expression: event.target.value })} /></Field><Field label={t('description')} wide><textarea className="min-h-20 w-full rounded-md border border-input bg-background px-2.5 py-1.5 font-mono text-sm outline-none focus:ring-2 focus:ring-ring/40" value={rule.description} onChange={(event) => setRule({ description: event.target.value })} /></Field></div> : <div className="space-y-3"><p className="text-xs text-muted-foreground">{t('prometheusYamlHelp')}</p><textarea className={`${AREA_CLASS} min-h-64`} value={sourceYaml} onChange={(event) => onSourceYamlChange(event.target.value)} placeholder={'groups:\n  - name: castrel-custom\n    interval: 30s\n    rules:\n      - alert: ServiceDown\n        expr: up == 0\n        for: 1m\n        labels:\n          severity: critical\n        annotations:\n          summary: Service unavailable'} /></div>}
      </div>
      {error && <div className="mx-5 mb-3 flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive"><AlertTriangle className="mt-0.5 size-4 shrink-0" />{error}</div>}<div className="flex justify-end gap-2 border-t border-border px-5 py-3"><Button variant="outline" onClick={onClose}>{commonT('cancel')}</Button>{mode === 'rule' ? <Button onClick={onAddRule} disabled={saving || !rule.ruleName.trim() || !rule.expression.trim()}><Plus />{t('addRule')}</Button> : <Button onClick={onImportYaml} disabled={saving || !sourceYaml.trim()}><RefreshCw />{saving ? t('parsing') : t('parseAndApply')}</Button>}</div>
    </div>
  </div>;
}

interface ReceiverModalProps {
  receiver: Receiver;
  onChange: (receiver: Receiver) => void;
  sourceYaml: string;
  onSourceYamlChange: (yaml: string) => void;
  error: string;
  saving: boolean;
  onClose: () => void;
  onAdd: () => void;
  onImportYaml: () => void;
}

export function ReceiverModal({ receiver, onChange, sourceYaml, onSourceYamlChange, error, saving, onClose, onAdd, onImportYaml }: ReceiverModalProps) {
  const [mode, setMode] = useState<'form' | 'yaml'>('form');
  const t = useTranslations('Alerts');
  const commonT = useTranslations('Common');
  const set = (patch: Partial<Receiver>) => onChange({ ...receiver, ...patch });
  return <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4" role="dialog" aria-modal="true" aria-labelledby="create-receiver-title" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <div className="w-full max-w-2xl rounded-lg border border-border bg-card shadow-2xl">
      <div className="flex items-start justify-between border-b border-border px-5 py-4"><div><h2 id="create-receiver-title" className="text-base font-semibold">{t('newReceiver')}</h2><p className="mt-0.5 text-xs text-muted-foreground">{t('newReceiverHelp')}</p></div><Button variant="ghost" size="icon" title={t('close')} aria-label={t('close')} onClick={onClose}>×</Button></div>
      <div className="grid grid-cols-2 gap-2 border-b border-border p-4"><button type="button" className={`rounded-md border px-3 py-2 text-left text-sm ${mode === 'form' ? 'border-primary bg-primary/10' : 'border-border hover:bg-muted'}`} onClick={() => setMode('form')}><span className="block font-medium">{t('configureReceiverFromForm')}</span><span className="mt-0.5 block text-xs text-muted-foreground">{t('configureReceiverFromFormHelp')}</span></button><button type="button" className={`rounded-md border px-3 py-2 text-left text-sm ${mode === 'yaml' ? 'border-primary bg-primary/10' : 'border-border hover:bg-muted'}`} onClick={() => setMode('yaml')}><span className="block font-medium">{t('parseAlertmanagerYaml')}</span><span className="mt-0.5 block text-xs text-muted-foreground">{t('parseAlertmanagerYamlHelp')}</span></button></div>
      {mode === 'form' ? <div className="grid gap-3 p-5 md:grid-cols-2"><Field label={t('receiverName')}><input className="h-8 w-full rounded-md border border-input bg-background px-2.5 text-sm outline-none focus:ring-2 focus:ring-ring/40" value={receiver.receiverName} onChange={(event) => set({ receiverName: event.target.value })} /></Field><Field label={t('severityMatch')}><select className="h-8 w-full rounded-md border border-input bg-background px-2.5 text-sm outline-none focus:ring-2 focus:ring-ring/40" value={receiver.severityMatch} onChange={(event) => set({ severityMatch: event.target.value as Match })}><option value="all">{t('all')}</option><SeverityOptions /></select></Field><Field label={t('webhookUrl')} wide><input className="h-8 w-full rounded-md border border-input bg-background px-2.5 text-sm outline-none focus:ring-2 focus:ring-ring/40" type="url" value={receiver.endpoint} onChange={(event) => set({ endpoint: event.target.value })} /></Field><Field label={t('basicAuthUsername')}><input className="h-8 w-full rounded-md border border-input bg-background px-2.5 text-sm outline-none focus:ring-2 focus:ring-ring/40" value={receiver.basicAuthUsername ?? ''} onChange={(event) => set({ basicAuthUsername: event.target.value })} /></Field><Field label={t('basicAuthPassword')}><input className="h-8 w-full rounded-md border border-input bg-background px-2.5 text-sm outline-none focus:ring-2 focus:ring-ring/40" type="password" value={receiver.basicAuthPassword ?? ''} onChange={(event) => set({ basicAuthPassword: event.target.value })} /></Field><div className="flex items-center gap-4 md:col-span-2"><label className="flex items-center gap-1.5 text-xs"><input type="checkbox" checked={receiver.sendResolved} onChange={(event) => set({ sendResolved: event.target.checked })} />{t('sendResolved')}</label><label className="flex items-center gap-1.5 text-xs"><input type="checkbox" checked={receiver.enabled} onChange={(event) => set({ enabled: event.target.checked })} />{t('enabled')}</label></div></div> : <div className="space-y-3 p-5"><p className="text-xs text-muted-foreground">{t('alertmanagerYamlHelp')}</p><textarea className={`${AREA_CLASS} min-h-64`} value={sourceYaml} onChange={(event) => onSourceYamlChange(event.target.value)} placeholder={'route:\n  receiver: "keep"\nreceivers:\n  - name: "keep"\n    webhook_configs:\n      - url: "https://example.com/alerts"'} /></div>}
      {error && <div className="mx-5 mb-3 flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive"><AlertTriangle className="mt-0.5 size-4 shrink-0" />{error}</div>}<div className="flex justify-end gap-2 border-t border-border px-5 py-3"><Button variant="outline" onClick={onClose}>{commonT('cancel')}</Button>{mode === 'form' ? <Button onClick={onAdd} disabled={saving || !receiver.receiverName.trim() || !/^https?:\/\//.test(receiver.endpoint)}><Plus />{t('addReceiver')}</Button> : <Button onClick={onImportYaml} disabled={saving || !sourceYaml.trim()}><RefreshCw />{saving ? t('parsing') : t('parseAndApply')}</Button>}</div>
    </div>
  </div>;
}

export function RouteModal({ route, onChange, saving, onClose, onAdd }: { route: import('@/components/alerts/types').AlertRoute; onChange: (route: import('@/components/alerts/types').AlertRoute) => void; saving: boolean; onClose: () => void; onAdd: () => void }) {
  const t = useTranslations('Alerts');
  const commonT = useTranslations('Common');
  const set = (patch: Partial<typeof route>) => onChange({ ...route, ...patch });
  const matchText = Object.entries(route.match).map(([key, value]) => `${key}=${value}`).join(', ');
  return <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4" role="dialog" aria-modal="true" aria-labelledby="create-route-title" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <div className="w-full max-w-2xl rounded-lg border border-border bg-card shadow-2xl">
      <div className="flex items-start justify-between border-b border-border px-5 py-4"><div><h2 id="create-route-title" className="text-base font-semibold">{t('newRoute')}</h2><p className="mt-0.5 text-xs text-muted-foreground">{t('newRouteHelp')}</p></div><Button variant="ghost" size="icon" title={t('close')} aria-label={t('close')} onClick={onClose}>×</Button></div>
      <div className="grid gap-3 p-5 md:grid-cols-2"><Field label={t('receiver')}><input className="h-8 w-full rounded-md border border-input bg-background px-2.5 text-sm outline-none focus:ring-2 focus:ring-ring/40" value={route.receiver} onChange={(event) => set({ receiver: event.target.value })} /></Field><Field label={t('matchingLabels')} wide><input className="h-8 w-full rounded-md border border-input bg-background px-2.5 text-sm outline-none focus:ring-2 focus:ring-ring/40" value={matchText} placeholder={t('matchingLabelsPlaceholder')} onChange={(event) => set({ match: Object.fromEntries(event.target.value.split(',').map((item) => item.trim().split('=').map((part) => part.trim())).filter(([key, value]) => key && value)) })} /></Field><Field label={t('groupByOptional')}><input className="h-8 w-full rounded-md border border-input bg-background px-2.5 text-sm outline-none focus:ring-2 focus:ring-ring/40" value={route.groupBy?.join(', ') ?? ''} onChange={(event) => set({ groupBy: event.target.value.split(',').map((item) => item.trim()).filter(Boolean) || undefined })} /></Field><Field label={t('groupWaitOptional')}><input className="h-8 w-full rounded-md border border-input bg-background px-2.5 text-sm outline-none focus:ring-2 focus:ring-ring/40" value={route.groupWait ?? ''} onChange={(event) => set({ groupWait: event.target.value || undefined })} /></Field><Field label={t('groupIntervalOptional')}><input className="h-8 w-full rounded-md border border-input bg-background px-2.5 text-sm outline-none focus:ring-2 focus:ring-ring/40" value={route.groupInterval ?? ''} onChange={(event) => set({ groupInterval: event.target.value || undefined })} /></Field><Field label={t('repeatIntervalOptional')}><input className="h-8 w-full rounded-md border border-input bg-background px-2.5 text-sm outline-none focus:ring-2 focus:ring-ring/40" value={route.repeatInterval ?? ''} onChange={(event) => set({ repeatInterval: event.target.value || undefined })} /></Field><label className="flex items-center gap-1.5 text-xs md:col-span-2"><input type="checkbox" checked={route.continue} onChange={(event) => set({ continue: event.target.checked })} />{t('continueMatching')}</label></div>
      <div className="flex justify-end gap-2 border-t border-border px-5 py-3"><Button variant="outline" onClick={onClose}>{commonT('cancel')}</Button><Button onClick={onAdd} disabled={saving || !route.receiver.trim() || !Object.keys(route.match).length}><Plus />{t('addRouteButton')}</Button></div>
    </div>
  </div>;
}

function SeverityOptions() {
  const t = useTranslations('Alerts');
  return <><option value="critical">{t('critical')}</option><option value="warning">{t('warning')}</option><option value="info">{t('info')}</option></>;
}
