import type {Track} from '../shared/contracts';
import {uploadFile,type UploadJob} from './upload';

// Progress belongs to the upload panel; the rest of the app observes only count.
export class UploadQueue {
  private jobs:UploadJob[]=[];
  private active=0;
  private listeners=new Set<()=>void>();
  private state:UploadJob[]=[];
  private pending=0;
  private lastProgress=0;
  private progressTimer:ReturnType<typeof setTimeout>|undefined;
  private syncTimer:ReturnType<typeof setInterval>|undefined;
  private dirty=false;
  private batchChanged=false;
  private generation=0;
  constructor(private onTrack:(track:Track)=>void,private onSync:(final:boolean)=>Promise<void>,private run=uploadFile){}
  subscribe=(listener:()=>void)=>{this.listeners.add(listener);return()=>this.listeners.delete(listener);};
  snapshot=()=>this.state;
  pendingSnapshot=()=>this.pending;
  private emit=()=>{
    if(this.progressTimer){clearTimeout(this.progressTimer);this.progressTimer=undefined;}
    this.lastProgress=Date.now();this.state=this.jobs.map(job=>({...job}));
    this.pending=this.jobs.filter(job=>job.status==='queued'||job.status==='uploading').length;
    for(const listener of this.listeners)listener();
  };
  private progress=()=>{
    const remaining=200-(Date.now()-this.lastProgress);
    if(remaining<=0)this.emit();else if(!this.progressTimer)this.progressTimer=setTimeout(this.emit,remaining);
  };
  add(files:FileList|File[]){
    for(const file of Array.from(files))this.jobs.push({key:crypto.randomUUID(),file,status:'queued',progress:0,controller:new AbortController()});
    this.emit();this.pump();
  }
  retry(key:string){const job=this.jobs.find(job=>job.key===key);if(!job||job.status!=='error')return;job.controller=new AbortController();job.status='queued';job.progress=0;job.message='';this.emit();this.pump();}
  cancel(key:string){const job=this.jobs.find(job=>job.key===key);if(!job)return;job.controller.abort();if(job.status==='queued'){job.status='canceled';job.message='已取消上传';}this.emit();}
  clear(){this.generation++;if(this.syncTimer)clearInterval(this.syncTimer);this.syncTimer=undefined;if(this.progressTimer)clearTimeout(this.progressTimer);this.progressTimer=undefined;for(const job of this.jobs)job.controller.abort();this.jobs=[];this.dirty=false;this.batchChanged=false;this.emit();}
  private async flush(final:boolean){if(!this.dirty&&!(final&&this.batchChanged))return;this.dirty=false;if(final)this.batchChanged=false;try{await this.onSync(final);}catch{this.dirty=true;}}
  private pump(){
    if(!this.syncTimer&&this.jobs.some(job=>job.status==='queued'))this.syncTimer=setInterval(()=>void this.flush(false),5000);
    while(this.active<2){
      const job=this.jobs.find(job=>job.status==='queued');if(!job)break;
      const generation=this.generation;job.status='uploading';this.active++;
      void this.run(job,this.progress).then(track=>{
        if(generation!==this.generation||!track)return;
        this.onTrack(track);this.dirty=true;this.batchChanged=true;
      }).catch(()=>{}).finally(()=>{
        this.active--;if(generation===this.generation)this.emit();this.pump();
      });
    }
    if(this.active===0&&!this.jobs.some(job=>job.status==='queued')){
      if(this.syncTimer)clearInterval(this.syncTimer);this.syncTimer=undefined;void this.flush(true);
    }
  }
}
