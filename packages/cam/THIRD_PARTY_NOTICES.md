# STEP reader third-party notices

camNC reads STEP files with the unmodified JavaScript bindings and separate
WebAssembly module from **`occt-import-js` 0.0.23**, which is built from Open
CASCADE Technology (OCCT). It loads only when a STEP file is opened, in the CAM
worker. The surrounding application is Apache-2.0; that license does not replace
the licenses below. All files in this notice's `licenses/` directory are also
distributed at `/licenses/occt-import-js/` in the built web application, with
this notice named `THIRD_PARTY_NOTICES.md`.

camNC makes use of facilities provided by the Open CASCADE Technology software.

## occt-import-js

- By Viktor Kovács (GitHub `kovacsv`); its source files carry no separate
  copyright line. Licensed under the GNU Lesser General Public
  License version 2.1, in `occt-import-js-LGPL-2.1.txt` (the package's
  `LICENSE.md`, byte-identical).
- Published package: https://www.npmjs.com/package/occt-import-js/v/0.0.23
- Pinned source: https://github.com/kovacsv/occt-import-js/tree/c2148e54b456b571238d35cac037d304053d64b2
  (tag `0.0.23`). The distributed `occt-import-js.wasm` is byte-identical to the
  one committed at that tag.

The accompanying `occt-import-js-0.0.23-source.tgz` is `git archive` of that tag:
the C++ interface and its example, its CMake build, the build scripts and CI
workflows, and the license. It leaves out the prebuilt `dist/` and the tests. The tag's `occt` submodule pins the
OCCT source it is built from.

## Open CASCADE Technology

- OCCT 7.6.1, commit `d2abb6d844231cb8f29be6894440874a4700e4a5` (tag `V7_6_1`).
  Licensed under the GNU Lesser General Public License version 2.1 in
  `OCCT-LGPL-2.1.txt`, with the Open CASCADE exception version 1.0 in
  `OCCT-LGPL-Exception-1.0.txt`. Copyright (c) Open CASCADE SAS and the
  contributors named in its source files.
- Source: https://git.dev.opencascade.org/gitweb/?p=occt.git;a=commit;h=d2abb6d844231cb8f29be6894440874a4700e4a5
  and its mirror https://github.com/Open-Cascade-SAS/OCCT/tree/d2abb6d844231cb8f29be6894440874a4700e4a5.
  The OCCT source is large and is not yet bundled with this application; it is
  available from the links above.

## Rebuilding and replacing the library

To rebuild, extract the source archive, check out OCCT at the commit above into
its `occt/` folder, and follow its README: `tools/setup_emscripten_win.bat`
installs Emscripten 3.1.69, and `tools/build_wasm_win_release.bat` builds
`occt-import-js.js` and `occt-import-js.wasm` with CMake. A bit-identical
reproduction of the upstream binary is not asserted.

To use a modified library, replace the dependency with your rebuilt package and
rebuild camNC. The Emscripten loader is bundled into the CAM worker, so swapping
only the separately served `occt-import-js-*.wasm` asset works only for a rebuild
with identical exports and loader. The application's adapter
source is in `packages/cam/src/import.ts`. Nothing in the application's license
restricts reverse engineering needed to debug modifications to this LGPL library.

## Compiled-in build dependencies

- **Emscripten 3.1.69**: MIT and University of Illinois/NCSA dual license,
  `Emscripten-3.1.69-LICENSE.txt`. Copyright (c) 2010-2014 Emscripten authors.
  https://github.com/emscripten-core/emscripten/tree/3.1.69

These notices describe the STEP reader's known upstream build dependencies, not a
complete license inventory for every package in the application. The original
copyright and license notices remain in the accompanying source files.
