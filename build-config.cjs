// `usb` loads its native libusb binding at runtime through node-gyp-build, which does not survive
// esbuild bundling, so it stays external and the packager installs it with its prebuilds.
// koffi is not external, so it is not installed into the package: its binaries go in as prebuilds/ (see
// scripts/koffi-prebuilds.mjs), and src/d2xx.ts loads them from there.
module.exports = {
	externals: ['usb'],
	extraFiles: ['prebuilds'],
}
