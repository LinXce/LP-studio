import { _electron as electron } from 'playwright';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import path from 'node:path';
const root=process.cwd(), dir=path.join(root,'.cache',`startup-regression-${Date.now()}`), project=path.join(dir,'project');
await mkdir(project,{recursive:true});
const fake=path.join(project,'slow-cli.mjs'), recorded=path.join(project,'input.txt'), early=path.join(project,'early.txt');
const variant=process.argv.includes('--unrecognized-prompt') ? 'Ready to type here' : '> Ask your question...';
await writeFile(fake, `const {appendFileSync}=await import('node:fs');
process.stdout.write('Loading CLI...\\r\\n');
process.stdin.setRawMode?.(true); process.stdin.resume();
let ready=false, text='';
process.stdin.on('data', chunk => { if (!ready) { appendFileSync(${JSON.stringify(early)}, chunk); return; } appendFileSync(${JSON.stringify(recorded)}, chunk); for (const char of chunk.toString()) { if (char !== '\\r' && char !== '\\n') { text += char; process.stdout.write('\\r> '+text); } } });
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
 await page.getByRole('button',{name:'\u8f93\u5165\u8bca\u65ad'}).click();
 await page.getByRole('status').filter({hasText:'\u8f93\u5165\u8bca\u65ad\uff1a'}).waitFor();
 // Input travels directly to the PTY even during startup; no disabled textarea or queue.
 assert.equal(await page.locator('.xterm-helper-textarea').evaluate(el=>el.disabled),false);
 await page.keyboard.press('b');
 let earlyInput = '';
 for(let i=0;i<25;i++) { try { earlyInput=await readFile(early,'utf8'); } catch {} if(earlyInput) break; await page.waitForTimeout(80); }
 assert.equal(earlyInput,'b','startup key must reach PTY immediately');
 assert.match(await page.getByRole('status').filter({hasText:'\u8f93\u5165\u8bca\u65ad\uff1a'}).innerText(), /xterm \u53d1\u9001 [1-9]/, 'diagnostic counter did not observe first input');
 const cdp=await page.context().newCDPSession(page);
 await cdp.send('Input.imeSetComposition',{text:'nihao',selectionStart:5,selectionEnd:5});
 await page.waitForFunction(() => /\u7ec4\u5408\u5f00\u59cb\/\u7ed3\u675f [1-9]/.test(document.querySelector('[role=status]')?.textContent ?? ''));
 await cdp.send('Input.imeSetComposition',{text:'',selectionStart:0,selectionEnd:0});
 // Return to the CLI during startup, then test the first key after its prompt.
 await page.locator('nav.rail button').nth(3).click();
 await page.locator('nav.rail button').first().click();
 await page.locator('.terminal-boot:not([role=status])').waitFor({state:'hidden',timeout:12000});
 // The PTY connection and the fake CLI prompt are separate events.
 await page.waitForFunction(() => document.querySelector('.xterm-screen')?.textContent?.includes('Ask your question') || document.querySelector('.xterm-screen')?.textContent?.includes('Ready to type here'), undefined, {timeout:10000});
 assert.equal(await page.locator('.xterm-helper-textarea').evaluate(el=>el.disabled),false);
 assert.equal(await page.locator('.xterm-helper-textarea').evaluate(el=>document.activeElement===el),true,'session button kept focus after startup');
 await page.keyboard.type('FIRSTKEY'); // No Enter and no AI: this is a fake CLI.
 await page.waitForFunction(()=>document.querySelector('.xterm-screen')?.textContent?.includes('> FIRSTKEY'),undefined,{timeout:4500});
 // Simulate the real focus-loss case: a menu or session tab kept focus.
 await page.locator('nav.rail button').first().focus();
 await page.keyboard.press('z');
 await page.waitForFunction(() => document.querySelector('.xterm-helper-textarea') === document.activeElement);
 await page.locator('.terminal-view .session-tab.active .tab-open').focus();
 await page.keyboard.press('x');
 await page.waitForFunction(() => document.querySelector('.xterm-helper-textarea') === document.activeElement);
 assert.equal(await readFile(recorded,'utf8'),'FIRSTKEYzx','PTY received stray bytes or duplicate input');
 console.log('PASS: first key echoed after fake CLI prompt without Enter or buffering ('+variant+')');
} finally {await app.close();}




