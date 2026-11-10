import { design } from '@wbcnc/cad-script';

// Change to the open cupboard: 800 wide, 900 tall, three evenly spaced shelves instead of one.
// Shelf underside heights k*(height - board)/4 for k = 1..3 give four equal gaps between the
// bottom and top panels; the shelf is one step of that spacing, and pattern copies the rest.
export default design(d => {
  d.variable('width', '800mm');
  d.variable('height', '900mm');

  const shelf = d.part('Shelf');
  shelf.drawOn('top', { offset: '(height - board)/4' });
  shelf.pattern({ axis: 'z', count: 3, spacing: '(height - board)/4' });
});
