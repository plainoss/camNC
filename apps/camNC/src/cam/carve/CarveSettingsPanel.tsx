import type { ReactNode } from 'react';
import { vConeDepth } from '@wbcnc/cam';
import { NumberInput } from '@/cam/NumberInput';
import { CarvingCutoutToggle, kCutoutSelection } from '@/cam/CarvingCutout';
import { kVBits, type CarvingV1 } from '@/cam/carving';
import { CarvePanelHeader } from './CarveTools';

/** A dragged board edge or a typed board size stays between these limits. */
export const kBoardLeast = 20;
export const kBoardMost = 2000;

/**
 * The Board and bit panel: in job order, the board you clamp down, then the bit and depth that carve it, then cutting it
 * out. It opens from the board's toolbar, so these settings no longer sit under whatever else the sidebar shows.
 */
export function CarveSettingsPanel({
  carving,
  size,
  thickness,
  flatBitName,
  taped,
  onCarving,
  onBoard,
  onSelect,
  onClose,
}: {
  carving: CarvingV1;
  size: { w: number; h: number };
  thickness: number;
  flatBitName: string;
  taped: boolean;
  onCarving: (next: CarvingV1) => void;
  onBoard: (change: Partial<{ w: number; h: number; thickness: number }>) => void;
  onSelect: (id: string | null) => void;
  onClose: () => void;
}) {
  const cone = vConeDepth(carving.vBit);
  const flatFrom = 2 * (Math.min(carving.maxDepth, cone) / Math.tan(((carving.vBit.angle ?? 90) * Math.PI) / 360));
  return (
    <>
      <CarvePanelHeader title="Board and bit" onClose={onClose} />
      <Section title="Board">
        <div className="grid grid-cols-3 gap-2">
          <Field label="Width" id="carve-board-w">
            <NumberInput id="carve-board-w" value={size.w} min={kBoardLeast} max={kBoardMost} unit="mm" onCommit={w => onBoard({ w })} />
          </Field>
          <Field label="Height" id="carve-board-h">
            <NumberInput id="carve-board-h" value={size.h} min={kBoardLeast} max={kBoardMost} unit="mm" onCommit={h => onBoard({ h })} />
          </Field>
          <Field label="Thick" id="carve-board-t">
            <NumberInput id="carve-board-t" value={thickness} min={3} max={100} unit="mm" onCommit={t => onBoard({ thickness: t })} />
          </Field>
        </div>
        <p className="text-xs text-muted-foreground">
          Measure the board&rsquo;s thickness: Z0 is its underside, so a thicker board carves deeper and wider.
        </p>
      </Section>
      <Section title="Bit and depth">
        <Field label="V-bit" id="carve-bit">
          <select
            id="carve-bit"
            className="h-9 rounded-md border bg-background px-2"
            value={carving.vBit.number}
            onChange={e => onCarving({ ...carving, vBit: kVBits.find(b => b.number === Number(e.target.value)) ?? carving.vBit })}>
            {kVBits.map(b => (
              <option key={b.number} value={b.number}>
                {b.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Deepest (mm)" id="carve-depth">
          <NumberInput
            id="carve-depth"
            value={carving.maxDepth}
            min={0.2}
            max={thickness - 1}
            minExclusive
            unit="mm"
            onCommit={maxDepth => onCarving({ ...carving, maxDepth })}
          />
        </Field>
        <p className="text-xs text-muted-foreground">
          Strokes wider than {flatFrom.toFixed(1)} mm get a flat bottom
          {carving.maxDepth > cone ? `: the bit's cone is only ${cone.toFixed(1)} mm deep` : ''}.
        </p>
        <label className="flex items-start gap-2">
          <input
            type="checkbox"
            className="mt-0.5"
            checked={carving.clearWithFlat}
            onChange={e => onCarving({ ...carving, clearWithFlat: e.target.checked })}
          />
          <span>
            Clear flat bottoms with the {flatBitName} first
            <span className="block text-xs text-muted-foreground">Otherwise the V-bit clears them: one bit, slower.</span>
          </span>
        </label>
      </Section>
      <Section title="Cut out">
        <CarvingCutoutToggle
          carving={carving}
          taped={taped}
          bitName={flatBitName}
          onChange={cutout => {
            onCarving({ ...carving, cutout });
            onSelect(cutout ? kCutoutSelection : null);
          }}
        />
      </Section>
    </>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="grid gap-3 border-t pt-4 first-of-type:border-t-0 first-of-type:pt-0" aria-label={title}>
      <h4 className="text-xs font-medium tracking-wide text-muted-foreground uppercase">{title}</h4>
      {children}
    </section>
  );
}

function Field({ label, id, children }: { label: string; id: string; children: ReactNode }) {
  return (
    <div className="grid gap-1">
      <label htmlFor={id} className="text-xs text-muted-foreground">
        {label}
      </label>
      {children}
    </div>
  );
}
