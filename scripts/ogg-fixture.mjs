import {mkdir,writeFile} from 'node:fs/promises';
await mkdir('output/fixtures',{recursive:true});
for(const [name,file]of [['vorbis','sfx.ogg'],['opus','bear-opus.ogg']]){
  const url=`https://chromium.googlesource.com/chromium/src/+/refs/heads/main/media/test/data/${file}?format=TEXT`;
  const response=await fetch(url);if(!response.ok)throw new Error(`OGG fixture HTTP ${response.status}`);const data=Buffer.from(await response.text(),'base64');if(data.toString('ascii',0,4)!=='OggS')throw new Error('Invalid OGG fixture');await writeFile(`output/fixtures/test-${name}.ogg`,data);console.log(`${name}: ${data.length} bytes of Chromium OGG test audio (local tests only)`);
}
