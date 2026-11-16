import notice from '../../../../packages/cam/THIRD_PARTY_NOTICES.md?raw';
import readerLgpl from '../../../../packages/cam/licenses/occt-import-js-LGPL-2.1.txt?raw';
import occtLgpl from '../../../../packages/cam/licenses/OCCT-LGPL-2.1.txt?raw';
import occtException from '../../../../packages/cam/licenses/OCCT-LGPL-Exception-1.0.txt?raw';
import emscripten from '../../../../packages/cam/licenses/Emscripten-3.1.69-LICENSE.txt?raw';
import manifestText from '../../../../packages/cam/licenses/manifest.json?raw';

const base = '/licenses/occt-import-js/';
const manifest = JSON.parse(manifestText) as {
  version: string;
  occtVersion: string;
  sourceArchive: string;
  upstreamSource: string;
  occtSource: string;
};

/** The STEP reader CAM loads when a STEP file is opened: occt-import-js, built from Open CASCADE Technology. */
export const stepReaderDistribution = {
  notice,
  noticeUrl: `${base}THIRD_PARTY_NOTICES.md`,
  sourceUrl: `${base}${manifest.sourceArchive}`,
  upstreamSource: manifest.upstreamSource,
  occtSource: manifest.occtSource,
  manifestUrl: `${base}manifest.json`,
};

export const stepReaderLicenses = [
  {
    id: 'occt-import-js',
    name: `occt-import-js ${manifest.version}`,
    description: 'JavaScript and WebAssembly STEP reader, by Viktor Kovács.',
    license: 'LGPL 2.1',
    text: readerLgpl,
    url: `${base}occt-import-js-LGPL-2.1.txt`,
  },
  {
    id: 'occt',
    name: `Open CASCADE Technology ${manifest.occtVersion}`,
    description: 'Geometry library the STEP reader is built from. Copyright © Open CASCADE SAS and contributors.',
    license: 'LGPL 2.1',
    text: occtLgpl,
    url: `${base}OCCT-LGPL-2.1.txt`,
  },
  {
    id: 'occt-exception',
    name: 'Open CASCADE exception 1.0',
    description: 'The additional permission Open CASCADE Technology grants with its LGPL 2.1 license.',
    license: 'Exception to LGPL 2.1',
    text: occtException,
    url: `${base}OCCT-LGPL-Exception-1.0.txt`,
  },
  {
    id: 'emscripten-step',
    name: 'Emscripten 3.1.69',
    description: 'WebAssembly build runtime of the STEP reader. Copyright © 2010–2014 Emscripten authors.',
    license: 'MIT / University of Illinois NCSA',
    text: emscripten,
    url: `${base}Emscripten-3.1.69-LICENSE.txt`,
  },
] as const;
