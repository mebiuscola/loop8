import {blockText} from './materials.mjs';
export function bodyParagraphs(page){
 const blocks=page.blocks.filter(b=>page.externalInspection?b.evidenceKind==='original'&&!['footer','page_number','decoration'].includes(b.originalRole):['text','heading','equation','table','list','code'].includes(b.type));
 return blocks.flatMap(b=>(b.originalText??blockText(b)).split(/\n\s*\n/).filter(s=>s.trim()).map(text=>text.trim()));
}
export function readingMarkdown(pages,title){return `# ${title} · PPT 逐页导读\n\n`+pages.map(p=>`## ${p.source} · 第 ${p.pageIndex===null?'未知':p.pageIndex+1} 页\n\n### 正文双语翻译\n\n${p.paragraphs.map(s=>s.english+'\n\n'+s.chinese).join('\n\n')}\n\n### 本页细读\n\n${p.closeReading}`).join('\n\n');}
// Recover only explicit, uniquely identified page sections. No model call or guessed alignment.
export function legacyReading(markdown,files){
 const headings=[...markdown.matchAll(/^## (.+?) · (?:解析页|第)\s*(\d+)(?:\s*页)?\s*$/gm)],pages=[],seen=new Set();
 for(let i=0;i<headings.length;i++){
  const m=headings[i],text=markdown.slice(m.index+m[0].length,headings[i+1]?.index??markdown.length),marker=text.match(/^> Source ([^;\s]+);/m),candidates=files.filter(f=>f.name===m[1]&&(!marker||f.id===marker[1]));if(candidates.length!==1)continue;const source=candidates[0],pageIndex=Number(m[2])-1,k=source.id+':'+pageIndex;if(seen.has(k))return null;seen.add(k);
  const sections=[...text.matchAll(/^### ([^\r\n]+)\s*$/gm)],pick=pattern=>{const i=sections.findIndex(h=>pattern.test(h[1]));return i<0?'':text.slice(sections[i].index+sections[i][0].length,sections[i+1]?.index??text.length).replace(/^\[Block [^\r\n]+\]\s*$/gm,'').trim();};
  const english=pick(/^(原文\s*\/\s*Original|Original\s*\/\s*原文|原文|Original)$/i),chinese=pick(/^(中文翻译|Chinese translation|Translation\s*\/\s*翻译)$/i),closeReading=pick(/^(Explanation\s*\/\s*解释|解释\s*\/\s*Explanation|本页细读)$/i);
  if(!english||!chinese)continue;pages.push({sourceId:source.id,source:source.name,pageIndex,paragraphs:[{english,chinese}],closeReading,legacy:true});
 }
 return pages.length?{schema:'classroom.reader.v1',legacy:true,pages}:null;
}
