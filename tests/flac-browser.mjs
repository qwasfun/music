import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createFlacFixture} from './fixtures/flac.mjs';
process.env.PLAYWRIGHT_BROWSERS_PATH ||= resolve('.cache/browsers');
const {chromium,webkit}=await import('playwright');
const base=process.env.TEST_BASE_URL||'http://127.0.0.1:4173';
const picture=await readFile('public/icon-192.png'),results=[];
await mkdir('output/playwright',{recursive:true});
for(const [name,engine,launch]of [['chromium',chromium,{channel:'chrome',headless:true}],['webkit',webkit,{headless:true}]]){
  if(process.env.FLAC_ENGINE&&process.env.FLAC_ENGINE!==name)continue;if(process.platform==='win32'&&name==='webkit'&&!process.env.FLAC_ENGINE){results.push({engine:name,status:'not-tested',reason:'Windows WebKit cannot decode the reference FLAC media; real iPhone Safari validation is pending.'});continue;}const browser=await engine.launch(launch);
  try{for(const format of [{bitsPerSample:16,sampleRate:44100},{bitsPerSample:24,sampleRate:96000}]){
    let id;const checks=[],errors=[];const title=`FLAC-${name}-${format.bitsPerSample}bit-${Date.now()}`;
    const context=await browser.newContext({viewport:{width:1280,height:900},serviceWorkers:'allow'}),page=await context.newPage();page.setDefaultTimeout(20000);page.on('pageerror',e=>errors.push(e.message));await context.addInitScript(()=>{const Native=window.Audio;window.__flacEvents=[];window.Audio=function(...args){const a=new Native(...args);window.__flacAudio=a;for(const event of ['loadedmetadata','loadstart','play','playing','pause','ended','seeking','seeked','waiting','error'])a.addEventListener(event,()=>window.__flacEvents.push({event,time:a.currentTime,duration:a.duration,paused:a.paused,ready:a.readyState,error:a.error?.code,at:Math.round(performance.now())}));return a;};window.Audio.prototype=Native.prototype;});
    try{
      const bytes=createFlacFixture({...format,title,artist:'无损测试歌手',album:'无损测试专辑',picture});
      await page.goto(base);await page.waitForFunction(()=>!document.body.textContent.includes('正在打开你的音乐空间'));await page.evaluate(()=>navigator.serviceWorker.ready);await page.waitForFunction(()=>!!navigator.serviceWorker.controller);
      await page.getByRole('button',{name:'上传音乐',exact:true}).click();assert.ok((await page.locator('input[type=file]').getAttribute('accept')).includes('.flac'));
      await page.locator('input[type=file]').setInputFiles({name:`${title}.FLAC`,mimeType:'audio/flac',buffer:bytes});await page.getByText('已加入你的曲库',{exact:true}).waitFor();await page.getByRole('button',{name:'关闭弹窗',exact:true}).click();
      const lib=await(await fetch(base+'/api/library')).json(),track=lib.tracks.find(t=>t.title===title);assert.ok(track);id=track.id;
      assert.equal(track.artist,'无损测试歌手');assert.equal(track.album,'无损测试专辑');assert.equal(track.mime,'audio/flac');assert.equal(track.cover,true);assert.equal(track.duration,8);assert.equal(track.size,bytes.length);checks.push('FLAC upload, title, artist, album, cover and duration');
      const row=page.getByRole('row').filter({has:page.getByText(title,{exact:true})});await row.locator('.cover img').waitFor();
      const network=await fetch(`${base}/api/tracks/${id}/audio`,{headers:{Range:'bytes=0-3'}});assert.equal(network.status,206);assert.equal(network.headers.get('Content-Type'),'audio/flac');assert.equal(await network.text(),'fLaC');checks.push('online FLAC MIME and byte ranges');
      await row.getByRole('button',{name:`播放 ${title}`,exact:true}).first().click();await page.getByRole('button',{name:'暂停',exact:true}).waitFor();await page.waitForFunction(()=>Number(document.querySelector('input[aria-label="播放进度"]').value)>1);checks.push('actual online FLAC decoding and playback');
      await row.getByRole('button',{name:`下载 ${title}`,exact:true}).click();await row.getByRole('button',{name:`${title} 已下载`,exact:true}).waitFor();checks.push('complete FLAC download');
      await context.setOffline(true);await page.reload({waitUntil:'domcontentloaded'});await page.getByText('当前离线，已下载的音乐依然可以播放。',{exact:true}).waitFor();await row.waitFor();await row.getByRole('button',{name:`播放 ${title}`,exact:true}).first().click();await page.getByRole('button',{name:'暂停',exact:true}).waitFor();
      await page.getByRole('slider',{name:'播放进度',exact:true}).evaluate(el=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(el,'3');el.dispatchEvent(new Event('input',{bubbles:true}));el.dispatchEvent(new Event('change',{bubbles:true}));});await page.waitForFunction(()=>{const v=Number(document.querySelector('input[aria-label="播放进度"]').value);return v>=3&&v<5;});checks.push('offline cold reload, FLAC playback and seeking');
      await row.locator('.cover img').waitFor();await page.waitForFunction(()=>{const images=[...document.querySelectorAll('.track-info .cover img')];return images.some(img=>img.complete&&img.naturalWidth>0);});checks.push('offline embedded cover');
      const offline=await page.evaluate(async id=>{const r=await fetch(`/api/tracks/${id}/audio`,{headers:{Range:'bytes=0-3'}});return{status:r.status,mime:r.headers.get('Content-Type'),body:await r.text()};},id);assert.deepEqual(offline,{status:206,mime:'audio/flac',body:'fLaC'});checks.push('offline FLAC byte-range response');
      const hash=await page.evaluate(async id=>{const r=await fetch(`/api/tracks/${id}/audio`);const digest=await crypto.subtle.digest('SHA-256',await r.arrayBuffer());return [...new Uint8Array(digest)].map(b=>b.toString(16).padStart(2,'0')).join('');},id);assert.equal(hash,createHash('sha256').update(bytes).digest('hex'));assert.deepEqual(errors,[]);checks.push('cached audio is byte-for-byte identical to uploaded FLAC');
      results.push({engine:name,...format,status:'passed',checks});console.log(`${name} ${format.bitsPerSample}-bit/${format.sampleRate}Hz FLAC: ${checks.length} checks passed`);
    }catch(e){results.push({engine:name,...format,status:'failed',checks,error:e.stack,uncaught:errors,media:await page.evaluate(()=>({events:window.__flacEvents,paused:window.__flacAudio?.paused,time:window.__flacAudio?.currentTime,ready:window.__flacAudio?.readyState,persisted:localStorage.getItem('afterglow-player')}))});console.error(e);await page.screenshot({path:`output/playwright/flac-${name}-${format.bitsPerSample}-failure.png`,fullPage:true}).catch(()=>{});}
    finally{await context.close();if(!id){const lib=await(await fetch(base+'/api/library')).json();id=lib.tracks.find(t=>t.title===title)?.id;}if(id)await fetch(`${base}/api/tracks/${id}`,{method:'DELETE'});}
  }}finally{await browser.close();}
}
await writeFile('output/playwright/flac-results.json',JSON.stringify(results,null,2));if(results.some(r=>r.status==='failed'))process.exitCode=1;
