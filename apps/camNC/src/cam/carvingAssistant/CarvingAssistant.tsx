import { useEffect, useId, useMemo, useRef, useState } from 'react';
import type { CamJobV1 } from '../jobDb';
import { kCarvingBoard } from '../carving';
import { kDefaultPlan } from '../planSettings';
import { readAssistantCredentials, redactAssistantText } from '../../cad/assistant/keyStore';
import { ProviderSettings } from '../../cad/assistant/ProviderSettings';
import { RunSettings, type AssistantRunSettings } from '../../cad/assistant/RunSettings';
import { createAssistantUsage, type AssistantRunUsage } from '../../cad/assistant/runBudget';
import { generateCarvingAsset } from './generation';
import { carvingDetailMm, prepareCarvingArt, type CarvingDetail, type PreparedCarvingArt } from './prepare';
import { createCarvingProposal, savedCarvingEnvelope, type CarvingProposal } from './proposal';
import { sanitizeCarvingSvg } from './sanitize';
import { NativeSvgSettings, type NativeSvgConnection } from './NativeSvgSettings';
import { generateNativeSvgAsset } from './nativeSvg';
import { generateNativeRasterAsset } from './nativeRaster';
import { boundedCarvingRasterPreview, traceCarvingPng } from './rasterSource';
import type { CarvingGenerationOptions } from './generation';
import { ProposalBoardPreview } from './ProposalBoardPreview';
import './panel.css';
import { readCarvingPngAsset } from './pngImport';

type Asset = Awaited<ReturnType<typeof generateCarvingAsset>>['asset'];
const controlClass = 'min-h-11 w-full rounded-md border bg-background p-2 text-base';
const buttonClass = 'min-h-11 rounded-md border px-3 py-2 text-sm disabled:opacity-50';

export function CarvingAssistant({
  job,
  selectedId,
  disabled,
  onApply,
}: {
  job: CamJobV1;
  selectedId?: string | null;
  disabled?: boolean;
  onApply: (proposal: CarvingProposal) => void;
}) {
  const id = useId();
  const board = job.boards?.[0];
  const carving = job.carving;
  const selected = carving?.items.find(item => item.id === selectedId);
  const saved = selected?.generated;
  const boardSize = board?.size && !board.size.fit ? board.size : kCarvingBoard;
  const [credentials, setCredentials] = useState(readAssistantCredentials);
  const [settings, setSettings] = useState(!credentials);
  const [generationMode, setGenerationMode] = useState<'text' | 'native'>('text');
  const [native, setNative] = useState<NativeSvgConnection>({
    endpoint: 'https://api.openai.com/v1',
    model: '',
    key: '',
    quality: 'low',
    supportsSvg: false,
    format: 'png',
  });
  const [runSettings, setRunSettings] = useState<AssistantRunSettings>({ limits: {} });
  const usageTotal = useRef(createAssistantUsage());
  const [usage, setUsage] = useState<AssistantRunUsage | null>(null);
  const [prompt, setPrompt] = useState(saved?.prompt ?? '');
  const savedEnvelope = saved && savedCarvingEnvelope(saved, selected?.height);
  const [width, setWidth] = useState(String(savedEnvelope?.width ?? Math.min(100, boardSize.w)));
  const [height, setHeight] = useState(String(savedEnvelope?.height ?? selected?.height ?? Math.min(100, boardSize.h)));
  const [detail, setDetail] = useState<CarvingDetail>(saved?.detail ?? 'balanced');
  const [mode, setMode] = useState<'add' | 'replace'>(saved ? 'replace' : 'add');
  const [asset, setAsset] = useState<Asset | null>(() =>
    saved
      ? {
          id: saved.assetId,
          svg: saved.sourceSvg,
          prompt: saved.prompt,
          summary: saved.summary,
          title: 'Saved artwork',
          rasterPreview: saved.sourceRaster,
          warnings: saved.warnings,
        }
      : null
  );
  const [prepared, setPrepared] = useState<PreparedCarvingArt | null>(null);
  const [proposal, setProposal] = useState<CarvingProposal | null>(null);
  const [preparedFor, setPreparedFor] = useState('');
  const [acknowledged, setAcknowledged] = useState(false);
  const [running, setRunning] = useState(false);
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const controller = useRef<AbortController | null>(null);
  const pngInput = useRef<HTMLInputElement>(null);
  const mounted = useRef(true);
  const revision = useMemo(() => JSON.stringify([job.id, job.carving, job.boards, job.plan]), [job.id, job.carving, job.boards, job.plan]);
  const previousRevision = useRef(revision);
  const savedSelection = `${selectedId ?? ''}:${saved?.assetId ?? ''}:${selected?.height ?? ''}`;
  const previousSelection = useRef(savedSelection);
  const requestState = JSON.stringify([width, height, detail, mode, mode === 'replace' ? selectedId : null, prompt]);
  const latestState = useRef({ revision, requestState, disabled });
  latestState.current = { revision, requestState, disabled };

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      controller.current?.abort();
      controller.current = null;
    };
  }, []);
  useEffect(() => {
    if (previousSelection.current === savedSelection) return;
    previousSelection.current = savedSelection;
    if (!saved) return;
    controller.current?.abort();
    controller.current = null;
    setRunning(false);
    setAsset({
      id: saved.assetId,
      svg: saved.sourceSvg,
      prompt: saved.prompt,
      summary: saved.summary,
      title: 'Saved artwork',
      rasterPreview: saved.sourceRaster,
      warnings: saved.warnings,
    });
    setPrompt(saved.prompt);
    const envelope = savedCarvingEnvelope(saved, selected?.height);
    setWidth(String(envelope.width));
    setHeight(String(envelope.height));
    setDetail(saved.detail);
    setMode('replace');
    setPrepared(null);
    setProposal(null);
  }, [savedSelection, saved, selected?.height]);
  useEffect(() => {
    if (previousRevision.current === revision && !disabled) return;
    previousRevision.current = revision;
    controller.current?.abort();
    setRunning(false);
    setProposal(null);
    setAcknowledged(false);
    setStatus('The carving changed. Update the preview before applying.');
  }, [revision, disabled]);

  const stop = () => {
    controller.current?.abort();
    controller.current = null;
    setRunning(false);
    setStatus('Stopped. No artwork was applied.');
  };
  const importPng = async (file: File) => {
    if (controller.current || disabled) return;
    const abort = new AbortController();
    controller.current = abort;
    const start = { revision, requestState };
    const current = () =>
      !abort.signal.aborted &&
      !latestState.current.disabled &&
      latestState.current.revision === start.revision &&
      latestState.current.requestState === start.requestState;
    setRunning(true);
    setPrepared(null);
    setProposal(null);
    setAcknowledged(false);
    setError('');
    setStatus('Reading and tracing the PNG locally…');
    try {
      const next = await readCarvingPngAsset(
        file,
        { widthMm: Number(width), heightMm: Number(height), detail, minFeatureMm: carvingDetailMm[detail] },
        abort.signal
      );
      if (!current()) return;
      setAsset({ ...next, prompt: prompt.trim() || next.prompt });
      if (!prompt.trim()) setPrompt(next.prompt);
      setStatus('Image loaded; update preview locally.');
    } catch (cause) {
      if (current()) setError(cause instanceof Error ? cause.message : 'The PNG image could not be imported.');
    } finally {
      if (controller.current === abort) {
        controller.current = null;
        setRunning(false);
      }
    }
  };
  const run = async (generate: boolean) => {
    if (controller.current || disabled || !carving || !board) return;
    const w = Number(width),
      h = Number(height);
    if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0 || w > boardSize.w || h > boardSize.h) {
      setError('Enter a positive width and height that fit the board.');
      return;
    }
    if (
      generate &&
      (!prompt.trim() || (generationMode === 'text' ? !credentials : !native.key.trim() || !native.model.trim() || !native.supportsSvg))
    ) {
      setError('Connect your provider and describe the artwork.');
      return;
    }
    if (!generate && asset?.prompt !== prompt.trim()) {
      setError('Generate revised artwork to change the description. Local preparation only changes size and detail.');
      return;
    }
    if (mode === 'replace' && !selected) {
      setError('Select the artwork to replace, or choose Add artwork.');
      return;
    }
    const abort = new AbortController();
    controller.current = abort;
    const start = { revision, requestState };
    // Both provider and local geometry results are discarded after edits, Stop or unmount.
    const current = () =>
      !abort.signal.aborted &&
      !latestState.current.disabled &&
      latestState.current.revision === start.revision &&
      latestState.current.requestState === start.requestState;
    setRunning(true);
    setError('');
    setProposal(null);
    setPrepared(null);
    setAcknowledged(false);
    try {
      let source = asset;
      if (generate) {
        setStatus('Generating one artwork candidate…');
        const options: CarvingGenerationOptions = {
          prompt: prompt.trim(),
          constraints: { widthMm: w, heightMm: h, detail, minFeatureMm: carvingDetailMm[detail] },
          credentials:
            generationMode === 'native'
              ? {
                  key: native.key.trim(),
                  config: {
                    kind: 'compatible',
                    protocol: 'chat',
                    endpoint: native.endpoint,
                    model: native.model.trim(),
                    tools: true,
                    images: false,
                  },
                }
              : credentials!,
          signal: abort.signal,
          ...runSettings,
          usage: usageTotal.current,
          onUsage: value => {
            if (mounted.current) setUsage(value);
          },
          ...(asset && generationMode === 'text' && { previous: asset }),
        };
        const result =
          generationMode === 'native'
            ? await (native.format === 'png' ? generateNativeRasterAsset : generateNativeSvgAsset)(options, native)
            : await generateCarvingAsset(options);
        if (!current()) return;
        source = result.asset;
        setAsset(source);
      }
      if (!source) throw new Error('Generate artwork before updating its preview.');
      if (!generate && source.rasterPreview) {
        const raster = boundedCarvingRasterPreview(source.rasterPreview);
        if (!raster) throw new Error('The saved raster source is invalid or exceeds the image limits.');
        const traced = await traceCarvingPng(
          raster.slice(raster.indexOf(',') + 1),
          {
            widthMm: w,
            heightMm: h,
            detail,
            minFeatureMm: carvingDetailMm[detail],
          },
          abort.signal
        );
        if (!current()) return;
        source = { ...source, svg: traced.svg, warnings: traced.warnings, sourceOutline: traced.sourceOutline };
        setAsset(source);
      }
      setStatus('Preparing artwork at the requested size…');
      const next = await prepareCarvingArt({
        art: { kind: 'svg', svg: source.svg, fileName: 'Assistant artwork.svg' },
        width: w,
        height: h,
        detail,
        carving,
        board,
        clearTool: (job.plan ?? kDefaultPlan).bit,
        sourceOutline: source.sourceOutline,
        signal: abort.signal,
      });
      if (!current()) return;
      next.report.warnings.unshift(...(source.warnings ?? []));
      setPrepared(next);
      setPreparedFor(start.requestState);
      if (next.report.ok) {
        setProposal(
          createCarvingProposal(job, next, {
            mode,
            ...(mode === 'replace' && selectedId && { targetId: selectedId }),
            asset: source,
            detail,
          })
        );
        setStatus('Preview ready. Check the subject and remaining details before applying.');
      } else setStatus('This artwork needs changes before it can be applied.');
    } catch (cause) {
      if (current())
        setError(
          redactAssistantText(
            redactAssistantText(cause instanceof Error ? cause.message : 'Unable to prepare artwork.', credentials?.key ?? ''),
            native.key
          )
        );
    } finally {
      if (controller.current === abort) {
        controller.current = null;
        setRunning(false);
      }
    }
  };
  const fresh = preparedFor === requestState && !!proposal;
  const sourcePreview = useMemo(() => {
    if (!asset) return null;
    const raster = boundedCarvingRasterPreview(asset.rasterPreview);
    if (raster) return raster;
    try {
      return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(sanitizeCarvingSvg(asset.svg))}`;
    } catch {
      return null;
    }
  }, [asset]);
  const sourceVector = useMemo(() => {
    if (!asset) return null;
    try {
      return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(sanitizeCarvingSvg(asset.svg))}`;
    } catch {
      return null;
    }
  }, [asset]);
  const warnings = prepared?.report.warnings ?? [];
  const points = prepared?.outline.flat() ?? [];
  const bounds = points.length
    ? {
        x: Math.min(...points.map(p => p.x)),
        y: Math.min(...points.map(p => p.y)),
        w: Math.max(...points.map(p => p.x)) - Math.min(...points.map(p => p.x)),
        h: Math.max(...points.map(p => p.y)) - Math.min(...points.map(p => p.y)),
      }
    : null;
  return (
    <aside aria-label="Carving assistant" className="carving-assistant space-y-4 border-t pt-4">
      <h3 className="font-medium">Carving assistant</h3>
      <p className="text-sm text-muted-foreground">
        Describe an illustration for V-carving. Black areas are carved. Width and height set its maximum size.
      </p>
      <fieldset disabled={running} className="flex flex-wrap gap-3">
        <legend>Artwork generator</legend>
        <label>
          <input type="radio" name={`${id}-generator`} checked={generationMode === 'text'} onChange={() => setGenerationMode('text')} />{' '}
          Text SVG
        </label>
        <label>
          <input type="radio" name={`${id}-generator`} checked={generationMode === 'native'} onChange={() => setGenerationMode('native')} />{' '}
          Native image generation
        </label>
      </fieldset>
      {generationMode === 'native' ? (
        <NativeSvgSettings value={native} disabled={running} onChange={setNative} />
      ) : (
        <>
          <button type="button" className={buttonClass} disabled={running} aria-expanded={settings} onClick={() => setSettings(!settings)}>
            Provider connection
          </button>
          {settings && (
            <ProviderSettings
              value={credentials}
              onSave={value => {
                setCredentials(value);
                setSettings(!value);
              }}
            />
          )}
        </>
      )}
      <RunSettings value={runSettings} usage={usage} disabled={running} onChange={setRunSettings} />
      <p className="text-xs text-muted-foreground">
        Usage and budgets cover all generations while this panel is open. Local preview updates make no provider request.
      </p>
      <p className="text-sm">
        {carving?.vBit.name} · deepest {carving?.maxDepth} mm · {board?.material} · board {boardSize.w} × {boardSize.h} mm
      </p>
      <div className="space-y-2">
        <button type="button" className={buttonClass} disabled={running || disabled} onClick={() => pngInput.current?.click()}>
          Trace generated PNG
        </button>
        <input
          ref={pngInput}
          type="file"
          accept="image/png,.png"
          aria-label="Generated PNG file"
          hidden
          disabled={running || disabled}
          onChange={event => {
            const file = event.target.files?.[0];
            event.target.value = '';
            if (file) void importPng(file);
          }}
        />
        <p className="text-xs text-muted-foreground">
          Import black and white line art from your image generator. PNG up to 2 MB and four million pixels; tracing and preview updates
          stay local.
        </p>
      </div>
      <form
        aria-label="Generate carving artwork"
        className="space-y-3"
        onSubmit={event => {
          event.preventDefault();
          void run(true);
        }}>
        <fieldset disabled={running || disabled} className="space-y-3">
          <legend className="sr-only">Artwork request</legend>
          <label className="block" htmlFor={`${id}-prompt`}>
            Artwork description
          </label>
          <textarea
            id={`${id}-prompt`}
            name="prompt"
            className={controlClass}
            rows={3}
            required
            maxLength={4000}
            value={prompt}
            onChange={event => setPrompt(event.target.value)}
            placeholder="An owl reading a book"
          />
          <div className="grid grid-cols-2 gap-3">
            <label>
              Maximum width (mm)
              <input
                name="width"
                className={controlClass}
                type="number"
                required
                min="2"
                max={Math.min(500, boardSize.w)}
                step="any"
                value={width}
                onChange={event => setWidth(event.target.value)}
              />
            </label>
            <label>
              Maximum height (mm)
              <input
                name="height"
                className={controlClass}
                type="number"
                required
                min="2"
                max={Math.min(500, boardSize.h)}
                step="any"
                value={height}
                onChange={event => setHeight(event.target.value)}
              />
            </label>
          </div>
          <label className="block">
            Detail
            <select
              name="detail"
              className={controlClass}
              value={detail}
              onChange={event => setDetail(event.target.value as CarvingDetail)}>
              <option value="simple">Simple</option>
              <option value="balanced">Balanced</option>
              <option value="detailed">Detailed</option>
            </select>
          </label>
          <p className="text-xs text-muted-foreground">
            Detail target: {carvingDetailMm[detail]} mm. Presets are provisional; inspect the prepared artwork.
          </p>
          <label className="block">
            Placement
            <select name="mode" className={controlClass} value={mode} onChange={event => setMode(event.target.value as 'add' | 'replace')}>
              <option value="add">Add artwork</option>
              <option value="replace" disabled={!selected}>
                Replace selected artwork
              </option>
            </select>
          </label>
          <p className="text-sm text-muted-foreground">
            To change the subject or pose, edit the description and generate again. Size and detail can reuse the current artwork locally.
          </p>
          <div className="flex flex-wrap gap-2">
            <button
              type="submit"
              className={buttonClass}
              disabled={
                (generationMode === 'text' ? !credentials : !native.key.trim() || !native.model.trim() || !native.supportsSvg) ||
                !board ||
                !carving
              }>
              {generationMode === 'native' ? 'Generate new native artwork' : asset ? 'Generate revised artwork' : 'Generate artwork'}
            </button>
            {asset && (
              <button type="button" className={buttonClass} disabled={asset.prompt !== prompt.trim()} onClick={() => void run(false)}>
                Update preview locally
              </button>
            )}
          </div>
        </fieldset>
      </form>
      {running && (
        <button type="button" className={buttonClass} onClick={stop}>
          Stop
        </button>
      )}
      <p role="status" className="text-sm">
        {status}
      </p>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      {sourcePreview && (
        <figure>
          <img src={sourcePreview} alt="Original generated artwork" className="max-h-48 w-full border bg-white object-contain" />
          <figcaption className="text-xs">Original artwork</figcaption>
        </figure>
      )}
      {sourceVector && (
        <a className="inline-block text-sm underline" href={sourceVector} download="carving-source.svg">
          Download source SVG before detail cleanup
        </a>
      )}
      {prepared && (
        <div className="space-y-3">
          {proposal && fresh && <ProposalBoardPreview job={job} proposal={proposal} />}
          {bounds && (
            <>
              <figure>
                <svg
                  role="img"
                  aria-label="Prepared carving artwork"
                  className="max-h-64 w-full border bg-white"
                  viewBox={`${bounds.x - 2} ${-bounds.y - bounds.h - 2} ${bounds.w + 4} ${bounds.h + 4}`}>
                  <path
                    fill="black"
                    fillRule="nonzero"
                    d={prepared.outline
                      .map(loop => loop.map((point, i) => `${i ? 'L' : 'M'}${point.x},${-point.y}`).join(' ') + ' Z')
                      .join(' ')}
                  />
                </svg>
                <figcaption className="text-xs">Prepared cut regions · black is removed</figcaption>
              </figure>
              <figure>
                <svg
                  role="img"
                  aria-label="Checked carving toolpaths"
                  className="max-h-64 w-full border bg-white"
                  viewBox={`${bounds.x - 2} ${-bounds.y - bounds.h - 2} ${bounds.w + 4} ${bounds.h + 4}`}>
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
                <figcaption className="text-xs">Checked cutting paths · inspect the carved surface in Plan</figcaption>
              </figure>
            </>
          )}
          <p className="text-sm">
            {prepared.width.toFixed(1)} × {prepared.height.toFixed(1)} mm · minimum detail {prepared.report.minFeatureMm} mm
          </p>
          <p className="text-xs">
            Cut area removed by detail cleanup: {prepared.report.removedCutAreaMm2.toFixed(2)} mm² · narrow retained material flagged:{' '}
            {prepared.report.narrowLandAreaMm2.toFixed(2)} mm²
          </p>
          {!!prepared.report.errors.length && (
            <ul className="list-disc pl-5 text-sm">
              {prepared.report.errors.map((message, i) => (
                <li key={i}>{message}</li>
              ))}
            </ul>
          )}
          {!!warnings.length && (
            <>
              <ul className="list-disc pl-5 text-sm">
                {warnings.map((message, i) => (
                  <li key={i}>{message}</li>
                ))}
              </ul>
              <label className="flex items-start gap-2 text-sm">
                <input type="checkbox" checked={acknowledged} onChange={event => setAcknowledged(event.target.checked)} />I have reviewed
                these detail warnings.
              </label>
            </>
          )}
          {!fresh && <p className="text-sm">Update the preview for the current settings before applying.</p>}
          <p className="text-sm text-muted-foreground">
            Review the illustration, then check the cut in Plan. Geometry checks do not verify the subject or wood finish.
          </p>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className={buttonClass}
              disabled={disabled || running || !fresh || (!!warnings.length && !acknowledged)}
              onClick={() => {
                if (!proposal || !fresh) return;
                try {
                  onApply(proposal);
                  setProposal(null);
                  setPrepared(null);
                  setStatus('Artwork applied.');
                } catch (cause) {
                  setError(cause instanceof Error ? cause.message : 'The proposal could not be applied.');
                }
              }}>
              Apply artwork
            </button>
            <button
              type="button"
              className={buttonClass}
              disabled={running}
              onClick={() => {
                setPrepared(null);
                setProposal(null);
                setAcknowledged(false);
                setStatus('Preview discarded. No artwork was applied.');
              }}>
              Discard preview
            </button>
          </div>
        </div>
      )}
    </aside>
  );
}
