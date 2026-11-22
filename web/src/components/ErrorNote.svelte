<script lang="ts">
 // An error shown next to the item it belongs to (IA §2). When the cause is a model or
 // connection setting, it links straight to the settings page (UI issue 6).
 let {text}:{text:string}=$props();
 const aboutSettings=$derived(/设置|配置|模型连接|模型分配|功能分配|API 密钥|API Key|Token|登录|授权|MinerU/i.test(text));
</script>

<span class="error" role="alert">{text}{#if aboutSettings} <a href="#/settings">去设置</a>{/if}</span>

<style>
 .error{color:var(--status-failed-fg);}
 a{color:inherit;font-weight:var(--weight-medium);text-decoration:underline;}
</style>
