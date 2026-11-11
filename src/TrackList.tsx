import {memo,useEffect,useLayoutEffect,useRef,useState,type CSSProperties} from 'react';
import {createPortal} from 'react-dom';
import {useWindowVirtualizer} from '@tanstack/react-virtual';
import {ArrowDown,ArrowUp,Check,CheckCircle2,Download,Ellipsis,FolderHeart,Headphones,Heart,ListMusic,Play,Settings2,Trash2,X} from 'lucide-react';
import {formatTime,type Playlist,type Track} from '../shared/contracts';
import {downloads} from './cache';
import {player} from './player';
import {Cover} from './Cover';

export type TrackAction='favorite'|'add'|'edit'|'delete'|'up'|'down'|'remove';
interface Props {
  tracks:Track[];currentId:string|null;playing:boolean;favorites:Set<string>;cachedIds:Set<string>;
  playCounts:Readonly<Record<string,number>>;
  selectedPlaylist?:Playlist;viewKey:string;onAction:(action:TrackAction,track:Track,index:number)=>void;
}
interface Menu {track:Track;index:number;anchor:DOMRect}

export const TrackList=memo(function TrackList({tracks,currentId,playing,favorites,cachedIds,playCounts,selectedPlaylist,viewKey,onAction}:Props){
  const body=useRef<HTMLTableSectionElement>(null),panel=useRef<HTMLDivElement>(null);
  const visibleColumns=()=>window.innerWidth<=760?3:window.innerWidth<=960?4:5;
  const [columns,setColumns]=useState(visibleColumns),[scrollMargin,setScrollMargin]=useState(0),[menu,setMenu]=useState<Menu|null>(null),[menuTop,setMenuTop]=useState(0);
  const previousKey=useRef(viewKey);
  const virtual=useWindowVirtualizer({count:tracks.length,overscan:8,estimateSize:()=>72,scrollMargin,getItemKey:index=>tracks[index].id,useFlushSync:false});
  useLayoutEffect(()=>{
    const measure=()=>{setColumns(visibleColumns());if(body.current)setScrollMargin(body.current.getBoundingClientRect().top+window.scrollY);};
    measure();const observer=new ResizeObserver(measure);observer.observe(document.body);window.addEventListener('resize',measure);
    if(previousKey.current!==viewKey){previousKey.current=viewKey;window.scrollTo({top:0,behavior:'instant'});}
    return()=>{observer.disconnect();window.removeEventListener('resize',measure);};
  },[viewKey]);
  useEffect(()=>setMenu(null),[tracks,viewKey]);
  useLayoutEffect(()=>{
    if(!menu)return;
    const height=panel.current?.getBoundingClientRect().height||300;
    panel.current?.style.setProperty('--menu-height',`${height}px`);
    setMenuTop(Math.max(8,Math.min(menu.anchor.bottom+5,window.innerHeight-height-8)));
    const close=()=>setMenu(null);
    const outside=(event:PointerEvent)=>{if(!panel.current?.contains(event.target as Node))close();};
    const key=(event:KeyboardEvent)=>{if(event.key==='Escape')close();};
    window.addEventListener('scroll',close,true);window.addEventListener('resize',close);document.addEventListener('pointerdown',outside);document.addEventListener('keydown',key);
    panel.current?.querySelector<HTMLButtonElement>('button')?.focus();
    return()=>{window.removeEventListener('scroll',close,true);window.removeEventListener('resize',close);document.removeEventListener('pointerdown',outside);document.removeEventListener('keydown',key);};
  },[menu]);
  const items=virtual.getVirtualItems(),first=items[0],last=items[items.length-1];
  const before=first?Math.max(0,first.start-scrollMargin):0,after=last?Math.max(0,virtual.getTotalSize()-(last.end-scrollMargin)):virtual.getTotalSize();
  const playlistIndex=menu?selectedPlaylist?.trackIds.indexOf(menu.track.id)??-1:-1;
  function play(index:number){player.playList(tracks.map(track=>track.id),index);}
  function action(kind:TrackAction){if(menu)onAction(kind,menu.track,menu.index);setMenu(null);}
  return <div className="track-table-wrap">
    <table className="track-table" aria-label="歌曲列表" aria-rowcount={tracks.length+1}>
      <thead><tr><th className="number-cell">#</th><th>歌曲</th><th className="album-cell">专辑</th><th className="duration-cell">时长</th><th className="actions-cell"><Headphones size={14}/></th></tr></thead>
      <tbody ref={body}>
        {before>0&&<tr aria-hidden="true" className="virtual-spacer"><td colSpan={columns} style={{height:before}}/></tr>}
        {items.map(item=>{const t=tracks[item.index],i=item.index;return <tr key={item.key} data-index={i} data-track-id={t.id} aria-rowindex={i+2} ref={virtual.measureElement} className={t.id===currentId?'is-current':''}>
          <td className="number-cell"><button className="row-play" aria-label={`播放 ${t.title}`} onClick={()=>t.id===currentId?player.toggle():play(i)}>{t.id===currentId&&playing?<span className="equalizer"><i/><i/><i/></span>:<><span>{String(i+1).padStart(2,'0')}</span><Play size={14} fill="currentColor"/></>}</button></td>
          <td><div className="track-info"><button className="cover-button" aria-label={`播放 ${t.title}`} onClick={()=>play(i)}><Cover track={t}/></button><button className="track-title" onClick={()=>play(i)}><strong>{t.title}{cachedIds.has(t.id)&&<CheckCircle2 className="cached-mark" size={12}/>}</strong><small className="track-details"><span>{t.artist||'未知歌手'}</span><span className="track-play-count">{(playCounts[t.id]??0).toLocaleString('zh-CN')} 次播放</span></small></button></div></td>
          <td className="album-cell">{t.album||'未命名专辑'}</td><td className="duration-cell">{formatTime(t.duration)}</td>
          <td className="actions-cell"><div className="track-actions">
            <button className={`icon-button favorite-button ${favorites.has(t.id)?'is-liked':''}`} aria-label={favorites.has(t.id)?`取消喜欢 ${t.title}`:`喜欢 ${t.title}`} onClick={()=>onAction('favorite',t,i)}><Heart size={16} fill={favorites.has(t.id)?'currentColor':'none'}/></button>
            <button className={`icon-button ${cachedIds.has(t.id)?'is-cached':''}`} aria-label={cachedIds.has(t.id)?`${t.title} 已下载`:`下载 ${t.title}`} title={cachedIds.has(t.id)?'已保存到本机':'下载到本机'} onClick={()=>void downloads.enqueue(t.id,true)}><>{cachedIds.has(t.id)?<Check size={17}/>:<ArrowDown size={17}/>}</></button>
            <button className="icon-button" aria-label={`${t.title} 更多操作`} aria-haspopup="menu" aria-expanded={menu?.track.id===t.id} onClick={event=>{setMenuTop(event.currentTarget.getBoundingClientRect().bottom);setMenu({track:t,index:i,anchor:event.currentTarget.getBoundingClientRect()});}}><Ellipsis size={18}/></button>
          </div></td>
        </tr>;})}
        {after>0&&<tr aria-hidden="true" className="virtual-spacer"><td colSpan={columns} style={{height:after}}/></tr>}
      </tbody>
    </table>
    {menu&&createPortal(<div ref={panel} className="menu-panel track-menu-portal" role="menu" aria-label={`${menu.track.title} 更多操作`} style={{'--menu-top':`${menuTop}px`,'--menu-left':`${Math.max(8,Math.min(menu.anchor.right-190,window.innerWidth-198))}px`} as CSSProperties} onClick={()=>setMenu(null)}>
      <button role="menuitem" onClick={()=>player.add(menu.track.id)}><ListMusic size={15}/>加入播放队列</button>
      <button role="menuitem" onClick={()=>action('add')}><FolderHeart size={15}/>添加到歌单</button>
      <button role="menuitem" onClick={()=>action('edit')}><Settings2 size={15}/>编辑歌曲资料</button>
      {selectedPlaylist&&playlistIndex>=0&&<><button role="menuitem" disabled={playlistIndex===0} onClick={()=>action('up')}><ArrowUp size={15}/>上移一首</button><button role="menuitem" disabled={playlistIndex===selectedPlaylist.trackIds.length-1} onClick={()=>action('down')}><ArrowDown size={15}/>下移一首</button><button role="menuitem" onClick={()=>action('remove')}><X size={15}/>从此歌单移除</button></>}
      {cachedIds.has(menu.track.id)&&<button role="menuitem" onClick={()=>void downloads.remove(menu.track.id)}><Download size={15}/>删除本机下载</button>}
      <button role="menuitem" className="danger-text" onClick={()=>action('delete')}><Trash2 size={15}/>从云端删除</button>
    </div>,document.body)}
  </div>;
});
