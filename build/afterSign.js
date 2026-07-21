// Without a paid Apple Developer ID, electron-builder finds no signing
// identity and skips code signing entirely (see the "skipped macOS
// application code signing" line in CI build logs). A fully unsigned .app
// is not just "unverified" - on Apple Silicon Macs, macOS refuses to run it
// at all, usually reporting it as "damaged and can't be opened" (a
// misleading message for what's actually a missing-signature problem, not
// real corruption). An ad-hoc signature ("-" as the identity, no
// certificate or Apple account needed) is enough to satisfy that
// requirement and let the app launch; Gatekeeper still shows its normal
// "unidentified developer" prompt on first open, bypassable via right-click
// "Open" or System Settings > Privacy & Security > "Open Anyway".
const { execFileSync } = require('child_process');
const path = require('path');

exports.default = async function afterSign(context) {
  if (context.electronPlatformName !== 'darwin') return;

  const appName = context.packager.appInfo.productFilename;
  const appPath = path.join(context.appOutDir, `${appName}.app`);

  console.log(`afterSign: ad-hoc signing ${appPath}`);
  execFileSync('codesign', ['--force', '--deep', '--sign', '-', appPath], {
    stdio: 'inherit',
  });
};
