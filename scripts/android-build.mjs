/**
 * Build the Android app (APK) — `npm run android:build`.
 *
 *   1. web bundle for the app: `vite build --mode native` → dist-native (cable-only, no server)
 *   2. `cap sync android`: copies it into android/app/src/main/assets/public
 *   3. Gradle assembleDebug → a debug-signed APK anyone can sideload
 *   4. copies it to release/ParkPatrol.apk
 *
 * Needs Java 21 and the Android SDK. Set JAVA_HOME / ANDROID_HOME, or keep the
 * defaults this project was first built with (D:\DevTools\jdk-21, D:\DevTools\android-sdk).
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const JAVA_HOME = process.env.JAVA_HOME || 'D:\\DevTools\\jdk-21';
const ANDROID_HOME = process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT || 'D:\\DevTools\\android-sdk';

for (const [name, dir, probe] of [
  ['JAVA_HOME', JAVA_HOME, path.join('bin', process.platform === 'win32' ? 'java.exe' : 'java')],
  ['ANDROID_HOME', ANDROID_HOME, 'platforms'],
]) {
  if (!fs.existsSync(path.join(dir, probe))) {
    console.error(`\n  ${name} not found at ${dir} — install it or set ${name}.\n`);
    process.exit(1);
  }
}

const env = { ...process.env, JAVA_HOME, ANDROID_HOME, ANDROID_SDK_ROOT: ANDROID_HOME, PATH: `${path.join(JAVA_HOME, 'bin')}${path.delimiter}${process.env.PATH}` };
function run(cmd, args, cwd = root) {
  console.log(`\n> ${cmd} ${args.join(' ')}`);
  const r = spawnSync(cmd, args, { cwd, env, stdio: 'inherit', shell: true });
  if (r.status !== 0) process.exit(r.status ?? 1);
}

// Gradle finds the SDK through local.properties (git-ignored by android/.gitignore).
fs.writeFileSync(path.join(root, 'android', 'local.properties'), `sdk.dir=${ANDROID_HOME.replace(/\\/g, '\\\\').replace(/:/g, '\\:')}\n`);

run('node', ['scripts/fetch-map.mjs', '--if-missing']); // the built-in street map (fetched once)
run('npx', ['vite', 'build', '--mode', 'native']);
run('npx', ['cap', 'sync', 'android']);
const androidDir = path.join(root, 'android');
run(`"${path.join(androidDir, process.platform === 'win32' ? 'gradlew.bat' : 'gradlew')}"`, ['assembleDebug', '--console=plain'], androidDir);

const apk = path.join(root, 'android', 'app', 'build', 'outputs', 'apk', 'debug', 'app-debug.apk');
const out = path.join(root, 'release', 'ParkPatrol.apk');
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.copyFileSync(apk, out);
console.log(`\nAPK ready: ${out} (${(fs.statSync(out).size / 1048576).toFixed(1)} MB)\n`);
