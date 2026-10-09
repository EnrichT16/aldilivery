/**
 * The settings the generated iOS and Android projects need, applied after Capacitor makes them.
 *
 * Capacitor writes plain template projects into build/ios and build/android. These functions
 * take the text of the few files that need changing and return the changed text: the name
 * under the icon, the version numbers, and the plain English explanation each phone shows when
 * the app first asks for the microphone, the camera, location or notifications. Each one is
 * safe to run again on a file it has already changed, so a rebuild never doubles anything.
 *
 * Every word a person reads here is checked against the privacy policy
 * (packages/web/src/pages/Privacy.tsx) and the store listing (docs/store-listing).
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import type { AppIdentity } from './identity.ts';

export interface AppVersion {
  /** What people see in the store, such as 1.0.0. */
  name: string;
  /** A whole number that must go up with every upload to either store. */
  build: number;
}

/** The words for an XML file. */
function escapeXml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * What iOS shows when the app first asks for each permission. Apple rejects an app whose
 * reasons are vague, so each says exactly what it is for, in the words a person would use.
 */
export function iosPermissionReasons(assistant: string): Record<string, string> {
  return {
    NSMicrophoneUsageDescription: `${assistant} listens when you press the microphone button, so you can do your shopping by talking. The microphone is also used when you speak to your Runner on an in-app call, and for a voice note about a problem, which is sent only when you choose to send it. What you say to ${assistant} is never recorded or kept.`,
    NSSpeechRecognitionUsageDescription: `If our own voice service cannot be reached, your iPhone turns what you say to ${assistant} into words, so you can still shop by talking.`,
    NSCameraUsageDescription:
      'Runners take a photo of the till receipt and of their documents. Anyone can send a photo when something went wrong with an order.',
    NSPhotoLibraryUsageDescription:
      'So you can choose a photo you already took, such as a receipt or a document, to send to us.',
    NSPhotoLibraryAddUsageDescription:
      'So a photo you take in the app can be saved to your photos, only when you ask.',
    NSLocationWhenInUseUsageDescription:
      'For Runners only: while you are on shift, your location is used to offer you jobs nearby and guide you to the door, and if you press SOS it is shared with our team until you say you are safe. Shoppers are never tracked.',
    NSLocationAlwaysAndWhenInUseUsageDescription:
      'For Runners only: while you are on shift, your location is used to offer you jobs nearby and guide you to the door, and if you press SOS it is shared with our team until you say you are safe. Shoppers are never tracked.',
  };
}

/** Set a string value in an Info.plist, replacing it if the key is already there. */
export function setPlistString(plist: string, key: string, value: string): string {
  const entry = new RegExp(`(<key>${key}</key>\\s*)<string>[\\s\\S]*?</string>`);
  const line = `<string>${escapeXml(value)}</string>`;
  if (entry.test(plist))
    return plist.replace(entry, (_match, keyPart: string) => `${keyPart}${line}`);
  return insertBeforeLastDict(plist, `\t<key>${key}</key>\n\t${line}\n`);
}

/** Set a true or false value in an Info.plist. */
export function setPlistBoolean(plist: string, key: string, value: boolean): string {
  const entry = new RegExp(`(<key>${key}</key>\\s*)<(true|false)/>`);
  if (entry.test(plist))
    return plist.replace(entry, (_match, keyPart: string) => `${keyPart}<${value}/>`);
  return insertBeforeLastDict(plist, `\t<key>${key}</key>\n\t<${value}/>\n`);
}

/** Set a list of strings in an Info.plist. */
export function setPlistStringArray(plist: string, key: string, values: string[]): string {
  const entry = new RegExp(`(<key>${key}</key>\\s*)<array>[\\s\\S]*?</array>`);
  const array = `<array>\n${values.map((value) => `\t\t<string>${escapeXml(value)}</string>\n`).join('')}\t</array>`;
  if (entry.test(plist))
    return plist.replace(entry, (_match, keyPart: string) => `${keyPart}${array}`);
  return insertBeforeLastDict(plist, `\t<key>${key}</key>\n\t${array}\n`);
}

function insertBeforeLastDict(plist: string, text: string): string {
  const at = plist.lastIndexOf('</dict>');
  if (at < 0) throw new Error('Info.plist has no closing </dict>; is it really a property list?');
  return plist.slice(0, at) + text + plist.slice(at);
}

/** The iOS Info.plist: the name under the icon, every permission reason, and push. */
export function configureInfoPlist(plist: string, identity: AppIdentity): string {
  let result = setPlistString(plist, 'CFBundleDisplayName', identity.name);
  for (const [key, reason] of Object.entries(iosPermissionReasons(identity.assistant))) {
    result = setPlistString(result, key, reason);
  }
  // Notifications arrive while the app is closed (order updates, a Runner's question).
  result = setPlistStringArray(result, 'UIBackgroundModes', ['remote-notification']);
  // The app uses only the encryption built into iOS (HTTPS), so it is exempt from the export
  // paperwork, and App Store Connect stops asking on every upload.
  result = setPlistBoolean(result, 'ITSAppUsesNonExemptEncryption', false);
  return result;
}

/** The entitlements file that switches on push notifications for the iOS app. */
export function iosEntitlements(): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
\t<key>aps-environment</key>
\t<string>development</string>
</dict>
</plist>
`;
}

/**
 * The Xcode project: the version numbers, the entitlements file, and iPhone only. Leaving the
 * iPad out means Apple does not ask for iPad screenshots; iPads still run the iPhone app.
 */
export function configurePbxproj(
  pbxproj: string,
  version: AppVersion,
  entitlementsPath: string,
): string {
  let result = pbxproj
    .replace(/MARKETING_VERSION = [^;]+;/g, `MARKETING_VERSION = ${version.name};`)
    .replace(/CURRENT_PROJECT_VERSION = [^;]+;/g, `CURRENT_PROJECT_VERSION = ${version.build};`)
    .replace(/TARGETED_DEVICE_FAMILY = "?[0-9,]+"?;/g, 'TARGETED_DEVICE_FAMILY = 1;');
  if (!result.includes('CODE_SIGN_ENTITLEMENTS')) {
    result = result.replace(
      /^(\s*)(INFOPLIST_FILE = App\/Info\.plist;)$/gm,
      `$1CODE_SIGN_ENTITLEMENTS = ${entitlementsPath};\n$1$2`,
    );
  }
  return result;
}

/** What Android asks permission for. Android shows its own wording; the store listing explains. */
export const ANDROID_PERMISSIONS = [
  'android.permission.INTERNET',
  // Talking to Ozi, in-app calls and voice notes.
  'android.permission.RECORD_AUDIO',
  'android.permission.MODIFY_AUDIO_SETTINGS',
  // Photos of receipts, documents and problems.
  'android.permission.CAMERA',
  // Runners only: jobs nearby, directions and SOS.
  'android.permission.ACCESS_COARSE_LOCATION',
  'android.permission.ACCESS_FINE_LOCATION',
  // Order updates and a Runner's questions.
  'android.permission.POST_NOTIFICATIONS',
  'android.permission.VIBRATE',
] as const;

/** Hardware the app can use but does not need, so phones without it can still install. */
export const ANDROID_OPTIONAL_FEATURES = [
  'android.hardware.camera',
  'android.hardware.location.gps',
  'android.hardware.microphone',
] as const;

/** The Android manifest: every permission and optional feature, each added once. */
export function configureAndroidManifest(manifest: string): string {
  const missing: string[] = [];
  for (const permission of ANDROID_PERMISSIONS) {
    if (!manifest.includes(`android:name="${permission}"`)) {
      missing.push(`    <uses-permission android:name="${permission}" />`);
    }
  }
  for (const feature of ANDROID_OPTIONAL_FEATURES) {
    if (!manifest.includes(`android:name="${feature}"`)) {
      missing.push(`    <uses-feature android:name="${feature}" android:required="false" />`);
    }
  }
  if (missing.length === 0) return manifest;
  const at = manifest.lastIndexOf('</manifest>');
  if (at < 0) throw new Error('AndroidManifest.xml has no closing </manifest>.');
  return `${manifest.slice(0, at)}${missing.join('\n')}\n${manifest.slice(at)}`;
}

function setAndroidString(xml: string, name: string, value: string): string {
  const entry = new RegExp(`<string name="${name}">[\\s\\S]*?</string>`);
  const line = `<string name="${name}">${escapeXml(value)}</string>`;
  if (entry.test(xml)) return xml.replace(entry, line);
  return xml.replace('</resources>', `    ${line}\n</resources>`);
}

/** Android's strings: the name under the icon and at the top of the app switcher. */
export function configureAndroidStrings(xml: string, identity: AppIdentity): string {
  let result = setAndroidString(xml, 'app_name', identity.name);
  result = setAndroidString(result, 'title_activity_main', identity.name);
  result = setAndroidString(result, 'package_name', identity.appId);
  return setAndroidString(result, 'custom_url_scheme', identity.appId);
}

/** Android's version numbers, in app/build.gradle. */
export function configureAndroidGradle(gradle: string, version: AppVersion): string {
  return gradle
    .replace(/versionCode \d+/, `versionCode ${version.build}`)
    .replace(/versionName "[^"]*"/, `versionName "${version.name}"`);
}

/**
 * The version for this build. APP_VERSION and APP_BUILD_NUMBER win when set (the build
 * workflow sets the build number from its run number); otherwise the package version, and a
 * build number from the clock, which always goes up.
 */
export function versionFrom(
  env: Record<string, string | undefined>,
  packageVersion: string,
  now: Date = new Date(),
): AppVersion {
  const name = env['APP_VERSION']?.trim() || packageVersion;
  if (!/^\d+\.\d+(\.\d+)?$/.test(name)) {
    throw new Error(`APP_VERSION "${name}" must look like 1.0.0.`);
  }
  const given = env['APP_BUILD_NUMBER']?.trim();
  // Minutes since the start of 2026: about 500,000 a year, far below Google's ceiling of
  // 2,100,000,000, and it goes up between any two builds made a minute apart.
  const build = given ? Number(given) : Math.floor((now.getTime() - Date.UTC(2026, 0, 1)) / 60_000);
  if (!Number.isInteger(build) || build < 1 || build > 2_100_000_000) {
    throw new Error(`APP_BUILD_NUMBER "${given ?? build}" must be a whole number above 0.`);
  }
  return { name, build };
}

function edit(file: string, change: (text: string) => string): void {
  if (!existsSync(file))
    throw new Error(`Expected ${file} to exist after Capacitor made the project.`);
  const before = readFileSync(file, 'utf8');
  const after = change(before);
  if (after !== before) writeFileSync(file, after);
}

/** Apply everything above to the generated iOS project in `iosDir` (build/ios). */
export function applyIos(iosDir: string, identity: AppIdentity, version: AppVersion): void {
  const app = join(iosDir, 'App');
  edit(join(app, 'App', 'Info.plist'), (text) => configureInfoPlist(text, identity));
  writeFileSync(join(app, 'App', 'App.entitlements'), iosEntitlements());
  edit(join(app, 'App.xcodeproj', 'project.pbxproj'), (text) =>
    configurePbxproj(text, version, 'App/App.entitlements'),
  );
}

/** Apply everything above to the generated Android project in `androidDir` (build/android). */
export function applyAndroid(androidDir: string, identity: AppIdentity, version: AppVersion): void {
  const main = join(androidDir, 'app', 'src', 'main');
  edit(join(main, 'AndroidManifest.xml'), configureAndroidManifest);
  edit(join(main, 'res', 'values', 'strings.xml'), (text) =>
    configureAndroidStrings(text, identity),
  );
  edit(join(androidDir, 'app', 'build.gradle'), (text) => configureAndroidGradle(text, version));
}
