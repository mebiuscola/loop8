// What the reader is looking at, offered to the Ask panel as a focus ("this page").
export interface AskFocus{label:string;scope:'preparation';focus:{kind:'page';sourceId:string;pageIndex:number}|{kind:'file';sourceId:string};}

class AskContext{
 focus=$state<AskFocus|null>(null);
 set(value:AskFocus|null){this.focus=value;}
}

export const askContext=new AskContext();
