import { design } from '@wbcnc/cad-script';

export default design(d => {
  const seat = d.part('Seat');
  const p: any = seat.profile;
  const names: string[] = [];
  for (let o = p; o && o !== Object.prototype; o = Object.getPrototypeOf(o)) names.push(...Object.getOwnPropertyNames(o));
  throw new Error('METHODS ' + names.join(','));
});
