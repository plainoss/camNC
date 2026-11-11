import { useEffect, useId, useMemo, useRef, useState } from 'react';
import {
  evaluateSegment,
  geometryBounds,
  parseSvgSketch,
  placedSvgSegments,
  SVG_LIMITS,
  type SvgPlacement,
  type SvgSketchAsset,
} from '../../../../../packages/cad-script/src/svg';
import './svgImport.css';
export interface SvgImportSelection {
  asset: SvgSketchAsset;
  placement: SvgPlacement;
  source: string;
  name: string;
}
/** Geometry-only import. The caller constructs a checked proposal; this dialog never edits a design. */
export function SvgImportDialog({
  onImport,
  onClose,
}: {
  onImport: (selection: SvgImportSelection) => void | Promise<void>;
  onClose: () => void;
}) {
  const id = useId(),
    dialog = useRef<HTMLDialogElement>(null),
    readVersion = useRef(0);
  const [selected, setSelected] = useState<{ asset: SvgSketchAsset; source: string; name: string } | null>(null);
  const [error, setError] = useState<string | null>(null),
    [reading, setReading] = useState(false),
    [busy, setBusy] = useState(false);
  const [width, setWidth] = useState(''),
    [height, setHeight] = useState(''),
    [x, setX] = useState('0'),
    [y, setY] = useState('0'),
    [preserve, setPreserve] = useState(true);
  useEffect(() => {
    const element = dialog.current!,
      reads = readVersion;
    element.showModal();
    return () => {
      reads.current++;
      element.close();
    };
  }, []);
  const placement: SvgPlacement = { width: Number(width), height: Number(height), at: [Number(x), Number(y)], preserveAspect: preserve };
  const preview = useMemo(() => {
    if (!selected) return null;
    try {
      const segments = placedSvgSegments(selected.asset, {
          width: Number(width),
          height: Number(height),
          at: [Number(x), Number(y)],
          preserveAspect: preserve,
        }),
        bounds = geometryBounds(segments);
      let index = 0;
      const d = selected.asset.contours
        .map(contour => {
          const own = segments.slice(index, index + contour.segments.length);
          index += own.length;
          return (
            own
              .map((segment, i) => {
                const points =
                  segment.kind === 'line'
                    ? [segment.points[0], segment.points.at(-1)!]
                    : Array.from({ length: 49 }, (_, j) => evaluateSegment(segment, j / 48));
                return points.map((p, j) => `${i === 0 && j === 0 ? 'M' : 'L'}${p[0]} ${-p[1]}`).join(' ');
              })
              .join(' ') + ' Z'
          );
        })
        .join(' ');
      const pad = Math.max(...bounds.size) * 0.06;
      return {
        d,
        bounds,
        viewBox: [bounds.at[0] - pad, -bounds.at[1] - bounds.size[1] - pad, bounds.size[0] + pad * 2, bounds.size[1] + pad * 2].join(' '),
      };
    } catch {
      return null;
    }
  }, [selected, width, height, x, y, preserve]);
  return (
    <dialog
      ref={dialog}
      className="cad-svg-import"
      aria-labelledby={`${id}-title`}
      onClose={onClose}
      onKeyDown={event => event.stopPropagation()}>
      <form
        onSubmit={async event => {
          event.preventDefault();
          if (!selected || !preview) {
            setError('Choose a supported SVG and enter positive, finite dimensions.');
            return;
          }
          setBusy(true);
          setError(null);
          try {
            await onImport({ ...selected, placement });
            dialog.current?.close();
          } catch (cause) {
            setError(cause instanceof Error ? cause.message : String(cause));
          } finally {
            setBusy(false);
          }
        }}>
        <header>
          <h2 id={`${id}-title`}>Import SVG into sketch</h2>
          <button type="button" onClick={() => dialog.current?.close()}>
            Cancel
          </button>
        </header>
        <p>Import closed filled outlines as editable curves. Convert strokes and text to outlines before importing.</p>
        <label htmlFor={`${id}-file`}>SVG file</label>
        <input
          id={`${id}-file`}
          name="svg"
          type="file"
          accept=".svg,image/svg+xml"
          required
          autoFocus
          aria-describedby={`${id}-status`}
          onChange={async event => {
            const version = ++readVersion.current,
              file = event.currentTarget.files?.[0];
            setSelected(null);
            setError(null);
            setReading(false);
            if (!file) return;
            setReading(true);
            try {
              if (file.size > SVG_LIMITS.bytes) throw new Error('SVG exceeds the 1 MB input limit.');
              const source = await file.text();
              // An older read must not replace a newer selection or reopen an unmounted dialog.
              if (version !== readVersion.current) return;
              const asset = parseSvgSketch(source);
              setSelected({ asset, source, name: file.name });
              setWidth(String(asset.bounds.size[0]));
              setHeight(String(asset.bounds.size[1]));
            } catch (cause) {
              if (version === readVersion.current) setError(cause instanceof Error ? cause.message : String(cause));
            } finally {
              if (version === readVersion.current) setReading(false);
            }
          }}
        />
        <fieldset>
          <legend>Size and placement (mm)</legend>
          <label htmlFor={`${id}-width`}>Width</label>
          <input
            id={`${id}-width`}
            name="width"
            type="number"
            min="0.000001"
            max={SVG_LIMITS.coordinate}
            step="any"
            required
            value={width}
            onChange={e => {
              setWidth(e.target.value);
              setError(null);
            }}
          />
          <label htmlFor={`${id}-height`}>Height</label>
          <input
            id={`${id}-height`}
            name="height"
            type="number"
            min="0.000001"
            max={SVG_LIMITS.coordinate}
            step="any"
            required
            value={height}
            onChange={e => {
              setHeight(e.target.value);
              setError(null);
            }}
          />
          <div className="cad-svg-aspect">
            <input id={`${id}-aspect`} name="aspect" type="checkbox" checked={preserve} onChange={e => setPreserve(e.target.checked)} />
            <label htmlFor={`${id}-aspect`}>Keep proportions (fit within width and height)</label>
          </div>
          <label htmlFor={`${id}-x`}>Lower-left X</label>
          <input
            id={`${id}-x`}
            name="x"
            type="number"
            min={-SVG_LIMITS.coordinate}
            max={SVG_LIMITS.coordinate}
            step="any"
            required
            value={x}
            onChange={e => setX(e.target.value)}
          />
          <label htmlFor={`${id}-y`}>Lower-left Y</label>
          <input
            id={`${id}-y`}
            name="y"
            type="number"
            min={-SVG_LIMITS.coordinate}
            max={SVG_LIMITS.coordinate}
            step="any"
            required
            value={y}
            onChange={e => setY(e.target.value)}
          />
        </fieldset>
        {preview && (
          <figure>
            <svg viewBox={preview.viewBox} aria-label="Imported geometry preview">
              <path d={preview.d} fillRule="evenodd" />
            </svg>
            <figcaption>
              {preview.bounds.size.map(n => n.toFixed(3)).join(' × ')} mm · {selected?.asset.contours.length} closed contours
            </figcaption>
          </figure>
        )}
        {selected?.asset.warnings.map(warning => (
          <p key={warning}>{warning}</p>
        ))}
        <p id={`${id}-status`} role="status">
          {reading
            ? 'Reading SVG…'
            : (error ?? 'Size uses the drawn geometry. Imported dimensions preserve control points; CAD relationships are not inferred.')}
        </p>
        <footer>
          <button type="submit" disabled={reading || busy}>
            {busy ? 'Checking…' : 'Review import'}
          </button>
        </footer>
      </form>
    </dialog>
  );
}
