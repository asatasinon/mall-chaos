'use client';

import { useEffect, useRef, useState } from 'react';
import { Plus, Save, Trash2, RefreshCw, AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

type Severity = 'critical' | 'warning' | 'info';
type Match = 'all' | Severity;
interface Rule { id?: number; isDraft?: boolean; ruleName: string; groupName: string; intervalSec: number; expression: string; forDuration: string; severity: Severity; summary: string; description: string; enabled: boolean }
interface Receiver { id?: number; isDraft?: boolean; receiverName: string; receiverType: 'webhook'; endpoint: string; basicAuthUsername?: string; basicAuthPassword?: string; basicAuthPasswordSet?: boolean; severityMatch: Match; sendResolved: boolean; enabled: boolean }
interface AlertRoute { isDraft?: boolean; receiver: string; match: Record<string, string>; groupBy?: string[]; groupWait?: string; groupInterval?: string; repeatInterval?: string; continue: boolean }
interface Config { version: number; rules: Rule[]; receivers: Receiver[]; updatedAt: string | null; route: { receiver: string; groupBy: string[]; groupWait: string; groupInterval: string; repeatInterval: string; continue: boolean; routes: AlertRoute[] } }

const blankRule = (): Rule => ({ ruleName: 'NewAlert', groupName: 'castrel-custom', intervalSec: 30, expression: 'up == 0', forDuration: '1m', severity: 'warning', summary: '服务异常', description: '服务不可用。', enabled: true });
const blankReceiver = (): Receiver => ({ receiverName: 'custom-receiver', receiverType: 'webhook', endpoint: 'https://example.com/webhook', basicAuthUsername: '', basicAuthPassword: '', severityMatch: 'all', sendResolved: true, enabled: true });
const blankRoute = (): AlertRoute => ({ receiver: 'custom-receiver', match: { severity: 'warning' }, continue: false });
const draftWrapperClass = 'rounded-xl bg-amber-500/10 p-1 ring-2 ring-amber-500/60 scroll-mt-24 focus:outline-none';

export default function AlertsPage() {
  const [config, setConfig] = useState<Config | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [saving, setSaving] = useState(false);
  const [importError, setImportError] = useState('');
  const [sourceYaml, setSourceYaml] = useState('');
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [receiverModalOpen, setReceiverModalOpen] = useState(false);
  const [routeModalOpen, setRouteModalOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<'rules' | 'routing'>('rules');
  const [createMode, setCreateMode] = useState<'rule' | 'prometheus-rules'>('rule');
  const [draftRule, setDraftRule] = useState<Rule>(blankRule());
  const [draftReceiver, setDraftReceiver] = useState<Receiver>(blankReceiver());
  const [draftRoute, setDraftRoute] = useState<AlertRoute>(blankRoute());
  const [scrollTarget, setScrollTarget] = useState('');
  const itemRefs = useRef<Record<string, HTMLDivElement | null>>({});

  const load = async () => {
    setError('');
    try {
      const response = await fetch('/internal/alerts/config', { cache: 'no-store' });
      const result = await response.json();
      if (!response.ok || result.code !== 0) throw new Error(result.message);
      setConfig(result.data);
    } catch (cause) { setError(cause instanceof TypeError && cause.message.toLowerCase().includes('fetch') ? '控制台接口不可达，请先启动 traffic-control-plane（localhost:18086）' : cause instanceof Error ? cause.message : '加载失败'); }
  };
  useEffect(() => { void load(); }, []);
  useEffect(() => {
    if (!scrollTarget) return;
    const target = itemRefs.current[scrollTarget];
    target?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    target?.focus({ preventScroll: true });
    setScrollTarget('');
  }, [config, scrollTarget]);

  const save = async () => {
    if (!config) return;
    setSaving(true); setError(''); setNotice('');
    try {
      const persistableConfig = { ...config, rules: config.rules.map(({ isDraft, ...rule }) => rule), receivers: config.receivers.map(({ isDraft, ...receiver }) => receiver), route: { ...config.route, routes: config.route.routes.map(({ isDraft, ...route }) => route) } };
      const response = await fetch('/internal/alerts/config', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(persistableConfig) });
      const result = await response.json();
      if (!response.ok || result.code !== 0) throw new Error(result.message);
      setConfig(result.data); setNotice('配置已保存，Prometheus 与 Alertmanager 已 reload');
    } catch (cause) { setError(cause instanceof TypeError && cause.message.toLowerCase().includes('fetch') ? '控制台接口不可达，无法保存配置' : cause instanceof Error ? cause.message : '保存失败'); }
    finally { setSaving(false); }
  };

  const importYaml = async (kind: 'prometheus-rules' | 'alertmanager') => {
    if (!config || !sourceYaml.trim()) return;
    setSaving(true); setError(''); setImportError(''); setNotice('');
    try {
      const response = await fetch('/internal/alerts/config', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ version: config.version, kind, yaml: sourceYaml }) });
      const result = await response.json();
      if (!response.ok || result.code !== 0) throw new Error(result.message);
      setConfig(result.data); setSourceYaml(''); setCreateModalOpen(false); setReceiverModalOpen(false); setNotice(kind === 'prometheus-rules' ? 'Prometheus 告警规则 YAML 已解析，规则已追加到当前配置' : 'Alertmanager YAML 已解析，推送地址已追加到当前配置');
    } catch (cause) { setImportError(cause instanceof TypeError && cause.message.toLowerCase().includes('fetch') ? '控制台接口不可达，无法解析并应用 YAML' : cause instanceof Error ? cause.message : '导入失败'); }
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
    setNotice('规则已加入待保存配置');
  };

  const addReceiver = () => {
    if (!config) return;
    const nextIndex = config.receivers.length;
    setConfig({ ...config, receivers: [...config.receivers, { ...draftReceiver, isDraft: true }] });
    setDraftReceiver(blankReceiver());
    setReceiverModalOpen(false);
    setActiveTab('routing');
    setScrollTarget(`receiver-${nextIndex}`);
    setNotice('推送地址已加入待保存配置');
  };

  const addRoute = () => {
    if (!config) return;
    const nextIndex = config.route.routes.length;
    setConfig({ ...config, route: { ...config.route, routes: [...config.route.routes, { ...draftRoute, isDraft: true }] } });
    setDraftRoute(blankRoute());
    setRouteModalOpen(false);
    setActiveTab('routing');
    setScrollTarget(`route-${nextIndex}`);
    setNotice('路由已加入待保存配置');
  };

  if (!config) return <div className="space-y-4"><PageHeading onRefresh={() => void load()} /><p className="text-sm text-muted-foreground">正在加载配置…</p>{error && <ErrorBox text={error} />}</div>;
  return (
    <div className="flex h-full min-h-0 w-full flex-col gap-5">
      <PageHeading onRefresh={() => void load()} onSave={() => void save()} saving={saving} version={config.version} updatedAt={config.updatedAt} />
      {error && <ErrorBox text={error} />}
      {notice && <div className="border border-green-700/30 bg-green-700/10 text-green-800 dark:text-green-300 px-4 py-2.5 rounded-md text-sm">{notice}</div>}
      <div className="flex border-b border-border"><button type="button" className={`relative px-4 py-2.5 text-sm font-medium ${activeTab === 'rules' ? 'text-foreground' : 'text-muted-foreground hover:text-foreground'}`} onClick={() => setActiveTab('rules')}>告警规则{activeTab === 'rules' && <span className="absolute inset-x-0 bottom-0 h-0.5 bg-primary" />}</button><button type="button" className={`relative px-4 py-2.5 text-sm font-medium ${activeTab === 'routing' ? 'text-foreground' : 'text-muted-foreground hover:text-foreground'}`} onClick={() => setActiveTab('routing')}>路由与推送地址{activeTab === 'routing' && <span className="absolute inset-x-0 bottom-0 h-0.5 bg-primary" />}</button></div>
      <div className="min-h-0 flex-1 overflow-y-auto pr-1">
      {activeTab === 'rules' && <section className="space-y-3">
        <div className="flex items-center justify-between"><div><h2 className="text-base font-semibold">告警规则</h2><p className="text-xs text-muted-foreground">PromQL 规则会生成到 Prometheus rule groups</p></div><Button variant="outline" size="sm" onClick={() => { setDraftRule(blankRule()); setCreateMode('rule'); setCreateModalOpen(true); }}><Plus />新增规则</Button></div>
        <div className="space-y-3">{config.rules.map((rule, index) => <div key={`${rule.id ?? 'new'}-${index}`} ref={(element) => { itemRefs.current[`rule-${index}`] = element; }} tabIndex={-1} className={rule.isDraft ? draftWrapperClass : ''}><RuleEditor rule={rule} onChange={(next) => setConfig({ ...config, rules: config.rules.map((item, i) => i === index ? next : item) })} onDelete={() => setConfig({ ...config, rules: config.rules.filter((_, i) => i !== index) })} /></div>)}</div>
      </section>}
      {activeTab === 'routing' && <section className="space-y-3">
        <AlertRoutingSection config={config} cardRef={(index, element) => { itemRefs.current[`route-${index}`] = element; }} onChange={(route) => setConfig({ ...config, route })} onAddRoute={() => { setDraftRoute(blankRoute()); setRouteModalOpen(true); }} />
        <div className="flex items-center justify-between"><div><h2 className="text-base font-semibold">推送地址</h2><p className="text-xs text-muted-foreground">按严重级别将告警路由到 Webhook 接收器</p></div><Button variant="outline" size="sm" onClick={() => { setDraftReceiver(blankReceiver()); setReceiverModalOpen(true); }}><Plus />新增地址</Button></div>
        <div className="space-y-3">{config.receivers.map((receiver, index) => <div key={`${receiver.id ?? 'new'}-${index}`} ref={(element) => { itemRefs.current[`receiver-${index}`] = element; }} tabIndex={-1} className={receiver.isDraft ? draftWrapperClass : ''}><ReceiverEditor receiver={receiver} onChange={(next) => setConfig({ ...config, receivers: config.receivers.map((item, i) => i === index ? next : item) })} onDelete={() => setConfig({ ...config, receivers: config.receivers.filter((_, i) => i !== index) })} /></div>)}</div>
      </section>}
      </div>
      {createModalOpen && <CreateAlertModal mode={createMode} onModeChange={setCreateMode} rule={draftRule} onRuleChange={setDraftRule} sourceYaml={sourceYaml} onSourceYamlChange={setSourceYaml} error={importError} saving={saving} onClose={() => { setImportError(''); setCreateModalOpen(false); }} onAddRule={addRule} onImportYaml={() => void importYaml('prometheus-rules')} />}
      {receiverModalOpen && <ReceiverModal receiver={draftReceiver} onChange={setDraftReceiver} sourceYaml={sourceYaml} onSourceYamlChange={setSourceYaml} error={importError} saving={saving} onClose={() => { setImportError(''); setReceiverModalOpen(false); }} onAdd={addReceiver} onImportYaml={() => void importYaml('alertmanager')} />}
      {routeModalOpen && <RouteModal route={draftRoute} onChange={setDraftRoute} saving={saving} onClose={() => setRouteModalOpen(false)} onAdd={addRoute} />}
    </div>
  );
}

function PageHeading({ onRefresh, onSave, saving, version, updatedAt }: { onRefresh: () => void; onSave?: () => void; saving?: boolean; version?: number; updatedAt?: string | null }) { return <div className="flex items-start justify-between gap-4"><div><h1 className="text-2xl font-semibold tracking-tight">Alerts</h1><p className="text-sm text-muted-foreground mt-0.5">告警规则与通知路由配置</p>{version !== undefined && <p className="mt-1 text-xs text-muted-foreground">配置版本 v{version}{updatedAt ? ` · ${new Date(updatedAt).toLocaleString()}` : ''}</p>}</div><div className="flex shrink-0 items-center gap-2"><Button variant="ghost" size="icon" title="刷新配置" onClick={onRefresh}><RefreshCw /></Button>{onSave && <Button onClick={onSave} disabled={saving}><Save />{saving ? '保存中…' : '保存并应用'}</Button>}</div></div>; }
function ErrorBox({ text }: { text: string }) { return <div className="flex gap-2 items-start rounded-md border border-destructive/40 bg-destructive/10 px-4 py-2.5 text-sm text-destructive"><AlertTriangle className="size-4 mt-0.5" />{text}</div>; }
function CreateAlertModal({ mode, onModeChange, rule, onRuleChange, sourceYaml, onSourceYamlChange, error, saving, onClose, onAddRule, onImportYaml }: { mode: 'rule' | 'prometheus-rules'; onModeChange: (mode: 'rule' | 'prometheus-rules') => void; rule: Rule; onRuleChange: (rule: Rule) => void; sourceYaml: string; onSourceYamlChange: (yaml: string) => void; error: string; saving: boolean; onClose: () => void; onAddRule: () => void; onImportYaml: () => void }) {
  const setRule = (patch: Partial<Rule>) => onRuleChange({ ...rule, ...patch });
  return <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4" role="dialog" aria-modal="true" aria-labelledby="create-alert-title" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <div className="w-full max-w-3xl max-h-[calc(100vh-2rem)] overflow-y-auto rounded-lg border border-border bg-card shadow-2xl">
      <div className="flex items-start justify-between border-b border-border px-5 py-4"><div><h2 id="create-alert-title" className="text-base font-semibold">新增告警</h2><p className="mt-0.5 text-xs text-muted-foreground">选择配置方式，在此完成输入后加入当前配置</p></div><Button variant="ghost" size="icon" title="关闭" onClick={onClose}>×</Button></div>
      <div className="grid grid-cols-2 gap-2 border-b border-border p-4"><button type="button" className={`rounded-md border px-3 py-2 text-left text-sm ${mode === 'rule' ? 'border-primary bg-primary/10' : 'border-border hover:bg-muted'}`} onClick={() => onModeChange('rule')}><span className="block font-medium">表单创建规则</span><span className="mt-0.5 block text-xs text-muted-foreground">填写 PromQL 和告警元数据</span></button><button type="button" className={`rounded-md border px-3 py-2 text-left text-sm ${mode === 'prometheus-rules' ? 'border-primary bg-primary/10' : 'border-border hover:bg-muted'}`} onClick={() => onModeChange('prometheus-rules')}><span className="block font-medium">解析 Prometheus 规则 YAML</span><span className="mt-0.5 block text-xs text-muted-foreground">导入 groups 和 rules</span></button></div>
      <div className="p-5">
        {mode === 'rule' ? <div className="grid gap-3 md:grid-cols-2"><Field label="规则名称"><input className={inputClass} value={rule.ruleName} onChange={(e) => setRule({ ruleName: e.target.value })} /></Field><Field label="分组"><input className={inputClass} value={rule.groupName} onChange={(e) => setRule({ groupName: e.target.value })} /></Field><Field label="评估间隔（秒）"><input className={inputClass} type="number" min="1" value={rule.intervalSec} onChange={(e) => setRule({ intervalSec: Number(e.target.value) })} /></Field><Field label="持续时间"><input className={inputClass} placeholder="例如 2m" value={rule.forDuration} onChange={(e) => setRule({ forDuration: e.target.value })} /></Field><Field label="严重级别"><select className={inputClass} value={rule.severity} onChange={(e) => setRule({ severity: e.target.value as Severity })}><option value="critical">critical</option><option value="warning">warning</option><option value="info">info</option></select></Field><Field label="摘要"><input className={inputClass} value={rule.summary} onChange={(e) => setRule({ summary: e.target.value })} /></Field><Field label="PromQL 表达式" wide><textarea className={areaClass} value={rule.expression} onChange={(e) => setRule({ expression: e.target.value })} /></Field><Field label="描述" wide><textarea className={areaClass} value={rule.description} onChange={(e) => setRule({ description: e.target.value })} /></Field></div> : <div className="space-y-3"><p className="text-xs text-muted-foreground">粘贴包含 <code>groups</code> 和 <code>rules</code> 的 Prometheus 告警规则 YAML，解析后会追加到当前告警规则。</p><textarea className={`${areaClass} min-h-64`} value={sourceYaml} onChange={(e) => onSourceYamlChange(e.target.value)} placeholder={'groups:\n  - name: castrel-custom\n    interval: 30s\n    rules:\n      - alert: ServiceDown\n        expr: up == 0\n        for: 1m\n        labels:\n          severity: critical\n        annotations:\n          summary: 服务不可用'} /></div>}
      </div>
      {error && <div className="mx-5 mb-3 flex gap-2 items-start rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive"><AlertTriangle className="size-4 mt-0.5 shrink-0" />{error}</div>}<div className="flex justify-end gap-2 border-t border-border px-5 py-3"><Button variant="outline" onClick={onClose}>取消</Button>{mode === 'rule' ? <Button onClick={onAddRule} disabled={saving || !rule.ruleName.trim() || !rule.expression.trim()}><Plus />加入规则</Button> : <Button onClick={onImportYaml} disabled={saving || !sourceYaml.trim()}><RefreshCw />{saving ? '解析中…' : '解析并应用'}</Button>}</div>
    </div>
  </div>;
}
function ReceiverModal({ receiver, onChange, sourceYaml, onSourceYamlChange, error, saving, onClose, onAdd, onImportYaml }: { receiver: Receiver; onChange: (receiver: Receiver) => void; sourceYaml: string; onSourceYamlChange: (yaml: string) => void; error: string; saving: boolean; onClose: () => void; onAdd: () => void; onImportYaml: () => void }) {
  const [mode, setMode] = useState<'form' | 'yaml'>('form');
  const set = (patch: Partial<Receiver>) => onChange({ ...receiver, ...patch });
  return <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4" role="dialog" aria-modal="true" aria-labelledby="create-receiver-title" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <div className="w-full max-w-2xl rounded-lg border border-border bg-card shadow-2xl">
      <div className="flex items-start justify-between border-b border-border px-5 py-4"><div><h2 id="create-receiver-title" className="text-base font-semibold">新增推送地址</h2><p className="mt-0.5 text-xs text-muted-foreground">配置 Webhook 和可选的 Basic Auth</p></div><Button variant="ghost" size="icon" title="关闭" onClick={onClose}>×</Button></div>
      <div className="grid grid-cols-2 gap-2 border-b border-border p-4"><button type="button" className={`rounded-md border px-3 py-2 text-left text-sm ${mode === 'form' ? 'border-primary bg-primary/10' : 'border-border hover:bg-muted'}`} onClick={() => setMode('form')}><span className="block font-medium">表单配置地址</span><span className="mt-0.5 block text-xs text-muted-foreground">填写 Webhook 和认证信息</span></button><button type="button" className={`rounded-md border px-3 py-2 text-left text-sm ${mode === 'yaml' ? 'border-primary bg-primary/10' : 'border-border hover:bg-muted'}`} onClick={() => setMode('yaml')}><span className="block font-medium">解析 Alertmanager YAML</span><span className="mt-0.5 block text-xs text-muted-foreground">直接导入 route 和 receivers</span></button></div>
      {mode === 'form' ? <div className="grid gap-3 p-5 md:grid-cols-2"><Field label="接收器名称"><input className={inputClass} value={receiver.receiverName} onChange={(e) => set({ receiverName: e.target.value })} /></Field><Field label="匹配级别"><select className={inputClass} value={receiver.severityMatch} onChange={(e) => set({ severityMatch: e.target.value as Match })}><option value="all">全部</option><option value="critical">critical</option><option value="warning">warning</option><option value="info">info</option></select></Field><Field label="Webhook 地址" wide><input className={inputClass} type="url" value={receiver.endpoint} onChange={(e) => set({ endpoint: e.target.value })} /></Field><Field label="Basic Auth 用户名"><input className={inputClass} value={receiver.basicAuthUsername ?? ''} onChange={(e) => set({ basicAuthUsername: e.target.value })} /></Field><Field label="Basic Auth 密码"><input className={inputClass} type="password" value={receiver.basicAuthPassword ?? ''} onChange={(e) => set({ basicAuthPassword: e.target.value })} /></Field><div className="flex items-center gap-4 md:col-span-2"><label className="text-xs flex items-center gap-1.5"><input type="checkbox" checked={receiver.sendResolved} onChange={(e) => set({ sendResolved: e.target.checked })} />发送恢复通知</label><label className="text-xs flex items-center gap-1.5"><input type="checkbox" checked={receiver.enabled} onChange={(e) => set({ enabled: e.target.checked })} />启用</label></div></div> : <div className="space-y-3 p-5"><p className="text-xs text-muted-foreground">粘贴包含 <code>route</code> 和 <code>receivers</code> 的 Alertmanager YAML，解析后会更新推送地址和路由配置。</p><textarea className={`${areaClass} min-h-64`} value={sourceYaml} onChange={(e) => onSourceYamlChange(e.target.value)} placeholder={'route:\n  receiver: "keep"\nreceivers:\n  - name: "keep"\n    webhook_configs:\n      - url: "https://example.com/alerts"'} /></div>}
      {error && <div className="mx-5 mb-3 flex gap-2 items-start rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive"><AlertTriangle className="size-4 mt-0.5 shrink-0" />{error}</div>}<div className="flex justify-end gap-2 border-t border-border px-5 py-3"><Button variant="outline" onClick={onClose}>取消</Button>{mode === 'form' ? <Button onClick={onAdd} disabled={saving || !receiver.receiverName.trim() || !/^https?:\/\//.test(receiver.endpoint)}><Plus />加入推送地址</Button> : <Button onClick={onImportYaml} disabled={saving || !sourceYaml.trim()}><RefreshCw />{saving ? '解析中…' : '解析并应用'}</Button>}</div>
    </div>
  </div>;
}
function AlertRoutingSection({ config, cardRef, onChange, onAddRoute }: { config: Config; cardRef: (index: number, element: HTMLDivElement | null) => void; onChange: (route: Config['route']) => void; onAddRoute: () => void }) {
  const set = (patch: Partial<Config['route']>) => onChange({ ...config.route, ...patch });
  const updateChild = (index: number, child: AlertRoute) => set({ routes: config.route.routes.map((item, i) => i === index ? child : item) });
  return <div className="space-y-3"><div className="flex items-center justify-between"><div><h2 className="text-base font-semibold">路由与分组</h2><p className="text-xs text-muted-foreground">配置默认分组和多个子路由，并将它们指向推送地址</p></div><Button variant="outline" size="sm" onClick={onAddRoute}><Plus />新增路由</Button></div><Card><CardHeader className="py-3"><CardTitle className="text-sm">默认路由与分组</CardTitle></CardHeader><CardContent className="grid gap-3 md:grid-cols-2 lg:grid-cols-5"><Field label="默认接收器"><input className={inputClass} value={config.route.receiver} onChange={(e) => set({ receiver: e.target.value })} /></Field><Field label="group_by（逗号分隔）" wide><input className={inputClass} value={config.route.groupBy.join(', ')} onChange={(e) => set({ groupBy: e.target.value.split(',').map((item) => item.trim()).filter(Boolean) })} /></Field><Field label="group_wait"><input className={inputClass} value={config.route.groupWait} onChange={(e) => set({ groupWait: e.target.value })} /></Field><Field label="group_interval"><input className={inputClass} value={config.route.groupInterval} onChange={(e) => set({ groupInterval: e.target.value })} /></Field><Field label="repeat_interval"><input className={inputClass} value={config.route.repeatInterval} onChange={(e) => set({ repeatInterval: e.target.value })} /></Field></CardContent></Card>{config.route.routes.map((route, index) => <div key={index} ref={(element) => cardRef(index, element)} tabIndex={-1} className={route.isDraft ? draftWrapperClass : ''}><ChildRouteEditor route={route} onChange={(next) => updateChild(index, next)} onDelete={() => set({ routes: config.route.routes.filter((_, i) => i !== index) })} /></div>)}</div>;
}

function RouteModal({ route, onChange, saving, onClose, onAdd }: { route: AlertRoute; onChange: (route: AlertRoute) => void; saving: boolean; onClose: () => void; onAdd: () => void }) {
  const set = (patch: Partial<AlertRoute>) => onChange({ ...route, ...patch });
  const matchText = Object.entries(route.match).map(([key, value]) => `${key}=${value}`).join(', ');
  return <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4" role="dialog" aria-modal="true" aria-labelledby="create-route-title" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <div className="w-full max-w-2xl rounded-lg border border-border bg-card shadow-2xl">
      <div className="flex items-start justify-between border-b border-border px-5 py-4"><div><h2 id="create-route-title" className="text-base font-semibold">新增路由</h2><p className="mt-0.5 text-xs text-muted-foreground">根据标签匹配告警并发送到指定接收器</p></div><Button variant="ghost" size="icon" title="关闭" onClick={onClose}>×</Button></div>
      <div className="grid gap-3 p-5 md:grid-cols-2"><Field label="接收器"><input className={inputClass} value={route.receiver} onChange={(e) => set({ receiver: e.target.value })} /></Field><Field label="匹配标签" wide><input className={inputClass} value={matchText} placeholder="例如 severity=critical, service=order" onChange={(e) => set({ match: Object.fromEntries(e.target.value.split(',').map((item) => item.trim().split('=').map((part) => part.trim())).filter(([key, value]) => key && value)) })} /></Field><Field label="group_by（可选）"><input className={inputClass} value={route.groupBy?.join(', ') ?? ''} onChange={(e) => set({ groupBy: e.target.value.split(',').map((item) => item.trim()).filter(Boolean) || undefined })} /></Field><Field label="group_wait（可选）"><input className={inputClass} value={route.groupWait ?? ''} onChange={(e) => set({ groupWait: e.target.value || undefined })} /></Field><Field label="group_interval（可选）"><input className={inputClass} value={route.groupInterval ?? ''} onChange={(e) => set({ groupInterval: e.target.value || undefined })} /></Field><Field label="repeat_interval（可选）"><input className={inputClass} value={route.repeatInterval ?? ''} onChange={(e) => set({ repeatInterval: e.target.value || undefined })} /></Field><label className="text-xs flex items-center gap-1.5 md:col-span-2"><input type="checkbox" checked={route.continue} onChange={(e) => set({ continue: e.target.checked })} />匹配后继续处理后续路由</label></div>
      <div className="flex justify-end gap-2 border-t border-border px-5 py-3"><Button variant="outline" onClick={onClose}>取消</Button><Button onClick={onAdd} disabled={saving || !route.receiver.trim() || !Object.keys(route.match).length}><Plus />加入路由</Button></div>
    </div>
  </div>;
}
function ChildRouteEditor({ route, onChange, onDelete }: { route: AlertRoute; onChange: (route: AlertRoute) => void; onDelete: () => void }) {
  const set = (patch: Partial<AlertRoute>) => onChange({ ...route, ...patch });
  const matchText = Object.entries(route.match).map(([key, value]) => `${key}=${value}`).join(', ');
  return <Card><CardHeader className="py-3"><CardTitle className="text-sm flex items-center justify-between"><span>子路由</span><Button variant="ghost" size="icon-sm" title="删除路由" onClick={onDelete}><Trash2 className="text-destructive" /></Button></CardTitle></CardHeader><CardContent className="grid gap-3 md:grid-cols-2 lg:grid-cols-4"><Field label="接收器"><input className={inputClass} value={route.receiver} onChange={(e) => set({ receiver: e.target.value })} /></Field><Field label="匹配标签" wide><input className={inputClass} value={matchText} placeholder="例如 severity=critical, service=order" onChange={(e) => set({ match: Object.fromEntries(e.target.value.split(',').map((item) => item.trim().split('=').map((part) => part.trim())).filter(([key, value]) => key && value)) })} /></Field><Field label="group_by（可选）"><input className={inputClass} value={route.groupBy?.join(', ') ?? ''} onChange={(e) => set({ groupBy: e.target.value.split(',').map((item) => item.trim()).filter(Boolean) || undefined })} /></Field><Field label="group_wait（可选）"><input className={inputClass} value={route.groupWait ?? ''} onChange={(e) => set({ groupWait: e.target.value || undefined })} /></Field><Field label="group_interval（可选）"><input className={inputClass} value={route.groupInterval ?? ''} onChange={(e) => set({ groupInterval: e.target.value || undefined })} /></Field><Field label="repeat_interval（可选）"><input className={inputClass} value={route.repeatInterval ?? ''} onChange={(e) => set({ repeatInterval: e.target.value || undefined })} /></Field><label className="text-xs flex items-center gap-1.5 self-end h-8"><input type="checkbox" checked={route.continue} onChange={(e) => set({ continue: e.target.checked })} />continue</label></CardContent></Card>;
}
function Field({ label, children, wide = false }: { label: string; children: React.ReactNode; wide?: boolean }) { return <label className={wide ? 'block md:col-span-2' : 'block'}><span className="block text-[11px] text-muted-foreground mb-1">{label}</span>{children}</label>; }
const inputClass = 'w-full h-8 rounded-md border border-input bg-background px-2.5 text-sm outline-none focus:ring-2 focus:ring-ring/40';
const areaClass = 'w-full min-h-20 rounded-md border border-input bg-background px-2.5 py-1.5 text-sm font-mono outline-none focus:ring-2 focus:ring-ring/40';
function RuleEditor({ rule, onChange, onDelete }: { rule: Rule; onChange: (rule: Rule) => void; onDelete: () => void }) { const set = (patch: Partial<Rule>) => onChange({ ...rule, ...patch }); return <Card><CardHeader className="py-3"><CardTitle className="text-sm flex items-center justify-between"><span className="font-mono">{rule.ruleName || '未命名规则'}</span><div className="flex items-center gap-2"><label className="text-xs text-muted-foreground flex items-center gap-1.5"><input type="checkbox" checked={rule.enabled} onChange={(e) => set({ enabled: e.target.checked })} />启用</label><Button variant="ghost" size="icon-sm" title="删除规则" onClick={onDelete}><Trash2 className="text-destructive" /></Button></div></CardTitle></CardHeader><CardContent className="grid gap-3 md:grid-cols-2 lg:grid-cols-4"><Field label="规则名称"><input className={inputClass} value={rule.ruleName} onChange={(e) => set({ ruleName: e.target.value })} /></Field><Field label="分组"><input className={inputClass} value={rule.groupName} onChange={(e) => set({ groupName: e.target.value })} /></Field><Field label="评估间隔（秒）"><input className={inputClass} type="number" min="1" value={rule.intervalSec} onChange={(e) => set({ intervalSec: Number(e.target.value) })} /></Field><Field label="持续时间"><input className={inputClass} placeholder="例如 2m" value={rule.forDuration} onChange={(e) => set({ forDuration: e.target.value })} /></Field><Field label="严重级别"><select className={inputClass} value={rule.severity} onChange={(e) => set({ severity: e.target.value as Severity })}><option value="critical">critical</option><option value="warning">warning</option><option value="info">info</option></select></Field><Field label="摘要" wide><input className={inputClass} value={rule.summary} onChange={(e) => set({ summary: e.target.value })} /></Field><Field label="PromQL 表达式" wide><textarea className={areaClass} value={rule.expression} onChange={(e) => set({ expression: e.target.value })} /></Field><Field label="描述" wide><textarea className={areaClass} value={rule.description} onChange={(e) => set({ description: e.target.value })} /></Field></CardContent></Card>; }
function ReceiverEditor({ receiver, onChange, onDelete }: { receiver: Receiver; onChange: (receiver: Receiver) => void; onDelete: () => void }) { const set = (patch: Partial<Receiver>) => onChange({ ...receiver, ...patch }); return <Card><CardContent className="grid gap-3 md:grid-cols-2 lg:grid-cols-4 items-end pt-4"><Field label="接收器名称"><input className={inputClass} value={receiver.receiverName} onChange={(e) => set({ receiverName: e.target.value })} /></Field><Field label="推送地址" wide><input className={inputClass} type="url" value={receiver.endpoint} onChange={(e) => set({ endpoint: e.target.value })} /></Field><Field label="Basic Auth 用户名"><input className={inputClass} value={receiver.basicAuthUsername ?? ''} onChange={(e) => set({ basicAuthUsername: e.target.value })} /></Field><Field label={receiver.basicAuthPasswordSet ? 'Basic Auth 密码（已设置，留空保持）' : 'Basic Auth 密码'}><input className={inputClass} type="password" value={receiver.basicAuthPassword ?? ''} onChange={(e) => set({ basicAuthPassword: e.target.value })} /></Field><Field label="匹配级别"><select className={inputClass} value={receiver.severityMatch} onChange={(e) => set({ severityMatch: e.target.value as Match })}><option value="all">全部</option><option value="critical">critical</option><option value="warning">warning</option><option value="info">info</option></select></Field><div className="flex items-center gap-4 h-8"><label className="text-xs flex items-center gap-1.5"><input type="checkbox" checked={receiver.sendResolved} onChange={(e) => set({ sendResolved: e.target.checked })} />发送恢复</label><label className="text-xs flex items-center gap-1.5"><input type="checkbox" checked={receiver.enabled} onChange={(e) => set({ enabled: e.target.checked })} />启用</label><Button variant="ghost" size="icon-sm" title="删除地址" onClick={onDelete}><Trash2 className="text-destructive" /></Button></div></CardContent></Card>; }
