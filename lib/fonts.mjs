import {readFile,readdir,lstat,open} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {createHash} from 'node:crypto';
import {zipEntries} from './zip.mjs';
const key=s=>s.trim().toLowerCase();
const decode=s=>s.replace(/&(?:amp|quot|apos|lt|gt);/g,m=>({'&amp;':'&','&quot;':'"','&apos;':"'",'&lt;':'<','&gt;':'>'}[m]));
export function presentationFonts(bytes){const names=new Set();for(const p of zipEntries(bytes,n=>/^ppt\/.*\.xml$/i.test(n)))for(const m of p.bytes.toString('utf8').matchAll(/<(?:[\w.-]+:)?(?:latin|ea|cs)\b[^>]*\btypeface\s*=\s*["']([^"']+)["']/g)){const name=decode(m[1]).trim();if(name&&!name.startsWith('+')&&name.length<=160)names.add(name);}return [...names];}
async function table(handle,offset,length){if(length>1024*1024)throw Error('字体表过大。');const b=Buffer.alloc(length);if((await handle.read(b,0,length,offset)).bytesRead!==length)throw Error('字体不完整。');return b;}
export async function fontInfo(file){
 const h=await open(file,'r');try{
  const head=await table(h,0,12),count=head.readUInt16BE(4);if(count>256)throw Error('不支持此字体容器。');
  const dirs=await table(h,12,count*16),tables=new Map();for(let i=0;i<count;i++){const at=i*16;tables.set(dirs.toString('ascii',at,at+4),[dirs.readUInt32BE(at+8),dirs.readUInt32BE(at+12)]);}
  if(!tables.has('name'))return null;const b=await table(h,...tables.get('name')),n=b.readUInt16BE(2),start=b.readUInt16BE(4),names=new Map();
  for(let i=0;i<n;i++){const at=6+i*12;if(at+12>b.length)break;const platform=b.readUInt16BE(at),lang=b.readUInt16BE(at+4),id=b.readUInt16BE(at+6),len=b.readUInt16BE(at+8),off=start+b.readUInt16BE(at+10);if(![1,2,4,16,17].includes(id)||off+len>b.length||![0,3].includes(platform))continue;const text=Buffer.from(b.subarray(off,off+len)).swap16().toString('utf16le');if(!names.has(id)||lang===1033)names.set(id,text);}
  let family=names.get(1)||names.get(16),style=names.get(2)||names.get(17)||'';if(!family)return null;
  let weight=/bold/i.test(style)?700:400,italic=/italic|oblique/i.test(style);if(tables.has('OS/2')){const os=await table(h,...tables.get('OS/2'));if(os.length>=6)weight=os.readUInt16BE(4);if(os.length>=64)italic=!!(os.readUInt16BE(62)&1);}
  return {family,style,weight:String(weight),fontStyle:italic?'italic':'normal',fullName:names.get(4)};
 }finally{await h.close();}
}
export function localFontService({roots}={}){
 const local=process.env.LOCALAPPDATA||'',win=process.env.WINDIR||'C:/Windows';
 roots??=[path.join(win,'Fonts'),path.join(local,'Microsoft/Windows/Fonts'),path.join(local,'Microsoft/FontCache'),path.join(os.homedir(),'AppData/Local/Microsoft/FontCache'),path.join(os.homedir(),'AppData/Local/Microsoft/Windows/Fonts'),path.join(process.env.ProgramFiles||'C:/Program Files','Microsoft Office/root/vfs/Fonts/private')];
 let inventory=null,expires=0,pending=null,version=0;const files=new Map();
 // Fingerprints per presentation (the same bytes object while the original is unchanged), for this font list.
 const prints=new WeakMap();
 // The font list is read once and then refreshed in the background every 5 minutes: a slide image
 // never waits for a new scan of the font folders (up to 6000 files) once a list exists.
 async function scan(){
  if(inventory&&Date.now()>=expires&&!pending)rescan().catch(()=>{expires=Date.now()+300000;});
  if(inventory)return inventory;
  return pending||rescan();
 }
 function rescan(){if(pending)return pending;pending=(async()=>{
  const list=[];let visited=0;async function walk(dir,depth=0){if(depth>7||visited>6000)return;let entries;try{if((await lstat(dir)).isSymbolicLink())return;entries=await readdir(dir,{withFileTypes:true});}catch(e){if(['ENOENT','EACCES','EPERM'].includes(e.code))return;throw e;}
   for(const e of entries){if(++visited>6000)break;if(e.isSymbolicLink())continue;const file=path.join(dir,e.name);if(e.isDirectory())await walk(file,depth+1);else if(/\.(ttf|otf)$/i.test(e.name))try{const info=await fontInfo(file);if(info){const id=createHash('sha256').update(file).digest('hex');files.set(id,file);list.push({...info,id});}}catch{/* Unsupported font containers are not exposed. */}}
  }for(const root of roots)await walk(root);inventory=list;expires=Date.now()+300000;version++;return list;
 })().finally(()=>pending=null);return pending;}
 return {
  async fingerprint(bytes,pptx=true){
   const all=await scan(),memo=prints.get(bytes);if(memo?.version===version&&memo.pptx===pptx&&memo.all===all)return memo.value;
   const value=await this.computeFingerprint(bytes,pptx);prints.set(bytes,{version,pptx,all,value});return value;
  },
  async computeFingerprint(bytes,pptx=true){const manifest=await this.manifest(pptx?presentationFonts(bytes):['Arial','Times New Roman','Calibri']);const faces=await Promise.all(manifest.faces.map(async face=>{const s=await lstat(files.get(face.id));return {...face,size:s.size,mtime:s.mtimeMs};}));return createHash('sha256').update(JSON.stringify({faces,missing:manifest.missing})).digest('hex');},
  async manifest(names){const all=await scan(),faces=[],missing=[];for(const name of names){const matches=all.filter(f=>key(f.family)===key(name));if(!matches.length){missing.push(name);continue;}const seen=new Set();for(const f of matches){const style=f.weight+'/'+f.fontStyle;if(seen.has(style))continue;seen.add(style);faces.push({family:name,id:f.id,descriptors:{weight:f.weight,style:f.fontStyle}});}}return {faces,missing};},
  async bytes(id){if(!/^[a-f0-9]{64}$/.test(id)||!files.has(id))throw Error('字体不存在，请重新加载课件。');const file=files.get(id),info=await lstat(file);if(info.isSymbolicLink()||!info.isFile()||info.size>32*1024*1024)throw Error('字体文件不可用。');return readFile(file);}
 };
}
