// A small, safe Markdown reader for AI answers: it returns plain data that
// components render as elements, so no model text is ever inserted as HTML.

export type Inline=
 |{kind:'text';text:string}
 |{kind:'bold';text:string}
 |{kind:'code';text:string}
 /** A reading passage page served by the backend (docs/API.md "reading-reference"). */
 |{kind:'reference';text:string;href:string}
 /** A class, or a moment in it, from the evidence marker "[Session <id> | … | SRT hh:mm:ss,mmm …]". */
 |{kind:'class';sessionId:string;ms:number|null};

export type Block=
 |{kind:'heading';level:number;parts:Inline[]}
 |{kind:'item';ordered:boolean;parts:Inline[]}
 |{kind:'paragraph';parts:Inline[]}
 |{kind:'code';text:string}
 |{kind:'table';head:Inline[][];rows:Inline[][][]};

const REFERENCE=/\[([^\]\n]+)\]\((\/api\/projects\/[^/\s)]+\/reading-reference\?ref=[A-Za-z0-9_-]+)\)/;
const SESSION=/\[Session ([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(?:[^\]\n]*?SRT (\d{2,}):(\d{2}):(\d{2})[,.](\d{3}))?[^\]\n]*\]/;
const BOLD=/\*\*([^*\n]+)\*\*/;
const CODE=/`([^`\n]+)`/;

/** Splits text into plain, bold, code and the two kinds of link, earliest match first. */
export function inline(text:string):Inline[]{
 const out:Inline[]=[];
 let rest=text;
 while(rest){
  const found=[
   {re:REFERENCE,m:rest.match(REFERENCE)},{re:SESSION,m:rest.match(SESSION)},
   {re:BOLD,m:rest.match(BOLD)},{re:CODE,m:rest.match(CODE)},
  ].filter(x=>x.m).sort((a,b)=>a.m!.index!-b.m!.index!)[0];
  if(!found){out.push({kind:'text',text:rest});break;}
  const m=found.m!;
  if(m.index)out.push({kind:'text',text:rest.slice(0,m.index)});
  if(found.re===REFERENCE)out.push({kind:'reference',text:m[1],href:m[2]});
  else if(found.re===SESSION)out.push({kind:'class',sessionId:m[1],ms:m[2]===undefined?null:((+m[2]*60+ +m[3])*60+ +m[4])*1000+ +m[5]});
  else if(found.re===BOLD)out.push({kind:'bold',text:m[1]});
  else out.push({kind:'code',text:m[1]});
  rest=rest.slice(m.index!+m[0].length);
 }
 return out;
}

const TABLE_ROW=/^\s*\|.*\|\s*$/;
const SEPARATOR=/^:?-+:?$/;
const cells=(line:string)=>line.trim().replace(/^\|/,'').replace(/\|$/,'').split('|').map(c=>c.trim());

export function blocks(text:string):Block[]{
 const out:Block[]=[];
 let code:string[]|null=null,para:string[]=[],table:string[]=[];
 const flushPara=()=>{if(para.length){out.push({kind:'paragraph',parts:inline(para.join('\n'))});para=[];}};
 // A table needs a header row and a "---" separator row; otherwise its lines stay text.
 const flushTable=()=>{
  if(!table.length)return;
  const rows=table.map(cells);
  if(rows.length>1&&rows[1].every(c=>SEPARATOR.test(c)))out.push({kind:'table',head:rows[0].map(inline),rows:rows.slice(2).map(r=>r.map(inline))});
  else out.push({kind:'paragraph',parts:inline(table.join('\n'))});
  table=[];
 };
 const flush=()=>{flushPara();flushTable();};
 for(const line of text.replace(/\r\n/g,'\n').split('\n')){
  if(line.trimStart().startsWith('```')){
   if(code){out.push({kind:'code',text:code.join('\n')});code=null;}else{flush();code=[];}
   continue;
  }
  if(code){code.push(line);continue;}
  if(TABLE_ROW.test(line)){flushPara();table.push(line);continue;}
  flushTable();
  let m;
  if(!line.trim()){flushPara();continue;}
  if((m=line.match(/^(#{1,6})\s+(.+)$/))){flushPara();out.push({kind:'heading',level:m[1].length,parts:inline(m[2])});continue;}
  if((m=line.match(/^\s*(?:[-*•]|(\d+)[.)])\s+(.+)$/))){flushPara();out.push({kind:'item',ordered:!!m[1],parts:inline((m[1]?m[1]+'. ':'')+m[2])});continue;}
  para.push(line);
 }
 if(code)out.push({kind:'code',text:code.join('\n')});
 flush();
 return out;
}
