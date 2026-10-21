// The existing real pipeline, with explicitly mocked I/O for local SQL
// contract tests. Never a replacement implementation or real upload proof.
import assert from 'node:assert/strict';
import {loadSyncLogic} from '../helpers/loadLubricationLogic.js';
export const DUMMY_IMAGE='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aN1sAAAAASUVORK5CYII=';
export async function mockedPipelinePayload(store,input){
 const row=structuredClone(input),before=structuredClone(row),requests=[],localWrites=[];
 const originalFetch=globalThis.fetch;
 globalThis.fetch=async(url,options)=>{
  assert(String(url).startsWith('http://127.0.0.1:55321/storage/v1/object/engrase-photos/'+store+'/'));
  assert.equal(options.method,'POST');assert(options.body instanceof Blob);
  requests.push({pathname:new URL(url).pathname,bytes:options.body.size,mime:options.body.type});
  return new Response('{}',{status:200,headers:{'content-type':'application/json'}});
 };
 try{
  const {Sync}=loadSyncLogic({put:async(s,value)=>localWrites.push({store:s,row:structuredClone(value)})},[store]);
  const uploaded=await Sync.uploadPhotoIfNeeded(store,row,{url:'http://127.0.0.1:55321',anonKey:'offline-fixture-only'});
  const payload=Sync.stripLocalAuthorizationMetadata(uploaded);
  return {before,localAfter:row,uploadReturn:uploaded,payload,requests,localWrites};
 }finally{globalThis.fetch=originalFetch;}
}
