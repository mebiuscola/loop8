// The single place that polls the backend (docs/API.md "重做前端时需要留意" 1 and 2).
import {api,ApiError,type Project,type ProjectSummary,type Task} from './api';
import {courseStatus,taskStatus,taskLabel,type StatusKind} from './status';

export interface TaskRow{courseId:string;courseName:string;key:string;action:string;target:string;kind:StatusKind;detail:string;time?:string;}

const FAST=3000,SLOW=15000;
// Failed or stopped tasks the user has acknowledged ("知道了"), per browser. Each entry records
// which run of the task was acknowledged, so a later run that fails again shows up again.
const DISMISSED_KEY='classroom.next.dismissedTasks';
const runOf=(task:Task)=>String(task.finished||task.started||'')+'|'+(task.error||'');

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
 private ticks=0;      // only the newest polling round schedules the next one
 private loads=0;      // only the newest course request may replace `current`
 dismissed=$state<Record<string,string>>((()=>{try{return JSON.parse(localStorage.getItem(DISMISSED_KEY)||'{}');}catch{return {};}})());

 get anyRunning(){return this.projects.some(p=>courseStatus(p)==='running');}

 /** The sidebar dot of a course; acknowledged failures no longer ask for attention. */
 courseState(p:ProjectSummary){return courseStatus(p,(key,task)=>this.isDismissed(p.id,key,task));}
 isDismissed(courseId:string,key:string,task:Task){return this.dismissed[courseId+'|'+key]===runOf(task);}
 dismiss(row:TaskRow){
  const task=this.projects.find(p=>p.id===row.courseId)?.tasks?.[row.key];if(!task)return;
  const next={...this.dismissed,[row.courseId+'|'+row.key]:runOf(task)};
  // Forget acknowledgements of tasks that no longer exist.
  for(const k of Object.keys(next)){const [id,...rest]=k.split('|');if(!this.projects.some(p=>p.id===id&&p.tasks?.[rest.join('|')]))delete next[k];}
  this.dismissed=next;
  try{localStorage.setItem(DISMISSED_KEY,JSON.stringify(next));}catch{/* private mode */}
 }

 start(){this.tick();}

 async refresh(){
  try{
   this.projects=await api.listProjects();this.connectionError='';
  }catch(e){this.connectionError=e instanceof ApiError?e.message:String(e);}
  this.loaded=true;
  // A response that arrives after the user opened another course (or after a newer request)
  // is dropped: the page must never show, or act on, a course other than the one in the address.
  const id=this.currentId;
  if(id){
   const n=++this.loads;
   try{const p=await api.getProject(id);if(n===this.loads&&id===this.currentId){this.current=p;this.currentError='';}}
   catch(e){if(n===this.loads&&id===this.currentId)this.currentError=e instanceof ApiError&&e.status===404?'找不到这门课程，可能已被删除。':(e as Error).message;}
  }
 }

 private async tick(){
  clearTimeout(this.timer);
  const n=++this.ticks;
  await this.refresh();
  if(n!==this.ticks)return;   // a newer round started meanwhile and keeps the one polling loop
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
  const wanted=this.projects.filter(p=>Object.keys(p.tasks||{}).length&&courseStatus(p)!=='ready'&&!this.details[p.id]);
  if(!wanted.length)return;
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
    if((kind==='failed'||kind==='stopped')&&this.isDismissed(p.id,key,task))continue;
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
