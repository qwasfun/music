import { Hono } from 'hono';
import { verifyIdentity } from './auth';
import { z } from 'zod';
import { metadataSchema, uploadSchema, playlistSchema, validationError, uploadMime, PART_SIZE, type Track } from '../shared/contracts';
import { validateFlac } from './flac';
import { validateOgg } from './ogg';
import { parseRange } from './range';

type Env = { DB: D1Database; BUCKET: R2Bucket; ASSETS: Fetcher; APP_ORIGIN: string; ACCESS_TEAM_DOMAIN: string; ACCESS_AUD: string; OWNER_EMAIL: string; DEV_AUTH?: string };
type Variables = { userId: string };
export const app = new Hono<{ Bindings: Env; Variables: Variables }>();
class ApiFailure extends Error { constructor(public status: number, public code: string, message: string, public field?: string, public label?: string, public action = '请重试') { super(message); } }
const fail = (status: number, code: string, message: string, field?: string, label?: string, action?: string): never => { throw new ApiFailure(status,code,message,field,label,action); };
app.onError((e,c) => {
  if (e instanceof z.ZodError) return c.json(validationError(e),422);
  if (e instanceof ApiFailure) return c.json({error:{code:e.code,message:e.label?`${e.label}：${e.message}`:e.message,fields:e.field?[{field:e.field,label:e.label||e.field,reason:e.message,action:e.action}]:[]}},e.status as 400);
  if (e instanceof SyntaxError) return c.json({error:{code:'INVALID_JSON',message:'提交内容：格式无效，请刷新页面后重新提交',fields:[{field:'body',label:'提交内容',reason:'JSON 格式无效',action:'请刷新页面后重新提交'}]}},400);
  console.error('Music API request failed', {path:c.req.path,name:e.name});
  return c.json({error:{code:'INTERNAL_ERROR',message:'服务暂时不可用，请稍后重试',fields:[]}},500);
});
app.use('/api/*',async(c,next)=>{
  const host=new URL(c.req.url).hostname;
  let userId: string;
  if(c.env.DEV_AUTH==='local-only' && ['127.0.0.1','localhost'].includes(host)) userId='local-owner';
  else {
    const token=c.req.header('Cf-Access-Jwt-Assertion');
    if(!token || !c.env.OWNER_EMAIL || !c.env.ACCESS_AUD || c.env.ACCESS_AUD==='not-configured') return fail(401,'AUTH_REQUIRED','请登录后访问云端曲库');
    try {
      userId=await verifyIdentity(token,c.env);
    } catch(e) { if(e instanceof ApiFailure) throw e; return fail(401,'AUTH_REQUIRED','登录已过期，请重新登录'); }
  }
  if(!['GET','HEAD','OPTIONS'].includes(c.req.method)) {
    const origin=c.req.header('Origin');
    if(origin && origin!==new URL(c.req.url).origin) return fail(403,'INVALID_ORIGIN','请求来源无效，请从应用页面重新操作');
  }
  c.set('userId',userId);
  c.header('Cache-Control','private, no-store'); c.header('X-Content-Type-Options','nosniff');
  await c.env.DB.prepare('INSERT OR IGNORE INTO users(id) VALUES (?)').bind(userId).run();
  await next();
});
app.get('/api/auth/start',c=>c.redirect('/'));
app.get('/api/me',c=>c.json({id:c.get('userId'),name:'我的音乐'}));
const trackSql='SELECT id,title,artist,album,duration,size,mime,(cover_key IS NOT NULL) AS cover,created_at AS createdAt FROM tracks';
app.get('/api/library',async c=>{
  const uid=c.get('userId');
  const [tracks,playlists,items,favorites]=await c.env.DB.batch<Record<string,unknown>>([
    c.env.DB.prepare(`${trackSql} WHERE user_id=? ORDER BY created_at DESC,id DESC`).bind(uid),
    c.env.DB.prepare('SELECT id,name,version FROM playlists WHERE user_id=? ORDER BY rowid').bind(uid),
    c.env.DB.prepare('SELECT pt.playlist_id,pt.track_id FROM playlist_tracks pt JOIN playlists p ON p.id=pt.playlist_id WHERE p.user_id=? ORDER BY pt.position').bind(uid),
    c.env.DB.prepare('SELECT track_id FROM favorites WHERE user_id=?').bind(uid)
  ]);
  return c.json({user:{id:uid,name:'我的音乐'},tracks:tracks.results.map(t=>({...t,cover:!!t.cover})),playlists:playlists.results.map(p=>({...p,trackIds:items.results.filter(i=>i.playlist_id===p.id).map(i=>i.track_id)})),favorites:favorites.results.map(f=>f.track_id)});
});
async function getTrack(c: any): Promise<any> {
  const t=await c.env.DB.prepare('SELECT * FROM tracks WHERE id=? AND user_id=?').bind(c.req.param('id'),c.get('userId')).first();
  if(!t) return fail(404,'TRACK_NOT_FOUND','歌曲已不存在，请刷新曲库'); return t;
}
app.post('/api/uploads',async c=>{
  const data=uploadSchema.parse(await c.req.json());
  const id=crypto.randomUUID(), key=`audio/${c.get('userId')}/${id}`;
  const upload=await c.env.BUCKET.createMultipartUpload(key,{httpMetadata:{contentType:uploadMime(data.filename)}});
  try { await c.env.DB.prepare('INSERT INTO upload_sessions(id,user_id,r2_upload_id,object_key,metadata) VALUES (?,?,?,?,?)').bind(id,c.get('userId'),upload.uploadId,key,JSON.stringify(data)).run(); }
  catch(e) { await upload.abort(); throw e; }
  return c.json({id,partSize:PART_SIZE},201);
});
async function getUpload(c:any): Promise<any> { const row=await c.env.DB.prepare('SELECT * FROM upload_sessions WHERE id=? AND user_id=?').bind(c.req.param('id'),c.get('userId')).first(); if(!row) return fail(404,'UPLOAD_NOT_FOUND','上传任务不存在或已结束，请重新选择文件','file','音频文件'); return row; }
app.put('/api/uploads/:id/parts/:part',async c=>{
  const row=await getUpload(c), data=JSON.parse(row.metadata), n=Number(c.req.param('part'));
  const count=Math.ceil(data.size/PART_SIZE);
  if(!Number.isInteger(n)||n<1||n>count) return fail(422,'INVALID_PART','分片编号无效，请重新开始上传','file','音频文件');
  const expected=n===count?data.size-PART_SIZE*(count-1):PART_SIZE;
  const contentLength=Number(c.req.header('Content-Length'));
  if(contentLength!==expected) return fail(422,'INVALID_PART_SIZE',`第 ${n} 个分片应为 ${expected} 字节，请重试该分片`,'file','音频文件');
  const body=await c.req.arrayBuffer();
  if(body.byteLength!==expected) return fail(422,'INCOMPLETE_PART','分片上传不完整，请重试','file','音频文件');
  const part=await c.env.BUCKET.resumeMultipartUpload(row.object_key,row.r2_upload_id).uploadPart(n,body);
  await c.env.DB.prepare('INSERT INTO upload_parts(session_id,part_number,etag,size) VALUES (?,?,?,?) ON CONFLICT(session_id,part_number) DO UPDATE SET etag=excluded.etag,size=excluded.size').bind(row.id,n,part.etag,body.byteLength).run();
  return c.json({partNumber:n,etag:part.etag});
});
async function readBytes(bucket:R2Bucket,key:string,offset:number,length:number) { const object=await bucket.get(key,{range:{offset,length}}); if(!object) throw new Error('MISSING_OBJECT'); return new Uint8Array(await object.arrayBuffer()); }
export async function validateAudio(bucket:R2Bucket,key:string,size:number,filename:string):Promise<string> {
  if(filename.toLowerCase().endsWith('.ogg')) {
    try { await validateOgg((offset,length)=>readBytes(bucket,key,offset,length),size); }
    catch(e) { return fail(422,'INVALID_AUDIO',(e as Error).message,'file','音频文件','请重新导出完整的 Vorbis 或 Opus 编码 OGG 文件后上传'); }
    return 'audio/ogg';
  }
  if(filename.toLowerCase().endsWith('.flac')) {
    try { await validateFlac((offset,length)=>readBytes(bucket,key,offset,length),size); }
    catch(e) { return fail(422,'INVALID_AUDIO',(e as Error).message,'file','音频文件','请重新导出有效的 FLAC 文件后上传'); }
    return 'audio/flac';
  }
  const first=await readBytes(bucket,key,0,Math.min(16,size));
  if(filename.toLowerCase().endsWith('.mp3')) {
    let offset=0;
    if(String.fromCharCode(...first.slice(0,3))==='ID3') { if(first.length<10 || [6,7,8,9].some(i=>first[i]>127)) return fail(422,'INVALID_AUDIO','MP3 标签损坏，请重新编码后上传','file','音频文件'); offset=10+((first[6]<<21)|(first[7]<<14)|(first[8]<<7)|first[9])+(first[5]&0x10?10:0); }
    if(offset>=size) return fail(422,'INVALID_AUDIO','MP3 标签长度无效，请重新编码后上传','file','音频文件');
    const bytes=await readBytes(bucket,key,offset,Math.min(4096,size-offset));
    const valid=bytes.some((v,i)=>v===255 && i+3<bytes.length && (bytes[i+1]&0xe0)===0xe0 && (bytes[i+1]&0x18)!==0x08 && (bytes[i+1]&6)!==0 && (bytes[i+2]>>4)>0 && (bytes[i+2]>>4)<15 && (bytes[i+2]&12)!==12);
    if(!valid) return fail(422,'INVALID_AUDIO','未检测到有效 MP3 音频，请重新编码后上传','file','音频文件'); return 'audio/mpeg';
  }
  if(first.length<12 || String.fromCharCode(...first.slice(4,8))!=='ftyp') return fail(422,'INVALID_AUDIO','M4A 容器无效，请转换为 AAC 编码的 M4A 后上传','file','音频文件');
  let offset=0;
  while(offset+8<=size) {
    const bytes=await readBytes(bucket,key,offset,Math.min(16,size-offset)); const view=new DataView(bytes.buffer);
    let boxSize=view.getUint32(0); const type=String.fromCharCode(...bytes.slice(4,8));
    if(boxSize===1) { const large=view.getBigUint64(8); if(large>BigInt(size)) break; boxSize=Number(large); }
    if(boxSize===0) boxSize=size-offset;
    if(boxSize<8 || offset+boxSize>size) break;
    if(type==='moov') { if(boxSize>2*1024*1024) break; const moov=await readBytes(bucket,key,offset,boxSize); const text=new TextDecoder('latin1').decode(moov); if(text.includes('mp4a') && !text.includes('alac')) return 'audio/mp4'; break; }
    offset+=boxSize;
  }
  return fail(422,'UNSUPPORTED_CODEC','仅支持 AAC 编码的 M4A，请转换编码后重新上传','file','音频文件');
}
app.post('/api/uploads/:id/complete',async c=>{
  // A retry after a successful commit returns the already-created track.
  const existing=await c.env.DB.prepare(`${trackSql} WHERE id=? AND user_id=?`).bind(c.req.param('id'),c.get('userId')).first<Track>();
  if(existing) return c.json({...existing,cover:!!existing.cover});
  const row=await getUpload(c), data=JSON.parse(row.metadata);
  const {results:parts}=await c.env.DB.prepare('SELECT part_number,etag,size FROM upload_parts WHERE session_id=? ORDER BY part_number').bind(row.id).all<{part_number:number;etag:string;size:number}>();
  if(parts.length!==Math.ceil(data.size/PART_SIZE)||parts.reduce((s,p)=>s+p.size,0)!==data.size||parts.some((p,i)=>p.part_number!==i+1)) return fail(422,'UPLOAD_INCOMPLETE','仍有分片未上传完成，请重试未完成分片','file','音频文件');
  let object=await c.env.BUCKET.head(row.object_key);
  if(!object) object=await c.env.BUCKET.resumeMultipartUpload(row.object_key,row.r2_upload_id).complete(parts.map(p=>({partNumber:p.part_number,etag:p.etag})));
  if(object.size!==data.size) return fail(422,'UPLOAD_SIZE_MISMATCH','文件大小与提交信息不一致，请重新上传','file','音频文件');
  let mime:string;
  try { mime=await validateAudio(c.env.BUCKET,row.object_key,data.size,data.filename); }
  catch(e) { await c.env.BUCKET.delete(row.object_key); await c.env.DB.prepare('DELETE FROM upload_sessions WHERE id=?').bind(row.id).run(); throw e; }
  await c.env.DB.batch([
    c.env.DB.prepare('INSERT OR IGNORE INTO tracks(id,user_id,title,artist,album,duration,size,mime,object_key) VALUES (?,?,?,?,?,?,?,?,?)').bind(row.id,c.get('userId'),data.title,data.artist,data.album,data.duration,data.size,mime,row.object_key),
    c.env.DB.prepare('DELETE FROM upload_sessions WHERE id=?').bind(row.id)
  ]);
  const track=await c.env.DB.prepare(`${trackSql} WHERE id=?`).bind(row.id).first(); return c.json({...track,cover:false},201);
});
app.delete('/api/uploads/:id',async c=>{ const row=await getUpload(c); try{await c.env.BUCKET.resumeMultipartUpload(row.object_key,row.r2_upload_id).abort();}catch{/* upload may already have completed */} await c.env.BUCKET.delete(row.object_key); await c.env.DB.prepare('DELETE FROM upload_sessions WHERE id=?').bind(row.id).run(); return c.json({ok:true}); });
app.on(['GET','HEAD'],'/api/tracks/:id/audio',async c=>{
  const track=await getTrack(c); const headers=new Headers({'Content-Type':track.mime,'Accept-Ranges':'bytes','ETag':`"${track.id}"`,'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'});
  let range;
  try { range=parseRange(c.req.header('Range')||null,track.size); } catch { headers.set('Content-Range',`bytes */${track.size}`); return new Response(null,{status:416,headers}); }
  headers.set('Content-Length',String(range?range.length:track.size));
  if(range) headers.set('Content-Range',`bytes ${range.offset}-${range.offset+range.length-1}/${track.size}`);
  if(c.req.method==='HEAD') return new Response(null,{status:range?206:200,headers});
  const object=await c.env.BUCKET.get(track.object_key,range?{range}:undefined);
  if(!object) return fail(404,'AUDIO_MISSING','音频文件已不存在，请重新上传');
  return new Response(object.body,{status:range?206:200,headers});
});
app.put('/api/tracks/:id/cover',async c=>{
  const track=await getTrack(c); const size=Number(c.req.header('Content-Length'));
  if(!size||size>1024*1024) return fail(422,'INVALID_COVER_SIZE','请选择不超过 1 MiB 的 JPEG、PNG 或 WebP 图片','cover','专辑封面');
  const body=await c.req.arrayBuffer(); const b=new Uint8Array(body); let mime='';
  if(b[0]===255&&b[1]===216&&b[2]===255)mime='image/jpeg'; else if(b[0]===137&&b[1]===80&&b[2]===78&&b[3]===71)mime='image/png'; else if(String.fromCharCode(...b.slice(0,4))==='RIFF'&&String.fromCharCode(...b.slice(8,12))==='WEBP')mime='image/webp';
  if(!mime)return fail(422,'INVALID_COVER','仅支持 JPEG、PNG 或 WebP，请转换图片格式','cover','专辑封面');
  const key=`cover/${track.user_id}/${track.id}`; await c.env.BUCKET.put(key,body,{httpMetadata:{contentType:mime}}); await c.env.DB.prepare('UPDATE tracks SET cover_key=? WHERE id=?').bind(key,track.id).run();return c.json({ok:true});
});
app.get('/api/tracks/:id/cover',async c=>{const t=await getTrack(c);if(!t.cover_key)return c.notFound();const o=await c.env.BUCKET.get(t.cover_key);if(!o)return c.notFound();return new Response(o.body,{headers:{'Content-Type':o.httpMetadata?.contentType||'image/jpeg','Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'}});});
app.patch('/api/tracks/:id',async c=>{const t=await getTrack(c);const d=metadataSchema.parse(await c.req.json());await c.env.DB.prepare('UPDATE tracks SET title=?,artist=?,album=? WHERE id=?').bind(d.title,d.artist,d.album,t.id).run();return c.json({ok:true});});
app.delete('/api/tracks/:id',async c=>{const t=await getTrack(c);await c.env.BUCKET.delete([t.object_key,...(t.cover_key?[t.cover_key]:[])]);await c.env.DB.batch([c.env.DB.prepare('UPDATE playlists SET version=version+1 WHERE id IN (SELECT playlist_id FROM playlist_tracks WHERE track_id=?)').bind(t.id),c.env.DB.prepare('DELETE FROM tracks WHERE id=?').bind(t.id)]);return c.json({ok:true});});
app.put('/api/favorites/:id',async c=>{await getTrack(c);await c.env.DB.prepare('INSERT OR IGNORE INTO favorites(user_id,track_id) VALUES (?,?)').bind(c.get('userId'),c.req.param('id')).run();return c.json({ok:true});});
app.delete('/api/favorites/:id',async c=>{await c.env.DB.prepare('DELETE FROM favorites WHERE user_id=? AND track_id=?').bind(c.get('userId'),c.req.param('id')).run();return c.json({ok:true});});
app.post('/api/playlists',async c=>{const d=playlistSchema.parse(await c.req.json()),id=crypto.randomUUID();await c.env.DB.prepare('INSERT INTO playlists(id,user_id,name) VALUES (?,?,?)').bind(id,c.get('userId'),d.name).run();return c.json({id,name:d.name,version:1,trackIds:[]},201);});
app.put('/api/playlists/:id',async c=>{
  const d=playlistSchema.extend({version:z.number().int().positive('请刷新歌单后重试'),trackIds:z.array(z.string().uuid('歌曲编号无效，请刷新曲库')).max(5000,'每张歌单最多 5000 首，请拆分歌单')}).parse(await c.req.json());
  const id=c.req.param('id'),uid=c.get('userId');
  if(new Set(d.trackIds).size!==d.trackIds.length)return fail(422,'DUPLICATE_TRACKS','同一首歌曲不能重复加入，请移除重复歌曲','trackIds','歌单歌曲');
  const {results:owned}=await c.env.DB.prepare('SELECT id FROM tracks WHERE user_id=?').bind(uid).all<{id:string}>();const allowed=new Set(owned.map(t=>t.id));
  if(d.trackIds.some(t=>!allowed.has(t)))return fail(422,'UNKNOWN_TRACK','部分歌曲已删除，请刷新曲库后重试','trackIds','歌单歌曲');
  const token=crypto.randomUUID();
  const queries=[c.env.DB.prepare('UPDATE playlists SET name=?,version=version+1,mutation_token=? WHERE id=? AND user_id=? AND version=?').bind(d.name,token,id,uid,d.version),c.env.DB.prepare('DELETE FROM playlist_tracks WHERE playlist_id=? AND EXISTS(SELECT 1 FROM playlists WHERE id=? AND mutation_token=?)').bind(id,id,token)];
  for(let i=0;i<d.trackIds.length;i++)queries.push(c.env.DB.prepare('INSERT INTO playlist_tracks(playlist_id,track_id,position) SELECT ?,?,? WHERE EXISTS(SELECT 1 FROM playlists WHERE id=? AND mutation_token=?)').bind(id,d.trackIds[i],i,id,token));
  const result=await c.env.DB.batch(queries);
  if(!result[0].meta.changes)return fail(409,'PLAYLIST_CONFLICT','歌单已在其他设备修改，请刷新后重试','version','歌单版本','刷新歌单后重新操作');
  return c.json({id,name:d.name,version:d.version+1,trackIds:d.trackIds});
});
app.delete('/api/playlists/:id',async c=>{const d=z.object({version:z.number().int().positive()}).parse(await c.req.json());const r=await c.env.DB.prepare('DELETE FROM playlists WHERE id=? AND user_id=? AND version=?').bind(c.req.param('id'),c.get('userId'),d.version).run();if(!r.meta.changes)return fail(409,'PLAYLIST_CONFLICT','歌单已在其他设备修改，请刷新后重试','version','歌单版本');return c.json({ok:true});});
app.all('/api/*',c=>c.json({error:{code:'NOT_FOUND',message:'请求的接口不存在，请刷新页面',fields:[]}},404));
app.all('*',c=>c.env.ASSETS.fetch(c.req.raw));
export default app;
