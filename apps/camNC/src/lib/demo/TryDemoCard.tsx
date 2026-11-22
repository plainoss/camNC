import { t as translate } from '@wbcnc/i18n';
import { useStore } from '@/store/store';
import { Button } from '@wbcnc/ui/components/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@wbcnc/ui/components/card';
import { FlaskConical } from 'lucide-react';
import { isDemoMode } from './demo-mode';

/** For visitors who have no camera set up yet: try camNC first, set up later. */
export function TryDemoCard() {
  const hasCamera = useStore(s => Object.keys(s.camSources).length > 0);
  if (isDemoMode() || hasCamera) return null;
  return (
    <Card>
      <CardHeader>
        <CardTitle>{translate('Explore a demo machine')}</CardTitle>
        <CardDescription>
          {translate(
            'Practice machine controls with a simulated FluidNC and a recorded camera example. Bring your own G-code if you like. Machine settings are discarded; demo projects save locally in this browser. '
          )}
        </CardDescription>
      </CardHeader>
      <CardContent>
        {/* A full page load, so that demo mode is decided before the app starts. */}
        <div className="flex flex-row flex-wrap items-center gap-2">
          <Button asChild>
            <a href="/demo?machine=1">
              <FlaskConical />
              {translate(' Open the demo ')}
            </a>
          </Button>
          <details>
            <summary className="cursor-pointer text-sm text-muted-foreground">{translate('Camera options')}</summary>
            <Button asChild variant="ghost">
              <a href="/demo?camera=off">{translate('Without a camera')}</a>
            </Button>
          </details>
        </div>
      </CardContent>
    </Card>
  );
}
