import { _electron as electron } from 'playwright';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import path from 'node:path';
const root=process.cwd(), dir=path.join(root,'.cache',`startup-regression-${Date.now()}`), project=path.join(dir,'project');
await mkdir(project,{recursive:true});
const fake=path.join(project,'slow-cli.mjs'), recorded=path.join(project,'input.txt');
const variant=process.argv.includes('--unrecognized-prompt') ? 'Ready to type here' : '> Ask your question...';
await writeFile(fake, `const {appendFileSync}=await import('node:fs');
process.stdout.write('Loading CLI...\\r\\n');
process.stdin.setRawMode?.(true); process.stdin.resume();
let ready=false, text='';
process.stdin.on('data', chunk => { if (!ready) return; appendFileSync(${JSON.stringify(recorded)}, chunk); for (const char of chunk.toString()) { if (char !== '\\r' && char !== '\\n') { text += char; process.stdout.write('\\r> '+text); } } });
setTimeout(() => {ready=true; process.stdout.write('\\r\\n'+${JSON.stringify(variant)}+'\\r\\n  ? for shortcuts\\r\\n');}, 2800);
`);
const env={...process.env}; delete env.ELECTRON_RUN_AS_NODE;
const app=await electron.launch({args:[path.join(root,'dist/main/main.cjs')],cwd:dir,env});
try {
 const page=await app.firstWindow();
 await app.evaluate(({dialog},folder)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[folder]});},project);
 await page.getByRole('button',{name:'打开本地项目'}).click();
 const state=await page.evaluate(()=>window.studio.bootstrap());
 const provider=state.providers.find(p=>p.kind==='command-cli'); assert.ok(provider);
 await page.evaluate(({p,fake})=>window.studio.saveProvider({...p,executable:fake}),{p:provider,fake});
 await page.evaluate(({projectId,providerId})=>window.studio.createSession(projectId,providerId),{projectId:state.projects[0].id,providerId:provider.id});
 await page.reload();
 await page.locator('.session-row').filter({hasText:'新会话'}).first().locator('.session-open').click();
 await page.locator('.terminal-host .xterm-helper-textarea').waitFor();
 // The CLI is still loading. Its textarea must not accept input before Ink is ready.
 if (!process.argv.includes('--unrecognized-prompt')) {
   assert.equal(await page.locator('.xterm-helper-textarea').evaluate(el=>el.disabled),true);
 }
 // Return to the CLI while its textarea is still disabled. The focus request must survive startup.
 await page.locator('nav.rail button').nth(3).click();
 await page.locator('nav.rail button').first().click();
 await page.locator('.terminal-boot').waitFor({state:'hidden',timeout:12000});
 assert.equal(await page.locator('.xterm-helper-textarea').evaluate(el=>el.disabled),false);
 assert.equal(await page.locator('.xterm-helper-textarea').evaluate(el=>document.activeElement===el),true,'session button kept focus after startup');
 await page.keyboard.type('FIRSTKEY'); // No Enter and no AI: this is a fake CLI.
 await page.waitForFunction(()=>document.querySelector('.xterm-screen')?.textContent?.includes('> FIRSTKEY'),undefined,{timeout:4500});
 assert.equal(await readFile(recorded,'utf8'),'FIRSTKEY','PTY received stray bytes or duplicate input');
 console.log('PASS: first key echoed after fake CLI prompt without Enter or buffering ('+variant+')');
} finally {await app.close();}




