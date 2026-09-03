'use client';

import { useTranslations } from 'next-intl';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { isClientNetworkError } from '@/lib/client-error';
import AlertRoutingSection from '@/components/LocalizedAlertRoutingSection';
import { CreateAlertModal, ReceiverModal, RouteModal } from '@/components/LocalizedAlertModals';
import { AlertsToolbar, ErrorBox, YamlSourceEditor } from '@/components/LocalizedAlertControls';
import { ReceiverEditor, RuleEditor } from '@/components/LocalizedAlertEditors';
import {
  AlertConfig,
  AlertTab,
  CreateAlertMode,
  DRAFT_WRAPPER_CLASS,
  blankReceiver,
  blankRoute,
  blankRule,
} from '@/components/alerts/types';

async function fetchAlerts(input: RequestInfo | URL, init: RequestInit | undefined, onUnauthorized: () => void): Promise<Response> {
  const response = await fetch(input, init);
  if (response.status === 401 && typeof window !== 'undefined') onUnauthorized();
  return response;
}

export default function AlertsPage() {
  const t = useTranslations('Alerts');
  const router = useRouter();
  const [config, setConfig] = useState<AlertConfig | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [saving, setSaving] = useState(false);
  const [importError, setImportError] = useState('');
  const [sourceYaml, setSourceYaml] = useState('');
  const [sourceKind, setSourceKind] = useState<'prometheus-rules' | 'alertmanager'>('prometheus-rules');
  const [sourceVersion, setSourceVersion] = useState<number | null>(null);
  const [sourceLoading, setSourceLoading] = useState(false);
  const [sourceDirty, setSourceDirty] = useState(false);
  const [editorYaml, setEditorYaml] = useState('');
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [receiverModalOpen, setReceiverModalOpen] = useState(false);
  const [routeModalOpen, setRouteModalOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<AlertTab>('rules');
  const [createMode, setCreateMode] = useState<CreateAlertMode>('rule');
  const [draftRule, setDraftRule] = useState(blankRule());
  const [draftReceiver, setDraftReceiver] = useState(blankReceiver());
  const [draftRoute, setDraftRoute] = useState(blankRoute());
  const [scrollTarget, setScrollTarget] = useState('');
  const itemRefs = useRef<Record<string, HTMLDivElement | null>>({});

  const login = useCallback(() => router.push(`/login?returnTo=${encodeURIComponent(window.location.pathname)}`), [router]);

  const load = useCallback(async () => {
    setError('');
    try {
      const response = await fetchAlerts('/internal/alerts/config', { cache: 'no-store' }, login);
      const result = await response.json();
      if (!response.ok || result.code !== 0) throw new Error(result.message);
      setConfig(result.data as AlertConfig);
    } catch (cause) {
      setError(isClientNetworkError(cause) ? t('controlPlaneUnreachable') : cause instanceof Error ? cause.message : t('loadFailed'));
    }
  }, [login, t]);

  const loadSource = useCallback(async (kind: 'prometheus-rules' | 'alertmanager') => {
    setSourceLoading(true);
    setError('');
    try {
      const response = await fetchAlerts(`/internal/alerts/source?kind=${kind}`, { cache: 'no-store' }, login);
      const result = await response.json();
      if (!response.ok || result.code !== 0) throw new Error(result.message);
      setEditorYaml(result.data.yaml);
      setSourceVersion(result.data.version);
      setSourceDirty(false);
    } catch (cause) {
      setError(isClientNetworkError(cause) ? t('controlPlaneUnreachable') : cause instanceof Error ? cause.message : t('failedToLoadYaml'));
    } finally {
      setSourceLoading(false);
    }
  }, [login, t]);

  const saveSource = async () => {
    if (!config || sourceVersion === null || !editorYaml.trim()) return;
    setSaving(true);
    setError('');
    setNotice('');
    try {
      const response = await fetchAlerts('/internal/alerts/source', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind: sourceKind, version: sourceVersion, yaml: editorYaml }),
      }, login);
      const result = await response.json();
      if (!response.ok || result.code !== 0) throw new Error(result.message);
      const configResponse = await fetchAlerts('/internal/alerts/config', { cache: 'no-store' }, login);
      const configResult = await configResponse.json();
      setConfig(configResult.data as AlertConfig);
      setEditorYaml(result.data.yaml);
      setSourceVersion(result.data.version);
      setSourceDirty(false);
      setNotice(t('yamlSaved', { kind: sourceKind === 'prometheus-rules' ? 'Prometheus rules' : 'Alertmanager' }));
    } catch (cause) {
      setError(isClientNetworkError(cause) ? t('controlPlaneUnreachable') : cause instanceof Error ? cause.message : t('failedToSaveYaml'));
    } finally {
      setSaving(false);
    }
  };

  useEffect(() => { void Promise.resolve().then(() => load()); }, [load]);
  useEffect(() => { if (activeTab === 'yaml') void Promise.resolve().then(() => loadSource(sourceKind)); }, [activeTab, sourceKind, loadSource]);
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
    setSaving(true);
    setError('');
    setNotice('');
    try {
      const persistableConfig = {
        ...config,
        rules: config.rules.map((rule) => { const next = { ...rule }; delete next.isDraft; return next; }),
        receivers: config.receivers.map((receiver) => { const next = { ...receiver }; delete next.isDraft; return next; }),
        route: { ...config.route, routes: config.route.routes.map((route) => { const next = { ...route }; delete next.isDraft; return next; }) },
      };
      const response = await fetchAlerts('/internal/alerts/config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(persistableConfig),
      }, login);
      const result = await response.json();
      if (!response.ok || result.code !== 0) throw new Error(result.message);
      setConfig(result.data as AlertConfig);
      setNotice(t('configurationSaved'));
    } catch (cause) {
      setError(isClientNetworkError(cause) ? t('configurationCouldNotBeSaved') : cause instanceof Error ? cause.message : t('failedToSave'));
    } finally {
      setSaving(false);
    }
  };

  const importYaml = async (kind: 'prometheus-rules' | 'alertmanager') => {
    if (!config || !sourceYaml.trim()) return;
    setSaving(true);
    setError('');
    setImportError('');
    setNotice('');
    try {
      const response = await fetchAlerts('/internal/alerts/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ version: config.version, kind, yaml: sourceYaml }),
      }, login);
      const result = await response.json();
      if (!response.ok || result.code !== 0) throw new Error(result.message);
      setConfig(result.data as AlertConfig);
      setSourceYaml('');
      setCreateModalOpen(false);
      setReceiverModalOpen(false);
      setNotice(kind === 'prometheus-rules' ? t('prometheusYamlParsed') : t('alertmanagerYamlParsed'));
    } catch (cause) {
      setImportError(isClientNetworkError(cause) ? t('yamlCouldNotBeParsed') : cause instanceof Error ? cause.message : t('importFailed'));
    } finally {
      setSaving(false);
    }
  };

  const addRule = () => {
    if (!config) return;
    const nextIndex = config.rules.length;
    setConfig({ ...config, rules: [...config.rules, { ...draftRule, isDraft: true }] });
    setDraftRule(blankRule());
    setCreateModalOpen(false);
    setActiveTab('rules');
    setScrollTarget(`rule-${nextIndex}`);
    setNotice(t('ruleAdded'));
  };

  const addReceiver = () => {
    if (!config) return;
    const nextIndex = config.receivers.length;
    setConfig({ ...config, receivers: [...config.receivers, { ...draftReceiver, isDraft: true }] });
    setDraftReceiver(blankReceiver());
    setReceiverModalOpen(false);
    setActiveTab('routing');
    setScrollTarget(`receiver-${nextIndex}`);
    setNotice(t('receiverAdded'));
  };

  const addRoute = () => {
    if (!config) return;
    const nextIndex = config.route.routes.length;
    setConfig({ ...config, route: { ...config.route, routes: [...config.route.routes, { ...draftRoute, isDraft: true }] } });
    setDraftRoute(blankRoute());
    setRouteModalOpen(false);
    setActiveTab('routing');
    setScrollTarget(`route-${nextIndex}`);
    setNotice(t('routeAdded'));
  };

  if (!config) return <div className="space-y-4"><p className="text-sm text-muted-foreground">{t('loadingConfiguration')}</p>{error && <ErrorBox text={error} />}</div>;
  const refreshCurrent = () => activeTab === 'yaml' ? void loadSource(sourceKind) : void load();
  const saveCurrent = () => activeTab === 'yaml' ? void saveSource() : void save();
  const saveDisabled = saving || (activeTab === 'yaml' && (sourceLoading || !sourceDirty || !editorYaml.trim()));

  return <div className="flex h-full min-h-0 w-full flex-col gap-5">
    {error && <ErrorBox text={error} />}
    {notice && <div className="border border-green-700/30 bg-green-700/10 text-green-800 dark:text-green-300 px-4 py-2.5 rounded-md text-sm">{notice}</div>}
    <AlertsToolbar activeTab={activeTab} onTabChange={setActiveTab} onRefresh={refreshCurrent} onSave={saveCurrent} saveDisabled={saveDisabled} saving={saving} onAddRule={() => { setDraftRule(blankRule()); setCreateMode('rule'); setCreateModalOpen(true); }} onAddRoute={() => { setDraftRoute(blankRoute()); setRouteModalOpen(true); }} onAddReceiver={() => { setDraftReceiver(blankReceiver()); setReceiverModalOpen(true); }} />
    <div className="min-h-0 flex-1 overflow-y-auto pr-1">
      {activeTab === 'yaml' && <YamlSourceEditor kind={sourceKind} onKindChange={setSourceKind} yaml={editorYaml} loading={sourceLoading} saving={saving} dirty={sourceDirty} version={sourceVersion} onChange={(value) => { setEditorYaml(value); setSourceDirty(true); }} />}
      {activeTab === 'rules' && <section className="space-y-3">
        <div><h2 className="text-base font-semibold">{t('alertRulesHeading')}</h2><p className="text-xs text-muted-foreground">{t('promqlRulesHelp')}</p></div>
        <div className="space-y-3">{config.rules.map((rule, index) => <div key={`${rule.id ?? 'new'}-${index}`} ref={(element) => { itemRefs.current[`rule-${index}`] = element; }} tabIndex={-1} className={rule.isDraft ? DRAFT_WRAPPER_CLASS : ''}><RuleEditor rule={rule} onChange={(next) => setConfig({ ...config, rules: config.rules.map((item, i) => i === index ? next : item) })} onDelete={() => setConfig({ ...config, rules: config.rules.filter((_, i) => i !== index) })} /></div>)}</div>
      </section>}
      {activeTab === 'routing' && <section className="space-y-3">
        <AlertRoutingSection config={config} cardRef={(index, element) => { itemRefs.current[`route-${index}`] = element; }} onChange={(route) => setConfig({ ...config, route })} />
        <div><h2 className="text-base font-semibold">{t('receiversHeading')}</h2><p className="text-xs text-muted-foreground">{t('routeAlertsHelp')}</p></div>
        <div className="space-y-3">{config.receivers.map((receiver, index) => <div key={`${receiver.id ?? 'new'}-${index}`} ref={(element) => { itemRefs.current[`receiver-${index}`] = element; }} tabIndex={-1} className={receiver.isDraft ? DRAFT_WRAPPER_CLASS : ''}><ReceiverEditor receiver={receiver} onChange={(next) => setConfig({ ...config, receivers: config.receivers.map((item, i) => i === index ? next : item) })} onDelete={() => setConfig({ ...config, receivers: config.receivers.filter((_, i) => i !== index) })} /></div>)}</div>
      </section>}
    </div>
    {createModalOpen && <CreateAlertModal mode={createMode} onModeChange={setCreateMode} rule={draftRule} onRuleChange={setDraftRule} sourceYaml={sourceYaml} onSourceYamlChange={setSourceYaml} error={importError} saving={saving} onClose={() => { setImportError(''); setCreateModalOpen(false); }} onAddRule={addRule} onImportYaml={() => void importYaml('prometheus-rules')} />}
    {receiverModalOpen && <ReceiverModal receiver={draftReceiver} onChange={setDraftReceiver} sourceYaml={sourceYaml} onSourceYamlChange={setSourceYaml} error={importError} saving={saving} onClose={() => { setImportError(''); setReceiverModalOpen(false); }} onAdd={addReceiver} onImportYaml={() => void importYaml('alertmanager')} />}
    {routeModalOpen && <RouteModal route={draftRoute} onChange={setDraftRoute} saving={saving} onClose={() => setRouteModalOpen(false)} onAdd={addRoute} />}
  </div>;
}
