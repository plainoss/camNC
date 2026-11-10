import { design } from '@wbcnc/cad-script';

export default design(d => {
  const seat = d.part('Seat');
  const p: any = seat.profile;
  const a = p.find('5cc1');
  throw new Error('FIND ' + JSON.stringify(a) + ' ' + String(p.find).slice(0, 300) + String(p.fillet).slice(0, 300));
});
