import { design } from '@wbcnc/cad-script';
export default design(d => {
  const p = d.part('Plate', { thicknes: 18 });
  p.profile.rect({ at: [0, 0], width: 400, h: 300 });
  p.profile.circl({ at: [30, 30], d: 8 });
});
