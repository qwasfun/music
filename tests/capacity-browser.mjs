import assert from 'node:assert/strict';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {Mp3Encoder} from '@breezystack/lamejs';
process.env.PLAYWRIGHT_BROWSERS_PATH ||= resolve('.cache/browsers');
const {chromium,webkit}=await import('playwright');
const base=process.env.TEST_BASE_URL||'http://127.0.0.1:4173';
assert.ok(['127.0.0.1','localhost'].includes(new URL(base).hostname),'capacity checks only run locally');
await mkdir('output/playwright',{recursive:true});
const encoder=new Mp3Encoder(1,44100,128),parts=[];
for(let offset=0;offset<72*44100;offset+=1152){const pcm=new Int16Array(Math.min(1152,72*44100-offset));for(let i=0;i<pcm.length;i++)pcm[i]=Math.round(Math.sin(2*Math.PI*440*(offset+i)/44100)*4000);const part=encoder.encodeBuffer(pcm);if(part.length)parts.push(Buffer.from(part));}parts.push(Buffer.from(encoder.flush()));
const audio=Buffer.concat(parts);
const started=await fetch(`${base}/api/uploads`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({title:'容量验收合成音频',filename:'capacity-tone.mp3',artist:'自动验收',album:'',duration:72,size:audio.length})});assert.equal(started.status,201);const {id:audioId}=await started.json();
assert.equal((await fetch(`${base}/api/uploads/${audioId}/parts/1`,{method:'PUT',body:audio})).status,200);assert.equal((await fetch(`${base}/api/uploads/${audioId}/complete`,{method:'POST'})).status,201);
const tracks=Array.from({length:2000},(_,i)=>({id:crypto.randomUUID(),title:`容量歌曲 ${String(i).padStart(4,'0')}`,artist:`歌手 ${i%50}`,album:`专辑 ${i%100}`,duration:72,size:audio.length,mime:'audio/mpeg',cover:true,createdAt:new Date(2000000000000-i*1000).toISOString()}));
tracks.at(-1).id=audioId;
const library={user:{id:'capacity',name:'容量验收'},tracks,playlists:[{id:crypto.randomUUID(),name:'千首歌单',version:1,trackIds:tracks.map(t=>t.id)}],favorites:[]};
const results=[];
for(const [name,engine,options] of [['chromium',chromium,{channel:'chrome',headless:true}],['webkit',webkit,{headless:true}]]){
  let browser;const checks=[],errors=[];
  try{
    browser=await engine.launch(options);const context=await browser.newContext({viewport:{width:1440,height:1000},serviceWorkers:'block'});const page=await context.newPage();await page.addInitScript(()=>{const OriginalAudio=window.Audio;window.Audio=class extends OriginalAudio{constructor(...args){super(...args);window.capacityAudio=this;}};});page.setDefaultTimeout(20000);page.on('pageerror',error=>errors.push(error.message));
    let coverRequests=0;
    await context.route('**/api/library',route=>route.fulfill({json:library}));
    await context.route('**/api/tracks/*/cover',route=>{coverRequests++;return route.fulfill({contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><rect width="64" height="64" fill="#69844d"/></svg>'});});
    await page.goto(base);await page.getByRole('heading',{name:/我的曲库.*2000/}).waitFor();await page.waitForFunction(()=>document.querySelectorAll('[data-track-id]').length>0);
    const initialCoverRequests=coverRequests;let rows=await page.locator('[data-track-id]').count();assert.ok(rows<=60,`mounted ${rows} rows`);assert.ok(coverRequests<=60,`requested ${coverRequests} covers`);checks.push('2000 metadata rows, bounded mounted rows and initial covers');
    let session;if(name==='chromium'){session=await context.newCDPSession(page);await session.send('Emulation.setCPUThrottlingRate',{rate:4});}
    const timings=[];
    for(let i=0;i<20;i++){
      const title=tracks[i].title;
      timings.push(await page.evaluate(title=>new Promise((resolve,reject)=>{
        const input=document.querySelector('input[aria-label="搜索歌曲、歌手或专辑"]'),started=performance.now();
        const timeout=setTimeout(()=>{observer.disconnect();reject(new Error('search timeout'));},10000);
        const observer=new MutationObserver(()=>{const row=document.querySelector('[data-track-id]');if(document.querySelectorAll('[data-track-id]').length===1&&row?.textContent.includes(title)){clearTimeout(timeout);observer.disconnect();resolve(performance.now()-started);}});
        observer.observe(document.querySelector('.library-section'),{childList:true,subtree:true,characterData:true});
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,title);input.dispatchEvent(new Event('input',{bubbles:true}));
      }),title));
    }
    timings.sort((a,b)=>a-b);const searchP95=timings[Math.ceil(timings.length*.95)-1];if(name==='chromium')assert.ok(searchP95<=150,`search P95 ${searchP95} ms`);checks.push('local search latency measured under 4x CPU slowdown in Chromium');
    await page.getByRole('button',{name:'清空搜索'}).click();await page.waitForFunction(()=>document.querySelectorAll('[data-track-id]').length>5);
    if(session)await session.send('Emulation.setCPUThrottlingRate',{rate:1});
    for(const ratio of [.5,.9,1]){
      await page.evaluate(ratio=>window.scrollTo(0,(document.documentElement.scrollHeight-innerHeight)*ratio),ratio);
      await page.waitForFunction(()=>Number(document.querySelector('[data-track-id]')?.getAttribute('data-index'))>500);
      assert.ok(await page.locator('[data-track-id]').count()<=60);
    }
    const last=page.locator(`[data-track-id="${tracks.at(-1).id}"]`);await last.waitFor();
    await last.getByRole('button',{name:tracks.at(-1).title+' 更多操作'}).click();const menu=page.getByRole('menu');await menu.waitFor();const rect=await menu.boundingBox();assert.ok(rect.y>=0&&rect.y+rect.height<=1000);await page.keyboard.press('Escape');checks.push('fast scroll to last row and a visible detached menu');
    await last.getByRole('button',{name:'播放 '+tracks.at(-1).title,exact:true}).first().click();await page.getByRole('button',{name:'暂停',exact:true}).waitFor();await page.waitForFunction(()=>Number(document.querySelector('input[aria-label="播放进度"]').value)>1);
    assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('afterglow-player')).queue.length),2000);checks.push('last row plays with the complete 2000-song queue');
    await page.getByRole('button',{name:'单曲循环',exact:true}).click();
    await page.evaluate(()=>{
      window.capacityRowMutations=0;window.capacityMutationSamples=[];window.capacityObserver=new MutationObserver(records=>{window.capacityRowMutations+=records.length;if(window.capacityMutationSamples.length<8)window.capacityMutationSamples.push(...records.map(record=>({tag:record.target.nodeName,attribute:record.attributeName,previous:record.oldValue,added:record.addedNodes.length,removed:record.removedNodes.length})));});window.capacityObserver.observe(document.querySelector('.track-table tbody'),{childList:true,subtree:true,attributes:true,attributeOldValue:true,characterData:true});
    });
    console.log(`${name}: measuring playback row stability for ${name==='chromium'?60:10} seconds`);
    await page.waitForTimeout(name==='chromium'?60000:10000);
    const rowMutations=await page.evaluate(()=>{window.capacityObserver.disconnect();if(window.capacityRowMutations)console.log(JSON.stringify(window.capacityMutationSamples));return window.capacityRowMutations;});if(rowMutations)console.log(name,await page.evaluate(()=>window.capacityMutationSamples));assert.equal(rowMutations,0,'playback progress should not mutate the song list');checks.push('playback progress leaves song-list DOM unchanged');
    await page.getByRole('button',{name:'暂停',exact:true}).click();
    await page.getByRole('button',{name:'查看播放队列'}).click();await page.getByRole('heading',{name:/播放队列.*2000/}).waitFor();checks.push('complete queue view remains virtualized');
    await page.getByRole('button').filter({hasText:'千首歌单'}).first().click();await page.getByRole('heading',{name:/千首歌单.*2000/}).waitFor();
    await page.getByLabel('搜索歌曲、歌手或专辑').fill(tracks.at(-1).title);await page.getByRole('button',{name:tracks.at(-1).title+' 更多操作'}).click();assert.equal(await page.getByRole('menuitem',{name:'下移一首'}).isDisabled(),true);assert.equal(await page.getByRole('menuitem',{name:'上移一首'}).isEnabled(),true);await page.keyboard.press('Escape');await page.getByRole('button',{name:'清空搜索'}).click();checks.push('playlist actions preserve absolute positions after search');
    await page.setViewportSize({width:390,height:844});await page.evaluate(()=>window.scrollTo(0,document.documentElement.scrollHeight));await last.waitFor();await page.waitForFunction(()=>document.querySelector('.virtual-spacer td')?.colSpan===3);assert.ok((await last.locator('.track-title').boundingBox()).width>=100,'mobile title must retain readable column width');assert.ok(await page.locator('[data-track-id]').count()<=60);assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
    await last.getByRole('button',{name:tracks.at(-1).title+' 更多操作'}).click();const mobileMenu=await page.getByRole('menu').boundingBox();assert.ok(mobileMenu.x>=0&&mobileMenu.x+mobileMenu.width<=390&&mobileMenu.y+mobileMenu.height<=844);await page.keyboard.press('Escape');await page.screenshot({path:`output/playwright/capacity-${name}-mobile.png`});checks.push('390px mobile last row and menu fit the viewport');
    assert.deepEqual(errors,[]);results.push({engine:name,status:'passed',tracks:2000,mountedRows:rows,initialCoverRequests,searchP95Ms:Math.round(searchP95*10)/10,rowMutations,checks});
  }catch(error){results.push({engine:name,status:'failed',error:error.stack,checks,errors,media:await browser.contexts()[0]?.pages()[0]?.evaluate(()=>({src:window.capacityAudio?.src,error:window.capacityAudio?.error?.message,ready:window.capacityAudio?.readyState,time:window.capacityAudio?.currentTime})).catch(()=>null)});console.error(`${name}:`,error);}
  finally{await browser?.close();}
}
await fetch(`${base}/api/tracks/${audioId}`,{method:'DELETE'});
await writeFile('output/playwright/capacity-results.json',JSON.stringify(results,null,2));console.log(JSON.stringify(results,null,2));if(results.some(result=>result.status!=='passed'))process.exitCode=1;
