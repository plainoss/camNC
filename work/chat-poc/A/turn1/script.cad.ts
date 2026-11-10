import { design } from '@wbcnc/cad-script';

export default design(d => {
  d.variable('width', '800mm');
  d.variable('height', '900mm');
  d.variable('shelves', '3');
  // Clear gap between neighbouring boards, inside the top and bottom panels.
  d.variable('gap', '(height - 2*board - shelves*board)/(shelves + 1)');
  const shelf = d.part('Shelf');
  shelf.drawOn('top', { offset: 'board + gap' });
  shelf.pattern({ axis: 'z', count: 'shelves', spacing: 'gap + board' });
});
