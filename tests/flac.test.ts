import {describe,it,expect} from 'vitest';
import {validateFlac} from '../server/flac';
import {createFlacFixture} from './fixtures/flac.mjs';
const validate=(bytes:Uint8Array)=>validateFlac(async(offset,length)=>bytes.slice(offset,offset+length),bytes.length);
describe('FLAC stream validation',()=>{
  it.each([16,24]as const)('accepts a real %i-bit FLAC stream with tags',async bitsPerSample=>{await expect(validate(createFlacFixture({seconds:.2,bitsPerSample}))).resolves.toBeUndefined();});
  it('skips embedded pictures without buffering them',async()=>{const bytes=createFlacFixture({seconds:.2,picture:new Uint8Array(200000)});const reads:{offset:number;length:number}[]=[];await validateFlac(async(offset,length)=>{reads.push({offset,length});return bytes.slice(offset,offset+length);},bytes.length);expect(reads.every(r=>r.length<=42)).toBe(true);expect(reads.some(r=>r.offset>200000)).toBe(true);});
  it('rejects an MP3 renamed to FLAC',async()=>{const b=new Uint8Array(100);b.set([255,251,144,100]);await expect(validate(b)).rejects.toThrow('FLAC 文件标识');});
  it('rejects a truncated STREAMINFO',async()=>{await expect(validate(createFlacFixture().slice(0,30))).rejects.toThrow('FLAC 文件不完整');});
  it('rejects a wrong STREAMINFO length',async()=>{const b=createFlacFixture({seconds:.2});b[7]=33;await expect(validate(b)).rejects.toThrow('STREAMINFO');});
  it('rejects invalid sample parameters',async()=>{const b=createFlacFixture({seconds:.2});b[18]=0;b[19]=0;b[20]&=15;await expect(validate(b)).rejects.toThrow('采样参数');});
  it('rejects metadata that extends beyond the uploaded file',async()=>{const b=createFlacFixture({seconds:.2});b[43]=255;b[44]=255;b[45]=255;await expect(validate(b)).rejects.toThrow('元数据长度');});
  it('rejects a file with metadata and no audio frames',async()=>{const b=createFlacFixture({seconds:.2});const length=(b[43]<<16)|(b[44]<<8)|b[45];await expect(validate(b.slice(0,46+length))).rejects.toThrow('FLAC');});
});
