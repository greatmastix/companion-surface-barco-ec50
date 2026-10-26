import assert from 'node:assert/strict'
import type { FtdiTransport } from './ftdi.js'
import { ShowBoard, lcdColorByte, ledValueForColor, pwmDuty, toMonoBitmap } from './showboard.js'

/** Records what the board writes and answers reads with canned bytes. */
function fakeFtdi(replies: Buffer[] = []): { ftdi: FtdiTransport; writes: Buffer[] } {
	const writes: Buffer[] = []
	const ftdi = {
		write: async (data: Uint8Array) => void writes.push(Buffer.from(data)),
		read: async () => replies.shift() ?? Buffer.alloc(0),
	} as unknown as FtdiTransport
	return { ftdi, writes }
}

const csLow = '80901b'.repeat(5)
const csHigh = '80981b'.repeat(5)

// Bytes from captures/02-key-dest0.pcap: LED register write, then the LED latch
{
	const { ftdi, writes } = fakeFtdi()
	const board = new ShowBoard(ftdi)
	await board.writeReg(0x3950, 0x00aaa000)
	assert.equal(writes[0].toString('hex'), csLow + '11090039500003' + '00a0aa00' + 'aabb' + csHigh)
}

// captures/01-idle.pcap: poll of 0x3810. Reply = 6 bytes during the header phase, then 4 more.
{
	const reply = Buffer.from('0000000082fcff00ffff', 'hex')
	const { ftdi, writes } = fakeFtdi([reply])
	const board = new ShowBoard(ftdi)
	const events = await board.pollEvents()
	assert.equal(writes[0].toString('hex'), csLow + '3105003810800' + '3aabb' + '200300' + '87' + csHigh)
	assert.deepEqual(events, [{ type: 'tbar', raw: 0xfc82 }])
}

// captures/03-key-assign00.pcap: ASSIGN_0_0 (button 48) pressed, bit 7 set
{
	const { ftdi } = fakeFtdi([Buffer.from('00000000820cb000ffff', 'hex')])
	const events = await new ShowBoard(ftdi).pollEvents()
	assert.deepEqual(events[1], { type: 'button', buttonIndex: 48, pressed: true })
}

// captures/07a-led-brightness.pcap: Toolset values 0 / 16 / 128 / 255 -> duty 0x18 / 0x22 / 0x6b / 0xbd
assert.deepEqual(
	[0, 16, 128, 255].map((v) => pwmDuty(v, 24, 189)),
	[0x18, 0x22, 0x6b, 0xbd],
)
{
	const { ftdi, writes } = fakeFtdi()
	await new ShowBoard(ftdi).setPwm('ledBrightness', 255)
	assert.match(writes[0].toString('hex'), /392c00033101bd00aabb/)
}

// captures/06-lcd-colour.pcap: yellow-ish f3, pink cf, white ff
assert.equal(lcdColorByte({ r: 255, g: 255, b: 0 }), 0xf3)
assert.equal(lcdColorByte({ r: 255, g: 0, b: 255 }), 0xcf)
assert.equal(lcdColorByte({ r: 255, g: 255, b: 255 }), 0xff)

// LCD pixel layout: pixel (0,0) is bit 0 of byte 4, pixel (32,0) bit 0 of byte 0
{
	const rgb = new Uint8Array(64 * 32 * 3)
	rgb.set([255, 255, 255], 0)
	rgb.set([255, 255, 255], 32 * 3)
	const bits = toMonoBitmap(rgb, 64, 32, { r: 0, g: 0, b: 0 })
	assert.equal(bits[4], 0x01)
	assert.equal(bits[0], 0x01)
	assert.equal(bits.filter((b) => b).length, 2)
}

// The whole frame: header 00 00 6e b3 as captured, then filler, then the LCD latch
{
	const { ftdi, writes } = fakeFtdi()
	await new ShowBoard(ftdi).flushLcd()
	const frame = writes[0].subarray(csLow.length / 2)
	assert.equal(frame.subarray(0, 7).toString('hex'), '11b92e00006eb3')
	assert.equal(writes[1].toString('hex'), csLow + '11090038280003' + '02000000' + 'aabb' + csHigh)
}

// LED values seen on the hardware: type 1 blue on 2; type 2 red 1, green 2, and 3 is dark
assert.equal(ledValueForColor(1, 0, 0, 255), 2)
assert.equal(ledValueForColor(2, 255, 0, 0), 1)
assert.equal(ledValueForColor(2, 0, 255, 0), 2)
assert.equal(ledValueForColor(2, 255, 255, 0), 2)
assert.equal(ledValueForColor(2, 0, 0, 0), 0)

console.log('showboard: ok')
