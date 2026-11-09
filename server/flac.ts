// Native FLAC stream structure: RFC 9639 sections 7-9.
// Read metadata headers by range; embedded pictures never enter Worker memory.
export async function validateFlac(read:(offset:number,length:number)=>Promise<Uint8Array>,size:number):Promise<void> {
  const invalid=(reason:string):never=>{throw new Error(`${reason}；请重新导出有效的 FLAC 文件后上传`);};
  if(size<44)invalid('FLAC 文件不完整');
  const stream=await read(0,42);
  if(stream.length!==42||String.fromCharCode(...stream.slice(0,4))!=='fLaC')invalid('未检测到 FLAC 文件标识');
  if((stream[4]&127)!==0||stream[5]!==0||stream[6]!==0||stream[7]!==34)invalid('FLAC STREAMINFO 音频信息损坏');
  const minBlock=(stream[8]<<8)|stream[9],maxBlock=(stream[10]<<8)|stream[11];
  const sampleRate=(stream[18]<<12)|(stream[19]<<4)|(stream[20]>>4);
  const bitsPerSample=(((stream[20]&1)<<4)|(stream[21]>>4))+1;
  if(minBlock<16||maxBlock<minBlock||!sampleRate||sampleRate>655350||bitsPerSample<4||bitsPerSample>32)invalid('FLAC 采样参数无效');
  let offset=42,last=!!(stream[4]&128);
  for(let count=0;!last;count++){
    if(count>=31)invalid('FLAC 元数据块过多');
    if(offset+4>size)invalid('FLAC 元数据头不完整');
    const header=await read(offset,4);
    if(header.length!==4)invalid('FLAC 元数据头不完整');
    const type=header[0]&127,length=(header[1]<<16)|(header[2]<<8)|header[3];
    if(type===0||type===127)invalid('FLAC 元数据类型无效');
    offset+=4+length;last=!!(header[0]&128);
    if(offset>size-2)invalid('FLAC 元数据长度超出文件范围');
  }
  if(offset>size-2)invalid('FLAC 文件缺少音频帧');
  const frame=await read(offset,2);
  if(frame.length!==2||frame[0]!==255||(frame[1]&254)!==248)invalid('未检测到有效 FLAC 音频帧');
}
