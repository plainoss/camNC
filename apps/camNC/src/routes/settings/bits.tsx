import { t as translate, getLanguage } from '@wbcnc/i18n';
import { PageHeader } from '@/components/page-header';
import { ImportToolLibrary } from '@/cam/plan/ImportToolLibrary';
import { isBallBit, kBuiltInBits } from '@/cam/planSettings';
import { useToolLibrary, type StoredBit } from '@/cam/toolLibrary';
import { createFileRoute } from '@tanstack/react-router';
import { Button } from '@wbcnc/ui/components/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@wbcnc/ui/components/card';
import { Input } from '@wbcnc/ui/components/input';
import { Pencil, Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';

export const Route = createFileRoute('/settings/bits')({
  component: BitsPage,
});

const when = (at: number) => new Date(at).toLocaleString(getLanguage(), { dateStyle: 'medium', timeStyle: 'short' });

/** One bit's fields to edit, or a new custom bit's. */
function BitForm({
  bit,
  onSave,
  onCancel,
}: {
  bit?: StoredBit;
  onSave: (b: Pick<StoredBit, 'diameter' | 'flutes' | 'name' | 'shape'>) => void;
  onCancel: () => void;
}) {
  const [d, setD] = useState(bit ? String(bit.diameter) : '');
  const [flutes, setFlutes] = useState(bit?.flutes ? String(bit.flutes) : '2');
  const [name, setName] = useState(bit?.name ?? '');
  const [ball, setBall] = useState(!!bit && isBallBit(bit));
  const diameter = parseFloat(d);
  const ok = Number.isFinite(diameter) && diameter > 0 && diameter <= 25;
  return (
    <form
      className="grid grid-cols-[90px_70px_80px_1fr_auto_auto] items-center gap-2"
      aria-label={bit ? translate('Edit {{value1}}', { value1: bit.name }) : translate('New bit')}
      onSubmit={e => {
        e.preventDefault();
        if (ok)
          onSave({
            diameter,
            flutes: parseInt(flutes) || undefined,
            name: name.trim() || `${diameter} mm ${ball ? translate('ball end') : 'flat'}`,
            // Ball bits finish rounded edges; flat ones cut everything else.
            shape: ball ? 'ball' : undefined,
          });
      }}>
      <Input
        aria-label={translate('Diameter (mm)')}
        type="number"
        min={0.1}
        step={0.1}
        placeholder={translate('⌀ mm')}
        className="h-8 font-mono"
        value={d}
        onChange={e => setD(e.target.value)}
      />
      <Input
        aria-label={translate('Flutes')}
        type="number"
        min={1}
        step={1}
        className="h-8 font-mono"
        value={flutes}
        onChange={e => setFlutes(e.target.value)}
      />
      <select
        aria-label={translate('Shape')}
        className="h-8 rounded-md border border-input bg-background px-2 text-sm"
        value={ball ? 'ball' : 'flat'}
        onChange={e => setBall(e.target.value === 'ball')}>
        <option value="flat">{translate('Flat')}</option>
        <option value="ball">{translate('Ball end')}</option>
      </select>
      <Input
        aria-label={translate('Name')}
        placeholder={translate('Name')}
        className="h-8"
        value={name}
        onChange={e => setName(e.target.value)}
      />
      <Button size="sm" type="submit" disabled={!ok}>
        {translate('Save ')}
      </Button>
      <Button size="sm" type="button" variant="ghost" onClick={onCancel}>
        {translate('Cancel ')}
      </Button>
    </form>
  );
}

/** The bits offered in every CAM job: from imported Fusion libraries and added by hand. */
function BitsPage() {
  const { bits, imports, importLibrary, addCustom, updateBit, removeBit } = useToolLibrary();
  const [editing, setEditing] = useState<string | 'new' | null>(null);
  const libraries = [...new Set(bits.filter(b => b.source === 'library').map(b => b.library!))];
  const lastImport = (file: string) => imports.filter(i => i.file === file).at(-1);
  const groups: [string, string, StoredBit[]][] = [
    ...libraries.map(file => {
      const last = lastImport(file);
      return [
        file,
        last ? `Imported ${when(last.at)}` : translate('Imported earlier'),
        bits.filter(b => b.source === 'library' && b.library === file),
      ] as [string, string, StoredBit[]];
    }),
    [translate('Added by hand'), translate('Bits that are in no library.'), bits.filter(b => b.source === 'custom')],
  ];

  return (
    <div className="h-full w-full">
      <PageHeader title={translate('Bits')} />
      <div className="flex flex-row justify-center p-1">
        <div className="flex max-w-xl flex-1 flex-col gap-4 pb-8">
          <Card>
            <CardHeader>
              <CardTitle>{translate('Your bits')}</CardTitle>
              <CardDescription>
                {translate(
                  'Offered in every CAM job, with the built-in bits below. Flat end mills cut the parts; ball end mills finish rounded edges. Importing a Fusion library again updates its bits and adds new ones. A job keeps its own copy of its bit, so removing one here doesn’t change existing jobs. '
                )}
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-2">
              <div className="flex flex-wrap gap-2">
                <ImportToolLibrary onImport={importLibrary} />
                <Button size="sm" variant="outline" onClick={() => setEditing('new')}>
                  <Plus />
                  {translate(' Custom bit ')}
                </Button>
              </div>
              {editing === 'new' && (
                <BitForm
                  onSave={b => {
                    addCustom(b);
                    setEditing(null);
                  }}
                  onCancel={() => setEditing(null)}
                />
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">{translate('Built in')}</CardTitle>
              <CardDescription>{translate('Always offered. Add your own bit of the same kind to use it instead.')}</CardDescription>
            </CardHeader>
            <CardContent>
              <ul className="flex flex-col divide-y text-[13px]" aria-label={translate('Built in')}>
                {kBuiltInBits.map(b => (
                  <li key={`${b.number}|${b.name}`} className="flex items-center gap-2 py-2">
                    <span className="w-16 font-mono">⌀{b.diameter}</span>
                    <span className="grow">
                      {b.name}
                      <span className="text-muted-foreground">
                        {isBallBit(b) ? translate(' · ball end') : ''}
                        {b.flutes ? translate(' · {{value1}} flutes', { value1: b.flutes }) : ''}
                        {b.feed ? translate(' · F{{value1}}', { value1: b.feed }) : ''} · T{b.number}
                      </span>
                    </span>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>

          {groups
            .filter(([, , list]) => list.length)
            .map(([title, description, list]) => (
              <Card key={title}>
                <CardHeader>
                  <CardTitle className="text-base">{title}</CardTitle>
                  <CardDescription>{description}</CardDescription>
                </CardHeader>
                <CardContent>
                  <ul className="flex flex-col divide-y text-[13px]" aria-label={title}>
                    {list.map(b => (
                      <li key={b.id} className="flex items-center gap-2 py-2">
                        {editing === b.id ? (
                          <BitForm
                            bit={b}
                            onSave={patch => {
                              updateBit(b.id, patch);
                              setEditing(null);
                            }}
                            onCancel={() => setEditing(null)}
                          />
                        ) : (
                          <>
                            <span className="w-16 font-mono">⌀{b.diameter}</span>
                            <span className="grow">
                              {b.name}
                              <span className="text-muted-foreground">
                                {isBallBit(b) ? translate(' · ball end') : ''}
                                {b.flutes ? translate(' · {{value1}} flutes', { value1: b.flutes }) : ''}
                                {b.feed ? translate(' · F{{value1}}', { value1: b.feed }) : ''} · T{b.number}
                              </span>
                            </span>
                            <Button
                              size="icon"
                              variant="ghost"
                              className="size-7"
                              aria-label={translate('Edit {{value1}}', { value1: b.name })}
                              onClick={() => setEditing(b.id)}>
                              <Pencil className="size-3.5" />
                            </Button>
                            <Button
                              size="icon"
                              variant="ghost"
                              className="size-7"
                              aria-label={translate('Remove {{value1}}', { value1: b.name })}
                              onClick={() => removeBit(b.id)}>
                              <Trash2 className="size-3.5" />
                            </Button>
                          </>
                        )}
                      </li>
                    ))}
                  </ul>
                </CardContent>
              </Card>
            ))}
        </div>
      </div>
    </div>
  );
}
