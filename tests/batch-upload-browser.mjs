import assert from 'node:assert/strict';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {uniqueMp3} from './fixtures/mp3.mjs';
process.env.PLAYWRIGHT_BROWSERS_PATH ||= resolve('.cache/browsers');
const {chromium}=await import('playwright');
const base=process.env.TEST_BASE_URL||'http://127.0.0.1:4173';
assert.ok(['localhost','127.0.0.1'].includes(new URL(base).hostname));
const audio=await readFile('output/fixtures/test-tone.mp3'),prefix=`批量验收-${Date.now()}`;
const browser=await chromium.launch({channel:'chrome',headless:true});
let release=()=>{},requests=0,captured=false;
const checks=[];
try{
  const context=await browser.newContext({viewport:{width:1440,height:1000},serviceWorkers:'allow'}),page=await context.newPage();page.setDefaultTimeout(20000);
  await page.goto(base);await page.waitForFunction(()=>!document.body.textContent.includes('正在打开你的音乐空间'));await page.getByRole('button',{name:'刷新云端曲库'}).waitFor();await page.waitForFunction(()=>!document.querySelector('button[aria-label="刷新云端曲库"]').disabled);
  let hold=true;const gate=new Promise(resolve=>{release=resolve;});
  await context.route('**/api/library',async route=>{requests++;if(hold){hold=false;const response=await route.fetch();captured=true;await gate;await route.fulfill({response});}else await route.continue();});
  await context.route('**/api/uploads/*/parts/*',async route=>{await new Promise(resolve=>setTimeout(resolve,100));await route.continue();});
  await page.getByRole('button',{name:'上传音乐',exact:true}).click();await page.locator('input[type=file]').setInputFiles(Array.from({length:20},(_,i)=>({name:`${prefix}-${i}.mp3`,mimeType:'audio/mpeg',buffer:uniqueMp3(audio,`${prefix}-${i}`)})));
  await page.locator('.upload-job .job-icon.complete').first().waitFor();await page.getByRole('button',{name:'关闭弹窗',exact:true}).click();await page.getByRole('button',{name:'刷新云端曲库'}).click();
  const deadline=Date.now()+30000;
  while(!captured){assert.ok(Date.now()<deadline);await new Promise(resolve=>setTimeout(resolve,25));}
  await page.getByRole('button',{name:'上传音乐',exact:true}).waitFor();await page.getByLabel('搜索歌曲、歌手或专辑').fill(prefix);
  await page.getByRole('heading',{name:/搜索结果.*20/}).waitFor();assert.equal(requests,1);checks.push('20 successful songs appear locally while an older full snapshot is still pending');
  release();await page.waitForFunction(()=>!document.querySelector('button[aria-label="刷新云端曲库"]').disabled);await page.getByRole('heading',{name:/搜索结果.*20/}).waitFor();assert.equal(requests,2);checks.push('stale in-flight response keeps new uploads; final reconciliation requests one fresh snapshot');
  const library=await(await fetch(`${base}/api/library`)).json();assert.equal(library.tracks.filter(track=>track.title.startsWith(prefix)).length,20);checks.push('all 20 audio files completed on the local server');
  await mkdir('output/playwright',{recursive:true});await writeFile('output/playwright/batch-upload-results.json',JSON.stringify({status:'passed',songs:20,libraryRequests:requests,checks},null,2));console.log(`Batch upload: ${checks.length} checks passed, ${requests} library requests (one manual, one final)`);
}finally{
  release();await browser.close();const library=await(await fetch(`${base}/api/library`)).json();for(const track of library.tracks.filter(track=>track.title.startsWith(prefix)))await fetch(`${base}/api/tracks/${track.id}`,{method:'DELETE'});
}
