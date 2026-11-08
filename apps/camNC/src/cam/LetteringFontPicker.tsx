import { Button } from '@wbcnc/ui/components/button';
import { cn } from '@wbcnc/ui/lib/utils';
import { Command, CommandGroup, CommandInput, CommandItem, CommandList } from '@wbcnc/ui/components/command';
import { Popover, PopoverContent, PopoverTrigger } from '@wbcnc/ui/components/popover';
import { Check, ChevronsUpDown } from 'lucide-react';
import { useEffect, useState, type CSSProperties } from 'react';
import { fontLabel, isWebFont, kCarvingFonts, type CarvingFont, type WebFont } from './carving';
import {
  defaultWeight,
  fontsOnDevice,
  loadFontCatalog,
  previewStylesheetUrl,
  webFontCss,
  type CatalogFamily,
  type FontCategory,
} from './webFonts';

type Font = CarvingFont | WebFont;
const categories = { all: 'All', sans: 'Sans', serif: 'Serif', display: 'Display', handwriting: 'Handwriting', mono: 'Mono' } as const;
const builtInCategories: Record<CarvingFont, FontCategory> = { sans: 'sans', serif: 'serif', slab: 'serif' };
const previews = new Set<string>();

function FontName({ font }: { font: Font }) {
  const family = isWebFont(font) ? font.family : undefined;
  useEffect(() => {
    if (!family || previews.has(family)) return;
    previews.add(family);
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = previewStylesheetUrl(family);
    document.head.append(link);
  }, [family]);
  const style: CSSProperties = isWebFont(font)
    ? {
        fontFamily: `${webFontCss(font)}, ${JSON.stringify(font.family)}, sans-serif`,
        fontSizeAdjust: 'from-font',
        fontWeight: font.weight,
      }
    : { font: kCarvingFonts[font].css.replace('{size}', '14') };
  return (
    <span className="truncate" style={style}>
      {fontLabel(font)}
    </span>
  );
}

export function LetteringFontPicker({
  id = 'carve-font',
  font,
  onChange,
  className,
}: {
  id?: string;
  font: Font;
  onChange: (font: Font) => void;
  /** The button's, e.g. to make it smaller. */
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState<FontCategory | 'all'>('all');
  const [catalog, setCatalog] = useState<CatalogFamily[]>([]);
  const [device, setDevice] = useState<WebFont[]>([]);
  const [catalogError, setCatalogError] = useState(false);
  const web = isWebFont(font);
  useEffect(() => {
    if (!open && !web) return;
    let active = true;
    void loadFontCatalog()
      .then(rows => {
        if (active) setCatalog(rows);
      })
      .catch(() => {
        if (active) setCatalogError(true);
      });
    return () => {
      active = false;
    };
  }, [open, web]);
  useEffect(() => {
    if (!open) return;
    let active = true;
    void fontsOnDevice()
      .then(fonts => {
        if (active) setDevice(fonts);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [open, font]);

  const matches = (family: string) => family.toLowerCase().includes(search.trim().toLowerCase());
  const inCategory = (family: string) => category === 'all' || catalog.find(row => row.family === family)?.category === category;
  // Filtered too, so Enter picks the best match rather than the first built-in.
  const builtIns = (Object.keys(kCarvingFonts) as CarvingFont[]).filter(
    key => matches(kCarvingFonts[key].label) && (category === 'all' || builtInCategories[key] === category)
  );
  const cached = device.filter(f => matches(f.family) && inCategory(f.family)).slice(0, 80);
  const google = catalog.filter(f => matches(f.family) && (category === 'all' || f.category === category)).slice(0, 80 - cached.length);
  const weights = web ? (catalog.find(row => row.family === font.family)?.weights ?? [font.weight]) : [];
  const select = (next: Font) => {
    onChange(next);
    setOpen(false);
  };
  const checked = (next: Font) => fontLabel(font) === fontLabel(next);
  return (
    <div className="flex min-w-0 gap-2">
      <Popover
        open={open}
        onOpenChange={next => {
          setOpen(next);
          if (next) setSearch('');
        }}>
        <PopoverTrigger asChild>
          <Button
            id={id}
            type="button"
            variant="outline"
            role="combobox"
            aria-label="Font"
            aria-expanded={open}
            className={cn('min-w-0 flex-1 justify-between', className)}>
            <FontName font={font} />
            <ChevronsUpDown className="size-4 shrink-0 opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-80 max-w-[calc(100vw-2rem)] p-0">
          <Command label="Search fonts" shouldFilter={false}>
            <CommandInput aria-label="Search fonts" placeholder="Search fonts…" value={search} onValueChange={setSearch} />
            <div aria-label="Font category" className="flex flex-wrap gap-1 border-b p-2">
              {Object.entries(categories).map(([key, label]) => (
                <Button
                  key={key}
                  type="button"
                  size="sm"
                  variant={category === key ? 'secondary' : 'ghost'}
                  aria-pressed={category === key}
                  className="h-7 px-2 text-xs"
                  onClick={() => setCategory(key as typeof category)}>
                  {label}
                </Button>
              ))}
            </div>
            <CommandList>
              {!!builtIns.length && (
                <CommandGroup heading="Built in">
                  {builtIns.map(key => (
                    <CommandItem key={key} value={key} onSelect={() => select(key)}>
                      <FontName font={key} />
                      {checked(key) && <Check className="ml-auto" />}
                    </CommandItem>
                  ))}
                </CommandGroup>
              )}
              {!!cached.length && (
                <CommandGroup heading="On this device">
                  {cached.map(f => (
                    <CommandItem key={`${f.family}:${f.weight}`} value={`device:${f.family}:${f.weight}`} onSelect={() => select(f)}>
                      <FontName font={f} />
                      {checked(f) && <Check className="ml-auto" />}
                    </CommandItem>
                  ))}
                </CommandGroup>
              )}
              <CommandGroup heading="Google Fonts">
                {google.map(f => {
                  const next = { family: f.family, weight: defaultWeight(f.weights) };
                  return (
                    <CommandItem key={f.family} value={f.family} onSelect={() => select(next)}>
                      <FontName font={{ family: f.family, weight: 400 }} />
                      {web && font.family === f.family && <Check className="ml-auto" />}
                    </CommandItem>
                  );
                })}
                {!google.length && (
                  <p className="px-2 py-3 text-xs text-muted-foreground">
                    {catalogError ? 'Could not open the font catalog.' : catalog.length ? 'No matching families.' : 'Loading fonts…'}
                  </p>
                )}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
      {web && weights.length > 1 && (
        <select
          aria-label="Font weight"
          className="h-9 max-w-24 rounded-md border bg-background px-2"
          value={font.weight}
          onChange={e => onChange({ ...font, weight: Number(e.target.value) })}>
          {weights.map(weight => (
            <option key={weight} value={weight}>
              {weight}
            </option>
          ))}
        </select>
      )}
    </div>
  );
}
