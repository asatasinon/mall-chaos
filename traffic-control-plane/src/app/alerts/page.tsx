'use client';

import { useEffect, useState } from 'react';
import { Plus, Save, Trash2, RefreshCw, AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

type Severity = 'critical' | 'warning' | 'info';
type Match = 'all' | Severity;
interface Rule { id?: number; ruleName: string; groupName: string; intervalSec: number; expression: string; forDuration: string; severity: Severity; summary: string; description: string; enabled: boolean }
interface Receiver { id?: number; receiverName: string; receiverType: 'webhook'; endpoint: string; severityMatch: Match; sendResolved: boolean; enabled: boolean }
interface Config { version: number; rules: Rule[]; receivers: Receiver[]; updatedAt: string | null }

const blankRule = (): Rule => ({ ruleName: 'NewAlert', groupName: 'castrel-custom', intervalSec: 30, expression: 'up == 0', forDuration: '1m', severity: 'warning', summary: '服务异常', description: '服务不可用。', enabled: true });
const blankReceiver = (): Receiver => ({ receiverName: 'custom-receiver', receiverType: 'webhook', endpoint: 'https://example.com/webhook', severityMatch: 'all', sendResolved: true, enabled: true });

export default function AlertsPage() {
  const [config, setConfig] = useState<Config | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [saving, setSaving] = useState(false);

  const load = async () => {
    setError('');
    try {
      const response = await fetch('/internal/alerts/config', { cache: 'no-store' });
      const result = await response.json();
      if (!response.ok || result.code !== 0) throw new Error(result.message);
      setConfig(result.data);
    } catch (cause) { setError(cause instanceof Error ? cause.message : '加载失败'); }
  };
  useEffect(() => { void load(); }, []);

  const save = async () => {
    if (!config) return;
    setSaving(true); setError(''); setNotice('');
    try {
      const response = await fetch('/internal/alerts/config', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(config) });
      const result = await response.json();
      if (!response.ok || result.code !== 0) throw new Error(result.message);
      setConfig(result.data); setNotice('配置已保存，Prometheus 与 Alertmanager 已 reload');
    } catch (cause) { setError(cause instanceof Error ? cause.message : '保存失败'); }
    finally { setSaving(false); }
  };

  if (!config) return <div className="space-y-4"><PageHeading onRefresh={() => void load()} /><p className="text-sm text-muted-foreground">正在加载配置…</p>{error && <ErrorBox text={error} />}</div>;
  return (
    <div className="space-y-5 max-w-7xl">
      <PageHeading onRefresh={() => void load()} />
      {error && <ErrorBox text={error} />}
      {notice && <div className="border border-green-700/30 bg-green-700/10 text-green-800 dark:text-green-300 px-4 py-2.5 rounded-md text-sm">{notice}</div>}
      <section className="space-y-3">
        <div className="flex items-center justify-between"><div><h2 className="text-base font-semibold">告警规则</h2><p className="text-xs text-muted-foreground">PromQL 规则会生成到 Prometheus rule groups</p></div><Button variant="outline" size="sm" onClick={() => setConfig({ ...config, rules: [...config.rules, blankRule()] })}><Plus />新增规则</Button></div>
        <div className="space-y-3">{config.rules.map((rule, index) => <RuleEditor key={`${rule.id ?? 'new'}-${index}`} rule={rule} onChange={(next) => setConfig({ ...config, rules: config.rules.map((item, i) => i === index ? next : item) })} onDelete={() => setConfig({ ...config, rules: config.rules.filter((_, i) => i !== index) })} />)}</div>
      </section>
      <section className="space-y-3">
        <div className="flex items-center justify-between"><div><h2 className="text-base font-semibold">推送地址</h2><p className="text-xs text-muted-foreground">按严重级别将告警路由到 Webhook 接收器</p></div><Button variant="outline" size="sm" onClick={() => setConfig({ ...config, receivers: [...config.receivers, blankReceiver()] })}><Plus />新增地址</Button></div>
        <div className="space-y-3">{config.receivers.map((receiver, index) => <ReceiverEditor key={`${receiver.id ?? 'new'}-${index}`} receiver={receiver} onChange={(next) => setConfig({ ...config, receivers: config.receivers.map((item, i) => i === index ? next : item) })} onDelete={() => setConfig({ ...config, receivers: config.receivers.filter((_, i) => i !== index) })} />)}</div>
      </section>
      <div className="sticky bottom-3 flex items-center justify-between border border-border bg-card/95 backdrop-blur px-4 py-3 rounded-md shadow-lg"><span className="text-xs text-muted-foreground">配置版本 v{config.version}{config.updatedAt ? ` · ${new Date(config.updatedAt).toLocaleString()}` : ''}</span><Button onClick={() => void save()} disabled={saving}><Save />{saving ? '保存中…' : '保存并应用'}</Button></div>
    </div>
  );
}

function PageHeading({ onRefresh }: { onRefresh: () => void }) { return <div className="flex items-start justify-between"><div><h1 className="text-2xl font-semibold tracking-tight">Alerts</h1><p className="text-sm text-muted-foreground mt-0.5">告警规则与通知路由配置</p></div><Button variant="ghost" size="icon" title="刷新配置" onClick={onRefresh}><RefreshCw /></Button></div>; }
function ErrorBox({ text }: { text: string }) { return <div className="flex gap-2 items-start rounded-md border border-destructive/40 bg-destructive/10 px-4 py-2.5 text-sm text-destructive"><AlertTriangle className="size-4 mt-0.5" />{text}</div>; }
function Field({ label, children, wide = false }: { label: string; children: React.ReactNode; wide?: boolean }) { return <label className={wide ? 'block md:col-span-2' : 'block'}><span className="block text-[11px] text-muted-foreground mb-1">{label}</span>{children}</label>; }
const inputClass = 'w-full h-8 rounded-md border border-input bg-background px-2.5 text-sm outline-none focus:ring-2 focus:ring-ring/40';
const areaClass = 'w-full min-h-20 rounded-md border border-input bg-background px-2.5 py-1.5 text-sm font-mono outline-none focus:ring-2 focus:ring-ring/40';
function RuleEditor({ rule, onChange, onDelete }: { rule: Rule; onChange: (rule: Rule) => void; onDelete: () => void }) { const set = (patch: Partial<Rule>) => onChange({ ...rule, ...patch }); return <Card><CardHeader className="py-3"><CardTitle className="text-sm flex items-center justify-between"><span className="font-mono">{rule.ruleName || '未命名规则'}</span><div className="flex items-center gap-2"><label className="text-xs text-muted-foreground flex items-center gap-1.5"><input type="checkbox" checked={rule.enabled} onChange={(e) => set({ enabled: e.target.checked })} />启用</label><Button variant="ghost" size="icon-sm" title="删除规则" onClick={onDelete}><Trash2 className="text-destructive" /></Button></div></CardTitle></CardHeader><CardContent className="grid gap-3 md:grid-cols-2 lg:grid-cols-4"><Field label="规则名称"><input className={inputClass} value={rule.ruleName} onChange={(e) => set({ ruleName: e.target.value })} /></Field><Field label="分组"><input className={inputClass} value={rule.groupName} onChange={(e) => set({ groupName: e.target.value })} /></Field><Field label="评估间隔（秒）"><input className={inputClass} type="number" min="1" value={rule.intervalSec} onChange={(e) => set({ intervalSec: Number(e.target.value) })} /></Field><Field label="持续时间"><input className={inputClass} placeholder="例如 2m" value={rule.forDuration} onChange={(e) => set({ forDuration: e.target.value })} /></Field><Field label="严重级别"><select className={inputClass} value={rule.severity} onChange={(e) => set({ severity: e.target.value as Severity })}><option value="critical">critical</option><option value="warning">warning</option><option value="info">info</option></select></Field><Field label="摘要" wide><input className={inputClass} value={rule.summary} onChange={(e) => set({ summary: e.target.value })} /></Field><Field label="PromQL 表达式" wide><textarea className={areaClass} value={rule.expression} onChange={(e) => set({ expression: e.target.value })} /></Field><Field label="描述" wide><textarea className={areaClass} value={rule.description} onChange={(e) => set({ description: e.target.value })} /></Field></CardContent></Card>; }
function ReceiverEditor({ receiver, onChange, onDelete }: { receiver: Receiver; onChange: (receiver: Receiver) => void; onDelete: () => void }) { const set = (patch: Partial<Receiver>) => onChange({ ...receiver, ...patch }); return <Card><CardContent className="grid gap-3 md:grid-cols-2 lg:grid-cols-4 items-end pt-4"><Field label="接收器名称"><input className={inputClass} value={receiver.receiverName} onChange={(e) => set({ receiverName: e.target.value })} /></Field><Field label="推送地址" wide><input className={inputClass} type="url" value={receiver.endpoint} onChange={(e) => set({ endpoint: e.target.value })} /></Field><Field label="匹配级别"><select className={inputClass} value={receiver.severityMatch} onChange={(e) => set({ severityMatch: e.target.value as Match })}><option value="all">全部</option><option value="critical">critical</option><option value="warning">warning</option><option value="info">info</option></select></Field><div className="flex items-center gap-4 h-8"><label className="text-xs flex items-center gap-1.5"><input type="checkbox" checked={receiver.sendResolved} onChange={(e) => set({ sendResolved: e.target.checked })} />发送恢复</label><label className="text-xs flex items-center gap-1.5"><input type="checkbox" checked={receiver.enabled} onChange={(e) => set({ enabled: e.target.checked })} />启用</label><Button variant="ghost" size="icon-sm" title="删除地址" onClick={onDelete}><Trash2 className="text-destructive" /></Button></div></CardContent></Card>; }
