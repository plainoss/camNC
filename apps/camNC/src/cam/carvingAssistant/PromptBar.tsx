import { useMemo } from 'react';
import { Button } from '@wbcnc/ui/components/button';
import { LoadingSpinner } from '@wbcnc/ui/components/loading-spinner';
import { cn } from '@wbcnc/ui/lib/utils';
import { Sparkles } from 'lucide-react';
import { sanitizeCarvingSvg } from './sanitize';
import { boundedCarvingRasterPreview } from './rasterSource';
import { kVariantCounts, type CarvingVariant } from './session';
import type { CarvingAssistantSession } from './useCarvingAssistant';

const chip = 'rounded-full border px-2.5 py-0.5 text-xs';

/** Floats under the board: what to carve, in which style and how many variants, and the variants to choose from. */
export function CarvingAssistantPromptBar({ session }: { session: CarvingAssistantSession }) {
  const { request, variants, picked, generating } = session;
  const refinable = !!session.shown?.asset && session.connection.generationMode === 'text' && !!picked;
  return (
    <div className="pointer-events-none absolute inset-x-3 bottom-3 flex flex-col items-center gap-2">
      {variants.length > 0 && (
        <div
          role="listbox"
          aria-label="Artwork variants"
          className="pointer-events-auto flex max-w-full gap-2 overflow-x-auto rounded-xl border bg-background/95 p-2 shadow-lg">
          {variants.map((variant, index) => (
            <VariantThumb key={variant.id} variant={variant} index={index} session={session} />
          ))}
        </div>
      )}
      <form
        aria-label="Describe carving artwork"
        className="pointer-events-auto flex w-full max-w-xl flex-wrap items-center gap-2 rounded-xl border bg-background/95 p-2 shadow-lg"
        onSubmit={event => {
          event.preventDefault();
          void request.generate(false);
        }}>
        <Sparkles className="size-4 shrink-0 text-violet-500" aria-hidden />
        <label className="sr-only" htmlFor="carving-assistant-prompt">
          Artwork description
        </label>
        <input
          id="carving-assistant-prompt"
          className="min-w-40 flex-1 bg-transparent text-sm outline-none"
          placeholder={refinable ? 'Describe a change, or a new idea' : 'What should the carving show? e.g. an owl reading a book'}
          maxLength={4000}
          value={request.prompt}
          disabled={generating}
          onChange={event => request.setPrompt(event.target.value)}
          onKeyDown={event => {
            // Confirming an IME composition must not send a half-typed brief.
            if (event.key === 'Enter' && (event.nativeEvent.isComposing || event.keyCode === 229)) event.preventDefault();
          }}
        />
        <div role="radiogroup" aria-label="Style" className="flex gap-1">
          {(['line', 'bold'] as const).map(value => (
            <button
              key={value}
              type="button"
              role="radio"
              aria-checked={request.style === value}
              className={cn(
                chip,
                request.style === value ? 'border-violet-500 text-violet-600 dark:text-violet-300' : 'text-muted-foreground'
              )}
              onClick={() => request.setStyle(value)}>
              {value === 'line' ? 'Line art' : 'Bold shapes'}
            </button>
          ))}
        </div>
        <label className="flex items-center gap-1 text-xs text-muted-foreground">
          Variants
          <select
            className="rounded border bg-background px-1 py-0.5"
            value={request.count}
            onChange={event => request.setCount(Number(event.target.value))}>
            {kVariantCounts.map(n => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </label>
        {generating ? (
          <Button type="button" size="sm" variant="outline" onClick={request.stop}>
            <LoadingSpinner className="size-3" /> Stop
          </Button>
        ) : (
          <>
            {refinable && (
              <Button type="button" size="sm" variant="outline" disabled={!request.canGenerate} onClick={() => void request.generate(true)}>
                Refine picked
              </Button>
            )}
            <Button type="submit" size="sm" disabled={!request.canGenerate}>
              {variants.length ? 'New ideas' : 'Generate'}
            </Button>
          </>
        )}
      </form>
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
        'grid size-20 shrink-0 place-items-center rounded-lg border-2 bg-white p-1',
        selected ? 'border-violet-500 ring-2 ring-violet-500/40' : 'border-transparent',
        variant.status === 'generating' && 'animate-pulse bg-muted',
        variant.status === 'failed' && 'bg-destructive/10 text-[10px] text-destructive'
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
