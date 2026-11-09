import { createPlateDocument, parseCadDocument } from '@wbcnc/cad';
import { describe, expect, it } from 'vitest';
import { designFileName, designFileText } from './designFile';
import { kDesignFile } from './jobDb';
import { createJobFromFile } from './openModelFile';

describe('design files', () => {
  it('saves the whole design so that opening the file gives it back unchanged', async () => {
    const document = { ...createPlateDocument({ width: 100, height: 60, thickness: 12 }), name: 'Shelf side' };
    const text = designFileText(document);
    expect(parseCadDocument(JSON.parse(text))).toEqual(document);
    const job = await createJobFromFile(new File([text], designFileName(document)));
    expect(job.origin).toEqual({ kind: 'designFile', fileName: 'Shelf side.json' });
    expect(job.design!.draft).toEqual({ ...document, name: job.name });
  });

  it('names the file after the design, without characters a file system refuses', () => {
    expect(designFileName({ name: 'Shelf / side: v2?' })).toBe('Shelf - side- v2.json');
    expect(designFileName({ name: '  ' })).toBe('design.json');
    expect(kDesignFile.test(designFileName({ name: 'Regal' }))).toBe(true);
  });
});
