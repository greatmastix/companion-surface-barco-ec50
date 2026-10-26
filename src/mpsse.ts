/**
 * FTDI MPSSE command encoding (FTDI AN_108).
 *
 * Only the encoding lives here; how the EC-50 frames register reads and writes on top of these
 * is in showboard.ts.
 */

export const MPSSE = {
	/** Clock bytes out on -ve edge, MSB first (the usual SPI mode 0 write). */
	WRITE_BYTES_NVE_MSB: 0x11,
	/** Clock bytes in on +ve edge, MSB first. */
	READ_BYTES_PVE_MSB: 0x20,
	/** Clock bytes out on -ve edge and in on +ve edge, MSB first (full-duplex SPI). */
	RW_BYTES_NVE_PVE_MSB: 0x31,
	SET_BITS_LOW: 0x80,
	GET_BITS_LOW: 0x81,
	SET_BITS_HIGH: 0x82,
	GET_BITS_HIGH: 0x83,
	LOOPBACK_START: 0x84,
	LOOPBACK_END: 0x85,
	TCK_DIVISOR: 0x86,
	SEND_IMMEDIATE: 0x87,
	DIS_DIV_5: 0x8a,
	EN_DIV_5: 0x8b,
	DIS_3_PHASE: 0x8d,
	DIS_ADAPTIVE: 0x97,
	/** Deliberately invalid opcodes: the chip answers 0xFA followed by the opcode. */
	BAD_COMMAND_1: 0xaa,
	BAD_COMMAND_2: 0xab,
	BAD_COMMAND_REPLY: 0xfa,
} as const

/** Set the low GPIO byte (ADBUS0-7): value and direction (1 = output). */
export function setBitsLow(value: number, direction: number): Uint8Array {
	return Uint8Array.of(MPSSE.SET_BITS_LOW, value & 0xff, direction & 0xff)
}

/** Set the high GPIO byte (ACBUS0-7): value and direction (1 = output). */
export function setBitsHigh(value: number, direction: number): Uint8Array {
	return Uint8Array.of(MPSSE.SET_BITS_HIGH, value & 0xff, direction & 0xff)
}

/** Clock divisor: SCK = 60MHz / ((1 + divisor) * 2) with divide-by-5 off (FT232H/FT2232H). */
export function setClockDivisor(divisor: number): Uint8Array {
	return Uint8Array.of(MPSSE.TCK_DIVISOR, divisor & 0xff, (divisor >> 8) & 0xff)
}

/** A byte-mode data command: opcode, length-1 (little endian), then the data if it writes. */
export function clockBytes(opcode: number, lengthOrData: number | Uint8Array): Uint8Array {
	const data = typeof lengthOrData === 'number' ? undefined : lengthOrData
	const length = data ? data.length : (lengthOrData as number)
	if (length < 1 || length > 0x10000) throw new RangeError(`MPSSE byte count out of range: ${length}`)
	const header = Uint8Array.of(opcode, (length - 1) & 0xff, ((length - 1) >> 8) & 0xff)
	if (!data) return header
	const out = new Uint8Array(3 + data.length)
	out.set(header, 0)
	out.set(data, 3)
	return out
}

export function concat(...parts: Uint8Array[]): Uint8Array {
	const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0))
	let off = 0
	for (const p of parts) {
		out.set(p, off)
		off += p.length
	}
	return out
}

/** The bytes a healthy MPSSE engine answers to one bad-command probe. */
export function syncReply(probe: number): Uint8Array {
	return Uint8Array.of(MPSSE.BAD_COMMAND_REPLY, probe)
}
