// The single place that polls the backend (docs/API.md "重做前端时需要留意" 1 and 2).
import {api,ApiError,type Project,type ProjectSummary} from './api';
import {courseStatus,taskStatus,taskLabel,type StatusKind} from './status';

export interface TaskRow{courseId:string;courseName:string;key:string;action:string;target:string;kind:StatusKind;detail:string;time?:string;}

const FAST=3000,SLOW=15000;

class Store{
 projects=$state<ProjectSummary[]>([]);
 loaded=$state(false);
 connectionError=$state('');
 current=$state<Project|null>(null);
 currentError=$state('');
 /** Full project objects of other courses, loaded for task names. */
 details=$state<Record<string,Project>>({});
 private currentId:string|null=null;
 private timer:ReturnType<typeof setTimeout>|undefined;

 get anyRunning(){return this.projects.some(p=>courseStatus(p)==='running');}

 start(){this.tick();}

 async refresh(){
  try{
   this.projects=await api.listProjects();this.connectionError='';
  }catch(e){this.connectionError=e instanceof ApiError?e.message:String(e);}
  this.loaded=true;
  if(this.currentId){
   try{this.current=await api.getProject(this.currentId);this.currentError='';}
   catch(e){this.currentError=e instanceof ApiError&&e.status===404?'找不到这门课程，可能已被删除。':(e as Error).message;}
  }
 }

 private async tick(){
  clearTimeout(this.timer);
  await this.refresh();
  this.timer=setTimeout(()=>this.tick(),this.anyRunning?FAST:SLOW);
 }

 /** Switch the course whose full object is kept fresh. */
 async open(id:string|null){
  if(id===this.currentId)return;
  this.currentId=id;this.current=null;this.currentError='';
  if(id)await this.tick();
 }

 /** Load full objects of courses that have running or unfinished tasks, for readable task names. */
 async loadTaskDetails(){
  const wanted=this.projects.filter(p=>courseStatus(p)!=='ready'&&!this.details[p.id]);
  const loaded=await Promise.allSettled(wanted.map(p=>api.getProject(p.id)));
  const next={...this.details};
  loaded.forEach(r=>{if(r.status==='fulfilled')next[r.value.id]=r.value;});
  this.details=next;
 }

 /** Every task of every course, newest first; finished ones only from the last day. */
 get tasks():TaskRow[]{
  const rows:TaskRow[]=[],dayAgo=Date.now()-86400000;
  for(const p of this.projects){
   const full=this.current?.id===p.id?this.current:this.details[p.id];
   for(const [key,task] of Object.entries(p.tasks||{})){
    const kind=taskStatus(task),time=task.finished||task.started;
    if(kind==='done'&&(!time||Date.parse(time)<dayAgo))continue;
    const {action,target}=taskLabel(key,full||undefined);
    const detail=kind==='running'?(task.stage||''):kind==='done'?'':(task.error||task.stage||'');
    rows.push({courseId:p.id,courseName:p.name,key,action,target,kind,detail,time});
   }
  }
  const order:Record<StatusKind,number>={running:0,failed:1,stopped:2,stale:3,idle:4,done:5};
  return rows.sort((a,b)=>order[a.kind]-order[b.kind]||String(b.time).localeCompare(String(a.time)));
 }
}

export const store=new Store();
