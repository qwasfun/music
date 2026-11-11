import {beforeAll,beforeEach,afterAll,it,expect,vi} from 'vitest';
const cache=vi.hoisted(()=>({entries:new Map(),checking:false,ready:Promise.resolve()}));
vi.mock('../src/cache',()=>({downloads:{touch:async()=>{},entries:cache.entries,overviewSnapshot:()=>({checking:cache.checking}),whenReady:()=>cache.ready}}));
let player:typeof import('../src/player')['player'];
beforeAll(async()=>{
  vi.stubGlobal('Audio',class extends EventTarget {volume=1;currentTime=0;duration=240;playbackRate=1;src='';paused=true;getAttribute(){return this.src||null;}removeAttribute(){this.src='';}pause(){this.paused=true;this.dispatchEvent(new Event('pause'));}async play(){this.paused=false;this.dispatchEvent(new Event('playing'));}});
  vi.stubGlobal('localStorage',{getItem:()=>null,setItem:()=>{},removeItem:()=>{}});vi.stubGlobal('navigator',{onLine:true});
  ({player}=await import('../src/player'));
});
afterAll(()=>vi.unstubAllGlobals());
beforeEach(()=>{player.clear();cache.entries.clear();cache.checking=false;cache.ready=Promise.resolve();vi.stubGlobal('navigator',{onLine:true});});
it('publishes time to the player without changing the library subscription',()=>{
  const library=player.viewSnapshot();let changes=0;
  const stop=player.subscribe(()=>{if(player.viewSnapshot()!==library)changes++;});
  for(let time=1;time<=240;time++){player.audio.currentTime=time/4;player.audio.dispatchEvent(new Event('timeupdate'));}
  expect(player.snapshot().time).toBe(60);expect(changes).toBe(0);expect(player.viewSnapshot()).toBe(library);
  player.audio.dispatchEvent(new Event('playing'));expect(player.viewSnapshot().playing).toBe(true);expect(changes).toBe(1);stop();
});
const library={user:{id:'test',name:'test'},tracks:[{id:'one',title:'one',artist:'',album:'',duration:240,size:4,mime:'audio/mpeg',cover:false,createdAt:''}],playlists:[],favorites:[]};
it('continues an offline play request once cache reconciliation completes',async()=>{
  vi.stubGlobal('navigator',{onLine:false});let ready!:()=>void;cache.checking=true;cache.ready=new Promise(resolve=>{ready=resolve;});player.setLibrary(library);player.playList(['one']);
  expect(player.snapshot().id).toBeNull();cache.entries.set('one',{});cache.checking=false;ready();await cache.ready;await Promise.resolve();expect(player.snapshot()).toMatchObject({id:'one',playing:true});
  // A restored track may have no media source yet when the play button is tapped.
  player.audio.pause();player.audio.removeAttribute('src');cache.checking=true;cache.ready=new Promise(resolve=>{ready=resolve;});player.toggle();cache.checking=false;ready();await cache.ready;await Promise.resolve();expect(player.snapshot().playing).toBe(true);
});
it('does not start deferred offline playback after the player is cleared',async()=>{
  vi.stubGlobal('navigator',{onLine:false});let ready!:()=>void;cache.checking=true;cache.ready=new Promise(resolve=>{ready=resolve;});player.setLibrary(library);player.playList(['one']);player.clear();cache.entries.set('one',{});cache.checking=false;ready();await cache.ready;await Promise.resolve();expect(player.snapshot()).toMatchObject({id:null,playing:false});expect(player.audio.getAttribute('src')).toBeNull();
});

it('starts a fresh play on repeat and track changes',()=>{
  const clock=vi.spyOn(performance,'now');
  const counts:string[]=[];
  const stop=player.subscribeToCountedPlays(id=>counts.push(id));
  const tracks=[library.tracks[0],{...library.tracks[0],id:'two'}];
  const advance=(position:number,now:number)=>{
    clock.mockReturnValue(now);
    player.audio.currentTime=position;
    player.audio.dispatchEvent(new Event('timeupdate'));
  };
  try{
    clock.mockReturnValue(0);
    player.audio.currentTime=0;
    player.setLibrary({...library,tracks});
    player.playList(['one','two']);
    advance(25,25000);
    player.next();
    advance(30,30000);
    expect(counts).toEqual([]);
    advance(55,55000);
    expect(counts).toEqual(['two']);
    player.repeat();
    player.audio.dispatchEvent(new Event('ended'));
    advance(29,84000);
    expect(counts).toEqual(['two']);
    advance(30,85000);
    expect(counts).toEqual(['two','two']);
  }finally{
    stop();
    clock.mockRestore();
  }
});
