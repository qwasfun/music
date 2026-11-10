import assert from 'node:assert/strict';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {uniqueMp3} from './fixtures/mp3.mjs';
process.env.PLAYWRIGHT_BROWSERS_PATH ||= resolve('.cache/browsers');
const {chromium,webkit}=await import('playwright');
const base=process.env.TEST_BASE_URL||'http://127.0.0.1:4173';
assert.ok(['localhost','127.0.0.1'].includes(new URL(base).hostname),'deduplication checks only run locally');
const audio=await readFile('output/fixtures/test-tone.mp3'),results=[];
await mkdir('output/playwright',{recursive:true});
for(const [engineName,engine,options] of [['chromium',chromium,{channel:'chrome',headless:true}],['webkit',webkit,{headless:true}]]){
  let browser;const checks=[],errors=[],ids=new Set();
  const prefix=`去重验收-${engineName}-${Date.now()}`;
  try{
    browser=await engine.launch(options);
    const context=await browser.newContext({viewport:{width:1440,height:1000},serviceWorkers:'allow'}),page=await context.newPage();
    page.on('pageerror',error=>errors.push(error.message));page.setDefaultTimeout(30000);
    let parts=0,completions=0,covers=0;
    page.on('request',request=>{
      const url=new URL(request.url());if(/\/api\/uploads\/[^/]+\/parts\//.test(url.pathname))parts++;
      if(url.pathname.endsWith('/complete'))completions++;
      if(url.pathname.endsWith('/cover')&&request.method()==='PUT')covers++;
    });
    const library=async()=>{const response=await fetch(`${base}/api/library`);assert.equal(response.status,200);return response.json();};
    const initial=await library(),originalIds=new Set(initial.tracks.map(track=>track.id));
    const added=async()=>{const tracks=(await library()).tracks.filter(track=>!originalIds.has(track.id));for(const track of tracks)ids.add(track.id);return tracks;};
    await page.goto(base);await page.getByRole('heading',{name:/我的曲库/}).waitFor();
    await page.getByRole('button',{name:'上传音乐',exact:true}).click();
    const file=(name,buffer)=>({name:`${name}.mp3`,mimeType:'audio/mpeg',buffer});
    const original=uniqueMp3(audio,`${prefix}-original`),changed=uniqueMp3(audio,`${prefix}-different`);
    const input=page.locator('input[type=file]');
    await input.setInputFiles(file(prefix,original));
    await page.locator('.upload-job[data-status=done]').waitFor();assert.equal((await added()).length,1);
    checks.push('first file is uploaded normally');
    const transfers={parts,completions,covers};
    await input.setInputFiles(file(prefix,original));
    await page.waitForFunction(()=>document.querySelectorAll('.upload-job[data-status=skipped]').length===1);
    assert.equal(await page.getByRole('status').filter({hasText:'歌曲已存在，已跳过'}).count(),1);
    await input.setInputFiles(file(`${prefix}-改名`,original));
    await page.waitForFunction(()=>document.querySelectorAll('.upload-job[data-status=skipped]').length===2);
    assert.deepEqual({parts,completions,covers},transfers);assert.equal((await added()).length,1);
    checks.push('same and renamed files show the skip message with zero additional part, completion or cover requests');
    await input.setInputFiles(file(prefix,changed));
    await page.waitForFunction(()=>document.querySelectorAll('.upload-job[data-status=done]').length===2);
    assert.equal((await added()).length,2);checks.push('same name and size with different content is kept');
    const concurrent=uniqueMp3(audio,`${prefix}-concurrent`);
    await input.setInputFiles([file(`${prefix}-并发A`,concurrent),file(`${prefix}-并发B`,concurrent)]);
    await page.waitForFunction(()=>document.querySelectorAll('.upload-job[data-status=done]').length===3&&document.querySelectorAll('.upload-job[data-status=skipped]').length===3);
    assert.equal((await added()).length,3);checks.push('simultaneous identical files produce one song and one skipped job');
    await page.screenshot({path:`output/playwright/dedup-${engineName}-desktop.png`,fullPage:true});
    await page.setViewportSize({width:390,height:844});
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
    await page.screenshot({path:`output/playwright/dedup-${engineName}-mobile.png`,fullPage:true});checks.push('skip messages remain visible at 390px without horizontal overflow');
    const fresh=await browser.newContext({viewport:{width:390,height:844},serviceWorkers:'allow'}),otherPage=await fresh.newPage();
    let freshTransfers=0;otherPage.on('request',request=>{if(/\/parts\//.test(request.url()))freshTransfers++;});
    await otherPage.goto(base);await otherPage.getByRole('heading',{name:/我的曲库/}).waitFor();
    await otherPage.getByRole('button',{name:'上传音乐',exact:true}).click();await otherPage.locator('input[type=file]').setInputFiles(file(`${prefix}-其他设备`,original));
    await otherPage.getByRole('status').filter({hasText:'歌曲已存在，已跳过'}).waitFor();
    assert.equal(freshTransfers,0);assert.equal((await added()).length,3);checks.push('a fresh browser session also skips the server-side duplicate before transfer');
    assert.deepEqual(errors,[]);await fresh.close();await context.close();
    results.push({engine:engineName,status:'passed',checks});console.log(`${engineName}: ${checks.length} deduplication scenarios passed`);
  }catch(error){results.push({engine:engineName,status:'failed',error:error.stack,checks,errors});console.error(engineName,error);}
  finally{
    await browser?.close();
    const current=await(await fetch(`${base}/api/library`)).json();
    for(const track of current.tracks.filter(track=>track.title.startsWith(prefix)))ids.add(track.id);
    for(const id of ids)await fetch(`${base}/api/tracks/${id}`,{method:'DELETE'});
  }
}
await writeFile('output/playwright/dedup-results.json',JSON.stringify(results,null,2));
if(results.some(result=>result.status!=='passed'))process.exitCode=1;
