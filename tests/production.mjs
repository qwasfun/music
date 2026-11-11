import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {chromium} from 'playwright';
const base=process.env.PRODUCTION_BASE_URL||'https://music.qwas.fun',checks=[];
assert.ok(['https://music.qwas.fun','https://music.185036.xyz'].includes(base),'Use a configured production origin');
const suffix=base==='https://music.qwas.fun'?'':'-185036';
await mkdir('output/playwright',{recursive:true});
for(const path of ['/','/sw.js','/manifest.webmanifest','/icon-192.png','/icon-512.png','/apple-touch-icon.png']){const r=await fetch(base+path,{redirect:'manual'});assert.equal(r.status,200,`${path} must load publicly`);checks.push({path,status:r.status,contentType:r.headers.get('content-type')});}
for(const path of ['/api/library','/api/me','/api/tracks/not-a-real-id/audio']){const r=await fetch(base+path,{redirect:'manual'});assert.ok([302,303,401,403].includes(r.status),`${path} must require authentication`);const redirect=r.headers.get('location');checks.push({path,status:r.status,protected:true,loginOrigin:redirect?new URL(redirect,base).origin:undefined});}
const forged=await fetch(base+'/api/library',{redirect:'manual',headers:{'Cf-Access-Jwt-Assertion':'forged'}});assert.ok([302,303,401,403].includes(forged.status));checks.push({check:'forged identity rejected',status:forged.status});
const playCounts=await fetch(base+'/api/play-counts/sync',{method:'POST',redirect:'manual',headers:{'Content-Type':'application/json'},body:JSON.stringify({userId:'anonymous-smoke',deviceId:crypto.randomUUID(),counts:[]})});assert.ok([302,303,401,403].includes(playCounts.status));checks.push({check:'play count sync requires authentication',status:playCounts.status});
const browser=await chromium.launch({channel:'chrome',headless:true});
try{
  const context=await browser.newContext({viewport:{width:1440,height:1000},serviceWorkers:'allow'});
  const page=await context.newPage(),errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.goto(base);
  await page.getByRole('link',{name:'登录曲库',exact:true}).waitFor();
  await page.waitForFunction(()=>!!navigator.serviceWorker.controller);
  await page.locator('.main-nav').getByRole('button',{name:'播放统计',exact:true}).click();
  await page.getByRole('heading',{name:'播放统计',exact:true}).waitFor();
  await page.getByText('登录曲库后即可查看播放统计。',{exact:true}).waitFor();
  await page.screenshot({path:`output/playwright/production-desktop${suffix}.png`,fullPage:true});
  await page.setViewportSize({width:390,height:844});
  await page.locator('.mobile-nav').getByRole('button',{name:'统计',exact:true}).waitFor();
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  await page.screenshot({path:`output/playwright/production-mobile${suffix}.png`,fullPage:true});
  checks.push({check:'production page and PWA controlled in browser',passed:true});
  checks.push({check:'statistics navigation and private signed-out view',passed:true});
  await page.getByRole('link',{name:'登录曲库',exact:true}).click();
  await page.waitForURL(url=>url.hostname.endsWith('cloudflareaccess.com'));
  await page.locator('input[type=email]').waitFor();
  checks.push({check:'email OTP login screen reachable',passed:true});
  assert.deepEqual(errors,[]);
  await page.screenshot({path:`output/playwright/production-login${suffix}.png`,fullPage:true});
  await context.close();
}finally{await browser.close();}
await writeFile(`output/playwright/production-results${suffix}.json`,JSON.stringify({url:base,checks},null,2));console.log(`Production ${new URL(base).hostname}: ${checks.length} smoke checks passed`);
