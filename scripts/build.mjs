import { showBanner } from './banner.mjs';
import { build } from 'esbuild';
import { build as viteBuild } from 'vite';
showBanner('Building LP Studio desktop application...');
// node-pty stays external: it is a native module and must not be bundled.
await build({ entryPoints: ['apps/desktop/main.ts'], bundle: true, platform: 'node', format: 'cjs', outfile: 'dist/main/main.cjs', external: ['electron', 'node-pty'], sourcemap: true });
await build({ entryPoints: ['apps/desktop/preload.ts'], bundle: true, platform: 'node', format: 'cjs', outfile: 'dist/main/preload.cjs', external: ['electron'] });
await viteBuild();
