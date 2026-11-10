import {beforeAll,afterAll,describe,it,expect} from 'vitest';
import {Miniflare} from 'miniflare';
import {readFileSync,readdirSync} from 'node:fs';

let mf:Miniflare;let ids:string[];let playlist:string;
const request=(path:string,method='GET',body?:unknown)=>mf.dispatchFetch(`http://localhost/api${path}`,{method,headers:body?{'Content-Type':'application/json'}:{},body:body?JSON.stringify(body):undefined});
beforeAll(async()=>{
  mf=new Miniflare({modules:true,scriptPath:'dist-worker/index.js',compatibilityDate:'2026-07-01',d1Databases:{DB:'capacity-db'},r2Buckets:['BUCKET'],bindings:{DEV_AUTH:'local-only',APP_ORIGIN:'http://localhost'}});
  const db=await mf.getD1Database('DB');for(const file of readdirSync('migrations').filter(file=>file.endsWith('.sql')).sort())await db.exec(readFileSync(`migrations/${file}`,'utf8'));
  const p=await request('/playlists','POST',{name:'容量歌单'});playlist=(await p.json()as any).id;
  ids=Array.from({length:2000},()=>crypto.randomUUID());
  const rows=ids.map((id,i)=>({id,title:`歌曲 ${String(i).padStart(4,'0')}`,artist:`歌手 ${i%50}`,album:`专辑 ${i%100}`}));
  await db.prepare("INSERT INTO tracks(id,user_id,title,artist,album,duration,size,mime,object_key) SELECT json_extract(value,'$.id'),'local-owner',json_extract(value,'$.title'),json_extract(value,'$.artist'),json_extract(value,'$.album'),240,10485760,'audio/mpeg',json_extract(value,'$.id') FROM json_each(?)").bind(JSON.stringify(rows)).run();
  await db.exec("CREATE TABLE test_member_writes(kind TEXT); CREATE TRIGGER test_member_insert AFTER INSERT ON playlist_tracks BEGIN INSERT INTO test_member_writes VALUES ('insert'); END; CREATE TRIGGER test_member_update AFTER UPDATE ON playlist_tracks BEGIN INSERT INTO test_member_writes VALUES ('update'); END; CREATE TRIGGER test_member_delete AFTER DELETE ON playlist_tracks BEGIN INSERT INTO test_member_writes VALUES ('delete'); END;");
});
afterAll(async()=>{await mf?.dispose();});
async function writes(){const db=await mf.getD1Database('DB');const {results}=await db.prepare('SELECT kind,COUNT(*) AS count FROM test_member_writes GROUP BY kind').all();await db.prepare('DELETE FROM test_member_writes').run();return results;}

describe('2000-song library and playlist',()=>{
  it('returns every metadata record without reading nonexistent audio blobs',async()=>{
    const started=performance.now(),response=await request('/library'),body=await response.text(),data=JSON.parse(body);
    expect(response.status).toBe(200);expect(data.tracks).toHaveLength(2000);expect(new Set(data.tracks.map((track:any)=>track.id)).size).toBe(2000);
    console.info(`2000-song metadata: ${Math.round(performance.now()-started)} ms, ${Buffer.byteLength(body)} bytes`);
  });
  it('creates a 2000-song playlist in order, and renames it without member writes',async()=>{
    expect((await request(`/playlists/${playlist}`,'PUT',{name:'容量歌单',version:1,trackIds:ids})).status).toBe(200);expect(await writes()).toEqual([{kind:'insert',count:2000}]);
    const data=await(await request('/library')).json()as any;expect(data.playlists[0].trackIds).toEqual(ids);
    expect((await request(`/playlists/${playlist}`,'PUT',{name:'新名称',version:2,trackIds:ids})).status).toBe(200);expect(await writes()).toEqual([]);
  });
  it('swaps two positions with two updates and rejects stale or invalid input unchanged',async()=>{
    [ids[0],ids[1]]=[ids[1],ids[0]];
    expect((await request(`/playlists/${playlist}`,'PUT',{name:'新名称',version:3,trackIds:ids})).status).toBe(200);expect(await writes()).toEqual([{kind:'update',count:2}]);
    expect((await request(`/playlists/${playlist}`,'PUT',{name:'过期',version:3,trackIds:[]})).status).toBe(409);expect(await writes()).toEqual([]);
    for(const trackIds of [[ids[0],ids[0]],[crypto.randomUUID()],Array.from({length:5001},()=>ids[0])]){
      const result=await request(`/playlists/${playlist}`,'PUT',{name:'错误',version:4,trackIds});expect(result.status).toBe(422);const error=await result.json()as any;expect(error.error.fields[0]).toMatchObject({field:'trackIds',label:'歌单歌曲'});
    }
    expect(await writes()).toEqual([]);const data=await(await request('/library')).json()as any;expect(data.playlists[0]).toMatchObject({name:'新名称',version:4,trackIds:ids});
  });
  it('deletes only a removed member, adds it back, and permits one concurrent winner',async()=>{
    expect((await request(`/playlists/${playlist}`,'PUT',{name:'新名称',version:4,trackIds:ids.slice(0,-1)})).status).toBe(200);expect(await writes()).toEqual([{kind:'delete',count:1}]);
    expect((await request(`/playlists/${playlist}`,'PUT',{name:'新名称',version:5,trackIds:ids})).status).toBe(200);expect(await writes()).toEqual([{kind:'insert',count:1}]);
    const results=await Promise.all(['设备 A','设备 B'].map(name=>request(`/playlists/${playlist}`,'PUT',{name,version:6,trackIds:ids})));
    expect(results.map(result=>result.status).sort()).toEqual([200,409]);expect(await writes()).toEqual([]);
  });
  it('never creates a user row while reading metadata, covers or audio',async()=>{
    const db=await mf.getD1Database('DB');await db.exec("CREATE TABLE test_user_inserts(attempts INTEGER); CREATE TRIGGER test_user_attempt BEFORE INSERT ON users BEGIN INSERT INTO test_user_inserts VALUES (1); END;");
    await request('/library');await request(`/tracks/${ids[0]}/audio`,'HEAD');await request(`/tracks/${ids[0]}/cover`);
    expect(await db.prepare('SELECT COUNT(*) AS count FROM test_user_inserts').first()).toEqual({count:0});
  });
});
