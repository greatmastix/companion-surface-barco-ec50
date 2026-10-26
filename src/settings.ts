/**
 * Per-surface settings shown in Companion's surface panel, and the T-bar scaling they control.
 */
import type { SomeCompanionInputField } from '@companion-surface/base'

/** Raw T-bar readings at its two end stops; the bottom (resting) end reads highest. */
const TBAR_RAW_BOTTOM = 64640
const TBAR_RAW_TOP = 80

export interface EC50Settings {
	hideLocation: boolean
	blankEmpty: boolean
	tbarDeadzone: number
	tbarMin: number
	tbarMax: number
	tbarDecimals: number
}

export const DEFAULT_SETTINGS: EC50Settings = {
	hideLocation: true,
	blankEmpty: true,
	tbarDeadzone: 2,
	tbarMin: 0,
	tbarMax: 100,
	tbarDecimals: 1,
}

export const CONFIG_FIELDS: SomeCompanionInputField[] = [
	{
		id: 'hideLocation',
		type: 'checkbox',
		label: 'Hide row/column numbers',
		tooltip: "Crops Companion's top bar so the button uses the whole LCD",
		default: DEFAULT_SETTINGS.hideLocation,
	},
	{
		id: 'blankEmpty',
		type: 'checkbox',
		label: 'Blank empty buttons, backlight on',
		tooltip: 'Unused buttons show nothing with a white backlight. Off: unused LCD keys go dark',
		default: DEFAULT_SETTINGS.blankEmpty,
	},
	{
		id: 'tbarDeadzone',
		type: 'number',
		label: 'T-bar bottom deadzone (%)',
		tooltip: 'The first part of the travel from the bottom reports the minimum',
		default: DEFAULT_SETTINGS.tbarDeadzone,
		min: 0,
		max: 50,
		step: 0.5,
	},
	{
		id: 'tbarMin',
		type: 'number',
		label: 'T-bar value at bottom',
		default: DEFAULT_SETTINGS.tbarMin,
		min: -100000,
		max: 100000,
	},
	{
		id: 'tbarMax',
		type: 'number',
		label: 'T-bar value at top',
		tooltip: 'Set lower than the bottom value to invert the T-bar',
		default: DEFAULT_SETTINGS.tbarMax,
		min: -100000,
		max: 100000,
	},
	{
		id: 'tbarDecimals',
		type: 'number',
		label: 'T-bar decimal places',
		default: DEFAULT_SETTINGS.tbarDecimals,
		min: 0,
		max: 4,
		step: 1,
	},
]

/** Read Companion's config object, falling back to defaults for missing or invalid values. */
export function parseSettings(config: Record<string, any> | undefined): EC50Settings {
	const num = (key: keyof EC50Settings) => {
		const v = Number(config?.[key])
		return config?.[key] !== undefined && config[key] !== '' && Number.isFinite(v)
			? v
			: (DEFAULT_SETTINGS[key] as number)
	}
	const bool = (key: keyof EC50Settings) =>
		typeof config?.[key] === 'boolean' ? config[key] : (DEFAULT_SETTINGS[key] as boolean)
	return {
		hideLocation: bool('hideLocation'),
		blankEmpty: bool('blankEmpty'),
		tbarDeadzone: Math.min(50, Math.max(0, num('tbarDeadzone'))),
		tbarMin: num('tbarMin'),
		tbarMax: num('tbarMax'),
		tbarDecimals: Math.min(4, Math.max(0, Math.round(num('tbarDecimals')))),
	}
}

/** Raw T-bar reading to the value written to the variable. */
export function scaleTbar(raw: number, s: EC50Settings): number {
	const travel = Math.min(1, Math.max(0, (TBAR_RAW_BOTTOM - raw) / (TBAR_RAW_BOTTOM - TBAR_RAW_TOP)))
	const dz = s.tbarDeadzone / 100
	const fraction = travel <= dz ? 0 : (travel - dz) / (1 - dz)
	const value = s.tbarMin + fraction * (s.tbarMax - s.tbarMin)
	const f = 10 ** s.tbarDecimals
	return Math.round(value * f) / f
}
