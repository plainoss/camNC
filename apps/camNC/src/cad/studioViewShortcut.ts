/** Named camera requests shared by the studio's keyboard handler. */
export function studioViewShortcut(event: { shiftKey: boolean; code: string; key: string }) {
  const views = ['front', 'back', 'left', 'right', 'top', 'bottom', 'iso'] as const;
  return event.shiftKey
    ? /^Digit[1-7]$/.test(event.code)
      ? views[Number(event.code.slice(-1)) - 1]
      : undefined
    : event.key.toLowerCase() === 'f'
      ? ('fit' as const)
      : undefined;
}
