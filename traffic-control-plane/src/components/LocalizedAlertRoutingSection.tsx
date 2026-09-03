'use client';

import { useTranslations } from 'next-intl';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ChildRouteEditor, Field } from '@/components/LocalizedAlertEditors';
import type { AlertConfig, AlertRoute } from '@/components/alerts/types';
import { DRAFT_WRAPPER_CLASS, INPUT_CLASS } from '@/components/alerts/types';

export default function LocalizedAlertRoutingSection({ config, cardRef, onChange }: { config: AlertConfig; cardRef: (index: number, element: HTMLDivElement | null) => void; onChange: (route: AlertConfig['route']) => void }) {
  const t = useTranslations('Alerts');
  const set = (patch: Partial<AlertConfig['route']>) => onChange({ ...config.route, ...patch });
  const updateChild = (index: number, child: AlertRoute) => set({ routes: config.route.routes.map((item, i) => i === index ? child : item) });
  return <div className="space-y-3"><div><h2 className="text-base font-semibold">{t('routesAndGrouping')}</h2><p className="text-xs text-muted-foreground">{t('routesAndGroupingHelp')}</p></div><Card><CardHeader className="py-3"><CardTitle className="text-sm">{t('defaultRoutesAndGrouping')}</CardTitle></CardHeader><CardContent className="grid gap-3 md:grid-cols-2 lg:grid-cols-5"><Field label={t('defaultReceiver')}><input className={INPUT_CLASS} value={config.route.receiver} onChange={(event) => set({ receiver: event.target.value })} /></Field><Field label={t('groupByCommaSeparated')} wide><input className={INPUT_CLASS} value={config.route.groupBy.join(', ')} onChange={(event) => set({ groupBy: event.target.value.split(',').map((item) => item.trim()).filter(Boolean) })} /></Field><Field label="group_wait"><input className={INPUT_CLASS} value={config.route.groupWait} onChange={(event) => set({ groupWait: event.target.value })} /></Field><Field label="group_interval"><input className={INPUT_CLASS} value={config.route.groupInterval} onChange={(event) => set({ groupInterval: event.target.value })} /></Field><Field label="repeat_interval"><input className={INPUT_CLASS} value={config.route.repeatInterval} onChange={(event) => set({ repeatInterval: event.target.value })} /></Field></CardContent></Card>{config.route.routes.map((route, index) => <div key={index} ref={(element) => cardRef(index, element)} tabIndex={-1} className={route.isDraft ? DRAFT_WRAPPER_CLASS : ''}><ChildRouteEditor route={route} onChange={(next) => updateChild(index, next)} onDelete={() => set({ routes: config.route.routes.filter((_, i) => i !== index) })} /></div>)}</div>;
}
