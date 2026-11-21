<script lang="ts">
 // Shown for workspaces that have not moved to the new interface yet.
 import Icon from './Icon.svelte';
 let {title,description}:{title:string;description:string}=$props();
</script>

<section class="pending">
 <h1>{title}</h1>
 <p>{description}</p>
 <p class="muted">这个部分正在迁移到新界面。现在请在旧界面中使用，旧界面里的一切都保持不变。</p>
 <a class="btn" href="/" target="_blank" rel="noopener">在旧界面打开 <Icon name="external" size={14}/></a>
</section>

<style>
 .pending{max-width:560px;margin:var(--space-6) auto;padding:var(--space-5);background:var(--bg-surface);border:1px solid var(--line);border-radius:var(--radius-md);}
 h1{font-size:var(--text-xl);margin-bottom:var(--space-2);}
 p{margin:0 0 var(--space-3);}
 .muted{color:var(--fg-muted);font-size:var(--text-sm);}
</style>
