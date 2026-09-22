import { readdir, readFile } from 'node:fs/promises';
async function walk(dir) { for (const e of await readdir(dir, { withFileTypes: true })) { const p = `${dir}/${e.name}`; if (e.isDirectory()) await walk(p); else if (/\.[tj]sx?$/.test(p)) { const s = await readFile(p, 'utf8'); if (/(?:from\s*|import\s*\()['"](?:node:|electron|.*packages\/(?:core|providers))/.test(s)) throw Error(`Forbidden UI dependency: ${p}`); } } }
await walk('apps/ui/src'); console.log('UI dependency boundary: OK');
