// Copy koffi's native binaries into prebuilds/<platform>-<arch>/koffi.node.
//
// Companion's packager only accepts native modules in that layout, while koffi keeps them in
// build/koffi/<platform>_<arch>/. src/d2xx.ts loads koffi.node from prebuilds/ itself, so the koffi
// package itself is not shipped. Runs on postinstall; prebuilds/ is not committed.
import { copyFileSync, mkdirSync, rmSync } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

/** The targets Companion's packager requires, as koffi names them. */
const TARGETS = {
	'linux-x64': 'linux_x64',
	'linux-arm64': 'linux_arm64',
	'win32-x64': 'win32_x64',
	'win32-arm64': 'win32_arm64',
	'darwin-x64': 'darwin_x64',
	'darwin-arm64': 'darwin_arm64',
}

const koffiDir = path.dirname(createRequire(import.meta.url).resolve('koffi/package.json'))
const out = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'prebuilds')

rmSync(out, { recursive: true, force: true })
for (const [target, koffiTarget] of Object.entries(TARGETS)) {
	mkdirSync(path.join(out, target), { recursive: true })
	copyFileSync(path.join(koffiDir, 'build', 'koffi', koffiTarget, 'koffi.node'), path.join(out, target, 'koffi.node'))
}
console.log(`koffi binaries for ${Object.keys(TARGETS).length} platforms copied to prebuilds/`)
