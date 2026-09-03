'use client';

import { useTranslations } from 'next-intl';
import type { ReactNode } from 'react';
import { Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import type { AlertRoute, Match, Receiver, Rule, Severity } from '@/components/alerts/types';
import { AREA_CLASS, INPUT_CLASS } from '@/components/alerts/types';

export function Field({ label, children, wide = false }: { label: string; children: ReactNode; wide?: boolean }) {
  return <label className={wide ? 'block md:col-span-2' : 'block'}><span className="mb-1 block text-[11px] text-muted-foreground">{label}</span>{children}</label>;
}

export function RuleEditor({ rule, onChange, onDelete }: { rule: Rule; onChange: (rule: Rule) => void; onDelete: () => void }) {
  const t = useTranslations('Alerts');
  const set = (patch: Partial<Rule>) => onChange({ ...rule, ...patch });
  return <Card><CardHeader className="py-3"><CardTitle className="flex items-center justify-between text-sm"><span className="font-mono">{rule.ruleName || t('unnamedRule')}</span><div className="flex items-center gap-2"><label className="flex items-center gap-1.5 text-xs text-muted-foreground"><input type="checkbox" checked={rule.enabled} onChange={(event) => set({ enabled: event.target.checked })} />{t('enabled')}</label><Button variant="ghost" size="icon-sm" title={t('deleteRule')} aria-label={t('deleteRule')} onClick={onDelete}><Trash2 className="text-destructive" /></Button></div></CardTitle></CardHeader><CardContent className="grid gap-3 md:grid-cols-2 lg:grid-cols-4"><Field label={t('ruleName')}><input className={INPUT_CLASS} value={rule.ruleName} onChange={(event) => set({ ruleName: event.target.value })} /></Field><Field label={t('ruleGroup')}><input className={INPUT_CLASS} value={rule.groupName} onChange={(event) => set({ groupName: event.target.value })} /></Field><Field label={t('evaluationInterval')}><input className={INPUT_CLASS} type="number" min="1" value={rule.intervalSec} onChange={(event) => set({ intervalSec: Number(event.target.value) })} /></Field><Field label={t('durationField')}><input className={INPUT_CLASS} placeholder="e.g. 2m" value={rule.forDuration} onChange={(event) => set({ forDuration: event.target.value })} /></Field><Field label={t('severity')}><select className={INPUT_CLASS} value={rule.severity} onChange={(event) => set({ severity: event.target.value as Severity })}><SeverityOptions /></select></Field><Field label={t('summary')} wide><input className={INPUT_CLASS} value={rule.summary} onChange={(event) => set({ summary: event.target.value })} /></Field><Field label={t('promqlExpression')} wide><textarea className={AREA_CLASS} value={rule.expression} onChange={(event) => set({ expression: event.target.value })} /></Field><Field label={t('description')} wide><textarea className={AREA_CLASS} value={rule.description} onChange={(event) => set({ description: event.target.value })} /></Field></CardContent></Card>;
}

export function ReceiverEditor({ receiver, onChange, onDelete }: { receiver: Receiver; onChange: (receiver: Receiver) => void; onDelete: () => void }) {
  const t = useTranslations('Alerts');
  const set = (patch: Partial<Receiver>) => onChange({ ...receiver, ...patch });
  return <Card><CardContent className="grid items-end gap-3 pt-4 md:grid-cols-2 lg:grid-cols-4"><Field label={t('receiverName')}><input className={INPUT_CLASS} value={receiver.receiverName} onChange={(event) => set({ receiverName: event.target.value })} /></Field><Field label={t('receivers')} wide><input className={INPUT_CLASS} type="url" value={receiver.endpoint} onChange={(event) => set({ endpoint: event.target.value })} /></Field><Field label={t('basicAuthUsername')}><input className={INPUT_CLASS} value={receiver.basicAuthUsername ?? ''} onChange={(event) => set({ basicAuthUsername: event.target.value })} /></Field><Field label={receiver.basicAuthPasswordSet ? t('basicAuthPasswordSet') : t('basicAuthPassword')}><input className={INPUT_CLASS} type="password" value={receiver.basicAuthPassword ?? ''} onChange={(event) => set({ basicAuthPassword: event.target.value })} /></Field><Field label={t('severityMatch')}><select className={INPUT_CLASS} value={receiver.severityMatch} onChange={(event) => set({ severityMatch: event.target.value as Match })}><option value="all">{t('all')}</option><SeverityOptions /></select></Field><div className="flex h-8 items-center gap-4"><label className="flex items-center gap-1.5 text-xs"><input type="checkbox" checked={receiver.sendResolved} onChange={(event) => set({ sendResolved: event.target.checked })} />{t('sendResolved')}</label><label className="flex items-center gap-1.5 text-xs"><input type="checkbox" checked={receiver.enabled} onChange={(event) => set({ enabled: event.target.checked })} />{t('enabled')}</label><Button variant="ghost" size="icon-sm" title={t('deleteReceiver')} aria-label={t('deleteReceiver')} onClick={onDelete}><Trash2 className="text-destructive" /></Button></div></CardContent></Card>;
}

function SeverityOptions() {
  const t = useTranslations('Alerts');
  return <><option value="critical">{t('critical')}</option><option value="warning">{t('warning')}</option><option value="info">{t('info')}</option></>;
}

function routeMatchText(match: Record<string, string>) {
  return Object.entries(match).map(([key, value]) => `${key}=${value}`).join(', ');
}

function parseRouteMatch(value: string) {
  return Object.fromEntries(value.split(',').map((item) => item.trim().split('=').map((part) => part.trim())).filter(([key, matchValue]) => key && matchValue));
}

export function ChildRouteEditor({ route, onChange, onDelete }: { route: AlertRoute; onChange: (route: AlertRoute) => void; onDelete: () => void }) {
  const t = useTranslations('Alerts');
  const set = (patch: Partial<AlertRoute>) => onChange({ ...route, ...patch });
  return <Card><CardHeader className="py-3"><CardTitle className="flex items-center justify-between text-sm"><span>{t('childRoute')}</span><Button variant="ghost" size="icon-sm" title={t('deleteRoute')} aria-label={t('deleteRoute')} onClick={onDelete}><Trash2 className="text-destructive" /></Button></CardTitle></CardHeader><CardContent className="grid gap-3 md:grid-cols-2 lg:grid-cols-4"><Field label={t('receiver')}><input className={INPUT_CLASS} value={route.receiver} onChange={(event) => set({ receiver: event.target.value })} /></Field><Field label={t('matchingLabels')} wide><input className={INPUT_CLASS} value={routeMatchText(route.match)} placeholder={t('matchingLabelsPlaceholder')} onChange={(event) => set({ match: parseRouteMatch(event.target.value) })} /></Field><Field label={t('groupByOptional')}><input className={INPUT_CLASS} value={route.groupBy?.join(', ') ?? ''} onChange={(event) => set({ groupBy: event.target.value.split(',').map((item) => item.trim()).filter(Boolean) || undefined })} /></Field><Field label={t('groupWaitOptional')}><input className={INPUT_CLASS} value={route.groupWait ?? ''} onChange={(event) => set({ groupWait: event.target.value || undefined })} /></Field><Field label={t('groupIntervalOptional')}><input className={INPUT_CLASS} value={route.groupInterval ?? ''} onChange={(event) => set({ groupInterval: event.target.value || undefined })} /></Field><Field label={t('repeatIntervalOptional')}><input className={INPUT_CLASS} value={route.repeatInterval ?? ''} onChange={(event) => set({ repeatInterval: event.target.value || undefined })} /></Field><label className="flex h-8 items-center gap-1.5 self-end text-xs"><input type="checkbox" checked={route.continue} onChange={(event) => set({ continue: event.target.checked })} />{t('continue')}</label></CardContent></Card>;
}
