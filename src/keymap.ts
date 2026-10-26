/**
 * EC-50 "show board" key map.
 *
 * Button indices, LED registers and LCD indices follow Barco's own numbering for the show board,
 * as used by the Event Master Toolset, and were checked against the hardware. Only the grid
 * positions are ours: they mirror the panel's layout and are what Companion shows as the
 * surface's rows and columns.
 */

export type ConsoleType = 'all' | 'ec50' | 'ec30-ec50' | 'ec40-ec50'

export interface KeyDef {
	/** Barco's name for the button, e.g. ASSIGN_0_3 */
	name: string
	/** Event code the board reports for this button */
	buttonIndex: number
	/** 0 = no LED, 1 and 2 = the two LED kinds the Toolset distinguishes (meaning not yet known) */
	ledType: number
	/** 32-bit register holding this key's LED, or undefined when it has none */
	ledReg: number | undefined
	/** Bit offset of the LED's byte within the register (0, 8, 16 or 24) */
	ledByteShift: number
	/** Bit offset of the LED's 2-bit field within that byte (0, 2, 4 or 6) */
	ledPosShift: number
	/** Index of this key's LCD, or undefined for keys without one */
	lcdIndex: number | undefined
	/** Which show-board variants have this key */
	consoleType: ConsoleType
	/** Companion control id, "row/column" */
	controlId: string
	row: number
	column: number
}

// name, button index, led type, led reg (0xFFFF = none), led byte shift, led pos shift, lcd index (-1 = none), console type
type RawRow = [string, number, number, number, number, number, number, number]
const RAW: RawRow[] = [
	['DEST_0', 0, 1, 0x3950, 16, 6, -1, 0],
	['DEST_1', 1, 1, 0x3950, 16, 4, -1, 0],
	['DEST_2', 2, 1, 0x3950, 16, 2, -1, 0],
	['DEST_3', 3, 1, 0x3950, 16, 0, -1, 0],
	['DEST_4', 4, 1, 0x3950, 8, 6, -1, 0],
	['DEST_5', 5, 1, 0x3950, 8, 4, -1, 0],
	['DEST_6', 6, 1, 0x3950, 8, 2, -1, 0],
	['DEST_7', 7, 1, 0x3950, 8, 0, -1, 0],
	['DEST_8', 8, 1, 0x3950, 0, 6, -1, 0],
	['DEST_9', 9, 1, 0x3950, 0, 4, -1, 0],
	['DEST_10', 10, 1, 0x3950, 0, 2, -1, 0],
	['DEST_11', 11, 1, 0x3950, 0, 0, 9, 0],
	['DEST_UP', 12, 0, 0xffff, 0, 0, -1, 0],
	['DEST_DOWN', 13, 0, 0xffff, 0, 0, -1, 0],
	['LAYER_UP', 25, 0, 0xffff, 0, 0, -1, 0],
	['FREEZE_PGM', 26, 2, 0x3954, 8, 2, -1, 0],
	['ARM', 27, 2, 0x3954, 8, 0, -1, 0],
	['LAYER_TRANS', 28, 2, 0x3954, 0, 6, -1, 0],
	['SHOW_CFG_0_1', 29, 1, 0x3954, 0, 4, 13, 1],
	['SHOW_CFG_0_0', 30, 1, 0x3954, 0, 2, 12, 1],
	['SHOW_CFG_1_1', 31, 1, 0x3954, 0, 0, 16, 2],
	['LAYER_0', 32, 2, 0x3958, 24, 6, -1, 0],
	['LAYER_1', 33, 2, 0x3958, 24, 4, -1, 0],
	['LAYER_2', 34, 2, 0x3958, 24, 2, -1, 0],
	['LAYER_3', 35, 2, 0x3958, 24, 0, -1, 0],
	['LAYER_4', 36, 2, 0x3958, 16, 6, -1, 0],
	['LAYER_5', 37, 2, 0x3958, 16, 4, -1, 0],
	['LAYER_6', 38, 2, 0x3958, 16, 2, -1, 0],
	['LAYER_7', 39, 2, 0x3958, 16, 0, -1, 0],
	['LAYER_8', 40, 2, 0x3958, 8, 6, 10, 0],
	['LAYER_DOWN', 41, 0, 0xffff, 0, 0, -1, 0],
	['FREEZE_PVW', 42, 2, 0x3958, 8, 2, -1, 0],
	['MATCH', 43, 2, 0x3958, 8, 0, -1, 0],
	['LAYER_CUT', 44, 2, 0x3958, 0, 6, -1, 0],
	['ASSIGN_0_0', 48, 2, 0x395c, 24, 6, 36, 3],
	['ASSIGN_0_1', 49, 2, 0x395c, 24, 4, 37, 3],
	['ASSIGN_0_2', 50, 2, 0x395c, 24, 2, 2, 3],
	['ASSIGN_0_3', 51, 2, 0x395c, 24, 0, 0, 3],
	['ASSIGN_0_4', 52, 2, 0x395c, 16, 6, 1, 3],
	['ASSIGN_0_5', 53, 2, 0x395c, 16, 4, 20, 3],
	['ASSIGN_0_6', 54, 2, 0x395c, 16, 2, 18, 3],
	['ASSIGN_0_7', 55, 2, 0x395c, 16, 0, 19, 3],
	['ASSIGN_0_8', 56, 2, 0x395c, 8, 6, 29, 3],
	['ASSIGN_0_9', 57, 2, 0x395c, 8, 4, 27, 3],
	['ASSIGN_0_10', 58, 2, 0x395c, 8, 2, 28, 3],
	['ASSIGN_0_11', 59, 2, 0x395c, 8, 0, 38, 3],
	['ASSIGN_0_UP', 60, 0, 0xffff, 0, 0, -1, 3],
	['ASSIGN_0_DOWN', 61, 0, 0xffff, 0, 0, -1, 3],
	['ASSIGN_0_LABEL', 62, 1, 0x395c, 0, 2, 11, 3],
	['SHOW_CFG_1_0', 63, 1, 0x395c, 0, 0, 15, 2],
	['ASSIGN_1_0', 64, 2, 0x3960, 24, 0, 39, 0],
	['ASSIGN_1_1', 65, 2, 0x3960, 24, 2, 40, 0],
	['ASSIGN_1_2', 66, 2, 0x3960, 24, 4, 5, 0],
	['ASSIGN_1_3', 67, 2, 0x3960, 24, 6, 3, 0],
	['ASSIGN_1_4', 68, 2, 0x3960, 16, 0, 4, 0],
	['ASSIGN_1_5', 69, 2, 0x3960, 16, 2, 23, 0],
	['ASSIGN_1_6', 70, 2, 0x3960, 16, 4, 21, 0],
	['ASSIGN_1_7', 71, 2, 0x3960, 16, 6, 22, 0],
	['ASSIGN_1_8', 72, 2, 0x3960, 8, 0, 32, 0],
	['ASSIGN_1_9', 73, 2, 0x3960, 8, 2, 30, 0],
	['ASSIGN_1_10', 74, 2, 0x3960, 8, 4, 31, 0],
	['ASSIGN_1_11', 75, 2, 0x3960, 8, 6, 41, 0],
	['ASSIGN_1_UP', 76, 0, 0xffff, 0, 0, -1, 0],
	['ASSIGN_1_DOWN', 77, 0, 0xffff, 0, 0, -1, 0],
	['ASSIGN_1_LABEL', 78, 1, 0x3960, 0, 2, 14, 0],
	['ALL_TRANS', 79, 2, 0x3960, 0, 0, -1, 0],
	['ASSIGN_2_0', 80, 2, 0x3964, 24, 0, 42, 0],
	['ASSIGN_2_1', 81, 2, 0x3964, 24, 2, 43, 0],
	['ASSIGN_2_2', 82, 2, 0x3964, 24, 4, 8, 0],
	['ASSIGN_2_3', 83, 2, 0x3964, 24, 6, 6, 0],
	['ASSIGN_2_4', 84, 2, 0x3964, 16, 0, 7, 0],
	['ASSIGN_2_5', 85, 2, 0x3964, 16, 2, 26, 0],
	['ASSIGN_2_6', 86, 2, 0x3964, 16, 4, 24, 0],
	['ASSIGN_2_7', 87, 2, 0x3964, 16, 6, 25, 0],
	['ASSIGN_2_8', 88, 2, 0x3964, 8, 0, 35, 0],
	['ASSIGN_2_9', 89, 2, 0x3964, 8, 2, 33, 0],
	['ASSIGN_2_10', 90, 2, 0x3964, 8, 4, 34, 0],
	['ASSIGN_2_11', 91, 2, 0x3964, 8, 6, 44, 0],
	['ASSIGN_2_UP', 92, 0, 0xffff, 0, 0, -1, 0],
	['ASSIGN_2_DOWN', 93, 0, 0xffff, 0, 0, -1, 0],
	['ASSIGN_2_LABEL', 94, 1, 0x3964, 0, 2, 17, 0],
	['CUT', 95, 2, 0x3964, 0, 0, -1, 0],
]

const CONSOLE_TYPES: ConsoleType[] = ['all', 'ec50', 'ec30-ec50', 'ec40-ec50']

/**
 * Grid positions, laid out like the panel:
 * rows 0-4, columns 0-14 hold the destination, layer and Assign banks with their page keys;
 * columns 15-17 hold the transition block (freeze, arm/match, layer trans/cut, show-config
 * LCD keys, cut, all trans).
 *
 * Provisional: confirm against the hardware by pressing each key and watching the log.
 */
function position(name: string): [number, number] {
	let m: RegExpMatchArray | null
	if ((m = name.match(/^DEST_(\d+)$/))) return [0, Number(m[1])]
	if (name === 'DEST_UP') return [0, 13]
	if (name === 'DEST_DOWN') return [0, 14]
	if ((m = name.match(/^LAYER_(\d+)$/))) return [1, Number(m[1])]
	if (name === 'LAYER_UP') return [1, 13]
	if (name === 'LAYER_DOWN') return [1, 14]
	if ((m = name.match(/^ASSIGN_(\d)_(\d+)$/))) return [2 + Number(m[1]), Number(m[2])]
	if ((m = name.match(/^ASSIGN_(\d)_LABEL$/))) return [2 + Number(m[1]), 12]
	if ((m = name.match(/^ASSIGN_(\d)_UP$/))) return [2 + Number(m[1]), 13]
	if ((m = name.match(/^ASSIGN_(\d)_DOWN$/))) return [2 + Number(m[1]), 14]
	const fixed: Record<string, [number, number]> = {
		FREEZE_PGM: [0, 15],
		ARM: [0, 16],
		LAYER_TRANS: [0, 17],
		FREEZE_PVW: [1, 15],
		MATCH: [1, 16],
		LAYER_CUT: [1, 17],
		SHOW_CFG_0_0: [2, 15],
		SHOW_CFG_0_1: [2, 16],
		SHOW_CFG_1_0: [3, 15],
		SHOW_CFG_1_1: [3, 16],
		CUT: [4, 15],
		ALL_TRANS: [4, 16],
	}
	const pos = fixed[name]
	if (!pos) throw new Error(`no grid position for EC-50 key ${name}`)
	return pos
}

export const KEYS: readonly KeyDef[] = RAW.map(
	([name, buttonIndex, ledType, ledReg, byteShift, posShift, lcd, type]) => {
		const [row, column] = position(name)
		return {
			name,
			buttonIndex,
			ledType,
			ledReg: ledReg === 0xffff ? undefined : ledReg,
			ledByteShift: byteShift,
			ledPosShift: posShift,
			lcdIndex: lcd < 0 ? undefined : lcd,
			consoleType: CONSOLE_TYPES[type],
			controlId: `${row}/${column}`,
			row,
			column,
		}
	},
)

export const KEY_BY_BUTTON_INDEX = new Map(KEYS.map((k) => [k.buttonIndex, k]))
export const KEY_BY_CONTROL_ID = new Map(KEYS.map((k) => [k.controlId, k]))

/** Every register that holds LEDs, in address order. */
export const LED_REGISTERS: readonly number[] = [
	...new Set(KEYS.flatMap((k) => (k.ledReg === undefined ? [] : [k.ledReg]))),
].sort((a, b) => a - b)

/** Number of LCDs the board drives (indices 0..LCD_COUNT-1). */
export const LCD_COUNT = Math.max(...KEYS.map((k) => k.lcdIndex ?? -1)) + 1
