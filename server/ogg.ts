import {inspectOgg} from '../shared/ogg';
export async function validateOgg(read:(offset:number,length:number)=>Promise<Uint8Array>,size:number):Promise<'vorbis'|'opus'> {
  return (await inspectOgg(read,size)).codec;
}
