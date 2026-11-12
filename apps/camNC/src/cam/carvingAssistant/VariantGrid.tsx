import { useMemo } from 'react';
import { cn } from '@wbcnc/ui/lib/utils';
import { sanitizeCarvingSvg } from './sanitize';
import { boundedCarvingRasterPreview } from './rasterSource';
import type { CarvingVariant } from './session';
import type { CarvingAssistantSession } from './useCarvingAssistant';

/** The generated ideas to pick from. Hovering one previews it in the box on the board. */
export function VariantGrid({ session }: { session: CarvingAssistantSession }) {
  if (!session.variants.length) return null;
  return (
    <div role="listbox" aria-label="Artwork variants" className="grid grid-cols-2 gap-2">
      {session.variants.map((variant, index) => (
        <VariantThumb key={variant.id} variant={variant} index={index} session={session} />
      ))}
    </div>
  );
}

function VariantThumb({ variant, index, session }: { variant: CarvingVariant; index: number; session: CarvingAssistantSession }) {
  const src = useMemo(() => {
    const asset = variant.asset;
    if (!asset) return null;
    const raster = boundedCarvingRasterPreview(asset.rasterPreview);
    if (raster) return raster;
    try {
      return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(sanitizeCarvingSvg(asset.svg))}`;
    } catch {
      return null;
    }
  }, [variant.asset]);
  const selected = session.picked === variant.id;
  const label = variant.asset?.title ?? `Variant ${index + 1}`;
  return (
    <button
      type="button"
      role="option"
      aria-selected={selected}
      aria-label={variant.status === 'generating' ? `Variant ${index + 1}, generating` : label}
      title={variant.error ?? variant.asset?.summary}
      disabled={variant.status !== 'ready'}
      className={cn(
        'grid aspect-square place-items-center rounded-lg border-2 bg-white p-1.5',
        selected ? 'border-violet-500 ring-2 ring-violet-500/40' : 'border-transparent',
        variant.status === 'generating' && 'animate-pulse bg-muted motion-reduce:animate-none',
        variant.status === 'failed' && 'bg-destructive/10 text-xs text-destructive'
      )}
      onMouseEnter={() => session.setHover(variant.id)}
      onMouseLeave={() => session.setHover(null)}
      onFocus={() => session.setHover(variant.id)}
      onBlur={() => session.setHover(null)}
      onClick={() => session.pick(variant.id)}>
      {variant.status === 'failed' ? 'Failed' : src ? <img src={src} alt="" className="max-h-full max-w-full object-contain" /> : null}
    </button>
  );
}
