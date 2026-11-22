<script lang="ts">
 // Renders AI text from lib/markdown.ts data (never as HTML). "chat" is the compact
 // Ask style; "doc" is the reading style used for Deep Dive documents.
 // Class citations become links that open the class at that moment.
 import {blocks,type Inline} from '../lib/markdown';
 import {clock} from '../lib/classroom';
 import {courseHref} from '../lib/router.svelte';
 import type {Project} from '../lib/api';

 let {text,project,variant='chat'}:{text:string;project:Project;variant?:'chat'|'doc'}=$props();
 const parsed=$derived(blocks(text));
 const sessionName=(id:string)=>{const s=project.sessions.find(x=>x.id===id);return s?s.type+' · '+s.title:'已删除的课堂';};
</script>

{#snippet parts(list:Inline[])}
 {#each list as p, i (i)}
  {#if p.kind==='text'}{p.text}
  {:else if p.kind==='bold'}<strong>{@render parts(p.parts)}</strong>
  {:else if p.kind==='italic'}<em>{@render parts(p.parts)}</em>
  {:else if p.kind==='code'}<code>{p.text}</code>
  {:else if p.kind==='reference'}<a href={p.href} target="_blank" rel="noopener noreferrer">{p.text}</a>
  {:else if project.sessions.some(s=>s.id===p.sessionId)}<a class="cite" href={courseHref(project.id,'class',encodeURIComponent(p.sessionId)+(p.ms===null?'':'/t/'+p.ms))} title={p.ms===null?'打开这节课':'在课堂中打开这一刻'}>{sessionName(p.sessionId)}{p.ms===null?'':' · '+clock(p.ms)}</a>
  {:else}<span class="cite">{sessionName(p.sessionId)}{p.ms===null?'':' · '+clock(p.ms)}</span>{/if}
 {/each}
{/snippet}

<div class="rich {variant}">
 {#each parsed as b, i (i)}
  {#if b.kind==='heading'}
   {#if variant==='doc'&&b.level<=2}<h2>{@render parts(b.parts)}</h2>
   {:else if variant==='doc'&&b.level===3}<h3>{@render parts(b.parts)}</h3>
   {:else if variant==='doc'}<h4>{@render parts(b.parts)}</h4>
   {:else}<p class="h">{@render parts(b.parts)}</p>{/if}
  {:else if b.kind==='item'}<p class="li" class:ol={b.ordered} style:margin-left={b.depth?'calc(var(--space-4) * '+b.depth+')':null}>{@render parts(b.parts)}</p>
  {:else if b.kind==='quote'}<blockquote>{@render parts(b.parts)}</blockquote>
  {:else if b.kind==='rule'}<hr/>
  {:else if b.kind==='code'}<pre>{b.text}</pre>
  {:else if b.kind==='table'}
   <div class="table"><table>
    <thead><tr>{#each b.head as c, j (j)}<th>{@render parts(c)}</th>{/each}</tr></thead>
    <tbody>{#each b.rows as r, k (k)}<tr>{#each r as c, j (j)}<td>{@render parts(c)}</td>{/each}</tr>{/each}</tbody>
   </table></div>
  {:else}<p>{@render parts(b.parts)}</p>{/if}
 {/each}
</div>

<style>
 .rich{font-size:var(--text-sm);line-height:1.65;overflow-wrap:anywhere;}
 p{margin:0 0 var(--space-2);white-space:pre-wrap;}
 p:last-child{margin-bottom:0;}
 .h{font-weight:var(--weight-bold);margin-top:var(--space-3);}
 .h:first-child{margin-top:0;}
 .li{position:relative;padding-left:var(--space-4);margin-bottom:var(--space-1);}
 .li:not(.ol)::before{content:"•";position:absolute;left:var(--space-1);color:var(--fg-muted);}
 .li.ol{padding-left:var(--space-2);}
 code{font-size:.92em;padding:0 3px;border-radius:3px;background:var(--sand-100);}
 pre{margin:0 0 var(--space-2);padding:var(--space-2);border-radius:var(--radius-sm);background:var(--sand-100);white-space:pre-wrap;font-size:var(--text-xs);}
 a{color:var(--accent);}
 blockquote{margin:0 0 var(--space-2);padding:var(--space-1) var(--space-3);border-left:3px solid var(--line-strong);color:var(--fg-muted);white-space:pre-wrap;font-size:.95em;}
 hr{border:0;border-top:1px solid var(--line);margin:var(--space-3) 0;}
 .table{overflow-x:auto;margin:0 0 var(--space-2);}
 table{border-collapse:collapse;font-size:var(--text-xs);}
 th,td{border:1px solid var(--line);padding:var(--space-1) var(--space-2);text-align:left;vertical-align:top;}
 th{background:var(--sand-100);font-weight:var(--weight-medium);}
 .cite{display:inline-block;padding:0 var(--space-1);border-radius:var(--radius-sm);background:var(--status-running-bg);color:var(--kind-speech);font-size:var(--text-xs);text-decoration:none;white-space:nowrap;}
 a.cite:hover{text-decoration:underline;}

 /* Document style (Deep Dive) */
 .doc{font-size:var(--text-md);line-height:1.8;font-family:var(--font-reading);}
 .doc p{margin-bottom:var(--space-3);}
 .doc h2,.doc h3,.doc h4{font-family:var(--font-ui);line-height:1.4;}
 .doc h2{font-size:var(--text-xl);margin:var(--space-6) 0 var(--space-3);padding-top:var(--space-3);border-top:1px solid var(--line);}
 .doc h2:first-child{margin-top:0;padding-top:0;border-top:0;}
 .doc h3{font-size:var(--text-lg);margin:var(--space-5) 0 var(--space-2);}
 .doc h4{font-size:var(--text-md);margin:var(--space-4) 0 var(--space-2);}
 .doc .li{margin-bottom:var(--space-2);}
 .doc table{font-size:var(--text-sm);font-family:var(--font-ui);}
 .doc pre{font-size:var(--text-sm);}
</style>
