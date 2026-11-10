// Container-only fixtures for validation tests. Browser tests use independently
// encoded Chromium reference media, not these synthetic compressed packets.
export function oggPage(packet:Uint8Array|null,flags=0,sequence=0){
  const lacing:number[]=[];if(packet){let remaining=packet.length;while(remaining>=255){lacing.push(255);remaining-=255;}lacing.push(remaining);}
  const page=new Uint8Array(27+lacing.length+(packet?.length||0)),view=new DataView(page.buffer);page.set([79,103,103,83,0,flags]);view.setBigUint64(6,flags&4?48000n:0n,true);view.setUint32(14,1234,true);view.setUint32(18,sequence,true);page[26]=lacing.length;page.set(lacing,27);if(packet)page.set(packet,27+lacing.length);
  let crc=0;for(const byte of page){crc^=byte<<24;for(let bit=0;bit<8;bit++)crc=(crc<<1)^((crc&0x80000000)?0x04c11db7:0);}view.setUint32(22,crc>>>0,true);return page;
}
export function oggIdentification(codec:'vorbis'|'opus'){
  if(codec==='opus'){const packet=new Uint8Array(19);packet.set(new TextEncoder().encode('OpusHead'));packet[8]=1;packet[9]=2;new DataView(packet.buffer).setUint32(12,48000,true);return packet;}
  const packet=new Uint8Array(30),view=new DataView(packet.buffer);packet[0]=1;packet.set(new TextEncoder().encode('vorbis'),1);packet[11]=2;view.setUint32(12,44100,true);packet[28]=0xb8;packet[29]=1;return packet;
}
export function createOggContainerFixture(codec:'vorbis'|'opus',packet=oggIdentification(codec)){const first=oggPage(packet,2),last=oggPage(new Uint8Array([0]),4,1);const bytes=new Uint8Array(first.length+last.length);bytes.set(first);bytes.set(last,first.length);return bytes;}
