import { useEffect, useState } from 'react';
import { sketchToDxf, sketchToSvg, type CadLengthUnit, type CadSketch } from '@wbcnc/cad';
import { Button } from '@wbcnc/ui/components/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@wbcnc/ui/components/dialog';
import { downloadText, exportFileName } from './downloadText';

/** What's being exported, and the name the file starts with. */
export type ExportTarget = { kind: 'sketch'; name: string; sketch: CadSketch };

type Format = 'dxf' | 'svg';
const formats: Record<Format, { label: string; type: string }> = {
  dxf: { label: 'DXF', type: 'application/dxf' },
  svg: { label: 'SVG', type: 'image/svg+xml' },
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
  // Each export starts from its own name and the design's unit; the format and options carry over.
  useEffect(() => {
    if (!target) return;
    setName(target.name);
    setUnit(documentUnit);
  }, [target, documentUnit]);

  const download = () => {
    if (!target) return;
    const text =
      format === 'dxf'
        ? sketchToDxf(target.sketch, { unit, construction, splinesAsPolylines: polylines })
        : sketchToSvg(target.sketch, { unit, construction });
    downloadText(text, exportFileName(name, format), formats[format].type);
    onClose();
  };
  return (
    <Dialog open={!!target} onOpenChange={open => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Export sketch</DialogTitle>
          <DialogDescription>Download the sketch’s curves at full size, in its own plane.</DialogDescription>
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
              {Object.entries(formats).map(([value, { label }]) => (
                <option key={value} value={value}>
                  {label}
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
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={construction} onChange={event => setConstruction(event.target.checked)} />
            Include construction geometry
          </label>
          {format === 'dxf' && (
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={polylines} onChange={event => setPolylines(event.target.checked)} />
              Export splines as polylines
            </label>
          )}
          <Button type="submit">Download</Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
