# companion-surface-barco-ec50

A [Bitfocus Companion](https://bitfocus.io/companion) surface module for the keyboard of the
**Barco EC-50** event controller: 82 keys, 45 LCD keys with RGB backlight, key LEDs, the T-bar and
the console's script/work lights. The built-in touchscreen is a plain monitor and is out of scope.

Tested with Companion 5.0.6 on Windows on a real EC-50. The Linux/macOS (libusb) path builds but
has not been tried on hardware yet. See [companion/HELP.md](companion/HELP.md) for user setup and
settings.

## Features

- Every key as a Companion button. LCD keys show the button image (64×32 mono) with the button
  colour as backlight; a black button with text gets a white backlight so the text stays readable.
- Key LEDs: keys without an LCD show the button colour (blue-only keys blue, the others red or
  green) and light while the button is active: pressed, latched, or its actions still running
  (read from Companion's top bar and its running icon). On LCD keys the LED shows the active state.
- T-bar as a variable, with a bottom deadzone and adjustable output range.
- Output variables for Script Light, Work Light and LED brightness (0–255, as in the Toolset).
  Companion's surface brightness sets the LCD brightness.
- Surface settings: hide Companion's row/column numbers (default on, gives the button the whole
  LCD), and blank empty buttons with the backlight on.

## Hardware

- USB: an FTDI chip in MPSSE mode with Barco's own vendor id 0x0600, product 0x0336
  ("EC Show Board"), in front of an Intel/Altera MAX 10 FPGA accessed as 32-bit registers over SPI.
- Windows: Barco's signed FTDI driver owns the device, so the module uses FTDI's D2XX library
  (`ftd2xx.dll`, installed with that driver) through [koffi](https://koffi.dev). Linux and macOS
  use libusb.
- Only one program can use the console at a time: close Event Master Toolset first.

## Layout

| Rows | Columns 0–11          | 12              | 13–14   | 15–17                                |
| ---- | --------------------- | --------------- | ------- | ------------------------------------ |
| 0    | Destinations 1–12     |                 | page ▲▼ | Freeze PGM, Arm, Layer Trans         |
| 1    | Layers BG, 1–8        |                 | page ▲▼ | Freeze PVW, Match, Layer Cut         |
| 2–4  | Assign rows 1–3 (LCD) | row label (LCD) | page ▲▼ | show-config LCD keys, Cut, All Trans |

Companion's button grid needs at least 18 columns × 5 rows for the whole surface.

## Development

Requires Node 22 and Yarn 4 (`corepack enable`).

```bash
yarn install
yarn build
yarn test
yarn lint
```

Load it into Companion as a developer module: set Companion's developer modules folder to the
parent folder of this repository, then add the _Barco EC-50_ surface integration under
Surfaces.

The module needs surface API 1.3 or older to load in Companion 5.0.x, so
`@companion-surface/base` is pinned to `~1.3.0`.

### Linux

```bash
sudo cp linux/99-barco-ec50.rules /etc/udev/rules.d/
sudo udevadm control --reload-rules && sudo udevadm trigger
```

Then unplug and replug the EC-50.

## License

MIT
