// Reading data of courseware and references, kept while the app is open (also when another
// workspace is shown) and read again only when what it is made from changes — a result saved,
// a parse finished, the week's materials changed — never on progress updates of a running task.
import {api,ApiError,type Project,type SourceFile,type CoursewareReader as CR,type ReferenceReader as RR} from './api';

export type ReaderKind='ppt'|'ref';

/** What a reader's data depends on. Progress fields (stage, completed, updated) are left out on purpose. */
export function readerSignature(project:Project,kind:ReaderKind,f:SourceFile):string{
 if(kind==='ppt'){
  const a=f.aiParse||{},week=project.tasks?.preparation;
  return JSON.stringify([f.parsed,f.parseStatus,f.externalAnalysis,f.importSummary??null,a.status??null,a.finished??null,project.materialRevision??null,week?.status??null,week?.finished??null]);
 }
 // A reference's translation is saved batch by batch; its task shows each step, so it is followed.
 return JSON.stringify([f.parsed,f.parseStatus,project.materialRevision??null,project.tasks?.['reference:'+f.id]??null]);
}

class ReaderCache{
 data=$state<Record<string,CR|RR|null>>({});
 errors=$state<Record<string,string>>({});
 /** The page last read in each material, so going back to it returns there. */
 private pages=new Map<string,number>();
 private signatures=new Map<string,string>();
 private loading=new Map<string,Promise<void>>();

 key(projectId:string,kind:ReaderKind,id:string){return projectId+'|'+kind+':'+id;}

 /** Reads a material's data when it is new or changed (or always with force). */
 load(project:Project,kind:ReaderKind,f:SourceFile,force=false):Promise<void>{
  const key=this.key(project.id,kind,f.id),signature=readerSignature(project,kind,f);
  if(!force&&this.signatures.get(key)===signature&&(key in this.data||this.loading.has(key)))return this.loading.get(key)||Promise.resolve();
  this.signatures.set(key,signature);
  if(!(key in this.data))this.data[key]=null;
  let run:Promise<void>|undefined;
  run=(async()=>{
   try{
    const value=kind==='ppt'?await api.reader(project.id,f.id):await api.referenceReader(project.id,f.id);
    if(this.signatures.get(key)===signature||force)this.data[key]=value;
    delete this.errors[key];
   }catch(e){
    this.errors[key]=e instanceof ApiError?e.message:String(e);
    this.signatures.delete(key);
   }finally{if(this.loading.get(key)===run)this.loading.delete(key);}
  })();
  this.loading.set(key,run);
  return run;
 }
 lastPage(projectId:string,kind:ReaderKind,id:string){return this.pages.get(this.key(projectId,kind,id))||1;}
 setPage(projectId:string,kind:ReaderKind,id:string,page:number){this.pages.set(this.key(projectId,kind,id),page);}
}

export const readerCache=new ReaderCache();
