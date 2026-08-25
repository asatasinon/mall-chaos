'use client';

import { useEffect, useRef, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Play, Pause, Pencil, Save, X, Check, Power, PowerOff } from 'lucide-react';
import { fetchWithAuth } from '@/lib/auth-fetch';

interface RunnerStatus {
  running: boolean; enabled: boolean; paused: boolean;
  currentQps: number; successRate: number; failRate: number;
  totalRequests: number; rateMultiplier: number; trafficRunId?: string | null;
}
interface MixRule { actionType: string; ratio: number; }
interface RunnerConfig {
  version: number; enabled: boolean; baseQps: number; peakMultiplier: number;
  cycleMinutes: number; jitterPct: number; maxItems: number; maxItemQuantity: number;
  paymentSuccessRatio: number; paymentFailureRatio: number; paymentUnknownRatio: number;
  mixRules: MixRule[];
}
interface ConfigForm {
  baseQps: string; peakMultiplier: string; cycleMinutes: string; jitterPct: string;
  maxItems: string; maxItemQuantity: string; paymentSuccessRatio: string;
  paymentFailureRatio: string; paymentUnknownRatio: string;
}
interface ActivityEntry {
  ts: number; action: string; success: boolean; latencyMs: number;
  trafficRunId?: string; customerId?: number; orderId?: string; paymentId?: string;
  traceId?: string; status?: string; errorCode?: string;
}
interface LifecycleAccountSummary {
  loginEnabled: boolean;
  count: number;
  enabledCount: number;
  accounts: Array<{ label: string; enabled: boolean; expectedCustomerId?: number }>;
}
interface WarmupProgress {
  priceHistoryCount: number; priceHistoryTarget: number;
  behaviorLogCount: number;  behaviorLogTarget: number;
  completed: boolean; status: string;
}
interface InventoryReplenishmentStatus {
  running: boolean; lastWindowId: string | null;
  lastResult: 'COMPLETED' | 'FAILED' | 'SKIPPED' | null;
  lastAttemptAt: string | null; nextExecutionAt: string | null;
  retryCount: number; lastAddedQuantity: number;
  lastSkippedCount: number; lastFailedCount: number;
}

const ACTION_LABELS: Record<string, string> = {
  BROWSE_PRODUCT: 'Browse',
  SEARCH_CATALOG: 'Search',
  ADD_CART_ITEM: 'Add cart',
  UPDATE_CART_ITEM: 'Update cart',
  CHECKOUT: 'Checkout',
  PAYMENT_CONFIRM: 'Confirm payment',
  CANCEL_PENDING_ORDER: 'Cancel pending',
  QUERY_ORDER: 'Query order',
  QUERY_SHIPMENT: 'Query shipment',
};

export default function RunnerPage() {
  const [status, setStatus]       = useState<RunnerStatus | null>(null);
  const [config, setConfig]       = useState<RunnerConfig | null>(null);
  const [multiplier, setMult]     = useState('1.0');
  const [editing, setEditing]     = useState(false);
  const [form, setForm]           = useState<ConfigForm>({
    baseQps: '', peakMultiplier: '', cycleMinutes: '', jitterPct: '', maxItems: '',
    maxItemQuantity: '', paymentSuccessRatio: '', paymentFailureRatio: '', paymentUnknownRatio: '',
  });
  const [saving, setSaving]       = useState(false);
    const [toggleSaving, setToggleSaving] = useState(false);
  const [saveMsg, setSaveMsg]     = useState<{ ok: boolean; text: string } | null>(null);

  const [mixEditing, setMixEditing] = useState(false);
  const [mixForm, setMixForm]       = useState<MixRule[]>([]);
  const [mixSaving, setMixSaving]   = useState(false);
  const [mixMsg, setMixMsg]         = useState<{ ok: boolean; text: string } | null>(null);

  const [activity, setActivity]   = useState<ActivityEntry[]>([]);
  const [accountSummary, setAccountSummary] = useState<LifecycleAccountSummary | null>(null);

  const [warmup, setWarmup]         = useState<WarmupProgress | null>(null);
  const warmupIntervalRef           = useRef<ReturnType<typeof setInterval> | null>(null);

  const [inventoryReplenishment, setInventoryReplenishment] = useState<InventoryReplenishmentStatus | null>(null);

  const loadConfig = async () => {
    const res  = await fetchWithAuth('/internal/traffic/runner/config');
    const json = await res.json();
    if (json.code === 0) {
      setConfig(json.data);
      setForm({
        baseQps:        String(json.data.baseQps),
        peakMultiplier: String(json.data.peakMultiplier),
        cycleMinutes:   String(json.data.cycleMinutes),
        jitterPct:      String((json.data.jitterPct * 100).toFixed(0)),
        maxItems:       String(json.data.maxItems),
        maxItemQuantity: String(json.data.maxItemQuantity),
        paymentSuccessRatio: String((json.data.paymentSuccessRatio * 100).toFixed(0)),
        paymentFailureRatio: String((json.data.paymentFailureRatio * 100).toFixed(0)),
        paymentUnknownRatio: String((json.data.paymentUnknownRatio * 100).toFixed(0)),
      });
      setMixForm(json.data.mixRules ?? []);
    }
  };

  const loadWarmup = async () => {
    try {
      const res  = await fetchWithAuth('/internal/traffic/runner/data-warmup/progress');
      const json = await res.json();
      if (json.code === 0) {
        setWarmup(json.data);
        if (json.data.completed && warmupIntervalRef.current) {
          clearInterval(warmupIntervalRef.current);
          warmupIntervalRef.current = null;
        }
      }
    } catch {}
  };

  const loadAccountSummary = async () => {
    try {
      const res = await fetchWithAuth('/internal/traffic/runner/accounts');
      const json = await res.json();
      if (json.code === 0) setAccountSummary(json.data);
    } catch {}
  };

  const loadInventoryReplenishment = async () => {
    try {
      const res  = await fetchWithAuth('/internal/traffic/runner/inventory-replenishment/status');
      const json = await res.json();
      if (json.code === 0 && json.data) setInventoryReplenishment(json.data);
    } catch {}
  };

  useEffect(() => {
    const loadStatus = async () => {      try {
        const res  = await fetchWithAuth('/internal/traffic/runner/status');
        const json = await res.json();
        if (json.code === 0) setStatus(json.data);
      } catch {}
    };
    const loadActivity = async () => {
      try {
        const res  = await fetchWithAuth('/internal/traffic/runner/activity?limit=20');
        const json = await res.json();
        if (json.code === 0) setActivity(json.data);
      } catch {}
    };
    void Promise.resolve().then(() => loadConfig()).catch(() => {});
    void Promise.resolve().then(() => loadStatus());
    void Promise.resolve().then(() => loadActivity());
    void Promise.resolve().then(() => loadAccountSummary());
    void Promise.resolve().then(() => loadInventoryReplenishment());
    void Promise.resolve().then(() => loadWarmup());
    const id1 = setInterval(loadStatus, 3000);
    const id2 = setInterval(loadActivity, 5000);
    const id3 = setInterval(loadInventoryReplenishment, 5000);
    return () => { clearInterval(id1); clearInterval(id2); clearInterval(id3); };
  }, []);

  useEffect(() => {
    if (warmup && !warmup.completed) {
      warmupIntervalRef.current = setInterval(loadWarmup, 10000);
    }
    return () => {
      if (warmupIntervalRef.current) clearInterval(warmupIntervalRef.current);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [warmup?.completed]);

  const action = (path: string, body?: unknown) =>
    fetchWithAuth(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });

  const toggleEnabled = async () => {
    if (!config) return;
    setToggleSaving(true); setSaveMsg(null);
    try {
      const res = await fetchWithAuth('/internal/traffic/runner/config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ version: config.version, enabled: !config.enabled }),
      });
      const json = await res.json();
      if (json.code !== 0) throw new Error(json.message || 'Failed to update runner state');
      setSaveMsg({ ok: true, text: json.data.enabled ? 'Traffic generation enabled' : 'Traffic generation disabled' });
      await loadConfig();
      setStatus((current) => current ? { ...current, enabled: json.data.enabled, running: json.data.enabled && !current.paused } : current);
    } catch (e: unknown) {
      setSaveMsg({ ok: false, text: e instanceof Error ? e.message : 'Failed to update runner state' });
    } finally { setToggleSaving(false); }
  };

  const saveConfig = async () => {
    if (!config) return;
    setSaving(true); setSaveMsg(null);
    try {
      const res  = await fetchWithAuth('/internal/traffic/runner/config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          version:        config.version,
          baseQps:        parseFloat(form.baseQps),
          peakMultiplier: parseFloat(form.peakMultiplier),
          cycleMinutes:   parseInt(form.cycleMinutes, 10),
          jitterPct:      parseFloat(form.jitterPct) / 100,
          maxItems:       parseInt(form.maxItems, 10),
          maxItemQuantity: parseInt(form.maxItemQuantity, 10),
          paymentSuccessRatio: parseFloat(form.paymentSuccessRatio) / 100,
          paymentFailureRatio: parseFloat(form.paymentFailureRatio) / 100,
          paymentUnknownRatio: parseFloat(form.paymentUnknownRatio) / 100,
        }),
      });
      const json = await res.json();
      if (json.code === 0) {
        setSaveMsg({ ok: true, text: `Saved · v${json.data.newVersion}` });
        setEditing(false);
        await loadConfig();
      } else {
        setSaveMsg({ ok: false, text: json.message || 'Save failed' });
      }
    } catch (e: unknown) {
      setSaveMsg({ ok: false, text: e instanceof Error ? e.message : 'error' });
    } finally { setSaving(false); }
  };

  const cancelEdit = () => {
    setEditing(false); setSaveMsg(null);
    if (config) setForm({
      baseQps:        String(config.baseQps),
      peakMultiplier: String(config.peakMultiplier),
      cycleMinutes:   String(config.cycleMinutes),
      jitterPct:      String((config.jitterPct * 100).toFixed(0)),
      maxItems:       String(config.maxItems),
      maxItemQuantity: String(config.maxItemQuantity),
      paymentSuccessRatio: String((config.paymentSuccessRatio * 100).toFixed(0)),
      paymentFailureRatio: String((config.paymentFailureRatio * 100).toFixed(0)),
      paymentUnknownRatio: String((config.paymentUnknownRatio * 100).toFixed(0)),
    });
  };

  const saveMix = async () => {
    if (!config) return;
    const total = mixForm.reduce((s, r) => s + r.ratio, 0);
    if (total <= 0) { setMixMsg({ ok: false, text: 'Ratios must sum > 0' }); return; }
    const normalised = mixForm.map((r) => ({ ...r, ratio: +(r.ratio / total).toFixed(4) }));
    setMixSaving(true); setMixMsg(null);
    try {
      const res  = await fetchWithAuth('/internal/traffic/runner/config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ version: config.version, mixRules: normalised }),
      });
      const json = await res.json();
      if (json.code === 0) {
        setMixMsg({ ok: true, text: `Saved · v${json.data.newVersion}` });
        setMixEditing(false);
        await loadConfig();
      } else {
        setMixMsg({ ok: false, text: json.message || 'Save failed' });
      }
    } catch (e: unknown) {
      setMixMsg({ ok: false, text: e instanceof Error ? e.message : 'error' });
    } finally { setMixSaving(false); }
  };

  const cancelMix = () => {
    setMixEditing(false); setMixMsg(null);
    setMixForm(config?.mixRules ?? []);
  };

  const successPct = status ? status.successRate * 100 : 0;
  const failPct    = status ? status.failRate    * 100 : 0;
  const enabled    = status?.enabled ?? config?.enabled ?? false;
  const dotCls     = !status || !enabled ? 'status-dot-off' : status.paused ? 'status-dot-yellow' : status.running ? 'status-dot-green' : 'status-dot-off';
  const stateLabel = !status ? '—' : !enabled ? 'Disabled' : status.paused ? 'Paused' : status.running ? 'Running' : 'Stopped';

  const KPI_ITEMS = [
    { label: 'QPS',        value: status ? String(status.currentQps) : '—',             color: 'green' },
    { label: 'Success',    value: status ? `${successPct.toFixed(1)}%` : '—',           color: 'green' },
    { label: 'Fail',       value: status ? `${failPct.toFixed(1)}%` : '—',              color: failPct > 5 ? 'red' : 'muted' },
    { label: 'Total req',  value: status ? status.totalRequests.toLocaleString() : '—', color: 'muted' },
    { label: 'Multiplier', value: status ? `${status.rateMultiplier}×` : '—',           color: 'muted' },
  ] as const;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Runner</h1>
        <p className="text-sm text-muted-foreground mt-0.5">Traffic generation · rate management</p>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-medium flex items-center justify-between">
            Lifecycle accounts
            {accountSummary && (
              <Badge variant="secondary" className="text-[10px]">
                {accountSummary.loginEnabled ? `${accountSummary.enabledCount}/${accountSummary.count} enabled` : 'login disabled'}
              </Badge>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {!accountSummary && <p className="text-sm text-muted-foreground">Loading…</p>}
          {accountSummary && (
            <div className="flex flex-wrap gap-2">
              {accountSummary.accounts.map((account) => (
                <Badge key={account.label} variant="outline" className="gap-1.5">
                  <span className={`status-dot ${account.enabled ? 'status-dot-green' : 'status-dot-off'}`} />
                  {account.label}
                  {account.expectedCustomerId !== undefined && ` · customer ${account.expectedCustomerId}`}
                </Badge>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* KPI row */}
      <div className="grid grid-cols-5 gap-3">
        {KPI_ITEMS.map((k) => (
          <Card key={k.label}>
            <CardContent className="pt-4 pb-3 px-4">
              <p className="text-[11px] text-muted-foreground mb-1.5">{k.label}</p>
              <p className={`text-2xl font-semibold tabular-nums ${
                k.color === 'green' ? 'text-[oklch(0.55_0.15_155)]' :
                k.color === 'red'   ? 'text-destructive' :
                'text-muted-foreground'
              }`}>{k.value}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Baseline Config card */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-medium flex items-center justify-between">
            <span className="flex items-center gap-2">
              Baseline Config
              {config && <><Badge variant="secondary" className="text-[10px] font-mono">v{config.version}</Badge><Badge variant="secondary" className={`text-[10px] ${config.enabled ? 'bg-[oklch(0.55_0.15_155)]/10 text-[oklch(0.55_0.15_155)]' : 'bg-muted text-muted-foreground'}`}>{config.enabled ? 'enabled' : 'disabled'}</Badge></>}
            </span>
            <div className="flex items-center gap-3">
              <span className={`status-dot ${dotCls}`} />
              <span className="text-xs font-normal text-muted-foreground">{stateLabel}</span>
              {!editing ? (
                <Button size="sm" variant="ghost" className="text-xs h-7" onClick={() => setEditing(true)}>
                  <Pencil />Edit
                </Button>
              ) : (
                <div className="flex items-center gap-2">
                  {saveMsg && <span className={`text-xs ${saveMsg.ok ? 'text-[oklch(0.55_0.15_155)]' : 'text-destructive'}`}>{saveMsg.text}</span>}
                  <Button size="sm" variant="outline" className="text-xs h-7" onClick={saveConfig} disabled={saving}>
                    <Save />{saving ? 'Saving…' : 'Save'}
                  </Button>
                  <Button size="sm" variant="ghost" className="text-xs h-7" onClick={cancelEdit}>
                    <X />Cancel
                  </Button>
                </div>
              )}
            </div>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Lifecycle + rate row */}
          <div className="flex items-center gap-4">
            {enabled ? <Button size="sm" variant="outline" className="border-destructive/40 text-destructive hover:bg-destructive/10"
              onClick={toggleEnabled} disabled={toggleSaving}>
              <PowerOff />{toggleSaving ? 'Updating…' : 'Disable'}
            </Button> : <Button size="sm" className="bg-[oklch(0.55_0.15_155)] hover:bg-[oklch(0.50_0.15_155)] text-white"
              onClick={toggleEnabled} disabled={toggleSaving}>
              <Power />{toggleSaving ? 'Updating…' : 'Enable'}
            </Button>}
            {enabled && (status?.running && !status.paused ? (
              <Button size="sm" variant="outline" className="border-warning/40 text-warning hover:bg-warning/10"
                onClick={() => action('/internal/traffic/runner/pause')}>
                <Pause />Pause
              </Button>
            ) : (
              <Button size="sm" variant="outline"
                onClick={() => action('/internal/traffic/runner/resume')}>
                <Play />Resume
              </Button>
            ))}
            <div className="h-5 w-px bg-border" />
            <span className="text-xs text-muted-foreground shrink-0">Rate multiplier</span>
            <div className="flex items-center gap-2">
              <input
                type="number" step="0.1" min="0.1" max="10" value={multiplier}
                onChange={(e) => setMult(e.target.value)}
                className="w-20 h-8 rounded-md border border-border bg-input px-2.5 text-sm font-mono text-foreground outline-none focus:ring-1 focus:ring-ring"
              />
              <Button size="sm" variant="outline" className="h-8"
                onClick={() => action('/internal/traffic/runner/rate', { multiplier: parseFloat(multiplier) })}>
                <Check />Apply
              </Button>
            </div>
          </div>
          <div className="h-px bg-border" />
          {!config && <p className="text-sm text-muted-foreground">Loading…</p>}
          {config && !editing && (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <KVTile label="Base QPS"   value={String(config.baseQps)} />
              <KVTile label="Peak mult." value={`${config.peakMultiplier}×`} />
              <KVTile label="Cycle"      value={`${config.cycleMinutes} min`} />
              <KVTile label="Jitter"     value={`${(config.jitterPct * 100).toFixed(0)}%`} />
            </div>
          )}
          {config && editing && (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <Field label="Base QPS"    hint="req/s baseline" value={form.baseQps}        type="number" min="1"   step="1"
                onChange={(v) => setForm((f) => ({ ...f, baseQps: v }))} />
              <Field label="Peak mult."  hint="spike factor"   value={form.peakMultiplier} type="number" min="1"   step="0.1"
                onChange={(v) => setForm((f) => ({ ...f, peakMultiplier: v }))} />
              <Field label="Cycle (min)" hint="wave period"    value={form.cycleMinutes}   type="number" min="1"   step="1"
                onChange={(v) => setForm((f) => ({ ...f, cycleMinutes: v }))} />
              <Field label="Jitter %"    hint="0–100"          value={form.jitterPct}      type="number" min="0"   max="100" step="1"
                onChange={(v) => setForm((f) => ({ ...f, jitterPct: v }))} />
              <Field label="Max items" hint="cart item types" value={form.maxItems} type="number" min="1" max="20" step="1"
                onChange={(v) => setForm((f) => ({ ...f, maxItems: v }))} />
              <Field label="Max quantity" hint="per SKU" value={form.maxItemQuantity} type="number" min="1" max="99" step="1"
                onChange={(v) => setForm((f) => ({ ...f, maxItemQuantity: v }))} />
              <Field label="Payment success %" hint="runner strategy" value={form.paymentSuccessRatio} type="number" min="0" max="100" step="1"
                onChange={(v) => setForm((f) => ({ ...f, paymentSuccessRatio: v }))} />
              <Field label="Payment failure %" hint="runner strategy" value={form.paymentFailureRatio} type="number" min="0" max="100" step="1"
                onChange={(v) => setForm((f) => ({ ...f, paymentFailureRatio: v }))} />
              <Field label="Payment unknown %" hint="runner strategy" value={form.paymentUnknownRatio} type="number" min="0" max="100" step="1"
                onChange={(v) => setForm((f) => ({ ...f, paymentUnknownRatio: v }))} />
            </div>
          )}
        </CardContent>
      </Card>

      {/* Traffic Mix card */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-medium flex items-center justify-between">
            Traffic Mix
            {!mixEditing ? (
              <Button size="sm" variant="ghost" className="text-xs h-7" onClick={() => { setMixEditing(true); setMixMsg(null); }}>
                <Pencil />Edit
              </Button>
            ) : (
              <div className="flex items-center gap-2">
                {mixMsg && <span className={`text-xs ${mixMsg.ok ? 'text-[oklch(0.55_0.15_155)]' : 'text-destructive'}`}>{mixMsg.text}</span>}
                <Button size="sm" variant="outline" className="text-xs h-7" onClick={saveMix} disabled={mixSaving}>
                  <Save />{mixSaving ? 'Saving…' : 'Save'}
                </Button>
                <Button size="sm" variant="ghost" className="text-xs h-7" onClick={cancelMix}>
                  <X />Cancel
                </Button>
              </div>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {!config && <p className="text-sm text-muted-foreground">Loading…</p>}
          {config && (
            <div className="space-y-2.5">
              {(mixEditing ? mixForm : config.mixRules).map((rule, i) => {
                const displayPct = (rule.ratio * 100).toFixed(1);
                const actionLabel = ACTION_LABELS[rule.actionType] ?? rule.actionType;
                const barColor = rule.actionType === 'PAYMENT_CONFIRM'
                  ? 'bg-[oklch(0.55_0.15_155)]'
                  : rule.actionType === 'CANCEL_PENDING_ORDER'
                  ? 'bg-destructive'
                  : 'bg-muted-foreground/40';

                return (
                  <div key={rule.actionType} className="flex items-center gap-3">
                    <span className="text-xs text-muted-foreground w-20 shrink-0 font-mono">{actionLabel}</span>
                    <div className="flex-1 h-2 rounded-full bg-muted overflow-hidden">
                      <div className={`h-full rounded-full transition-all duration-300 ${barColor}`}
                        style={{ width: `${Math.min(rule.ratio * 100, 100)}%` }} />
                    </div>
                    {!mixEditing ? (
                      <span className="text-xs font-mono tabular-nums w-12 text-right">{displayPct}%</span>
                    ) : (
                      <div className="flex items-center gap-1.5 shrink-0">
                        <input
                          type="number" min="0" max="100" step="1"
                          value={(mixForm[i].ratio * 100).toFixed(0)}
                          onChange={(e) => {
                            const v = Math.max(0, parseFloat(e.target.value) || 0) / 100;
                            setMixForm((prev) => prev.map((r, j) => j === i ? { ...r, ratio: v } : r));
                          }}
                          className="w-16 h-7 rounded-md border border-border bg-input px-2 text-xs font-mono text-foreground outline-none focus:ring-1 focus:ring-ring"
                        />
                        <span className="text-xs text-muted-foreground">%</span>
                      </div>
                    )}
                  </div>
                );
              })}
              {mixEditing && (
                <p className="text-[11px] text-muted-foreground pt-1">
                  Values are normalised to 100% on save. Current sum: {(mixForm.reduce((s, r) => s + r.ratio, 0) * 100).toFixed(0)}%
                </p>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Recent Activity card */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-medium flex items-center justify-between">
            Recent Activity
            <span className="text-[11px] text-muted-foreground font-normal">auto-refresh every 5s</span>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {activity.length === 0 && (
            <p className="text-sm text-muted-foreground">No activity yet — start the runner to see requests.</p>
          )}
          {activity.length > 0 && (
            <div className="space-y-1">
              {activity.map((e, i) => {
                const time = new Date(e.ts).toISOString().slice(11, 19);
                const label = ACTION_LABELS[e.action] ?? e.action;
                return (
                  <div key={i} className="flex items-center gap-3 text-xs">
                    <span className="font-mono text-muted-foreground tabular-nums w-20 shrink-0">{time}</span>
                    <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${
                      e.action === 'PAYMENT_CONFIRM' ? 'bg-[oklch(0.55_0.15_155)]/10 text-[oklch(0.55_0.15_155)]' :
                      e.action === 'CANCEL_PENDING_ORDER' ? 'bg-destructive/10 text-destructive' :
                      'bg-muted text-muted-foreground'
                    }`}>{label}</span>
                    <span className={e.success ? 'text-[oklch(0.55_0.15_155)]' : 'text-destructive'}>
                      {e.success ? '✓' : '✗'}
                    </span>
                    <span className="text-muted-foreground tabular-nums">{e.latencyMs}ms</span>
                    {e.customerId && <span className="text-muted-foreground">customer {e.customerId}</span>}
                    {e.orderId && <span className="font-mono text-muted-foreground">order {e.orderId}</span>}
                    {e.errorCode && <span className="text-destructive font-mono">{e.errorCode}</span>}
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Data Warmup Progress card */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-medium flex items-center justify-between">
            Data Warmup
            {warmup && (
              <Badge variant="secondary" className={`text-[10px] ${warmup.completed ? 'bg-[oklch(0.55_0.15_155)]/10 text-[oklch(0.55_0.15_155)]' : 'bg-warning/10 text-warning'}`}>
                {warmup.status}
              </Badge>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {!warmup && <p className="text-sm text-muted-foreground">Loading…</p>}
          {warmup && (
            <div className="space-y-3">
              {[
                { label: 'product_price_history', count: warmup.priceHistoryCount, target: warmup.priceHistoryTarget },
                { label: 'user_behavior_log',     count: warmup.behaviorLogCount,  target: warmup.behaviorLogTarget  },
              ].map(({ label, count, target }) => {
                const pct = Math.min((count / target) * 100, 100);
                const done = count >= target;
                return (
                  <div key={label}>
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-xs font-mono text-muted-foreground">{label}</span>
                      <span className="text-xs tabular-nums text-muted-foreground">
                        {(count / 1_000_000).toFixed(1)}M / {(target / 1_000_000).toFixed(0)}M
                      </span>
                    </div>
                    <div className="h-2 rounded-full bg-muted overflow-hidden">
                      <div
                        className={`h-full rounded-full transition-all duration-300 ${done ? 'bg-[oklch(0.55_0.15_155)]' : 'bg-warning'}`}
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Inventory replenishment status */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-medium flex items-center justify-between">
            Inventory replenishment
            {inventoryReplenishment && (
              <Badge variant="secondary" className="text-[10px]">
                {inventoryReplenishment.lastResult ?? 'pending'}
              </Badge>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {!inventoryReplenishment && <p className="text-sm text-muted-foreground">Loading…</p>}
          {inventoryReplenishment && (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <KVTile label="Window" value={inventoryReplenishment.lastWindowId ?? '—'} />
              <KVTile label="Next run" value={formatTimestamp(inventoryReplenishment.nextExecutionAt)} />
              <KVTile label="Added" value={String(inventoryReplenishment.lastAddedQuantity)} />
              <KVTile label="Retries" value={String(inventoryReplenishment.retryCount)} />
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function KVTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md bg-muted/40 px-3 py-2.5">
      <p className="text-[11px] text-muted-foreground mb-1">{label}</p>
      <p className="text-xl font-semibold tabular-nums text-foreground">{value}</p>
    </div>
  );
}

function formatTimestamp(value: string | null): string {
  return value ? new Date(value).toLocaleString() : '—';
}

function Field({ label, hint, value, onChange, type, min, max, step }: {
  label: string; hint: string; value: string; onChange: (v: string) => void;
  type?: string; min?: string; max?: string; step?: string;
}) {
  return (
    <div className="space-y-1">
      <label className="text-xs font-medium text-muted-foreground">{label}</label>
      <input type={type} min={min} max={max} step={step} value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-md border border-border bg-input px-2.5 py-1.5 text-sm font-mono text-foreground outline-none focus:ring-1 focus:ring-ring" />
      <p className="text-[11px] text-muted-foreground/60">{hint}</p>
    </div>
  );
}
