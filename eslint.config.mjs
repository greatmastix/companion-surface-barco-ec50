import { generateEslintConfig } from '@companion-module/tools/eslint/config.mjs'

export default generateEslintConfig({
	enableTypescript: true,
	ignores: ['tools/**', 'extracted/**', 'prebuilds/**'], // hardware/capture helpers: plain scripts, run by hand, not shipped
})
