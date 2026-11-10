import {memo,useEffect,useState} from 'react';
import {Disc3} from 'lucide-react';
import {coverUrl,type Track} from '../shared/contracts';
export const Cover=memo(function Cover({track,large=false}:{track?:Track;large?:boolean}){const[failed,setFailed]=useState(false);useEffect(()=>setFailed(false),[track?.id,track?.cover]);const hue=track?[...track.id].reduce((s,c)=>s+c.charCodeAt(0),0)%5:0;return <div className={`cover cover-${hue} ${large?'cover-large':''}`}>{track?.cover&&!failed?<img loading={large?'eager':'lazy'} decoding="async" src={coverUrl(track.id)} alt={`${track.album||track.title} 封面`} onError={()=>setFailed(true)}/>:<><span className="cover-orbit"/><Disc3 size={large?80:24} strokeWidth={1}/><span className="cover-spark"/></>}</div>;});
