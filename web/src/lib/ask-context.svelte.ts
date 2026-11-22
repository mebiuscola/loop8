// What the reader is looking at, offered to the Ask panel as a focus ("this page", "this class").
// Material focus needs scope 'preparation'; a class is its own scope (its session id) with no focus.
export type AskFocus={label:string;scope:'preparation';focus:{kind:'page';sourceId:string;pageIndex:number}|{kind:'file';sourceId:string};}|{label:string;scope:string;focus:null};

class AskContext{
 focus=$state<AskFocus|null>(null);
 set(value:AskFocus|null){this.focus=value;}
}

export const askContext=new AskContext();

/** One course's Ask state: the draft and a question being answered stay with that course. */
export class CourseAsk{
 question=$state('');sending=$state(false);error=$state('');progress=$state('');
 job=$state<{kind:'acp'|'chatgpt';id:string}|null>(null);   // an answer that can be stopped
}
const courses=new Map<string,CourseAsk>();
export function courseAsk(projectId:string){
 let s=courses.get(projectId);
 if(!s){s=new CourseAsk();courses.set(projectId,s);}
 return s;
}
