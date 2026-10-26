/**
 * Fit Companion's button image to the 64x32 key LCDs.
 *
 * Companion draws its top bar (page/row/column and a separator line) as a fixed 14 rows, which on
 * a 32-row LCD leaves 18 rows for the button. So the module asks for a 64x46 image: the top 14
 * rows are the top bar and the 32 below are a full-size button. Hiding the numbers crops the bar;
 * showing them, or a button drawn without a top bar, scales the whole image down to 32 rows.
 */
export const TOPBAR_ROWS = 14
const SEPARATOR_ROW = TOPBAR_ROWS - 1

export interface FittedImage {
	/** RGB, width x outHeight */
	rgb: Uint8Array
	/** Nothing drawn on the button area and a black background: an unused Companion button */
	empty: boolean
	/** The top bar is lit: Companion shows a pressed or latched button this way */
	lit: boolean
	/** Companion's running icon is in the top bar: the button's actions are still running */
	running: boolean
}

/** Companion's top bar colour while a button is pressed or latched. */
const PRESSED_BAR = [255, 198, 0]

/**
 * @param rgb RGB image, width x (outHeight + TOPBAR_ROWS)
 * @param hideTopbar crop Companion's top bar when the image has one
 */
export function fitLcdImage(
	rgb: Uint8Array,
	width: number,
	outHeight: number,
	background: { r: number; g: number; b: number },
	hideTopbar: boolean,
): FittedImage {
	const inHeight = outHeight + TOPBAR_ROWS
	const stride = width * 3
	const bar = topbarState(rgb, width)
	const crop = hideTopbar && bar !== 'none'
	const out = new Uint8Array(width * outHeight * 3)
	for (let y = 0; y < outHeight; y++) {
		const src = crop ? y + TOPBAR_ROWS : Math.floor((y * inHeight) / outHeight)
		out.set(rgb.subarray(src * stride, (src + 1) * stride), y * stride)
	}

	const black = background.r < 64 && background.g < 64 && background.b < 64
	let drawn = false
	for (let y = TOPBAR_ROWS; y < inHeight && !drawn; y++)
		for (let x = 0; x < width; x++) {
			const i = (y * width + x) * 3
			if (rgb[i] > 32 || rgb[i + 1] > 32 || rgb[i + 2] > 32) {
				drawn = true
				break
			}
		}
	return { rgb: out, empty: black && !drawn, lit: bar === 'lit', running: isRunning(rgb, width) }
}

/**
 * Companion's running icon: a play triangle at the right end of the top bar (x 55-62 from a
 * 64-wide image, rows 3-9), green on the plain bar and black on the lit one. Its core
 * (x 56-58, rows 5-7) is checked, plus a point just right of the tip that must still be bar.
 */
export function isRunning(rgb: Uint8Array, width: number): boolean {
	const px = (x: number, y: number) => {
		const i = (y * width + (width - 64 + x)) * 3
		return [rgb[i], rgb[i + 1], rgb[i + 2]]
	}
	const lit = topbarState(rgb, width) === 'lit'
	const isIcon = ([r, g, b]: number[]) => (lit ? r < 40 && g < 40 && b < 40 : g > 200 && r < 64 && b < 64)
	for (let y = 5; y <= 7; y++) for (let x = 56; x <= 58; x++) if (!isIcon(px(x, y))) return false
	const [r, g, b] = px(63, 6)
	return lit ? PRESSED_BAR.every((c, ch) => Math.abs([r, g, b][ch] - c) <= 16) : r < 16 && g < 16 && b < 16
}

/**
 * Whether the image starts with Companion's top bar, and if so whether it is lit.
 *
 * Normally the bar is black with a separator line on row 13: grey on unused buttons, tinted on
 * used ones, and anti-aliased into rows 12 and 14. So: row 13 evenly lit across the width, and the
 * bar's rows 0, 1 and 11 black (its text and status icons only use rows 2-10).
 * A pressed or latched button fills the whole bar with Companion's yellow; its top two rows stay
 * clear of the location text and status icons.
 */
export function topbarState(rgb: Uint8Array, width: number): 'none' | 'plain' | 'lit' {
	let lit = true
	for (let y = 0; y < 2 && lit; y++)
		for (let x = 0; x < width; x++) {
			const i = (y * width + x) * 3
			if (PRESSED_BAR.some((c, ch) => Math.abs(rgb[i + ch] - c) > 8)) {
				lit = false
				break
			}
		}
	if (lit) return 'lit'
	return hasPlainTopbar(rgb, width) ? 'plain' : 'none'
}

export function hasTopbar(rgb: Uint8Array, width: number): boolean {
	return topbarState(rgb, width) !== 'none'
}

function hasPlainTopbar(rgb: Uint8Array, width: number): boolean {
	const level = (x: number, y: number) => {
		const i = (y * width + x) * 3
		return Math.max(rgb[i], rgb[i + 1], rgb[i + 2])
	}
	let lo = 255
	let hi = 0
	for (let x = 0; x < width; x++) {
		lo = Math.min(lo, level(x, SEPARATOR_ROW))
		hi = Math.max(hi, level(x, SEPARATOR_ROW))
	}
	if (lo < 32 || hi - lo > 16) return false
	// Location text and status icons stay within rows 2-10, so the rows around them are black.
	for (const y of BAR_CLEAR_ROWS) for (let x = 0; x < width; x++) if (level(x, y) >= 16) return false
	return true
}

const BAR_CLEAR_ROWS = [0, 1, 11]

/** Pressed, latched or still running, as Companion draws it in the top bar. */
export function isActive(rgb: Uint8Array, width: number): boolean {
	return topbarState(rgb, width) === 'lit' || isRunning(rgb, width)
}
