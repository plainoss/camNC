import { t as translate } from '@wbcnc/i18n';
import { Button } from '@wbcnc/ui/components/button';
import { getPocketsGcode } from './arucoPocketsGcode';

export function DownloadGcodeButton({ points, tagSize }: { points: { x: number; y: number }[]; tagSize: number }) {
  function handleClick(e: React.MouseEvent<HTMLButtonElement>) {
    e.preventDefault();
    e.stopPropagation();
    const gcode = getPocketsGcode(points, 30);
    const filename = 'pockets.gcode';
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([gcode], { type: 'text/plain' }));
    a.download = filename;
    a.click();
    // Revoke after the download has been triggered.
    setTimeout(() => URL.revokeObjectURL(a.href));
  }
  const disabled = tagSize !== 30;
  return (
    <Button variant="secondary" onClick={handleClick} disabled={disabled}>
      {translate('Generate pockets gcode ')}
      {disabled ? translate('(30mm only)') : ''}
    </Button>
  );
}
