import { t as translate } from '@wbcnc/i18n';
import UnskewTsl from '@/calibration/UnskewTsl';
import { PageHeader } from '@/components/page-header';
import { createFileRoute } from '@tanstack/react-router';

export const Route = createFileRoute('/debug/undistort2')({
  component: RouteComponent,
});

function RouteComponent() {
  return (
    <div className="relative w-full h-full">
      <PageHeader title={translate('Unskew')} className="absolute" />

      {/* 3D Canvas */}
      <div className="w-full h-dvh absolute top-0 left-0">
        <UnskewTsl />
      </div>
    </div>
  );
}
