import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {listenSafe,UNSAFE_PORTS} from '../lib/ports.mjs';

test('a random port that browsers refuse is drawn again',async()=>{
 // A server whose first random port is a refused one (as the system sometimes hands out here).
 const server=http.createServer((req,res)=>res.end('ok')),realAddress=server.address.bind(server);let draws=0;
 server.address=()=>{const a=realAddress();return draws===1&&a?{...a,port:6000}:a;};
 const listen=server.listen.bind(server);server.listen=(...args)=>{draws++;return listen(...args);};
 try{
  const port=await listenSafe(server);
  assert.equal(draws,2,'the refused port was given back and another one drawn');
  assert(!UNSAFE_PORTS.has(port));
  assert.equal(await (await fetch('http://127.0.0.1:'+port+'/')).text(),'ok','the new port works with fetch');
 }finally{await new Promise(r=>server.close(r));}
 assert(UNSAFE_PORTS.has(6000)&&UNSAFE_PORTS.has(5060)&&!UNSAFE_PORTS.has(4317));
});
