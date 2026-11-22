<script lang="ts">
 // A modal dialog. It opens when mounted; Escape or the close button calls onclose (unless busy).
 // The close button says "取消" where the dialog asks for a decision, "关闭" where it only shows something.
 import {onMount,type Snippet} from 'svelte';
 let {title,onclose,busy=false,wide=false,closeLabel='取消',children,actions}:{title:string;onclose:()=>void;busy?:boolean;wide?:boolean;closeLabel?:string;children:Snippet;actions?:Snippet}=$props();
 let dialog=$state<HTMLDialogElement>();
 onMount(()=>{dialog?.showModal();return ()=>dialog?.close();});
</script>

<dialog bind:this={dialog} class:wide oncancel={e=>{e.preventDefault();if(!busy)onclose();}} aria-label={title}>
 <h2>{title}</h2>
 <div class="content">{@render children()}</div>
 <div class="actions">
  <button class="btn btn-quiet" type="button" onclick={onclose} disabled={busy}>{closeLabel}</button>
  {#if actions}{@render actions()}{/if}
 </div>
</dialog>

<style>
 dialog{width:min(460px,calc(100vw - 32px));max-height:calc(100vh - 64px);padding:var(--space-5);border:1px solid var(--line);border-radius:var(--radius-md);background:var(--bg-raised);color:var(--fg);box-shadow:var(--shadow-panel);display:flex;flex-direction:column;gap:var(--space-3);}
 dialog:not([open]){display:none;}
 dialog.wide{width:min(820px,calc(100vw - 32px));}
 dialog::backdrop{background:rgba(26,48,47,.32);}
 h2{font-size:var(--text-lg);margin:0;}
 .content{overflow:auto;min-height:0;font-size:var(--text-sm);}
 .actions{display:flex;justify-content:flex-end;gap:var(--space-2);}
</style>
