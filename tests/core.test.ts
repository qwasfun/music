import {describe,it,expect,beforeAll} from 'vitest';
import {generateKeyPair,SignJWT} from 'jose';
import {metadataSchema,uploadSchema,validationError,evictionPlan,MAX_FILE,uploadMime} from '../shared/contracts';
import {parseRange} from '../server/range';
import {verifyIdentity} from '../server/auth';

describe('field-specific validation',()=>{
  it('reports each invalid field without reflecting submitted values',()=>{const result=metadataSchema.safeParse({title:'',artist:'secret'.repeat(100),album:''});expect(result.success).toBe(false);if(!result.success){const body=validationError(result.error);expect(body.error.fields.map(f=>f.label)).toEqual(['歌曲名称','歌手']);expect(body.error.message).toContain('歌曲名称：');expect(body.error.message).not.toContain('secret');expect(body.error.fields.every(f=>f.reason&&f.action)).toBe(true);}});
  it.each([{filename:'test.wav',size:100,duration:10,title:'a'},{filename:'a.mp3',size:MAX_FILE+1,duration:10,title:'a'},{filename:'a.m4a',size:100,duration:0,title:'a'}])('rejects unsupported formats, size and unreadable duration',input=>expect(uploadSchema.safeParse(input).success).toBe(false));
  it.each(['music.flac','MUSIC.FLAC'])('accepts FLAC extension %s with correct MIME',filename=>{expect(uploadSchema.safeParse({filename,size:100,duration:10,title:'a'}).success).toBe(true);expect(uploadMime(filename)).toBe('audio/flac');});
});
describe('audio ranges',()=>{
  it.each([['bytes=0-1',{offset:0,length:2}],['bytes=50-',{offset:50,length:50}],['bytes=-12',{offset:88,length:12}],['bytes=90-999',{offset:90,length:10}],['bytes=-1000',{offset:0,length:100}]])('serves %s',(header,expected)=>expect(parseRange(header as string,100)).toEqual(expected));
  it.each(['bytes=100-','bytes=9-3','bytes=0-1,4-9','bytes=-0','items=1-3','bytes=-'])('rejects invalid range %s',header=>expect(()=>parseRange(header,100)).toThrow('INVALID_RANGE'));
});
describe('cache eviction',()=>{
  const entries=[{id:'manual',size:60,pinned:true,lastUsed:0},{id:'old-auto',size:20,pinned:false,lastUsed:1},{id:'new-auto',size:20,pinned:false,lastUsed:2}];
  it('evicts oldest automatic cache first',()=>expect(evictionPlan(entries,20,100)).toEqual({remove:['old-auto'],shortage:0}));
  it('never evicts manually downloaded songs',()=>expect(evictionPlan(entries,60,100)).toEqual({remove:['old-auto','new-auto'],shortage:20}));
  it('does not evict when sufficient space remains',()=>expect(evictionPlan(entries,0,100)).toEqual({remove:[],shortage:0}));
});
describe('Access identity verification',()=>{
  const env={ACCESS_TEAM_DOMAIN:'https://test.cloudflareaccess.com',ACCESS_AUD:'music-audience',OWNER_EMAIL:'owner@example.invalid'};let privateKey:CryptoKey,publicKey:CryptoKey;
  beforeAll(async()=>{({privateKey,publicKey}=await generateKeyPair('RS256'));});
  const token=(claims:Record<string,unknown>={},issuer=env.ACCESS_TEAM_DOMAIN,aud=env.ACCESS_AUD,exp='2h')=>new SignJWT({email:env.OWNER_EMAIL,...claims}).setProtectedHeader({alg:'RS256'}).setSubject('owner-id').setIssuer(issuer).setAudience(aud).setIssuedAt().setExpirationTime(exp).sign(privateKey);
  it('accepts only the configured owner',async()=>expect(await verifyIdentity(await token(),env,async()=>publicKey)).toBe('owner-id'));
  it('rejects a different email',async()=>expect(verifyIdentity(await token({email:'other@example.invalid'}),env,async()=>publicKey)).rejects.toThrow('OWNER_MISMATCH'));
  it('rejects wrong audience',async()=>expect(verifyIdentity(await token({},env.ACCESS_TEAM_DOMAIN,'other'),env,async()=>publicKey)).rejects.toThrow());
  it('rejects wrong issuer',async()=>expect(verifyIdentity(await token({},'https://fake.invalid'),env,async()=>publicKey)).rejects.toThrow());
  it('rejects expired tokens',async()=>expect(verifyIdentity(await token({},env.ACCESS_TEAM_DOMAIN,env.ACCESS_AUD,'-1s'),env,async()=>publicKey)).rejects.toThrow());
  it('rejects unsigned or forged tokens',async()=>expect(verifyIdentity('fake.token.value',env,async()=>publicKey)).rejects.toThrow());
});
