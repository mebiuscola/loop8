<script lang="ts" module>
 export interface Field{key:string;label:string;type:'text'|'number'|'password'|'checkbox'|'select';hint?:string;min?:number;max?:number;choices?:[string,string][];placeholder?:string;}
</script>

<script lang="ts">
 // Plain labelled fields bound to one draft object; used by every simple settings section.
 let {fields,draft}:{fields:Field[];draft:Record<string,any>}=$props();
</script>

<div class="fields">
 {#each fields as f (f.key)}
  {#if f.type==='checkbox'}
   <label class="check"><input type="checkbox" bind:checked={draft[f.key]}/><span>{f.label}</span>{#if f.hint}<small>{f.hint}</small>{/if}</label>
  {:else}
   <label class="field">
    <span>{f.label}</span>
    {#if f.type==='select'}
     <select bind:value={draft[f.key]}>{#each f.choices||[] as [v,t] (v)}<option value={v}>{t}</option>{/each}</select>
    {:else if f.type==='number'}
     <input type="number" bind:value={draft[f.key]} min={f.min} max={f.max} step="1"/>
    {:else if f.type==='password'}
     <input type="password" bind:value={draft[f.key]} placeholder={f.placeholder} autocomplete="new-password" spellcheck="false"/>
    {:else}
     <input type="text" bind:value={draft[f.key]} placeholder={f.placeholder} spellcheck="false"/>
    {/if}
    {#if f.hint||f.min!==undefined}<small>{f.hint||''}{f.min!==undefined?(f.hint?' · ':'')+'范围 '+f.min+'–'+f.max:''}</small>{/if}
   </label>
  {/if}
 {/each}
</div>

<style>
 .fields{display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:var(--space-4);}
 .field{display:flex;flex-direction:column;gap:var(--space-1);font-size:var(--text-sm);}
 .field>span{font-weight:var(--weight-medium);}
 input:not([type=checkbox]),select{height:34px;padding:0 var(--space-2);border-radius:var(--radius-sm);border:1px solid var(--line-strong);background:var(--bg-raised);}
 small{color:var(--fg-muted);font-size:var(--text-xs);}
 .check{grid-column:1/-1;display:flex;align-items:center;gap:var(--space-2);font-size:var(--text-sm);}
 .check small{margin-left:var(--space-1);}
</style>
