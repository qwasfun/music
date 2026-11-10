import {beforeEach,describe,expect,it,vi} from 'vitest';
import {createHash} from 'node:crypto';
import {uploadFile,type UploadJob} from '../src/upload';
import {api} from '../src/api';
import {readUploadMetadata} from '../src/audio-metadata';
vi.mock('../src/api',async importOriginal=>({...await importOriginal<typeof import('../src/api')>(),api:vi.fn()}));
vi.mock('../src/audio-metadata',async importOriginal=>({...await importOriginal<typeof import('../src/audio-metadata')>(),readUploadMetadata:vi.fn()}));
beforeEach(()=>{
  vi.resetAllMocks();
  vi.mocked(readUploadMetadata).mockResolvedValue({metadata:{common:{title:'Title',picture:[{data:new Uint8Array([1]),format:'image/jpeg'}]}}as any,duration:10});
});
const job=():UploadJob=>({key:crypto.randomUUID(),file:new File(['contents'],'renamed.mp3'),status:'queued',progress:0,controller:new AbortController()});

describe('upload duplicate feedback',()=>{
  it('sends the content hash and skips without uploading parts, completing or overwriting a cover',async()=>{
    vi.mocked(api).mockResolvedValue({duplicate:true,track:{id:'existing'}});
    const item=job();expect(await uploadFile(item,()=>{})).toBeUndefined();
    expect(item.status).toBe('skipped');expect(item.message).toBe('歌曲已存在，已跳过');
    expect(api).toHaveBeenCalledTimes(1);const [path,init]=vi.mocked(api).mock.calls[0];expect(path).toBe('/uploads');
    expect(JSON.parse(init!.body as string).contentHash).toBe(createHash('sha256').update('contents').digest('hex'));
  });
  it('also skips a duplicate discovered at completion without saving its cover',async()=>{
    vi.mocked(api).mockResolvedValueOnce({id:'session',partSize:8388608}).mockResolvedValueOnce({id:'existing',duplicate:true});
    const item=job();
    const send=vi.fn(function(this:any){this.status=200;this.responseText='{}';this.onload();});
    vi.stubGlobal('XMLHttpRequest',class{upload={};open=vi.fn();setRequestHeader=vi.fn();send=send;});
    try{
      expect(await uploadFile(item,()=>{})).toBeUndefined();expect(item.status).toBe('skipped');expect(item.message).toBe('歌曲已存在，已跳过');
      expect(api).toHaveBeenCalledTimes(2);expect(vi.mocked(api).mock.calls[1][0]).toBe('/uploads/session/complete');
    }finally{vi.unstubAllGlobals();}
  });
  it('cancels before creating a session when canceled during metadata reading',async()=>{
    const item=job();vi.mocked(readUploadMetadata).mockImplementation(async()=>{item.controller.abort();return {metadata:{common:{}},duration:10}as any;});
    await expect(uploadFile(item,()=>{})).rejects.toThrow();expect(item.status).toBe('canceled');expect(api).not.toHaveBeenCalled();
  });
});
