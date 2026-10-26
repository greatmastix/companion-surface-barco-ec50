import assert from 'node:assert/strict'
import { TOPBAR_ROWS, fitLcdImage, hasTopbar, isActive, isRunning, topbarState } from './lcdimage.js'
import { DEFAULT_SETTINGS, parseSettings, scaleTbar } from './settings.js'

// T-bar: bottom end stop 64640, top 80. Default: 2% deadzone, 0-100, one decimal.
assert.equal(scaleTbar(64640, DEFAULT_SETTINGS), 0)
assert.equal(scaleTbar(64640 - 0.015 * 64560, DEFAULT_SETTINGS), 0) // inside the deadzone
assert.equal(scaleTbar(80, DEFAULT_SETTINGS), 100)
assert.equal(scaleTbar(64640 - 0.51 * 64560, DEFAULT_SETTINGS), 50)
assert.equal(scaleTbar(0, DEFAULT_SETTINGS), 100)
// Rescaled and inverted, whole numbers
const inverted = parseSettings({ tbarMin: 255, tbarMax: 0, tbarDecimals: 0, tbarDeadzone: 0 })
assert.equal(scaleTbar(64640, inverted), 255)
assert.equal(scaleTbar(80, inverted), 0)
// Missing or junk config falls back to defaults
assert.deepEqual(parseSettings({}), DEFAULT_SETTINGS)
assert.deepEqual(parseSettings({ tbarMax: 'x', hideLocation: 'yes' }), DEFAULT_SETTINGS)

// Images: 64 wide, 32 + 14 rows, as Companion draws them (from a dump of a real draw)
const W = 64
const H = 32 + TOPBAR_ROWS
function image(fill: (x: number, y: number) => [number, number, number]): Uint8Array {
	const rgb = new Uint8Array(W * H * 3)
	for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) rgb.set(fill(x, y), (y * W + x) * 3)
	return rgb
}
const black = { r: 0, g: 0, b: 0 }
// Empty button: location text in the bar, grey separator on row 13, nothing below
const empty = image((x, y) => (y === 13 ? [60, 60, 60] : y === 5 && x < 20 ? [90, 90, 90] : [0, 0, 0]))
assert.ok(hasTopbar(empty, W))
assert.equal(fitLcdImage(empty, W, 32, black, true).empty, true)
// Red button with a label: bar is black, button area red, text white on row 30
const red = image((x, y) => (y < 13 ? [0, 0, 0] : y === 30 && x > 10 && x < 50 ? [255, 255, 255] : [255, 0, 0]))
assert.ok(hasTopbar(red, W))
const fitted = fitLcdImage(red, W, 32, { r: 255, g: 0, b: 0 }, true)
assert.equal(fitted.empty, false)
assert.deepEqual([...fitted.rgb.subarray(0, 3)], [255, 0, 0]) // cropped: first row is the button
assert.deepEqual([...fitted.rgb.subarray((16 * W + 20) * 3, (16 * W + 20) * 3 + 3)], [255, 255, 255]) // row 30 -> 16
// Real draw: tinted separator with an anti-aliased glow on rows 12 and 14 (Companion 5.0.6)
const tinted = image((x, y) =>
	y < 12 ? [0, 0, 0] : y === 12 ? [17, 16, 0] : y === 13 ? [238, 172, 0] : y === 14 ? [255, 16, 0] : [255, 0, 0],
)
assert.ok(hasTopbar(tinted, W))
// Pressed: Companion fills the bar with yellow, location text and a status icon in black
const pressed = image((x, y) =>
	y < TOPBAR_ROWS ? (y > 2 && y < 10 && (x < 20 || x > 54) ? [0, 0, 0] : [255, 198, 0]) : [255, 0, 0],
)
assert.equal(topbarState(pressed, W), 'lit')
const pressedFit = fitLcdImage(pressed, W, 32, { r: 255, g: 0, b: 0 }, true)
assert.equal(pressedFit.lit, true)
assert.deepEqual([...pressedFit.rgb.subarray(0, 3)], [255, 0, 0]) // bar cropped
assert.equal(fitLcdImage(red, W, 32, { r: 255, g: 0, b: 0 }, true).lit, false)
// A plain yellow button without a top bar is not mistaken for a pressed one
assert.equal(
	topbarState(
		image(() => [255, 255, 0]),
		W,
	),
	'none',
)
// Running icon: a play triangle at x 55-62, rows 3-9; green on the plain bar, black on the lit one
const inTriangle = (x: number, y: number) => x >= 55 && y >= 3 && y <= 9 && x - 55 <= 3 - Math.abs(y - 6) + 3
const runningPlain = image((x, y) => (y === 13 ? [222, 172, 0] : y < 13 && inTriangle(x, y) ? [0, 255, 0] : [0, 0, 0]))
assert.equal(isRunning(runningPlain, W), true)
assert.equal(topbarState(runningPlain, W), 'plain')
assert.equal(isActive(runningPlain, W), true)
const runningLit = image((x, y) => (y < TOPBAR_ROWS ? (inTriangle(x, y) ? [0, 0, 0] : [255, 198, 0]) : [0, 0, 0]))
assert.equal(isRunning(runningLit, W), true)
assert.equal(isRunning(red, W), false)
assert.equal(isRunning(empty, W), false)
assert.equal(isActive(red, W), false)
// The 16-row image of an LED-only key has the same bar
assert.equal(isRunning(runningPlain.subarray(0, W * 16 * 3), W), true)
// Without a top bar (red all the way up) nothing is cropped, the image is scaled
const noBar = image(() => [255, 0, 0])
assert.equal(hasTopbar(noBar, W), false)
// Showing the numbers scales the whole image down to 32 rows, keeping the bar at the top
assert.deepEqual([...fitLcdImage(red, W, 32, { r: 255, g: 0, b: 0 }, false).rgb.subarray(0, 3)], [0, 0, 0])

console.log('settings: ok')
