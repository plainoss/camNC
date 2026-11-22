import { t as translate } from '@wbcnc/i18n';
import { Button } from '@wbcnc/ui/components/button';
import { cn } from '@wbcnc/ui/lib/utils';
import { Image, Sparkles, Trash2, Type } from 'lucide-react';
import { itemName, type CarvingItemV1 } from '@/cam/carving';
import { CarvePanelHeader } from './CarveTools';

/** Everything on the board, to pick or delete an item that is hard to reach there. */
export function CarveItemsPanel({
  items,
  selectedId,
  onSelect,
  onDelete,
  onClose,
}: {
  items: CarvingItemV1[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onDelete: (id: string) => void;
  onClose: () => void;
}) {
  return (
    <>
      <CarvePanelHeader title={translate('Items')} onClose={onClose} />
      {items.length ? (
        <ul aria-label={translate('Items')} className="grid gap-1">
          {items.map(item => (
            <li key={item.id} className={cn('flex items-center rounded-md', selectedId === item.id && 'bg-muted')}>
              <button
                className="flex min-w-0 flex-1 items-center gap-2 px-2 py-2 text-left"
                aria-pressed={selectedId === item.id}
                onClick={() => onSelect(item.id)}>
                {item.generated ? (
                  <Sparkles className="size-4 shrink-0 text-violet-500" />
                ) : item.art.kind === 'text' ? (
                  <Type className="size-4 shrink-0" />
                ) : (
                  <Image className="size-4 shrink-0" />
                )}
                <span className="truncate">{itemName(item)}</span>
              </button>
              <Button
                variant="ghost"
                size="icon"
                aria-label={translate('Delete {{value1}}', { value1: itemName(item) })}
                onClick={() => onDelete(item.id)}>
                <Trash2 />
              </Button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-muted-foreground">
          {translate('Nothing on the board yet. Add lettering, an SVG file or AI artwork from the toolbar.')}
        </p>
      )}
      {items.length > 0 && !selectedId && (
        <p className="text-xs text-muted-foreground">{translate('Select an item to edit it on the board.')}</p>
      )}
    </>
  );
}
