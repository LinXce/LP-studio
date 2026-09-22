import { existsSync, readFileSync, writeFileSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { showBanner } from './banner.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
process.chdir(root);
const args = process.argv.slice(2);
const source = args.find(arg => arg.startsWith('--source='))?.slice(9) ?? 'mirror';
const sources = {
  mirror: { registry: 'https://registry.npmmirror.com/', electron: 'https://npmmirror.com/mirrors/electron/' },
  official: { registry: 'https://registry.npmjs.org/', electron: 'https://github.com/electron/electron/releases/download/' },
};
if (!sources[source] || args.some(arg => !['--source=mirror', '--source=official', '--check'].includes(arg))) {
  console.error('Usage: node scripts/install.mjs [--source=mirror|official] [--check]'); process.exit(1);
}
const selected = sources[source];
const npmrc = path.join(root, '.npmrc');
const original = existsSync(npmrc) ? readFileSync(npmrc, 'utf8') : '';
const replacement = `registry=${selected.registry}`;
const updated = /^registry\s*=.*$/m.test(original) ? original.replace(/^registry\s*=.*$/m, replacement) : `${replacement}\n${original}`;
const env = { ...process.env,
  npm_config_registry: selected.registry, npm_config_cache: path.join(root, '.cache/npm'),
  ELECTRON_MIRROR: selected.electron,
  ELECTRON_CACHE: path.join(root, '.cache/electron'),
  electron_config_cache: path.join(root, '.cache/electron'),
};
// These inherited flags would silently skip the runtime or override the selected source.
for (const key of ['ELECTRON_SKIP_BINARY_DOWNLOAD', 'ELECTRON_OVERRIDE_DIST_PATH', 'ELECTRON_CUSTOM_DIR', 'ELECTRON_CUSTOM_FILENAME', 'npm_config_electron_mirror', 'npm_config_ignore_scripts', 'npm_config_omit']) delete env[key];
showBanner(`Install dependencies (${source})`);
console.log(`npm registry: ${selected.registry}\nElectron mirror: ${selected.electron}\nCache: ${env.npm_config_cache}\n`);
if (args.includes('--check')) {
  console.log('Configuration preview only; no files changed or network requests made.'); process.exit(0);
}
const candidates = [process.env.npm_execpath,
  path.join(path.dirname(process.execPath), 'node_modules/npm/bin/npm-cli.js'),
  path.join(path.dirname(realpathSync(process.execPath)), 'node_modules/npm/bin/npm-cli.js'),
].filter(Boolean);
const npm = candidates.find(file => /npm-cli\.js$/i.test(file) && existsSync(file));
if (!npm) { console.error('[!] npm-cli.js not found beside Node.js. Reinstall Node.js including npm, or run npm.cmd run setup:mirror.'); process.exit(1); }
writeFileSync(npmrc, updated, 'utf8');
function run(file, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [file, ...args], { cwd: root, env, stdio: 'inherit', windowsHide: true, shell: false });
    child.once('error', reject);
    child.once('exit', code => code === 0 ? resolve() : reject(Error(`Installer exited with code ${code ?? 'terminated'}`)));
  });
}
try {
  // Reuse locked versions and existing modules, including a partially downloaded runtime.
  await run(npm, ['install', '--include=dev', '--ignore-scripts=false', '--no-audit', '--no-fund', '--package-lock=true', `--registry=${selected.registry}`]);
  // npm may regard the Electron package as installed even if its earlier binary download failed.
  await run(path.join(root, 'node_modules/electron/install.js'), []);
  const electronDir = path.join(root, 'node_modules/electron');
  const binary = readFileSync(path.join(electronDir, 'path.txt'), 'utf8').trim();
  if (!existsSync(path.join(electronDir, 'dist', binary))) throw Error('Electron runtime is still missing');
  console.log('\n[OK] Dependencies and Electron runtime are ready. Run the development launcher.');
} catch (error) {
  console.error(`\n[!] ${error.message}\nLogs: ${path.join(root, '.cache/npm/_logs')}\nTry the other source: npm.cmd run setup:${source === 'mirror' ? 'official' : 'mirror'}`);
  process.exitCode = 1;
}
