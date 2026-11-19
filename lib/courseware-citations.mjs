// Reading coordinates remain in the normalized source records. Teaching prose
// uses readable source names and pages, never storage UUIDs or block IDs.
const uuid='[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}';
const sourceId=new RegExp('^Source\\s+('+uuid+')(?::b\\d+(?:-b?\\d+)?)?(?=\\s|\\||$)','i');
const blockId=new RegExp('^Block\\s+('+uuid+')(?::b\\d+(?:-b?\\d+)?)?(?=\\s|\\||$)','i');
const marker=/\[(?:Source|Block)\s+[^\]\r\n]+\]/gi;
export function coursewareSourceName(name){
 return String(name).split(/[\\/]/).at(-1).replace(/\.(?:pdf|pptx?)$/i,'')
  .replace(/(?:_\d{2,4}){6}$/,'').replace(/[\[\]\r\n]/g,' ').trim();
}
export function compactCoursewareCitations(text,files=[]){
 const names=new Map(files.map(f=>[f.id?.toLowerCase(),f.name]));
 return text.replace(marker,all=>{
  const body=all.slice(1,-1),match=body.match(sourceId)||body.match(blockId);
  if(!match)return all; // Ordinary scholarly citations and source text survive.
  const fields=body.split('|').map(s=>s.trim());
  const suppliedName=fields.slice(1).find(s=>!/^(?:Block\b|Reading page\b|PPT (?:parser page|slide)\b|BB page\b|part\b|manual import\b)/i.test(s));
  const name=coursewareSourceName(names.get(match[1].toLowerCase())||suppliedName||'来源待核对');
  const page=body.match(/(?:Reading page|PPT parser page|PPT slide|BB page)\s+(\d+(?:\s*[-–]\s*\d+)?|unavailable)\b/i)?.[1];
  const coordinate=page?(page==='unavailable'?' · 页码未提供':' · 第 '+page.replace(/\s/g,'')+' 页'):'';
  return '〔'+name+coordinate+'〕';
 });
}
export function compactCoursewareGuide(markdown,files=[]){
 let explanation=false;
 return markdown.split('\n').map(line=>{
  if(/^## .+ · (?:第\s*(?:\d+|未知)\s*页|解析页\s*\d+)\s*$/.test(line))explanation=false;
  if(/^###\s+正文双语翻译\s*$/.test(line))explanation=false;
  if(/^###\s+本页细读\s*$/.test(line))explanation=true;
  return explanation?compactCoursewareCitations(line,files):line;
 }).join('\n');
}
