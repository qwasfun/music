import {PLAY_COUNT_BATCH_SIZE,type PlayCountSummary,type PlayCountSyncResult} from '../shared/contracts';
import {api,RequestError} from './api';
import {notice} from './events';
import {dbPromise} from './storage';

interface DeviceCounts {
  deviceId: string;
  localCounts: Record<string,number>;
  cloud: PlayCountSummary;
}
interface Session {
  userId: string;
  key: string;
  ready: Promise<string|undefined>;
  inFlight?: Promise<void>;
  request?: AbortController;
  timer?: number;
  retryDelay: number;
  paused: boolean;
}
interface CountView {
  totalCount: number;
  trackCounts: Readonly<Record<string,number>>;
}
const emptyView:CountView={totalCount:0,trackCounts:{}};

function pendingCounts(state:DeviceCounts){
  return Object.entries(state.localCounts)
    .filter(([trackId,count])=>count>(state.cloud.deviceCounts[trackId]??0))
    .map(([trackId,count])=>({trackId,count}));
}

class PlayCounts {
  private session?:Session;
  private view=emptyView;
  private storageWarning=false;
  private listeners=new Set<()=>void>();
  private channel=typeof BroadcastChannel==='undefined'?undefined:new BroadcastChannel('afterglow-play-counts');

  constructor(){
    this.channel?.addEventListener('message',event=>{
      const session=this.session;
      if(!session||event.data?.userId!==session.userId)return;
      if(event.data.type==='clear')this.clear(false);
      if(event.data.type==='changed')void this.read(session).then(state=>{
        if(state)this.publish(session,state);
      }).catch(()=>{});
    });
  }

  subscribe=(fn:()=>void)=>{this.listeners.add(fn);return()=>{this.listeners.delete(fn);};};
  snapshot=()=>this.view;

  setUser(userId:string){
    if(this.session?.userId===userId)return;
    this.clear(false);
    const session:Session={userId,key:`play-counts:${userId}`,ready:Promise.resolve(undefined),retryDelay:5000,paused:false};
    this.session=session;
    session.ready=this.initialize(session).catch(()=>undefined);
  }

  private async initialize(session:Session){
    const db=await dbPromise;
    if(this.session!==session)return;
    const transaction=db.transaction('kv','readwrite');
    let state=await transaction.store.get(session.key) as DeviceCounts|undefined;
    if(!state&&this.session===session){
      state={deviceId:crypto.randomUUID(),localCounts:{},cloud:{...emptyView,deviceCounts:{}}};
      await transaction.store.put(state,session.key);
    }
    await transaction.done;
    if(state)this.publish(session,state);
    return state?.deviceId;
  }

  private async read(session:Session){
    const deviceId=await session.ready;
    if(!deviceId||this.session!==session)return;
    const state=await (await dbPromise).get('kv',session.key) as DeviceCounts|undefined;
    if(state?.deviceId===deviceId&&this.session===session)return state;
  }

  private async update(session:Session,deviceId:string,change:(state:DeviceCounts)=>void){
    const db=await dbPromise;
    if(this.session!==session)return;
    const transaction=db.transaction('kv','readwrite');
    const state=await transaction.store.get(session.key) as DeviceCounts|undefined;
    if(state?.deviceId===deviceId&&this.session===session){
      change(state);
      await transaction.store.put(state,session.key);
    }
    await transaction.done;
    if(state?.deviceId!==deviceId||this.session!==session)return;
    this.publish(session,state);
    this.channel?.postMessage({type:'changed',userId:session.userId});
    return state;
  }

  private publish(session:Session,state:DeviceCounts){
    if(this.session!==session)return;
    const trackCounts={...state.cloud.trackCounts};
    let totalCount=state.cloud.totalCount;
    for(const {trackId,count} of pendingCounts(state)){
      const increment=count-(state.cloud.deviceCounts[trackId]??0);
      trackCounts[trackId]=(trackCounts[trackId]??0)+increment;
      totalCount+=increment;
    }
    this.view={totalCount,trackCounts};
    for(const listener of this.listeners)listener();
  }

  async record(trackId:string){
    const session=this.session;
    if(!session)return;
    try{
      const deviceId=await session.ready;
      if(this.session!==session)return;
      if(!deviceId)throw new Error('Playback count storage unavailable');
      const state=await this.update(session,deviceId,state=>{
        state.localCounts[trackId]=(state.localCounts[trackId]??0)+1;
      });
      if(state)this.schedule(session,1500);
    }catch{
      if(this.session===session&&!this.storageWarning){
        this.storageWarning=true;
        notice('本机存储不可用，本次播放未能计入统计。请检查浏览器存储权限和可用空间。');
      }
    }
  }

  private schedule(session:Session,delay:number){
    if(this.session!==session||session.paused||!navigator.onLine||session.timer!==undefined)return;
    session.timer=window.setTimeout(()=>{
      session.timer=undefined;
      void this.flush(session);
    },delay);
  }

  sync(){
    const session=this.session;
    if(!session)return Promise.resolve();
    session.paused=false;
    return this.flush(session);
  }

  private flush(session:Session){
    if(this.session!==session||session.paused||!navigator.onLine)return Promise.resolve();
    if(session.inFlight)return session.inFlight;
    window.clearTimeout(session.timer);
    session.timer=undefined;
    session.inFlight=this.syncBatches(session).catch(error=>{
      if(this.session!==session)return;
      if(error instanceof RequestError&&[401,403,409].includes(error.status)){
        session.paused=true;
      }else if(error instanceof RequestError&&(error.status===0||error.status===429||error.status>=500)){
        this.schedule(session,session.retryDelay);
        session.retryDelay=Math.min(60000,session.retryDelay*2);
      }else if(error instanceof RequestError&&error.status===422){
        session.paused=true;
        notice(error.message);
      }
    }).finally(()=>{session.inFlight=undefined;});
    return session.inFlight;
  }

  private async syncBatches(session:Session){
    let state=await this.read(session);
    while(state&&this.session===session&&navigator.onLine){
      const counts=pendingCounts(state).slice(0,PLAY_COUNT_BATCH_SIZE);
      const request=new AbortController();
      session.request=request;
      const timeout=window.setTimeout(()=>request.abort(),10000);
      let response:PlayCountSyncResult;
      try{
        response=await api<PlayCountSyncResult>('/play-counts/sync',{
          method:'POST',signal:request.signal,body:JSON.stringify({userId:session.userId,deviceId:state.deviceId,counts}),
        });
      }finally{
        window.clearTimeout(timeout);
        session.request=undefined;
      }
      state=await this.update(session,state.deviceId,current=>{
        for(const id of response.ignoredTrackIds)delete current.localCounts[id];
        // Other tabs may have already saved a newer response.
        current.cloud.totalCount=Math.max(current.cloud.totalCount,response.totalCount);
        for(const [id,count] of Object.entries(response.trackCounts)){
          current.cloud.trackCounts[id]=Math.max(current.cloud.trackCounts[id]??0,count);
        }
        for(const [id,count] of Object.entries(response.deviceCounts)){
          current.cloud.deviceCounts[id]=Math.max(current.cloud.deviceCounts[id]??0,count);
        }
      });
      session.retryDelay=5000;
      if(!state||!pendingCounts(state).length)break;
    }
  }

  async finish(){
    if(navigator.onLine){
      let timer:number|undefined;
      try{
        await Promise.race([this.sync(),new Promise<void>(resolve=>{timer=window.setTimeout(resolve,3000);})]);
      }finally{window.clearTimeout(timer);}
    }
    this.clear();
  }

  clear(broadcast=true){
    const session=this.session;
    if(!session)return;
    this.session=undefined;
    window.clearTimeout(session.timer);
    session.request?.abort();
    if(broadcast)this.channel?.postMessage({type:'clear',userId:session.userId});
    this.storageWarning=false;
    this.view=emptyView;
    for(const listener of this.listeners)listener();
  }
}

export const playCounts=new PlayCounts();
