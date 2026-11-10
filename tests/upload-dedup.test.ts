import {afterAll,afterEach,beforeAll,describe,expect,it} from 'vitest';
import {Miniflare} from 'miniflare';
import {readFileSync,readdirSync} from 'node:fs';
import {createHash} from 'node:crypto';

let mf:Miniflare;
beforeAll(async()=>{
  mf=new Miniflare({modules:true,scriptPath:'dist-worker/index.js',compatibilityDate:'2026-07-01',d1Databases:{DB:'dedup-db'},r2Buckets:['BUCKET'],bindings:{DEV_AUTH:'local-only'}});
  const db=await mf.getD1Database('DB');
  for(const file of readdirSync('migrations').filter(file=>file.endsWith('.sql')).sort())await db.exec(readFileSync(`migrations/${file}`,'utf8'));
});
afterEach(async()=>{
  const db=await mf.getD1Database('DB');await db.exec('DELETE FROM playlists; DELETE FROM tracks; DELETE FROM upload_sessions; DELETE FROM users;');
  const bucket=await mf.getR2Bucket('BUCKET'),objects=await bucket.list();
  if(objects.objects.length)await bucket.delete(objects.objects.map(object=>object.key));
});
afterAll(async()=>{await mf?.dispose();});
const bytes=(variant=0)=>{const result=new Uint8Array(4096);result.set([255,251,144,100,variant]);return result;};
const hash=(file:Uint8Array)=>createHash('sha256').update(file).digest('hex');
async function request(path:string,method='GET',body?:unknown){
  return mf.dispatchFetch(`http://localhost/api${path}`,{method,headers:body instanceof Uint8Array?{'Content-Length':String(body.length)}:body?{'Content-Type':'application/json'}:{},body:body instanceof Uint8Array?body:body?JSON.stringify(body):undefined});
}
async function start(file=bytes(),extra:Record<string,unknown>={}){
  return request('/uploads','POST',{title:'Original',artist:'Artist',album:'Album',filename:'song.mp3',size:file.length,duration:10,contentHash:hash(file),...extra});
}
async function stage(file=bytes(),extra:Record<string,unknown>={}){
  const response=await start(file,extra);expect(response.status).toBe(201);
  const {id}=await response.json()as {id:string};
  expect((await request(`/uploads/${id}/parts/1`,'PUT',file)).status).toBe(200);
  return {id,complete:()=>request(`/uploads/${id}/complete`,'POST')};
}
async function seedLegacy(id:string,file=bytes(),user='local-owner'){
  const db=await mf.getD1Database('DB');await db.prepare('INSERT OR IGNORE INTO users(id) VALUES (?)').bind(user).run();
  const key=`audio/${user}/${id}`;await(await mf.getR2Bucket('BUCKET')).put(key,file);
  await db.prepare('INSERT INTO tracks(id,user_id,title,artist,album,duration,size,mime,object_key) VALUES (?,?,?,?,?,?,?,?,?)').bind(id,user,'Edited legacy title','Edited artist','Edited album',10,file.length,'audio/mpeg',key).run();
}
async function storage(){
  const db=await mf.getD1Database('DB');
  return {tracks:(await db.prepare('SELECT COUNT(*) AS count FROM tracks').first<{count:number}>())!.count,sessions:(await db.prepare('SELECT COUNT(*) AS count FROM upload_sessions').first<{count:number}>())!.count,objects:(await(await mf.getR2Bucket('BUCKET')).list()).objects.map(object=>object.key)};
}

describe('file content deduplication',()=>{
  it('skips identical and renamed files before creating an upload or changing metadata',async()=>{
    const task=await stage(),completed=await task.complete();expect(completed.status).toBe(201);
    await request(`/tracks/${task.id}`,'PATCH',{title:'My edited title',artist:'My artist',album:'My album'});
    const before=await storage();
    for(const filename of ['song.mp3','renamed.MP3']){
      const response=await start(bytes(),{filename,title:'Incoming title'});expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({duplicate:true,track:{id:task.id,title:'My edited title',artist:'My artist',album:'My album'}});
    }
    expect(await storage()).toEqual(before);
  });
  it('keeps same-name, same-size files when their contents differ',async()=>{
    const first=await stage(bytes(1)),second=await stage(bytes(2));
    expect((await first.complete()).status).toBe(201);expect((await second.complete()).status).toBe(201);
    expect(await storage()).toMatchObject({tracks:2,sessions:0});expect((await storage()).objects).toHaveLength(2);
  });
  it('recognizes legacy files and preserves their ID, favorites, playlists and edited metadata',async()=>{
    const id=crypto.randomUUID();await seedLegacy(id);
    await request(`/favorites/${id}`,'PUT');
    const playlist=await(await request('/playlists','POST',{name:'Keep me'})).json()as {id:string};
    await request(`/playlists/${playlist.id}`,'PUT',{name:'Keep me',version:1,trackIds:[id]});
    const response=await start();expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({duplicate:true,track:{id,title:'Edited legacy title',artist:'Edited artist'}});
    const library=await(await request('/library')).json()as any;
    expect(library.favorites).toEqual([id]);expect(library.playlists[0].trackIds).toEqual([id]);
    expect(library.tracks).toHaveLength(1);
    expect(await(await mf.getD1Database('DB')).prepare('SELECT content_hash FROM tracks WHERE id=?').bind(id).first()).toEqual({content_hash:hash(bytes())});
    expect(await storage()).toMatchObject({tracks:1,sessions:0});expect((await storage()).objects).toHaveLength(1);
  });
  it('tolerates preexisting duplicates while preventing another copy',async()=>{
    await seedLegacy('legacy-a');await seedLegacy('legacy-b');
    const response=await start();expect(response.status).toBe(200);expect(await response.json()).toMatchObject({duplicate:true});
    expect(await storage()).toMatchObject({tracks:2,sessions:0});expect((await storage()).objects).toHaveLength(2);
  });
  it('backfills different equal-size legacy candidates without treating them as duplicates',async()=>{
    await seedLegacy('different-legacy',bytes(3));
    const task=await stage(bytes(4));expect((await task.complete()).status).toBe(201);
    const db=await mf.getD1Database('DB');expect(await db.prepare('SELECT COUNT(*) AS count FROM tracks WHERE content_hash IS NOT NULL').first()).toEqual({count:2});
  });
  it('deduplicates older clients without a hash and removes the redundant R2 object',async()=>{
    await seedLegacy('legacy-original');
    const task=await stage(bytes(),{contentHash:undefined});
    const response=await task.complete();expect(response.status).toBe(200);expect(await response.json()).toMatchObject({id:'legacy-original',duplicate:true});
    expect(await storage()).toEqual({tracks:1,sessions:0,objects:['audio/local-owner/legacy-original']});
  });
  it('allows only one winner for concurrent identical uploads and removes the losing object',async()=>{
    const first=await stage(),second=await stage();
    const responses=await Promise.all([first.complete(),second.complete()]);expect(responses.map(response=>response.status).sort()).toEqual([200,201]);
    const tracks=await Promise.all(responses.map(response=>response.json()as Promise<any>));expect(tracks[0].id).toBe(tracks[1].id);expect(tracks.filter(track=>track.duplicate)).toHaveLength(1);
    expect(await storage()).toEqual({tracks:1,sessions:0,objects:[`audio/local-owner/${tracks[0].id}`]});
    const db=await mf.getD1Database('DB');expect(await db.prepare('SELECT COUNT(*) AS count FROM upload_parts').first()).toEqual({count:0});
  });
  it('verifies the actual uploaded bytes and returns a specific field error on a false hash',async()=>{
    const task=await stage(bytes(),{contentHash:hash(bytes(9))}),response=await task.complete();expect(response.status).toBe(422);
    const body=await response.json()as any;expect(body.error).toMatchObject({code:'UPLOAD_HASH_MISMATCH',fields:[{field:'contentHash',label:'音频文件',action:'请重新选择音频文件上传'}]});
    expect(body.error.message).toContain('文件内容与校验信息不一致');expect(await storage()).toEqual({tracks:0,sessions:0,objects:[]});
  });
  it('rejects malformed hashes without echoing submitted values',async()=>{
    const response=await start(bytes(),{contentHash:'private-submitted-value'});expect(response.status).toBe(422);
    const text=await response.text();expect(text).toContain('音频文件');expect(text).toContain('重新选择音频文件');expect(text).not.toContain('private-submitted-value');
  });
  it('scopes deduplication to the current user and permits uploading again after deletion',async()=>{
    await seedLegacy('other-user-track',bytes(),'other-user');
    const first=await stage();expect((await first.complete()).status).toBe(201);
    expect((await request(`/tracks/${first.id}`,'DELETE')).status).toBe(200);
    const second=await stage();expect((await second.complete()).status).toBe(201);
    expect(await storage()).toMatchObject({tracks:2,sessions:0});
  });
});
