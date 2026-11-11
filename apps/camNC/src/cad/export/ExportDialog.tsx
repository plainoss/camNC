import { useEffect, useState } from 'react';
import { sketchToDxf, sketchToSvg, type CadDocument, type CadLengthUnit, type CadSketch } from '@wbcnc/cad';
import { Button } from '@wbcnc/ui/components/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@wbcnc/ui/components/dialog';
import { downloadText, exportFileName } from './downloadText';
import { studioStep } from './studioStep';

/** What's being exported, and the name the file starts with. */
export type ExportTarget =
  | { kind: 'sketch'; name: string; sketch: CadSketch }
  | {
      kind: 'parts';
      name: string;
      document: CadDocument;
      /** One part or copy; the whole studio, shown parts only, without it. */
      only?: { partId: string; copyId?: string };
      hidden?: ReadonlySet<string>;
    };

type Format = 'dxf' | 'svg' | 'step';
const formats: Record<Format, { label: string; type: string }> = {
  dxf: { label: 'DXF', type: 'application/dxf' },
  svg: { label: 'SVG', type: 'image/svg+xml' },
  step: { label: 'STEP', type: 'model/step' },
};

/** The one Export dialog: file name, format, unit and the options that format has, then Download. */
export function ExportDialog({
  target,
  unit: documentUnit,
  onClose,
}: {
  target: ExportTarget | null;
  /** The design's length unit, which the file uses unless another is picked. */
  unit: CadLengthUnit;
  onClose: () => void;
}) {
  const [name, setName] = useState('');
  const [format, setFormat] = useState<Format>('dxf');
  const [unit, setUnit] = useState<CadLengthUnit>(documentUnit);
  const [construction, setConstruction] = useState(false);
  const [polylines, setPolylines] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  /** Parts were left out and the person has been told: the next Download writes the rest. */
  const [confirmedPartial, setConfirmedPartial] = useState(false);
  const parts = target?.kind === 'parts';
  // Each export starts from its own name and the design's unit; a sketch's format and options carry over.
  useEffect(() => {
    if (!target) return;
    setName(target.name);
    setUnit(documentUnit);
    setProblem(null);
    setConfirmedPartial(false);
    setFormat(format => (target.kind === 'parts' ? 'step' : format === 'step' ? 'dxf' : format));
  }, [target, documentUnit]);

  const download = () => {
    if (!target) return;
    let text: string;
    if (target.kind === 'parts') {
      const fileName = exportFileName(name, 'step');
      const result = studioStep(target.document, { only: target.only, hidden: target.hidden, unit, fileName });
      const why = result.problems.map(({ name, message }) => `${name}: ${message}`).join(' ');
      if (!result.parts.length) return setProblem(why || 'There are no parts to export.');
      // A file missing parts is only written once the person has seen which.
      if (why && !confirmedPartial) {
        setConfirmedPartial(true);
        return setProblem(`These are left out: ${why}`);
      }
      text = result.text;
    } else
      text =
        format === 'dxf'
          ? sketchToDxf(target.sketch, { unit, construction, splinesAsPolylines: polylines })
          : sketchToSvg(target.sketch, { unit, construction });
    downloadText(text, exportFileName(name, format), formats[format].type);
    onClose();
  };
  const offered = (parts ? ['step'] : ['dxf', 'svg']) as Format[];
  return (
    <Dialog open={!!target} onOpenChange={open => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{parts ? 'Export parts' : 'Export sketch'}</DialogTitle>
          <DialogDescription>
            {!parts
              ? 'Download the sketch’s curves at full size, in its own plane.'
              : target.only
                ? 'Download this part as a solid, where it is in the studio.'
                : 'Download every shown part as a solid, where it is in the studio.'}
          </DialogDescription>
        </DialogHeader>
        <form
          className="grid gap-4"
          onSubmit={event => {
            event.preventDefault();
            download();
          }}>
          <label className="grid gap-1">
            File name
            <span className="flex items-center gap-1">
              <input
                aria-label="File name"
                className="min-w-0 flex-1 rounded border bg-background px-2 py-1"
                required
                value={name}
                onChange={event => setName(event.target.value)}
              />
              <span className="text-muted-foreground">.{format}</span>
            </span>
          </label>
          <label className="grid gap-1">
            Format
            <select
              className="rounded border bg-background px-2 py-1"
              value={format}
              onChange={event => setFormat(event.target.value as Format)}>
              {offered.map(value => (
                <option key={value} value={value}>
                  {formats[value].label}
                </option>
              ))}
            </select>
          </label>
          <label className="grid gap-1">
            Units
            <select
              className="rounded border bg-background px-2 py-1"
              value={unit}
              onChange={event => setUnit(event.target.value as CadLengthUnit)}>
              <option value="mm">Millimeters (mm)</option>
              <option value="cm">Centimeters (cm)</option>
              <option value="m">Meters (m)</option>
              <option value="in">Inches (in)</option>
              <option value="ft">Feet (ft)</option>
            </select>
          </label>
          {!parts && (
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={construction} onChange={event => setConstruction(event.target.checked)} />
              Include construction geometry
            </label>
          )}
          {format === 'dxf' && (
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={polylines} onChange={event => setPolylines(event.target.checked)} />
              Export splines as polylines
            </label>
          )}
          {problem && (
            <p role="alert" className="text-sm text-destructive">
              {problem}
            </p>
          )}
          <Button type="submit">{confirmedPartial ? 'Download without them' : 'Download'}</Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
