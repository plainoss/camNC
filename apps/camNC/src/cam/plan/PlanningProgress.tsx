import { secondsLeft, timeLeftText, usePlanProgress } from '@/cam/planProgress';
import { LoadingSpinner } from '@wbcnc/ui/components/loading-spinner';
import { cn } from '@wbcnc/ui/lib/utils';
import { useEffect, useState } from 'react';

/**
 * "Computing toolpaths…" with how far it got and about how long the rest takes, while the board's plan is computed.
 * `after`: shown only once it has taken this long, ms, so a quick plan doesn't flash it.
 */
export function PlanningProgress({ boardId, after = 0, className }: { boardId: string; after?: number; className?: string }) {
  const progress = usePlanProgress(s => s[boardId]);
  // The estimate counts down between reports too.
  const [, tick] = useState(0);
  const running = !!progress;
  useEffect(() => {
    if (!running) return;
    const timer = setInterval(() => tick(n => n + 1), 500);
    return () => clearInterval(timer);
  }, [running]);
  if (after && (!progress || performance.now() - progress.startedAt < after)) return null;
  const percent = progress && Math.floor(progress.fraction * 100);
  const left = progress && secondsLeft(progress, performance.now());
  return (
    <div role="status" className={cn('flex w-64 max-w-full flex-col gap-2 text-sm text-muted-foreground', className)}>
      <div className="flex items-center gap-2">
        <LoadingSpinner className="size-4 shrink-0" />
        <span>Computing toolpaths…</span>
        {percent !== undefined && <span className="ml-auto tabular-nums">{percent}%</span>}
      </div>
      {progress && (
        <>
          <div
            role="progressbar"
            aria-label="Toolpaths computed"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={percent}
            className="h-1.5 overflow-hidden rounded-full bg-muted">
            <div className="h-full rounded-full bg-primary transition-[width] duration-300" style={{ width: `${percent}%` }} />
          </div>
          <span className="text-xs">{left === undefined ? 'Estimating the time left…' : timeLeftText(left)}</span>
        </>
      )}
    </div>
  );
}
