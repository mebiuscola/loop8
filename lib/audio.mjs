import {open,mkdir,readdir,copyFile,unlink,stat} from 'node:fs/promises';
import {createReadStream,constants} from 'node:fs';
import {createHash,randomUUID} from 'node:crypto';
import path from 'node:path';
import {originalName,sourcePath,sessionFolder} from './storage.mjs';
export const AUDIO_TYPES={'.mp3':'audio/mpeg','.m4a':'audio/mp4','.wav':'audio/wav','.ogg':'audio/ogg','.webm':'audio/webm','.flac':'audio/flac','.aac':'audio/aac'};
export async function streamHash(file){const hash=createHash('sha256');for await(const part of createReadStream(file))hash.update(part);return hash.digest('hex');}
export function audioLimit(){const mb=Number(process.env.CLASSROOM_AUDIO_LIMIT_MB||2048);if(!Number.isFinite(mb)||mb<1||mb>8192)throw Error('录音上传额度配置无效，应为 1–8192 MB。');return Math.floor(mb*1048576);}
export async function receiveAudio(req,p,session,dir,name,limit=audioLimit()){
 name=originalName(name);const ext=path.extname(name).toLowerCase();if(!AUDIO_TYPES[ext])throw Error('请上传 MP3、M4A、WAV、OGG、WebM、FLAC 或 AAC 录音；具体编码由浏览器检查。');
 const length=Number(req.headers['content-length']);if(Number.isFinite(length)&&length>limit)throw Error(`录音超过当前 ${Math.floor(limit/1048576)} MB 上限。`);
 const temporary=sourcePath(dir,'.audio-upload-'+randomUUID()+'.part');await mkdir(path.dirname(temporary),{recursive:true});let size=0,handle,placed;
 try{
  handle=await open(temporary,'wx');const hash=createHash('sha256');for await(const chunk of req){size+=chunk.length;if(size>limit)throw Error('录音超过上传上限。');hash.update(chunk);await handle.writeFile(chunk);}await handle.close();handle=null;if(req.aborted||!req.complete)throw Error('录音上传中断，请重试。');if(!size)throw Error('不能上传空录音。');
  const sha256=hash.digest('hex');for(const f of p.files.filter(f=>f.role==='audio'&&f.sessionId===session.id&&f.size===size)){try{if(await streamHash(sourcePath(dir,f.stored))===sha256)return {file:f,kind:'reused'};}catch(e){if(e.code!=='ENOENT')throw e;}}
  const folder='Sessions/'+await sessionFolder(p,session,dir),parent=sourcePath(dir,folder);await mkdir(parent,{recursive:true});const names=new Set((await readdir(parent)).map(v=>v.toLowerCase())),extension=path.extname(name),base=name.slice(0,-extension.length);
  for(let n=1;n<10000;n++){const candidate=n===1?name:`${base} (${n})${extension}`;if(names.has(candidate.toLowerCase()))continue;const target=path.join(parent,candidate);try{await copyFile(temporary,target,constants.COPYFILE_EXCL);placed=target;return {file:{id:randomUUID(),name:candidate,originalName:name,role:'audio',sessionId:session.id,stored:folder+'/'+candidate,size,sha256,mime:AUDIO_TYPES[ext],parseStatus:'ready'},kind:candidate===name?'saved':'renamed'};}catch(e){if(e.code==='EEXIST'){names.add(candidate.toLowerCase());continue;}throw e;}}
  throw Error('同名录音过多，请先重命名。');
 }catch(e){if(placed)await unlink(placed).catch(()=>{});throw e;}
 finally{if(handle)await handle.close().catch(()=>{});await unlink(temporary).catch(e=>{if(e.code!=='ENOENT')throw e;});}
}
export function byteRange(value,size){
 if(!value)return null;const m=String(value).match(/^bytes=(\d*)-(\d*)$/);if(!m||!size||!m[1]&&!m[2])throw Error('无效音频读取范围。');let start,end;
 if(!m[1]){const suffix=Number(m[2]);if(!Number.isSafeInteger(suffix)||suffix<=0)throw Error('无效音频读取范围。');start=Math.max(0,size-suffix);end=size-1;}
 else{start=Number(m[1]);end=m[2]?Number(m[2]):size-1;if(!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||start>=size||end<start)throw Error('无效音频读取范围。');end=Math.min(end,size-1);}
 return {start,end};
}
export async function serveAudio(req,res,dir,file,download=false){
 return serveLocalFile(req,res,dir,file,{download,mime:AUDIO_TYPES[path.extname(file.name).toLowerCase()]||'application/octet-stream'});
}
export async function serveLocalFile(req,res,dir,file,{download=false,mime='application/octet-stream'}={}){
 const source=sourcePath(dir,file.stored),info=await stat(source),etag='"'+(file.sha256||file.id)+'-'+info.size+'-'+info.mtimeMs+'"';let range;
 try{range=byteRange(!req.headers['if-range']||req.headers['if-range']===etag?req.headers.range:null,info.size);}catch{res.writeHead(416,{'Content-Range':'bytes */'+info.size,'Accept-Ranges':'bytes'});return res.end();}
 const headers={'Content-Type':mime,'Accept-Ranges':'bytes','Content-Length':range?range.end-range.start+1:info.size,'Cache-Control':'private, no-store','ETag':etag,'X-Content-Type-Options':'nosniff'};if(download||mime==='application/pdf')headers['Content-Disposition']=`${download?'attachment':'inline'}; filename*=UTF-8''${encodeURIComponent(file.name)}`;if(range)headers['Content-Range']=`bytes ${range.start}-${range.end}/${info.size}`;res.writeHead(range?206:200,headers);if(req.method==='HEAD')return res.end();
 const stream=createReadStream(source,range||{});stream.on('error',()=>res.destroy());res.on('close',()=>stream.destroy());stream.pipe(res);
}
