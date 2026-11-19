export function semaphore(limit){
 if(!Number.isInteger(limit)||limit<1)throw Error('并发数必须为正整数。');
 let active=0;const queue=[];
 const pump=()=>{while(active<limit&&queue.length){const {task,resolve,reject}=queue.shift();active++;Promise.resolve().then(task).then(resolve,reject).finally(()=>{active--;pump();});}};
 return {get active(){return active;},get queued(){return queue.length;},run(task){return new Promise((resolve,reject)=>{queue.push({task,resolve,reject});pump();});}};
}
// Wait for every started worker before returning, including when a sibling fails.
// The returned results always follow input order, never completion order.
export async function mapPool(items,limit,task){const gate=semaphore(limit);return Promise.all(items.map((item,index)=>gate.run(()=>task(item,index)).then(value=>({status:'fulfilled',value}),reason=>({status:'rejected',reason}))));}
export function serialWriter(){let tail=Promise.resolve();return task=>{const next=tail.then(task);tail=next.catch(()=>{});return next;};}
