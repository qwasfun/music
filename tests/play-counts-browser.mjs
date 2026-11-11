import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {chromium} from 'playwright';
import {uniqueMp3} from './fixtures/mp3.mjs';

const base=new URL(process.env.TEST_BASE_URL||'http://127.0.0.1:4173');
assert.ok(['localhost','127.0.0.1'].includes(base.hostname),'Use an isolated local preview for playback statistics tests');
const output='output/playwright';
await mkdir(output,{recursive:true});
const checks=[],ids=[],errors=[];
const browser=await chromium.launch({channel:'chrome',headless:true});

async function request(path,method='GET',body){
  const response=await fetch(new URL(`/api${path}`,base),{
    method,headers:body instanceof Uint8Array||body===undefined?undefined:{'Content-Type':'application/json'},
    body:body instanceof Uint8Array||body===undefined?body:JSON.stringify(body),
  });
  assert.ok(response.ok,`${method} ${path}: ${response.status} ${response.ok?'':await response.text()}`);
  return response.json();
}
async function upload(title){
  const bytes=uniqueMp3(await readFile('output/fixtures/test-tone.mp3'),title);
  const {id}=await request('/uploads','POST',{title,artist:'用于检查窄屏播放次数的长歌手名称',filename:`${title}.mp3`,size:bytes.length,duration:18});
  await request(`/uploads/${id}/parts/1`,'PUT',bytes);
  const track=await request(`/uploads/${id}/complete`,'POST');
  ids.push(track.id);
  return track;
}
const row=(page,track)=>page.locator(`[data-track-id="${track.id}"]`);
const nav=(page,mobile,label)=>page.locator(mobile?'.mobile-nav':'.main-nav').getByRole('button',{name:label,exact:true});
const playerButton=(page,name)=>page.locator('.player-bar').getByRole('button',{name,exact:true});
const time=(page,minimum)=>page.waitForFunction(seconds=>Number(document.querySelector('[aria-label="播放进度"]').value)>=seconds,minimum);
const trackCount=(page,track,count)=>row(page,track).getByText(`${count} 次播放`,{exact:true}).waitFor();
const total=(page,count)=>page.locator('.play-statistics-summary').getByText(`${count} 次`,{exact:true}).waitFor();
const start=(page,track)=>row(page,track).locator('.cover-button').click();
async function seek(page,seconds){
  await page.getByRole('slider',{name:'播放进度',exact:true}).evaluate((input,value)=>{
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,String(value));
    input.dispatchEvent(new Event('input',{bubbles:true}));
  },seconds);
}
async function session(viewport){
  const context=await browser.newContext({viewport,serviceWorkers:'allow'});
  const page=await context.newPage();
  page.on('pageerror',error=>errors.push(error.message));
  page.setDefaultTimeout(18000);
  await page.goto(base.href);
  await page.waitForFunction(()=>!!navigator.serviceWorker.controller);
  return {context,page};
}

try{
  const userId=(await request('/me')).id;
  const observer=randomUUID();
  const cloud=()=>request('/play-counts/sync','POST',{userId,deviceId:observer,counts:[]});
  const baseline=(await cloud()).totalCount;
  const track=await upload(`计次验收-${Date.now()}`);
  const second=await upload(`排序验收-${Date.now()}`);
  const {page:desktop}=await session({width:1440,height:960});
  await nav(desktop,false,'播放统计').click();
  await total(desktop,baseline);
  assert.equal(await row(desktop,track).count(),0);
  await nav(desktop,false,'我的曲库').click();
  await trackCount(desktop,track,0);
  await start(desktop,track);
  await time(desktop,1);
  await seek(desktop,12);
  await time(desktop,12.5);
  await trackCount(desktop,track,0);
  await seek(desktop,0);
  await time(desktop,3);
  await playerButton(desktop,'暂停').click();
  await trackCount(desktop,track,0);
  await playerButton(desktop,'播放').click();
  await trackCount(desktop,track,1);
  await playerButton(desktop,'暂停').click();
  await desktop.waitForResponse(async response=>response.url().endsWith('/api/play-counts/sync')&&response.ok()&&
    (await response.json()).trackCounts[track.id]===1);
  await desktop.getByRole('combobox',{name:'歌曲排序'}).selectOption('plays');
  assert.equal(await desktop.locator('[data-track-id]').first().getAttribute('data-track-id'),track.id);
  await nav(desktop,false,'播放统计').click();
  await total(desktop,baseline+1);
  await trackCount(desktop,track,1);
  assert.equal(await row(desktop,second).count(),0);
  await desktop.screenshot({path:`${output}/play-counts-desktop.png`});
  checks.push('threshold, seek, pause and resume, per-song count, sorting and ranking');

  const {context:mobileContext,page:mobile}=await session({width:390,height:844});
  await trackCount(mobile,track,1);
  await mobile.getByRole('combobox',{name:'歌曲排序'}).selectOption('plays');
  assert.equal(await mobile.locator('[data-track-id]').first().getAttribute('data-track-id'),track.id);
  await row(mobile,track).getByRole('button',{name:`下载 ${track.title}`,exact:true}).click();
  await row(mobile,track).getByRole('button',{name:`${track.title} 已下载`,exact:true}).waitFor();
  await mobileContext.setOffline(true);
  await mobile.reload({waitUntil:'domcontentloaded'});
  await trackCount(mobile,track,1);
  await start(mobile,track);
  await trackCount(mobile,track,2);
  await playerButton(mobile,'暂停').click();
  await mobile.reload({waitUntil:'domcontentloaded'});
  await nav(mobile,true,'统计').click();
  await total(mobile,baseline+2);
  await trackCount(mobile,track,2);
  assert.equal((await cloud()).trackCounts[track.id],1);
  assert.ok(await mobile.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  assert.ok(await row(mobile,track).locator('.track-play-count').evaluate(el=>el.getBoundingClientRect().right<=el.parentElement.getBoundingClientRect().right+1));
  await mobile.screenshot({path:`${output}/play-counts-mobile.png`});
  checks.push('second browser, offline count, cold reopen, 390px layout');

  const synced=mobile.waitForResponse(async response=>response.url().endsWith('/api/play-counts/sync')&&response.ok()&&
    (await response.json()).trackCounts[track.id]===2);
  await mobileContext.setOffline(false);
  await synced;
  await total(mobile,baseline+2);
  await desktop.getByRole('button',{name:'刷新云端曲库'}).click();
  await total(desktop,baseline+2);
  assert.equal((await cloud()).trackCounts[track.id],2);
  checks.push('reconnect sync and cross-device merge without double counting');

  await mobileContext.setOffline(true);
  await start(mobile,track);
  await trackCount(mobile,track,3);
  await playerButton(mobile,'暂停').click();
  await request(`/tracks/${track.id}`,'DELETE');
  ids.splice(ids.indexOf(track.id),1);
  const late=mobile.waitForResponse(async response=>response.url().endsWith('/api/play-counts/sync')&&response.ok()&&
    (await response.json()).trackCounts[track.id]===3);
  await mobileContext.setOffline(false);
  await late;
  await desktop.getByRole('button',{name:'刷新云端曲库'}).click();
  await total(desktop,baseline+3);
  assert.equal(await row(desktop,track).count(),0);
  checks.push('offline count for a deleted song is retained in historical total');
  assert.deepEqual(errors,[]);
  console.log(`Play counts: ${checks.length} browser scenarios passed`);
}finally{
  await browser.close();
  for(const id of ids)await request(`/tracks/${id}`,'DELETE');
  await writeFile(`${output}/play-counts-results.json`,JSON.stringify({checks,errors},null,2));
}
