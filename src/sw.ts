/// <reference lib="webworker" />
import {clientsClaim} from 'workbox-core';
import {precacheAndRoute,cleanupOutdatedCaches,createHandlerBoundToURL} from 'workbox-precaching';
import {registerRoute,NavigationRoute} from 'workbox-routing';
import {createPartialResponse} from 'workbox-range-requests';
declare const self:ServiceWorkerGlobalScope & {__WB_MANIFEST:unknown[]};
clientsClaim();
precacheAndRoute(self.__WB_MANIFEST as any);cleanupOutdatedCaches();
registerRoute(new NavigationRoute(createHandlerBoundToURL('/index.html'),{denylist:[/^\/api(?:\/|$)/,/^\/cdn-cgi\//]}));
registerRoute(({url})=>url.origin===self.location.origin&&/^\/api\/tracks\/[^/]+\/audio$/.test(url.pathname),async({request})=>{
  if(request.headers.has('X-Music-Download'))return fetch(request);
  const cached=await(await caches.open('afterglow-audio-v1')).match(request.url);
  if(cached){if(request.headers.has('range'))return createPartialResponse(request,cached);return cached;}
  return fetch(request);
});
registerRoute(({url})=>url.origin===self.location.origin&&/^\/api\/tracks\/[^/]+\/audio$/.test(url.pathname),async({request})=>{const cached=await(await caches.open('afterglow-audio-v1')).match(request.url);if(cached)return new Response(null,{status:200,headers:cached.headers});return fetch(request);},'HEAD');
registerRoute(({url})=>url.origin===self.location.origin&&/^\/api\/tracks\/[^/]+\/cover$/.test(url.pathname),async({request})=>{const cache=await caches.open('afterglow-covers-v1');const hit=await cache.match(request);if(hit)return hit;const r=await fetch(request,{redirect:'manual'});if(r.ok&&r.headers.get('Content-Type')?.startsWith('image/'))await cache.put(request,r.clone());return r;});
self.addEventListener('message',event=>{if(event.data?.type==='SKIP_WAITING')void self.skipWaiting();});
