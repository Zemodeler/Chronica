// Synthetic, stateless game responses over the installed CLI's persistent server.
import { spawn } from "node:child_process";
import path from "node:path";
import { createInterface } from "node:readline";
import { prepareHandCodex, handCodexEnvironment, handCodexInstructions, providerSchemaFor } from "../packages/ai/src/adapters/hand-codex";
await prepareHandCodex();
const runtime = path.resolve(process.env.CHRONICA_HAND_RUNTIME_DIR || ".cache/chronica-codex");
const child = spawn(process.execPath, [path.join(runtime, "node_modules/@openai/codex/bin/codex.js"), "app-server", "--listen", "stdio://",
  "-c", 'forced_login_method="chatgpt"', "-c", 'web_search="disabled"',
  ...["shell_tool", "apps", "plugins", "hooks", "multi_agent", "browser_use", "computer_use", "image_generation", "workspace_dependencies"].flatMap(f => ["--disable", f]),
], {env: handCodexEnvironment(), cwd: runtime, stdio:["pipe", "pipe", "pipe"], windowsHide:true});
const pending = new Map<number, {resolve:(v:any)=>void; reject:(e:any)=>void}>();
const completed = new Map<string, (v:any)=>void>();
const usage = new Map<string, unknown>();
let nextId=0;
const lines = createInterface({input:child.stdout});
lines.on("line", line => {
  const message = JSON.parse(line);
  if (message.id !== undefined && pending.has(message.id)) {
    const p=pending.get(message.id)!; pending.delete(message.id);
    message.error ? p.reject(new Error(JSON.stringify(message.error))) : p.resolve(message.result);
  }
  if (message.method === "thread/tokenUsage/updated") usage.set(message.params.threadId, message.params.tokenUsage.last);
  if (message.method === "turn/completed") completed.get(message.params.threadId)?.(message.params.turn);
});
child.stderr.on("data", () => {});
const timer=setTimeout(()=>child.kill(), 90_000);
function rpc(method:string, params:any) {return new Promise<any>((resolve,reject)=>{
  const id=++nextId; pending.set(id,{resolve,reject}); child.stdin.write(JSON.stringify({id,method,params})+"\n");
});}
try {
  await rpc("initialize", {clientInfo:{name:"chronica",title:"Chronica",version:"0.0.0"},capabilities:{experimentalApi:true}});
  child.stdin.write(JSON.stringify({method:"initialized"})+"\n");
  for(let i=0;i<2;i++) {
    const started=performance.now();
    const thread=await rpc("thread/start", {model:"gpt-6-luna",cwd:runtime,ephemeral:true,environments:[],sandbox:"read-only",approvalPolicy:"never",
      baseInstructions:handCodexInstructions("Write one brief chronicle entry numbered 1 describing the supplied event. Return JSON.",true), developerInstructions:""});
    const threadId=thread.thread.id;
    const done=new Promise<any>(resolve=>completed.set(threadId,resolve));
    await rpc("turn/start",{threadId,environments:[],effort:"low",outputSchema:providerSchemaFor("compose_chronicle"),input:[{type:"text",text:"A Roman messenger delivered a sealed letter to the consul.",text_elements:[]}]});
    const turn=await done;
    console.log(JSON.stringify({i,seconds:(performance.now()-started)/1000,status:turn.status,error:turn.error,items:turn.items,usage:usage.get(threadId)}));
    completed.delete(threadId);
    await rpc("thread/unsubscribe",{threadId});
  }
} finally {clearTimeout(timer); child.kill(); lines.close();}
