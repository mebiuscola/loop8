// Drives the new frontend (served at /) in the isolated test browser from lib/browser-render.mjs.
// Tests find elements by role, label or visible text rather than by internal class names,
// so they keep working when the styling changes.
import {setTimeout as sleep} from 'node:timers/promises';

/** Waits until `expression` (evaluated in the page) is truthy; returns its value. */
export async function waitFor(ui,expression,{timeout=9000,label=expression}={}){
 const end=Date.now()+timeout;let last;
 while(Date.now()<end){
  try{const value=await ui.evaluate(expression);if(value)return value;}catch(e){last=e;}
  await sleep(40);
 }
 throw Error('Browser did not reach: '+label+(last?' ('+last.message+')':''));
}

/** Opens the app at `hash` (e.g. "/settings" or "/w/<id>/read") with a full page load. */
export async function openApp(ui,hash='',{width=1440,height=960}={}){
 await ui.screenshot(width,height);
 const origin=await ui.evaluate('performance.timeOrigin');
 await ui.evaluate(`setTimeout(()=>location.href=${JSON.stringify('/'+(hash?'#'+hash:''))},0);true`);
 await waitFor(ui,`performance.timeOrigin!==${origin}&&!!document.querySelector('.frame')`,{label:'app loaded'});
}

/** Moves to another hash route without reloading. */
export async function go(ui,hash){
 await ui.evaluate(`location.hash=${JSON.stringify(hash)};true`);
}

/** Reloads the page and waits for the app again. */
export async function reload(ui){
 const origin=await ui.evaluate('setTimeout(()=>location.reload(),0);performance.timeOrigin');
 await waitFor(ui,`performance.timeOrigin!==${origin}&&!!document.querySelector('.frame')`,{label:'reload'});
}

// In-page helper: the first visible element matching `selector` whose text matches.
const FIND=`(selector,text,root=document)=>[...root.querySelectorAll(selector)].find(e=>{
 const t=(e.textContent||'').replace(/\\s+/g,' ').trim();
 return (text instanceof RegExp?text.test(t):t===text)&&e.getClientRects().length>0;
})`;
const arg=text=>text instanceof RegExp?text.toString():JSON.stringify(text);

/** True when a visible element matching selector/text exists. */
export function has(ui,selector,text){
 return ui.evaluate(`!!(${FIND})(${JSON.stringify(selector)},${arg(text)})`);
}

/** Clicks a visible element (button, link, …) by its text. Waits for it first. */
export async function click(ui,text,selector='button,a,[role=menuitem]'){
 await waitFor(ui,`(()=>{const e=(${FIND})(${JSON.stringify(selector)},${arg(text)});if(!e||e.disabled)return false;e.click();return true;})()`,{label:'click '+text});
}

/** Sets a form control's value (by its label text or a CSS selector) and fires input/change. */
export async function fill(ui,target,value){
 const css=/^[#.[]|^[a-z]+[#.[]/.test(target),t=JSON.stringify(target);
 const find=css?`document.querySelector(${t})`:`(()=>{
  const label=[...document.querySelectorAll('label')].find(l=>l.getClientRects().length&&l.textContent.replace(/\\s+/g,' ').trim().startsWith(${t}));
  return label?.control||label?.querySelector('input,select,textarea')||document.querySelector('[aria-label="'+${t}+'"]');
 })()`;
 await waitFor(ui,`(()=>{
  const e=${find};
  if(!e||e.disabled)return false;
  if(e.type==='checkbox')e.checked=${JSON.stringify(value)};else e.value=${JSON.stringify(value)};
  e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true}));return true;
 })()`,{label:'fill '+target});
}

/** Visible text of the page (or of the first element matching selector). */
export function text(ui,selector='body'){
 return ui.evaluate(`document.querySelector(${JSON.stringify(selector)})?.innerText||''`);
}

/** Waits until the visible text contains `needle` (string or RegExp). */
export function waitText(ui,needle,selector='body',options){
 const test=needle instanceof RegExp?`${needle}.test(t)`:`t.includes(${JSON.stringify(needle)})`;
 return waitFor(ui,`(()=>{const t=document.querySelector(${JSON.stringify(selector)})?.innerText||'';return ${test};})()`,{label:'text '+needle,...options});
}

/** Opens the Ask panel (it stays open across pages once opened). */
export function openAsk(ui){
 return waitFor(ui,`(()=>{
  const b=[...document.querySelectorAll('.topbar button')].find(b=>b.textContent.trim()==='提问');
  if(!b)return false;
  if(b.getAttribute('aria-pressed')!=='true')b.click();
  return !!document.querySelector('.ask textarea');
 })()`,{label:'Ask panel'});
}
