/**
 * Builds the phone apps' projects: `pnpm --filter mobile build`.
 *
 *   1. Builds the shared core and the web app, pointing the web app at the live API (an app on
 *      a phone has no /api of its own), with the accessibility gate unless --quick is given.
 *   2. Makes the iOS and Android projects in build/ios and build/android, if they are not
 *      there yet, with `cap add`.
 *   3. Writes in the name, version numbers and permission reasons (scripts/native-settings.ts).
 *   4. Copies the web app and the plugins in, with `cap sync`.
 *   5. With --assets, makes every icon and splash screen size from packages/mobile/assets.
 *
 * Flags: --ios or --android for one only; --skip-native to stop after the web app; --quick to
 * skip the web app's lint and tests (verify runs them anyway); --assets for the icons.
 *
 * Nothing here needs a Mac. Turning build/ios into an app for the App Store does: Xcode on a
 * Mac, or the macOS runner in .github/workflows/store-apps.yml (docs/APP_STORES.md).
 */

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { findRepoRoot, loadIdentity } from './identity.ts';
import { applyAndroid, applyIos, versionFrom } from './native-settings.ts';

const ASSETS_TOOL = '@capacitor/assets@3.0.5';

const flags = new Set(process.argv.slice(2));
const root = findRepoRoot();
const mobile = join(root, 'packages', 'mobile');
const identity = loadIdentity(root);
const packageVersion = (
  JSON.parse(readFileSync(join(mobile, 'package.json'), 'utf8')) as { version: string }
).version;
const version = versionFrom(process.env, packageVersion);
const liveUrl = process.env['APP_LIVE_URL']?.trim();

function run(command: string, args: string[], cwd: string, env: Record<string, string> = {}): void {
  console.log(`\n> ${command} ${args.join(' ')}   (in ${cwd})`);
  const result = spawnSync(command, args, {
    cwd,
    stdio: 'inherit',
    env: { ...process.env, ...env },
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(' ')} stopped with code ${result.status}.`);
  }
}

console.log(
  `Building ${identity.name} (${identity.appId}) version ${version.name}, build ${version.build}.` +
    (liveUrl ? ` The app will load ${liveUrl}.` : ' The app carries its own copy of the web app.'),
);

// 1. The web app. Inside the app the page's address is the phone itself, so the API is named in
// full; with APP_LIVE_URL the page comes from the website and /api works as it does there.
const apiUrl = process.env['VITE_API_URL'] ?? (liveUrl ? '/api' : `${identity.site}/api`);
run('pnpm', ['run', 'build:core'], root);
run('pnpm', ['--filter', '@aldilivery/web', flags.has('--quick') ? 'build:only' : 'build'], root, {
  VITE_API_URL: apiUrl,
});

if (flags.has('--skip-native')) {
  console.log('\nThe web app is built. Stopping before the phone projects (--skip-native).');
  process.exit(0);
}

// 2 to 4. The phone projects.
const wanted = ['ios', 'android'].filter((platform) => flags.has(`--${platform}`));
const platforms = wanted.length > 0 ? wanted : ['ios', 'android'];
for (const platform of platforms) {
  const dir = join(mobile, 'build', platform);
  if (!existsSync(dir)) run('pnpm', ['exec', 'cap', 'add', platform], mobile);
  if (platform === 'ios') applyIos(dir, identity, version);
  else applyAndroid(dir, identity, version);
  run('pnpm', ['exec', 'cap', 'sync', platform], mobile);
}

// 5. Icons and splash screens, in every size each phone wants.
if (flags.has('--assets')) {
  const colour = identity.navy;
  run(
    'npx',
    [
      '--yes',
      ASSETS_TOOL,
      'generate',
      '--assetPath',
      'assets',
      '--iconBackgroundColor',
      colour,
      '--iconBackgroundColorDark',
      colour,
      '--splashBackgroundColor',
      colour,
      '--splashBackgroundColorDark',
      colour,
      ...platforms.map((platform) => `--${platform}`),
      '--iosProject',
      'build/ios/App',
      '--androidProject',
      'build/android',
    ],
    mobile,
  );
}

console.log(
  `\nDone. The projects are in packages/mobile/build. Open them with ` +
    `"pnpm --filter mobile open:ios" on a Mac, or "pnpm --filter mobile open:android".`,
);
