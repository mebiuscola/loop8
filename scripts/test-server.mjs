// Starts a test copy of the app for development, for any assistant (Claude Code, Codex, Antigravity):
//   runtime\node.exe scripts/test-server.mjs [--port 4318] [--data <folder>] [--fresh]
// - Its own data folder, never the user's data/ (default: classroom-test-data in the system temp folder;
//   --fresh empties it first). Kept between runs so test material stays.
// - CLASSROOM_TEST_COPY=1: it does not check the Antigravity account when Settings opens and does not
//   start PowerPoint by itself (set CLASSROOM_POWERPOINT=1 to allow PowerPoint).
// Open it at http://127.0.0.1:<port> (or localhost). Stop it with Ctrl+C.
import {spawn} from 'node:child_process';
import {mkdir,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {fileURLToPath} from 'node:url';

const root=path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const args=process.argv.slice(2),option=name=>{const i=args.indexOf(name);return i>=0?args[i+1]:undefined;};
const port=option('--port')||'4318';
const data=path.resolve(option('--data')||path.join(os.tmpdir(),'classroom-test-data'));
if(!/^\d+$/.test(port))throw Error('--port must be a number');
// Never run a test copy on the user's own data.
const same=p=>process.platform==='win32'?p.toLowerCase():p,dir=same(data),project=same(root);
if(dir===project||dir.startsWith(project+path.sep)||project.startsWith(dir+path.sep))throw Error('The test data folder must be outside the project folder and its data/.');
if(args.includes('--fresh'))await rm(data,{recursive:true,force:true});
await mkdir(data,{recursive:true});
console.log('Test copy · data: '+data+' · http://127.0.0.1:'+port);
const child=spawn(process.execPath,['server.mjs'],{cwd:root,stdio:'inherit',windowsHide:true,
 env:{...process.env,CLASSROOM_DATA:data,PORT:port,CLASSROOM_TEST_COPY:'1'}});
const stop=()=>child.kill();
process.on('SIGINT',stop);process.on('SIGTERM',stop);
child.on('exit',code=>process.exit(code??0));
