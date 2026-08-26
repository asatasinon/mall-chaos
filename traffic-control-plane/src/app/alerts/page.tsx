'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Plus, Save, Trash2, RefreshCw, AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

async function fetchAlerts(input: RequestInfo | URL, init: RequestInit | undefined, onUnauthorized: () => void): Promise<Response> {
  const response = await fetch(input, init);
  if (response.status === 401 && typeof window !== 'undefined') {
    onUnauthorized();
  }
  return response;
}

type Severity = 'critical' | 'warning' | 'info';
type Match = 'all' | Severity;
type SourceKind = 'prometheus-rules' | 'alertmanager';
interface Rule { id?: number; isDraft?: boolean; ruleName: string; groupName: string; intervalSec: number; expression: string; forDuration: string; severity: Severity; summary: string; description: string; enabled: boolean }
interface Receiver { id?: number; isDraft?: boolean; receiverName: string; receiverType: 'webhook'; endpoint: string; basicAuthUsername?: string; basicAuthPassword?: string; basicAuthPasswordSet?: boolean; severityMatch: Match; sendResolved: boolean; enabled: boolean }
interface AlertRoute { isDraft?: boolean; receiver: string; match: Record<string, string>; groupBy?: string[]; groupWait?: string; groupInterval?: string; repeatInterval?: string; continue: boolean }
interface Config { version: number; rules: Rule[]; receivers: Receiver[]; updatedAt: string | null; route: { receiver: string; groupBy: string[]; groupWait: string; groupInterval: string; repeatInterval: string; continue: boolean; routes: AlertRoute[] } }

const blankRule = (): Rule => ({ ruleName: 'NewAlert', groupName: 'castrel-custom', intervalSec: 30, expression: 'up == 0', forDuration: '1m', severity: 'warning', summary: 'Service issue', description: 'Service unavailable.', enabled: true });
const blankReceiver = (): Receiver => ({ receiverName: 'custom-receiver', receiverType: 'webhook', endpoint: 'https://example.com/webhook', basicAuthUsername: '', basicAuthPassword: '', severityMatch: 'all', sendResolved: true, enabled: true });
const blankRoute = (): AlertRoute => ({ receiver: 'custom-receiver', match: { severity: 'warning' }, continue: false });
const draftWrapperClass = 'rounded-xl bg-amber-500/10 p-1 ring-2 ring-amber-500/60 scroll-mt-24 focus:outline-none';

export default function AlertsPage() {
  const router = useRouter();
  const [config, setConfig] = useState<Config | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [saving, setSaving] = useState(false);
  const [importError, setImportError] = useState('');
  const [sourceYaml, setSourceYaml] = useState('');
  const [sourceKind, setSourceKind] = useState<SourceKind>('prometheus-rules');
  const [sourceVersion, setSourceVersion] = useState<number | null>(null);
  const [sourceLoading, setSourceLoading] = useState(false);
  const [sourceDirty, setSourceDirty] = useState(false);
  const [editorYaml, setEditorYaml] = useState('');
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [receiverModalOpen, setReceiverModalOpen] = useState(false);
  const [routeModalOpen, setRouteModalOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<'rules' | 'routing' | 'yaml'>('rules');
  const [createMode, setCreateMode] = useState<'rule' | 'prometheus-rules'>('rule');
  const [draftRule, setDraftRule] = useState<Rule>(blankRule());
  const [draftReceiver, setDraftReceiver] = useState<Receiver>(blankReceiver());
  const [draftRoute, setDraftRoute] = useState<AlertRoute>(blankRoute());
  const [scrollTarget, setScrollTarget] = useState('');
  const itemRefs = useRef<Record<string, HTMLDivElement | null>>({});

  const load = async () => {
    setError('');
    try {
      const response = await fetchAlerts('/internal/alerts/config', { cache: 'no-store' }, () => router.push(`/login?returnTo=${encodeURIComponent(window.location.pathname)}`));
      const result = await response.json();
      if (!response.ok || result.code !== 0) throw new Error(result.message);
      setConfig(result.data);
    } catch (cause) { setError(cause instanceof TypeError && cause.message.toLowerCase().includes('fetch') ? 'Control plane is unreachable. Start traffic-control-plane (localhost:13086) first.' : cause instanceof Error ? cause.message : 'Load failed'); }
  };
  const loadSource = async (kind: SourceKind) => {
    setSourceLoading(true); setError('');
    try {
      const response = await fetchAlerts(`/internal/alerts/source?kind=${kind}`, { cache: 'no-store' }, () => router.push(`/login?returnTo=${encodeURIComponent(window.location.pathname)}`));
      const result = await response.json();
      if (!response.ok || result.code !== 0) throw new Error(result.message);
      setEditorYaml(result.data.yaml); setSourceVersion(result.data.version); setSourceDirty(false);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Failed to load YAML'); }
    finally { setSourceLoading(false); }
  };
  const saveSource = async () => {
    if (!config || sourceVersion === null || !editorYaml.trim()) return;
    setSaving(true); setError(''); setNotice('');
    try {
      const response = await fetchAlerts('/internal/alerts/source', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ kind: sourceKind, version: sourceVersion, yaml: editorYaml }) }, () => router.push(`/login?returnTo=${encodeURIComponent(window.location.pathname)}`));
      const result = await response.json();
      if (!response.ok || result.code !== 0) throw new Error(result.message);
      const configResponse = await fetchAlerts('/internal/alerts/config', { cache: 'no-store' }, () => router.push(`/login?returnTo=${encodeURIComponent(window.location.pathname)}`));
      const configResult = await configResponse.json();
      setConfig(configResult.data); setEditorYaml(result.data.yaml); setSourceVersion(result.data.version); setSourceDirty(false);
      setNotice(`${sourceKind === 'prometheus-rules' ? 'Prometheus rules' : 'Alertmanager'} YAML saved and reloaded`);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Failed to save YAML'); }
    finally { setSaving(false); }
  };
  useEffect(() => { void Promise.resolve().then(() => load()); }, []);
  useEffect(() => { if (activeTab === 'yaml') void Promise.resolve().then(() => loadSource(sourceKind)); }, [activeTab, sourceKind]);
  useEffect(() => {
    if (!scrollTarget) return;
    const target = itemRefs.current[scrollTarget];
    target?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    target?.focus({ preventScroll: true });
    const clearTarget = window.setTimeout(() => setScrollTarget(''), 0);
    return () => window.clearTimeout(clearTarget);
  }, [config, scrollTarget]);

  const save = async () => {
    if (!config) return;
    setSaving(true); setError(''); setNotice('');
    try {
      const persistableConfig = {
        ...config,
        rules: config.rules.map((rule) => { const next = { ...rule }; delete next.isDraft; return next; }),
        receivers: config.receivers.map((receiver) => { const next = { ...receiver }; delete next.isDraft; return next; }),
        route: { ...config.route, routes: config.route.routes.map((route) => { const next = { ...route }; delete next.isDraft; return next; }) },
      };
      const response = await fetchAlerts('/internal/alerts/config', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(persistableConfig) }, () => router.push(`/login?returnTo=${encodeURIComponent(window.location.pathname)}`));
      const result = await response.json();
      if (!response.ok || result.code !== 0) throw new Error(result.message);
      setConfig(result.data); setNotice('Configuration saved; Prometheus and Alertmanager reloaded');
    } catch (cause) { setError(cause instanceof TypeError && cause.message.toLowerCase().includes('fetch') ? 'Control plane is unreachable. Configuration could not be saved.' : cause instanceof Error ? cause.message : 'Save failed'); }
    finally { setSaving(false); }
  };

  const importYaml = async (kind: 'prometheus-rules' | 'alertmanager') => {
    if (!config || !sourceYaml.trim()) return;
    setSaving(true); setError(''); setImportError(''); setNotice('');
    try {
      const response = await fetchAlerts('/internal/alerts/config', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ version: config.version, kind, yaml: sourceYaml }) }, () => router.push(`/login?returnTo=${encodeURIComponent(window.location.pathname)}`));
      const result = await response.json();
      if (!response.ok || result.code !== 0) throw new Error(result.message);
      setConfig(result.data); setSourceYaml(''); setCreateModalOpen(false); setReceiverModalOpen(false); setNotice(kind === 'prometheus-rules' ? 'Prometheus alert rules YAML parsed; rules appended to the current configuration' : 'Alertmanager YAML parsed; receivers appended to the current configuration');
    } catch (cause) { setImportError(cause instanceof TypeError && cause.message.toLowerCase().includes('fetch') ? 'Control plane is unreachable. YAML could not be parsed and applied.' : cause instanceof Error ? cause.message : 'Import failed'); }
    finally { setSaving(false); }
  };

  const addRule = () => {
    if (!config) return;
    const nextIndex = config.rules.length;
    setConfig({ ...config, rules: [...config.rules, { ...draftRule, isDraft: true }] });
    setDraftRule(blankRule());
    setCreateModalOpen(false);
    setActiveTab('rules');
    setScrollTarget(`rule-${nextIndex}`);
    setNotice('Rule added to the pending configuration');
  };

  const addReceiver = () => {
    if (!config) return;
    const nextIndex = config.receivers.length;
    setConfig({ ...config, receivers: [...config.receivers, { ...draftReceiver, isDraft: true }] });
    setDraftReceiver(blankReceiver());
    setReceiverModalOpen(false);
    setActiveTab('routing');
    setScrollTarget(`receiver-${nextIndex}`);
    setNotice('Receiver added to the pending configuration');
  };

  const addRoute = () => {
    if (!config) return;
    const nextIndex = config.route.routes.length;
    setConfig({ ...config, route: { ...config.route, routes: [...config.route.routes, { ...draftRoute, isDraft: true }] } });
    setDraftRoute(blankRoute());
    setRouteModalOpen(false);
    setActiveTab('routing');
    setScrollTarget(`route-${nextIndex}`);
    setNotice('Route added to the pending configuration');
  };

  if (!config) return <div className="space-y-4"><p className="text-sm text-muted-foreground">Loading configuration...</p>{error && <ErrorBox text={error} />}</div>;
  const refreshCurrent = () => activeTab === 'yaml' ? void loadSource(sourceKind) : void load();
  const saveCurrent = () => activeTab === 'yaml' ? void saveSource() : void save();
  const saveDisabled = saving || (activeTab === 'yaml' && (sourceLoading || !sourceDirty || !editorYaml.trim()));
  return (
    <div className="flex h-full min-h-0 w-full flex-col gap-5">
      {error && <ErrorBox text={error} />}
      {notice && <div className="border border-green-700/30 bg-green-700/10 text-green-800 dark:text-green-300 px-4 py-2.5 rounded-md text-sm">{notice}</div>}
      <AlertsToolbar activeTab={activeTab} onTabChange={setActiveTab} onRefresh={refreshCurrent} onSave={saveCurrent} saveDisabled={saveDisabled} saving={saving} onAddRule={() => { setDraftRule(blankRule()); setCreateMode('rule'); setCreateModalOpen(true); }} onAddRoute={() => { setDraftRoute(blankRoute()); setRouteModalOpen(true); }} onAddReceiver={() => { setDraftReceiver(blankReceiver()); setReceiverModalOpen(true); }} />
      <div className="min-h-0 flex-1 overflow-y-auto pr-1">
      {activeTab === 'yaml' && <YamlSourceEditor kind={sourceKind} onKindChange={setSourceKind} yaml={editorYaml} loading={sourceLoading} saving={saving} dirty={sourceDirty} version={sourceVersion} onChange={(value) => { setEditorYaml(value); setSourceDirty(true); }} />}
      {activeTab === 'rules' && <section className="space-y-3">
        <div><h2 className="text-base font-semibold">Alert rules</h2><p className="text-xs text-muted-foreground">PromQL Rules are generated into Prometheus rule groups</p></div>
        <div className="space-y-3">{config.rules.map((rule, index) => <div key={`${rule.id ?? 'new'}-${index}`} ref={(element) => { itemRefs.current[`rule-${index}`] = element; }} tabIndex={-1} className={rule.isDraft ? draftWrapperClass : ''}><RuleEditor rule={rule} onChange={(next) => setConfig({ ...config, rules: config.rules.map((item, i) => i === index ? next : item) })} onDelete={() => setConfig({ ...config, rules: config.rules.filter((_, i) => i !== index) })} /></div>)}</div>
      </section>}
      {activeTab === 'routing' && <section className="space-y-3">
        <AlertRoutingSection config={config} cardRef={(index, element) => { itemRefs.current[`route-${index}`] = element; }} onChange={(route) => setConfig({ ...config, route })} />
        <div><h2 className="text-base font-semibold">Receivers</h2><p className="text-xs text-muted-foreground">Route alerts by severity to Webhook receiver</p></div>
        <div className="space-y-3">{config.receivers.map((receiver, index) => <div key={`${receiver.id ?? 'new'}-${index}`} ref={(element) => { itemRefs.current[`receiver-${index}`] = element; }} tabIndex={-1} className={receiver.isDraft ? draftWrapperClass : ''}><ReceiverEditor receiver={receiver} onChange={(next) => setConfig({ ...config, receivers: config.receivers.map((item, i) => i === index ? next : item) })} onDelete={() => setConfig({ ...config, receivers: config.receivers.filter((_, i) => i !== index) })} /></div>)}</div>
      </section>}
      </div>
      {createModalOpen && <CreateAlertModal mode={createMode} onModeChange={setCreateMode} rule={draftRule} onRuleChange={setDraftRule} sourceYaml={sourceYaml} onSourceYamlChange={setSourceYaml} error={importError} saving={saving} onClose={() => { setImportError(''); setCreateModalOpen(false); }} onAddRule={addRule} onImportYaml={() => void importYaml('prometheus-rules')} />}
      {receiverModalOpen && <ReceiverModal receiver={draftReceiver} onChange={setDraftReceiver} sourceYaml={sourceYaml} onSourceYamlChange={setSourceYaml} error={importError} saving={saving} onClose={() => { setImportError(''); setReceiverModalOpen(false); }} onAdd={addReceiver} onImportYaml={() => void importYaml('alertmanager')} />}
      {routeModalOpen && <RouteModal route={draftRoute} onChange={setDraftRoute} saving={saving} onClose={() => setRouteModalOpen(false)} onAdd={addRoute} />}
    </div>
  );
}

function AlertsToolbar({ activeTab, onTabChange, onRefresh, onSave, saveDisabled, saving, onAddRule, onAddRoute, onAddReceiver }: { activeTab: 'rules' | 'routing' | 'yaml'; onTabChange: (tab: 'rules' | 'routing' | 'yaml') => void; onRefresh: () => void; onSave: () => void; saveDisabled: boolean; saving: boolean; onAddRule: () => void; onAddRoute: () => void; onAddReceiver: () => void }) {
  return <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border"><div className="flex flex-wrap"><TabButton active={activeTab === 'rules'} onClick={() => onTabChange('rules')}>Alert rules</TabButton><TabButton active={activeTab === 'routing'} onClick={() => onTabChange('routing')}>Routes and receivers</TabButton><TabButton active={activeTab === 'yaml'} onClick={() => onTabChange('yaml')}>Full YAML file</TabButton></div><div className="flex flex-wrap items-center gap-2 pb-1"><Button variant="outline" size="sm" onClick={onRefresh} disabled={saving}><RefreshCw />Refresh</Button><Button variant="outline" size="sm" onClick={onSave} disabled={saveDisabled}><Save />Save</Button>{activeTab === 'rules' && <Button variant="outline" size="sm" onClick={onAddRule}><Plus />New rule</Button>}{activeTab === 'routing' && <><Button variant="outline" size="sm" onClick={onAddRoute}><Plus />New route</Button><Button variant="outline" size="sm" onClick={onAddReceiver}><Plus />New receiver</Button></>}</div></div>;
}
function TabButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) { return <button type="button" className={`relative px-4 py-2.5 text-sm font-medium ${active ? 'text-foreground' : 'text-muted-foreground hover:text-foreground'}`} onClick={onClick}>{children}{active && <span className="absolute inset-x-0 bottom-0 h-0.5 bg-primary" />}</button>; }
function YamlSourceEditor({ kind, onKindChange, yaml, loading, saving, dirty, version, onChange }: { kind: SourceKind; onKindChange: (kind: SourceKind) => void; yaml: string; loading: boolean; saving: boolean; dirty: boolean; version: number | null; onChange: (value: string) => void }) {
  return <section className="space-y-3"><div className="flex flex-wrap items-end justify-between gap-3"><div><h2 className="text-base font-semibold">Full YAML file editor</h2><p className="text-xs text-muted-foreground">Edit the active configuration file directly; saving validates, writes, and reloads the corresponding component.</p></div><select className={inputClass} value={kind} onChange={(event) => onKindChange(event.target.value as SourceKind)} disabled={loading || saving}><option value="prometheus-rules">Prometheus alert-rules.yml</option><option value="alertmanager">Alertmanager alertmanager.yml</option></select></div><div className="flex items-center justify-between text-xs text-muted-foreground"><span>{loading ? 'Reading file...' : dirty ? 'Unsaved changes. Use Save and Apply in the upper-right.' : 'Synchronized with server'}</span>{version !== null && <span>Configuration version v{version}</span>}</div><textarea aria-label={`${kind} YAML source`} className="min-h-[calc(100vh-16rem)] w-full resize-y rounded-md border border-input bg-background px-3 py-3 font-mono text-xs leading-5 outline-none focus:ring-2 focus:ring-ring/40" value={yaml} onChange={(event) => onChange(event.target.value)} disabled={loading || saving} spellCheck={false} /></section>;
}
function ErrorBox({ text }: { text: string }) { return <div className="flex gap-2 items-start rounded-md border border-destructive/40 bg-destructive/10 px-4 py-2.5 text-sm text-destructive"><AlertTriangle className="size-4 mt-0.5" />{text}</div>; }
function CreateAlertModal({ mode, onModeChange, rule, onRuleChange, sourceYaml, onSourceYamlChange, error, saving, onClose, onAddRule, onImportYaml }: { mode: 'rule' | 'prometheus-rules'; onModeChange: (mode: 'rule' | 'prometheus-rules') => void; rule: Rule; onRuleChange: (rule: Rule) => void; sourceYaml: string; onSourceYamlChange: (yaml: string) => void; error: string; saving: boolean; onClose: () => void; onAddRule: () => void; onImportYaml: () => void }) {
  const setRule = (patch: Partial<Rule>) => onRuleChange({ ...rule, ...patch });
  return <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4" role="dialog" aria-modal="true" aria-labelledby="create-alert-title" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <div className="w-full max-w-3xl max-h-[calc(100vh-2rem)] overflow-y-auto rounded-lg border border-border bg-card shadow-2xl">
      <div className="flex items-start justify-between border-b border-border px-5 py-4"><div><h2 id="create-alert-title" className="text-base font-semibold">New alert</h2><p className="mt-0.5 text-xs text-muted-foreground">Choose a configuration method, complete the fields here, and add it to the current configuration</p></div><Button variant="ghost" size="icon" title="Close" onClick={onClose}>×</Button></div>
      <div className="grid grid-cols-2 gap-2 border-b border-border p-4"><button type="button" className={`rounded-md border px-3 py-2 text-left text-sm ${mode === 'rule' ? 'border-primary bg-primary/10' : 'border-border hover:bg-muted'}`} onClick={() => onModeChange('rule')}><span className="block font-medium">Create rule from form</span><span className="mt-0.5 block text-xs text-muted-foreground">Enter PromQL and alert metadata</span></button><button type="button" className={`rounded-md border px-3 py-2 text-left text-sm ${mode === 'prometheus-rules' ? 'border-primary bg-primary/10' : 'border-border hover:bg-muted'}`} onClick={() => onModeChange('prometheus-rules')}><span className="block font-medium">Parse Prometheus rule YAML</span><span className="mt-0.5 block text-xs text-muted-foreground">Import groups and rules</span></button></div>
      <div className="p-5">
        {mode === 'rule' ? <div className="grid gap-3 md:grid-cols-2"><Field label="Rule name"><input className={inputClass} value={rule.ruleName} onChange={(e) => setRule({ ruleName: e.target.value })} /></Field><Field label="Group"><input className={inputClass} value={rule.groupName} onChange={(e) => setRule({ groupName: e.target.value })} /></Field><Field label="Evaluation interval (seconds)"><input className={inputClass} type="number" min="1" value={rule.intervalSec} onChange={(e) => setRule({ intervalSec: Number(e.target.value) })} /></Field><Field label="Duration"><input className={inputClass} placeholder="e.g. 2m" value={rule.forDuration} onChange={(e) => setRule({ forDuration: e.target.value })} /></Field><Field label="Severity"><select className={inputClass} value={rule.severity} onChange={(e) => setRule({ severity: e.target.value as Severity })}><option value="critical">critical</option><option value="warning">warning</option><option value="info">info</option></select></Field><Field label="Summary"><input className={inputClass} value={rule.summary} onChange={(e) => setRule({ summary: e.target.value })} /></Field><Field label="PromQL expression" wide><textarea className={areaClass} value={rule.expression} onChange={(e) => setRule({ expression: e.target.value })} /></Field><Field label="Description" wide><textarea className={areaClass} value={rule.description} onChange={(e) => setRule({ description: e.target.value })} /></Field></div> : <div className="space-y-3"><p className="text-xs text-muted-foreground">Paste Prometheus alert rule YAML containing <code>groups</code> and <code>rules</code>; parsed rules will be appended to the current alert rules.</p><textarea className={`${areaClass} min-h-64`} value={sourceYaml} onChange={(e) => onSourceYamlChange(e.target.value)} placeholder={'groups:\n  - name: castrel-custom\n    interval: 30s\n    rules:\n      - alert: ServiceDown\n        expr: up == 0\n        for: 1m\n        labels:\n          severity: critical\n        annotations:\n          summary: Service unavailable'} /></div>}
      </div>
      {error && <div className="mx-5 mb-3 flex gap-2 items-start rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive"><AlertTriangle className="size-4 mt-0.5 shrink-0" />{error}</div>}<div className="flex justify-end gap-2 border-t border-border px-5 py-3"><Button variant="outline" onClick={onClose}>Cancel</Button>{mode === 'rule' ? <Button onClick={onAddRule} disabled={saving || !rule.ruleName.trim() || !rule.expression.trim()}><Plus />Add rule</Button> : <Button onClick={onImportYaml} disabled={saving || !sourceYaml.trim()}><RefreshCw />{saving ? 'Parsing...' : 'Parse and apply'}</Button>}</div>
    </div>
  </div>;
}
function ReceiverModal({ receiver, onChange, sourceYaml, onSourceYamlChange, error, saving, onClose, onAdd, onImportYaml }: { receiver: Receiver; onChange: (receiver: Receiver) => void; sourceYaml: string; onSourceYamlChange: (yaml: string) => void; error: string; saving: boolean; onClose: () => void; onAdd: () => void; onImportYaml: () => void }) {
  const [mode, setMode] = useState<'form' | 'yaml'>('form');
  const set = (patch: Partial<Receiver>) => onChange({ ...receiver, ...patch });
  return <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4" role="dialog" aria-modal="true" aria-labelledby="create-receiver-title" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <div className="w-full max-w-2xl rounded-lg border border-border bg-card shadow-2xl">
      <div className="flex items-start justify-between border-b border-border px-5 py-4"><div><h2 id="create-receiver-title" className="text-base font-semibold">New receiver</h2><p className="mt-0.5 text-xs text-muted-foreground">Configure Webhook and optional Basic Auth</p></div><Button variant="ghost" size="icon" title="Close" onClick={onClose}>×</Button></div>
      <div className="grid grid-cols-2 gap-2 border-b border-border p-4"><button type="button" className={`rounded-md border px-3 py-2 text-left text-sm ${mode === 'form' ? 'border-primary bg-primary/10' : 'border-border hover:bg-muted'}`} onClick={() => setMode('form')}><span className="block font-medium">Configure receiver from form</span><span className="mt-0.5 block text-xs text-muted-foreground">Enter Webhook and authentication details</span></button><button type="button" className={`rounded-md border px-3 py-2 text-left text-sm ${mode === 'yaml' ? 'border-primary bg-primary/10' : 'border-border hover:bg-muted'}`} onClick={() => setMode('yaml')}><span className="block font-medium">Parse Alertmanager YAML</span><span className="mt-0.5 block text-xs text-muted-foreground">Import route and receivers directly</span></button></div>
      {mode === 'form' ? <div className="grid gap-3 p-5 md:grid-cols-2"><Field label="Receiver name"><input className={inputClass} value={receiver.receiverName} onChange={(e) => set({ receiverName: e.target.value })} /></Field><Field label="Severity match"><select className={inputClass} value={receiver.severityMatch} onChange={(e) => set({ severityMatch: e.target.value as Match })}><option value="all">All</option><option value="critical">critical</option><option value="warning">warning</option><option value="info">info</option></select></Field><Field label="Webhook URL" wide><input className={inputClass} type="url" value={receiver.endpoint} onChange={(e) => set({ endpoint: e.target.value })} /></Field><Field label="Basic Auth username"><input className={inputClass} value={receiver.basicAuthUsername ?? ''} onChange={(e) => set({ basicAuthUsername: e.target.value })} /></Field><Field label="Basic Auth password"><input className={inputClass} type="password" value={receiver.basicAuthPassword ?? ''} onChange={(e) => set({ basicAuthPassword: e.target.value })} /></Field><div className="flex items-center gap-4 md:col-span-2"><label className="text-xs flex items-center gap-1.5"><input type="checkbox" checked={receiver.sendResolved} onChange={(e) => set({ sendResolved: e.target.checked })} />Send resolved notifications</label><label className="text-xs flex items-center gap-1.5"><input type="checkbox" checked={receiver.enabled} onChange={(e) => set({ enabled: e.target.checked })} />Enabled</label></div></div> : <div className="space-y-3 p-5"><p className="text-xs text-muted-foreground">Paste Alertmanager YAML containing <code>route</code> and <code>receivers</code>; parsed content will update receivers and routes.</p><textarea className={`${areaClass} min-h-64`} value={sourceYaml} onChange={(e) => onSourceYamlChange(e.target.value)} placeholder={'route:\n  receiver: "keep"\nreceivers:\n  - name: "keep"\n    webhook_configs:\n      - url: "https://example.com/alerts"'} /></div>}
      {error && <div className="mx-5 mb-3 flex gap-2 items-start rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive"><AlertTriangle className="size-4 mt-0.5 shrink-0" />{error}</div>}<div className="flex justify-end gap-2 border-t border-border px-5 py-3"><Button variant="outline" onClick={onClose}>Cancel</Button>{mode === 'form' ? <Button onClick={onAdd} disabled={saving || !receiver.receiverName.trim() || !/^https?:\/\//.test(receiver.endpoint)}><Plus />Add receiver</Button> : <Button onClick={onImportYaml} disabled={saving || !sourceYaml.trim()}><RefreshCw />{saving ? 'Parsing...' : 'Parse and apply'}</Button>}</div>
    </div>
  </div>;
}
function AlertRoutingSection({ config, cardRef, onChange }: { config: Config; cardRef: (index: number, element: HTMLDivElement | null) => void; onChange: (route: Config['route']) => void }) {
  const set = (patch: Partial<Config['route']>) => onChange({ ...config.route, ...patch });
  const updateChild = (index: number, child: AlertRoute) => set({ routes: config.route.routes.map((item, i) => i === index ? child : item) });
  return <div className="space-y-3"><div><h2 className="text-base font-semibold">Routes and grouping</h2><p className="text-xs text-muted-foreground">Configure the default group and multiple child routes, then point them to receivers</p></div><Card><CardHeader className="py-3"><CardTitle className="text-sm">Default routes and grouping</CardTitle></CardHeader><CardContent className="grid gap-3 md:grid-cols-2 lg:grid-cols-5"><Field label="Default receiver"><input className={inputClass} value={config.route.receiver} onChange={(e) => set({ receiver: e.target.value })} /></Field><Field label="group_by (comma-separated)" wide><input className={inputClass} value={config.route.groupBy.join(', ')} onChange={(e) => set({ groupBy: e.target.value.split(',').map((item) => item.trim()).filter(Boolean) })} /></Field><Field label="group_wait"><input className={inputClass} value={config.route.groupWait} onChange={(e) => set({ groupWait: e.target.value })} /></Field><Field label="group_interval"><input className={inputClass} value={config.route.groupInterval} onChange={(e) => set({ groupInterval: e.target.value })} /></Field><Field label="repeat_interval"><input className={inputClass} value={config.route.repeatInterval} onChange={(e) => set({ repeatInterval: e.target.value })} /></Field></CardContent></Card>{config.route.routes.map((route, index) => <div key={index} ref={(element) => cardRef(index, element)} tabIndex={-1} className={route.isDraft ? draftWrapperClass : ''}><ChildRouteEditor route={route} onChange={(next) => updateChild(index, next)} onDelete={() => set({ routes: config.route.routes.filter((_, i) => i !== index) })} /></div>)}</div>;
}

function RouteModal({ route, onChange, saving, onClose, onAdd }: { route: AlertRoute; onChange: (route: AlertRoute) => void; saving: boolean; onClose: () => void; onAdd: () => void }) {
  const set = (patch: Partial<AlertRoute>) => onChange({ ...route, ...patch });
  const matchText = Object.entries(route.match).map(([key, value]) => `${key}=${value}`).join(', ');
  return <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4" role="dialog" aria-modal="true" aria-labelledby="create-route-title" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <div className="w-full max-w-2xl rounded-lg border border-border bg-card shadow-2xl">
      <div className="flex items-start justify-between border-b border-border px-5 py-4"><div><h2 id="create-route-title" className="text-base font-semibold">New route</h2><p className="mt-0.5 text-xs text-muted-foreground">Match alerts by labels and send them to the specified receiver</p></div><Button variant="ghost" size="icon" title="Close" onClick={onClose}>×</Button></div>
      <div className="grid gap-3 p-5 md:grid-cols-2"><Field label="receiver"><input className={inputClass} value={route.receiver} onChange={(e) => set({ receiver: e.target.value })} /></Field><Field label="Matching labels" wide><input className={inputClass} value={matchText} placeholder="e.g. severity=critical, service=order" onChange={(e) => set({ match: Object.fromEntries(e.target.value.split(',').map((item) => item.trim().split('=').map((part) => part.trim())).filter(([key, value]) => key && value)) })} /></Field><Field label="group_by（optional）"><input className={inputClass} value={route.groupBy?.join(', ') ?? ''} onChange={(e) => set({ groupBy: e.target.value.split(',').map((item) => item.trim()).filter(Boolean) || undefined })} /></Field><Field label="group_wait（optional）"><input className={inputClass} value={route.groupWait ?? ''} onChange={(e) => set({ groupWait: e.target.value || undefined })} /></Field><Field label="group_interval（optional）"><input className={inputClass} value={route.groupInterval ?? ''} onChange={(e) => set({ groupInterval: e.target.value || undefined })} /></Field><Field label="repeat_interval（optional）"><input className={inputClass} value={route.repeatInterval ?? ''} onChange={(e) => set({ repeatInterval: e.target.value || undefined })} /></Field><label className="text-xs flex items-center gap-1.5 md:col-span-2"><input type="checkbox" checked={route.continue} onChange={(e) => set({ continue: e.target.checked })} />Continue processing subsequent routes after a match</label></div>
      <div className="flex justify-end gap-2 border-t border-border px-5 py-3"><Button variant="outline" onClick={onClose}>Cancel</Button><Button onClick={onAdd} disabled={saving || !route.receiver.trim() || !Object.keys(route.match).length}><Plus />Add route</Button></div>
    </div>
  </div>;
}
function ChildRouteEditor({ route, onChange, onDelete }: { route: AlertRoute; onChange: (route: AlertRoute) => void; onDelete: () => void }) {
  const set = (patch: Partial<AlertRoute>) => onChange({ ...route, ...patch });
  const matchText = Object.entries(route.match).map(([key, value]) => `${key}=${value}`).join(', ');
  return <Card><CardHeader className="py-3"><CardTitle className="text-sm flex items-center justify-between"><span>Child route</span><Button variant="ghost" size="icon-sm" title="Delete route" onClick={onDelete}><Trash2 className="text-destructive" /></Button></CardTitle></CardHeader><CardContent className="grid gap-3 md:grid-cols-2 lg:grid-cols-4"><Field label="receiver"><input className={inputClass} value={route.receiver} onChange={(e) => set({ receiver: e.target.value })} /></Field><Field label="Matching labels" wide><input className={inputClass} value={matchText} placeholder="e.g. severity=critical, service=order" onChange={(e) => set({ match: Object.fromEntries(e.target.value.split(',').map((item) => item.trim().split('=').map((part) => part.trim())).filter(([key, value]) => key && value)) })} /></Field><Field label="group_by（optional）"><input className={inputClass} value={route.groupBy?.join(', ') ?? ''} onChange={(e) => set({ groupBy: e.target.value.split(',').map((item) => item.trim()).filter(Boolean) || undefined })} /></Field><Field label="group_wait（optional）"><input className={inputClass} value={route.groupWait ?? ''} onChange={(e) => set({ groupWait: e.target.value || undefined })} /></Field><Field label="group_interval（optional）"><input className={inputClass} value={route.groupInterval ?? ''} onChange={(e) => set({ groupInterval: e.target.value || undefined })} /></Field><Field label="repeat_interval（optional）"><input className={inputClass} value={route.repeatInterval ?? ''} onChange={(e) => set({ repeatInterval: e.target.value || undefined })} /></Field><label className="text-xs flex items-center gap-1.5 self-end h-8"><input type="checkbox" checked={route.continue} onChange={(e) => set({ continue: e.target.checked })} />continue</label></CardContent></Card>;
}
function Field({ label, children, wide = false }: { label: string; children: React.ReactNode; wide?: boolean }) { return <label className={wide ? 'block md:col-span-2' : 'block'}><span className="block text-[11px] text-muted-foreground mb-1">{label}</span>{children}</label>; }
const inputClass = 'w-full h-8 rounded-md border border-input bg-background px-2.5 text-sm outline-none focus:ring-2 focus:ring-ring/40';
const areaClass = 'w-full min-h-20 rounded-md border border-input bg-background px-2.5 py-1.5 text-sm font-mono outline-none focus:ring-2 focus:ring-ring/40';
function RuleEditor({ rule, onChange, onDelete }: { rule: Rule; onChange: (rule: Rule) => void; onDelete: () => void }) { const set = (patch: Partial<Rule>) => onChange({ ...rule, ...patch }); return <Card><CardHeader className="py-3"><CardTitle className="text-sm flex items-center justify-between"><span className="font-mono">{rule.ruleName || 'Unnamed rule'}</span><div className="flex items-center gap-2"><label className="text-xs text-muted-foreground flex items-center gap-1.5"><input type="checkbox" checked={rule.enabled} onChange={(e) => set({ enabled: e.target.checked })} />Enabled</label><Button variant="ghost" size="icon-sm" title="Delete rule" onClick={onDelete}><Trash2 className="text-destructive" /></Button></div></CardTitle></CardHeader><CardContent className="grid gap-3 md:grid-cols-2 lg:grid-cols-4"><Field label="Rule name"><input className={inputClass} value={rule.ruleName} onChange={(e) => set({ ruleName: e.target.value })} /></Field><Field label="Group"><input className={inputClass} value={rule.groupName} onChange={(e) => set({ groupName: e.target.value })} /></Field><Field label="Evaluation interval (seconds)"><input className={inputClass} type="number" min="1" value={rule.intervalSec} onChange={(e) => set({ intervalSec: Number(e.target.value) })} /></Field><Field label="Duration"><input className={inputClass} placeholder="e.g. 2m" value={rule.forDuration} onChange={(e) => set({ forDuration: e.target.value })} /></Field><Field label="Severity"><select className={inputClass} value={rule.severity} onChange={(e) => set({ severity: e.target.value as Severity })}><option value="critical">critical</option><option value="warning">warning</option><option value="info">info</option></select></Field><Field label="Summary" wide><input className={inputClass} value={rule.summary} onChange={(e) => set({ summary: e.target.value })} /></Field><Field label="PromQL expression" wide><textarea className={areaClass} value={rule.expression} onChange={(e) => set({ expression: e.target.value })} /></Field><Field label="Description" wide><textarea className={areaClass} value={rule.description} onChange={(e) => set({ description: e.target.value })} /></Field></CardContent></Card>; }
function ReceiverEditor({ receiver, onChange, onDelete }: { receiver: Receiver; onChange: (receiver: Receiver) => void; onDelete: () => void }) { const set = (patch: Partial<Receiver>) => onChange({ ...receiver, ...patch }); return <Card><CardContent className="grid gap-3 md:grid-cols-2 lg:grid-cols-4 items-end pt-4"><Field label="Receiver name"><input className={inputClass} value={receiver.receiverName} onChange={(e) => set({ receiverName: e.target.value })} /></Field><Field label="Receivers" wide><input className={inputClass} type="url" value={receiver.endpoint} onChange={(e) => set({ endpoint: e.target.value })} /></Field><Field label="Basic Auth username"><input className={inputClass} value={receiver.basicAuthUsername ?? ''} onChange={(e) => set({ basicAuthUsername: e.target.value })} /></Field><Field label={receiver.basicAuthPasswordSet ? 'Basic Auth password (set; leave blank to keep)' : 'Basic Auth password'}><input className={inputClass} type="password" value={receiver.basicAuthPassword ?? ''} onChange={(e) => set({ basicAuthPassword: e.target.value })} /></Field><Field label="Severity match"><select className={inputClass} value={receiver.severityMatch} onChange={(e) => set({ severityMatch: e.target.value as Match })}><option value="all">All</option><option value="critical">critical</option><option value="warning">warning</option><option value="info">info</option></select></Field><div className="flex items-center gap-4 h-8"><label className="text-xs flex items-center gap-1.5"><input type="checkbox" checked={receiver.sendResolved} onChange={(e) => set({ sendResolved: e.target.checked })} />Send resolved</label><label className="text-xs flex items-center gap-1.5"><input type="checkbox" checked={receiver.enabled} onChange={(e) => set({ enabled: e.target.checked })} />Enabled</label><Button variant="ghost" size="icon-sm" title="Delete receiver" onClick={onDelete}><Trash2 className="text-destructive" /></Button></div></CardContent></Card>; }
