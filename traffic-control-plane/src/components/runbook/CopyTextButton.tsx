'use client';

import { Check, Copy } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';

async function copyText(text: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    try {
      await Promise.race([
        navigator.clipboard.writeText(text),
        new Promise<never>((_, reject) => {
          window.setTimeout(() => reject(new Error('CLIPBOARD_TIMEOUT')), 1000);
        }),
      ]);
      return;
    } catch (error) {
      if (error instanceof Error && error.message === 'CLIPBOARD_TIMEOUT') throw error;
      // Fall through to the synchronous browser fallback when the API rejects immediately.
    }
  }

  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.setAttribute('readonly', '');
  textarea.style.position = 'fixed';
  textarea.style.opacity = '0';
  document.body.appendChild(textarea);
  textarea.select();
  const copied = document.execCommand('copy');
  textarea.remove();
  if (!copied) throw new Error('CLIPBOARD_UNAVAILABLE');
}

export default function CopyTextButton({ value }: { value: string }) {
  const t = useTranslations('Runbook');
  const [state, setState] = useState<'idle' | 'copied' | 'failed'>('idle');

  return (
    <button
      type="button"
      title={t('copyQueryTitle')}
      aria-label={t('copyQuery')}
      className="inline-flex size-7 shrink-0 items-center justify-center rounded-md border border-border bg-background text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      onClick={async () => {
        try {
          await copyText(value);
          setState('copied');
          window.setTimeout(() => setState('idle'), 1600);
        } catch {
          setState('failed');
          window.setTimeout(() => setState('idle'), 2200);
        }
      }}
    >
      {state === 'copied' ? <Check aria-hidden="true" className="size-3.5 text-emerald-600" /> : <Copy aria-hidden="true" className="size-3.5" />}
      <span className="sr-only" aria-live="polite">{state === 'copied' ? t('copied') : state === 'failed' ? t('copyFailed') : t('copyQuery')}</span>
    </button>
  );
}