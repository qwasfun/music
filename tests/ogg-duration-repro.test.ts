import {describe,it,expect} from 'vitest';
import {parseBlob} from 'music-metadata';
import {createOggDurationFixture} from './fixtures/ogg';
import {readUploadMetadata} from '../src/audio-metadata';
describe('Ogg duration regression reproduction',()=>{
  it.each(['vorbis','opus']as const)('recovers %s duration after default parsing stops early',async codec=>{const bytes=createOggDurationFixture(codec),file=new File([bytes.buffer],`long-${codec}.ogg`,{type:'audio/ogg'});const partial=await parseBlob(file);expect(partial.format.duration).toBeUndefined();const result=await readUploadMetadata(file);expect(result.duration).toBeCloseTo(codec==='opus'?(48000-312)/48000:48000/44100,8);});
  it.each([0,20])('recovers Opus duration with an unspecified input rate and %i extra pages',async pages=>{const bytes=createOggDurationFixture('opus',pages,0),file=new File([bytes.buffer],'unknown-rate.ogg',{type:'audio/ogg'});const metadata=await parseBlob(file,{duration:true});expect(metadata.format.duration).toBeUndefined();expect((await readUploadMetadata(file)).duration).toBeCloseTo((48000-312)/48000,8);});
  it('keeps rejecting corrupt end-page data with a concrete field reason',async()=>{const bytes=createOggDurationFixture('opus',0,0);bytes[bytes.length-1]^=1;await expect(readUploadMetadata(new File([bytes.buffer],'corrupt.ogg',{type:'audio/ogg'}))).rejects.toThrow('音频文件：OGG 结束页缺失或损坏');});
});
