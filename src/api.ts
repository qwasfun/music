import type { ApiErrorBody } from '../shared/contracts';
export class RequestError extends Error { constructor(message:string,public status:number,public body?:ApiErrorBody){super(message);} }
export async function api<T=any>(path:string,init:RequestInit={}):Promise<T> {
  const headers=new Headers(init.headers); if(init.body && typeof init.body==='string')headers.set('Content-Type','application/json');
  let response:Response;
  try { response=await fetch(`/api${path}`,{...init,headers,redirect:'manual',cache:'no-store'}); }
  catch { throw new RequestError(navigator.onLine?'无法连接云端曲库，请检查网络后重试':'当前处于离线状态，请联网后操作',0); }
  if(response.type==='opaqueredirect'||response.status===401||(response.status===403&&!response.headers.get('Content-Type')?.includes('application/json')))throw new RequestError('登录已过期，请点击「登录曲库」重新登录；已缓存音乐仍可离线播放',401);
  if(!response.ok){let body:ApiErrorBody|undefined;try{body=await response.json();}catch{}throw new RequestError(body?.error?.fields?.length?body.error.fields.map(f=>`${f.label}：${f.reason}${f.action && !f.reason.includes('请')?`，${f.action}`:''}`).join('；'):body?.error?.message||`操作未完成（${response.status}），请稍后重试`,response.status,body);}
  if(!response.headers.get('Content-Type')?.includes('application/json'))throw new RequestError('登录状态已失效，请重新登录曲库',401);
  return response.json();
}
