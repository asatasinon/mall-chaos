'use client';

import { useTranslations } from 'next-intl';
import { useEffect, useId, useRef, useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/button';

type ConfirmDialogProps = {
  title: string;
  description: string;
  cancelLabel?: string;
  destructive?: boolean;
  confirmVariant?: 'default' | 'destructive';
  onConfirm: () => void | Promise<void>;
  onCancel: () => void;
};

export default function ConfirmDialog({ title, description, cancelLabel = 'Cancel', destructive = false, confirmVariant, onConfirm, onCancel }: ConfirmDialogProps) {
  const confirmButtonRef = useRef<HTMLButtonElement>(null);
  const cancelButtonRef = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  const descriptionId = useId();
  const [pending, setPending] = useState(false);
  const t = useTranslations('Common');
  const resolvedConfirmVariant = confirmVariant ?? (destructive ? 'destructive' : 'default');
  const resolvedCancelLabel = cancelLabel ?? t('cancel');

  useEffect(() => {
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    cancelButtonRef.current?.focus();
    return () => previousFocus?.focus();
  }, []);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !pending) {
        event.preventDefault();
        onCancel();
        return;
      }
      if (event.key !== 'Tab') return;
      const focusable = [cancelButtonRef.current, confirmButtonRef.current]
        .filter((button): button is HTMLButtonElement => button !== null && !button.disabled);
      if (focusable.length === 0) return;
      const currentIndex = focusable.indexOf(document.activeElement as HTMLButtonElement);
      if (event.shiftKey && (currentIndex <= 0)) {
        event.preventDefault();
        focusable[focusable.length - 1]?.focus();
      } else if (!event.shiftKey && (currentIndex === focusable.length - 1 || currentIndex === -1)) {
        event.preventDefault();
        focusable[0]?.focus();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [onCancel, pending]);

  const handleConfirm = async () => {
    if (pending) return;
    setPending(true);
    try {
      await onConfirm();
    } finally {
      setPending(false);
    }
  };

  return <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4 backdrop-blur-[2px]" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !pending) onCancel(); }}>
    <div className="w-full max-w-[28rem] overflow-hidden rounded-xl border border-border/80 bg-card shadow-[0_24px_80px_rgb(20_20_19_/_0.24)]" role="dialog" aria-modal="true" aria-labelledby={titleId} aria-describedby={descriptionId} onMouseDown={(event) => event.stopPropagation()}>
      <div className={`h-1 ${destructive ? 'bg-destructive' : 'bg-primary'}`} />
      <div className="flex gap-3.5 px-6 pb-6 pt-5">
        <span className={`flex size-10 shrink-0 self-start items-center justify-center rounded-full border ${destructive ? 'border-destructive/20 bg-destructive/10 text-destructive' : 'border-primary/20 bg-primary/10 text-primary'}`}><AlertTriangle className="size-[18px]" /></span>
        <div className="min-w-0 pt-0.5">
          <h2 id={titleId} className="text-[15px] font-semibold leading-5">{title}</h2>
          <p id={descriptionId} className="mt-2 text-[13px] leading-5 text-muted-foreground">{description}</p>
        </div>
      </div>
      <div className="flex justify-end gap-2 border-t border-border/80 bg-background/25 px-6 py-3.5">
        <Button ref={cancelButtonRef} variant="outline" onClick={onCancel} disabled={pending}>{resolvedCancelLabel}</Button>
        <Button ref={confirmButtonRef} variant={resolvedConfirmVariant} className={resolvedConfirmVariant === 'destructive' ? 'bg-destructive text-[#141413] hover:bg-destructive/85' : undefined} onClick={() => void handleConfirm()} disabled={pending}>{pending ? t('working') : t('confirm')}</Button>
      </div>
    </div>
  </div>;
}