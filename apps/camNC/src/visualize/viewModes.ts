import { t as translate } from '@wbcnc/i18n';
import { DepthViewPreset } from './DepthInspector';

export type ViewMode = 'top' | DepthViewPreset;

export const kViewModes: ViewMode[] = ['top', '3d', 'front', 'side'];

export const kViews: Record<ViewMode, { label: string; name: string; shortcut: string }> = {
  top: { label: translate('Top'), name: translate('Top View'), shortcut: '1' },
  '3d': { label: '3D', name: '3D View', shortcut: '2' },
  front: { label: translate('Front'), name: translate('Front View (XZ)'), shortcut: '3' },
  side: { label: translate('Side'), name: translate('Side View (YZ)'), shortcut: '4' },
};

export function viewModeTitle(view: ViewMode) {
  return kViews[view].name;
}
