import { t as translate } from '@wbcnc/i18n';
/** What to drop instead of a file we can't open: CAM pages take models, the rest G-code (or a model to start CAM). */
export function wrongFileMessage(pathname: string) {
  return pathname.startsWith('/cam')
    ? translate('Drop a STEP or STL model (.step, .stp, .stl) or a camNC design (.json) to start a CAM job.')
    : translate('Drop a G-code file (.gcode or .nc), or a STEP/STL model or camNC design to start a CAM job.');
}
