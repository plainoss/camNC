import { useEffect, useMemo, useRef, useState } from 'react';
import type { CamJobV1 } from '../jobDb';
import { nativeImageFromConnection } from '../../cad/assistant/modelDefaults';
import { readAssistantCredentials, redactAssistantText, type AssistantCredentials } from '../../cad/assistant/keyStore';
import type { AssistantRunSettings } from '../../cad/assistant/RunSettings';
import { createAssistantUsage, type AssistantRunUsage } from '../../cad/assistant/runBudget';
import { generateCarvingAsset, type CarvingGenerationOptions, type GeneratedCarvingAsset } from './generation';
import { generateNativeSvgAsset } from './nativeSvg';
import { generateNativeRasterAsset } from './nativeRaster';
import { readCarvingPngAsset } from './pngImport';
import { carvingDetailMm, type CarvingDetail } from './prepare';
import type { NativeSvgConnection } from './NativeSvgSettings';
import type { CarvingProposal } from './proposal';
import {
  boardSize,
  clampTarget,
  initialTarget,
  preparationKey,
  prepareVariant,
  traceKey,
  variantBrief,
  type CarvingStyle,
  type CarvingTarget,
  type CarvingVariant,
} from './session';

const kMaxVariants = 8;
/** Size and detail changes wait this long before preparing again, so a drag or a slider settles first. */
const kPrepareDelayMs = 250;

/**
 * The carving assistant's state, shared by the box on the board, the prompt bar under it and the side panel.
 * Generated sources are kept across job edits; only their preparation and placement are redone for the job as it is now.
 */
export function useCarvingAssistant({
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
  const board = boardSize(job);
  const selected = job.carving?.items.find(item => item.id === selectedId);
  const [open, setOpen] = useState(false);
  const [credentials, setCredentials] = useState<AssistantCredentials | null>(readAssistantCredentials);
  // Image generation is the default: traced images carve smoother than drawn vectors. A connection without an image
  // model needs a separate image provider for it; text SVG stays one click away.
  const [generationMode, setGenerationMode] = useState<'text' | 'native'>('native');
  // A separate image provider is an override; normally the connection's own key and image model are used.
  const [separateImage, setSeparateImage] = useState(false);
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
  const [prompt, setPrompt] = useState('');
  const [style, setStyle] = useState<CarvingStyle>('line');
  const [count, setCount] = useState<number>(4);
  const [target, setTargetState] = useState<CarvingTarget>(() => initialTarget(job, selectedId).target);
  const [replace, setReplace] = useState(false);
  const [detail, setDetail] = useState<CarvingDetail>('balanced');
  const [variants, setVariants] = useState<CarvingVariant[]>([]);
  const [picked, setPicked] = useState<string | null>(null);
  const [hover, setHover] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);
  const [preparing, setPreparing] = useState(false);
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const generation = useRef<AbortController | null>(null);
  const preparation = useRef<AbortController | null>(null);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      generation.current?.abort();
      preparation.current?.abort();
    };
  }, []);

  const mode: 'add' | 'replace' = replace && selected ? 'replace' : 'add';
  const key = preparationKey(job, target, detail, mode, selectedId);
  const setTarget = (next: CarvingTarget) => setTargetState(clampTarget(next, board));
  const pickedVariant = variants.find(variant => variant.id === picked);
  // The last preparation stays on show while the next one runs; only a fresh one can be applied.
  const current = pickedVariant?.result;
  const fresh = current?.key === key;
  // The proposal would put back exactly what is already there.
  const applied =
    !!fresh &&
    mode === 'replace' &&
    !!selected?.generated &&
    current?.proposal?.item.generated?.assetId === selected.generated.assetId &&
    current.proposal.item.generated?.checkedFor === selected.generated.checkedFor &&
    current.proposal.item.generated?.detail === selected.generated.detail &&
    JSON.stringify(current.proposal.item.outline) === JSON.stringify(selected.outline);
  const latest = useRef({ key, disabled });
  latest.current = { key, disabled };

  // Opening, or selecting generated artwork, starts from that artwork's saved source, size and detail: no provider needed.
  const savedSelection = `${open}:${selectedId ?? ''}:${selected?.generated?.assetId ?? ''}:${selected?.height ?? ''}`;
  const previousSelection = useRef('');
  useEffect(() => {
    if (!open || previousSelection.current === savedSelection) return;
    previousSelection.current = savedSelection;
    const start = initialTarget(job, selectedId);
    setTargetState(start.target);
    setReplace(start.replace);
    const saved = selected?.generated;
    if (!saved) return;
    const variant: CarvingVariant = {
      id: `saved-${saved.assetId}`,
      status: 'ready',
      asset: {
        id: saved.assetId,
        svg: saved.sourceSvg,
        prompt: saved.prompt,
        summary: saved.summary,
        title: 'Saved artwork',
        rasterPreview: saved.sourceRaster,
        warnings: saved.warnings,
      },
    };
    // Just applied from a variant still in the strip: pick that one rather than showing the same artwork twice.
    const same = variants.find(item => item.asset?.id === saved.assetId);
    if (same) setPicked(same.id);
    else {
      setVariants(list => [variant, ...list.filter(item => item.id !== variant.id)].slice(0, kMaxVariants));
      setPicked(variant.id);
    }
    setPrompt(saved.prompt);
    setDetail(saved.detail);
    // savedSelection names everything this reads from the job.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [savedSelection]);

  const prepare = async (variant: CarvingVariant, forKey: string, at: CarvingTarget) => {
    preparation.current?.abort();
    const abort = new AbortController();
    preparation.current = abort;
    setPreparing(true);
    setError('');
    try {
      const result = await prepareVariant({ job, variant, target: at, detail, mode, targetId: selectedId, signal: abort.signal });
      // Edits, Stop and unmount all discard a late preparation.
      if (abort.signal.aborted || !mounted.current || latest.current.key !== forKey) return;
      setVariants(list => list.map(item => (item.id === variant.id ? { ...item, result } : item)));
    } catch (cause) {
      if (!abort.signal.aborted && mounted.current) setError(cause instanceof Error ? cause.message : 'Unable to prepare this artwork.');
    } finally {
      if (preparation.current === abort) {
        preparation.current = null;
        if (mounted.current) setPreparing(false);
      }
    }
  };
  // The picked artwork follows the box, the detail slider and job edits by itself; nothing to press.
  useEffect(() => {
    if (!open || !pickedVariant?.asset || pickedVariant.result?.key === key || disabled) return;
    const timer = setTimeout(() => void prepare(pickedVariant, key, target), kPrepareDelayMs);
    return () => clearTimeout(timer);
    // prepare reads the state named here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, picked, pickedVariant?.asset, key, disabled]);

  const shared = nativeImageFromConnection(credentials, native.quality);
  const hasSharedImages = !!shared;
  const modeChosen = useRef(false);
  const chooseMode = (mode: 'text' | 'native') => {
    modeChosen.current = true;
    setGenerationMode(mode);
  };
  // Saved artwork is revised with Text SVG, so reopening it on a connection without images starts there.
  useEffect(() => {
    if (open && selected?.generated && !hasSharedImages && !separateImage && !modeChosen.current) setGenerationMode('text');
  }, [open, selected?.generated, hasSharedImages, separateImage]);
  // Shared images always take the traced PNG route; SVG output needs the explicit opt-in of the separate form.
  // Without an image model on the connection, the separate image provider is the only way to images.
  const useSeparateImage = separateImage || !shared;
  const nativeConfig: NativeSvgConnection =
    !useSeparateImage && shared ? { ...native, ...shared, supportsSvg: true, format: 'png' } : native;
  const credentialsFor = (): AssistantCredentials | null =>
    generationMode === 'native'
      ? nativeConfig.key.trim() && nativeConfig.model.trim() && nativeConfig.supportsSvg
        ? {
            key: nativeConfig.key.trim(),
            config: {
              kind: 'compatible',
              protocol: 'chat',
              endpoint: nativeConfig.endpoint,
              model: nativeConfig.model.trim(),
              tools: true,
              images: false,
            },
          }
        : null
      : credentials;
  const canGenerate = !!credentialsFor() && !!prompt.trim() && !disabled && !generating;

  const redact = (text: string) => redactAssistantText(redactAssistantText(text, credentials?.key ?? ''), native.key);
  const generate = async (refine: boolean) => {
    const using = credentialsFor();
    if (!using || !prompt.trim() || generation.current || disabled) {
      if (!using) setError('Connect an AI provider first.');
      return;
    }
    const n = refine ? 1 : count;
    const abort = new AbortController();
    generation.current = abort;
    const at = target,
      forDetail = detail;
    const ids = Array.from({ length: n }, () => crypto.randomUUID());
    const previous = refine && generationMode === 'text' ? pickedVariant?.asset : undefined;
    setVariants(list => [...ids.map(id => ({ id, status: 'generating' as const })), ...list].slice(0, kMaxVariants));
    setGenerating(true);
    setError('');
    setStatus(n > 1 ? `Generating ${n} variants…` : 'Generating artwork…');
    const one = async (id: string, index: number) => {
      const options: CarvingGenerationOptions = {
        prompt: variantBrief(prompt, style, index, n),
        constraints: { widthMm: at.w, heightMm: at.h, detail: forDetail, minFeatureMm: carvingDetailMm[forDetail] },
        credentials: using,
        signal: abort.signal,
        ...runSettings,
        usage: usageTotal.current,
        onUsage: value => {
          if (mounted.current) setUsage(value);
        },
        ...(previous && { previous }),
      };
      try {
        const result =
          generationMode === 'native'
            ? await (nativeConfig.format === 'png' ? generateNativeRasterAsset : generateNativeSvgAsset)(options, nativeConfig)
            : await generateCarvingAsset(options);
        if (abort.signal.aborted || !mounted.current) return;
        const asset: GeneratedCarvingAsset = { ...result.asset, prompt: prompt.trim() };
        const variant: CarvingVariant = {
          id,
          status: 'ready',
          asset,
          ...(asset.rasterPreview && { tracedFor: traceKey(at, forDetail) }),
        };
        setVariants(list => list.map(item => (item.id === id ? variant : item)));
        setPicked(was => (refine ? id : (was ?? id)));
      } catch (cause) {
        if (abort.signal.aborted || !mounted.current) return;
        const message = redact(cause instanceof Error ? cause.message : 'The artwork could not be generated.');
        setVariants(list => list.map(item => (item.id === id ? { id, status: 'failed', error: message } : item)));
        setError(message);
      }
    };
    // Spending limits are checked between requests, so a capped run asks one variant at a time.
    const capped = runSettings.limits.maxCostUsd !== undefined || runSettings.limits.maxTotalTokens !== undefined;
    try {
      if (capped) for (const [index, id] of ids.entries()) await one(id, index);
      else await Promise.all(ids.map(one));
    } finally {
      if (generation.current === abort) {
        generation.current = null;
        if (mounted.current) {
          setGenerating(false);
          setStatus(abort.signal.aborted ? 'Stopped. No artwork was applied.' : '');
        }
      }
    }
  };
  const stop = () => {
    generation.current?.abort();
    preparation.current?.abort();
    setVariants(list => list.filter(item => item.status !== 'generating'));
    setGenerating(false);
    setPreparing(false);
    setStatus('Stopped. No artwork was applied.');
  };
  const importPng = async (file: File) => {
    if (generation.current || disabled) return;
    const abort = new AbortController();
    generation.current = abort;
    setGenerating(true);
    setError('');
    setStatus('Tracing the image on this device…');
    const constraints = { widthMm: target.w, heightMm: target.h, detail, minFeatureMm: carvingDetailMm[detail] };
    try {
      const asset = await readCarvingPngAsset(file, constraints, abort.signal);
      if (abort.signal.aborted || !mounted.current) return;
      const variant: CarvingVariant = {
        id: crypto.randomUUID(),
        status: 'ready',
        asset: { ...asset, prompt: prompt.trim() || asset.prompt },
        tracedFor: traceKey(target, detail),
      };
      if (!prompt.trim()) setPrompt(asset.prompt);
      setVariants(list => [variant, ...list].slice(0, kMaxVariants));
      setPicked(variant.id);
      setStatus('');
    } catch (cause) {
      if (!abort.signal.aborted && mounted.current)
        setError(cause instanceof Error ? cause.message : 'The PNG image could not be imported.');
    } finally {
      if (generation.current === abort) {
        generation.current = null;
        if (mounted.current) setGenerating(false);
      }
    }
  };
  const apply = () => {
    const proposal = fresh ? current?.proposal : null;
    if (!proposal || disabled || preparing) return;
    try {
      onApply(proposal);
      // The Carve step confirms the edit, with its Undo, as it closes the panel.
      setStatus('');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The proposal could not be applied.');
    }
  };
  const discard = (id: string) => {
    setVariants(list => list.filter(item => item.id !== id));
    if (picked === id) setPicked(null);
  };

  const shown = variants.find(variant => variant.id === (hover ?? picked));
  const ghost = useMemo(
    () =>
      shown?.result?.key === key ? { outline: shown.result.prepared.outline, problems: shown.result.prepared.problemAreas ?? [] } : null,
    [shown, key]
  );
  return {
    open,
    setOpen,
    board,
    connection: {
      credentials,
      setCredentials,
      generationMode,
      setGenerationMode: chooseMode,
      native,
      // Details typed into the provider form while it is the only way to images stay in use after reconnecting.
      setNative: (value: NativeSvgConnection) => {
        if (!shared) setSeparateImage(true);
        setNative(value);
      },
      sharedImageModel: shared?.model,
      separateImage: useSeparateImage,
      setSeparateImage,
      /** Images need a key and model first: the connection has none, and the separate provider isn't filled in. */
      needsImageProvider: generationMode === 'native' && !shared && !credentialsFor(),
      runSettings,
      setRunSettings,
      usage,
    },
    request: { prompt, setPrompt, style, setStyle, count, setCount, canGenerate, generate, importPng, stop },
    target,
    setTarget,
    replace: {
      available: !!selected,
      on: mode === 'replace',
      set: setReplace,
      name: selected && selected.art.kind === 'svg' ? selected.art.fileName : 'the selected item',
    },
    detail,
    setDetail,
    variants,
    picked,
    pick: setPicked,
    hover,
    setHover,
    shown,
    ghost,
    current,
    generating,
    preparing,
    status,
    error,
    apply,
    discard,
    fresh,
    applied,
    canApply: fresh && !applied && !!current?.proposal && !disabled && !preparing,
  };
}

export type CarvingAssistantSession = ReturnType<typeof useCarvingAssistant>;
