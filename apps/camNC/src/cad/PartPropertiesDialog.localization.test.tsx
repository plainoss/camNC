import { afterEach, expect, it } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import { createCadPart } from '@wbcnc/cad';
import { i18n } from '@wbcnc/i18n';
import { PartPropertiesDialog } from './PartPropertiesDialog';

afterEach(async () => {
  cleanup();
  await i18n.changeLanguage('en');
});
it('localizes property labels, empty material and the Close control, keeping the part name', async () => {
  await i18n.changeLanguage('fr');
  const view = render(<PartPropertiesDialog part={createCadPart()} name="Custom part 17" onClose={() => {}} />);
  expect(view.getByRole('button', { name: 'Fermer' })).toBeTruthy();
  expect(view.getByLabelText('Révision')).toBeTruthy();
  expect(view.getByLabelText('Fournisseur')).toBeTruthy();
  expect(view.getByLabelText('Projet')).toBeTruthy();
  expect(view.getByLabelText('Nom').getAttribute('value')).toBe('Custom part 17');
  expect(view.getByLabelText('Matériau').getAttribute('value')).toBe('Aucun');
});
