// What the reader is looking at, offered to the Ask panel as a focus ("this page", "this class").
// Material focus needs scope 'preparation'; a class is its own scope (its session id) with no focus.
export type AskFocus={label:string;scope:'preparation';focus:{kind:'page';sourceId:string;pageIndex:number}|{kind:'file';sourceId:string};}|{label:string;scope:string;focus:null};

class AskContext{
 focus=$state<AskFocus|null>(null);
 set(value:AskFocus|null){this.focus=value;}
}

export const askContext=new AskContext();
