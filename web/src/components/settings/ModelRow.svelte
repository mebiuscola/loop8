<script lang="ts">
 // One account model in use: its few options, tests, and removal.
 import JobView from './JobView.svelte';
 import {api,type ModelProfile} from '../../lib/api';
 import {JobRun} from '../../lib/jobs.svelte';
 import type {SettingsModel} from '../../lib/settings.svelte';

 let {profile,model,label}:{profile:ModelProfile;model:SettingsModel;label:string}=$props();
 const test=new JobRun();
 async function check(kind:'text'|'json'|'vision'){
  const p=$state.snapshot(profile) as ModelProfile;
  if(p.provider==='antigravity-acp'){p.acpEntry=model.acpEntry;p.acpExecutable=model.acpExecutable;}
  try{await test.run(()=>api.modelTest(kind,p));}catch{/* shown below */}
 }
 let confirming=$state(false);
 const used=$derived(model.usage(profile.id));
</script>

<div class="row">
 <div class="name">
  <strong>{label}</strong>
  <small>{used.length?'用于：'+used.join('、'):'暂未分配给任何功能'}</small>
 </div>
 <label class="opt">上下文额度<input type="number" bind:value={profile.contextChars} min="20000" max="2000000"/></label>
 <label class="opt check"><input type="checkbox" checked={profile.visionEnabled!==false} onchange={e=>profile.visionEnabled=(e.currentTarget as HTMLInputElement).checked}/>图片输入</label>
 <div class="tests">
  <button class="btn btn-quiet" type="button" disabled={test.state.running} onclick={()=>check('text')}>测试文字</button>
  <button class="btn btn-quiet" type="button" disabled={test.state.running} onclick={()=>check('json')}>测试 JSON</button>
  <button class="btn btn-quiet" type="button" disabled={test.state.running} onclick={()=>check('vision')}>测试图片</button>
  {#if confirming}
   <span class="confirm">{used.length?'移除后，'+used.join('、')+'将改用默认模型。':'从列表中移除？'}
    <button class="btn danger" type="button" disabled={model.saving} onclick={()=>{confirming=false;model.remove(profile.id);}}>确定移除</button>
    <button class="btn btn-quiet" type="button" onclick={()=>confirming=false}>取消</button></span>
  {:else}<button class="btn btn-quiet danger-text" type="button" onclick={()=>confirming=true}>移除</button>{/if}
 </div>
 <div class="job"><JobView job={test.state}/></div>
</div>

<style>
 .row{display:grid;grid-template-columns:minmax(180px,1.2fr) 170px 100px minmax(260px,1.5fr);gap:var(--space-3);align-items:center;padding:var(--space-2) 0;border-top:1px solid var(--line);font-size:var(--text-sm);}
 .name{display:flex;flex-direction:column;min-width:0;}
 .name strong{font-weight:var(--weight-medium);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
 small{color:var(--fg-muted);font-size:var(--text-xs);}
 .opt{display:flex;align-items:center;gap:var(--space-2);font-size:var(--text-xs);color:var(--fg-muted);}
 .opt input[type=number]{width:96px;height:30px;padding:0 var(--space-2);border-radius:var(--radius-sm);border:1px solid var(--line-strong);background:var(--bg-raised);}
 .check{gap:var(--space-1);}
 .tests{display:flex;flex-wrap:wrap;align-items:center;gap:var(--space-1);justify-content:flex-end;}
 .confirm{display:inline-flex;flex-wrap:wrap;align-items:center;gap:var(--space-2);color:var(--status-failed-fg);font-size:var(--text-xs);}
 .danger{border-color:var(--status-failed-fg);color:var(--status-failed-fg);}
 .danger-text{color:var(--status-failed-fg);}
 .job{grid-column:1/-1;}
 .job:empty{display:none;}
 @media (max-width:1100px){.row{grid-template-columns:1fr 1fr;}.tests{grid-column:1/-1;justify-content:flex-start;}}
</style>
