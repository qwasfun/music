export class PlayAttempt {
  private checkpoint?: {position:number;now:number;rate:number};
  private elapsed=0;
  private counted=false;

  constructor(readonly trackId:string,private readonly trackDuration:number){}

  resume(position:number,now:number,rate:number){
    if(!this.counted)this.checkpoint={position,now,rate};
  }

  suspend(){this.checkpoint=undefined;}

  sample(position:number,now:number,rate:number,mediaDuration:number):boolean{
    if(!this.checkpoint)return false;
    const previous=this.checkpoint;
    this.resume(position,now,rate);
    const advance=position-previous.position;
    const elapsed=(now-previous.now)/1000;
    // Media time may be rounded by the browser. A jump larger than the elapsed
    // playback window should never be credited as listening time.
    if(advance<=0||advance>elapsed*previous.rate+0.25)return false;
    this.elapsed+=advance;
    const duration=Number.isFinite(mediaDuration)&&mediaDuration>0?mediaDuration:this.trackDuration;
    const threshold=Number.isFinite(duration)&&duration>0?Math.min(30,duration/2):30;
    if(this.elapsed+1e-6<threshold)return false;
    this.counted=true;
    this.suspend();
    return true;
  }
}
