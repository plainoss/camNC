import { useEffect, useMemo, useState, type RefObject } from 'react';
import type { CadDocument } from '@wbcnc/cad';
import type { ModelMeasurePick } from '@/cam/model/measurementPick';
import type { AssemblyModel } from './assemblyModel';
import { instanceKey } from './assemblyModel';
import { measureEntities } from './measureGeometry';
import type { StudioMeasureSelection } from './StudioMeasurePanel';

type PickedSelection = StudioMeasureSelection & { instance: string };

/** Measurement selections are view state. A changed design invalidates their topology instead of showing stale values. */
export function useStudioMeasure(
  document: CadDocument,
  model: AssemblyModel,
  frame: RefObject<HTMLDivElement | null>,
  enabled: boolean,
  topology?: unknown
) {
  // Rollback/Final previews can change topology without changing the persisted revision.
  const revision = document.revision;
  const version = useMemo(() => ({ document, revision, topology }), [document, revision, topology]);
  const [picked, setPicked] = useState<{ version: object; items: PickedSelection[] }>({ version, items: [] });
  const [expanded, setExpanded] = useState(false);
  const [selectedRowId, setSelectedRowId] = useState<string | null>(null);
  const visible = useMemo(() => new Set(model.instances.map(instanceKey)), [model.instances]);
  const selection = useMemo(
    () => (enabled && picked.version === version ? picked.items.filter(item => visible.has(item.instance)) : []),
    [enabled, picked, version, visible]
  );
  const result = useMemo(() => measureEntities(selection.map(item => item.entity)), [selection]);
  const row = result.rows.find(row => row.id === selectedRowId) ?? result.rows.find(row => row.witness);
  const clear = () => {
    setPicked({ version, items: [] });
    setSelectedRowId(null);
  };
  useEffect(() => {
    setPicked({ version, items: [] });
    setSelectedRowId(null);
  }, [version, enabled]);
  useEffect(() => {
    if (!enabled) setExpanded(false);
  }, [enabled]);
  useEffect(() => {
    // Hiding a body removes its picks permanently; showing it again must not silently turn a pair into a total.
    setPicked(previous => {
      const items = previous.items.filter(item => visible.has(item.instance));
      return items.length === previous.items.length ? previous : { ...previous, items };
    });
  }, [visible]);
  const open = () => setExpanded(true);
  useEffect(() => {
    const host = frame.current?.closest('.cad-editor') ?? frame.current;
    if (!host || !enabled) return;
    const key = (event: Event) => {
      const keyboard = event as KeyboardEvent,
        target = event.target as HTMLElement;
      if (keyboard.key !== '[' || keyboard.altKey || keyboard.ctrlKey || keyboard.metaKey || keyboard.repeat) return;
      if (target.closest('input, textarea, select, [contenteditable="true"], dialog, [role="dialog"]')) return;
      keyboard.preventDefault();
      keyboard.stopPropagation();
      setExpanded(true);
    };
    host.addEventListener('keydown', key, true);
    return () => host.removeEventListener('keydown', key, true);
  }, [frame, enabled]);
  useEffect(() => {
    const host = frame.current?.closest('.cad-editor');
    if (!host) return;
    const selectionChanged = (event: Event) => {
      const target = event.target as HTMLElement;
      const row = target.closest('button:not(.cad-feature-eye):not(.cad-part-eye)');
      // Visibility controls leave unrelated measurements intact; hidden instances are pruned separately above.
      if (row && !frame.current?.contains(target) && row.closest('[aria-label="Features"], [aria-label="Parts"]')) {
        setPicked({ version, items: [] });
        setSelectedRowId(null);
      }
    };
    host.addEventListener('click', selectionChanged, true);
    return () => host.removeEventListener('click', selectionChanged, true);
  }, [frame, version]);
  const pick = (pick: ModelMeasurePick) => {
    const instance = model.instances[pick.index];
    if (!enabled || !instance) return;
    const owner = instanceKey(instance),
      key = JSON.stringify([owner, pick.entity]);
    const item: PickedSelection = { key, instance: owner, label: `${instance.name} · ${pick.entity.kind}`, entity: pick.entity };
    setPicked(previous => {
      const current = previous.version === version ? previous.items : [];
      const items =
        expanded || pick.additive
          ? current.some(item => item.key === key)
            ? current.filter(item => item.key !== key)
            : [...current, item]
          : [item];
      return { version, items };
    });
    setSelectedRowId(null);
    frame.current?.focus();
  };
  return {
    selection,
    result,
    expanded: enabled && expanded,
    selectedRowId: row?.id,
    witness: row?.witness ? { ...row.witness, ...(row.axis && { axis: row.axis }) } : undefined,
    pick,
    clear,
    open,
    close: () => {
      setExpanded(false);
      frame.current?.focus();
    },
    selectRow: setSelectedRowId,
    remove: (key: string) => setPicked(previous => ({ version, items: previous.items.filter(item => item.key !== key) })),
  };
}
