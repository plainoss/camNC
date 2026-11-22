import { t as translate } from '@wbcnc/i18n';
import { useStore } from '@/store/store';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@wbcnc/ui/components/alert-dialog';
import { Button } from '@wbcnc/ui/components/button';
import { Input } from '@wbcnc/ui/components/input';
import { Trash2 } from 'lucide-react';
import { useState } from 'react';

/** Renames on Enter or when the field loses focus; Escape restores the saved name. */
export function CameraNameInput({ id, name }: { id: string; name: string }) {
  const updateCamSource = useStore(state => state.updateCamSource);
  const [value, setValue] = useState(name);
  function save() {
    const trimmed = value.trim();
    if (!trimmed) setValue(name);
    else if (trimmed !== name) updateCamSource(id, { name: trimmed });
  }
  return (
    <Input
      aria-label={translate('Camera name')}
      className="font-medium"
      value={value}
      onChange={e => setValue(e.target.value)}
      onBlur={save}
      onKeyDown={e => {
        if (e.key === 'Enter') e.currentTarget.blur();
        if (e.key === 'Escape') {
          setValue(name);
          e.currentTarget.blur();
        }
      }}
    />
  );
}

export function DeleteCameraButton({ id, name, onDeleted }: { id: string; name: string; onDeleted?: () => void }) {
  const deleteCamSource = useStore(state => state.deleteCamSource);
  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button variant="ghost" size="sm" aria-label={translate('Delete {{name}}', { name: name })}>
          <Trash2 />
          {translate(' Delete ')}
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            {translate('Delete "')}
            {name}&quot;?
          </AlertDialogTitle>
          <AlertDialogDescription>
            {translate('Its source, calibration and markers are removed. This cannot be undone.')}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{translate('Cancel')}</AlertDialogCancel>
          <AlertDialogAction
            onClick={() => {
              deleteCamSource(id);
              onDeleted?.();
            }}
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
            {translate('Delete ')}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
