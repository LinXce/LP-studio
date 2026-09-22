import { showBanner } from './banner.mjs';
import { build } from 'esbuild';
import { createServer } from 'vite';
import { spawn } from 'node:child_process';
import electron from 'electron';

showBanner('Starting desktop development window...');
let server, child, timer;
let closing = false;
async function close(code = 0) {
  if (closing) return; closing = true; clearTimeout(timer);
  if (child && child.exitCode === null) child.kill();
  await server?.close(); process.exitCode = code;
}
process.on('SIGINT', () => void close());
process.on('SIGTERM', () => void close());
try {
  console.log('[1/4] Building desktop main process...');
  await build({ entryPoints: ['apps/desktop/main.ts'], bundle: true, platform: 'node', format: 'cjs', outfile: 'dist/main/main.cjs', external: ['electron'], sourcemap: true });
  console.log('[2/4] Building secure preload...');
  await build({ entryPoints: ['apps/desktop/preload.ts'], bundle: true, platform: 'node', format: 'cjs', outfile: 'dist/main/preload.cjs', external: ['electron'] });
  console.log('[3/4] Starting local UI server (127.0.0.1:5173)...');
  server = await createServer(); await server.listen();
  console.log('[4/4] Launching Electron desktop...');
  const env = { ...process.env, LP_DEV_URL: 'http://127.0.0.1:5173' }; delete env.ELECTRON_RUN_AS_NODE;
  // This process owns the visible desktop window; windowsHide is only for background helpers.
  child = spawn(electron, ['.'], { stdio: ['inherit', 'inherit', 'inherit', 'ipc'], env, windowsHide: false });
  child.once('error', error => { console.error('[!] Electron launch failed:', error.message); void close(1); });
  child.once('exit', (code, signal) => {
    console.log(`[desktop] Process exited: ${signal ?? code}`); void close(code ?? (closing ? 0 : 1));
  });
  child.on('message', message => {
    if (message?.type !== 'lp:desktop-ready') return;
    clearTimeout(timer);
    console.log('[OK] Desktop window is ready. Keep this terminal open during development.');
  });
  timer = setTimeout(() => {
    console.error('[!] Desktop did not report ready within 45 seconds. Check the last [desktop] stage above.');
    void close(1);
  }, 45000);
} catch (error) {
  console.error('[!] Startup failed:', error.message);
  if (/5173|EADDRINUSE/.test(error.message)) console.error('Port 5173 is in use. Close the previous development launcher and retry.');
  await close(1);
}
