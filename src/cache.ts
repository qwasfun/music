import { AUDIO_CACHE,COVER_CACHE,audioUrl,coverUrl,evictionPlan,formatBytes,type CacheEntry,type DownloadTask,type Library,type Track } from '../shared/contracts';
import { dbPromise,readLocal,writeLocal } from './storage';
import { notice } from './events';
export interface CacheSettings { auto:boolean; limit:number }
export interface CacheState { entries:CacheEntry[]; tasks:(DownloadTask & {progress?:number})[]; settings:CacheSettings; available:boolean; persistent:boolean; checking:boolean }
class Downloads {
  entries=new Map<string,CacheEntry>(); tasks=new Map<string,DownloadTask & {progress?:number}>();
  settings:CacheSettings={auto:false,limit:1024**3}; available=false; persistent=false;
  private tracks=new Map<string,Track>(); private active=new Map<string,{controller:AbortController;promise:Promise<void>}>(); private reservations=0; private lock:Promise<void>=Promise.resolve(); private listeners=new Set<()=>void>(); private stopped=false;
  private generation=0; private listening=false;private libraryReady=false;
  private reconciliation:Promise<void>=Promise.resolve();
  private state:CacheState={entries:[],tasks:[],settings:this.settings,available:false,persistent:false,checking:false};
  private overview=this.state;
  subscribe=(fn:()=>void)=>{this.listeners.add(fn);return()=>this.listeners.delete(fn);};
  snapshot=()=>this.state;
  overviewSnapshot=()=>this.overview;
  private emit(progressOnly=false){
    const tasks=[...this.tasks.values()].map(t=>({...t}));
    this.state=progressOnly?{...this.state,tasks}:{...this.state,entries:[...this.entries.values()],tasks,settings:{...this.settings},available:this.available,persistent:this.persistent};
    if(!progressOnly)this.overview=this.state;
    for(const fn of this.listeners)fn();
  }
  whenReady=()=>this.reconciliation;
  init(){this.reconciliation=this.reconcile();return this.reconciliation;}
  private async reconcile(){
    const generation=++this.generation;this.state={...this.state,checking:true};this.emit();
    try {
      if(!('caches'in window)||!('serviceWorker'in navigator))throw new Error('此浏览器不支持离线缓存，请使用 Safari、Chrome 或 Edge');
      const db=await dbPromise;const settings=await readLocal<CacheSettings>('cache-settings');if(generation!==this.generation)return;this.settings=settings||this.settings;
      const cache=await caches.open(AUDIO_CACHE);
      if(generation!==this.generation)return;
      const entries=await db.getAll('entries') as CacheEntry[];let index=0;
      await Promise.all(Array.from({length:Math.min(4,entries.length)},async()=>{
        while(index<entries.length&&generation===this.generation){const e=entries[index++];const r=await cache.match(audioUrl(e.id));if(generation!==this.generation)return;if(r?.status===200&&Number(r.headers.get('Content-Length'))===e.size)this.entries.set(e.id,e);else await db.delete('entries',e.id);}
      }));
      if(generation!==this.generation)return;
      for(const request of await cache.keys()){if(generation!==this.generation)return;const id=new URL(request.url).pathname.split('/')[3];if(!this.entries.has(id))await cache.delete(request);}
      for(const task of await db.getAll('tasks') as DownloadTask[]){if(generation!==this.generation)return;if(!this.entries.has(task.id))this.tasks.set(task.id,{...task,status:task.status==='downloading'?'queued':task.status});else await db.delete('tasks',task.id);}
      const persistent=await navigator.storage?.persisted?.()||false;if(generation!==this.generation)return;
      this.available=true;this.persistent=persistent;
    }catch(e){if(generation!==this.generation)return;this.available=false;notice(`离线缓存：${(e as Error).message}；仍可在线播放`);}
    if(generation!==this.generation)return;this.state={...this.state,checking:false};this.emit();
    if(!this.listening){this.listening=true;window.addEventListener('online',()=>this.pump());document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible')this.pump();});}
    if(this.libraryReady)void this.prune();
  }
  setLibrary(library:Library){this.tracks=new Map(library.tracks.map(t=>[t.id,t]));this.libraryReady=true;this.stopped=false;void this.prune();}
  private async prune(){if(this.state.checking)return;for(const id of this.entries.keys())if(!this.tracks.has(id))await this.remove(id);for(const id of this.tasks.keys())if(!this.tracks.has(id))await this.cancel(id);this.pump();}
  async setSettings(settings:CacheSettings){if(!Number.isFinite(settings.limit)||settings.limit<64*1024**2){notice('缓存容量：至少设置为 64 MB，请增大容量');return;}this.settings=settings;await writeLocal('cache-settings',settings);const plan=evictionPlan([...this.entries.values()],this.reservations,settings.limit);for(const id of plan.remove)await this.remove(id);if(plan.shortage)notice(`缓存容量：手动下载占用较多，请清理至少 ${formatBytes(plan.shortage)} 或提高上限`);this.emit();this.pump();}
  async requestPersistence(){try{this.persistent=await navigator.storage?.persist?.()||false;this.emit();notice(this.persistent?'已获得持久存储许可':'浏览器未授予持久存储，系统仍可能清理缓存');}catch{notice('持久存储：当前浏览器不支持此设置');}}
  async enqueue(id:string,pinned=true){
    if(!this.available){notice('离线缓存：当前浏览器不可用，请更换浏览器或允许网站存储');return;}
    const existing=this.entries.get(id);if(existing){if(pinned&&!existing.pinned){existing.pinned=true;await(await dbPromise).put('entries',existing);this.emit();}return;}
    if(!this.tracks.has(id))return;
    const task=this.tasks.get(id)||{id,pinned,status:'queued' as const};task.pinned ||= pinned;if(task.status!=='downloading')task.status='queued';delete task.error;this.tasks.set(id,task);await(await dbPromise).put('tasks',{id,pinned:task.pinned,status:task.status});this.emit();this.pump();
  }
  async touch(id:string){const e=this.entries.get(id);if(e){e.lastUsed=Date.now();await(await dbPromise).put('entries',e);}if(this.settings.auto && !e)await this.enqueue(id,false);}
  private pump(){if(this.stopped||!this.available||this.state.checking||!navigator.onLine||document.visibilityState==='hidden')return;while(this.active.size<2){const t=[...this.tasks.values()].filter(t=>t.status==='queued'&&!this.active.has(t.id)).sort((a,b)=>Number(b.pinned)-Number(a.pinned))[0];if(!t)break;const controller=new AbortController();t.status='downloading';const promise=Promise.resolve().then(()=>this.download(t,controller.signal)).finally(()=>{this.active.delete(t.id);this.emit();this.pump();});this.active.set(t.id,{controller,promise});}this.emit();}
  private async reserve(size:number){
    const previous=this.lock;let release!:()=>void;this.lock=new Promise(r=>release=r);await previous;
    try {const plan=evictionPlan([...this.entries.values()],size+this.reservations,this.settings.limit);if(plan.shortage)throw new Error(`缓存空间不足：请清理至少 ${formatBytes(plan.shortage)}，或提高缓存容量`);for(const id of plan.remove)await this.remove(id);const estimate=await navigator.storage?.estimate?.();if(estimate?.quota&&estimate.usage!==undefined){const missing=size+this.reservations-(estimate.quota-estimate.usage);if(missing>0)throw new Error(`设备空间不足：请释放至少 ${formatBytes(missing)} 后重试`);}this.reservations+=size;}finally{release();}
  }
  private async download(task:DownloadTask & {progress?:number},signal:AbortSignal){
    const track=this.tracks.get(task.id);if(!track)return;let reserved=false;const cache=await caches.open(AUDIO_CACHE);
    try {
      await this.reserve(track.size);reserved=true;if(signal.aborted)throw new DOMException('Canceled','AbortError');
      const response=await fetch(audioUrl(track.id),{signal,cache:'no-store',redirect:'manual',headers:{'X-Music-Download':'1'}});
      if(response.type==='opaqueredirect'||[401,403].includes(response.status))throw new Error('登录已过期：请重新登录曲库后重试下载');
      if(response.status!==200||!response.body||!/^audio\//.test(response.headers.get('Content-Type')||''))throw new Error('音频下载失败：请检查网络或重新登录后重试');
      const length=Number(response.headers.get('Content-Length'));if(length!==track.size)throw new Error('音频大小不一致：请刷新曲库后重新下载');
      let received=0,last=0;
      const meter=new TransformStream<Uint8Array,Uint8Array>({transform:(chunk,controller)=>{received+=chunk.byteLength;if(Date.now()-last>200){task.progress=received/track.size;last=Date.now();this.emit(true);}controller.enqueue(chunk);}});
      await cache.put(audioUrl(track.id),new Response(response.body.pipeThrough(meter),{status:200,headers:response.headers}));
      if(received!==track.size||signal.aborted)throw new Error('下载未完成：请重新下载');
      const entry:CacheEntry={id:track.id,size:track.size,pinned:task.pinned,lastUsed:Date.now()};await(await dbPromise).put('entries',entry);this.entries.set(track.id,entry);this.tasks.delete(track.id);await(await dbPromise).delete('tasks',track.id);
      if(track.cover){try{const cover=await fetch(coverUrl(track.id),{signal,redirect:'manual'});if(cover.ok&&cover.headers.get('Content-Type')?.startsWith('image/'))await(await caches.open(COVER_CACHE)).put(coverUrl(track.id),cover);}catch{}}
    }catch(e){await cache.delete(audioUrl(track.id));if(!signal.aborted){task.status='error';task.error=(e as Error).name==='QuotaExceededError'?'设备存储不足：请清理缓存或释放设备空间后重试':(e as Error).message;delete task.progress;await(await dbPromise).put('tasks',{id:task.id,pinned:task.pinned,status:'error',error:task.error});notice(task.error);}}
    finally{if(reserved)this.reservations-=track.size;this.emit();}
  }
  async cancel(id:string){const job=this.active.get(id);if(job){job.controller.abort();await job.promise;}this.tasks.delete(id);await(await dbPromise).delete('tasks',id);this.emit();}
  async remove(id:string){await this.cancel(id);this.entries.delete(id);await(await caches.open(AUDIO_CACHE)).delete(audioUrl(id));await(await dbPromise).delete('entries',id);this.emit();}
  async clear(all=true){for(const id of [...this.tasks.keys()])await this.cancel(id);for(const e of [...this.entries.values()])if(all||!e.pinned)await this.remove(e.id);}
  async logout(){this.generation++;this.libraryReady=false;this.stopped=true;for(const active of this.active.values())active.controller.abort();await Promise.allSettled([...this.active.values()].map(a=>a.promise));await caches.delete(AUDIO_CACHE);await caches.delete(COVER_CACHE);const db=await dbPromise;for(const store of ['kv','entries','tasks'])await db.clear(store);this.entries.clear();this.tasks.clear();this.tracks.clear();this.settings={auto:false,limit:1024**3};this.available=false;this.state={...this.state,checking:false};this.emit();localStorage.removeItem('afterglow-player');}
}
export const downloads=new Downloads();
