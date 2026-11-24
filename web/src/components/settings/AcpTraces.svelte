<script lang="ts">
 // Saved full Antigravity request logs (setting "保存 Antigravity 完整过程"): list, download, clear.
 // They contain course text and stay on this computer.
 import {onMount} from 'svelte';
 import {api,ApiError} from '../../lib/api';

 let {enabled}:{enabled:boolean}=$props();
 let files=$state<{name:string;size:number;at:string}[]>([]),total=$state(0),error=$state(''),confirming=$state(false),busy=$state(false),shown=$state(20);
 const size=(n:number)=>!n?'0 KB':n>=1048576?(n/1048576).toFixed(1)+' MB':Math.max(1,Math.round(n/1024))+' KB';
 const when=(iso:string)=>new Date(iso).toLocaleString('zh-CN',{hour12:false});
 async function load(){try{const r=await api.acpTraces();files=r.files;total=r.totalBytes;error='';}catch(e){error=e instanceof ApiError?e.message:String(e);}}
 async function clear(){busy=true;try{await api.clearAcpTraces();confirming=false;await load();}catch(e){error=e instanceof ApiError?e.message:String(e);}finally{busy=false;}}
 onMount(()=>{load();});
</script>

<section class="card">
 <header>
  <h2>Antigravity 完整日志</h2>
  <p>{enabled?'已开启：':'已关闭：'}每次 Antigravity 请求的完整过程（发送的内容、思考、工具调用与结果、回复、耗时）各存一个文件，用于排查问题。日志含课程内容，只存在本机 <code>data/diagnostics/acp/</code>，不会上传。</p>
 </header>
 {#if error}<p class="error">{error}</p>{/if}
 <div class="row"><span>{files.length} 个文件 · 共 {size(total)}</span>
  <button class="btn btn-quiet" type="button" onclick={load}>刷新</button>
  {#if files.length}
   {#if confirming}<span class="confirm">删除全部 {files.length} 个日志文件？不能撤销。<button class="btn danger" type="button" disabled={busy} onclick={clear}>确定清除</button><button class="btn btn-quiet" type="button" onclick={()=>confirming=false}>取消</button></span>
   {:else}<button class="btn btn-quiet danger-text" type="button" onclick={()=>confirming=true}>清除全部…</button>{/if}
  {/if}
 </div>
 {#if files.length}
  <ul>
   {#each files.slice(0,shown) as f (f.name)}<li><a href={api.acpTraceUrl(f.name)} download>{when(f.at)}</a><span>{size(f.size)}</span></li>{/each}
  </ul>
  {#if files.length>shown}<button class="btn btn-quiet" type="button" onclick={()=>shown+=50}>显示更多（还有 {files.length-shown} 个）</button>{/if}
 {/if}
</section>

<style>
 .card{padding:var(--space-4) var(--space-5);border:1px solid var(--line);border-radius:var(--radius-md);background:var(--bg-surface);display:flex;flex-direction:column;gap:var(--space-2);max-width:1080px;margin-top:var(--space-4);}
 h2{font-size:var(--text-lg);}
 header p{margin:var(--space-1) 0 0;color:var(--fg-muted);font-size:var(--text-sm);}
 code{font-size:var(--text-xs);}
 .row{display:flex;flex-wrap:wrap;align-items:center;gap:var(--space-2);font-size:var(--text-sm);}
 ul{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;max-height:320px;overflow:auto;border:1px solid var(--line);border-radius:var(--radius-sm);}
 li{display:flex;justify-content:space-between;padding:var(--space-1) var(--space-3);border-bottom:1px solid var(--line);font-size:var(--text-sm);}
 li:last-child{border-bottom:0;}
 li span{color:var(--fg-muted);font-size:var(--text-xs);}
 .confirm{display:inline-flex;flex-wrap:wrap;align-items:center;gap:var(--space-2);color:var(--status-failed-fg);font-size:var(--text-xs);}
 .danger{border-color:var(--status-failed-fg);color:var(--status-failed-fg);}
 .danger-text{color:var(--status-failed-fg);}
 .error{color:var(--status-failed-fg);font-size:var(--text-sm);margin:0;}
</style>
