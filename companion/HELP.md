## Barco EC-50

Uses the keyboard section of a Barco EC-50 as a Companion surface: the destination and layer keys,
the three Assign rows with their LCD keys, the transition keys and the T-bar. The built-in
touchscreen is a normal monitor and is not handled by this module.

### Setup

- **Close the Barco Event Master Toolset.** Only one program can use the EC-50 at a time.
- **Windows:** nothing to install if the Event Master Toolset is installed; the module uses the
  same Barco/FTDI driver. Otherwise install Barco's EC-50 USB driver. Don't replace it with WinUSB.
- **Linux:** add a udev rule so Companion may open the device, then replug the EC-50:
  `SUBSYSTEM=="usb", ATTR{idVendor}=="0600", ATTR{idProduct}=="0336", MODE="0666"`
- Companion's button grid needs at least **18 columns × 5 rows** for the whole surface
  (Settings → Buttons → Grid Size).

### Keys and LCDs

- The 45 LCD keys show the button (64×32, black and white) with the button colour as backlight.
  The backlight has 2 bits per colour, so colours are approximate. A black button with text gets a
  white backlight so the text stays readable.
- Keys without an LCD light their LED in the button colour: destination and other blue-only keys
  light blue, the others red or green (they have no amber).
- The LED also lights while a button is active: pressed, latched, or its actions still running.
  On LCD keys the LED shows only that.

### Surface settings

| Setting                           | Default |                                                              |
| --------------------------------- | ------- | ------------------------------------------------------------ |
| Hide row/column numbers           | on      | Removes Companion's top bar so the button uses the whole LCD |
| Blank empty buttons, backlight on | on      | Unused LCD keys stay lit and empty; off: they go dark        |
| T-bar bottom deadzone (%)         | 2       | Travel from the bottom that still reports the bottom value   |
| T-bar value at bottom / top       | 0 / 100 | Output range; set top below bottom to invert                 |
| T-bar decimal places              | 1       | Rounding of the T-bar value                                  |

Companion's surface **Brightness** sets the LCD brightness.

### Variables

- **T-bar position** (input): choose a custom variable to receive the T-bar value.
- **Script Light Brightness**, **Work Light Brightness**, **LED Brightness** (outputs, 0–255): set
  them to a value or expression to drive the console lights and the key LED brightness, like the
  sliders in the Toolset's User Preferences.
