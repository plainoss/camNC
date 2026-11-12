<div align="center">

# camNC

**See your CNC toolpath on the real machine bed. Then cut it.**

[![Launch web app](https://img.shields.io/badge/Launch-web%20app-7c3aed?style=for-the-badge)](https://run.camnc.app/)

[![Desktop app](https://img.shields.io/badge/desktop-macOS%20%C2%B7%20Windows%20%C2%B7%20Linux-2ea44f)](#desktop-app-recommended)
[![FluidNC](https://img.shields.io/badge/FluidNC-3.9.9%20%C2%B7%204.1.x-555)](#run-the-job-from-the-same-screen)
[![camNC Labs](https://img.shields.io/badge/Labs-highly%20experimental-d97706)](#camnc-labs-highly-experimental)

| Camera image (wide-angle lens, rotated to match)                                                                       | camNC top view of the same frame, with the toolpath                                                                                    |
| ---------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| <img alt="Raw camera image of the bed with lens distortion and perspective" src="docs/images/readme/camera-raw.jpg" /> | <img alt="Corrected top view of the same frame with a knife block toolpath, colored by depth" src="docs/images/readme/top-view.jpg" /> |

_The raw camera image (left, rotated to match) and camNC's corrected top view of the same frame with a toolpath on the bed_

</div>

camNC shows your CNC toolpath on a live camera image of the machine bed, so you can check stock placement, offsets and
clamps before the spindle starts, and preview the cut in 3D first. Newer, still highly experimental tools run the job on
FluidNC and design and plan parts in the same app: see [camNC Labs](#camnc-labs-highly-experimental).

camNC is built for the [V1 Engineering LowRider V4](https://docs.v1e.com/lowrider/) running FluidNC, and that is the
machine it is tested on. It should work just as well on other FluidNC machines.

[![camNC cutting a small oak board (YouTube)](https://img.youtube.com/vi/KKgJ9J6dmqE/0.jpg)](https://www.youtube.com/watch?v=KKgJ9J6dmqE)

_Cutting a small oak board with camNC (YouTube)_

This repository is a pnpm/Turborepo monorepo with the camNC app, its desktop version and the supporting packages.

## See the toolpath where it will cut

Mount a camera above the machine (an old phone, a webcam or an IP camera) and print four ArUco markers. camNC calibrates
the camera with OpenCV, finds its pose from the markers and corrects lens distortion and perspective, so you get a
top-down view in machine coordinates with the G-code drawn on top. Drag the toolpath onto the stock and check clamps and
offsets before the spindle starts.

## Preview the cut in 3D

The 3D, front and side views simulate the stock being cut with flat, ball and V-bits. Scrub through the job on the
timeline, scale Z to spot shallow passes, and project the camera image onto the stock.

https://github.com/user-attachments/assets/72eb52e3-9d17-4891-b868-672bbb155564

<img alt="3D material removal preview of a knife block finished with a 6 mm ball end mill" src="docs/images/readme/removal-ball.jpg" />

## No camera yet?

Start with just FluidNC. camNC draws the bed from the machine size it reports, with a 10 mm grid in machine coordinates,
and you can jog, preview and run jobs right away. Add a camera later.

<img alt="The drawn machine bed with the toolpath, without a camera" src="docs/images/readme/no-camera.jpg" />

## Hide the machine

This experimental feature estimates monocular depth with the Depth Anything V2 model and masks everything above the work
surface, so the gantry disappears from the image (only tested with the [LowRider V4 beam](https://docs.v1e.com/lowrider/)).
It assumes the largest depth cluster is the table and masks everything above a configurable offset:

https://github.com/user-attachments/assets/a89cd4fe-92ce-4c37-b2a1-7ad5d3012fee

## How accurate is it?

Three crosses engraved one after another, each positioned by drag-and-drop on the camera image. Y is off by 1–2 mm, X
lines up well. The setup used an old Pixel 5 on a ~120×60 cm [MPCNC LowRider V4](https://docs.v1e.com/lowrider/), with a
reprojection error of around 2:

https://github.com/user-attachments/assets/0c16f067-9cb2-4bc9-9941-f04e23f4bc24

## camNC Labs (highly experimental)

> [!WARNING]
> These features are new and highly experimental. They have had very little time on real machines. Check every
> toolpath in Plan and on the camera image before you cut, and expect missing features and breaking changes.

| Feature                                                                                           | Status                 | Screenshot                                                                                                               |
| ------------------------------------------------------------------------------------------------- | ---------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| **[Toolpath on the camera image](#see-the-toolpath-where-it-will-cut)**<br>top view, drag to zero | Stable                 | <img width="260" alt="Corrected top view with a toolpath" src="docs/images/readme/top-view.jpg" />                       |
| **[FluidNC controls](#run-the-job-from-the-same-screen)**<br>home, jog, probe, run                | 🧪 Highly experimental | <img width="260" alt="Machine panel next to the camera view" src="docs/images/readme/labs-fluidnc.jpg" />                |
| **[CAM for STEP models](#plan-cuts-for-a-step-model)**<br>lay flat, nest, pockets, simulate       | 🧪 Highly experimental | <img width="260" alt="Simulated cut of a STEP shelf's parts on one board" src="docs/images/readme/labs-step-plan.jpg" /> |
| **[Simple CAD and carving](#design-parts-and-carvings)**<br>Part Studio, V-carve text             | 🧪 Highly experimental | <img width="260" alt="A cupboard in the Part Studio" src="docs/images/readme/labs-cad.jpg" />                            |
| **[AI carves and 3D models](#ai-assistants-bring-your-own-key)**<br>bring your own API key        | 🧪 Highly experimental | <img width="260" alt="A generated tray shown for review before applying" src="docs/images/readme/labs-ai-model.jpg" />   |

See [Status](docs/STATUS.md) for supported tools, current limits and known gaps.

### Run the job from the same screen

camNC talks to FluidNC (3.9.9 and 4.1.x) directly. Home, jog, set XY zero to the toolpath, probe Z and run the job from
the SD card. A checklist catches a missed home or probe, and a green line on the camera image shows how far the job has
got. Feed and spindle overrides, macros and a console are one click away.

<img alt="The machine panel with jog, probe and the loaded job next to the camera view" src="docs/images/readme/labs-fluidnc.jpg" />

<img alt="A job running at 52 %, with progress drawn on the toolpath and the machine panel open" src="docs/images/readme/fluidnc-job.jpg" />

### Plan cuts for a STEP model

Open a STEP file of an assembled piece. camNC finds its flat parts, their pockets, grooves and outlines, and lays them
flat. Arrange them on boards, choose how they are held, then plan and simulate the cuts in 3D before taking the job to
the machine. **Open sample project** in CAM loads a small shelf to try it.

| Parts found in the model                                                                                          | The planned cut, simulated                                                                   |
| ----------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| <img alt="The parts of a STEP shelf with their detected features" src="docs/images/readme/labs-step-model.jpg" /> | <img alt="Simulated cut of the shelf's parts" src="docs/images/readme/labs-step-plan.jpg" /> |

### Design parts and carvings

Choose **New design** in CAM to build parts in the Part Studio: sketch with lines, arcs, dimensions and constraints,
then extrude, cut, pattern and mirror them. Tool choices, stock and holding stay with the project when you change the
design. **New carving** lays out text and artwork for a V-bit.

<img alt="A cupboard with shelf pin holes in the Part Studio" src="docs/images/readme/labs-cad.jpg" />

### AI assistants (bring your own key)

Describe a carving or a part, and an assistant draws it using your own Anthropic or OpenAI API key. The key stays in
your browser. Carving artwork is traced and checked for the V-bit, and a design change opens for review in 3D. Nothing
is applied until you accept it, and you should still check the cut in Plan.

| Carving assistant                                                                                          | Design assistant                                                                                               |
| ---------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| <img alt="Generated owl artwork variants on a carving board" src="docs/images/readme/labs-carve-ai.jpg" /> | <img alt="A generated pebble tray in the review before applying" src="docs/images/readme/labs-ai-model.jpg" /> |

## Getting started

**Explore the demo:** the [demo](https://run.camnc.app/demo) runs in your browser with a recorded machine camera, a sample
job and a simulated FluidNC. You can load your own G-code, and nothing is saved.

To use camNC with your own machine, pick one of these:

### Desktop app (recommended)

Download the installer for your computer:

- [macOS (Apple silicon)](https://github.com/plainoss/camNC/releases/latest/download/camNC-macOS-AppleSilicon.dmg)
- [Windows (64-bit)](https://github.com/plainoss/camNC/releases/latest/download/camNC-Windows-x64-setup.exe)
- [Linux (64-bit, `.deb`)](https://github.com/plainoss/camNC/releases/latest/download/camNC-Linux-x64.deb)

These always point to the newest build; all versions are on the
[releases page](https://github.com/plainoss/camNC/releases).

The desktop app is camNC with its own Chromium built in. It finds IP cameras on your network (ONVIF, or any camera with
RTSP) and connects to them directly, so you don't need a Raspberry Pi, go2rtc or any other gateway. It also talks to
FluidNC without browser restrictions and works offline. On macOS and Windows it updates itself in the background (the
update is used after the next restart); on Linux, install a newer `.deb` from the releases.

The app is not code-signed yet, so the first start shows a warning:

- **macOS:** open the app once, then allow it under System Settings → Privacy & Security → _Open Anyway_. Or run
  `xattr -dr com.apple.quarantine /Applications/camNC.app`.
- **Windows:** SmartScreen warns about an unknown publisher; choose _More info_ → _Run anyway_.

Settings stay on your computer; there is no sign-in or sync in the desktop app. See
[apps/camnc-desktop](apps/camnc-desktop/README.md) for building it yourself.

### In the browser

Open [run.camnc.app](https://run.camnc.app/), no install needed. Phone cameras and webcams work out of the box. For
machine control, use Chrome or Edge 147+ on the same network as the controller (FluidNC in STA mode); other browsers can
use camNC as a viewer.

Browsers can't open an IP camera's RTSP stream. To use an IP camera in the browser, run a
[go2rtc](https://github.com/AlexxIT/go2rtc) gateway that re-streams it over WebRTC, for example on a Raspberry Pi Zero
or any computer on your network, and pick the _go2rtc_ source in camNC. The desktop app makes this unnecessary.

## What you need

| Part                        | Notes                                                                                                                                                                                                                                                                                                                   |
| --------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Camera with a top-down view | An old smartphone ([ceiling mount](https://makerworld.com/en/models/1455114-ceiling-top-down-phone-mount-with-ball-joint#profileId-1516416)), a webcam, or an IP camera such as a Reolink E1 Zoom ([mount](https://makerworld.com/en/models/1461605-reolink-e1-zoom-ceiling-down-mount-looking-down#profileId-1524062)) |
| Four ArUco markers          | Printed and fixed at known machine positions; camNC uses them to find the camera pose and keep it up to date                                                                                                                                                                                                            |
| Calibration chessboard      | Printed or shown on a screen, used once per camera during setup                                                                                                                                                                                                                                                         |
| FluidNC controller          | Optional. 3.9.9 or 4.1.x, for machine control (reference machine: V1 Engineering Jackpot2 on a LowRider V4)                                                                                                                                                                                                             |

## Repository layout

This workspace is a pnpm/Turborepo monorepo split into two top‑level folders:

- `apps/` – runnable applications.
- `packages/` – reusable libraries and config used by the apps.

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for how the pieces fit together.

### Apps

- **camNC** – main camera overlay application ([run.camnc.app](https://run.camnc.app/)).
- **camnc-desktop** – the desktop app: camNC packaged with Tauri and CEF, with a go2rtc sidecar for IP cameras.
- **webrtc-cam** – runs on a phone and streams its camera to camNC via WebRTC.
- **website** – Astro landing page ([www.camnc.app](https://www.camnc.app/)).
- **chessboard** – displays/prints the chessboard pattern for camera calibration.
- **demos** – sandbox showcasing individual packages.
- **signal** – Cloudflare Worker that relays WebRTC signalling between camNC and phone cameras.

### Packages

- **camera-calibration** – React components, store and workers for calibrating a camera with OpenCV.
- **fluidnc** – direct WebSocket connection to FluidNC (transport detection, command queue, parsers, uploads), a scripted fake and the `pnpm sim` FluidNC simulator.
- **go2webrtc** – video sources (go2rtc, RTSP via the desktop app's go2rtc, phone via WebRTC, WebTorrent, webcam, URL).
- **webrtc-channel** – WebRTC peer, WebSocket signalling client and data channel helpers.
- **video-worker-utils** – helpers for processing video frames in web workers.
- **load-opencv** – loads OpenCV.js in the browser.
- **ui** – shared React UI components.
- **public-config** – shared public configuration (signalling URL).
- **typescript-config** – shared tsconfig presets. Lint rules are in [`.oxlintrc.json`](.oxlintrc.json).

## Development

Requirements: Node.js (see [`.nvmrc`](.nvmrc), `>=22.12`) and pnpm (version pinned in `package.json`, e.g. via
`corepack enable`). pnpm 12 ships no standalone macOS binary, so a pnpm 10 install can't switch to it: use corepack or
`npm install -g pnpm@<pinned version>`.

```bash
pnpm install
# Start a single app, e.g. camNC (see apps/camNC/README.md for required env vars)
pnpm dev --filter @wbcnc/camNC
# Or start all apps at once
pnpm dev
```

Checks (also run in CI):

```bash
pnpm run check-format  # Biome for TypeScript, Prettier for Markdown (a pre-commit hook formats staged files)
pnpm run lint          # oxlint
pnpm run check-types   # tsc --noEmit (TypeScript 7) in every package
pnpm run test          # functional tests, then isolated performance gates
pnpm run test:performance # only the performance gates (Node, then headless Chromium)
pnpm run build
```

Tests run in the browser, so install Chromium once with `pnpm exec playwright install chromium`. Run a single
package's tests with `pnpm turbo run test --filter <package>`.

The `[performance]` tests run separately from the parallel functional suites. The root test command waits for
all functional packages to finish, then runs the holding and nesting benchmarks one package at a time, in their
usual Node and Chromium runtimes. Benchmark results are not cached. Each gate keeps its fixed reference workload
and ratio limit; both workloads are warmed, and seven nearby pairs alternate order before taking the median ratio.
Run `pnpm --filter <package> test:performance` for one package's performance gates. Avoid running other CPU-heavy
commands alongside these measurements.
