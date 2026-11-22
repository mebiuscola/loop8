// Hash routes: #/w/<courseId>/<workspace>[/<rest>] and #/settings.
// Each course remembers the last place it was viewed (IA decision Q3).

export type Workspace='overview'|'read'|'class'|'deepdive';
export const workspaces:{id:Workspace;label:string}[]=[
 {id:'overview',label:'概览'},{id:'read',label:'阅读'},{id:'class',label:'课堂'},{id:'deepdive',label:'Deep Dive'},
];

export type Route={page:'home'}|{page:'settings'}|{page:'course';courseId:string;workspace:Workspace;rest:string};

const LAST_KEY='classroom.next.lastPlace';
const COURSE_KEY='classroom.next.lastCourse';
const PLACE_KEY='classroom.next.lastWorkspacePlace';   // per course, the last place in each workspace

function storage<T>(key:string,fallback:T):T{try{const v=localStorage.getItem(key);return v?JSON.parse(v):fallback;}catch{return fallback;}}
function store(key:string,value:unknown){try{localStorage.setItem(key,JSON.stringify(value));}catch{/* private mode */}}
function rememberPlace(route:Route,hash:string){
 if(route.page!=='course')return;
 const all=storage<Record<string,Record<string,string>>>(PLACE_KEY,{});
 (all[route.courseId]??={})[route.workspace]=hash;store(PLACE_KEY,all);
}

function parse(hash:string):Route{
 const parts=hash.replace(/^#\/?/,'').split('/').map(decodeURIComponent);
 if(parts[0]==='settings')return {page:'settings'};
 if(parts[0]==='w'&&parts[1]){
  const workspace=(workspaces.some(w=>w.id===parts[2])?parts[2]:'overview') as Workspace;
  return {page:'course',courseId:parts[1],workspace,rest:parts.slice(3).join('/')};
 }
 return {page:'home'};
}

export function courseHref(courseId:string,workspace?:Workspace,rest=''){
 return '#/w/'+encodeURIComponent(courseId)+(workspace?'/'+workspace+(rest?'/'+rest:''):'');
}

class Router{
 route=$state<Route>(parse(location.hash));
 constructor(){
  addEventListener('hashchange',()=>this.sync());
  this.sync();
 }
 private sync(){
  let route=parse(location.hash);
  // A bare course link reopens the last place in that course; first visit goes to the overview.
  if(route.page==='course'&&!/^#\/w\/[^/]+\/[a-z]+/.test(location.hash)){
   const last=storage<Record<string,string>>(LAST_KEY,{})[route.courseId];
   const target=last||courseHref(route.courseId,'overview');
   history.replaceState(null,'',target);route=parse(target);
  }
  if(route.page==='course'){
   const all=storage<Record<string,string>>(LAST_KEY,{});all[route.courseId]=location.hash;store(LAST_KEY,all);store(COURSE_KEY,route.courseId);
   rememberPlace(route,location.hash);
  }
  this.route=route;
 }
 /** A workspace tab returns to the last place viewed in that workspace of the course. */
 placeHref(courseId:string,workspace:Workspace){
  return storage<Record<string,Record<string,string>>>(PLACE_KEY,{})[courseId]?.[workspace]||courseHref(courseId,workspace);
 }
 /** Course to show when the app opens with no hash. */
 lastCourse():string|null{return storage<string|null>(COURSE_KEY,null);}
 go(hash:string){if(location.hash!==hash)location.hash=hash;else this.sync();}
 /** Record a new position (e.g. the page scrolled to) without a history entry or a re-render. */
 remember(hash:string){
  if(location.hash===hash)return;
  history.replaceState(null,'',hash);
  const route=parse(hash);
  if(route.page==='course'){const all=storage<Record<string,string>>(LAST_KEY,{});all[route.courseId]=hash;store(LAST_KEY,all);rememberPlace(route,hash);}
 }
}

export const router=new Router();
