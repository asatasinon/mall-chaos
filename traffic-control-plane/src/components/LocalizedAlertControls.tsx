'use client';

import { useTranslations } from 'next-intl';
import type { ReactNode } from 'react';
import { AlertTriangle, Plus, RefreshCw, Save } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { AlertTab, INPUT_CLASS, SourceKind } from '@/components/alerts/types';

interface AlertsToolbarProps {
  activeTab: AlertTab;
  onTabChange: (tab: AlertTab) => void;
  onRefresh: () => void;
  onSave: () => void;
  saveDisabled: boolean;
  saving: boolean;
  onAddRule: () => void;
  onAddRoute: () => void;
  onAddReceiver: () => void;
}

export function AlertsToolbar({ activeTab, onTabChange, onRefresh, onSave, saveDisabled, saving, onAddRule, onAddRoute, onAddReceiver }: AlertsToolbarProps) {
  const t = useTranslations('Alerts');
  return <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border"><div className="flex flex-wrap"><TabButton active={activeTab === 'rules'} onClick={() => onTabChange('rules')}>{t('alertRules')}</TabButton><TabButton active={activeTab === 'routing'} onClick={() => onTabChange('routing')}>{t('routesAndReceivers')}</TabButton><TabButton active={activeTab === 'yaml'} onClick={() => onTabChange('yaml')}>{t('fullYamlFile')}</TabButton></div><div className="flex flex-wrap items-center gap-2 pb-1"><Button variant="outline" size="sm" onClick={onRefresh} disabled={saving}><RefreshCw />{t('refresh')}</Button><Button variant="outline" size="sm" onClick={onSave} disabled={saveDisabled}><Save />{saving ? t('saving') : t('save')}</Button>{activeTab === 'rules' && <Button variant="outline" size="sm" onClick={onAddRule}><Plus />{t('newRule')}</Button>}{activeTab === 'routing' && <><Button variant="outline" size="sm" onClick={onAddRoute}><Plus />{t('newRoute')}</Button><Button variant="outline" size="sm" onClick={onAddReceiver}><Plus />{t('newReceiver')}</Button></>}</div></div>;
}

function TabButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) {
  return <button type="button" className={`relative px-4 py-2.5 text-sm font-medium ${active ? 'text-foreground' : 'text-muted-foreground hover:text-foreground'}`} onClick={onClick}>{children}{active && <span className="absolute inset-x-0 bottom-0 h-0.5 bg-primary" />}</button>;
}

interface YamlSourceEditorProps {
  kind: SourceKind;
  onKindChange: (kind: SourceKind) => void;
  yaml: string;
  loading: boolean;
  saving: boolean;
  dirty: boolean;
  version: number | null;
  onChange: (value: string) => void;
}

export function YamlSourceEditor({ kind, onKindChange, yaml, loading, saving, dirty, version, onChange }: YamlSourceEditorProps) {
  const t = useTranslations('Alerts');
  const kindLabel = kind === 'prometheus-rules' ? t('prometheusRulesFile') : t('alertmanagerFile');
  const status = loading ? t('readingFile') : dirty ? t('unsavedChanges') : t('synchronizedServer');
  return <section className="space-y-3"><div className="flex flex-wrap items-end justify-between gap-3"><div><h2 className="text-base font-semibold">{t('fullYamlEditor')}</h2><p className="text-xs text-muted-foreground">{t('configurationHelp')}</p></div><select className={INPUT_CLASS} value={kind} onChange={(event) => onKindChange(event.target.value as SourceKind)} disabled={loading || saving}><option value="prometheus-rules">{t('prometheusRulesFile')}</option><option value="alertmanager">{t('alertmanagerFile')}</option></select></div><div className="flex items-center justify-between text-xs text-muted-foreground"><span>{status}</span>{version !== null && <span>{t('configurationVersion', { version })}</span>}</div><textarea aria-label={t('yamlSource', { kind: kindLabel })} className="min-h-[calc(100vh-16rem)] w-full resize-y rounded-md border border-input bg-background px-3 py-3 font-mono text-xs leading-5 outline-none focus:ring-2 focus:ring-ring/40" value={yaml} onChange={(event) => onChange(event.target.value)} disabled={loading || saving} spellCheck={false} /></section>;
}

export function ErrorBox({ text }: { text: string }) {
  return <div className="flex gap-2 items-start rounded-md border border-destructive/40 bg-destructive/10 px-4 py-2.5 text-sm text-destructive"><AlertTriangle className="size-4 mt-0.5" />{text}</div>;
}
