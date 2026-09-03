'use client';

import { useTheme } from 'next-themes';
import { useTranslations } from 'next-intl';
import { useEffect, useId, useState } from 'react';

type MermaidDiagramProps = {
  source: string;
  label: string;
};

type RenderState = 'loading' | 'ready' | 'error';
type RenderedDiagram = {
  diagramId: string;
  source: string;
  theme: 'dark' | 'default';
  state: Exclude<RenderState, 'loading'>;
  svg: string | null;
};

function stableDiagramId(reactId: string): string {
  const normalized = reactId.replace(/[^a-zA-Z0-9_-]/gu, '');
  return `runbook-diagram-${normalized || 'diagram'}`;
}

export default function MermaidDiagram({ source, label }: MermaidDiagramProps) {
  const t = useTranslations('Runbook');
  const { resolvedTheme } = useTheme();
  const reactId = useId();
  const diagramId = stableDiagramId(reactId);
  const theme = resolvedTheme === 'dark' ? 'dark' : 'default';
  const [rendered, setRendered] = useState<RenderedDiagram | null>(null);
  const currentRender = rendered?.diagramId === diagramId
    && rendered.source === source
    && rendered.theme === theme
    ? rendered
    : null;
  const state: RenderState = currentRender?.state ?? 'loading';
  const svg = currentRender?.svg ?? null;
  const captionId = `${diagramId}-caption`;

  useEffect(() => {
    let cancelled = false;

    const renderDiagram = async () => {
      try {
        const mermaidModule = await import('mermaid');
        const mermaid = mermaidModule.default;
        if (cancelled) return;

        mermaid.initialize({
          startOnLoad: false,
          securityLevel: 'strict',
          htmlLabels: false,
          theme,
        });
        const result = await mermaid.render(diagramId, source);
        if (cancelled) return;
        setRendered({ diagramId, source, theme, state: 'ready', svg: result.svg });
      } catch {
        if (cancelled) return;
        setRendered({ diagramId, source, theme, state: 'error', svg: null });
      }
    };

    void renderDiagram();
    return () => {
      cancelled = true;
    };
  }, [diagramId, source, theme]);

  return (
    <figure className="runbook-mermaid" aria-labelledby={captionId}>
      <figcaption id={captionId} className="runbook-mermaid__caption">{label}</figcaption>
      {state === 'ready' && svg ? (
        <div className="runbook-mermaid__viewport" dangerouslySetInnerHTML={{ __html: svg }} />
      ) : (
        <div className="runbook-mermaid__fallback" role={state === 'error' ? 'alert' : 'status'} aria-live="polite">
          <p className="runbook-mermaid__status">{state === 'error' ? t('mermaidError') : t('mermaidLoading')}</p>
          <pre className="runbook-mermaid__source"><code>{source}</code></pre>
        </div>
      )}
    </figure>
  );
}