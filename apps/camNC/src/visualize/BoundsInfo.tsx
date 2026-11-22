import { t as translate, getLanguage } from '@wbcnc/i18n';
import { useIsCameraReady, usePnPResult, useStore } from '@/store/store';
import { ClientOnly } from '@tanstack/react-router';
import { Popover, PopoverContent, PopoverTrigger } from '@wbcnc/ui/components/popover';
import { Info } from 'lucide-react';
import { useState } from 'react';
import TimeAgo from 'react-timeago-i18n';
import { RecomputePnpButton } from './RecomputePnpButton';
import { getTimeAgoLocale } from './timeAgoLocale';
import { TooltipIconButton } from './toolbar/TooltipIconButton';

/** The camera pose result, only while a camera is in use. */
function useCameraPnPResult() {
  const pnpResult = usePnPResult();
  return useIsCameraReady() ? pnpResult : null;
}

export function BoundsInfo() {
  const bounds = useStore(s => s.toolpath?.getBounds());
  const pnpResult = useCameraPnPResult();
  const isOld = pnpResult ? Date.now() - pnpResult.lastPnPTime > 60_000 : false;
  const locale = getTimeAgoLocale(getLanguage());
  return (
    <div className="flex flex-col gap-2">
      <h3 className="text-sm font-medium">{translate('Toolpath Bounds')}</h3>
      {bounds ? (
        <>
          <div className="grid gap-0.5 text-xs text-gray-600">
            <div>
              X: [{bounds.min.x.toFixed(2)}, {bounds.max.x.toFixed(2)}]
            </div>
            <div>
              Y: [{bounds.min.y.toFixed(2)}, {bounds.max.y.toFixed(2)}]
            </div>
            <div>
              Z: [{bounds.min.z.toFixed(2)}, {bounds.max.z.toFixed(2)}]
            </div>
          </div>
        </>
      ) : (
        <div className="text-xs text-gray-600">{translate('No program loaded')}</div>
      )}
      {pnpResult && (
        <>
          <h3 className="text-sm font-medium">{translate('PnP')}</h3>
          <div className="grid items-center gap-0.5 text-xs">
            <ClientOnly>
              <div className={`flex items-center gap-1 ${isOld ? 'bg-warning' : ''}`}>
                <span>
                  {translate('PnP computed ')}
                  <TimeAgo date={pnpResult.lastPnPTime} hideSeconds={false} locale={locale} />
                </span>
                <RecomputePnpButton />
              </div>
            </ClientOnly>
            {pnpResult.lastReprojectionError !== undefined && (
              <div className={pnpResult.lastReprojectionError > 2 ? 'text-red-600' : ''}>
                {translate('Reprojection error: ')}
                {pnpResult.lastReprojectionError.toFixed(2)}
                {translate('px ')}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

export function BoundsInfoButton() {
  const [open, setOpen] = useState(false);
  const pnp = useCameraPnPResult();
  const isOld = pnp ? Date.now() - pnp.lastPnPTime > 60_000 : false;
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <div>
          <TooltipIconButton
            label={translate('Info')}
            icon={<Info />}
            shortcut="i"
            onClick={() => setOpen(true)}
            className={isOld ? 'bg-warning' : ''}
          />
        </div>
      </PopoverTrigger>
      <PopoverContent>
        <BoundsInfo />
      </PopoverContent>
    </Popover>
  );
}
