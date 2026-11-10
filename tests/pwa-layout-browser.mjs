import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
process.env.PLAYWRIGHT_BROWSERS_PATH ||= resolve('.cache/browsers');
const {chromium,webkit}=await import('playwright');
const base=process.env.TEST_BASE_URL||'http://127.0.0.1:4173';
assert.ok(['localhost','127.0.0.1'].includes(new URL(base).hostname),'layout fixtures only run locally');
await mkdir('output/playwright',{recursive:true});
const tracks=Array.from({length:2000},(_,i)=>({id:crypto.randomUUID(),title:`安全区歌曲 ${String(i).padStart(4,'0')}`,artist:'布局验收',album:'',duration:72,size:10000,mime:'audio/mpeg',cover:false,createdAt:new Date(2000000000000-i*1000).toISOString()}));
const library={user:{id:'layout',name:'布局验收'},tracks,playlists:[],favorites:[tracks[0].id]};
const results=[];
const cases=[
  {name:'desktop-browser',viewport:{width:1440,height:1000},insets:[0,0,0,0]},
  {name:'phone-browser',viewport:{width:390,height:844},insets:[0,0,0,0]},
  {name:'phone-standalone-zero',viewport:{width:390,height:844},insets:[0,0,0,0],standalone:true},
  {name:'phone-standalone-notch',viewport:{width:390,height:844},insets:[59,0,34,0],standalone:true},
  {name:'landscape-standalone',viewport:{width:844,height:390},insets:[0,59,21,59],standalone:true},
  {name:'tablet-standalone',viewport:{width:820,height:1180},insets:[24,0,20,0],standalone:true},
];
async function activateStandaloneCss(page){
  // Desktop automation cannot reproduce the iOS compositor or reliably emulate
  // display-mode. Apply the actual shipped standalone rules to test their layout.
  const rules=await page.evaluate(()=>[...document.styleSheets].flatMap(sheet=>[...sheet.cssRules]).filter(rule=>rule instanceof CSSMediaRule&&rule.conditionText.replaceAll(' ','')==='(display-mode:standalone)').flatMap(rule=>[...rule.cssRules].map(child=>child.cssText)).join('\n'));
  assert.ok(rules.includes('.pwa-status-bar'),'shipped standalone rules must exist');
  await page.addStyleTag({content:rules});
}
async function setInsets(page,insets){
  await page.evaluate(values=>{for(const [i,name] of ['top','right','bottom','left'].entries())document.documentElement.style.setProperty(`--safe-area-${name}`,`${values[i]}px`);},insets);
}
async function bounds(page,selector){return page.locator(selector).boundingBox();}
async function assertInside(page,selector,insets,gutter=0){
  const b=await bounds(page,selector),v=page.viewportSize();assert.ok(b,selector);
  assert.ok(b.x>=insets[3]+gutter-1,`${selector} left ${b.x}`);
  assert.ok(b.x+b.width<=v.width-insets[1]-gutter+1,`${selector} right ${b.x+b.width}`);
  assert.ok(b.y>=insets[0]+gutter-1,`${selector} top ${b.y}`);
  assert.ok(b.y+b.height<=v.height-insets[2]-gutter+1,`${selector} bottom ${b.y+b.height}`);
}
for(const [name,engine,options] of [['chromium',chromium,{channel:'chrome',headless:true}],['webkit',webkit,{headless:true}]]){
  const browser=await engine.launch(options);
  try{
    for(const scenario of cases){
      const context=await browser.newContext({viewport:scenario.viewport,serviceWorkers:'allow'}),page=await context.newPage(),checks=[],errors=[];
      page.setDefaultTimeout(15000);page.on('pageerror',e=>errors.push(e.message));
      try{
        await context.route('**/api/library',route=>route.fulfill({json:library}));
        await page.goto(base);await page.getByRole('heading',{name:/我的曲库.*2000/}).waitFor();
        if(scenario.standalone)await activateStandaloneCss(page);
        await setInsets(page,scenario.insets);
        const space=scenario.standalone?Math.max(6,scenario.insets[0]):scenario.insets[0];
        const cap=page.locator('.pwa-status-bar');assert.equal(await cap.getAttribute('aria-hidden'),'true');
        if(scenario.standalone){const b=await cap.boundingBox();assert.equal(b.y,0);assert.equal(b.width,scenario.viewport.width);assert.equal(b.height,space);assert.equal(await cap.evaluate(el=>getComputedStyle(el).pointerEvents),'none');}else assert.equal(await cap.isVisible(),false);
        const initial=await bounds(page,'.topbar');assert.equal(initial.y,0);assert.equal(await page.locator('.topbar').evaluate(el=>getComputedStyle(el).backgroundColor),'rgb(17, 19, 21)');
        const search=await bounds(page,'.search-box');assert.ok(search.y>=space);assert.ok(search.x>=scenario.insets[3]);assert.ok(search.x+search.width<=scenario.viewport.width-scenario.insets[1]);
        const cover=await bounds(page,'.now-cover');assert.ok(cover.x>=scenario.insets[3]);
        if(await page.locator('.sidebar').isVisible()){
          assert.ok((await bounds(page,'.brand')).x>=scenario.insets[3]);
          const label=page.locator('.main-nav button>span').filter({hasText:'我喜欢的'});assert.ok((await label.boundingBox()).height<20,'sidebar label must remain on one line');
        }
        checks.push('status background and controls respect zero or nonzero safe areas');

        await page.evaluate(()=>window.scrollTo(0,1200));await page.waitForFunction(()=>scrollY>100&&Math.abs(document.querySelector('.topbar').getBoundingClientRect().top)<1);
        assert.equal((await bounds(page,'.topbar')).height,initial.height);assert.ok(await page.locator('[data-track-id]').count()<=60);
        await page.getByLabel('搜索歌曲、歌手或专辑').fill(tracks.at(-1).title);
        await page.locator(`[data-track-id="${tracks.at(-1).id}"]`).waitFor();assert.equal(await page.locator('[data-track-id]').count(),1);
        await page.getByRole('button',{name:'清空搜索'}).click();checks.push('sticky toolbar remains usable with the window virtualizer and search');

        await page.evaluate(()=>window.scrollTo(0,850));
        await page.waitForFunction(()=>[...document.querySelectorAll('[data-track-id]')].some(el=>{const r=el.getBoundingClientRect(),h=document.querySelector('.topbar').getBoundingClientRect();return r.top>=h.bottom&&r.bottom<innerHeight-120;}));
        const visibleId=await page.evaluate(()=>[...document.querySelectorAll('[data-track-id]')].find(el=>{const r=el.getBoundingClientRect(),h=document.querySelector('.topbar').getBoundingClientRect();return r.top>=h.bottom&&r.bottom<innerHeight-120;}).dataset.trackId);
        await page.locator(`[data-track-id="${visibleId}"]`).getByRole('button',{name:/更多操作$/}).click();
        await assertInside(page,'.track-menu-portal',[space,...scenario.insets.slice(1)],8);
        await page.getByRole('menuitem',{name:'编辑歌曲资料',exact:true}).click();
        await assertInside(page,'.modal',[space,...scenario.insets.slice(1)]);await page.getByRole('button',{name:'关闭弹窗',exact:true}).click();
        checks.push('floating menu and edit dialog remain inside the safe viewport');

        await page.getByRole('button',{name:'上传音乐',exact:true}).click();await assertInside(page,'.modal',[space,...scenario.insets.slice(1)]);await page.getByRole('button',{name:'关闭弹窗',exact:true}).click();
        await page.getByRole('button',{name:'打开全屏播放器',exact:true}).click();await assertInside(page,'.full-player-top',[space,...scenario.insets.slice(1)]);
        await page.screenshot({path:`output/playwright/pwa-${name}-${scenario.name}-player.png`,animations:'disabled'});
        await page.getByRole('button',{name:'收起播放器',exact:true}).click();assert.equal((await bounds(page,'.topbar')).y,0);
        if(scenario.viewport.width<=760){await page.locator('.mobile-nav').getByRole('button',{name:'我喜欢的',exact:true}).click();await page.getByRole('heading',{name:/我喜欢的音乐/}).waitFor();assert.equal((await bounds(page,'.topbar')).y,0);}
        assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));assert.deepEqual(errors,[]);
        await page.getByRole('button',{name:'上传音乐',exact:true}).click({trial:true});
        await page.screenshot({path:`output/playwright/pwa-${name}-${scenario.name}.png`,animations:'disabled'});checks.push('upload, player and navigation stay usable without overflow');
        results.push({engine:name,scenario:scenario.name,status:'passed',mode:scenario.standalone?'standalone CSS rules (OS rendering not emulated)':'browser',checks});
        console.log(`${name} ${scenario.name}: ${checks.length} checks passed`);
      }catch(error){results.push({engine:name,scenario:scenario.name,status:'failed',checks,error:error.stack,errors});console.error(`${name} ${scenario.name}`,error.message);await page.screenshot({path:`output/playwright/pwa-${name}-${scenario.name}-failure.png`}).catch(()=>{});}
      finally{await context.close();}
    }
    const context=await browser.newContext({viewport:{width:390,height:844},serviceWorkers:'block'}),page=await context.newPage();
    try{
      await page.route('**/assets/index-*.js',route=>route.fulfill({contentType:'application/javascript',body:''}));
      await page.goto(base);await activateStandaloneCss(page);await setInsets(page,[59,0,34,0]);assert.equal(await page.locator('#root').textContent(),'');assert.equal((await bounds(page,'.pwa-status-bar')).height,59);
      results.push({engine:name,scenario:'before-react-startup',status:'passed',checks:['status background exists before React renders']});
    }finally{await context.close();}
  }finally{await browser.close();}
}
await writeFile('output/playwright/pwa-layout-results.json',JSON.stringify({note:'Layout tests cannot verify iOS system blur. Actual iOS 27 home-screen acceptance remains pending.',results},null,2));
if(results.some(result=>result.status!=='passed'))process.exitCode=1;
