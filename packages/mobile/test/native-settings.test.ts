/**
 * The phone apps' settings: who the app is, the permission reasons, the version numbers, and
 * the build workflow that only runs when somebody presses its button.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import config from '../capacitor.config.ts';
import { DEFAULT_APP_ID, findRepoRoot, identityFrom, loadIdentity } from '../scripts/identity.ts';
import {
  ANDROID_PERMISSIONS,
  configureAndroidGradle,
  configureAndroidManifest,
  configureAndroidStrings,
  configureInfoPlist,
  configurePbxproj,
  iosPermissionReasons,
  versionFrom,
} from '../scripts/native-settings.ts';

const root = findRepoRoot();
const store = JSON.parse(readFileSync(join(root, 'config', 'store.json'), 'utf8')) as {
  productName: string;
  assistantName: string;
  brand: { colours: { navy: string } };
};
const identity = loadIdentity(root, {});

/** The parts of Capacitor's own templates these settings change, as `cap add` writes them. */
const INFO_PLIST = `<?xml version="1.0" encoding="UTF-8"?>
<plist version="1.0">
<dict>
\t<key>CFBundleDisplayName</key>
        <string>Template name</string>
\t<key>CFBundleName</key>
\t<string>$(PRODUCT_NAME)</string>
\t<key>UIViewControllerBasedStatusBarAppearance</key>
\t<true/>
</dict>
</plist>
`;

const PBXPROJ = `
\t\t\tbuildSettings = {
\t\t\t\tCURRENT_PROJECT_VERSION = 1;
\t\t\t\tINFOPLIST_FILE = App/Info.plist;
\t\t\t\tMARKETING_VERSION = 1.0;
\t\t\t\tTARGETED_DEVICE_FAMILY = "1,2";
\t\t\t};
\t\t\tbuildSettings = {
\t\t\t\tCURRENT_PROJECT_VERSION = 1;
\t\t\t\tINFOPLIST_FILE = App/Info.plist;
\t\t\t\tMARKETING_VERSION = 1.0;
\t\t\t\tTARGETED_DEVICE_FAMILY = "1,2";
\t\t\t};
`;

const MANIFEST = `<?xml version="1.0" encoding="utf-8"?>
<manifest xmlns:android="http://schemas.android.com/apk/res/android">
    <application android:label="@string/app_name"></application>
    <!-- Permissions -->
    <uses-permission android:name="android.permission.INTERNET" />
</manifest>
`;

const STRINGS = `<?xml version='1.0' encoding='utf-8'?>
<resources>
    <string name="app_name">Template name</string>
    <string name="title_activity_main">Template name</string>
    <string name="package_name">com.example.app</string>
    <string name="custom_url_scheme">com.example.app</string>
</resources>
`;

const GRADLE = `    defaultConfig {
        applicationId "com.example.app"
        versionCode 1
        versionName "1.0"
    }`;

describe('who the app is', () => {
  it('takes its name and colours from config/store.json (Rule Nine)', () => {
    expect(identity.name).toBe(store.productName);
    expect(identity.assistant).toBe(store.assistantName);
    expect(identity.navy).toBe(store.brand.colours.navy);
    expect(config.appName).toBe(store.productName);
    expect(config.backgroundColor).toBe(store.brand.colours.navy);
  });

  it('uses the identifier both stores will know it by, and refuses one they would not accept', () => {
    expect(identity.appId).toBe(DEFAULT_APP_ID);
    expect(config.appId).toBe(identity.appId);
    expect(identityFrom({ ...store, mobileApp: { appId: 'uk.co.example.test' } }).appId).toBe(
      'uk.co.example.test',
    );
    expect(() => identityFrom(store, { APP_ID: 'not-an-identifier' })).toThrow(/reverse domain/);
    expect(() => identityFrom(store, { APP_ID: 'uk.co.has-hyphen.app' })).toThrow(/reverse domain/);
  });

  it('refuses to build without a product name', () => {
    expect(() => identityFrom({ ...store, productName: '' })).toThrow(/productName/);
  });

  it('talks to the website over https only', () => {
    expect(identity.site).toMatch(/^https:\/\//);
    expect(() => identityFrom(store, { APP_SITE: 'http://example.com' })).toThrow(/https/);
    expect(identityFrom(store, { APP_SITE: 'https://example.com/' }).site).toBe(
      'https://example.com',
    );
  });

  it('carries its own copy of the web app, keeps pinch to zoom, and keeps the projects out of git', () => {
    expect(config.webDir).toBe('../web/dist');
    expect(config.zoomEnabled).toBe(true);
    expect(config.server?.url).toBeUndefined();
    expect(config.android?.path).toBe('build/android');
    expect(config.ios?.path).toBe('build/ios');
    const gitignore = readFileSync(join(root, '.gitignore'), 'utf8');
    expect(gitignore).toMatch(/^build\/$/m);
  });
});

describe('the iOS settings', () => {
  const plist = configureInfoPlist(INFO_PLIST, identity);

  it('puts the name under the icon from configuration', () => {
    expect(plist).toContain(
      `<key>CFBundleDisplayName</key>\n        <string>${identity.name}</string>`,
    );
    expect(plist).not.toContain('Template name');
  });

  it('explains every permission in plain words, naming the assistant from configuration', () => {
    for (const key of [
      'NSMicrophoneUsageDescription',
      'NSSpeechRecognitionUsageDescription',
      'NSCameraUsageDescription',
      'NSPhotoLibraryUsageDescription',
      'NSLocationWhenInUseUsageDescription',
    ]) {
      expect(plist).toContain(`<key>${key}</key>`);
    }
    const reasons = iosPermissionReasons(identity.assistant);
    expect(reasons['NSMicrophoneUsageDescription']).toContain(`${store.assistantName} listens`);
    expect(reasons['NSLocationWhenInUseUsageDescription']).toContain('Shoppers are never tracked');
    for (const reason of Object.values(reasons)) {
      expect(reason.length).toBeLessThan(400);
      expect(reason).toMatch(/\.$/);
    }
  });

  it('allows notifications in the background and skips the export paperwork', () => {
    expect(plist).toMatch(
      /<key>UIBackgroundModes<\/key>\s*<array>\s*<string>remote-notification<\/string>/,
    );
    expect(plist).toMatch(/<key>ITSAppUsesNonExemptEncryption<\/key>\s*<false\/>/);
  });

  it('changes nothing the second time', () => {
    expect(configureInfoPlist(plist, identity)).toBe(plist);
  });

  it('sets the versions, iPhone only, and the push entitlement in the Xcode project', () => {
    const pbx = configurePbxproj(PBXPROJ, { name: '1.2.3', build: 42 }, 'App/App.entitlements');
    expect(pbx.match(/MARKETING_VERSION = 1\.2\.3;/g)).toHaveLength(2);
    expect(pbx.match(/CURRENT_PROJECT_VERSION = 42;/g)).toHaveLength(2);
    expect(pbx.match(/TARGETED_DEVICE_FAMILY = 1;/g)).toHaveLength(2);
    expect(pbx.match(/CODE_SIGN_ENTITLEMENTS = App\/App\.entitlements;/g)).toHaveLength(2);
    expect(configurePbxproj(pbx, { name: '1.2.3', build: 42 }, 'App/App.entitlements')).toBe(pbx);
  });
});

describe('the Android settings', () => {
  it('asks for the microphone, camera, location and notifications, once each', () => {
    const manifest = configureAndroidManifest(MANIFEST);
    for (const permission of ANDROID_PERMISSIONS) {
      expect(manifest.split(`android:name="${permission}"`)).toHaveLength(2);
    }
    expect(manifest).toContain('android:name="android.hardware.camera" android:required="false"');
    expect(configureAndroidManifest(manifest)).toBe(manifest);
  });

  it('puts the name and identifier from configuration into the strings', () => {
    const strings = configureAndroidStrings(STRINGS, identity);
    expect(strings).toContain(`<string name="app_name">${identity.name}</string>`);
    expect(strings).toContain(`<string name="package_name">${identity.appId}</string>`);
    expect(strings).not.toContain('Template name');
  });

  it('sets the version numbers', () => {
    const gradle = configureAndroidGradle(GRADLE, { name: '2.0.0', build: 7 });
    expect(gradle).toContain('versionCode 7');
    expect(gradle).toContain('versionName "2.0.0"');
  });
});

describe('the version', () => {
  it('uses the build number it is given', () => {
    expect(versionFrom({ APP_VERSION: '1.0.1', APP_BUILD_NUMBER: '12' }, '1.0.0')).toEqual({
      name: '1.0.1',
      build: 12,
    });
  });

  it('otherwise counts minutes, so every build is higher than the one before', () => {
    const first = versionFrom({}, '1.0.0', new Date('2026-10-09T12:00:00Z'));
    const later = versionFrom({}, '1.0.0', new Date('2026-10-09T12:01:00Z'));
    expect(first.name).toBe('1.0.0');
    expect(later.build).toBeGreaterThan(first.build);
  });

  it('refuses versions the stores would not accept', () => {
    expect(() => versionFrom({ APP_VERSION: 'one' }, '1.0.0')).toThrow(/1\.0\.0/);
    expect(() => versionFrom({ APP_BUILD_NUMBER: '0' }, '1.0.0')).toThrow(/whole number/);
    expect(() => versionFrom({ APP_BUILD_NUMBER: '1.5' }, '1.0.0')).toThrow(/whole number/);
  });
});

describe('the store build workflow', () => {
  const workflow = readFileSync(join(root, '.github', 'workflows', 'store-apps.yml'), 'utf8');
  const trigger = workflow.slice(workflow.indexOf('\non:'), workflow.indexOf('\njobs:'));

  it('runs only when somebody presses its button, never on a push', () => {
    expect(trigger).toContain('workflow_dispatch');
    expect(trigger).not.toMatch(/^\s+(push|pull_request|schedule|release):/m);
  });

  it('keeps every signing secret in GitHub secrets, never in the file', () => {
    expect(workflow).toContain('secrets.ANDROID_KEYSTORE_BASE64');
    expect(workflow).toContain('secrets.APP_STORE_CONNECT_API_KEY_BASE64');
    expect(workflow).not.toMatch(/-----BEGIN/);
  });
});
