import {createHash} from 'node:crypto';

// Distinct valid files with unchanged audio: put a unique marker in an ID3v1 comment.
export function uniqueMp3(audio,key){
  const tag=Buffer.alloc(128);tag.write('TAG');tag.write(createHash('sha256').update(key).digest('hex'),97,30);
  return Buffer.concat([audio,tag]);
}
