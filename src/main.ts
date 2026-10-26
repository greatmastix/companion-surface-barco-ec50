/**
 * Barco EC-50 surface module for Companion.
 *
 * The EC-50 keyboard is an FTDI chip (Barco VID 0x0600) in MPSSE mode in front of a MAX 10
 * FPGA, so this uses the `scanForSurfaces` path rather than HID: D2XX on Windows (d2xx.ts),
 * libusb elsewhere (ftdi.ts). Board access lives in showboard.ts, the key table in keymap.ts.
 */
import {
	createModuleLogger,
	parseColor,
	type CardGenerator,
	type DetectionSurfaceInfo,
	type OpenSurfaceResult,
	type SurfaceContext,
	type SurfaceDrawProps,
	type SurfaceInstance,
	type SurfacePlugin,
	type SurfaceSchemaLayoutDefinition,
} from '@companion-surface/base'
import { D2xxDevice, findD2xxEc50s } from './d2xx.js'
import { FtdiDevice, findBarcoDevices, findDeviceByHandle, type FtdiTransport } from './ftdi.js'
import { KEYS, KEY_BY_BUTTON_INDEX, KEY_BY_CONTROL_ID } from './keymap.js'
import { TOPBAR_ROWS, fitLcdImage, isActive } from './lcdimage.js'
import { CONFIG_FIELDS, DEFAULT_SETTINGS, parseSettings, scaleTbar, type EC50Settings } from './settings.js'
import {
	LCD_BACKLIGHT_OFF,
	LCD_BRIGHTNESS_MAX,
	LCD_HEIGHT,
	LCD_WIDTH,
	ShowBoard,
	lcdColorByte,
	ledValueForColor,
	toMonoBitmap,
	type PwmOutput,
} from './showboard.js'

/** "EC Show Board", the show section of the EC-50 (and of the EC-200's right-hand half). */
const EC50_PRODUCT_ID = 0x0336
const POLL_INTERVAL_MS = 10
const LCD_FLUSH_DELAY_MS = 5
const BLANK_LCD = new Uint8Array((LCD_WIDTH * LCD_HEIGHT) / 8)
const WHITE = { r: 255, g: 255, b: 255 }
const BLACK = { r: 0, g: 0, b: 0 }
/** LED-only keys get the top bar plus two rows, as wide as the LCDs so the bar has the same layout */
const LED_KEY_IMAGE_HEIGHT = TOPBAR_ROWS + 2
/** Companion's pressed colour, used for the LED of a pressed black button */
const PRESSED_YELLOW = { r: 255, g: 198, b: 0 }
const TBAR_VARIABLE = 'tbar'

/** Output variables mirroring the Toolset's User Preferences sliders, 0-255 like the Toolset. */
const PWM_VARIABLES: ReadonlyArray<{ id: string; output: PwmOutput; name: string }> = [
	{ id: 'script_light', output: 'scriptLight', name: 'Script Light Brightness' },
	{ id: 'work_light', output: 'workLight', name: 'Work Light Brightness' },
	{ id: 'led_brightness', output: 'ledBrightness', name: 'LED Brightness' },
]

const openSurfaces = new Set<EC50Surface>()

function buildLayout(): SurfaceSchemaLayoutDefinition {
	const controls: SurfaceSchemaLayoutDefinition['controls'] = {}
	for (const key of KEYS) {
		controls[key.controlId] =
			key.lcdIndex !== undefined
				? { row: key.row, column: key.column, stylePreset: 'lcd' }
				: { row: key.row, column: key.column }
	}
	return {
		stylePresets: {
			// LED-only keys: the colour picks the LED state, and a small image shows whether
			// Companion draws the button pressed (lit top bar).
			default: { bitmap: { w: LCD_WIDTH, h: LED_KEY_IMAGE_HEIGHT, format: 'rgb' }, colors: 'rgb' },
			// LCD keys: pixels for the LCD, colour for the RGB backlight.
			// 14 extra rows hold Companion's top bar, which fitLcdImage crops or scales.
			lcd: { bitmap: { w: LCD_WIDTH, h: LCD_HEIGHT + TOPBAR_ROWS, format: 'rgb' }, colors: 'rgb' },
		},
		controls,
	}
}

/** Companion sends colours as "#rrggbb" or "rgba(r,g,b,a)"; parseColor only handles the first. */
function readColor(color: string | undefined): { r: number; g: number; b: number } {
	const m = /^rgba?\((\d+)[,\s]+(\d+)[,\s]+(\d+)/.exec(color ?? '')
	return m ? { r: +m[1], g: +m[2], b: +m[3] } : parseColor(color)
}

class EC50Surface implements SurfaceInstance {
	readonly surfaceId: string
	readonly productName = 'Barco EC-50'

	readonly #logger = createModuleLogger('ec50-surface')
	readonly #context: SurfaceContext
	readonly #ftdi: FtdiTransport
	readonly #board: ShowBoard

	/** Current 2-bit LED value per key name; written out as whole registers. */
	readonly #ledStates = new Map<string, number>()
	#ledsDirty = false
	#poll: ReturnType<typeof setInterval> | undefined
	#lastTbarRaw: number | undefined
	#lastTbarValue: number | undefined
	#settings: EC50Settings = DEFAULT_SETTINGS
	/** Last image and colour per LCD, so a settings change can re-render without a redraw. */
	readonly #lastDraw = new Map<number, { image: Uint8Array; color: { r: number; g: number; b: number } }>()
	#polling = false
	#closing = false
	/** The LCDs go out as one 12KB frame, so draws within a few ms share one send. */
	#lcdFlush: ReturnType<typeof setTimeout> | undefined

	constructor(surfaceId: string, ftdi: FtdiTransport, context: SurfaceContext) {
		this.surfaceId = surfaceId
		this.#ftdi = ftdi
		this.#context = context
		this.#board = new ShowBoard(ftdi)
	}

	async init(): Promise<void> {
		await this.#board.init()
		this.#logger.info('MPSSE engine answered the sync check')
		this.#poll = setInterval(() => void this.#pollOnce(), POLL_INTERVAL_MS)
	}

	async close(): Promise<void> {
		this.#closing = true
		openSurfaces.delete(this)
		clearInterval(this.#poll)
		clearTimeout(this.#lcdFlush)
		await this.#ftdi.close()
	}

	async ready(): Promise<void> {}

	async updateConfig(config: Record<string, any>): Promise<void> {
		this.#settings = parseSettings(config)
		for (const [lcd, { image, color }] of this.#lastDraw) this.#renderLcd(lcd, image, color)
		this.#scheduleLcdFlush()
		if (this.#lastTbarRaw !== undefined) this.#sendTbar(this.#lastTbarRaw)
	}

	async setBrightness(percent: number): Promise<void> {
		// LCD brightness only; LED brightness is its own led_brightness variable, as in the Toolset.
		this.#board.setLcdBrightness((percent / 100) * LCD_BRIGHTNESS_MAX)
		this.#scheduleLcdFlush()
	}

	onVariableValue(name: string, value: any): void {
		const pwm = PWM_VARIABLES.find((v) => v.id === name)
		if (!pwm) return
		const level = Math.round(Number(value))
		if (!Number.isFinite(level)) return
		const clamped = Math.min(255, Math.max(0, level))
		void this.#tryBoard(async () => this.#board.setPwm(pwm.output, clamped))
	}

	async blank(): Promise<void> {
		for (const key of KEYS) {
			if (key.ledReg !== undefined) this.#ledStates.set(key.name, 0)
			if (key.lcdIndex !== undefined) this.#board.setLcd(key.lcdIndex, BLANK_LCD, { r: 0, g: 0, b: 0 })
		}
		this.#ledsDirty = true
		await this.#flushLeds()
		this.#scheduleLcdFlush()
	}

	async draw(signal: AbortSignal, drawProps: SurfaceDrawProps): Promise<void> {
		if (signal.aborted) return
		const key = KEY_BY_CONTROL_ID.get(drawProps.controlId)
		if (!key) return
		const color = readColor(drawProps.color)
		// Keys without an LCD show the button colour on their LED, and light up while Companion shows
		// them active (pressed, latched or still running) even when black. On LCD keys the backlight
		// already shows the colour, so their LED shows only the active state.
		const isBlack = lcdColorByte(color) === LCD_BACKLIGHT_OFF
		let ledColor = color

		if (key.lcdIndex !== undefined && drawProps.image) {
			this.#lastDraw.set(key.lcdIndex, { image: drawProps.image, color })
			const active = this.#renderLcd(key.lcdIndex, drawProps.image, color)
			this.#scheduleLcdFlush()
			ledColor = !active ? BLACK : isBlack ? PRESSED_YELLOW : color
		} else if (drawProps.image && isBlack && isActive(drawProps.image, LCD_WIDTH)) {
			ledColor = PRESSED_YELLOW
		}

		if (key.ledReg !== undefined) {
			const value = ledValueForColor(key.ledType, ledColor.r, ledColor.g, ledColor.b)
			if (this.#ledStates.get(key.name) !== value) {
				this.#ledStates.set(key.name, value)
				this.#ledsDirty = true
				await this.#flushLeds()
			}
		}
	}

	async showStatus(signal: AbortSignal, cardGenerator: CardGenerator, _statusMessage: string): Promise<void> {
		const card = await cardGenerator.generateLogoCard(LCD_WIDTH, LCD_HEIGHT, 'rgb')
		if (signal.aborted) return
		const pixels = toMonoBitmap(card, LCD_WIDTH, LCD_HEIGHT, { r: 0, g: 0, b: 0 })
		for (const key of KEYS)
			if (key.lcdIndex !== undefined) this.#board.setLcd(key.lcdIndex, pixels, { r: 255, g: 255, b: 255 })
		this.#scheduleLcdFlush()
	}

	/** Draw one LCD into the frame buffer; returns whether Companion shows the button active. */
	#renderLcd(lcd: number, image: Uint8Array, color: { r: number; g: number; b: number }): boolean {
		const s = this.#settings
		const fitted = fitLcdImage(image, LCD_WIDTH, LCD_HEIGHT, color, s.hideLocation)
		if (fitted.empty && (s.hideLocation || s.blankEmpty)) {
			this.#board.setLcd(lcd, BLANK_LCD, s.blankEmpty ? WHITE : BLACK)
			return fitted.lit || fitted.running
		}
		const pixels = toMonoBitmap(fitted.rgb, LCD_WIDTH, LCD_HEIGHT, color)
		// A black backlight is off, which would hide the usual white-on-black button text, so
		// light those keys white (text then shows dark).
		const backlight = lcdColorByte(color) === LCD_BACKLIGHT_OFF && pixels.some((b) => b !== 0) ? WHITE : color
		this.#board.setLcd(lcd, pixels, backlight)
		return fitted.lit || fitted.running
	}

	#sendTbar(raw: number): void {
		const value = scaleTbar(raw, this.#settings)
		if (value === this.#lastTbarValue) return
		this.#lastTbarValue = value
		this.#context.sendVariableValue(TBAR_VARIABLE, value)
	}

	async #flushLeds(): Promise<void> {
		if (!this.#ledsDirty) return
		this.#ledsDirty = false
		await this.#tryBoard(async () => this.#board.writeLeds(this.#ledStates))
	}

	#scheduleLcdFlush(): void {
		if (this.#lcdFlush || this.#closing) return
		this.#lcdFlush = setTimeout(() => {
			this.#lcdFlush = undefined
			void this.#tryBoard(async () => this.#board.flushLcd())
		}, LCD_FLUSH_DELAY_MS)
	}

	async #pollOnce(): Promise<void> {
		if (this.#polling || this.#closing) return
		this.#polling = true
		try {
			const events = await this.#board.pollEvents()
			for (const ev of events) {
				if (ev.type === 'tbar') {
					this.#lastTbarRaw = ev.raw
					this.#sendTbar(ev.raw)
					continue
				}
				const key = KEY_BY_BUTTON_INDEX.get(ev.buttonIndex)
				this.#logger.debug(`button ${ev.buttonIndex} ${ev.pressed ? 'down' : 'up'} -> ${key?.name ?? 'unmapped'}`)
				if (!key) continue
				if (ev.pressed) this.#context.keyDownById(key.controlId)
				else this.#context.keyUpById(key.controlId)
			}
		} catch (err) {
			if (!this.#closing) this.#context.disconnect(err as Error)
		} finally {
			this.#polling = false
		}
	}

	/** Run a board operation; a USB error means the console is gone. */
	async #tryBoard(op: () => Promise<void>): Promise<void> {
		try {
			await op()
		} catch (err) {
			if (!this.#closing) this.#context.disconnect(err as Error)
		}
	}
}

interface EC50Info {
	/** `d2xx:<serial>` on Windows, a libusb bus/port handle elsewhere */
	handle: string
}

const D2XX_PREFIX = 'd2xx:'
let d2xxMissingReported = false

function reportD2xxMissing(err: unknown): void {
	if (d2xxMissingReported) return
	d2xxMissingReported = true
	createModuleLogger('ec50-surface').warn(
		`FTDI D2XX driver not available (${String(err)}). Install Event Master Toolset or Barco's EC-50 USB driver.`,
	)
}

function openTransport(handle: string): FtdiTransport {
	if (handle.startsWith(D2XX_PREFIX)) {
		const d2xx = new D2xxDevice(handle.slice(D2XX_PREFIX.length))
		d2xx.open()
		return d2xx
	}
	const device = findDeviceByHandle(handle)
	if (!device) throw new Error(`EC-50 at ${handle} is gone`)
	const usbDevice = new FtdiDevice(device)
	usbDevice.open()
	return usbDevice
}

const plugin: SurfacePlugin<EC50Info> = {
	async init(): Promise<void> {},

	async destroy(): Promise<void> {
		await Promise.allSettled([...openSurfaces].map(async (s) => s.close()))
		openSurfaces.clear()
	},

	async scanForSurfaces(): Promise<DetectionSurfaceInfo<EC50Info>[]> {
		// A fixed surface id survives moving the cable to another socket; the host adds a suffix
		// if a second EC-50 is plugged in.
		const found = (handle: string): DetectionSurfaceInfo<EC50Info> => ({
			surfaceId: 'barco-ec50',
			description: 'Barco EC-50',
			deviceHandle: handle,
			pluginInfo: { handle },
		})

		if (process.platform === 'win32') {
			// Barco's FTDI driver owns the device on Windows, so libusb can't open it.
			try {
				return findD2xxEc50s().map((d) => found(`${D2XX_PREFIX}${d.serial}`))
			} catch (err) {
				reportD2xxMissing(err)
				return []
			}
		}

		// VID 0x0600 also covers Barco's other image-processing USB boards.
		return findBarcoDevices()
			.filter((d) => d.productId === EC50_PRODUCT_ID)
			.map((d) => found(d.handle))
	},

	async openSurface(surfaceId: string, pluginInfo: EC50Info, context: SurfaceContext): Promise<OpenSurfaceResult> {
		const ftdi = openTransport(pluginInfo.handle)
		const surface = new EC50Surface(surfaceId, ftdi, context)
		openSurfaces.add(surface)
		return {
			surface,
			registerProps: {
				brightness: true,
				surfaceLayout: buildLayout(),
				transferVariables: [
					{
						id: TBAR_VARIABLE,
						type: 'input',
						name: 'T-bar position',
						description: 'T-bar position, scaled by the surface settings (default 0-100, bottom = 0)',
					},
					...PWM_VARIABLES.map((v) => ({
						id: v.id,
						type: 'output' as const,
						name: v.name,
						description: `${v.name}, 0-255 as in the Toolset's User Preferences`,
					})),
				],
				// Assign row 1 keys 0-9 for the digits, Assign row 0 key 0 shows the code.
				pincodeMap: {
					type: 'single-page',
					pincode: '2/0',
					0: '3/9',
					1: '3/0',
					2: '3/1',
					3: '3/2',
					4: '3/3',
					5: '3/4',
					6: '3/5',
					7: '3/6',
					8: '3/7',
					9: '3/8',
				},
				location: pluginInfo.handle,
				configFields: CONFIG_FIELDS,
			},
		}
	},
}

export default plugin
