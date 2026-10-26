/**
 * Minimal FTDI driver over libusb, just enough for the EC-50 on Linux and macOS.
 *
 * The EC-50 is an FTDI chip with Barco's own vendor id (0x0600) in MPSSE mode. The stock FTDI
 * drivers don't bind to the custom VID, so this talks to the chip with FTDI's vendor requests
 * directly, the same ones libftdi sends. On Windows Barco's driver owns the device and d2xx.ts is
 * used instead.
 *
 * Not yet tried on hardware: the init sequence here is the libftdi default, while the D2XX path
 * (the one tested) follows FTDI's AN_135.
 */
import { usb, type Device, type InEndpoint, type Interface, type OutEndpoint } from 'usb'

export const BARCO_VENDOR_ID = 0x0600

// FTDI vendor requests (libftdi ftdi.h)
const SIO_RESET = 0x00
const SIO_SET_EVENT_CHAR = 0x06
const SIO_SET_ERROR_CHAR = 0x07
const SIO_SET_LATENCY_TIMER = 0x09
const SIO_SET_BITMODE = 0x0b
const SIO_READ_EEPROM = 0x90

const SIO_RESET_SIO = 0
const SIO_RESET_PURGE_RX = 1
const SIO_RESET_PURGE_TX = 2

export const BITMODE_RESET = 0x00
export const BITMODE_MPSSE = 0x02

const REQ_OUT = 0x40 // vendor, host-to-device
const REQ_IN = 0xc0 // vendor, device-to-host

/** Every bulk IN packet from an FTDI chip starts with two modem-status bytes. */
const STATUS_BYTES = 2

export interface FtdiDeviceInfo {
	busNumber: number
	deviceAddress: number
	vendorId: number
	productId: number
	/** Stable across scans while the device stays plugged in. */
	handle: string
}

/** List every device with Barco's vendor id, without opening any of them. */
export function findBarcoDevices(): FtdiDeviceInfo[] {
	return usb
		.getDeviceList()
		.filter((d) => d.deviceDescriptor.idVendor === BARCO_VENDOR_ID)
		.map((d) => ({
			busNumber: d.busNumber,
			deviceAddress: d.deviceAddress,
			vendorId: d.deviceDescriptor.idVendor,
			productId: d.deviceDescriptor.idProduct,
			handle: deviceHandle(d),
		}))
}

/** What ShowBoard needs from an FTDI chip in MPSSE mode; libusb here, D2XX on Windows (d2xx.ts). */
export interface FtdiTransport {
	initMpsse(latencyMs?: number): Promise<void>
	write(data: Uint8Array): Promise<void>
	read(length: number, timeoutMs?: number): Promise<Buffer>
	close(): Promise<void>
}

export function deviceHandle(d: Device): string {
	return `usb:${d.busNumber}-${d.portNumbers?.join('.') ?? d.deviceAddress}`
}

export function findDeviceByHandle(handle: string): Device | undefined {
	return usb.getDeviceList().find((d) => d.deviceDescriptor.idVendor === BARCO_VENDOR_ID && deviceHandle(d) === handle)
}

export class FtdiDevice implements FtdiTransport {
	readonly #device: Device
	readonly #interfaceIndex: number
	#iface: Interface | undefined;
	#in: InEndpoint | undefined
	#out: OutEndpoint | undefined
	/** wIndex for vendor requests: 1 = interface A, 2 = B, ... */
	#port = 1

	constructor(device: Device, interfaceIndex = 0) {
		this.#device = device
		this.#interfaceIndex = interfaceIndex
	}

	open(): void {
		this.#device.open()
		const iface = this.#device.interface(this.#interfaceIndex)
		if (process.platform === 'linux' && iface.isKernelDriverActive()) iface.detachKernelDriver()
		iface.claim()
		this.#iface = iface
		this.#port = this.#interfaceIndex + 1
		this.#in = iface.endpoints.find((e) => e.direction === 'in') as InEndpoint | undefined
		this.#out = iface.endpoints.find((e) => e.direction === 'out') as OutEndpoint | undefined
		if (!this.#in || !this.#out) throw new Error(`interface ${this.#interfaceIndex} has no bulk endpoint pair`)
	}

	async close(): Promise<void> {
		const iface = this.#iface
		this.#iface = undefined
		if (iface) {
			await new Promise<void>((resolve) => iface.release(true, () => resolve()))
		}
		try {
			this.#device.close()
		} catch {
			// already closed or unplugged
		}
	}

	async getSerialNumber(): Promise<string | undefined> {
		const idx = this.#device.deviceDescriptor.iSerialNumber
		if (!idx) return undefined
		return new Promise((resolve) => {
			this.#device.getStringDescriptor(idx, (err, value) => resolve(err ? undefined : value))
		})
	}

	/** Put the chip in MPSSE mode the way libftdi's ftdi_set_bitmode does. */
	async initMpsse(latencyMs = 1): Promise<void> {
		await this.#control(SIO_RESET, SIO_RESET_SIO)
		await this.purge()
		await this.#control(SIO_SET_EVENT_CHAR, 0)
		await this.#control(SIO_SET_ERROR_CHAR, 0)
		await this.#control(SIO_SET_LATENCY_TIMER, latencyMs)
		await this.setBitmode(BITMODE_RESET, 0)
		await this.setBitmode(BITMODE_MPSSE, 0)
	}

	async setBitmode(mode: number, mask: number): Promise<void> {
		await this.#control(SIO_SET_BITMODE, (mode << 8) | (mask & 0xff))
	}

	async purge(): Promise<void> {
		await this.#control(SIO_RESET, SIO_RESET_PURGE_RX)
		await this.#control(SIO_RESET, SIO_RESET_PURGE_TX)
	}

	/** Read one 16-bit word of the chip's configuration EEPROM. */
	async readEepromWord(address: number): Promise<number> {
		const data = await new Promise<Buffer>((resolve, reject) => {
			this.#device.controlTransfer(REQ_IN, SIO_READ_EEPROM, 0, address, 2, (err, buf) =>
				err ? reject(err) : resolve(buf as Buffer),
			)
		})
		return data.readUInt16LE(0)
	}

	async write(data: Uint8Array): Promise<void> {
		const out = this.#out
		if (!out) throw new Error('device not open')
		await new Promise<void>((resolve, reject) =>
			out.transfer(Buffer.from(data), (err) => (err ? reject(err) : resolve())),
		)
	}

	/**
	 * Read exactly `length` payload bytes (status bytes stripped), or fail after `timeoutMs`.
	 * MPSSE replies arrive in pieces, so keep polling until enough has come back.
	 */
	async read(length: number, timeoutMs = 500): Promise<Buffer> {
		const inEp = this.#in
		if (!inEp) throw new Error('device not open')
		const packetSize = inEp.descriptor.wMaxPacketSize
		const chunks: Buffer[] = []
		let got = 0
		const deadline = Date.now() + timeoutMs
		while (got < length) {
			if (Date.now() > deadline) throw new Error(`FTDI read timed out: wanted ${length} bytes, got ${got}`)
			const raw = await new Promise<Buffer>((resolve, reject) =>
				inEp.transfer(packetSize * 8, (err, buf) => (err ? reject(err) : resolve(buf ?? Buffer.alloc(0)))),
			)
			const payload = stripStatusBytes(raw, packetSize)
			if (payload.length) {
				chunks.push(payload)
				got += payload.length
			}
		}
		const all = Buffer.concat(chunks)
		return all.subarray(0, length)
	}

	async #control(request: number, value: number): Promise<void> {
		return new Promise((resolve, reject) => {
			this.#device.controlTransfer(REQ_OUT, request, value, this.#port, Buffer.alloc(0), (err) =>
				err ? reject(err) : resolve(),
			)
		})
	}
}

/** Drop the two modem-status bytes at the start of every max-size packet in a bulk IN transfer. */
export function stripStatusBytes(raw: Uint8Array, packetSize: number): Buffer {
	const parts: Buffer[] = []
	for (let off = 0; off < raw.length; off += packetSize) {
		const packet = raw.subarray(off, Math.min(off + packetSize, raw.length))
		if (packet.length > STATUS_BYTES) parts.push(Buffer.from(packet.subarray(STATUS_BYTES)))
	}
	return Buffer.concat(parts)
}
