import test from 'node:test';
import assert from 'node:assert/strict';
import {deflateRawSync} from 'node:zlib';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {mineruCloud} from '../lib/mineru-cloud.mjs';
import {zipTextEntries} from '../lib/zip.mjs';
import {documentText} from '../lib/materials.mjs';
function zip(entries){const locals=[],central=[];let offset=0;for(const [filename,text] of entries){const name=Buffer.from(filename),bytes=Buffer.from(text),data=deflateRawSync(bytes),l=Buffer.alloc(30),c=Buffer.alloc(46);l.writeUInt32LE(0x04034b50);l.writeUInt16LE(8,8);l.writeUInt32LE(data.length,18);l.writeUInt32LE(bytes.length,22);l.writeUInt16LE(name.length,26);c.writeUInt32LE(0x02014b50);c.writeUInt16LE(8,10);c.writeUInt32LE(data.length,20);c.writeUInt32LE(bytes.length,24);c.writeUInt16LE(name.length,28);c.writeUInt32LE(offset,42);locals.push(l,name,data);central.push(c,name);offset+=l.length+name.length+data.length;}const directory=Buffer.concat(central),end=Buffer.alloc(22);end.writeUInt32LE(0x06054b50);end.writeUInt16LE(entries.length,8);end.writeUInt16LE(entries.length,10);end.writeUInt32LE(directory.length,12);end.writeUInt32LE(offset,16);return Buffer.concat([...locals,directory,end]);}
test('official MinerU API: signed PUT, polling, ZIP, page coordinates, no token forwarded to storage',async()=>{
 const dir=await mkdtemp(path.join(os.tmpdir(),'classroom-mineru-')),input=path.join(dir,'reading.pdf');await writeFile(input,'original');let polls=0;const progress=[],requests=[];
 const archive=zip([['full.md','# Original reading\nRare block content remains.'],['sample_content_list.json',JSON.stringify([{type:'text',page_idx:2,text:'Page three evidence.'}])],['images/unused.png','unused']]);
 const fake=async(url,options={})=>{url=String(url);requests.push({url,...options});if(url.endsWith('/file-urls/batch')){assert.equal(options.headers.Authorization,'Bearer token');assert.equal(JSON.parse(options.body).files[0].name,'reading.pdf');return Response.json({code:0,data:{batch_id:'batch',file_urls:['https://storage.example/upload']}});}if(url==='https://storage.example/upload'){assert.equal(options.method,'PUT');assert.equal(options.headers,undefined);return new Response('',{status:200});}if(url.includes('/extract-results/batch/'))return Response.json({code:0,data:{extract_result:[++polls<2?{state:'running',extract_progress:{extracted_pages:1,total_pages:3}}:{state:'done',full_zip_url:'https://cdn.example/output.zip'}]}});if(url==='https://cdn.example/output.zip'){assert.equal(options.headers,undefined);return new Response(archive);}throw Error('Unexpected request '+url);};
 try{const doc=await mineruCloud({mineruToken:'token',mineruModel:'vlm',mineruLanguage:'en'},input,async p=>progress.push(p),{fetch:fake,sleep:async()=>{}});const text=documentText(doc);assert(!text.includes('Rare block content remains'));assert.match(text,/Reading page 3/);assert.equal(doc.blocks.length,1);assert.equal(polls,2);assert(progress.some(p=>p.includes('1\/3')));assert.equal(requests.length,5);
  await assert.rejects(()=>mineruCloud({mineruToken:''},input),/Token/);
  await assert.rejects(()=>mineruCloud({mineruToken:'bad'},input,undefined,{fetch:async()=>Response.json({code:'A0202'})}),/A0202/);
 }finally{await rm(dir,{recursive:true,force:true});}
});
test('ZIP reader refuses malformed archives and oversized selected entries',()=>{
 assert.throws(()=>zipTextEntries(Buffer.from('invalid')),/ZIP/);
 const bytes=zip([['../full.md','Safe in-memory content']]);assert.equal(zipTextEntries(bytes)[0].text,'Safe in-memory content');
 const central=bytes.indexOf(Buffer.from([0x50,0x4b,0x01,0x02]));bytes.writeUInt32LE(50*1024*1024,central+24);assert.throws(()=>zipTextEntries(bytes),/过大/);
});
