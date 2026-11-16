/** Opens a pattern value's box under the chip or dimension double-clicked, with its text selected to type over. */
export function openPatternField(input: HTMLInputElement | undefined, chip: Element) {
  const box = input?.closest('label');
  if (!input || !(box instanceof HTMLElement)) return;
  const at = chip.getBoundingClientRect();
  box.dataset.open = '';
  box.style.left = `${at.left}px`;
  box.style.top = `${at.bottom + 4}px`;
  input.focus();
  input.select();
}
