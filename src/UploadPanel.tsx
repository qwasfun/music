import {useRef,useState,useSyncExternalStore} from 'react';
import {CheckCircle2,LoaderCircle,Music2,ShieldCheck,Upload,X} from 'lucide-react';
import type {UploadQueue} from './upload-queue';
import {MAX_FILE} from '../shared/contracts';
export function UploadPanel({queue,canEdit}:{queue:UploadQueue;canEdit:()=>boolean}){
  const jobs=useSyncExternalStore(queue.subscribe,queue.snapshot),fileInput=useRef<HTMLInputElement>(null);
  const [expanded,setExpanded]=useState(false);
  const visible=expanded?jobs:[...jobs.filter(job=>job.status==='uploading'),...jobs.filter(job=>job.status==='error').slice(0,15),...jobs.filter(job=>job.status==='queued').slice(0,15),...jobs.filter(job=>['done','skipped','canceled'].includes(job.status)).slice(-10)];
  function addFiles(files:FileList|null){if(files&&canEdit())queue.add(files);}
  return <><p className="modal-description">你的音乐会保存在私人云端，在其他设备登录后即可播放。相同文件会自动跳过。</p>
    <input ref={fileInput} type="file" accept=".mp3,.m4a,.flac,.ogg,audio/mpeg,audio/mp4,audio/flac,audio/x-flac,audio/ogg,application/ogg" multiple hidden onChange={e=>{addFiles(e.target.files);e.target.value='';}}/>
    <button className="dropzone" onClick={()=>fileInput.current?.click()} onDragOver={e=>{e.preventDefault();e.currentTarget.classList.add('dragover');}} onDragLeave={e=>e.currentTarget.classList.remove('dragover')} onDrop={e=>{e.preventDefault();e.currentTarget.classList.remove('dragover');addFiles(e.dataTransfer.files);}}><span><Upload size={26}/></span><strong>拖放音乐到这里，或点击选择</strong><small>MP3 / M4A(AAC) / FLAC / OGG · 每首最多 {MAX_FILE / 1024 ** 2} MiB · 支持批量上传</small></button>
    {jobs.length>0&&<div className="upload-jobs">{visible.map(j=><div className="upload-job" key={j.key} data-status={j.status}>
      <span className={`job-icon ${j.status==='done'||j.status==='skipped'?'complete':''}`}>{j.status==='done'||j.status==='skipped'?<CheckCircle2 size={20}/>:j.status==='uploading'?<LoaderCircle className="spin" size={20}/>:<Music2 size={20}/>}</span>
      <div><strong>{j.file.name}</strong><small role={j.status==='skipped'?'status':undefined} className={j.status==='error'?'error-text':''}>{j.message||(j.status==='queued'?'等待上传':'')}</small>{j.status==='uploading'&&<div className="meter"><i style={{width:`${j.progress*100}%`}}/></div>}</div>
      {j.status==='error'?<button className="text-button" onClick={()=>{queue.retry(j.key);}}>重试</button>:['queued','uploading'].includes(j.status)?<button className="icon-button" aria-label={`取消上传 ${j.file.name}`} onClick={()=>{queue.cancel(j.key);}}><X size={16}/></button>:null}
    </div>)}</div>}
    {jobs.length>visible.length&&<button className="text-button" onClick={()=>setExpanded(true)}>还有 {jobs.length-visible.length} 项，显示全部上传记录</button>}
    <p className="upload-note"><ShieldCheck size={14}/>只有你可以访问上传的音乐。上传时请保持应用打开。</p>
  </>;
}
