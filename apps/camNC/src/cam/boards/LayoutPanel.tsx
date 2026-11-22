import { t as translate } from '@wbcnc/i18n';
import { Button } from '@wbcnc/ui/components/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@wbcnc/ui/components/dropdown-menu';
import { cn } from '@wbcnc/ui/lib/utils';
import { ChevronDown, Plus } from 'lucide-react';
import { Hint } from '../Hint';
import type { CamJobV1 } from '../jobDb';
import type { JobBoard } from '../useJobBoards';
import { StockList } from './StockList';
import { setupDiffers, setupSummary } from './globalSetup';

/** Auto-fill's objective: value, label, what it costs. */
const kObjectives = [
  ['boards', translate('Fewest boards'), translate('Fewer setups at the machine, may waste a bit more wood.')],
  ['wood', translate('Least wood'), translate('Least board area, may need more boards.')],
] as const;

type NestObjectiveKey = (typeof kObjectives)[number][0];

/** What's about all the boards: what you have to cut them from, and nesting the parts onto them. */
export function LayoutPanel({
  newBoardLabel,
  stock,
  objective,
  boards,
  selectedBoard,
  onStock,
  onObjective,
  onAutoFill,
  onRelayoutAll,
  onApplySetup,
  onNewBoard,
  onUndo,
}: {
  newBoardLabel: string;
  stock: CamJobV1['stock'] & {};
  objective: NestObjectiveKey;
  boards?: JobBoard[];
  selectedBoard?: JobBoard;
  onStock: (stock: CamJobV1['stock'] & {}) => void;
  onObjective: (objective: NestObjectiveKey) => void;
  onAutoFill: () => void;
  onRelayoutAll: () => void;
  onApplySetup?: (relayout: boolean) => void;
  onNewBoard: () => void;
  onUndo?: () => void;
}) {
  const differs = selectedBoard && boards && setupDiffers(selectedBoard, boards);
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto p-4">
      <h2 className="text-[15px] font-semibold">{translate('All boards')}</h2>
      <StockList stock={stock} onChange={onStock} />

      {selectedBoard && onApplySetup && (
        <section aria-label={translate('Spacing and holds across boards')} className="flex flex-col gap-2">
          <h3 className="text-[13px] font-semibold">{translate('Spacing & hold across boards')}</h3>
          <p className="text-xs text-muted-foreground">
            {translate('Board ')}
            {selectedBoard.board.name}: {setupSummary(selectedBoard.board, selectedBoard.nest)}
          </p>
          <div
            className={cn(
              'flex flex-col gap-2 rounded-md border p-2.5 text-xs',
              differs ? 'border-primary/50 bg-primary/5' : 'border-border bg-muted/20'
            )}>
            {differs && (
              <p className="font-medium text-foreground">
                {translate('Board ')}
                {selectedBoard.board.name}
                {translate(' has custom spacing or holds that other boards don’t use yet. ')}
              </p>
            )}
            <div className="flex flex-wrap gap-1.5">
              <Button size="sm" onClick={() => onApplySetup(true)}>
                {translate('Use ')}
                {selectedBoard.board.name}
                {translate('’s setup & re-layout all ')}
              </Button>
              <Button size="sm" variant="outline" onClick={() => onApplySetup(false)}>
                {translate('Apply without re-layout ')}
              </Button>
            </div>
          </div>
        </section>
      )}

      <section aria-label={translate('Auto-fill')} className="flex flex-col gap-2">
        <div className="flex">
          <Hint text={translate('Puts the parts on boards from your stock list. Parts you moved by hand stay where they are.')}>
            <Button size="sm" variant="outline" className="flex-1 rounded-r-none" onClick={onAutoFill}>
              {translate('Auto-fill from stock ')}
            </Button>
          </Hint>
          <DropdownMenu modal={false}>
            <Hint text={translate('More layout actions: re-lay out everything from scratch.')}>
              <DropdownMenuTrigger asChild>
                <Button
                  size="sm"
                  variant="outline"
                  className="rounded-l-none border-l-0 px-1.5"
                  aria-label={translate('More layout actions')}>
                  <ChevronDown />
                </Button>
              </DropdownMenuTrigger>
            </Hint>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onSelect={onRelayoutAll}>{translate('Re-lay out everything (unpin all)')}</DropdownMenuItem>
              {selectedBoard && onApplySetup && (
                <DropdownMenuItem onSelect={() => onApplySetup(true)}>
                  {translate('Use ')}
                  {selectedBoard.board.name}
                  {translate('’s setup & re-layout all ')}
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
        <span id="nest-objective-label" className="text-xs text-muted-foreground">
          {translate('Auto-fill prefers: ')}
        </span>
        <div
          role="group"
          aria-label={translate('Auto-fill optimizes for')}
          aria-describedby="nest-objective-label"
          className="flex self-start rounded-md border p-0.5 text-xs">
          {kObjectives.map(([value, label, hint]) => (
            <Hint key={value} text={hint}>
              <button
                aria-pressed={objective === value}
                onClick={() => onObjective(value)}
                className={cn(
                  'rounded px-2 py-1',
                  objective === value ? 'bg-muted font-medium' : 'text-muted-foreground hover:bg-muted/60'
                )}>
                {label}
              </button>
            </Hint>
          ))}
        </div>
        <p className="text-xs text-muted-foreground">{translate('Rectangle nesting for now. True-shape nesting is planned.')}</p>
      </section>
      <div className="flex gap-1.5">
        <Button size="sm" variant="outline" onClick={onNewBoard}>
          <Plus /> {newBoardLabel}
        </Button>
        <Button size="sm" variant="outline" disabled={!onUndo} onClick={onUndo}>
          {translate('Undo ')}
        </Button>
      </div>
    </div>
  );
}
