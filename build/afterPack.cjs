// electron-builder afterPack hook.
//
// The macOS `mac.identity` is intentionally `null` (we don't ship a paid
// Developer ID certificate), which makes electron-builder skip code signing
// entirely. Left as-is, the app keeps only Electron's stock prebuilt
// signature, which breaks once the bundle is renamed to the product name —
// on Apple Silicon that produces the misleading "app is damaged and can't be
// opened" Gatekeeper error.
//
// To avoid that we apply our own valid *ad-hoc* signature ("-" identity) here,
// after the app is packed but before the dmg/zip artifacts are built, so the
// signature is captured in what users download. Users still see a one-time
// "unidentified developer" prompt (right-click → Open) because the build is
// not notarized, but it no longer reports as damaged.
const { execFileSync } = require('node:child_process')
const path = require('node:path')

exports.default = async function afterPack(context) {
  if (context.electronPlatformName !== 'darwin') return

  const appName = `${context.packager.appInfo.productFilename}.app`
  const appPath = path.join(context.appOutDir, appName)

  console.log(`  • ad-hoc signing ${appName}`)
  // --force replaces the broken stock signature; --deep signs nested
  // frameworks/helpers; "-" is the ad-hoc identity.
  execFileSync('codesign', ['--force', '--deep', '--sign', '-', appPath], {
    stdio: 'inherit',
  })
  // Fail the build loudly if the signature didn't take.
  execFileSync('codesign', ['--verify', '--deep', '--strict', appPath], {
    stdio: 'inherit',
  })
}
