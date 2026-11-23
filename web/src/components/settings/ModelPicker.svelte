<script lang="ts">
 // A dropdown that always opens below its field (a native select opens upwards near the bottom of
 // the window, so long lists jumped up and down). Long lists scroll inside the panel.
 let {id,value,groups,first=null,label,onpick,compact=false,disabled=false}:{
  id?:string;value:string;groups:{label:string;items:[string,string][]}[];first?:[string,string]|null;label:string;
  onpick:(value:string)=>void;compact?:boolean;disabled?:boolean;
 }=$props();
 let open=$state(false),wrap=$state<HTMLElement>(),panel=$state<HTMLElement>();
 const all=$derived([...(first?[first]:[]),...groups.flatMap(g=>g.items)]);
 const current=$derived(all.find(([v])=>v===value)?.[1]??(first&&!value?first[1]:value||'未选择'));
 function pick(v:string){open=false;if(v!==value)onpick(v);}
 function outside(e:MouseEvent){if(open&&wrap&&!wrap.contains(e.target as Node))open=false;}
 // Keep the open panel in view: scroll the page so it is not cut off at the bottom.
 $effect(()=>{if(open&&panel)panel.scrollIntoView({block:'nearest'});});
</script>

<svelte:window onclick={outside} onkeydown={e=>{if(e.key==='Escape')open=false;}}/>

<div class="picker" class:compact bind:this={wrap}>
 <button type="button" class="field" {id} {value} aria-haspopup="listbox" aria-expanded={open} aria-label={label} {disabled} onclick={()=>open=!open}>
  <span class="text">{current}</span><span class="caret" aria-hidden="true">▾</span>
 </button>
 {#if open}
  <div class="panel" role="listbox" aria-label={label} bind:this={panel}>
   {#if first}<button type="button" role="option" aria-selected={value===first[0]} data-value={first[0]} class:on={value===first[0]} onclick={()=>pick(first[0])}>{first[1]}</button>{/if}
   {#each groups as g (g.label)}
    <div class="group">{g.label}</div>
    {#each g.items as [v,t] (v)}<button type="button" role="option" aria-selected={value===v} data-value={v} class:on={value===v} onclick={()=>pick(v)}>{t}</button>{/each}
   {/each}
  </div>
 {/if}
</div>

<style>
 .picker{position:relative;min-width:0;}
 .field{width:100%;height:32px;display:flex;align-items:center;justify-content:space-between;gap:var(--space-2);padding:0 var(--space-2);border:1px solid var(--line-strong);border-radius:var(--radius-sm);background:var(--bg-raised);font-size:var(--text-sm);text-align:left;color:var(--fg);}
 .field:disabled{color:var(--fg-subtle);}
 .text{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
 .caret{flex:none;color:var(--fg-muted);font-size:var(--text-xs);}
 .panel{position:absolute;left:0;right:0;top:calc(100% + 2px);z-index:20;min-width:220px;max-height:320px;overflow:auto;padding:var(--space-1);background:var(--bg-raised);border:1px solid var(--line);border-radius:var(--radius-md);box-shadow:var(--shadow-panel);display:flex;flex-direction:column;}
 .group{padding:var(--space-2) var(--space-2) var(--space-1);font-size:var(--text-xs);color:var(--fg-muted);font-weight:var(--weight-medium);}
 .panel button{padding:var(--space-1) var(--space-3);border:0;border-radius:var(--radius-sm);background:transparent;text-align:left;font-size:var(--text-sm);color:var(--fg);}
 .panel button:hover{background:var(--sand-100);}
 .panel button.on{background:var(--accent-soft);color:var(--accent-strong);font-weight:var(--weight-medium);}
 .compact .field{min-width:0;}
</style>
