import {uploadSchema,validationError,PART_SIZE,type Track} from '../shared/contracts';
import {api,RequestError} from './api';
export interface UploadJob {key:string;file:File;status:'queued'|'uploading'|'done'|'error'|'canceled';progress:number;message?:string;controller:AbortController}
export async function extractCover(data:Uint8Array,mime:string):Promise<Blob>{
  const image=await createImageBitmap(new Blob([data.slice().buffer],{type:mime}));
  const scale=Math.min(1,512/Math.max(image.width,image.height));const canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.round(image.width*scale));canvas.height=Math.max(1,Math.round(image.height*scale));canvas.getContext('2d')!.drawImage(image,0,0,canvas.width,canvas.height);image.close();
  return new Promise((resolve,reject)=>canvas.toBlob(blob=>blob?resolve(blob):reject(new Error('封面转换失败')),'image/jpeg',0.85));
}
async function uploadPart(id:string,n:number,blob:Blob,signal:AbortSignal,onProgress:(value:number)=>void){
  for(let attempt=0;attempt<3;attempt++){
    try {await new Promise<void>((resolve,reject)=>{
      const xhr=new XMLHttpRequest();xhr.open('PUT',`/api/uploads/${id}/parts/${n}`);xhr.setRequestHeader('Content-Type','application/octet-stream');
      const abort=()=>xhr.abort();signal.addEventListener('abort',abort,{once:true});
      xhr.upload.onprogress=e=>{if(e.lengthComputable)onProgress(e.loaded/e.total);};
      xhr.onload=()=>{signal.removeEventListener('abort',abort);if(xhr.status>=200&&xhr.status<300){try{JSON.parse(xhr.responseText);resolve();}catch{reject(new RequestError('登录已过期，请重新登录曲库后重试',401));}}else{let message=`第 ${n} 个分片上传失败，请重试`;try{const data=JSON.parse(xhr.responseText);message=data.error.message;}catch{}reject(new RequestError(message,xhr.status));}};
      xhr.onerror=()=>{signal.removeEventListener('abort',abort);reject(new RequestError('音频文件：网络中断，请重试上传',0));};
      xhr.onabort=()=>{signal.removeEventListener('abort',abort);reject(new DOMException('Canceled','AbortError'));};
      if(signal.aborted){reject(new DOMException('Canceled','AbortError'));return;}xhr.send(blob);
    });return;}catch(e){if(signal.aborted||(e instanceof RequestError&&e.status>=400&&e.status<500)||attempt===2)throw e;await new Promise(r=>setTimeout(r,500*(attempt+1)));}
  }
}
export async function uploadFile(job:UploadJob,onChange:()=>void):Promise<Track>{
  const signal=job.controller.signal;let sessionId:string|undefined;
  try{
    job.status='uploading';job.message='正在读取音频资料';onChange();
    const preliminary=uploadSchema.safeParse({filename:job.file.name,size:job.file.size,title:job.file.name.replace(/\.[^.]+$/,''),duration:1});if(!preliminary.success)throw new Error(validationError(preliminary.error).error.message);
    let metadata;try{const {parseBlob}=await import('music-metadata');metadata=await parseBlob(job.file);}catch{throw new Error('音频文件：无法读取音乐资料，请选择有效的 MP3、AAC 编码 M4A 或 FLAC 文件');}
    const payload=uploadSchema.safeParse({filename:job.file.name,size:job.file.size,title:metadata.common.title||job.file.name.replace(/\.[^.]+$/,''),artist:metadata.common.artist||'',album:metadata.common.album||'',duration:metadata.format.duration||0});
    if(!payload.success)throw new Error(validationError(payload.error).error.message);
    if(signal.aborted)throw new DOMException('Canceled','AbortError');
    const session=await api<{id:string;partSize:number}>('/uploads',{method:'POST',body:JSON.stringify(payload.data),signal});sessionId=session.id;
    const count=Math.ceil(job.file.size/PART_SIZE);
    for(let i=0;i<count;i++){
      job.message=`正在上传 ${i+1} / ${count} 个分片`;onChange();
      const start=i*PART_SIZE,end=Math.min(job.file.size,(i+1)*PART_SIZE);
      await uploadPart(session.id,i+1,job.file.slice(start,end),signal,value=>{job.progress=(start+(end-start)*value)/job.file.size;onChange();});
    }
    job.message='正在校验完整文件';onChange();
    const track=await api<Track>(`/uploads/${session.id}/complete`,{method:'POST',signal});sessionId=undefined;
    const pic=metadata.common.picture?.[0];if(pic&&!signal.aborted){try{job.message='正在保存专辑封面';onChange();const cover=await extractCover(pic.data,pic.format);await api(`/tracks/${track.id}/cover`,{method:'PUT',body:cover,signal});}catch{job.message='歌曲已上传，封面未保存';}}
    job.status='done';job.progress=1;if(job.message!=='歌曲已上传，封面未保存')job.message='已加入你的曲库';onChange();return track;
  }catch(e){if(sessionId)try{await api(`/uploads/${sessionId}`,{method:'DELETE'});}catch{}job.status=signal.aborted?'canceled':'error';job.message=signal.aborted?'已取消上传':(e as Error).message;onChange();throw e;}
}
