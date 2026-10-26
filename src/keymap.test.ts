import assert from 'node:assert/strict'
import { KEYS, KEY_BY_BUTTON_INDEX, KEY_BY_CONTROL_ID, LCD_COUNT, LED_REGISTERS } from './keymap.js'
import { packLedRegisters } from './showboard.js'

// Counts from the Toolset's show-board key map
assert.equal(KEYS.length, 82)
assert.equal(KEYS.filter((k) => k.lcdIndex !== undefined).length, 45)
assert.equal(LCD_COUNT, 45)
assert.deepEqual(LED_REGISTERS, [0x3950, 0x3954, 0x3958, 0x395c, 0x3960, 0x3964])

// Button indices, control ids and LCD indices must all be unique
assert.equal(KEY_BY_BUTTON_INDEX.size, KEYS.length)
assert.equal(KEY_BY_CONTROL_ID.size, KEYS.length, 'two keys share a grid cell')
const lcds = KEYS.flatMap((k) => (k.lcdIndex === undefined ? [] : [k.lcdIndex]))
assert.equal(new Set(lcds).size, lcds.length)

// No two LEDs may share a 2-bit field
const fields = KEYS.filter((k) => k.ledReg !== undefined).map((k) => `${k.ledReg}:${k.ledByteShift + k.ledPosShift}`)
assert.equal(new Set(fields).size, fields.length)

// Spot checks against the CSV
assert.equal(KEY_BY_BUTTON_INDEX.get(48)?.name, 'ASSIGN_0_0')
assert.equal(KEY_BY_BUTTON_INDEX.get(48)?.lcdIndex, 36)
assert.equal(KEY_BY_BUTTON_INDEX.get(95)?.name, 'CUT')
assert.equal(KEY_BY_CONTROL_ID.get('0/0')?.name, 'DEST_0')

// DEST_0 sits at bits 22-23 of 0x3950 (byte shift 16 + pos shift 6)
const regs = packLedRegisters(new Map([['DEST_0', 3]]))
assert.equal(regs.get(0x3950), 3 << 22)
assert.equal(regs.get(0x3954), 0)

console.log('keymap: ok')
