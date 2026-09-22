import { spawn } from 'node:child_process';
import electron from 'electron';
import { showBanner } from './banner.mjs';
showBanner('Starting LP Studio desktop window...');
const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
const child = spawn(electron, ['.'], { stdio: 'inherit', windowsHide: false, env });
child.on('error', error => { console.error(`[!] ${error.message}`); process.exitCode = 1; });
child.on('exit', code => { process.exitCode = code ?? 1; });
process.on('SIGINT', () => child.kill());
