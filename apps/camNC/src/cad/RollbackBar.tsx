/** Keyboard moves one actual feature even while its folder is closed. */
export function RollbackBar({
  stepId,
  stepIds,
  onRollTo,
  onMenu,
  label = 'Shown up to here',
}: {
  stepId: string | null;
  stepIds: string[];
  onRollTo?: (stepId: string | null) => void;
  onMenu: (x: number, y: number) => void;
  label?: string;
}) {
  return (
    <div
      className="cad-rollback-bar"
      role="separator"
      aria-label={label}
      aria-orientation="horizontal"
      tabIndex={onRollTo ? 0 : undefined}
      draggable={!!onRollTo}
      title={onRollTo ? 'Drag, or use the arrow keys, to show the design up to a step. Right-click to roll to the end.' : undefined}
      onDragStart={event => {
        event.dataTransfer.setData('text/x-cad-rollback', '');
        event.dataTransfer.effectAllowed = 'move';
      }}
      onKeyDown={event => {
        if (!onRollTo || (event.key !== 'ArrowUp' && event.key !== 'ArrowDown')) return;
        event.preventDefault();
        event.stopPropagation();
        const at = stepId ? stepIds.indexOf(stepId) : stepIds.length - 1;
        const to = at + (event.key === 'ArrowUp' ? -1 : 1);
        if (to >= 0 && to < stepIds.length) onRollTo(to === stepIds.length - 1 ? null : stepIds[to]!);
      }}
      onContextMenu={event => {
        if (!onRollTo) return;
        event.preventDefault();
        onMenu(event.clientX, event.clientY);
      }}
    />
  );
}
