import { z } from 'zod';
export const MAX_FILE = 128 * 1024 * 1024;
export const PART_SIZE = 8 * 1024 * 1024;
export const AUDIO_CACHE = 'afterglow-audio-v1';
export const COVER_CACHE = 'afterglow-covers-v1';
export const metadataSchema = z.object({
  title: z.string().trim().min(1, '不能为空；请填写歌曲名称').max(160, '最多填写 160 个字符'),
  artist: z.string().trim().max(160, '最多填写 160 个字符').default(''),
  album: z.string().trim().max(160, '最多填写 160 个字符').default(''),
});
export const uploadSchema = metadataSchema.extend({
  filename: z.string().min(1, '请选择音频文件').max(255, '文件名最多 255 个字符').regex(/\.(mp3|m4a|flac|ogg)$/i, '仅支持 MP3、AAC 编码的 M4A、FLAC 和 OGG（Vorbis / Opus）；请转换格式后重新上传'),
  size: z.number().int().positive('文件不能为空；请选择有效音频').max(MAX_FILE, `单文件最多 ${MAX_FILE / 1024 ** 2} MiB；请压缩或裁剪后重新上传`),
  duration: z.number().positive('无法读取时长；请选择可播放的音频').max(86400, '音频最长 24 小时'),
  // Optional for older installed clients; the server always hashes the uploaded bytes.
  contentHash: z.string().regex(/^[a-f0-9]{64}$/, '校验信息无效；请重新选择音频文件上传').optional(),
});
export const playlistSchema = z.object({ name: z.string().trim().min(1, '不能为空；请填写歌单名称').max(60, '最多填写 60 个字符') });
export const PLAY_COUNT_BATCH_SIZE = 100;
export const playCountSyncSchema = z.object({
  userId: z.string({error:'账号标识无效；请刷新曲库后重试'}).min(1,'账号标识为空；请重新登录'),
  deviceId: z.uuid({error:'设备标识无效；请刷新页面后重试'}).toLowerCase(),
  counts: z.array(z.object({
    trackId: z.uuid({error:'歌曲编号无效；请刷新曲库后重试'}).toLowerCase(),
    count: z.number({error:'播放次数必须是数字'}).int('播放次数必须是整数').min(1,'播放次数至少为 1').max(1_000_000_000,'播放次数最多为 10 亿'),
  }),{error:'播放记录格式无效；请刷新页面后重试'}).max(PLAY_COUNT_BATCH_SIZE,'每批最多同步 100 首歌曲；请分批重试'),
});
export const labels: Record<string, string> = { title: '歌曲名称', artist: '歌手', album: '专辑', filename: '音频文件', size: '音频文件大小', duration: '音频时长', contentHash: '音频文件', name: '歌单名称', version: '歌单版本', trackIds: '歌单歌曲', file: '音频文件', cover: '专辑封面', capacity: '缓存容量' };
const playCountLabels: Record<string,string>={userId:'曲库账号',deviceId:'播放统计设备',counts:'播放记录'};
export interface FieldError { field: string; label: string; reason: string; action: string }
export interface ApiErrorBody { error: { code: string; message: string; fields: FieldError[] } }
export function validationError(error: z.ZodError): ApiErrorBody {
  const fields = error.issues.map(issue => {
    const [root,index,key]=issue.path;
    let label=labels[String(root)]||playCountLabels[String(root)]||'提交字段';
    if(root==='counts'&&typeof index==='number')label=`第 ${index+1} 条播放记录${key==='trackId'?'的歌曲编号':key==='count'?'的播放次数':''}`;
    return {field:issue.path.map(String).join('.'),label,reason:issue.message,action:'请按提示修改后重试'};
  });
  return { error: { code: 'VALIDATION_ERROR', message: fields.map(f => `${f.label}：${f.reason}`).join('；'), fields } };
}
export interface Track { id: string; title: string; artist: string; album: string; duration: number; size: number; mime: string; cover: boolean; createdAt: string }
export type UploadStartResult = {id:string;partSize:number;duplicate?:false} | {duplicate:true;track:Track};
export type UploadCompleteResult = Track & {duplicate?:boolean};
export interface Playlist { id: string; name: string; version: number; trackIds: string[] }
export interface Library { user: { id: string; name: string }; tracks: Track[]; playlists: Playlist[]; favorites: string[] }
export interface PlayCountSummary {
  totalCount: number;
  trackCounts: Record<string,number>;
  deviceCounts: Record<string,number>;
}
export interface PlayCountSyncResult extends PlayCountSummary {
  ignoredTrackIds: string[];
}
export interface CacheEntry { id: string; size: number; pinned: boolean; lastUsed: number }
export interface DownloadTask { id: string; pinned: boolean; status: 'queued' | 'downloading' | 'error'; error?: string }
export const audioUrl = (id: string) => `/api/tracks/${encodeURIComponent(id)}/audio`;
export const coverUrl = (id: string) => `/api/tracks/${encodeURIComponent(id)}/cover`;
export function uploadMime(filename: string) { const extension=filename.toLowerCase().split('.').pop(); return extension==='ogg'?'audio/ogg':extension==='flac'?'audio/flac':extension==='mp3'?'audio/mpeg':'audio/mp4'; }
export function formatBytes(n: number) { return n >= 1024 ** 3 ? `${(n / 1024 ** 3).toFixed(1)} GB` : `${(n / 1024 ** 2).toFixed(1)} MB`; }
export function formatTime(n: number) { if (!Number.isFinite(n)) return '0:00'; return `${Math.floor(n / 60)}:${String(Math.floor(n % 60)).padStart(2, '0')}`; }
export function evictionPlan(entries: CacheEntry[], incoming: number, limit: number): { remove: string[]; shortage: number } {
  let used = entries.reduce((s, e) => s + e.size, 0);
  const remove: string[] = [];
  for (const e of entries.filter(e => !e.pinned).sort((a,b) => a.lastUsed-b.lastUsed)) { if (used+incoming <= limit) break; used-=e.size; remove.push(e.id); }
  return { remove, shortage: Math.max(0, used+incoming-limit) };
}
