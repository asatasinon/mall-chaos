'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Check, ChevronDown } from 'lucide-react';

export function RunnerMetric({ title, value, mono = false }: { title: string; value: string; mono?: boolean }) {
  return <div className="rounded-md bg-muted/40 px-3 py-2.5"><p className="mb-1 text-[11px] text-muted-foreground">{title}</p><p className={`text-lg font-semibold tabular-nums ${mono ? 'font-mono text-sm' : ''}`}>{value}</p></div>;
}

export function RunnerTabButton({ active, children, onClick }: { active: boolean; children: ReactNode; onClick: () => void }) {
  return <button type="button" role="tab" aria-selected={active} className={`relative inline-flex items-center gap-1 px-1 py-2 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 ${active ? 'text-foreground after:absolute after:inset-x-0 after:-bottom-px after:h-0.5 after:bg-primary' : 'text-muted-foreground hover:text-foreground'}`} onClick={onClick}>{children}</button>;
}

export function ModeButton({ active, children, onClick }: { active: boolean; children: ReactNode; onClick: () => void }) {
  return <button type="button" onClick={onClick} className={`inline-flex h-8 items-center justify-center gap-1.5 rounded-md px-2 text-xs font-medium transition-colors ${active ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}>{children}</button>;
}

export function NumberField({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return <label className="space-y-1"><span className="text-xs text-muted-foreground">{label}</span><input type="number" min="0" max="100" value={value} onChange={(event) => onChange(event.target.value)} className="h-8 w-full rounded-md border border-border bg-input px-2 text-sm outline-none focus:ring-1 focus:ring-ring" /></label>;
}

export function SelectField({ label, value, options, onChange }: { label: string; value: string; options: string[]; onChange: (value: string) => void }) {
  return <label className="space-y-1"><span className="text-xs text-muted-foreground">{label}</span><select value={value} onChange={(event) => onChange(event.target.value)} className="h-8 w-full rounded-md border border-border bg-input px-2 text-sm outline-none focus:ring-1 focus:ring-ring">{options.map((option) => <option key={option} value={option}>{option}s</option>)}</select></label>;
}

const TABLE_OPTIONS = [
  { value: 'user_behavior_log', label: 'user_behavior_log', description: 'Customer activity partitions' },
  { value: 'product_price_history', label: 'product_price_history', description: 'Historical price snapshots' },
];

export function TableSelect({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const selected = TABLE_OPTIONS.find((option) => option.value === value);

  useEffect(() => {
    if (!open) return;
    const closeOnOutsidePointer = (event: PointerEvent) => {
      if (event.target instanceof Node && !containerRef.current?.contains(event.target)) setOpen(false);
    };
    document.addEventListener('pointerdown', closeOnOutsidePointer);
    return () => document.removeEventListener('pointerdown', closeOnOutsidePointer);
  }, [open]);

  return <div ref={containerRef} className="relative">
    <button type="button" className="flex h-8 w-full items-center justify-between rounded-md border border-border bg-input px-2.5 text-left text-sm outline-none transition-colors hover:bg-muted/50 focus-visible:ring-2 focus-visible:ring-ring" aria-haspopup="listbox" aria-expanded={open} onClick={() => setOpen((current) => !current)} onKeyDown={(event) => { if (event.key === 'Escape') setOpen(false); }}>
      <span className={selected ? 'truncate text-foreground' : 'truncate text-muted-foreground'}>{selected?.label || value}</span>
      <ChevronDown className={`ml-2 size-4 shrink-0 text-muted-foreground transition-transform ${open ? 'rotate-180' : ''}`} />
    </button>
    {open && <div className="absolute left-0 right-0 top-10 z-30 overflow-hidden rounded-md border border-border bg-popover p-1.5 text-popover-foreground shadow-lg" role="listbox" aria-label="Target tables">
      {TABLE_OPTIONS.map((option) => <button key={option.value} type="button" role="option" aria-selected={option.value === value} className="provider-option flex w-full items-center justify-between rounded px-2 py-2 text-left" onClick={() => { onChange(option.value); setOpen(false); }}>
        <span className="min-w-0"><span className="block truncate text-sm font-medium">{option.label}</span><span className="provider-option-detail block truncate text-[11px]">{option.description}</span></span>
        {option.value === value && <Check className="provider-option-check ml-3 size-4 shrink-0" />}
      </button>)}
    </div>}
  </div>;
}
