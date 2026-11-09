import {mkdir,writeFile} from 'node:fs/promises';
const source='https://chromium.googlesource.com/chromium/src/+/refs/heads/main/media/test/data/tiny-clip.mp4?format=TEXT';
const response=await fetch(source);if(!response.ok)throw new Error(`AAC fixture download failed: ${response.status}`);
const data=Buffer.from(await response.text(),'base64');if(data.length<12||data.toString('ascii',4,8)!=='ftyp')throw new Error('Invalid AAC fixture');
await mkdir('output/fixtures',{recursive:true});await writeFile('output/fixtures/test-aac.m4a',data);
console.log(`Downloaded ${data.length} bytes of Chromium AAC test media (local tests only)`);
