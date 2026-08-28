'use client';

import { useEffect, useRef, useState } from 'react';
import { CalendarDays, ChevronDown, ChevronLeft, ChevronRight, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { todayInShanghaiClient } from '@/components/runner/utils';

type DateCell = { date: string; day: number; inMonth: boolean };

interface DatePickerProps {
  value: string;
  selectedDates: string[];
  onChange: (value: string) => void;
  onAddDates: (dates: string[]) => void;
  className?: string;
}

export default function DatePicker({ value, selectedDates, onChange, onAddDates, className = '' }: DatePickerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [placement, setPlacement] = useState<'bottom' | 'top'>('bottom');
  const [rangeStart, setRangeStart] = useState<string | null>(null);
  const [rangeEnd, setRangeEnd] = useState<string | null>(null);
  const [visibleMonth, setVisibleMonth] = useState(() => startOfMonth(parseDateValue(value) ?? new Date()));
  const selectedDate = parseDateValue(value);
  const monthLabel = new Intl.DateTimeFormat('en-US', { month: 'long', year: 'numeric' }).format(visibleMonth);
  const dateCells = getCalendarCells(visibleMonth);
  const today = todayInShanghaiClient();
  const rangeDates = rangeStart
    ? getDateRange(rangeStart, rangeEnd ?? rangeStart)
    : selectedDate
      ? [value]
      : [];
  const allRangeDatesQueued = rangeDates.length > 0 && rangeDates.every((date) => selectedDates.includes(date));
  const rangeLabel = rangeEnd
    ? `${rangeDates.length} ${rangeDates.length === 1 ? 'day' : 'days'} selected`
    : rangeStart
      ? 'Choose an end date'
      : 'Select a day to add';
  const displayDate = rangeEnd && rangeDates.length > 1
    ? `${formatDateLabel(parseDateValue(rangeDates[0]))} - ${formatDateLabel(parseDateValue(rangeDates[rangeDates.length - 1]))}`
    : selectedDate
      ? formatDateLabel(selectedDate)
      : 'Choose a date';

  useEffect(() => {
    if (!open) return;
    const updatePlacement = () => {
      const container = containerRef.current;
      const popover = popoverRef.current;
      if (!container || !popover) return;

      const triggerRect = container.getBoundingClientRect();
      const popoverHeight = popover.getBoundingClientRect().height;
      const gap = 8;
      let topBoundary = 0;
      let bottomBoundary = window.innerHeight;
      let ancestor = container.parentElement;

      while (ancestor) {
        const overflowY = window.getComputedStyle(ancestor).overflowY;
        if (overflowY === 'auto' || overflowY === 'scroll' || overflowY === 'hidden' || overflowY === 'clip') {
          const ancestorRect = ancestor.getBoundingClientRect();
          topBoundary = Math.max(topBoundary, ancestorRect.top);
          bottomBoundary = Math.min(bottomBoundary, ancestorRect.bottom);
        }
        ancestor = ancestor.parentElement;
      }

      const spaceAbove = triggerRect.top - topBoundary - gap;
      const spaceBelow = bottomBoundary - triggerRect.bottom - gap;
      const nextPlacement = spaceBelow >= popoverHeight || spaceAbove <= spaceBelow ? 'bottom' : 'top';
      setPlacement((current) => current === nextPlacement ? current : nextPlacement);
    };

    updatePlacement();
    const closeOnOutsidePointer = (event: PointerEvent) => {
      if (event.target instanceof Node && !containerRef.current?.contains(event.target)) setOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', closeOnOutsidePointer);
    document.addEventListener('keydown', closeOnEscape);
    window.addEventListener('resize', updatePlacement);
    window.addEventListener('scroll', updatePlacement, true);
    return () => {
      document.removeEventListener('pointerdown', closeOnOutsidePointer);
      document.removeEventListener('keydown', closeOnEscape);
      window.removeEventListener('resize', updatePlacement);
      window.removeEventListener('scroll', updatePlacement, true);
    };
  }, [open]);

  const selectDate = (date: string) => {
    if (!rangeStart || rangeEnd) {
      setRangeStart(date);
      setRangeEnd(null);
    } else {
      setRangeEnd(date);
    }
    onChange(date);
    const parsedDate = parseDateValue(date);
    if (parsedDate) setVisibleMonth(startOfMonth(parsedDate));
  };

  const addSelectedDates = () => {
    if (rangeDates.length === 0 || allRangeDatesQueued) return;
    onAddDates(rangeDates);
    setRangeStart(null);
    setRangeEnd(null);
    setOpen(false);
  };

  const toggleOpen = () => {
    if (!open && selectedDate) setVisibleMonth(startOfMonth(selectedDate));
    setOpen((current) => !current);
  };

  return <div ref={containerRef} className={`relative ${className}`}>
    <button type="button" className="group flex min-h-11 w-full items-center gap-3 rounded-lg border border-border bg-background/55 px-3 text-left shadow-sm outline-none transition-colors hover:border-primary/45 hover:bg-background focus-visible:ring-2 focus-visible:ring-ring" aria-haspopup="dialog" aria-expanded={open} aria-label="Choose a date" onClick={toggleOpen}>
      <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary transition-colors group-hover:bg-primary/15"><CalendarDays className="size-4" /></span>
      <span className="min-w-0 flex-1">
        <span className="block text-[10px] font-medium uppercase tracking-[0.12em] text-muted-foreground">Date to add</span>
        <span className={`block truncate text-sm font-medium ${selectedDate ? 'text-foreground' : 'text-muted-foreground'}`}>{displayDate}</span>
      </span>
      <ChevronDown className={`size-4 shrink-0 text-muted-foreground transition-transform ${open ? 'rotate-180 text-primary' : ''}`} />
    </button>
    {open && <div ref={popoverRef} className={`absolute left-0 z-40 w-[min(22rem,calc(100vw-2rem))] overflow-hidden rounded-xl border border-border/80 bg-popover p-3 text-popover-foreground shadow-xl ${placement === 'top' ? 'bottom-[calc(100%+0.5rem)]' : 'top-[calc(100%+0.5rem)]'}`} role="dialog" aria-label="Choose a date">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div>
          <p className="text-[10px] font-medium uppercase tracking-[0.12em] text-muted-foreground">Calendar</p>
          <p className="text-sm font-semibold">{monthLabel}</p>
        </div>
        <div className="flex items-center gap-1">
          <button type="button" aria-label="Previous month" title="Previous month" className="flex size-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" onClick={() => setVisibleMonth((current) => new Date(current.getFullYear(), current.getMonth() - 1, 1))}><ChevronLeft className="size-4" /></button>
          <button type="button" aria-label="Next month" title="Next month" className="flex size-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" onClick={() => setVisibleMonth((current) => new Date(current.getFullYear(), current.getMonth() + 1, 1))}><ChevronRight className="size-4" /></button>
        </div>
      </div>
      <div className="grid grid-cols-7 gap-1 text-center" role="grid" aria-label={monthLabel}>
        {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((weekday) => <span key={weekday} className="pb-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground" role="columnheader">{weekday.slice(0, 1)}</span>)}
        {dateCells.map((cell) => {
          const isInRange = rangeDates.includes(cell.date);
          const isRangeStart = cell.date === rangeStart;
          const isRangeEnd = cell.date === (rangeEnd ?? rangeStart);
          const isQueued = selectedDates.includes(cell.date);
          const isToday = cell.date === today;
          return <button key={cell.date} type="button" role="gridcell" aria-label={`Select ${cell.date}`} aria-selected={isInRange} className={`relative flex aspect-square items-center justify-center rounded-md text-xs font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring ${cell.inMonth ? 'text-foreground' : 'text-muted-foreground/35'} ${isRangeStart || isRangeEnd ? 'bg-primary text-primary-foreground shadow-sm hover:bg-primary/90' : isInRange ? 'bg-primary/15 text-primary ring-1 ring-inset ring-primary/25 hover:bg-primary/25' : isQueued ? 'bg-primary/12 text-primary ring-1 ring-inset ring-primary/25 hover:bg-primary/20' : 'hover:bg-muted'}`} onClick={() => selectDate(cell.date)}>
            {cell.day}
            {isToday && !isRangeStart && !isRangeEnd && <span className="absolute bottom-1 size-1 rounded-full bg-primary" />}
          </button>;
        })}
      </div>
      <div className="mt-3 space-y-2 border-t border-border/70 pt-3">
        <div className="flex items-center justify-between gap-2">
          <button type="button" className="text-xs font-medium text-primary transition-colors hover:text-primary/75 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" onClick={() => selectDate(today)}>Today</button>
          <span className="text-[11px] text-muted-foreground">{allRangeDatesQueued ? 'Already queued' : rangeLabel}</span>
        </div>
        <Button size="sm" className="w-full" onClick={addSelectedDates} disabled={rangeDates.length === 0 || allRangeDatesQueued}><Plus />{allRangeDatesQueued ? 'Added' : rangeDates.length > 1 ? `Add ${rangeDates.length} days` : 'Add day'}</Button>
      </div>
    </div>}
  </div>;
}

function parseDateValue(value: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return date.getFullYear() === Number(match[1]) && date.getMonth() === Number(match[2]) - 1 && date.getDate() === Number(match[3]) ? date : null;
}

function startOfMonth(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

function toDateValue(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function formatDateLabel(date: Date | null): string {
  return date ? new Intl.DateTimeFormat('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' }).format(date) : 'Choose a date';
}

function getCalendarCells(month: Date): DateCell[] {
  const monthStart = startOfMonth(month);
  const firstWeekday = monthStart.getDay();
  return Array.from({ length: 42 }, (_, index) => {
    const date = new Date(monthStart.getFullYear(), monthStart.getMonth(), index - firstWeekday + 1);
    return { date: toDateValue(date), day: date.getDate(), inMonth: date.getMonth() === monthStart.getMonth() };
  });
}

function getDateRange(startValue: string, endValue: string): string[] {
  const start = parseDateValue(startValue);
  const end = parseDateValue(endValue);
  if (!start || !end) return [];

  const first = start <= end ? start : end;
  const last = start <= end ? end : start;
  const dates: string[] = [];
  for (const date = new Date(first); date <= last; date.setDate(date.getDate() + 1)) {
    dates.push(toDateValue(date));
  }
  return dates;
}

