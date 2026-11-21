import { useLocale, setLocale, type Locale } from '@/lib/i18n';
import { Languages } from 'lucide-react';
import { Button } from '@wbcnc/ui/components/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@wbcnc/ui/components/dropdown-menu';

const locales: { value: Locale; label: string }[] = [
  { value: 'en', label: 'English' },
  { value: 'fr', label: 'Français' },
];

export function LanguageSelector({ compact = false }: { compact?: boolean }) {
  const locale = useLocale();
  const current = locales.find(option => option.value === locale)!;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size={compact ? 'icon' : 'sm'} aria-label="Language" title="Language" className={compact ? 'size-8' : 'justify-start gap-2'}>
          <Languages className="size-4" />
          {!compact && <span>{current.label}</span>}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        {locales.map(option => (
          <DropdownMenuItem key={option.value} onSelect={() => setLocale(option.value)} className={option.value === locale ? 'font-semibold' : ''}>
            {option.label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
