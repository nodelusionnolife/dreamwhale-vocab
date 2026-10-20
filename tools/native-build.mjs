import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';

const root = path.resolve(import.meta.dirname, '..');
const env = { ...process.env };
env.Path = `${path.join(os.homedir(), '.cargo', 'bin')};${env.Path || env.PATH || ''}`;
delete env.PATH;
const sdk = env.ANDROID_HOME || path.join(env.LOCALAPPDATA, 'Android', 'Sdk');
const portableTools = path.join(env.LOCALAPPDATA, 'DreamwhaleTools');
const portableJava = fs.existsSync(portableTools) ? fs.readdirSync(portableTools).filter(name => name.startsWith('jdk-21')).sort().reverse().map(name => path.join(portableTools, name))[0] : null;
const java = env.DREAMWHALE_JAVA_HOME || portableJava || 'C:/Program Files/Android/Android Studio/jbr';
function run(file, args, cwd = root) {
  const result = spawnSync(file, args, { cwd, env, stdio: 'inherit', shell: file.endsWith('.bat') || file.endsWith('.cmd') });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status || 1);
}
if (process.argv[2] === 'android') {
  if (!fs.existsSync(path.join(java, 'bin/java.exe'))) throw new Error('请安装 Android Studio，或设置 DREAMWHALE_JAVA_HOME 指向 JDK 21+。');
  env.JAVA_HOME = java; env.ANDROID_HOME = sdk;
  env.Path = `${path.join(java, 'bin')};${path.join(sdk, 'platform-tools')};${env.Path}`;
  fs.writeFileSync(path.join(root, 'android/local.properties'), `sdk.dir=${sdk.replaceAll('\\', '/')}\n`);
  run(process.execPath, ['node_modules/vite/bin/vite.js', 'build']);
  run(process.execPath, ['node_modules/@capacitor/cli/bin/capacitor', 'sync', 'android']);
  run('gradlew.bat', ['assembleDebug', '--no-daemon'], path.join(root, 'android'));
} else if (process.argv[2] === 'desktop') {
  run(process.execPath, ['node_modules/@tauri-apps/cli/tauri.js', 'build', ...process.argv.slice(3)]);
} else { throw new Error('使用 android 或 desktop 构建目标。'); }
