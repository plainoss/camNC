import { useState } from 'react';
import type { CadDocument, CadLengthUnit } from '@wbcnc/cad';
import { Button } from '@wbcnc/ui/components/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@wbcnc/ui/components/dialog';

export type DesignSettingsValue = Pick<CadDocument, 'name' | 'lengthUnit'>;

export function DesignName({ name, onRename }: { name: string; onRename: (name: string) => boolean }) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(name);
  const apply = () => {
    const next = text.trim();
    if (!next) {
      setText(name);
      setEditing(false);
      return;
    }
    if (onRename(next)) setEditing(false);
  };
  return editing ? (
    <input
      aria-label="Design name"
      className="w-full min-w-0 rounded border bg-background px-1 text-sm text-foreground"
      autoFocus
      value={text}
      onFocus={event => event.currentTarget.select()}
      onChange={event => setText(event.target.value)}
      onBlur={apply}
      onKeyDown={event => {
        event.stopPropagation();
        if (event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) return;
        if (event.key === 'Enter') {
          event.preventDefault();
          apply();
        }
        if (event.key === 'Escape') {
          event.preventDefault();
          setEditing(false);
        }
      }}
    />
  ) : (
    <button
      type="button"
      className="truncate text-left hover:text-foreground"
      aria-label={`Rename design: ${name}`}
      title="Rename design"
      onClick={() => {
        setText(name);
        setEditing(true);
      }}>
      {name}
    </button>
  );
}

export function DesignSettings({ value, onSave }: { value: DesignSettingsValue; onSave: (value: DesignSettingsValue) => boolean }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(value.name);
  const [unit, setUnit] = useState<CadLengthUnit>(value.lengthUnit ?? 'mm');
  return (
    <>
      <Button
        size="sm"
        variant="ghost"
        onClick={() => {
          setName(value.name);
          setUnit(value.lengthUnit ?? 'mm');
          setOpen(true);
        }}>
        Design settings
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Design settings</DialogTitle>
            <DialogDescription>
              Choose the name and length unit for this design. Changing units keeps every part the same size.
            </DialogDescription>
          </DialogHeader>
          <form
            className="grid gap-4"
            onSubmit={event => {
              event.preventDefault();
              if (name.trim() && onSave({ name: name.trim(), lengthUnit: unit })) setOpen(false);
            }}>
            <label className="grid gap-1">
              Design name
              <input
                className="rounded border bg-background px-2 py-1"
                required
                value={name}
                onChange={event => setName(event.target.value)}
              />
            </label>
            <label className="grid gap-1">
              Length unit
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
            <Button type="submit">Save settings</Button>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
