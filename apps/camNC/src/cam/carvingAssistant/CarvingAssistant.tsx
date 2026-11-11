import { useId, useMemo, useRef, useState } from 'react';
import { Button } from '@wbcnc/ui/components/button';
import { LoadingSpinner } from '@wbcnc/ui/components/loading-spinner';
import { cn } from '@wbcnc/ui/lib/utils';
import { Sparkles } from 'lucide-react';
import type { CamJobV1 } from '../jobDb';
import { NumberInput } from '../NumberInput';
import { CarvePanelHeader } from '../carve/CarveTools';
import { ProviderSettings } from '../../cad/assistant/ProviderSettings';
import { connectionLabel } from '../../cad/assistant/connectionPresets';
import { RunSettings } from '../../cad/assistant/RunSettings';
import { NativeSvgSettings } from './NativeSvgSettings';
import { carvingDetailMm, type CarvingDetail, type PreparedCarvingArt } from './prepare';
import { sanitizeCarvingSvg } from './sanitize';
import { kVariantCounts, type CarvingStyle } from './session';
import type { CarvingAssistantSession } from './useCarvingAssistant';
import { VariantGrid } from './VariantGrid';
import './panel.css';

const kDetails: CarvingDetail[] = ['simple', 'balanced', 'detailed'];
const kDetailNames: Record<CarvingDetail, string> = { simple: 'Simple', balanced: 'Balanced', detailed: 'Detailed' };
const kIdeas = ['An owl reading a book', 'An oak leaf with its veins', 'Mountains at sunrise', 'A ship anchor with rope'];
const kIdeaNames = ['Owl', 'Leaf', 'Mountains', 'Anchor'];
const kSeg =
  'flex-1 rounded px-2 py-1 text-xs whitespace-nowrap text-muted-foreground aria-checked:bg-violet-500/15 aria-checked:text-violet-700 dark:aria-checked:text-violet-300';

/**
 * The AI artwork panel: connect once, describe, pick an idea and add it to the board. Everything happens here, top to
 * bottom, while the dashed box on the board (`CarvingAssistantBoardLayer`) sets where it goes and previews the pick.
 */
export function CarvingAssistant({ job, session, onClose }: { job: CamJobV1; session: CarvingAssistantSession; onClose: () => void }) {
  const id = useId();
  const { connection, current, shown, request } = session;
  const [settings, setSettings] = useState(false);
  const [advanced, setAdvanced] = useState(false);
  const pngInput = useRef<HTMLInputElement>(null);
  const prepared = current?.prepared;
  const report = prepared?.report;
  const problems = prepared?.problemAreas?.length ?? 0;
  const refinable = !!shown?.asset && connection.generationMode === 'text' && !!session.picked;
  const sourceVector = useMemo(() => {
    if (!shown?.asset) return null;
    try {
      return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(sanitizeCarvingSvg(shown.asset.svg))}`;
    } catch {
      return null;
    }
  }, [shown]);
  const applyLabel = session.applied ? 'Applied' : session.replace.on ? 'Replace on board' : 'Add to board';
  return (
    <div className="carving-assistant flex flex-1 flex-col gap-4">
      <CarvePanelHeader title="AI artwork" icon={<Sparkles className="size-4 text-violet-500" />} onClose={onClose} />
      <div className="flex flex-wrap items-center gap-2 rounded-md border border-dashed border-violet-500 p-2 text-xs text-muted-foreground">
        <span className="min-w-0 flex-1" title="Drag the box on the board to move it, or its corner to resize it.">
          Dashed box on the board
          <span className="block">
            {job.carving?.vBit.name} · deepest {job.carving?.maxDepth} mm
          </span>
        </span>
        <span className="flex items-center gap-1">
          {(['w', 'h'] as const).map((side, i) => (
            <span key={side} className="flex items-center gap-1">
              {i > 0 && '×'}
              <NumberInput
                id={`${id}-${side}`}
                aria-label={`Box ${side === 'w' ? 'width' : 'height'}`}
                className="h-7 w-14 px-1 text-xs"
                value={Math.round(session.target[side])}
                min={10}
                max={side === 'w' ? session.board.w : session.board.h}
                digits={0}
                onCommit={value => session.setTarget({ ...session.target, [side]: value })}
              />
            </span>
          ))}
          mm
        </span>
      </div>
      {connection.credentials && !settings ? (
        <div className="flex items-center gap-2 rounded-md bg-muted/60 px-3 py-2 text-xs">
          <span className="size-2 shrink-0 rounded-full bg-emerald-500" aria-hidden />
          <span className="min-w-0 flex-1 truncate">
            Connected · {connectionLabel(connection.credentials.config)}
            {connection.generationMode === 'native' && connection.sharedImageModel && !connection.separateImage
              ? ` · images by ${connection.sharedImageModel}, traced here`
              : ''}
          </span>
          <button type="button" className="underline" disabled={session.generating} onClick={() => setSettings(true)}>
            Change
          </button>
        </div>
      ) : (
        <div className="grid gap-1">
          <ProviderSettings
            value={connection.credentials}
            onSave={value => {
              connection.setCredentials(value);
              setSettings(!value);
            }}
          />
          {connection.credentials && (
            <Button variant="ghost" size="sm" className="justify-self-start" onClick={() => setSettings(false)}>
              Keep the current connection
            </Button>
          )}
        </div>
      )}
      {connection.credentials && connection.needsImageProvider && (
        <div className="grid gap-1.5 text-xs text-amber-700 dark:text-amber-300">
          <p>
            This connection can&rsquo;t make images. Connect an OpenAI key, or add an image provider under Advanced. Or draw the artwork as
            vectors with Text SVG.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" onClick={() => setAdvanced(true)}>
              Add an image provider
            </Button>
            <Button size="sm" variant="ghost" onClick={() => connection.setGenerationMode('text')}>
              Use Text SVG
            </Button>
          </div>
        </div>
      )}
      <form
        aria-label="Describe carving artwork"
        className="grid gap-3"
        onSubmit={event => {
          event.preventDefault();
          void request.generate(false);
        }}>
        <div className="grid gap-1.5">
          <label htmlFor={`${id}-prompt`} className="text-xs text-muted-foreground">
            What should it show?
          </label>
          <textarea
            id={`${id}-prompt`}
            rows={2}
            maxLength={4000}
            className="min-h-16 w-full resize-y rounded-md border bg-background p-2 text-sm"
            placeholder={refinable ? 'Describe a change, or a new idea' : 'e.g. an owl reading a book'}
            value={request.prompt}
            disabled={session.generating}
            onChange={event => request.setPrompt(event.target.value)}
            onKeyDown={event => {
              if (event.key !== 'Enter' || event.shiftKey) return;
              event.preventDefault();
              // Confirming an IME composition must not send a half-typed brief.
              if (event.nativeEvent.isComposing || event.keyCode === 229) return;
              if (request.canGenerate) event.currentTarget.form?.requestSubmit();
            }}
          />
          {!request.prompt.trim() && (
            <div className="flex flex-wrap gap-1" aria-label="Ideas">
              {kIdeas.map((idea, i) => (
                <button
                  key={idea}
                  type="button"
                  className="rounded-full border px-2 py-0.5 text-xs text-muted-foreground hover:text-foreground"
                  onClick={() => request.setPrompt(idea)}>
                  {kIdeaNames[i]}
                </button>
              ))}
            </div>
          )}
        </div>
        <div role="radiogroup" aria-label="Style" className="grid grid-cols-2 gap-2">
          {(['line', 'bold'] as const).map(value => (
            <StyleSwatch key={value} value={value} checked={request.style === value} onPick={() => request.setStyle(value)} />
          ))}
        </div>
        <div role="radiogroup" aria-label="Detail" className="flex gap-0.5 rounded-md border p-0.5">
          {kDetails.map(level => (
            <button
              key={level}
              type="button"
              role="radio"
              aria-checked={session.detail === level}
              title={`Smallest detail about ${carvingDetailMm[level]} mm`}
              className={kSeg}
              onClick={() => session.setDetail(level)}>
              {kDetailNames[level]}
            </button>
          ))}
        </div>
        <div className="flex gap-2">
          {session.generating ? (
            <Button type="button" variant="outline" className="flex-1" onClick={request.stop}>
              <LoadingSpinner className="size-3" /> Stop
            </Button>
          ) : (
            <>
              <Button type="submit" className="flex-1" disabled={!request.canGenerate}>
                {session.variants.length ? 'New ideas' : 'Generate'}
              </Button>
              {refinable && (
                <Button type="button" variant="outline" disabled={!request.canGenerate} onClick={() => void request.generate(true)}>
                  Refine picked
                </Button>
              )}
            </>
          )}
          <select
            aria-label="Variants"
            className="rounded-md border bg-background px-1 text-xs"
            value={request.count}
            onChange={event => request.setCount(Number(event.target.value))}>
            {kVariantCounts.map(n => (
              <option key={n} value={n}>
                {n} {n === 1 ? 'idea' : 'ideas'}
              </option>
            ))}
          </select>
        </div>
        <p className="text-xs text-muted-foreground">
          or{' '}
          <button type="button" className="underline" disabled={session.generating} onClick={() => pngInput.current?.click()}>
            trace your own image
          </button>{' '}
          (black and white PNG up to 2 MB, traced on this device)
        </p>
        <input
          ref={pngInput}
          type="file"
          accept="image/png,.png"
          aria-label="PNG image to trace"
          hidden
          onChange={event => {
            const file = event.target.files?.[0];
            event.target.value = '';
            if (file) void request.importPng(file);
          }}
        />
      </form>
      {session.replace.available && (
        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" checked={session.replace.on} onChange={event => session.replace.set(event.target.checked)} />
          Replace {session.replace.name}
        </label>
      )}
      {(session.preparing || session.status) && (
        <p role="status" className="text-sm">
          {session.preparing ? 'Preparing at this size…' : session.status}
        </p>
      )}
      {session.error && (
        <p role="alert" className="text-sm text-destructive">
          {session.error}
        </p>
      )}
      <VariantGrid session={session} />
      {current && report && (
        <div className="space-y-2">
          <p className="text-sm font-medium">{current.asset.title ?? 'Artwork'}</p>
          {report.ok && !current.refusal ? (
            <p className="rounded-md border border-emerald-600/40 bg-emerald-500/10 p-2 text-sm">
              Ready · {prepared.width.toFixed(0)} × {prepared.height.toFixed(0)} mm
              {problems
                ? ` · ${problems} thin or lost ${problems === 1 ? 'spot is' : 'spots are'} circled on the board`
                : ' · no thin spots'}
            </p>
          ) : (
            <ul className="list-disc rounded-md border border-amber-600/40 bg-amber-500/10 py-2 pr-2 pl-6 text-sm" aria-label="Problems">
              {[...report.errors, ...(current.refusal ? [current.refusal] : [])].map((message, i) => (
                <li key={i}>{message}</li>
              ))}
            </ul>
          )}
          {!!report.warnings.length && (
            <details>
              <summary className="cursor-pointer text-xs text-muted-foreground">
                {report.warnings.length} {report.warnings.length === 1 ? 'note' : 'notes'} from the checks
              </summary>
              <ul className="list-disc pl-5 text-xs">
                {report.warnings.map((message, i) => (
                  <li key={i}>{message}</li>
                ))}
              </ul>
            </details>
          )}
          {!!prepared.operations.length && <Toolpaths prepared={prepared} />}
          <p className="text-xs text-muted-foreground">
            Check the cut in Plan afterwards; the checks don&rsquo;t judge the subject or the wood.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button className="flex-1" disabled={!session.canApply} onClick={session.apply}>
              {applyLabel}
            </Button>
            <Button variant="outline" onClick={() => session.picked && session.discard(session.picked)}>
              Discard
            </Button>
          </div>
        </div>
      )}
      <details className="mt-auto" open={advanced} onToggle={event => setAdvanced(event.currentTarget.open)}>
        <summary className="cursor-pointer text-sm">Advanced</summary>
        <div className="space-y-3 pt-2">
          <fieldset disabled={session.generating} className="flex flex-wrap gap-x-4">
            <legend className="text-sm">Method</legend>
            <label>
              <input
                type="radio"
                name={`${id}-generator`}
                checked={connection.generationMode === 'native'}
                onChange={() => connection.setGenerationMode('native')}
              />{' '}
              {connection.sharedImageModel ? `Image model · ${connection.sharedImageModel}` : 'Image generation'}
            </label>
            <label>
              <input
                type="radio"
                name={`${id}-generator`}
                checked={connection.generationMode === 'text'}
                onChange={() => connection.setGenerationMode('text')}
              />{' '}
              Text SVG
            </label>
          </fieldset>
          {connection.generationMode === 'native' && (
            <>
              <p className="text-xs text-muted-foreground">
                {connection.sharedImageModel
                  ? 'Uses your connected key. The image is traced into filled regions on this device.'
                  : 'Your connection has no image model. Connect an OpenAI key, or enter an image provider below.'}
              </p>
              {connection.sharedImageModel && (
                <label className="flex items-start gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={connection.separateImage}
                    disabled={session.generating}
                    onChange={event => connection.setSeparateImage(event.target.checked)}
                  />
                  Use a different image provider
                </label>
              )}
              {connection.separateImage && (
                <NativeSvgSettings value={connection.native} disabled={session.generating} onChange={connection.setNative} />
              )}
            </>
          )}
          <RunSettings
            value={connection.runSettings}
            usage={connection.usage}
            disabled={session.generating}
            onChange={connection.setRunSettings}
          />
          {sourceVector && (
            <a className="inline-block text-sm underline" href={sourceVector} download="carving-source.svg">
              Download the source SVG
            </a>
          )}
        </div>
      </details>
    </div>
  );
}

/** Line art and bold shapes, shown as a small picture of each rather than in words alone. */
function StyleSwatch({ value, checked, onPick }: { value: CarvingStyle; checked: boolean; onPick: () => void }) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={checked}
      className={cn(
        'flex items-center gap-2 rounded-md border p-1.5 text-left text-xs',
        checked && 'border-violet-500 ring-2 ring-violet-500/25'
      )}
      onClick={onPick}>
      <svg viewBox="0 0 40 40" aria-hidden className="size-8 shrink-0 rounded bg-white p-1">
        {value === 'line' ? (
          <g fill="none" stroke="#111" strokeWidth={3} strokeLinejoin="round">
            <path d="M4 34L16 14l8 10 6-8 6 18z" />
            <circle cx="29" cy="9" r="4" />
          </g>
        ) : (
          <g fill="#111">
            <path d="M3 36L16 13l8 11 6-8 7 20z" />
            <circle cx="29" cy="8" r="5" />
          </g>
        )}
      </svg>
      {value === 'line' ? 'Line art' : 'Bold shapes'}
    </button>
  );
}

function Toolpaths({ prepared }: { prepared: PreparedCarvingArt }) {
  const pts = prepared.outline.flat();
  const x0 = Math.min(...pts.map(p => p.x)),
    x1 = Math.max(...pts.map(p => p.x)),
    y0 = Math.min(...pts.map(p => p.y)),
    y1 = Math.max(...pts.map(p => p.y));
  return (
    <details>
      <summary className="cursor-pointer text-xs text-muted-foreground">Cutting paths</summary>
      <svg
        role="img"
        aria-label="Checked carving toolpaths"
        className="max-h-48 w-full border bg-white"
        viewBox={`${x0 - 2} ${-y1 - 2} ${x1 - x0 + 4} ${y1 - y0 + 4}`}>
        {prepared.operations.map((operation, index) => (
          <path
            key={index}
            fill="none"
            stroke={operation.kind === 'vcarve' ? '#0369a1' : '#b45309'}
            strokeWidth={0.2}
            d={operation.passes.map(pass => pass.pts.map(([x, y], i) => `${i ? 'L' : 'M'}${x},${-y}`).join(' ')).join(' ')}
          />
        ))}
      </svg>
    </details>
  );
}
