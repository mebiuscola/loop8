<script lang="ts">
 import {statusWord,type StatusKind} from '../lib/status';
 let {kind,text}:{kind:StatusKind;text?:string}=$props();
</script>

<span class="badge {kind}">{text||statusWord[kind]}</span>

<style>
 .badge{display:inline-flex;align-items:center;height:22px;padding:0 var(--space-2);border-radius:999px;font-size:var(--text-xs);font-weight:var(--weight-medium);white-space:nowrap;}
 .idle{color:var(--status-idle-fg);background:var(--status-idle-bg);}
 .running{color:var(--status-running-fg);background:var(--status-running-bg);}
 .stopped{color:var(--status-stopped-fg);background:var(--status-stopped-bg);}
 .failed{color:var(--status-failed-fg);background:var(--status-failed-bg);}
 .done{color:var(--status-done-fg);background:var(--status-done-bg);}
 .stale{color:var(--status-stale-fg);background:var(--status-stale-bg);}
</style>
