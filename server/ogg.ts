// Ogg pages: RFC 3533; Opus identification: RFC 7845; Vorbis I spec 4.2.2.
// Only the identification page and at most one maximum-size final page are read.
const MAX_PAGE=27+255+255*255;
const crcTable=Uint32Array.from({length:256},(_,i)=>{let crc=i<<24;for(let bit=0;bit<8;bit++)crc=(crc<<1)^((crc&0x80000000)?0x04c11db7:0);return crc>>>0;});
function crcValid(page:Uint8Array){let crc=0;for(let i=0;i<page.length;i++){const byte=i>=22&&i<26?0:page[i];crc=((crc<<8)^crcTable[((crc>>>24)^byte)&255])>>>0;}return crc===new DataView(page.buffer,page.byteOffset,page.byteLength).getUint32(22,true);}
function pageLength(bytes:Uint8Array,offset=0){if(offset+27>bytes.length||bytes[offset]!==79||bytes[offset+1]!==103||bytes[offset+2]!==103||bytes[offset+3]!==83||bytes[offset+4]!==0||(bytes[offset+5]&248)!==0)return 0;const segments=bytes[offset+26],header=27+segments;if(offset+header>bytes.length)return 0;let length=header;for(let i=0;i<segments;i++)length+=bytes[offset+27+i];return length;}
export async function validateOgg(read:(offset:number,length:number)=>Promise<Uint8Array>,size:number):Promise<'vorbis'|'opus'> {
  const invalid=(reason:string):never=>{throw new Error(`${reason}；请重新导出完整的 Vorbis 或 Opus 编码 OGG 文件后上传`);};
  if(size<58)invalid('OGG 文件不完整');
  const prefix=await read(0,Math.min(size,282)),length=pageLength(prefix);
  if(!length)invalid('OGG 文件标识或页头无效');
  if(!prefix[26]||prefix[5]!==2||new DataView(prefix.buffer,prefix.byteOffset,prefix.byteLength).getUint32(18,true)!==0)invalid('OGG 起始页无效');
  if(length>size-27)invalid('OGG 识别页不完整或缺少音频数据');
  const page=await read(0,length);if(page.length!==length||!crcValid(page))invalid('OGG 识别页校验失败');
  const segments=page[26];for(let i=0;i<segments-1;i++)if(page[27+i]!==255)invalid('OGG 识别页包含无效数据包');
  if(page[26+segments]===255)invalid('OGG 识别数据包不完整');
  const packet=page.subarray(27+segments),text=(start:number,end:number)=>String.fromCharCode(...packet.subarray(start,end));let codec:'vorbis'|'opus';
  if(packet[0]===1&&text(1,7)==='vorbis'){
    if(packet.length!==30)invalid('Vorbis 识别头长度无效');const view=new DataView(packet.buffer,packet.byteOffset,packet.byteLength);const small=packet[28]&15,large=packet[28]>>4;
    if(view.getUint32(7,true)!==0||!packet[11]||!view.getUint32(12,true)||small<6||large>13||small>large||(packet[29]&1)!==1)invalid('Vorbis 采样参数或版本无效');codec='vorbis';
  }else if(text(0,8)==='OpusHead'){
    if(packet.length<19||packet[8]!==1||!packet[9])invalid('Opus 识别头或版本无效');const channels=packet[9],family=packet[18];
    if(family===0){if(channels>2||packet.length!==19)invalid('Opus 声道配置无效');}
    else {if(family!==1||channels>8||packet.length!==21+channels||!packet[19]||packet[20]>packet[19]||packet[19]+packet[20]>channels)invalid('Opus 声道映射无效');const coded=packet[19]+packet[20];if(packet.subarray(21).some(value=>value!==255&&value>=coded))invalid('Opus 声道映射无效');}codec='opus';
  }else return invalid('OGG 音频编码不受支持，目前仅支持 Vorbis 和 Opus');
  const tail=await read(Math.max(0,size-MAX_PAGE),Math.min(size,MAX_PAGE));
  for(let offset=tail.length-27;offset>=0;offset--){if(tail[offset]!==79)continue;const lastLength=pageLength(tail,offset);if(lastLength&&offset+lastLength===tail.length&&(tail[offset+5]&4)&&crcValid(tail.subarray(offset)))return codec;}
  return invalid('OGG 结束页缺失或损坏');
}
