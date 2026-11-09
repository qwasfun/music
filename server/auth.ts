import {createRemoteJWKSet,jwtVerify,type JWTVerifyGetKey} from 'jose';
interface AuthEnv {ACCESS_TEAM_DOMAIN:string;ACCESS_AUD:string;OWNER_EMAIL:string}
const keys=new Map<string,ReturnType<typeof createRemoteJWKSet>>();
export async function verifyIdentity(token:string,env:AuthEnv,resolver?:JWTVerifyGetKey){
  if(!env.ACCESS_AUD||env.ACCESS_AUD==='not-configured'||!env.OWNER_EMAIL)throw new Error('AUTH_NOT_CONFIGURED');
  if(!resolver){if(!keys.has(env.ACCESS_TEAM_DOMAIN))keys.set(env.ACCESS_TEAM_DOMAIN,createRemoteJWKSet(new URL(`${env.ACCESS_TEAM_DOMAIN}/cdn-cgi/access/certs`)));resolver=keys.get(env.ACCESS_TEAM_DOMAIN)!;}
  const {payload}=await jwtVerify(token,resolver,{issuer:env.ACCESS_TEAM_DOMAIN,audience:env.ACCESS_AUD,algorithms:['RS256'],requiredClaims:['sub','email','exp','iat']});
  if(typeof payload.sub!=='string'||typeof payload.email!=='string'||payload.email.toLowerCase()!==env.OWNER_EMAIL.toLowerCase())throw new Error('OWNER_MISMATCH');
  return payload.sub;
}
