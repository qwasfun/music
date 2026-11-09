import type {Library,Track} from '../shared/contracts';
import {audioUrl,coverUrl} from '../shared/contracts';
import {downloads} from './cache';
import {notice} from './events';
interface PlayerState {id:string|null;queue:string[];playing:boolean;time:number;duration:number;volume:number;shuffle:boolean;repeat:boolean}
class Player {
  audio=new Audio();private tracks=new Map<string,Track>();private listeners=new Set<()=>void>();private savedAt=0;private restoring=0;
  private state:PlayerState={id:null,queue:[],playing:false,time:0,duration:0,volume:1,shuffle:false,repeat:false};
  constructor(){this.audio.crossOrigin='anonymous';this.audio.preload='metadata';try{const v=JSON.parse(localStorage.getItem('afterglow-player')||'null');if(v){this.state={...this.state,...v,playing:false};this.audio.volume=this.state.volume;this.restoring=v.time||0;}}catch{}
    this.audio.addEventListener('playing',()=>{this.update({playing:true});if(this.state.id)void downloads.touch(this.state.id);});
    this.audio.addEventListener('pause',()=>this.update({playing:false}));
    this.audio.addEventListener('timeupdate',()=>this.update({time:this.audio.currentTime}));
    this.audio.addEventListener('loadedmetadata',()=>{this.update({duration:this.audio.duration||this.current()?.duration||0});if(this.restoring){this.audio.currentTime=Math.min(this.restoring,this.audio.duration||0);this.restoring=0;}});
    this.audio.addEventListener('ended',()=>{if(this.state.repeat){this.audio.currentTime=0;void this.play();}else this.next();});
    this.audio.addEventListener('error',()=>{this.update({playing:false});notice(navigator.onLine?'歌曲暂时无法播放：请检查网络、重新登录曲库，或确认音频格式有效':'这首歌尚未完整缓存，请联网后下载；可在「离线下载」中播放已保存的歌曲');});
    if('mediaSession'in navigator){for(const [name,fn] of Object.entries({play:()=>this.play(),pause:()=>this.audio.pause(),previoustrack:()=>this.previous(),nexttrack:()=>this.next(),seekto:(d:MediaSessionActionDetails)=>this.seek(d.seekTime||0)})){try{navigator.mediaSession.setActionHandler(name as MediaSessionAction,fn);}catch{}}}
  }
  subscribe=(fn:()=>void)=>{this.listeners.add(fn);return()=>this.listeners.delete(fn);};snapshot=()=>this.state;current=()=>this.state.id?this.tracks.get(this.state.id):undefined;
  private update(p:Partial<PlayerState>){this.state={...this.state,...p};for(const l of this.listeners)l();if('id'in p||'queue'in p||'volume'in p||'shuffle'in p||'repeat'in p||Date.now()-this.savedAt>1500){this.savedAt=Date.now();try{localStorage.setItem('afterglow-player',JSON.stringify({...this.state,playing:false}));}catch{}}if('mediaSession'in navigator){navigator.mediaSession.playbackState=this.state.playing?'playing':'paused';try{if(this.state.duration>0)navigator.mediaSession.setPositionState({duration:this.state.duration,position:Math.min(this.state.time,this.state.duration),playbackRate:1});}catch{}}}
  setLibrary(l:Library){this.tracks=new Map(l.tracks.map(t=>[t.id,t]));const queue=this.state.queue.filter(id=>this.tracks.has(id));if(this.state.id&&!this.tracks.has(this.state.id)){this.audio.pause();this.audio.removeAttribute('src');this.update({id:null,time:0,duration:0,queue});}else{this.update({queue});if(this.state.id&&!this.audio.getAttribute('src'))this.load(this.state.id,false);}}
  private load(id:string,play=true){const t=this.tracks.get(id);if(!t)return;if(!navigator.onLine&&!downloads.entries.has(id)){notice('歌曲尚未缓存：请联网下载后再播放');return;}this.restoring=play?0:this.restoring;this.audio.src=audioUrl(id);this.update({id,time:play?0:this.restoring,duration:t.duration});if('mediaSession'in navigator)navigator.mediaSession.metadata=new MediaMetadata({title:t.title,artist:t.artist||'未知歌手',album:t.album||'未知专辑',artwork:t.cover?[{src:new URL(coverUrl(id),location.origin).href}]:[{src:new URL('/icon-512.png',location.origin).href,sizes:'512x512',type:'image/png'}]});if(play)void this.play();}
  playList(ids:string[],start=0){if(!ids.length){notice('这里还没有歌曲，先上传一些喜欢的音乐吧');return;}this.update({queue:ids});this.load(ids[start]||ids[0]);}
  async play(){if(!this.state.id)return;try{await this.audio.play();}catch(e){if((e as Error).name==='NotAllowedError')notice('请点击播放按钮开始播放');else if((e as Error).name!=='AbortError')notice('播放未开始：请检查网络或重新登录曲库');}}
  toggle(){if(!this.state.id)return;if(this.audio.paused)void this.play();else this.audio.pause();}
  next(){const eligible=this.state.queue.filter(id=>this.tracks.has(id)&&(navigator.onLine||downloads.entries.has(id)));if(!eligible.length){this.audio.pause();notice('没有可播放的缓存歌曲，请联网后重试');return;}let index=eligible.indexOf(this.state.id||'');if(this.state.shuffle&&eligible.length>1){const others=eligible.filter(id=>id!==this.state.id);this.load(others[Math.floor(Math.random()*others.length)]);}else this.load(eligible[(index+1)%eligible.length]);}
  previous(){if(this.audio.currentTime>3){this.seek(0);return;}const q=this.state.queue.filter(id=>navigator.onLine||downloads.entries.has(id));if(q.length)this.load(q[(q.indexOf(this.state.id||'')-1+q.length)%q.length]);}
  seek(time:number){if(this.state.id&&Number.isFinite(time)){this.restoring=0;this.audio.currentTime=Math.max(0,Math.min(time,this.audio.duration||this.state.duration));this.update({time:this.audio.currentTime});}}
  volume(volume:number){this.audio.volume=volume;this.update({volume});}
  shuffle(){this.update({shuffle:!this.state.shuffle});} repeat(){this.update({repeat:!this.state.repeat});}
  add(id:string){this.update({queue:[...this.state.queue.filter(x=>x!==id),id]});notice('已加入播放队列');}
  clear(){this.audio.pause();this.audio.removeAttribute('src');this.state={id:null,queue:[],playing:false,time:0,duration:0,volume:1,shuffle:false,repeat:false};this.update({});if('mediaSession'in navigator){navigator.mediaSession.metadata=null;navigator.mediaSession.playbackState='none';try{navigator.mediaSession.setPositionState();}catch{}}localStorage.removeItem('afterglow-player');}
}
export const player=new Player();
