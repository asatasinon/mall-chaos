'use client';

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
  return <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border"><div className="flex flex-wrap"><TabButton active={activeTab === 'rules'} onClick={() => onTabChange('rules')}>Alert rules</TabButton><TabButton active={activeTab === 'routing'} onClick={() => onTabChange('routing')}>Routes and receivers</TabButton><TabButton active={activeTab === 'yaml'} onClick={() => onTabChange('yaml')}>Full YAML file</TabButton></div><div className="flex flex-wrap items-center gap-2 pb-1"><Button variant="outline" size="sm" onClick={onRefresh} disabled={saving}><RefreshCw />Refresh</Button><Button variant="outline" size="sm" onClick={onSave} disabled={saveDisabled}><Save />Save</Button>{activeTab === 'rules' && <Button variant="outline" size="sm" onClick={onAddRule}><Plus />New rule</Button>}{activeTab === 'routing' && <><Button variant="outline" size="sm" onClick={onAddRoute}><Plus />New route</Button><Button variant="outline" size="sm" onClick={onAddReceiver}><Plus />New receiver</Button></>}</div></div>;
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
  return <section className="space-y-3"><div className="flex flex-wrap items-end justify-between gap-3"><div><h2 className="text-base font-semibold">Full YAML file editor</h2><p className="text-xs text-muted-foreground">Edit the active configuration file directly; saving validates, writes, and reloads the corresponding component.</p></div><select className={INPUT_CLASS} value={kind} onChange={(event) => onKindChange(event.target.value as SourceKind)} disabled={loading || saving}><option value="prometheus-rules">Prometheus alert-rules.yml</option><option value="alertmanager">Alertmanager alertmanager.yml</option></select></div><div className="flex items-center justify-between text-xs text-muted-foreground"><span>{loading ? 'Reading file...' : dirty ? 'Unsaved changes. Use Save and Apply in the upper-right.' : 'Synchronized with server'}</span>{version !== null && <span>Configuration version v{version}</span>}</div><textarea aria-label={`${kind} YAML source`} className="min-h-[calc(100vh-16rem)] w-full resize-y rounded-md border border-input bg-background px-3 py-3 font-mono text-xs leading-5 outline-none focus:ring-2 focus:ring-ring/40" value={yaml} onChange={(event) => onChange(event.target.value)} disabled={loading || saving} spellCheck={false} /></section>;
}

export function ErrorBox({ text }: { text: string }) {
  return <div className="flex gap-2 items-start rounded-md border border-destructive/40 bg-destructive/10 px-4 py-2.5 text-sm text-destructive"><AlertTriangle className="size-4 mt-0.5" />{text}</div>;
}
