import {inflateRawSync} from 'node:zlib';
// Read selected text entries in memory. Never extract provider-controlled paths.
export function zipEntries(buffer,select=()=>true,maxBytes=40*1024*1024){
 let end=-1;for(let i=buffer.length-22;i>=Math.max(0,buffer.length-65557);i--)if(buffer.readUInt32LE(i)===0x06054b50){end=i;break;}
 if(end<0)throw Error('MinerU 返回的文件不是有效 ZIP。');
 const count=buffer.readUInt16LE(end+10);let offset=buffer.readUInt32LE(end+16);
 if(count===65535||offset===0xffffffff)throw Error('暂不支持 ZIP64；请手动导入 Markdown。');
 const result=[];
 for(let i=0;i<count;i++){
  if(offset+46>buffer.length||buffer.readUInt32LE(offset)!==0x02014b50)throw Error('ZIP 目录损坏。');
  const flags=buffer.readUInt16LE(offset+8),method=buffer.readUInt16LE(offset+10),compressed=buffer.readUInt32LE(offset+20),size=buffer.readUInt32LE(offset+24),nl=buffer.readUInt16LE(offset+28),extra=buffer.readUInt16LE(offset+30),comment=buffer.readUInt16LE(offset+32),local=buffer.readUInt32LE(offset+42),name=buffer.toString('utf8',offset+46,offset+46+nl);
  offset+=46+nl+extra+comment;
  if(!select(name))continue;
  if(size>maxBytes||result.reduce((n,v)=>n+v.bytes.length,0)>80*1024*1024)throw Error('解析资源过大，请拆分材料或手动导入。');
  if(flags&1||![0,8].includes(method))throw Error('不支持加密 ZIP 或此压缩方式。');
  if(local+30>buffer.length||buffer.readUInt32LE(local)!==0x04034b50)throw Error('ZIP 数据损坏。');
  const start=local+30+buffer.readUInt16LE(local+26)+buffer.readUInt16LE(local+28);if(start+compressed>buffer.length)throw Error('ZIP 文件不完整。');
  const bytes=buffer.subarray(start,start+compressed),plain=method===8?inflateRawSync(bytes,{maxOutputLength:maxBytes}):bytes;if(plain.length!==size)throw Error('ZIP 内容长度校验失败。');
  result.push({name,bytes:plain});
 }
 return result;
}
export function zipTextEntries(buffer){return zipEntries(buffer,name=>/(?:\.md|content_list\.json)$/i.test(name)).map(e=>({name:e.name,text:e.bytes.toString('utf8')}));}
