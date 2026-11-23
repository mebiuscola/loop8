<script lang="ts">
 import {onMount} from 'svelte';
 import Sidebar from './components/Sidebar.svelte';
 import TopBar from './components/TopBar.svelte';
 import AskPanel from './components/AskPanel.svelte';
 import ReadWorkspace from './components/read/ReadWorkspace.svelte';
 import ClassWorkspace from './components/class/ClassWorkspace.svelte';
 import DeepDiveWorkspace from './components/deepdive/DeepDiveWorkspace.svelte';
 import OverviewWorkspace from './components/overview/OverviewWorkspace.svelte';
 import SettingsPage from './components/settings/SettingsPage.svelte';
 import {store} from './lib/store.svelte';
 import {router,courseHref} from './lib/router.svelte';

 const read=(key:string,fallback:boolean)=>{try{const v=localStorage.getItem(key);return v===null?fallback:v==='1';}catch{return fallback;}};
 const write=(key:string,value:boolean)=>{try{localStorage.setItem(key,value?'1':'0');}catch{/* private mode */}};

 const SIDEBAR_KEY='classroom.next.sidebarCollapsed';
 let sidebarCollapsed=$state(read(SIDEBAR_KEY,false));
 let askOpen=$state(read('classroom.next.askOpen',false));   // collapsed by default (IA decision Q4)
 // On a narrow window the course list collapses by itself so the workspace keeps its width; it can
 // still be opened with its own button. Only the user's own choice on a wide window is remembered,
 // and it comes back when the window is wide again.
 let narrowWindow=false;
 $effect(()=>{const collapsed=sidebarCollapsed;if(!narrowWindow)write(SIDEBAR_KEY,collapsed);});
 $effect(()=>write('classroom.next.askOpen',askOpen));
 onMount(()=>{
  const narrow=matchMedia('(max-width: 760px)');
  const fit=()=>{narrowWindow=narrow.matches;sidebarCollapsed=narrow.matches||read(SIDEBAR_KEY,false);};
  fit();narrow.addEventListener('change',fit);
  return ()=>narrow.removeEventListener('change',fit);
 });

 const route=$derived(router.route);
 $effect(()=>{store.open(route.page==='course'?route.courseId:null);});
 store.start();

 // Opening the app without a location returns to the last course.
 $effect(()=>{
  if(route.page!=='home'||!store.loaded)return;
  const last=router.lastCourse();
  if(last&&store.projects.some(p=>p.id===last))router.go(courseHref(last));
 });

 const showAsk=$derived(route.page==='course'&&askOpen&&!!store.current);
</script>

<div class="frame" class:sidebar-collapsed={sidebarCollapsed} class:with-ask={showAsk}>
 <div class="sidebar-slot"><Sidebar bind:collapsed={sidebarCollapsed}/></div>

 <div class="main">
  <TopBar bind:askOpen askAvailable={route.page==='course'&&!!store.current}/>
  {#if store.connectionError}
   <p class="banner" role="alert">{store.connectionError}</p>
  {/if}
  <main class="content" class:flush={route.page==='settings'||route.page==='course'&&(route.workspace==='read'||route.workspace==='class'||route.workspace==='deepdive')}>
   {#if route.page==='settings'}
    <SettingsPage/>
   {:else if route.page==='course'}
    {#if store.currentError}
     <section class="message"><h1>无法打开课程</h1><p>{store.currentError}</p></section>
    {:else if !store.current||store.current.id!==route.courseId}
     <p class="loading">正在打开课程…</p>
    {:else if route.workspace==='read'}
     <ReadWorkspace project={store.current} rest={route.rest}/>
    {:else if route.workspace==='class'}
     <ClassWorkspace project={store.current} rest={route.rest}/>
    {:else if route.workspace==='overview'}
     <OverviewWorkspace project={store.current}/>
    {:else}
     <DeepDiveWorkspace project={store.current} rest={route.rest}/>
    {/if}
   {:else if store.loaded&&!store.connectionError}
    <section class="message">
     <h1>{store.projects.length?'选择一门课程':'开始整理第一周课程'}</h1>
     <p>{store.projects.length?'从左侧课程列表打开一周的课程。':'在左侧点"新建一周"，然后添加课程介绍、课件和参考文献。'}</p>
    </section>
   {/if}
  </main>
 </div>

 {#if showAsk&&store.current}
  <div class="ask-slot"><AskPanel project={store.current} onclose={()=>askOpen=false}/></div>
 {/if}
</div>

<style>
 .frame{display:grid;grid-template-columns:var(--sidebar-width) minmax(0,1fr);height:100vh;}
 .frame.sidebar-collapsed{grid-template-columns:var(--sidebar-collapsed) minmax(0,1fr);}
 .frame.with-ask{grid-template-columns:var(--sidebar-width) minmax(0,1fr) var(--ask-width);}
 .frame.sidebar-collapsed.with-ask{grid-template-columns:var(--sidebar-collapsed) minmax(0,1fr) var(--ask-width);}
 .sidebar-slot,.ask-slot{min-height:0;}
 .main{display:flex;flex-direction:column;min-width:0;min-height:0;}
 /* Only the content scrolls; the top bar never moves. */
 .content{flex:1;overflow:auto;padding:var(--space-4) var(--space-5);}
 /* Workspaces with their own toolbar and scrolling fill the area edge to edge. */
 .content.flush{padding:0;overflow:hidden;}
 .banner{margin:0;padding:var(--space-2) var(--space-5);background:var(--status-failed-bg);color:var(--status-failed-fg);font-size:var(--text-sm);}
 .message{max-width:560px;margin:var(--space-6) auto;}
 .message h1{font-size:var(--text-xl);margin-bottom:var(--space-2);}
 .message p{color:var(--fg-muted);}
 .loading{color:var(--fg-muted);}
</style>
