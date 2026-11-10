import {afterEach,describe,expect,it,vi} from 'vitest';
import {UploadQueue} from '../src/upload-queue';
import type {UploadJob} from '../src/upload';
import type {Track} from '../shared/contracts';

const track=(id:string):Track=>({id,title:id,artist:'',album:'',duration:1,size:4,mime:'audio/mpeg',cover:false,createdAt:''});
const files=(count:number)=>Array.from({length:count},(_,i)=>new File(['test'],`${i}.mp3`));
afterEach(()=>vi.useRealTimers());

describe('batch upload scheduling',()=>{
  it('finishes skipped files without publishing tracks or scheduling a library sync',async()=>{
    const onTrack=vi.fn(),onSync=vi.fn(async()=>{});
    const queue=new UploadQueue(onTrack,onSync,async job=>{job.status='skipped';job.message='歌曲已存在，已跳过';return undefined;});
    queue.add(files(3));
    await vi.waitFor(()=>expect(queue.pendingSnapshot()).toBe(0));
    expect(queue.snapshot().map(job=>job.status)).toEqual(['skipped','skipped','skipped']);
    expect(onTrack).not.toHaveBeenCalled();expect(onSync).not.toHaveBeenCalled();queue.clear();
  });
  it('limits concurrency to two and reconciles a completed batch once',async()=>{
    const onTrack=vi.fn(),onSync=vi.fn(async()=>{});let active=0,peak=0;
    const run=async(job:UploadJob)=>{active++;peak=Math.max(peak,active);await Promise.resolve();active--;job.status='done';return track(job.key);};
    const queue=new UploadQueue(onTrack,onSync,run);queue.add(files(200));
    await vi.waitFor(()=>expect(onTrack).toHaveBeenCalledTimes(200));
    expect(peak).toBe(2);expect(queue.pendingSnapshot()).toBe(0);expect(onSync).toHaveBeenCalledExactlyOnceWith(true);queue.clear();
  });
  it('throttles progress without changing the pending-count snapshot',async()=>{
    vi.useFakeTimers();let finish!:(track:Track)=>void,progress!:()=>void;
    const run=(job:UploadJob,onChange:()=>void)=>{progress=onChange;return new Promise<Track>(resolve=>{finish=track=>{job.status='done';resolve(track);};});};
    const queue=new UploadQueue(()=>{},async()=>{},run);queue.add(files(1));const listener=vi.fn();queue.subscribe(listener);
    for(let i=0;i<100;i++){progress();await vi.advanceTimersByTimeAsync(1);}
    expect(listener).not.toHaveBeenCalled();expect(queue.pendingSnapshot()).toBe(1);
    await vi.advanceTimersByTimeAsync(100);expect(listener).toHaveBeenCalledTimes(1);
    finish(track('one'));await vi.advanceTimersByTimeAsync(0);expect(queue.pendingSnapshot()).toBe(0);queue.clear();
  });
  it('syncs at five-second intervals and always reconciles after the final completion',async()=>{
    vi.useFakeTimers();const finishes:Array<()=>void>=[],onSync=vi.fn(async()=>{});
    const run=(job:UploadJob)=>new Promise<Track>(resolve=>finishes.push(()=>{job.status='done';resolve(track(job.key));}));
    const queue=new UploadQueue(()=>{},onSync,run);queue.add(files(4));
    finishes[0]();await vi.advanceTimersByTimeAsync(4999);expect(onSync).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);expect(onSync).toHaveBeenCalledExactlyOnceWith(false);
    finishes[1]();finishes[2]();await vi.advanceTimersByTimeAsync(0);finishes[3]();await vi.advanceTimersByTimeAsync(0);
    expect(onSync.mock.calls).toEqual([[false],[true]]);queue.clear();
  });
  it('does not publish results or sync after logout, and can retry a failed item',async()=>{
    let finish!:(value:Track)=>void;const onTrack=vi.fn(),onSync=vi.fn(async()=>{});
    const queue=new UploadQueue(onTrack,onSync,()=>new Promise(resolve=>{finish=resolve;}));queue.add(files(1));queue.clear();finish(track('late'));await new Promise(resolve=>setTimeout(resolve,0));expect(onTrack).not.toHaveBeenCalled();expect(onSync).not.toHaveBeenCalled();
    let attempts=0;
    const retry=new UploadQueue(onTrack,onSync,async job=>{if(attempts++===0){job.status='error';throw new Error('Network');}job.status='done';return track(job.key);});
    retry.add(files(1));await vi.waitFor(()=>expect(retry.snapshot()[0].status).toBe('error'));retry.retry(retry.snapshot()[0].key);await vi.waitFor(()=>expect(onTrack).toHaveBeenCalledTimes(1));expect(onSync).toHaveBeenCalledExactlyOnceWith(true);retry.clear();
  });
});
