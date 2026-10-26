/**
 * The EC-50 "show board": a MAX 10 FPGA behind the FTDI chip, accessed as 32-bit registers
 * over SPI (MPSSE). Worked out from USB captures of Event Master Toolset 10.3.
 *
 * Every transaction is framed by chip select on ADBUS3 and starts with a 4-byte header:
 * address (16 bit, big endian), then a 16-bit word: bit 15 = read, bit 14 = LCD memory,
 * low bits = byte count - 1. Writes end with the filler bytes AA BB. Register values are
 * little endian.
 *
 * Still unknown, marked TODO: Barco's SPI clock and init sequence (the captures started with the
 * Toolset already connected). The defaults below work on the hardware.
 */
import type { FtdiTransport } from './ftdi.js'
import { KEYS, LED_REGISTERS } from './keymap.js'
import { MPSSE, clockBytes, concat, setBitsLow, setClockDivisor, syncReply } from './mpsse.js'

export const LCD_WIDTH = 64
export const LCD_HEIGHT = 32
export const LCD_COUNT = 45
const LCD_BYTES = (LCD_WIDTH * LCD_HEIGHT) / 8
/** Per-key settings after the pixels: colours at 0, brightness at 256, 4 bytes per key each. */
const LCD_SETTINGS_BYTES = 436
const LCD_COLOR_OFFSET = 0
const LCD_BRIGHTNESS_OFFSET = 256
const LCD_FRAME_BYTES = LCD_COUNT * LCD_BYTES + LCD_SETTINGS_BYTES

/** LCD brightness steps, as in the Toolset's User Preferences. */
export const LCD_BRIGHTNESS_MAX = 7

const REG_EVENTS = 0x3810
/** Written after a frame or LED update: 2 = show the LCD frame, 1 = show the LEDs. */
const REG_LATCH = 0x3828
const LATCH_LCD = 2
const LATCH_LEDS = 1

// ADBUS: 0 SCK, 1 MOSI, 2 MISO, 3 chip select (active low), 4 held high. The Toolset sends
// every GPIO change five times, presumably to stretch chip-select setup and hold time.
const GPIO_DIR = 0x1b
const GPIO_SELECTED = 0x90
const GPIO_IDLE = 0x98
const CS_REPEAT = 5

const NO_EVENT = 0xff
const EVENT_PRESSED = 0x80

export interface ShowBoardEvent {
	type: 'button'
	buttonIndex: number
	pressed: boolean
}

export interface TbarEvent {
	type: 'tbar'
	/** Raw T-bar value as the board reports it */
	raw: number
}

/** Outputs the Toolset sets under User Preferences (Script / Work Light, LED Brightness). */
export type PwmOutput = 'scriptLight' | 'workLight' | 'ledBrightness'

const PWM_PERIOD = 305
/**
 * Registers and duty range per output, from the Toolset's writes. Script and Work Light drive
 * two registers each, always with the same value. 0 maps to the minimum duty, not to off.
 */
const PWM_OUTPUTS: Record<PwmOutput, { regs: number[]; min: number; max: number }> = {
	scriptLight: { regs: [0x3920, 0x3924], min: 118, max: 304 },
	ledBrightness: { regs: [0x392c], min: 24, max: 189 },
	workLight: { regs: [0x3930, 0x3934], min: 175, max: 279 },
}

export class ShowBoard {
	readonly #ftdi: FtdiTransport
	readonly #frame = new Uint8Array(LCD_FRAME_BYTES)
	#lastTbar: number | undefined

	constructor(ftdi: FtdiTransport) {
		this.#ftdi = ftdi
		this.setLcdBrightness(4)
	}

	/** Bring up MPSSE and prove the engine answers. Throws if it does not. */
	async init(): Promise<void> {
		await this.#ftdi.initMpsse()
		await this.syncMpsse()
		// TODO: Barco's clock divisor was not in the captures; 6MHz SCK works for most MAX 10 SPI.
		await this.#ftdi.write(
			concat(
				Uint8Array.of(MPSSE.DIS_DIV_5, MPSSE.DIS_ADAPTIVE, MPSSE.DIS_3_PHASE),
				setClockDivisor(4),
				setBitsLow(GPIO_IDLE, GPIO_DIR),
			),
		)
	}

	/** The bad-command handshake libftdi users do (FtdiIoLinux::synchMpsse does the same job). */
	async syncMpsse(): Promise<void> {
		for (const probe of [MPSSE.BAD_COMMAND_1, MPSSE.BAD_COMMAND_2]) {
			await this.#ftdi.write(Uint8Array.of(probe, MPSSE.SEND_IMMEDIATE))
			const reply = await this.#ftdi.read(2, 500)
			const want = syncReply(probe)
			if (reply[0] !== want[0] || reply[1] !== want[1])
				throw new Error(`MPSSE sync failed: sent 0x${probe.toString(16)}, got ${reply.toString('hex')}`)
		}
	}

	async readReg(address: number): Promise<number> {
		// Clock out the header plus two filler bytes while listening; the value starts right after
		// the header. The Toolset clocks two more bytes than it needs, which read back as FF FF.
		await this.#ftdi.write(
			selected(
				clockBytes(MPSSE.RW_BYTES_NVE_PVE_MSB, concat(header(address, 4, { read: true }), FILLER)),
				clockBytes(MPSSE.READ_BYTES_PVE_MSB, 4),
				Uint8Array.of(MPSSE.SEND_IMMEDIATE),
			),
		)
		const reply = await this.#ftdi.read(10)
		return reply.readUInt32LE(4)
	}

	async writeReg(address: number, value: number): Promise<void> {
		const data = Buffer.alloc(4)
		data.writeUInt32LE(value >>> 0)
		await this.#ftdi.write(selected(clockBytes(MPSSE.WRITE_BYTES_NVE_MSB, concat(header(address, 4), data, FILLER))))
	}

	async pollEvents(): Promise<Array<ShowBoardEvent | TbarEvent>> {
		const value = await this.readReg(REG_EVENTS)
		const events: Array<ShowBoardEvent | TbarEvent> = []
		const tbar = value & 0xffff
		if (tbar !== this.#lastTbar) {
			this.#lastTbar = tbar
			events.push({ type: 'tbar', raw: tbar })
		}
		const key = (value >>> 16) & 0xff
		if (key !== NO_EVENT)
			events.push({ type: 'button', buttonIndex: key & ~EVENT_PRESSED, pressed: (key & EVENT_PRESSED) !== 0 })
		return events
	}

	async writeLeds(states: ReadonlyMap<string, number>): Promise<void> {
		const regs = packLedRegisters(states)
		for (const reg of LED_REGISTERS) await this.writeReg(reg, regs.get(reg) ?? 0)
		await this.writeReg(REG_LATCH, LATCH_LEDS)
	}

	/** Set one of the PWM-driven outputs (ShowConsole::setPwm), 0-255 as in the Toolset. */
	async setPwm(output: PwmOutput, value: number): Promise<void> {
		const { regs, min, max } = PWM_OUTPUTS[output]
		const duty = pwmDuty(value, min, max)
		for (const reg of regs) await this.writeReg(reg, ((duty << 16) | PWM_PERIOD) >>> 0)
	}

	/** Update one LCD in the frame buffer; sent by the next flushLcd(). */
	setLcd(lcdIndex: number, pixels: Uint8Array, backlight: { r: number; g: number; b: number }): void {
		this.#frame.set(pixels.subarray(0, LCD_BYTES), lcdIndex * LCD_BYTES)
		this.setLcdColorByte(lcdIndex, lcdColorByte(backlight))
	}

	/** Set one LCD's raw backlight colour byte; sent by the next flushLcd(). */
	setLcdColorByte(lcdIndex: number, value: number): void {
		this.#frame.fill(value & 0xff, ...settingsRange(LCD_COLOR_OFFSET, lcdIndex))
	}

	/** Brightness of every LCD backlight, 0-LCD_BRIGHTNESS_MAX; sent by the next flushLcd(). */
	setLcdBrightness(level: number): void {
		const clamped = Math.min(LCD_BRIGHTNESS_MAX, Math.max(0, Math.round(level)))
		for (let i = 0; i < LCD_COUNT; i++)
			this.#frame.fill((clamped << 5) | 0x1f, ...settingsRange(LCD_BRIGHTNESS_OFFSET, i))
	}

	/** Send the whole LCD frame (pixels, colours, brightness) and show it. */
	async flushLcd(): Promise<void> {
		await this.#ftdi.write(
			selected(
				clockBytes(MPSSE.WRITE_BYTES_NVE_MSB, concat(header(0, LCD_FRAME_BYTES, { lcd: true }), this.#frame, FILLER)),
			),
		)
		await this.writeReg(REG_LATCH, LATCH_LCD)
	}
}

const FILLER = Uint8Array.of(0xaa, 0xbb)

function header(address: number, count: number, opts: { read?: boolean; lcd?: boolean } = {}): Uint8Array {
	const word = (opts.read ? 0x8000 : 0) | (opts.lcd ? 0x4000 : 0) | ((count - 1) & 0x3fff)
	return Uint8Array.of((address >> 8) & 0xff, address & 0xff, word >> 8, word & 0xff)
}

/** Wrap MPSSE commands in chip select, the way the Toolset does. */
function selected(...commands: Uint8Array[]): Uint8Array {
	const cs = (value: number) => concat(...Array.from({ length: CS_REPEAT }, () => setBitsLow(value, GPIO_DIR)))
	return concat(cs(GPIO_SELECTED), ...commands, cs(GPIO_IDLE))
}

/** Byte range [start, end) of one key's 4 settings bytes, relative to the frame. */
function settingsRange(offset: number, lcdIndex: number): [number, number] {
	const start = LCD_COUNT * LCD_BYTES + offset + lcdIndex * 4
	return [start, start + 4]
}

/** Map 0-255 onto an output's duty range, the same straight line the Toolset uses. */
export function pwmDuty(value: number, min: number, max: number): number {
	const v = Math.min(255, Math.max(0, value))
	return Math.round(min + (v * (max - min)) / 255)
}

/** Colour byte for black: all channels zero, which turns the backlight off. */
export const LCD_BACKLIGHT_OFF = 0x03

/**
 * Backlight colour byte: 2 bits each of red, green, blue, then 0b11. With the low bits anything
 * else the board ignores the colour and shows its default white (checked on the hardware).
 */
export function lcdColorByte({ r, g, b }: { r: number; g: number; b: number }): number {
	return ((r >> 6) << 6) | ((g >> 6) << 4) | ((b >> 6) << 2) | 0b11
}

/**
 * Pack per-key LED states (0-3) into register values, using Barco's layout:
 * each LED is a 2-bit field at bit (byteShift + posShift) of its register.
 */
export function packLedRegisters(states: ReadonlyMap<string, number>): Map<number, number> {
	const regs = new Map<number, number>(LED_REGISTERS.map((r) => [r, 0]))
	for (const key of KEYS) {
		if (key.ledReg === undefined) continue
		const value = (states.get(key.name) ?? 0) & 0b11
		const shift = key.ledByteShift + key.ledPosShift
		regs.set(key.ledReg, ((regs.get(key.ledReg) ?? 0) | (value << shift)) >>> 0)
	}
	return regs
}

/**
 * Pick a 2-bit LED value for a Companion button colour. Checked on the hardware:
 * LED type 1 (destinations, row labels, show config) is blue only, lit by bit 1.
 * LED type 2 (layers, assign keys, transitions) is 1 = red, 2 = green, but 3 leaves it dark, so
 * there is no amber; colours that lean red show red, everything else green.
 */
export function ledValueForColor(ledType: number, r: number, g: number, b: number): number {
	if (r + g + b < 48) return 0
	if (ledType === 1) return 2
	return r > g ? 1 : 2
}

/**
 * Reduce a Companion button image to the LCD's 1 bit per pixel layout.
 *
 * Rows of 8 bytes, least significant bit = leftmost pixel, with the two 32-pixel halves swapped:
 * bytes 4-7 of a row are its left half, bytes 0-3 its right half. A set bit is a drawn pixel.
 *
 * A pixel is set when it differs clearly from the button's background colour. The background
 * becomes the LCD backlight, so this keeps text and icons readable whatever colours are used,
 * where a plain brightness threshold would lose dark text on a light button.
 */
export function toMonoBitmap(
	rgb: Uint8Array,
	width: number,
	height: number,
	background: { r: number; g: number; b: number },
): Uint8Array {
	const stride = width / 8
	const half = stride / 2
	const out = new Uint8Array(stride * height)
	for (let y = 0; y < height; y++)
		for (let x = 0; x < width; x++) {
			const i = (y * width + x) * 3
			const dr = rgb[i] - background.r
			const dg = rgb[i + 1] - background.g
			const db = rgb[i + 2] - background.b
			if (dr * dr + dg * dg + db * db > 64 * 64) out[y * stride + (((x >> 3) + half) % stride)] |= 1 << (x & 7)
		}
	return out
}
