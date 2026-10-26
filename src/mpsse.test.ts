import assert from 'node:assert/strict'
import { MPSSE, clockBytes, concat, setBitsLow, setClockDivisor, syncReply } from './mpsse.js'

// Byte-mode length is encoded as length-1, little endian (AN_108 section 3.3)
assert.deepEqual([...clockBytes(MPSSE.READ_BYTES_PVE_MSB, 1)], [0x20, 0x00, 0x00])
assert.deepEqual([...clockBytes(MPSSE.READ_BYTES_PVE_MSB, 0x100)], [0x20, 0xff, 0x00])
assert.deepEqual([...clockBytes(MPSSE.WRITE_BYTES_NVE_MSB, Uint8Array.of(0xde, 0xad))], [0x11, 0x01, 0x00, 0xde, 0xad])
assert.throws(() => clockBytes(MPSSE.READ_BYTES_PVE_MSB, 0))

assert.deepEqual([...setBitsLow(0x08, 0x0b)], [0x80, 0x08, 0x0b])
assert.deepEqual([...setClockDivisor(0x1234)], [0x86, 0x34, 0x12])
assert.deepEqual([...syncReply(MPSSE.BAD_COMMAND_1)], [0xfa, 0xaa])
assert.deepEqual([...concat(Uint8Array.of(1), Uint8Array.of(2, 3))], [1, 2, 3])

console.log('mpsse: ok')
