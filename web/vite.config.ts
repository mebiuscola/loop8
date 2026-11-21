import {defineConfig} from 'vite';
import {svelte} from '@sveltejs/vite-plugin-svelte';
import {readFileSync} from 'node:fs';

// The root package.json is the single source of the app version.
const version=JSON.parse(readFileSync(new URL('../package.json',import.meta.url),'utf8')).version;

export default defineConfig({
 base:'/next/',
 plugins:[svelte()],
 define:{__APP_VERSION__:JSON.stringify(version)},
 build:{outDir:'../public/next',emptyOutDir:true,assetsInlineLimit:0,modulePreload:{polyfill:false}},
 server:{
  port:5173,
  // Dev only: forward API calls to a running Classroom Local server.
  // The server accepts only Host 127.0.0.1:<port> and same-origin requests.
  proxy:{'/api':{target:'http://127.0.0.1:'+(process.env.CLASSROOM_PORT||4317),changeOrigin:true,
   configure:proxy=>proxy.on('proxyReq',req=>req.removeHeader('origin'))}}
 }
});
