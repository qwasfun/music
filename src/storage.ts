import { openDB } from 'idb';
export const dbPromise = openDB('afterglow-local',1,{upgrade(db){db.createObjectStore('kv');db.createObjectStore('entries',{keyPath:'id'});db.createObjectStore('tasks',{keyPath:'id'});}});
export async function readLocal<T>(key:string):Promise<T|undefined>{return(await dbPromise).get('kv',key);}
export async function writeLocal(key:string,value:unknown){return(await dbPromise).put('kv',value,key);}
