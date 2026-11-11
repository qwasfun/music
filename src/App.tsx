import {useCallback,useEffect,useMemo,useRef,useState,useSyncExternalStore,type ReactNode} from 'react';
import {ArrowUpRight,AudioLines,ChartNoAxesColumnIncreasing,Check,ChevronDown,ChevronLeft,Cloud,CloudDownload,Download,FolderHeart,Grid2X2,Headphones,Heart,ListMusic,LoaderCircle,LogIn,LogOut,Music2,Play,Plus,RefreshCw,Search,Settings2,ShieldCheck,SlidersHorizontal,Trash2,WifiOff,X} from 'lucide-react';
import {metadataSchema,playlistSchema,validationError,formatBytes,formatTime,coverUrl,type Library,type Playlist,type Track} from '../shared/contracts';
import {api,RequestError} from './api';
import {downloads} from './cache';
import {player} from './player';
import {playCounts} from './play-counts';
import {readLocal,writeLocal} from './storage';
import {notice} from './events';
import {UploadQueue} from './upload-queue';
import {UploadPanel} from './UploadPanel';
import {DownloadTasks} from './DownloadTasks';
import {PlayerBar,FullPlayer} from './PlayerViews';
import {TrackList,type TrackAction} from './TrackList';
import {PlayStatistics} from './PlayStatistics';
import {Cover} from './Cover';
import {registerSW} from 'virtual:pwa-register';

function Modal({title,children,onClose,wide=false}:{title:string;children:ReactNode;onClose:()=>void;wide?:boolean}){const ref=useRef<HTMLDivElement>(null);useEffect(()=>{const previous=document.activeElement as HTMLElement;ref.current?.querySelector<HTMLElement>('input,button')?.focus();const handle=(e:KeyboardEvent)=>{if(e.key==='Escape')onClose();if(e.key==='Tab'){const nodes=ref.current?.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),a[href],select');if(!nodes?.length)return;const first=nodes[0],last=nodes[nodes.length-1];if(e.shiftKey&&document.activeElement===first){e.preventDefault();last.focus();}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first.focus();}}};document.addEventListener('keydown',handle);return()=>{document.removeEventListener('keydown',handle);previous?.focus();};},[]);return <div className="modal-backdrop" onClick={e=>{if(e.target===e.currentTarget)onClose();}}><div ref={ref} role="dialog" aria-modal="true" aria-label={title} className={`modal ${wide?'modal-wide':''}`}><div className="modal-heading"><h2>{title}</h2><button className="icon-button" aria-label="关闭弹窗" onClick={onClose}><X size={20}/></button></div>{children}</div></div>;}
type Dialog={type:'upload'|'playlist'|'edit'|'add'|'confirm';track?:Track;playlist?:Playlist;title?:string;action?:()=>Promise<void>};
export function App(){
  const[library,setLibrary]=useState<Library|null>(null),[loading,setLoading]=useState(true),[syncing,setSyncing]=useState(false),[expired,setExpired]=useState(false),[online,setOnline]=useState(navigator.onLine),[view,setView]=useState('library'),[query,setQuery]=useState(''),[dialog,setDialog]=useState<Dialog|null>(null),[formError,setFormError]=useState(''),[saving,setSaving]=useState(false),[toast,setToast]=useState(''),[fullPlayer,setFullPlayer]=useState(false),[sort,setSort]=useState('recent'),[updateReady,setUpdateReady]=useState(false),[installEvent,setInstallEvent]=useState<any>(null);
  const cache=useSyncExternalStore(downloads.subscribe,downloads.overviewSnapshot),playback=useSyncExternalStore(player.subscribe,player.viewSnapshot);
  const counts=useSyncExternalStore(playCounts.subscribe,playCounts.snapshot);
  const libraryRef=useRef<Library|null>(null),syncPromise=useRef<Promise<void>|null>(null),syncAbort=useRef<AbortController|null>(null),loggingOut=useRef(false),searchRef=useRef<HTMLInputElement>(null),updateSW=useRef<((reload?:boolean)=>Promise<void>)|null>(null);
  const uploadRevision=useRef(0),recentUploads=useRef(new Map<string,{track:Track;revision:number}>());
  const uploadCallbacks=useRef({track:(_track:Track)=>{},sync:async(_final:boolean)=>{}});
  const [uploads]=useState(()=>new UploadQueue(track=>uploadCallbacks.current.track(track),final=>uploadCallbacks.current.sync(final)));
  const pending=useSyncExternalStore(uploads.subscribe,uploads.pendingSnapshot);
  const sync=useCallback(async(afterCurrent=false)=>{
    if(!navigator.onLine||loggingOut.current)return;
    while(syncPromise.current){await syncPromise.current;if(!afterCurrent)return;}
    if(!navigator.onLine||loggingOut.current)return;
    const revision=uploadRevision.current;
    const controller=new AbortController();syncAbort.current=controller;setSyncing(true);
    const request=(async()=>{
      try{
        const data=await api<Library>('/library',{signal:controller.signal});
        if(controller.signal.aborted||loggingOut.current)return;
        if(libraryRef.current&&libraryRef.current.user.id!==data.user.id){
          playCounts.clear();player.clear();recentUploads.current.clear();await downloads.logout();await downloads.init();
        }
        if(loggingOut.current)return;
        // Keep uploads completed after this request started: its snapshot may be older.
        const changed=[...recentUploads.current.values()].filter(item=>item.revision>revision);
        const changedIds=new Set(changed.map(item=>item.track.id));
        data.tracks=[...changed.map(item=>item.track),...data.tracks.filter(track=>!changedIds.has(track.id))];
        for(const [id,item] of recentUploads.current)if(item.revision<=revision)recentUploads.current.delete(id);
        playCounts.setUser(data.user.id);
        libraryRef.current=data;setLibrary(data);player.setLibrary(data);downloads.setLibrary(data);setExpired(false);
        try{await writeLocal('library',data);}catch{notice('本机存储不可用，云端仍可播放；离线资料暂时无法保存');}
      }catch(e){
        if(!controller.signal.aborted){if(e instanceof RequestError&&e.status===401)setExpired(true);else notice((e as Error).message);}
      }finally{setSyncing(false);}
    })();
    syncPromise.current=request;
    try{await request;}finally{syncPromise.current=null;}

  },[]);
  const refresh=useCallback(async()=>{
    await sync();
    if(!loggingOut.current)void playCounts.sync();
  },[sync]);
  useEffect(()=>{
    const onNotice=(e:Event)=>setToast((e as CustomEvent<string>).detail);
    const net=()=>{setOnline(navigator.onLine);if(navigator.onLine)void refresh();};
    const focus=()=>{if(document.visibilityState==='visible')void refresh();};
    const key=(e:KeyboardEvent)=>{if(e.key==='/'&&!['INPUT','TEXTAREA','SELECT'].includes((e.target as HTMLElement).tagName)){e.preventDefault();searchRef.current?.focus();}if(e.code==='Space'&&!['INPUT','TEXTAREA','SELECT','BUTTON','SUMMARY'].includes((e.target as HTMLElement).tagName)&&!document.querySelector('[role=dialog]')){e.preventDefault();player.toggle();}};
    const install=(e:Event)=>{e.preventDefault();setInstallEvent(e);};
    window.addEventListener('music:notice',onNotice);window.addEventListener('online',net);window.addEventListener('offline',net);window.addEventListener('focus',focus);document.addEventListener('visibilitychange',focus);window.addEventListener('keydown',key);window.addEventListener('beforeinstallprompt',install);
    const stopCounting=player.subscribeToCountedPlays(id=>void playCounts.record(id));
    void downloads.init();void(async()=>{try{const cached=await readLocal<Library>('library');if(cached&&!loggingOut.current&&!libraryRef.current){playCounts.setUser(cached.user.id);libraryRef.current=cached;setLibrary(cached);player.setLibrary(cached);downloads.setLibrary(cached);setLoading(false);}}catch{notice('本机存储不可用，离线资料无法保存');}await refresh();if(!loggingOut.current)setLoading(false);})();
    updateSW.current=registerSW({onNeedRefresh:()=>setUpdateReady(true),onRegisterError:()=>notice('离线应用安装未完成，请刷新页面后重试')});
    return()=>{stopCounting();window.removeEventListener('music:notice',onNotice);window.removeEventListener('online',net);window.removeEventListener('offline',net);window.removeEventListener('focus',focus);document.removeEventListener('visibilitychange',focus);window.removeEventListener('keydown',key);window.removeEventListener('beforeinstallprompt',install);};
  },[refresh]);
  useEffect(()=>{if(!toast)return;const timer=setTimeout(()=>setToast(''),6500);return()=>clearTimeout(timer);},[toast]);
  useEffect(()=>{setFormError('');},[dialog]);
  const tracks=useMemo(()=>library?.tracks||[],[library?.tracks]);
  const tracksById=useMemo(()=>new Map(tracks.map(track=>[track.id,track])),[tracks]);
  const current=playback.id?tracksById.get(playback.id):undefined,selectedPlaylist=library?.playlists.find(p=>view===`playlist:${p.id}`);
  const cachedIds=useMemo(()=>new Set(cache.entries.map(entry=>entry.id)),[cache.entries]);
  const favorites=useMemo(()=>new Set(library?.favorites||[]),[library?.favorites]);
  const used=useMemo(()=>cache.entries.reduce((sum,entry)=>sum+entry.size,0),[cache.entries]);
  const sortCounts=sort==='plays'?counts.trackCounts:undefined;
  const shown=useMemo(()=>{
    const normalized=query.toLowerCase();
    const ids=view==='queue'?playback.queue:selectedPlaylist?.trackIds;
    let result=query?tracks.filter(track=>`${track.title} ${track.artist} ${track.album}`.toLowerCase().includes(normalized)):view==='favorites'?tracks.filter(track=>favorites.has(track.id)):view==='offline'?tracks.filter(track=>cachedIds.has(track.id)):ids?ids.map(id=>tracksById.get(id)).filter((track):track is Track=>!!track):tracks;
    if(sort==='title'&&!selectedPlaylist&&view!=='queue')result=[...result].sort((a,b)=>a.title.localeCompare(b.title,'zh-CN'));
    if(sortCounts&&!selectedPlaylist&&view!=='queue')result=[...result].sort((a,b)=>(sortCounts[b.id]??0)-(sortCounts[a.id]??0));
    return result;
  },[query,tracks,view,playback.queue,selectedPlaylist,tracksById,favorites,cachedIds,sort,sortCounts]);
  uploadCallbacks.current={sync:final=>sync(final),track:track=>{
    if(loggingOut.current||!libraryRef.current)return;
    recentUploads.current.set(track.id,{track,revision:++uploadRevision.current});
    const data={...libraryRef.current,tracks:[track,...libraryRef.current.tracks.filter(item=>item.id!==track.id)]};
    libraryRef.current=data;setLibrary(data);player.setLibrary(data);downloads.setLibrary(data);void writeLocal('library',data).catch(()=>notice('离线资料暂时无法保存，请检查本机存储'));
  }};
  const heading=query?'搜索结果':view==='favorites'?'我喜欢的音乐':view==='offline'?'离线下载':view==='queue'?'播放队列':view==='playlists'?'我的歌单':view==='settings'?'偏好设置':selectedPlaylist?.name||'我的曲库';
  function navigate(next:string){setView(next);setQuery('');window.scrollTo({top:0,behavior:'smooth'});}
  function canEdit(){if(!online){notice('当前处于离线状态，请联网后修改曲库、歌单或收藏');return false;}if(expired||!library){notice('请先登录你的私人曲库');return false;}return true;}
  async function mutate(action:()=>Promise<unknown>){if(!canEdit())throw new RequestError(navigator.onLine?'请登录后再修改曲库':'当前处于离线状态，请联网后修改',navigator.onLine?401:0);try{await action();await sync();}catch(e){notice((e as Error).message);if(e instanceof RequestError&&e.status===401)setExpired(true);if(e instanceof RequestError&&e.status===409)await sync();throw e;}}
  async function favorite(track:Track){try{await mutate(()=>api(`/favorites/${track.id}`,{method:favorites.has(track.id)?'DELETE':'PUT'}));}catch{}}
  async function updatePlaylist(p:Playlist,ids:string[],name=p.name){await mutate(()=>api(`/playlists/${p.id}`,{method:'PUT',body:JSON.stringify({name,version:p.version,trackIds:ids})}));}
  async function logout(){loggingOut.current=true;syncAbort.current?.abort();await syncPromise.current;uploads.clear();recentUploads.current.clear();player.clear();await playCounts.finish();await downloads.logout();libraryRef.current=null;setLibrary(null);setExpired(true);if(navigator.onLine)location.assign('/cdn-cgi/access/logout');else{loggingOut.current=false;notice('已退出并清除本机资料；联网后可重新登录');}}
  function openUpload(){if(!canEdit())return;setDialog({type:'upload'});}
  async function submitForm(e:React.FormEvent<HTMLFormElement>){e.preventDefault();setFormError('');if(!canEdit())return;const fd=new FormData(e.currentTarget);setSaving(true);try{if(dialog?.type==='playlist'){const d=playlistSchema.safeParse({name:fd.get('name')});if(!d.success)throw new Error(validationError(d.error).error.message);if(dialog.playlist)await updatePlaylist(dialog.playlist,dialog.playlist.trackIds,d.data.name);else{const p=await api<Playlist>('/playlists',{method:'POST',body:JSON.stringify(d.data)});await sync();navigate(`playlist:${p.id}`);}}else if(dialog?.type==='edit'&&dialog.track){const d=metadataSchema.safeParse({title:fd.get('title'),artist:fd.get('artist'),album:fd.get('album')});if(!d.success)throw new Error(validationError(d.error).error.message);await mutate(()=>api(`/tracks/${dialog.track!.id}`,{method:'PATCH',body:JSON.stringify(d.data)}));}setDialog(null);notice('已保存');}catch(e){setFormError((e as Error).message);}finally{setSaving(false);}}
  const nav=[{id:'library',label:'我的曲库',icon:Grid2X2},{id:'favorites',label:'我喜欢的',icon:Heart},{id:'offline',label:'离线下载',icon:Download},{id:'statistics',label:'播放统计',icon:ChartNoAxesColumnIncreasing}];
  const actionRef=useRef<(action:TrackAction,track:Track,index:number)=>void>(()=>{});
  actionRef.current=(action,track,index)=>{
    if(action==='favorite'){void favorite(track);return;}
    if(!canEdit())return;
    if(action==='add'||action==='edit'){setDialog({type:action,track});return;}
    if(action==='delete'){setDialog({type:'confirm',title:`从云端删除「${track.title}」？`,action:async()=>{await mutate(()=>api(`/tracks/${track.id}`,{method:'DELETE'}));notice('已从云端曲库删除');}});return;}
    if(!selectedPlaylist)return;
    const ids=[...selectedPlaylist.trackIds];index=ids.indexOf(track.id);if(index<0)return;
    if(action==='remove')ids.splice(index,1);
    else {const next=index+(action==='up'?-1:1);if(next<0||next>=ids.length)return;[ids[index],ids[next]]=[ids[next],ids[index]];}
    void updatePlaylist(selectedPlaylist,ids).catch(()=>{});
  };
  const onTrackAction=useCallback((action:TrackAction,track:Track,index:number)=>actionRef.current(action,track,index),[]);
  function downloadAll(){for(const t of shown)void downloads.enqueue(t.id,true);if(shown.length)notice('已加入下载队列，保持应用打开即可下载');}
  return <div className={`app-shell ${view==='playlists'?'show-playlists':''}`}>
    <aside className="sidebar">
      <a href="/" className="brand" aria-label="余音首页"><span className="brand-mark"><AudioLines size={26}/></span><span>余音<small>AFTERGLOW</small></span></a>
      <div className="nav-label">你的音乐空间</div><nav className="main-nav">{nav.map(n=><button key={n.id} className={view===n.id&&!query?'active':''} onClick={()=>navigate(n.id)}><n.icon size={19}/><span>{n.label}</span>{n.id==='favorites'&&<small>{favorites.size}</small>}{n.id==='offline'&&cache.tasks.some(t=>t.status==='downloading')&&<span className="mini-dot"/>}</button>)}</nav>
      <div className="playlist-label"><span className="nav-label">我的歌单</span><button className="icon-button" title="新建歌单" aria-label="新建歌单" onClick={()=>{if(canEdit())setDialog({type:'playlist'});}}><Plus size={17}/></button></div>
      <nav className="playlist-nav">{library?.playlists.length?library.playlists.map(p=><button key={p.id} className={selectedPlaylist?.id===p.id?'active':''} onClick={()=>navigate(`playlist:${p.id}`)}><span className="playlist-symbol"><ListMusic size={17}/></span><span>{p.name}<small>{p.trackIds.length} 首歌曲</small></span></button>):<button className="create-playlist" onClick={()=>{if(canEdit())setDialog({type:'playlist'});}}><span className="playlist-symbol dashed"><Plus size={17}/></span><span>创建第一张歌单<small>把喜欢的声音放在一起</small></span></button>}</nav>
      <div className="sidebar-bottom"><div className="offline-card"><span className="offline-card-icon"><Headphones size={20}/></span><strong>好音乐，随时在</strong><p>下载喜欢的歌曲<br/>没网络，也有好心情。</p><button onClick={()=>navigate('offline')}>管理离线音乐 <ArrowUpRight size={15}/></button></div><button className={view==='settings'?'settings-link active':'settings-link'} onClick={()=>navigate('settings')}><Settings2 size={18}/>偏好设置</button><div className="profile"><span className="avatar">余</span><div><strong>我的私人空间</strong><small><span className={`status-dot ${online?'':'is-offline'}`}/>{online?(expired?'等待登录':'云端曲库'): '离线模式'}</small></div><ShieldCheck size={16}/></div></div>
    </aside>
    <main className="main">
      <header className="topbar"><div className="mobile-brand"><AudioLines size={24}/>余音</div><div className="history-buttons"><button className="icon-button" aria-label="返回曲库" onClick={()=>navigate('library')}><ChevronLeft size={20}/></button><span>音乐，随你而行</span></div><div className="search-box"><Search size={18}/><input ref={searchRef} aria-label="搜索歌曲、歌手或专辑" placeholder="搜索歌曲、歌手或专辑" value={query} onChange={e=>setQuery(e.target.value)}/>{query?<button aria-label="清空搜索" onClick={()=>setQuery('')}><X size={15}/></button>:<kbd>/</kbd>}</div><div className="topbar-actions"><button className="sync-status" onClick={()=>void refresh()} disabled={syncing||!online} title="刷新云端曲库" aria-label="刷新云端曲库"><RefreshCw size={14} className={syncing?'spin':''}/><span>{syncing?'同步中':online?'云端同步':'离线模式'}</span></button><button className="button primary upload-top" onClick={openUpload}><Plus size={17}/><span>{pending?`上传中 ${pending}`:'上传音乐'}</span></button></div></header>
      {updateReady&&<div className="banner"><RefreshCw size={16}/><span>新版本已准备好，更新会中断当前播放。</span><button onClick={()=>void updateSW.current?.(true)}>立即更新</button><button className="icon-button" aria-label="稍后更新" onClick={()=>setUpdateReady(false)}><X size={15}/></button></div>}
      {(!online||expired)&&<div className={`banner ${!online?'offline-banner':''}`}>{!online?<WifiOff size={16}/>:<LogIn size={16}/>}<span>{!online?'当前离线，已下载的音乐依然可以播放。':'登录你的私人曲库，让喜欢的音乐在设备间同步。'}</span>{online&&<a href="/api/auth/start">登录曲库 <ArrowUpRight size={14}/></a>}</div>}
      <div className="content">{cache.checking&&<p className="cache-checking" role="status">正在检查本机下载，歌曲资料已可浏览。</p>}
      {view==='library'&&!query&&<section className="hero"><div className="hero-grain"/><div className="hero-copy"><div className="eyebrow"><span/> A SPACE FOR YOUR SOUND</div><h1>让喜欢的声音，<br/>一直在身边<span>。</span></h1><p>收藏每一次心动，让旋律陪你走过日常。</p><div className="hero-actions"><button className="button primary" onClick={()=>tracks.length?player.playList(tracks.map(t=>t.id)):openUpload()}><Play size={16} fill="currentColor"/>{tracks.length?'播放我的音乐':'开启我的音乐空间'}</button><span className="hero-note"><Cloud size={15}/>云端收藏 · 随时离线</span></div></div><div className="record-scene" aria-hidden="true"><div className="record-shadow"/><div className="record-sleeve"><div className="sleeve-top">AFTERGLOW <span>VOL. 01</span></div><div className="sleeve-art"><div className="art-sun"/><div className="art-wave one"/><div className="art-wave two"/><div className="art-wave three"/></div><div className="sleeve-bottom"><span>余音</span><small>GOOD SOUNDS.<br/>BETTER DAYS.</small></div></div><div className="vinyl"><div className="vinyl-label"><AudioLines size={28}/><small>SIDE A</small><i/></div></div><div className="record-caption"><span className="tiny-star">✦</span> YOUR MUSIC, YOUR MOMENT.</div></div></section>}
      {view==='statistics'&&!query?
        <PlayStatistics totalCount={counts.totalCount} ready={!!library} loading={loading}
          tracks={tracks} playCounts={counts.trackCounts} currentId={playback.id} playing={playback.playing}
          favorites={favorites} cachedIds={cachedIds} onAction={onTrackAction}/>:
      view==='settings'&&!query?<section className="settings-page"><div className="section-kicker">MAKE IT YOURS</div><h1>偏好设置</h1><p className="muted">让你的音乐空间，按喜欢的方式运转。</p><div className="settings-panel"><h3><Download size={18}/>离线与存储</h3><div className="setting-row"><div><strong>播放时自动缓存</strong><p>开启后会下载正在播放的完整歌曲，可能消耗移动数据。</p></div><button role="switch" aria-checked={cache.settings.auto} aria-label="播放时自动缓存" className={`switch ${cache.settings.auto?'on':''}`} disabled={!cache.available} onClick={()=>void downloads.setSettings({...cache.settings,auto:!cache.settings.auto})}><span/></button></div><div className="setting-row"><div><strong>音频缓存容量</strong><p>手动下载优先保留，自动缓存会按最近使用时间清理。</p></div><select aria-label="音频缓存容量" value={cache.settings.limit} onChange={e=>void downloads.setSettings({...cache.settings,limit:Number(e.target.value)})}>{[256*1024**2,512*1024**2,1024**3,2*1024**3,5*1024**3].map(n=><option key={n} value={n}>{formatBytes(n)}</option>)}</select></div><div className="storage-meter"><div><span>已用 {formatBytes(used)}</span><span>{formatBytes(cache.settings.limit)}</span></div><div className="meter"><i style={{width:`${Math.min(100,used/cache.settings.limit*100)}%`}}/></div><small>{cache.entries.filter(e=>e.pinned).length} 首手动下载 · {cache.entries.filter(e=>!e.pinned).length} 首自动缓存</small></div><div className="setting-row"><div><strong>持久存储</strong><p>{cache.persistent?'浏览器已授予许可。清理网站数据仍会删除下载。':'申请减少系统自动清理缓存；浏览器可能不授予许可。'}</p></div><button className="button secondary" onClick={()=>void downloads.requestPersistence()} disabled={cache.persistent||!cache.available}>{cache.persistent?'已获得许可':'申请许可'}</button></div><div className="settings-buttons"><button className="button secondary" onClick={()=>void downloads.clear(false)}>清理自动缓存</button><button className="button danger-ghost" onClick={()=>setDialog({type:'confirm',title:'清空本机下载？',action:async()=>{await downloads.clear(true);notice('已清空本机下载，云端歌曲仍保留');}})}>清空本机下载</button></div></div><div className="settings-panel"><h3><Headphones size={18}/>随时听见好音乐</h3><div className="setting-row"><div><strong>安装到主屏幕</strong><p>iPhone：在 Safari 中打开，轻点分享，再选择「添加到主屏幕」。<br/>下载时请保持应用在前台，重新打开后可重试中断任务。</p></div>{installEvent&&<button className="button secondary" onClick={async()=>{await installEvent.prompt();setInstallEvent(null);}}>安装应用</button>}</div></div><div className="settings-panel"><h3><ShieldCheck size={18}/>私人曲库</h3><div className="setting-row"><div><strong>仅允许你的邮箱登录</strong><p>退出登录会清除本机曲库资料和所有离线音频。</p></div><button className="button danger-ghost" onClick={()=>setDialog({type:'confirm',title:'退出并清除本机资料？',action:logout})}><LogOut size={15}/>退出登录</button></div></div></section>:<>
      {view==='playlists'&&!query&&<section className="mobile-playlists-page"><div className="section-kicker">YOUR COLLECTIONS</div><div className="section-heading"><h2>我的歌单<span>{library?.playlists.length||0} 张歌单</span></h2><button className="button secondary compact" onClick={()=>{if(canEdit())setDialog({type:'playlist'});}}><Plus size={15}/>新建歌单</button></div><div className="playlist-grid">{library?.playlists.map(p=><button key={p.id} onClick={()=>navigate(`playlist:${p.id}`)}><Cover track={tracksById.get(p.trackIds[0])} large/><strong>{p.name}</strong><small>{p.trackIds.length} 首歌曲</small></button>)}{!library?.playlists.length&&<div className="empty-state"><FolderHeart size={30}/><h3>把喜欢的声音，放在一起</h3><p>创建你的第一张歌单，留给某个心情或时刻。</p></div>}</div></section>}<section className="library-section"><div className="section-heading"><div><div className="section-kicker">{query?'FIND YOUR SOUND':selectedPlaylist?'YOUR COLLECTION':view==='offline'?'TAKE IT WITH YOU':view==='favorites'?'CLOSE TO YOUR HEART':view==='queue'?'UP NEXT':'MADE OF YOUR FAVORITES'}</div><h2>{heading}<span>{shown.length} 首歌曲</span></h2></div><div className="section-controls">{selectedPlaylist&&<><button className="icon-button" aria-label="重命名歌单" title="重命名歌单" onClick={()=>{if(canEdit())setDialog({type:'playlist',playlist:selectedPlaylist});}}><Settings2 size={17}/></button><button className="icon-button" aria-label="删除歌单" title="删除歌单" onClick={()=>{if(canEdit())setDialog({type:'confirm',title:`删除「${selectedPlaylist.name}」？`,action:async()=>{await mutate(()=>api(`/playlists/${selectedPlaylist.id}`,{method:'DELETE',body:JSON.stringify({version:selectedPlaylist.version})}));navigate('library');}});}}><Trash2 size={17}/></button></>}{shown.length>0&&<><button className="button secondary compact" onClick={()=>player.playList(shown.map(t=>t.id))}><Play size={14} fill="currentColor"/>播放全部</button>{view!=='offline'&&<button className="icon-button" title="下载全部歌曲" aria-label="下载全部歌曲" onClick={downloadAll}><CloudDownload size={18}/></button>}</>}{!selectedPlaylist&&view!=='queue'&&<label className="sort-control"><SlidersHorizontal size={15}/><select aria-label="歌曲排序" value={sort} onChange={e=>setSort(e.target.value)}><option value="recent">最近添加</option><option value="title">歌曲名称</option><option value="plays">播放次数</option></select><ChevronDown size={13}/></label>}</div></div>
      {view==='offline'&&<div className="download-overview"><div><span className="download-icon"><Download size={23}/></span><div><strong>{formatBytes(used)}<small> / {formatBytes(cache.settings.limit)}</small></strong><p>{cache.entries.length} 首歌曲已准备好，随时离线播放</p></div></div><button className="text-button" onClick={()=>navigate('settings')}>管理存储 <ArrowUpRight size={15}/></button></div>}
      {view==='offline'&&<DownloadTasks tracksById={tracksById}/>}
      {loading&&!library?<div className="empty-state"><LoaderCircle className="spin" size={28}/><h3>正在打开你的音乐空间</h3></div>:shown.length?<TrackList tracks={shown} playCounts={counts.trackCounts} currentId={playback.id} playing={playback.playing} favorites={favorites} cachedIds={cachedIds} selectedPlaylist={selectedPlaylist} onAction={onTrackAction} viewKey={`${view}:${query}:${sort}`}/>:<div className="empty-state"><div className="empty-icon">{query?<Search size={30}/>:view==='offline'?<CloudDownload size={30}/>:view==='favorites'?<Heart size={30}/>:<Music2 size={30}/>}</div><h3>{query?'还没有找到这段旋律':view==='offline'?'把喜欢的音乐，带在身边':view==='favorites'?'喜欢的旋律，值得被收藏':selectedPlaylist?'这张歌单，等你的第一首歌':'每一段旅程，都从一首歌开始'}</h3><p>{query?'试试其他歌曲名称、歌手或专辑。':view==='offline'?'点击歌曲旁的下载按钮，没有网络也能听。':view==='favorites'?'轻点歌曲旁的爱心，留住你的心头好。':selectedPlaylist?'在曲库中打开歌曲的更多菜单，添加到这张歌单。':expired?'登录后上传喜欢的音乐，在不同设备间随时聆听。':'上传你的 MP3、M4A、FLAC 或 OGG 音乐，建立专属收藏。'}</p>{!query&&view!=='offline'&&view!=='favorites'&&!selectedPlaylist&&(expired?<a className="button primary" href="/api/auth/start"><LogIn size={16}/>登录我的曲库</a>:<button className="button secondary" onClick={openUpload}><Plus size={16}/>上传第一首音乐</button>)}</div>}
      </section>{view==='library'&&!query&&<div className="library-footer"><span><ShieldCheck size={14}/>只属于你的音乐收藏</span><span>慢下来，听一首喜欢的歌。 <span className="footer-star">✦</span></span></div>}
      </>}
      </div>
    </main>
    <PlayerBar current={current} tracks={tracks} favorites={favorites} cachedIds={cachedIds} view={view} setFullPlayer={setFullPlayer} navigate={navigate} favorite={favorite}/>
    <nav className="mobile-nav">{[...nav.slice(0,2),{id:'playlists',label:'歌单',icon:ListMusic},...nav.slice(2)].map(n=><button key={n.id} className={view===n.id?'active':''} onClick={()=>navigate(n.id)}><n.icon size={20}/><span>{n.id==='statistics'?'统计':n.label}</span></button>)}<button className={view==='settings'?'active':''} onClick={()=>navigate('settings')}><Settings2 size={20}/><span>设置</span></button></nav>
    {toast&&<div className="toast" role="status"><AudioLines size={18}/><span>{toast}</span><button className="icon-button" aria-label="关闭提示" onClick={()=>setToast('')}><X size={15}/></button></div>}
    {dialog&&<Modal title={dialog.type==='upload'?'把喜欢的音乐，收入余音':dialog.type==='playlist'?(dialog.playlist?'重命名歌单':'创建一张新歌单'):dialog.type==='edit'?'编辑歌曲资料':dialog.type==='add'?'添加到歌单':dialog.title||'确认操作'} onClose={()=>!saving&&setDialog(null)} wide={dialog.type==='upload'}>
      {dialog.type==='upload'?<UploadPanel queue={uploads} canEdit={canEdit}/>:dialog.type==='playlist'||dialog.type==='edit'?<form onSubmit={submitForm} noValidate>{dialog.type==='playlist'?<label className="form-field">歌单名称<input name="name" autoFocus defaultValue={dialog.playlist?.name||''} placeholder="例如：留给傍晚的歌" aria-describedby={formError?'form-error':undefined}/></label>:<>{(['title','artist','album']as const).map((key,i)=><label className="form-field" key={key}>{['歌曲名称','歌手','专辑'][i]}<input name={key} defaultValue={dialog.track?.[key]||''} aria-describedby={formError?'form-error':undefined}/></label>)}</>}{formError&&<p className="form-error" id="form-error" role="alert">{formError}</p>}<div className="modal-actions"><button className="button secondary" type="button" disabled={saving} onClick={()=>setDialog(null)}>取消</button><button className="button primary" type="submit" disabled={saving}>{saving?<LoaderCircle className="spin" size={16}/>:<Check size={16}/>}保存</button></div></form>:dialog.type==='add'?<><p className="modal-description">将「{dialog.track?.title}」加入喜欢的歌单。</p><div className="playlist-picker">{library?.playlists.map(p=><button key={p.id} disabled={saving||p.trackIds.includes(dialog.track!.id)} onClick={async()=>{setSaving(true);try{await updatePlaylist(p,[...p.trackIds,dialog.track!.id]);setDialog(null);notice('已添加到歌单');}catch(e){setFormError((e as Error).message);}finally{setSaving(false);}}}><span className="playlist-symbol"><ListMusic size={20}/></span><span>{p.name}<small>{p.trackIds.length} 首歌曲</small></span>{p.trackIds.includes(dialog.track!.id)?<Check size={17}/>:<Plus size={17}/>}</button>)}{!library?.playlists.length&&<p className="muted">还没有歌单，先创建一张吧。</p>}</div><button className="button secondary" onClick={()=>setDialog({type:'playlist'})}><Plus size={16}/>创建新歌单</button>{formError&&<p className="form-error" role="alert">{formError}</p>}</>:<><p className="modal-description">{dialog.title?.includes('云端删除')?'歌曲将从云端曲库、收藏和所有歌单中移除，其他设备下次同步时会更新。':dialog.title?.includes('退出')?'这台设备上的离线音乐、曲库资料和尚未同步的播放次数将被清除。云端曲库和已同步次数会保留。':dialog.title?.includes('清空')?'这台设备的离线音乐将被清除，云端曲库会保留。':'歌单将被删除，其中的歌曲仍保留在曲库。'}</p>{formError&&<p className="form-error" role="alert">{formError}</p>}<div className="modal-actions"><button className="button secondary" disabled={saving} onClick={()=>setDialog(null)}>取消</button><button className="button danger" disabled={saving} onClick={async()=>{setSaving(true);try{await dialog.action?.();setDialog(null);}catch(e){setFormError((e as Error).message);}finally{setSaving(false);}}}>{saving?<LoaderCircle className="spin" size={16}/>:<Trash2 size={16}/>}确认</button></div></>}
    </Modal>}
    {fullPlayer&&<FullPlayer current={current} tracks={tracks} favorites={favorites} cachedIds={cachedIds} view={view} setFullPlayer={setFullPlayer} navigate={navigate} favorite={favorite}/>}
  </div>;
}
