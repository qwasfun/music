import {beforeAll,beforeEach,afterAll,describe,it,expect,vi} from 'vitest';
import {AUDIO_CACHE,audioUrl,type Library} from '../shared/contracts';
const stores=vi.hoisted(()=>({kv:new Map<string,any>(),entries:new Map<string,any>(),tasks:new Map<string,any>()}));
vi.mock('../src/storage',()=>({dbPromise:Promise.resolve({get:(s:keyof typeof stores,k:string)=>stores[s].get(k),put:(s:keyof typeof stores,v:any,k?:string)=>{stores[s].set(k||v.id,v);},delete:(s:keyof typeof stores,k:string)=>stores[s].delete(k),getAll:(s:keyof typeof stores)=>[...stores[s].values()],clear:(s:keyof typeof stores)=>stores[s].clear()}),readLocal:async(k:string)=>stores.kv.get(k),writeLocal:async(k:string,v:any)=>{stores.kv.set(k,v);}}));
import {downloads} from '../src/cache';
class MemoryCache {
  values=new Map<string,Response>();failQuota=false;
  key(input:Request|string){return typeof input==='string'?input:input.url;}
  async put(input:Request|string,response:Response){if(this.failQuota)throw new DOMException('Quota exceeded','QuotaExceededError');const bytes=await response.arrayBuffer();this.values.set(this.key(input),new Response(bytes,{headers:response.headers,status:response.status}));}
  async match(input:Request|string){return this.values.get(this.key(input))?.clone();}
  async delete(input:Request|string){return this.values.delete(this.key(input));}
  async keys(){return [...this.values.keys()].map(k=>new Request(new URL(k,'http://localhost')));}
}
const cache=new MemoryCache();
const library:Library={user:{id:'test',name:'test'},tracks:[{id:'one',title:'one',artist:'',album:'',duration:10,size:4,mime:'audio/mpeg',cover:false,createdAt:''}],playlists:[],favorites:[]};
beforeAll(()=>{const win=Object.assign(new EventTarget(),{caches:{}});vi.stubGlobal('window',win);vi.stubGlobal('document',Object.assign(new EventTarget(),{visibilityState:'visible'}));vi.stubGlobal('navigator',{onLine:true,serviceWorker:{},storage:{estimate:async()=>({quota:1024**3,usage:0}),persisted:async()=>false}});vi.stubGlobal('localStorage',{removeItem:()=>{}});vi.stubGlobal('caches',{open:async()=>cache,delete:async()=>{cache.values.clear();return true;}});});
beforeEach(async()=>{await downloads.logout();cache.failQuota=false;cache.values.clear();await downloads.init();downloads.setLibrary(structuredClone(library));});
afterAll(async()=>{await downloads.logout();vi.unstubAllGlobals();});
const waitDone=()=>vi.waitFor(()=>expect(downloads.snapshot().tasks.some(t=>t.status==='downloading')).toBe(false));
describe('complete-file downloader',()=>{
  it('marks a file ready only after all expected bytes are stored',async()=>{vi.stubGlobal('fetch',vi.fn(async()=>new Response(new Uint8Array(4),{headers:{'Content-Type':'audio/mpeg','Content-Length':'4'}})));await downloads.enqueue('one');await vi.waitFor(()=>expect(downloads.entries.has('one')).toBe(true));expect((await cache.match(audioUrl('one')))?.status).toBe(200);expect(stores.entries.get('one').pinned).toBe(true);});
  it('rejects truncated downloads and removes partial cache data',async()=>{vi.stubGlobal('fetch',vi.fn(async()=>new Response(new Uint8Array(3),{headers:{'Content-Type':'audio/mpeg','Content-Length':'4'}})));await downloads.enqueue('one');await vi.waitFor(()=>expect(downloads.snapshot().tasks[0]?.status).toBe('error'));expect(downloads.entries.has('one')).toBe(false);expect(await cache.match(audioUrl('one'))).toBeUndefined();expect(downloads.snapshot().tasks[0].error).toContain('下载未完成');});
  it('does not cache a login HTML page as audio',async()=>{vi.stubGlobal('fetch',vi.fn(async()=>new Response('<html>login</html>',{headers:{'Content-Type':'text/html','Content-Length':'18'}})));await downloads.enqueue('one');await vi.waitFor(()=>expect(downloads.snapshot().tasks[0]?.status).toBe('error'));expect(downloads.entries.size).toBe(0);expect(cache.values.size).toBe(0);});
  it('reports quota exhaustion with a concrete correction',async()=>{cache.failQuota=true;vi.stubGlobal('fetch',vi.fn(async()=>new Response(new Uint8Array(4),{headers:{'Content-Type':'audio/mpeg','Content-Length':'4'}})));await downloads.enqueue('one');await vi.waitFor(()=>expect(downloads.snapshot().tasks[0]?.status).toBe('error'));expect(downloads.snapshot().tasks[0].error).toContain('清理缓存或释放设备空间');expect(downloads.entries.size).toBe(0);});
  it('rejects insufficient browser space before starting a download',async()=>{vi.stubGlobal('navigator',{onLine:true,serviceWorker:{},storage:{estimate:async()=>({quota:2,usage:0}),persisted:async()=>false}});const fetcher=vi.fn();vi.stubGlobal('fetch',fetcher);await downloads.enqueue('one');await vi.waitFor(()=>expect(downloads.snapshot().tasks[0]?.status).toBe('error'));expect(fetcher).not.toHaveBeenCalled();expect(downloads.snapshot().tasks[0].error).toContain('请释放至少');});
});
