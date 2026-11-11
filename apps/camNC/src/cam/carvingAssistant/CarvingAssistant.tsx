import { useId, useMemo, useRef, useState } from 'react';
import type { CamJobV1 } from '../jobDb';
import { NumberInput } from '../NumberInput';
import { ProviderSettings } from '../../cad/assistant/ProviderSettings';
import { connectionLabel } from '../../cad/assistant/connectionPresets';
import { RunSettings } from '../../cad/assistant/RunSettings';
import { NativeSvgSettings } from './NativeSvgSettings';
import { carvingDetailMm, type CarvingDetail, type PreparedCarvingArt } from './prepare';
import { sanitizeCarvingSvg } from './sanitize';
import type { CarvingAssistantSession } from './useCarvingAssistant';
import './panel.css';

const buttonClass = 'min-h-11 rounded-md border px-3 py-2 text-sm disabled:opacity-50';
const kDetails: CarvingDetail[] = ['simple', 'balanced', 'detailed'];
const kDetailNames: Record<CarvingDetail, string> = { simple: 'Simple', balanced: 'Balanced', detailed: 'Detailed' };

/**
 * The side panel of the carving assistant. Describing and choosing happen on the board (`CarvingAssistantBoardLayer`,
 * `CarvingAssistantPromptBar`); this panel shows the picked artwork's checks and applies it.
 */
export function CarvingAssistant({ job, session }: { job: CamJobV1; session: CarvingAssistantSession }) {
  const id = useId();
  const { connection, current, shown } = session;
  const [settings, setSettings] = useState(!connection.credentials);
  const pngInput = useRef<HTMLInputElement>(null);
  const carving = job.carving;
  const prepared = current?.prepared;
  const report = prepared?.report;
  const problems = prepared?.problemAreas?.length ?? 0;
  const sourceVector = useMemo(() => {
    if (!shown?.asset) return null;
    try {
      return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(sanitizeCarvingSvg(shown.asset.svg))}`;
    } catch {
      return null;
    }
  }, [shown]);
  return (
    <aside aria-label="Carving assistant" className="carving-assistant space-y-3 border-t pt-4">
      <h3 className="font-medium">Carving assistant</h3>
      <button
        type="button"
        className={buttonClass}
        disabled={session.generating}
        aria-expanded={settings}
        onClick={() => setSettings(!settings)}>
        {connection.credentials ? `Connected · ${connectionLabel(connection.credentials.config)} · Change` : 'Connect an AI provider'}
      </button>
      {settings && (
        <ProviderSettings
          value={connection.credentials}
          onSave={value => {
            connection.setCredentials(value);
            setSettings(!value);
          }}
        />
      )}
      {!session.variants.length && (
        <p className="text-sm text-muted-foreground">
          Describe the artwork in the bar under the board. The dashed box sets where it goes and how big it is: drag it, or its corner. Dark
          areas are carved.
        </p>
      )}
      <div className="grid grid-cols-2 gap-2">
        {(['w', 'h'] as const).map(side => (
          <div key={side} className="grid gap-1">
            <label htmlFor={`${id}-${side}`} className="text-xs text-muted-foreground">
              Box {side === 'w' ? 'width' : 'height'}
            </label>
            <NumberInput
              id={`${id}-${side}`}
              value={Math.round(session.target[side])}
              min={10}
              max={side === 'w' ? session.board.w : session.board.h}
              unit="mm"
              digits={0}
              onCommit={value => session.setTarget({ ...session.target, [side]: value })}
            />
          </div>
        ))}
      </div>
      <p className="text-xs text-muted-foreground">
        {carving?.vBit.name} · deepest {carving?.maxDepth} mm
      </p>
      {session.replace.available && (
        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" checked={session.replace.on} onChange={event => session.replace.set(event.target.checked)} />
          Replace {session.replace.name}
        </label>
      )}
      <div className="space-y-1">
        <label htmlFor={`${id}-detail`} className="text-sm">
          Detail
        </label>
        <input
          id={`${id}-detail`}
          type="range"
          min={0}
          max={2}
          step={1}
          className="w-full accent-violet-500"
          value={kDetails.indexOf(session.detail)}
          aria-valuetext={`${kDetailNames[session.detail]}, ${carvingDetailMm[session.detail]} mm`}
          onChange={event => session.setDetail(kDetails[Number(event.target.value)]!)}
        />
        <div className="flex justify-between text-xs text-muted-foreground">
          {kDetails.map(level => (
            <span key={level}>{kDetailNames[level]}</span>
          ))}
        </div>
      </div>
      <p role="status" className="text-sm">
        {session.preparing ? 'Preparing at this size…' : session.status}
      </p>
      {session.error && (
        <p role="alert" className="text-sm text-destructive">
          {session.error}
        </p>
      )}
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
            <button type="button" className={buttonClass} disabled={!session.canApply} onClick={session.apply}>
              {session.applied ? 'Applied' : 'Apply artwork'}
            </button>
            <button type="button" className={buttonClass} onClick={() => session.picked && session.discard(session.picked)}>
              Discard
            </button>
          </div>
        </div>
      )}
      <details>
        <summary className="cursor-pointer text-sm">More options</summary>
        <div className="space-y-3 pt-2">
          <button type="button" className={buttonClass} disabled={session.generating} onClick={() => pngInput.current?.click()}>
            Trace an image (PNG)
          </button>
          <input
            ref={pngInput}
            type="file"
            accept="image/png,.png"
            aria-label="PNG image to trace"
            hidden
            onChange={event => {
              const file = event.target.files?.[0];
              event.target.value = '';
              if (file) void session.request.importPng(file);
            }}
          />
          <p className="text-xs text-muted-foreground">Black and white line art, up to 2 MB. Tracing stays on this device.</p>
          <fieldset disabled={session.generating} className="flex flex-wrap gap-3">
            <legend className="text-sm">Artwork generator</legend>
            <label>
              <input
                type="radio"
                name={`${id}-generator`}
                checked={connection.generationMode === 'text'}
                onChange={() => connection.setGenerationMode('text')}
              />{' '}
              Text SVG
            </label>
            <label>
              <input
                type="radio"
                name={`${id}-generator`}
                checked={connection.generationMode === 'native'}
                onChange={() => connection.setGenerationMode('native')}
              />{' '}
              {connection.sharedImageModel ? `Image model · ${connection.sharedImageModel}` : 'Image generation'}
            </label>
          </fieldset>
          {connection.generationMode === 'native' && (
            <>
              <p className="text-xs text-muted-foreground">
                {connection.sharedImageModel
                  ? 'Uses your connected key. The image is traced into filled regions on this device.'
                  : 'Your connection has no image model. Connect an OpenAI key, or use a different image provider.'}
              </p>
              <label className="flex items-start gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={connection.separateImage}
                  disabled={session.generating}
                  onChange={event => connection.setSeparateImage(event.target.checked)}
                />
                Use a different image provider
              </label>
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
    </aside>
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
