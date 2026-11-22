import { t as translate } from '@wbcnc/i18n';
import { UnprojectTsl } from '@/calibration/Unproject';
import { PageHeader } from '@/components/page-header';
import { createFileRoute } from '@tanstack/react-router';
import { Button } from '@wbcnc/ui/components/button';

export const Route = createFileRoute('/debug/unproject')({
  component: RouteComponent,
});

function RouteComponent() {
  return (
    <div className="relative w-full h-full">
      <PageHeader title={translate('Unproject')} className="absolute" />
      <Button className="absolute top-4 right-4 z-10">{translate('Start')}</Button>

      {/* 3D Canvas */}
      <div className="w-full h-dvh absolute top-0 left-0">
        <UnprojectTsl />
      </div>
    </div>
  );
}
