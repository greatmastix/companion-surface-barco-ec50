/**
 * FTDI D2XX backend for Windows.
 *
 * On Windows the EC-50 is bound to Barco's signed copy of FTDI's bus driver (FTDIBUS), which
 * libusb cannot open. The Event Master Toolset talks to it through FTDI's ftd2xx.dll, installed
 * with that driver, so this does the same through koffi. Users with the Toolset installed need
 * nothing else; nobody has to swap drivers with Zadig, which would lock the Toolset out.
 *
 * Only one program can have the console open, so while the Toolset is running D2XX lists the
 * device as opened and this skips it.
 */
import { existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type koffiModule from 'koffi'
import type { FtdiTransport } from './ftdi.js'

type Koffi = typeof koffiModule

/**
 * The native koffi.node, which already exports load/func/pointer/opaque. Companion's packager only
 * accepts native modules under prebuilds/<platform>-<arch>/ (scripts/koffi-prebuilds.mjs puts them
 * there), so this loads it from there: next to the bundle when packaged, or one level up from
 * dist/ in development. The koffi package itself is the last resort.
 */
function loadKoffi(): Koffi {
	const require = createRequire(import.meta.url)
	const here = path.dirname(fileURLToPath(import.meta.url))
	const target = `${process.platform}-${process.arch}`
	for (const dir of [here, path.join(here, '..')]) {
		const file = path.join(dir, 'prebuilds', target, 'koffi.node')
		if (existsSync(file)) return require(file) as Koffi
	}
	// A variable, so the bundler leaves it alone instead of trying to bundle koffi's binaries.
	const koffiPackage = 'koffi'
	return require(koffiPackage) as Koffi
}

/** (VID << 16) | PID as D2XX reports it: Barco 0x0600, "EC Show Board" 0x0336. */
export const EC50_D2XX_ID = 0x06000336

const FT_OK = 0
const FT_STATUS = [
	'OK',
	'INVALID_HANDLE',
	'DEVICE_NOT_FOUND',
	'DEVICE_NOT_OPENED',
	'IO_ERROR',
	'INSUFFICIENT_RESOURCES',
	'INVALID_PARAMETER',
	'INVALID_BAUD_RATE',
	'DEVICE_NOT_OPENED_FOR_ERASE',
	'DEVICE_NOT_OPENED_FOR_WRITE',
	'FAILED_TO_WRITE_DEVICE',
	'EEPROM_READ_FAILED',
	'EEPROM_WRITE_FAILED',
	'EEPROM_ERASE_FAILED',
	'EEPROM_NOT_PRESENT',
	'EEPROM_NOT_PROGRAMMED',
	'INVALID_ARGS',
	'NOT_SUPPORTED',
	'OTHER_ERROR',
]
const FT_FLAGS_OPENED = 1
const FT_OPEN_BY_SERIAL_NUMBER = 1
const FT_PURGE_RX = 1
const FT_PURGE_TX = 2
const BITMODE_RESET = 0x00
const BITMODE_MPSSE = 0x02
const READ_TIMEOUT_MS = 500
const WRITE_TIMEOUT_MS = 1000

type Fn = koffiModule.KoffiFunction

interface D2xxLib {
	createDeviceInfoList: Fn
	getDeviceInfoDetail: Fn
	openEx: Fn
	close: Fn
	resetDevice: Fn
	purge: Fn
	setUsbParameters: Fn
	setChars: Fn
	setTimeouts: Fn
	setLatencyTimer: Fn
	setBitMode: Fn
	write: Fn
	read: Fn
}

let lib: D2xxLib | undefined

/** Load ftd2xx.dll on first use. Throws if FTDI's (or Barco's) driver is not installed. */
function d2xx(): D2xxLib {
	if (lib) return lib
	const koffi = loadKoffi()
	const dll = koffi.load('ftd2xx.dll')
	// Registers the FT_HANDLE type name used in the prototypes below.
	koffi.pointer('FT_HANDLE', koffi.opaque('FT_DEVICE'))
	lib = {
		createDeviceInfoList: dll.func('uint32 FT_CreateDeviceInfoList(_Out_ uint32 *count)'),
		getDeviceInfoDetail: dll.func(
			'uint32 FT_GetDeviceInfoDetail(uint32 index, _Out_ uint32 *flags, _Out_ uint32 *type, _Out_ uint32 *id, _Out_ uint32 *locId, _Out_ void *serial, _Out_ void *description, _Out_ void **handle)',
		),
		openEx: dll.func('uint32 FT_OpenEx(const char *arg, uint32 flags, _Out_ FT_HANDLE *handle)'),
		close: dll.func('uint32 FT_Close(FT_HANDLE handle)'),
		resetDevice: dll.func('uint32 FT_ResetDevice(FT_HANDLE handle)'),
		purge: dll.func('uint32 FT_Purge(FT_HANDLE handle, uint32 mask)'),
		setUsbParameters: dll.func('uint32 FT_SetUSBParameters(FT_HANDLE handle, uint32 inSize, uint32 outSize)'),
		setChars: dll.func(
			'uint32 FT_SetChars(FT_HANDLE handle, uint8 eventChar, uint8 eventEnable, uint8 errorChar, uint8 errorEnable)',
		),
		setTimeouts: dll.func('uint32 FT_SetTimeouts(FT_HANDLE handle, uint32 readMs, uint32 writeMs)'),
		setLatencyTimer: dll.func('uint32 FT_SetLatencyTimer(FT_HANDLE handle, uint8 ms)'),
		setBitMode: dll.func('uint32 FT_SetBitMode(FT_HANDLE handle, uint8 mask, uint8 mode)'),
		write: dll.func('uint32 FT_Write(FT_HANDLE handle, void *buffer, uint32 length, _Out_ uint32 *written)'),
		read: dll.func('uint32 FT_Read(FT_HANDLE handle, _Out_ void *buffer, uint32 length, _Out_ uint32 *read)'),
	}
	return lib
}

function check(status: number, what: string): void {
	if (status !== FT_OK) throw new Error(`${what} failed: FT_${FT_STATUS[status] ?? status}`)
}

/** Run a D2XX call on koffi's worker thread so a blocking read doesn't stall Companion. */
async function callAsync(fn: Fn, ...args: unknown[]): Promise<number> {
	return new Promise((resolve, reject) =>
		fn.async(...args, (err: Error | null, res: number) => (err ? reject(err) : resolve(res))),
	)
}

export interface D2xxDeviceInfo {
	index: number
	serial: string
	description: string
	/** (VID << 16) | PID, or 0 while another program has the device open */
	id: number
	opened: boolean
}

function cString(buf: Buffer): string {
	const end = buf.indexOf(0)
	return buf.toString('latin1', 0, end < 0 ? buf.length : end)
}

/** List every device FTDI's driver knows about, without opening any of them. */
export function listD2xxDevices(): D2xxDeviceInfo[] {
	const ft = d2xx()
	const count = new Uint32Array(1)
	check(ft.createDeviceInfoList(count), 'FT_CreateDeviceInfoList')
	const out: D2xxDeviceInfo[] = []
	for (let index = 0; index < count[0]; index++) {
		const flags = new Uint32Array(1)
		const type = new Uint32Array(1)
		const id = new Uint32Array(1)
		const locId = new Uint32Array(1)
		const serial = Buffer.alloc(16)
		const description = Buffer.alloc(64)
		if (ft.getDeviceInfoDetail(index, flags, type, id, locId, serial, description, [null]) !== FT_OK) continue
		out.push({
			index,
			serial: cString(serial),
			description: cString(description),
			id: id[0],
			opened: (flags[0] & FT_FLAGS_OPENED) !== 0,
		})
	}
	return out
}

/** The EC-50s that are free to open. */
export function findD2xxEc50s(): D2xxDeviceInfo[] {
	return listD2xxDevices().filter((d) => !d.opened && d.id === EC50_D2XX_ID && d.serial)
}

export class D2xxDevice implements FtdiTransport {
	readonly #serial: string
	#handle: unknown = null
	/** D2XX calls run on worker threads; this keeps them in the order they were issued. */
	#queue: Promise<unknown> = Promise.resolve()

	constructor(serial: string) {
		this.#serial = serial
	}

	open(): void {
		const handle: unknown[] = [null]
		check(d2xx().openEx(this.#serial, FT_OPEN_BY_SERIAL_NUMBER, handle), `opening EC-50 ${this.#serial}`)
		this.#handle = handle[0]
	}

	async close(): Promise<void> {
		const handle = this.#handle
		this.#handle = null
		if (!handle) return
		await this.#queue.catch(() => undefined)
		d2xx().close(handle)
	}

	/** Put the chip in MPSSE mode, following FTDI's AN_135. */
	async initMpsse(latencyMs = 1): Promise<void> {
		const ft = d2xx()
		const h = this.#open()
		check(ft.resetDevice(h), 'FT_ResetDevice')
		check(ft.setUsbParameters(h, 65536, 65536), 'FT_SetUSBParameters')
		check(ft.setChars(h, 0, 0, 0, 0), 'FT_SetChars')
		check(ft.setTimeouts(h, READ_TIMEOUT_MS, WRITE_TIMEOUT_MS), 'FT_SetTimeouts')
		check(ft.setLatencyTimer(h, latencyMs), 'FT_SetLatencyTimer')
		check(ft.setBitMode(h, 0, BITMODE_RESET), 'FT_SetBitMode')
		check(ft.setBitMode(h, 0, BITMODE_MPSSE), 'FT_SetBitMode')
		check(ft.purge(h, FT_PURGE_RX | FT_PURGE_TX), 'FT_Purge')
	}

	async write(data: Uint8Array): Promise<void> {
		const buf = Buffer.from(data)
		await this.#enqueue(async () => {
			const written = new Uint32Array(1)
			check(await callAsync(d2xx().write, this.#open(), buf, buf.length, written), 'FT_Write')
			if (written[0] !== buf.length) throw new Error(`FT_Write wrote ${written[0]} of ${buf.length} bytes`)
		})
	}

	/** Read exactly `length` bytes; D2XX has already stripped the FTDI status bytes. */
	async read(length: number, _timeoutMs = READ_TIMEOUT_MS): Promise<Buffer> {
		// The timeout is the device-wide one set in initMpsse (FT_SetTimeouts).
		return this.#enqueue(async () => {
			const buf = Buffer.alloc(length)
			const got = new Uint32Array(1)
			check(await callAsync(d2xx().read, this.#open(), buf, length, got), 'FT_Read')
			if (got[0] !== length) throw new Error(`FTDI read timed out: wanted ${length} bytes, got ${got[0]}`)
			return buf
		})
	}

	#open(): unknown {
		if (!this.#handle) throw new Error('device not open')
		return this.#handle
	}

	async #enqueue<T>(op: () => Promise<T>): Promise<T> {
		const run = this.#queue.then(op, op)
		this.#queue = run.catch(() => undefined)
		return run
	}
}
