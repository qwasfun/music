import {createHash} from 'node:crypto';
// Deterministic native FLAC with verbatim subframes and real CRCs (RFC 9639).
// Independent browser decoders verify this fixture in the end-to-end test.
function crc(bytes,width,polynomial){let value=0;for(const byte of bytes){value^=byte<<(width-8);for(let bit=0;bit<8;bit++)value=((value<<(1))^((value&(1<<(width-1)))?polynomial:0))&((1<<width)-1);}return value;}
function u32(value,little=false){const bytes=Buffer.alloc(4);if(little)bytes.writeUInt32LE(value);else bytes.writeUInt32BE(value);return bytes;}
function block(type,data,last=false){const header=Buffer.alloc(4);header[0]=type|(last?128:0);header.writeUIntBE(data.length,1,3);return Buffer.concat([header,data]);}
export function createFlacFixture({seconds=8,sampleRate=44100,bitsPerSample=16,title='FLAC 测试旋律',artist='余音测试',album='无损音频测试',picture}={}){
  const channels=2,bytesPerSample=bitsPerSample/8,total=Math.floor(sampleRate*seconds),blockSize=4096;
  const pcm=Buffer.alloc(total*channels*bytesPerSample);
  for(let i=0;i<total;i++)for(let channel=0;channel<channels;channel++){const time=i/sampleRate,envelope=Math.min(1,time/.05,(seconds-time)/.1);const value=Math.round(Math.sin(2*Math.PI*(channel?554:440)*time)*((2**(bitsPerSample-1))-1)*.12*envelope);pcm.writeIntLE(value,(i*channels+channel)*bytesPerSample,bytesPerSample);}
  const info=Buffer.alloc(34);info.writeUInt16BE(blockSize,0);info.writeUInt16BE(blockSize,2);
  const packed=(BigInt(sampleRate)<<44n)|(BigInt(channels-1)<<41n)|(BigInt(bitsPerSample-1)<<36n)|BigInt(total);info.writeBigUInt64BE(packed,10);createHash('md5').update(pcm).digest().copy(info,18);
  const vendor=Buffer.from('afterglow-tests'),comments=[`TITLE=${title}`,`ARTIST=${artist}`,`ALBUM=${album}`].map(t=>Buffer.from(t));
  const tags=Buffer.concat([u32(vendor.length,true),vendor,u32(comments.length,true),...comments.flatMap(t=>[u32(t.length,true),t])]);
  const chunks=[Buffer.from('fLaC'),block(0,info),block(4,tags,!picture)];
  if(picture){const mime=Buffer.from('image/png');const data=Buffer.concat([u32(3),u32(mime.length),mime,u32(0),u32(192),u32(192),u32(32),u32(0),u32(picture.length),picture]);chunks.push(block(6,data,true));}
  for(let start=0,index=0;start<total;start+=blockSize,index++){
    const count=Math.min(blockSize,total-start),number=Buffer.from(String.fromCodePoint(index),'utf8');
    const header=Buffer.concat([Buffer.from([255,248,0x70,0x10|((bitsPerSample===24?6:4)<<1)]),number,Buffer.from([(count-1)>>8,(count-1)&255])]);
    const subframes=[];for(let channel=0;channel<channels;channel++){const samples=Buffer.alloc(1+count*bytesPerSample);samples[0]=2;for(let i=0;i<count;i++)samples.writeIntBE(pcm.readIntLE(((start+i)*channels+channel)*bytesPerSample,bytesPerSample),1+i*bytesPerSample,bytesPerSample);subframes.push(samples);}
    const frame=Buffer.concat([header,Buffer.from([crc(header,8,7)]),...subframes]);const footer=Buffer.alloc(2);footer.writeUInt16BE(crc(frame,16,0x8005));chunks.push(frame,footer);
  }
  return Buffer.concat(chunks);
}
