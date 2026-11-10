import {mkdir,writeFile} from 'node:fs/promises';
await mkdir('output/fixtures',{recursive:true});
for(const [name,file]of [['vorbis','sfx.ogg'],['opus','bear-opus.ogg']]){
  const url=`https://chromium.googlesource.com/chromium/src/+/refs/heads/main/media/test/data/${file}?format=TEXT`;
  const response=await fetch(url);if(!response.ok)throw new Error(`OGG fixture HTTP ${response.status}`);const data=Buffer.from(await response.text(),'base64');if(data.toString('ascii',0,4)!=='OggS')throw new Error('Invalid OGG fixture');await writeFile(`output/fixtures/test-${name}.ogg`,data);console.log(`${name}: ${data.length} bytes of Chromium OGG test audio (local tests only)`);
  if(name==='opus'){
    // RFC 7845 permits zero for the optional original input rate. Keep encoded
    // audio unchanged and recompute the identification page checksum.
    const unspecified=Buffer.from(data),segments=unspecified[26],packet=27+segments;
    if(unspecified.toString('ascii',packet,packet+8)!=='OpusHead')throw new Error('Missing Opus identification header');
    unspecified.writeUInt32LE(0,packet+12);unspecified.fill(0,22,26);
    const pageSize=packet+unspecified.subarray(27,packet).reduce((sum,n)=>sum+n,0);let crc=0;
    for(const byte of unspecified.subarray(0,pageSize)){crc^=byte<<24;for(let bit=0;bit<8;bit++)crc=(crc<<1)^((crc&0x80000000)?0x04c11db7:0);}
    unspecified.writeUInt32LE(crc>>>0,22);await writeFile('output/fixtures/test-opus-unspecified.ogg',unspecified);
  }
}
const longResponse=await fetch('https://raw.githubusercontent.com/mdn/webaudio-examples/main/audio-param/viper.ogg');
if(!longResponse.ok)throw new Error(`MDN OGG fixture HTTP ${longResponse.status}`);
const longData=Buffer.from(await longResponse.arrayBuffer());if(longData.toString('ascii',0,4)!=='OggS')throw new Error('Invalid MDN OGG fixture');
await writeFile('output/fixtures/test-vorbis-long.ogg',longData);console.log(`vorbis-long: ${longData.length} bytes of MDN reference audio (local tests only)`);
