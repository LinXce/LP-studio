import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const assets = new URL('../assets/', import.meta.url);
const ansi = /\x1b\[[0-?]*[ -/]*[@-~]/g;

/** Terminal branding only. Launching the packaged desktop EXE never opens a console. */
export function showBanner(action, { output = process.stdout, env = process.env } = {}) {
  const mode = env.LP_LOGO ?? 'auto';
  if (mode === 'none') return;
  const tty = Boolean(output.isTTY);
  const unicode = env.LP_UNICODE !== '0' && env.TERM !== 'dumb';
  const full = unicode && (mode === 'full' || (tty && (output.columns ?? 80) >= 60));
  const color = tty && env.NO_COLOR === undefined && env.TERM !== 'dumb'
    && typeof output.hasColors === 'function' && output.hasColors();
  let logo;
  try {
    logo = readFileSync(fileURLToPath(new URL(full ? 'logo.txt' : 'logo-small.txt', assets)), 'utf8')
      .replace(/^\uFEFF/, '').replace(ansi, '').trimEnd();
  } catch {
    logo = 'LP STUDIO\nLocal AI Workbench';
  }
  const lines = logo.split(/\r?\n/);
  const colors = ['97', '97', '96', '96', '34', '34'];
  const rendered = lines.map((line, index) => color ? `\x1b[${colors[index % colors.length]}m${line}\x1b[0m` : line).join('\n');
  output.write(`\n${rendered}\n\n  [>] ${action}\n\n`);
}
