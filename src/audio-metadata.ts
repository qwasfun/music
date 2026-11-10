export class AudioMetadataReadError extends Error {}
export async function readUploadMetadata(file:File){
  const {parseBlob}=await import('music-metadata');
  const isOgg=/\.ogg$/i.test(file.name);
  // Ogg duration is stored at the end; default parsing can stop before it.
  const metadata=await parseBlob(file,isOgg?{duration:true}:undefined);
  const parsed=metadata.format.duration;
  let duration=typeof parsed==='number'&&Number.isFinite(parsed)&&parsed>0?parsed:0;
  if(isOgg&&!duration){
    try{
      const {inspectOgg}=await import('../shared/ogg');
      const info=await inspectOgg(async(offset,length)=>new Uint8Array(await file.slice(offset,offset+length).arrayBuffer()),file.size);
      if(info.duration===null||!Number.isFinite(info.duration)||info.duration<=0)throw new AudioMetadataReadError('音频时长：OGG 结束页未包含有效时长；请重新导出完整的 Vorbis 或 Opus 音频后上传');
      // Opus granules use 48 kHz even when its optional input rate is zero.
      duration=info.duration;
    }catch(e){if(e instanceof AudioMetadataReadError)throw e;throw new AudioMetadataReadError(`音频文件：${(e as Error).message}`);}
  }
  return {metadata,duration};
}
