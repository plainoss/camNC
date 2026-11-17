import { useEffect, useRef, useState } from 'react';
import type { ViewRequest } from '@/cam/model/ModelViewport';
import type { StudioCameraRef, StudioCameraState } from './studioCamera';
import './studioViewMenu.css';

const kUnsupported = 'Not available yet';
type Camera = NonNullable<ViewRequest['camera']>;
interface NamedView {
  name: string;
  camera: Camera;
}

/** Named views belong to the Part Studio they were saved in, for as long as it's open in this window. */
const namedViewsByDesign = new Map<string, NamedView[]>();

const asCamera = (state: StudioCameraState): Camera => ({
  center: [...state.center] as Camera['center'],
  back: [...state.back] as Camera['back'],
  up: [...state.up] as Camera['up'],
  height: state.height,
});

/**
 * The menu under the view cube, as the reference's: the standard views, the previous view, zoom to fit, and Named
 * views…, a panel to save the camera as it is under a name and go back to it. What camNC hasn't got yet is greyed.
 */
export function StudioViewMenu({
  designId,
  camera,
  onViewRequest,
  perspective,
  onPerspective,
  section,
}: {
  designId: string;
  camera?: StudioCameraRef;
  onViewRequest: (request: Omit<ViewRequest, 'seq'>) => void;
  /** Whether the view draws in perspective, and switching it. */
  perspective?: boolean;
  onPerspective?: (on: boolean) => void;
  /** The section view: started, edited or turned off from here too, as it is from its own buttons. */
  section?: { active: boolean; enabled: boolean; start: () => void; edit: () => void; turnOff: () => void };
}) {
  const [open, setOpen] = useState(false);
  const [panel, setPanel] = useState(false);
  const [views, setViews] = useState<NamedView[]>(() => namedViewsByDesign.get(designId) ?? []);
  const [name, setName] = useState('');
  const [picked, setPicked] = useState('');
  const [previous, setPrevious] = useState<Camera | null>(null);
  const menu = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (event: PointerEvent) => {
      if (!menu.current?.contains(event.target as Node)) setOpen(false);
    };
    window.addEventListener('pointerdown', close, true);
    return () => window.removeEventListener('pointerdown', close, true);
  }, [open]);
  /** Moves the camera, remembering where it was for Previous view. */
  const go = (request: Omit<ViewRequest, 'seq'>) => {
    if (camera?.current) setPrevious(asCamera(camera.current));
    onViewRequest(request);
    setOpen(false);
  };
  const save = () => {
    const now = camera?.current;
    const trimmed = name.trim();
    if (!now || !trimmed) return;
    const next = [...views.filter(view => view.name !== trimmed), { name: trimmed, camera: asCamera(now) }];
    namedViewsByDesign.set(designId, next);
    setViews(next);
    setName('');
  };
  const item = (label: string, onSelect?: () => void, checked?: boolean) => (
    <button
      key={label}
      type="button"
      role={checked === undefined ? 'menuitem' : 'menuitemcheckbox'}
      aria-checked={checked}
      disabled={!onSelect}
      title={onSelect ? undefined : kUnsupported}
      onClick={onSelect}>
      <span aria-hidden="true">{checked ? '✓' : ''}</span>
      {label}
    </button>
  );
  return (
    <>
      <div className="cad-view-menu" ref={menu}>
        <button type="button" aria-label="View menu" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(!open)}>
          ▾
        </button>
        {open && (
          <div role="menu" aria-label="View menu">
            {item('Isometric', () => go({ name: 'iso', direction: [1, -1, 1] }))}
            {item('Dimetric', () => go({ name: 'iso', direction: [1, -1, 0.8] }))}
            {item('Trimetric', () => go({ name: 'iso', direction: [0.8, -1, 0.6] }))}
            {item('Graphics preferences…')}
            {item('Named views…', () => {
              setPanel(true);
              setOpen(false);
            })}
            {item('Previous view', previous ? () => go({ name: 'fit', camera: previous }) : undefined)}
            {item('Zoom to fit', () => go({ name: 'fit' }))}
            {item('Zoom to window')}
            {item(
              'Perspective view',
              onPerspective &&
                (() => {
                  onPerspective(!perspective);
                  setOpen(false);
                }),
              !!perspective
            )}
            {item('Orient normal to…')}
            {item('Shaded with edges', undefined, true)}
            {item('Hidden edges removed', undefined, true)}
            {item('Tangent edges visible', undefined, true)}
            {item('View in high quality')}
            {item('Highlight boundary edges')}
            {section?.active ? (
              <>
                {item('Edit section view…', section.enabled ? () => (section.edit(), setOpen(false)) : undefined)}
                {item('Turn off section view', () => (section.turnOff(), setOpen(false)))}
              </>
            ) : (
              item('Section view…', section?.enabled ? () => (section.start(), setOpen(false)) : undefined)
            )}
          </div>
        )}
      </div>
      {panel && (
        <section className="cad-named-views" role="dialog" aria-label="Named views">
          <header>
            <strong>Named views</strong>
            <span>
              <button type="button" aria-label="Help" title={kUnsupported} disabled>
                ?
              </button>
              <button type="button" aria-label="Close" onClick={() => setPanel(false)}>
                ✕
              </button>
            </span>
          </header>
          <div className="cad-named-views-row">
            <input
              aria-label="New view name"
              placeholder="New view name"
              value={name}
              // Typed here, view shortcuts are only letters.
              onKeyDown={event => {
                event.stopPropagation();
                if (event.key === 'Enter') save();
              }}
              onChange={event => setName(event.target.value)}
            />
            <button type="button" aria-label="Save view" disabled={!name.trim()} onClick={save}>
              +
            </button>
          </div>
          {views.length ? (
            <div className="cad-named-views-row">
              <select
                aria-label="Saved views"
                value={picked}
                onChange={event => {
                  const view = views.find(candidate => candidate.name === event.target.value);
                  setPicked(event.target.value);
                  if (view) go({ name: 'fit', camera: view.camera });
                }}>
                <option value="" disabled>
                  Select a view
                </option>
                {views.map(view => (
                  <option key={view.name} value={view.name}>
                    {view.name}
                  </option>
                ))}
              </select>
              <button type="button" aria-label="Manage view" title={kUnsupported} disabled={!picked}>
                ⚙
              </button>
            </div>
          ) : (
            <p>No views created</p>
          )}
        </section>
      )}
    </>
  );
}
