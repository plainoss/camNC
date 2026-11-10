import { cadFaceFrame, cadVariableScope, type CadDocument, type CadDrawnOn } from '@wbcnc/cad';
import { useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { Box3, Vector3 } from 'three';
import type { SectionOffsetControl } from '@/cam/model/SectionOffsetHandle';
import type { ModelFacePick, ViewRequest } from '@/cam/model/ModelViewport';
import type { AssemblyModel } from './assemblyModel';
import { basePlaneViews, pickedPlaneFrame } from './basePlanes';
import { parseCadValue } from './valueExpressions';
import type { SectionPlane } from './sectionGeometry';

type Vec3 = [number, number, number];
export interface SectionFrame {
  origin: Vec3;
  normal: Vec3;
  x: Vec3;
  y: Vec3;
}
type Source = { kind: 'plane'; id: string } | { kind: 'face'; frame: SectionFrame; label: string; document: CadDocument };
interface State {
  source: Source | null;
  offset: string;
  flipped: boolean;
  editing: boolean;
  picking: boolean;
}
interface SelectionHistory {
  selection: string;
  generation: number;
}

function trackSelection(history: SelectionHistory, selection: string) {
  if (history.selection !== selection) {
    history.selection = selection;
    history.generation++;
  }
  return history.generation;
}

function faceFrame(point: Vec3, normal: Vec3): SectionFrame {
  const n = new Vector3(...normal).normalize();
  const up = Math.abs(n.z) > 0.9 ? new Vector3(0, 1, 0) : new Vector3(0, 0, 1);
  const x = up.cross(n).normalize(),
    y = n.clone().cross(x).normalize();
  return { origin: point, normal: n.toArray(), x: x.toArray(), y: y.toArray() };
}

/** A section is temporary inspection state; no document, feature, history or CAM setting is changed. */
export function useStudioSection(
  document: CadDocument,
  model: AssemblyModel,
  frame: RefObject<HTMLDivElement | null>,
  enabled: boolean,
  onViewRequest?: (request: Omit<ViewRequest, 'seq'>) => void,
  selectedPlane?: string | null,
  selectedFace?: Extract<CadDrawnOn['on'], { partId: string }> | null
) {
  const [state, setState] = useState<State | null>(null);
  const [pickProblem, setPickProblem] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const dragInitial = useRef<string | null>(null);
  const dragScope = useRef<{ document: CadDocument; source: Source | null | undefined } | null>(null);
  const accepted = useRef<{ state: State; generation: number } | null>(null);
  const selection = JSON.stringify([selectedPlane ?? null, selectedFace ?? null]);
  const selectionHistory = useRef<SelectionHistory>({ selection, generation: 0 });
  useEffect(() => {
    // Deselecting and reselecting the same source is a fresh selection, even though its final value is unchanged.
    trackSelection(selectionHistory.current, selection);
  }, [selection]);
  const scope = useMemo(() => cadVariableScope(document), [document]);
  const source = state?.source;
  const sourceFrame = useMemo(() => {
    if (!source) return null;
    if (source.kind === 'plane') return pickedPlaneFrame(document, source.id);
    // A picked tessellated face has no persistent topology ID. Require a new pick after the design changes.
    return source.document === document ? source.frame : null;
  }, [source, document]);
  const offset = useMemo(() => parseCadValue(state?.offset ?? '0', { unit: 'mm', variables: scope }), [state?.offset, scope]);
  const offsetProblem = 'error' in offset ? offset.error : null;
  const reason =
    pickProblem ??
    (!source
      ? 'Pick a plane or a planar face for the section.'
      : !sourceFrame
        ? 'The selected plane or face changed. Pick it again.'
        : offsetProblem);
  const active = state !== null,
    flipped = state?.flipped ?? false,
    editing = state?.editing ?? false;
  const plane = useMemo<SectionPlane | null>(() => {
    if (!active || !sourceFrame || 'error' in offset) return null;
    return {
      origin: sourceFrame.origin.map((value, axis) => value + sourceFrame.normal[axis]! * offset.value) as Vec3,
      normal: sourceFrame.normal.map(value => (flipped ? -value : value)) as Vec3,
    };
  }, [sourceFrame, offset, flipped, active]);
  const modelCenter = useMemo(() => {
    const box = new Box3(),
      point = new Vector3();
    for (const mesh of model.meshes)
      for (let i = 0; i < mesh.positions.length; i += 3) box.expandByPoint(point.fromArray(mesh.positions, i));
    return box.getCenter(point).toArray();
  }, [model.meshes]);
  const setOffset = (offset: string) => setState(previous => (previous ? { ...previous, offset } : previous));
  const moveOffset = (offset: number) => {
    if (Number.isFinite(offset)) setOffset(String(offset));
  };
  const cancelDrag = () => {
    const initial = dragInitial.current;
    dragInitial.current = null;
    dragScope.current = null;
    setDragging(false);
    if (initial !== null) setOffset(initial);
  };
  const focus = () => frame.current?.focus({ preventScroll: true });
  const turnOff = () => {
    dragInitial.current = null;
    dragScope.current = null;
    setDragging(false);
    setState(null);
    setPickProblem(null);
    focus();
  };
  const start = () => {
    if (!enabled) return;
    const remembered = accepted.current;
    const generation = trackSelection(selectionHistory.current, selection);
    // Keep the accepted view through off/on, but honor a newly selected source for a fresh command.
    if (remembered && ((!selectedPlane && !selectedFace) || remembered.generation === generation)) {
      const source = remembered.state.source;
      const available = source?.kind === 'plane' ? !!pickedPlaneFrame(document, source.id) : source?.document === document;
      setState({ ...remembered.state, editing: true, picking: !available });
      setPickProblem(null);
      return;
    }
    let source: Source | null = selectedPlane && pickedPlaneFrame(document, selectedPlane) ? { kind: 'plane', id: selectedPlane } : null;
    if (!source && selectedFace) {
      const placement = model.placements.get(selectedFace.partId);
      const placed = placement
        ? { ...document, parts: document.parts.map(part => (part.id === selectedFace.partId ? { ...part, placement } : part)) }
        : document;
      const picked = cadFaceFrame(placed, selectedFace);
      if (!('error' in picked))
        source = {
          kind: 'face',
          frame: picked,
          label: `${model.instances.find(item => item.partId === selectedFace.partId)?.name ?? 'Selected'} face`,
          document,
        };
    }
    setState({ source, offset: '0', flipped: false, editing: true, picking: !source });
    setPickProblem(null);
  };
  const toggle = () => (state ? turnOff() : start());
  const pickPlane = (id: string) => {
    if (!state?.editing || !pickedPlaneFrame(document, id)) return false;
    setState({ ...state, source: { kind: 'plane', id }, picking: false, offset: '0', flipped: false });
    setPickProblem(null);
    return true;
  };
  const pickFace = (pick: ModelFacePick) => {
    if (!state?.editing || !state.picking) return;
    if (pick.sectionCap) return setPickProblem('Pick a model face rather than the temporary cut surface.');
    const instance = model.instances[pick.index];
    const point = pick.surfacePoint ?? pick.point;
    if (!instance || !point.every(Number.isFinite) || !pick.normal.every(Number.isFinite) || Math.hypot(...pick.normal) < 1e-9) return;
    setState({
      ...state,
      source: { kind: 'face', frame: faceFrame(point, pick.normal), label: `${instance.name} face`, document },
      offset: '0',
      flipped: false,
      picking: false,
    });
    setPickProblem(null);
  };
  const normal = () => {
    if (plane && sourceFrame) onViewRequest?.({ name: 'normal', direction: plane.normal, up: sourceFrame.y });
  };
  useEffect(() => {
    if (!enabled) {
      const initial = dragInitial.current;
      dragInitial.current = null;
      dragScope.current = null;
      setDragging(false);
      setState(previous => (previous ? { ...previous, offset: initial ?? previous.offset, editing: false, picking: false } : previous));
    }
  }, [enabled]);
  useEffect(() => {
    // A removed handle must release its preview latch before a late captured event can edit a different interaction.
    if (
      dragInitial.current === null ||
      (plane && editing && sourceFrame && dragScope.current?.document === document && dragScope.current.source === source)
    )
      return;
    const initial = dragInitial.current;
    const sameSource = dragScope.current?.source === source;
    const changedDocument = dragScope.current?.document !== document;
    dragInitial.current = null;
    dragScope.current = null;
    setDragging(false);
    if (sameSource && changedDocument) setState(previous => (previous ? { ...previous, offset: initial } : previous));
  }, [sourceFrame, source, document, plane, editing]);
  useEffect(() => {
    const host = frame.current?.closest('.cad-editor') ?? frame.current;
    if (!host || !enabled) return;
    const key = (event: Event) => {
      const keyboard = event as KeyboardEvent;
      if (keyboard.repeat || keyboard.ctrlKey || keyboard.metaKey || keyboard.altKey || keyboard.isComposing || keyboard.keyCode === 229)
        return;
      if (keyboard.key === 'Escape' && dragInitial.current !== null) {
        keyboard.preventDefault();
        keyboard.stopPropagation();
        cancelDrag();
        return;
      }
      if (
        event.target instanceof Element &&
        event.target.closest('input, textarea, select, [contenteditable="true"], dialog, [role="dialog"]')
      )
        return;
      if ((keyboard.shiftKey && keyboard.code === 'KeyX') || (!keyboard.shiftKey && keyboard.key.toLowerCase() === 'n' && state && plane)) {
        keyboard.preventDefault();
        keyboard.stopPropagation();
        if (keyboard.shiftKey) toggle();
        else normal();
      } else if (keyboard.key === 'Escape' && state?.editing) {
        keyboard.preventDefault();
        keyboard.stopPropagation();
        turnOff();
      }
    };
    host.addEventListener('keydown', key, true);
    return () => host.removeEventListener('keydown', key, true);
  });
  const options = basePlaneViews(document).map(plane => ({ id: plane.id, label: plane.label }));
  if (source?.kind === 'face') options.push({ id: 'picked-face', label: source.label });
  let control: SectionOffsetControl | null = null;
  if (state?.editing && plane && !('error' in offset)) {
    const normal = new Vector3(...plane.normal),
      center = new Vector3(...modelCenter);
    center.addScaledVector(
      normal,
      -center
        .clone()
        .sub(new Vector3(...plane.origin))
        .dot(normal)
    );
    control = {
      origin: center.toArray(),
      normal: plane.normal,
      offset: offset.value,
      factor: state.flipped ? -1 : 1,
      dragging,
      onStart: () => {
        dragInitial.current = state.offset;
        dragScope.current = { document, source };
        setDragging(true);
      },
      // Cancellation clears this ref synchronously; a late pointerup must not overwrite the restored text.
      onPreview: value => {
        if (dragInitial.current !== null) moveOffset(value);
      },
      onStep: delta =>
        setState(previous => {
          if (!previous) return previous;
          const current = parseCadValue(previous.offset, { unit: 'mm', variables: scope });
          return 'error' in current ? previous : { ...previous, offset: String(current.value + delta) };
        }),
      onFinish: () => {
        dragInitial.current = null;
        dragScope.current = null;
        setDragging(false);
      },
      onCancel: cancelDrag,
    };
  }
  return {
    active: !!state,
    editing: !!state?.editing,
    picking: !!state?.editing && !!state?.picking,
    sourceFrame,
    plane,
    reason,
    offsetProblem,
    offset: state?.offset ?? '0',
    flipped: state?.flipped ?? false,
    planes: options,
    planeId: source?.kind === 'plane' ? source.id : source ? 'picked-face' : null,
    start,
    toggle,
    turnOff,
    pickPlane,
    pickFace,
    normal,
    control,
    dragging,
    edit: () => {
      if (enabled) setState(previous => (previous ? { ...previous, editing: true } : previous));
    },
    pick: () => {
      setState(previous => (previous ? { ...previous, picking: true } : previous));
      setPickProblem(null);
      focus();
    },
    selectPlane: (id: string) => {
      if (id !== 'picked-face') pickPlane(id);
    },
    setOffset,
    moveOffset,
    flip: () => setState(previous => (previous ? { ...previous, flipped: !previous.flipped } : previous)),
    confirm: () => {
      if (!reason && plane && state) {
        const kept = { ...state, editing: false, picking: false };
        accepted.current = { state: kept, generation: trackSelection(selectionHistory.current, selection) };
        setState(kept);
        focus();
      }
    },
  };
}
