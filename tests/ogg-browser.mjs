import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {parseBuffer} from 'music-metadata';
process.env.PLAYWRIGHT_BROWSERS_PATH ||= resolve('.cache/browsers');
const {chromium,webkit}=await import('playwright'),base=process.env.TEST_BASE_URL||'http://127.0.0.1:4173',results=[];
await mkdir('output/playwright',{recursive:true});
for(const[name,engine,launch]of [['chromium',chromium,{channel:'chrome',headless:true}],['webkit',webkit,{headless:true}]]){
  if(process.env.OGG_ENGINE&&process.env.OGG_ENGINE!==name)continue;const browser=await engine.launch(launch);
  try{for(const codec of ['vorbis','opus']){
    const bytes=await readFile(`output/fixtures/test-${codec}.ogg`),meta=await parseBuffer(bytes),filename=`OGG-${name}-${codec}-${Date.now()}`,title=meta.common.title||filename,checks=[],errors=[];let id;
    const context=await browser.newContext({viewport:{width:1280,height:900},serviceWorkers:'allow'}),page=await context.newPage();page.setDefaultTimeout(15000);page.on('pageerror',e=>errors.push(e.message));
    try{
      await page.goto(base);await page.waitForFunction(()=>!document.body.textContent.includes('正在打开你的音乐空间'));await page.evaluate(()=>navigator.serviceWorker.ready);await page.waitForFunction(()=>!!navigator.serviceWorker.controller);
      const probe=await page.evaluate(async base64=>{const a=new Audio(),data=Uint8Array.from(atob(base64),c=>c.charCodeAt(0)),url=URL.createObjectURL(new Blob([data],{type:'audio/ogg'}));return await new Promise(resolve=>{let timer;const finish=result=>{clearTimeout(timer);a.onloadeddata=null;a.onerror=null;a.removeAttribute('src');a.load();URL.revokeObjectURL(url);resolve(result);};a.onloadeddata=()=>finish({decoded:true});a.onerror=()=>finish({decoded:false,error:a.error?.code});timer=setTimeout(()=>finish({decoded:false,error:'timeout'}),2500);a.preload='auto';a.src=url;a.load();});},bytes.toString('base64'));
      if(!probe.decoded&&name==='webkit'&&process.platform==='win32'){results.push({engine:name,codec,status:'not-tested',reason:'Windows WebKit cannot decode the reference OGG media',probe});console.log(`${name} ${codec}: native decoder unavailable in this Windows test port`);continue;}
      assert.equal(probe.decoded,true,`${name} must decode ${codec} reference audio`);
      await page.getByRole('button',{name:'上传音乐',exact:true}).click();assert.ok((await page.locator('input[type=file]').getAttribute('accept')).includes('.ogg'));
      await page.locator('input[type=file]').setInputFiles({name:`${filename}.OGG`,mimeType:'audio/ogg',buffer:bytes});await page.getByText('已加入你的曲库',{exact:true}).waitFor();await page.getByRole('button',{name:'关闭弹窗',exact:true}).click();
      const lib=await(await fetch(base+'/api/library')).json(),track=lib.tracks.find(t=>t.title===title);assert.ok(track);id=track.id;assert.equal(track.mime,'audio/ogg');assert.equal(track.artist,meta.common.artist||'');assert.equal(track.album,meta.common.album||'');assert.ok(Math.abs(track.duration-meta.format.duration)<.01);assert.equal(track.size,bytes.length);checks.push('OGG upload and metadata extraction');
      const row=page.getByRole('row').filter({has:page.getByText(title,{exact:true})});await row.waitFor();
      const network=await fetch(`${base}/api/tracks/${id}/audio`,{headers:{Range:'bytes=0-3'}});assert.equal(network.status,206);assert.equal(network.headers.get('Content-Type'),'audio/ogg');assert.equal(await network.text(),'OggS');checks.push('OGG MIME and online byte ranges');
      await page.getByRole('button',{name:'单曲循环',exact:true}).click();await row.getByRole('button',{name:`播放 ${title}`,exact:true}).first().click();await page.getByRole('button',{name:'暂停',exact:true}).waitFor({timeout:5000});await page.waitForFunction(()=>Number(document.querySelector('input[aria-label="播放进度"]').value)>.03,null,{polling:10});checks.push('actual OGG decoding and playback');
      await row.getByRole('button',{name:`下载 ${title}`,exact:true}).click();await row.getByRole('button',{name:`${title} 已下载`,exact:true}).waitFor();checks.push('complete OGG download');
      await context.setOffline(true);await page.reload({waitUntil:'domcontentloaded'});await page.getByText('当前离线，已下载的音乐依然可以播放。',{exact:true}).waitFor();await row.waitFor();await row.getByRole('button',{name:`播放 ${title}`,exact:true}).first().click();await page.getByRole('button',{name:'暂停',exact:true}).waitFor({timeout:5000});await page.waitForFunction(()=>Number(document.querySelector('input[aria-label="播放进度"]').value)>.03,null,{polling:10});checks.push('offline cold reload and playback');
      const target=track.duration/2;await page.getByRole('slider',{name:'播放进度',exact:true}).evaluate((el,value)=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(el,String(value));el.dispatchEvent(new Event('input',{bubbles:true}));el.dispatchEvent(new Event('change',{bubbles:true}));},target);await page.waitForFunction(({target,duration})=>{const value=Number(document.querySelector('input[aria-label="播放进度"]').value);return value>=target*.85&&value<duration;},{target,duration:track.duration},{polling:10});checks.push('offline OGG seeking');
      const offline=await page.evaluate(async id=>{const r=await fetch(`/api/tracks/${id}/audio`,{headers:{Range:'bytes=0-3'}});return{status:r.status,mime:r.headers.get('Content-Type'),text:await r.text()};},id);assert.deepEqual(offline,{status:206,mime:'audio/ogg',text:'OggS'});checks.push('offline 206 byte-range response');
      const hash=await page.evaluate(async id=>{const r=await fetch(`/api/tracks/${id}/audio`),hash=await crypto.subtle.digest('SHA-256',await r.arrayBuffer());return [...new Uint8Array(hash)].map(b=>b.toString(16).padStart(2,'0')).join('');},id);assert.equal(hash,createHash('sha256').update(bytes).digest('hex'));assert.deepEqual(errors,[]);checks.push('cached OGG is byte-for-byte identical to upload');
      results.push({engine:name,codec,status:'passed',checks});console.log(`${name} ${codec}: ${checks.length} OGG checks passed`);
    }catch(e){results.push({engine:name,codec,status:'failed',checks,error:e.stack,uncaught:errors});console.error(e);await page.screenshot({path:`output/playwright/ogg-${name}-${codec}-failure.png`,fullPage:true}).catch(()=>{});}
    finally{await context.close();if(!id){const lib=await(await fetch(base+'/api/library')).json();id=lib.tracks.find(t=>t.title===title)?.id;}if(id)await fetch(`${base}/api/tracks/${id}`,{method:'DELETE'});}
  }}finally{await browser.close();}
}
await writeFile('output/playwright/ogg-results.json',JSON.stringify(results,null,2));if(results.some(r=>r.status==='failed'))process.exitCode=1;
