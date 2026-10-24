const fs=require('fs'),vm=require('vm'),assert=require('assert');
let modelReady=false,detectCalls=0,failInference=false,releaseReady;
const ready=new Promise(resolve=>{releaseReady=()=>{modelReady=true;resolve();};});
const pen=new Proxy({}, {get:(o,k)=>o[k]??(()=>{}),set:(o,k,v)=>(o[k]=v,true)});
const videoElement={readyState:2,videoWidth:640,videoHeight:480,style:{},setAttribute(){},addEventListener(){},play:async()=>{}};
const elements={status:{textContent:''}};
const ctx={performance,window:{innerWidth:900,innerHeight:600,addEventListener(){}},navigator:{mediaDevices:{getUserMedia:async()=>({getTracks:()=>[{stop(){}}]})}},document:{getElementById:id=>elements[id]||null,createElement:()=>({style:{},getContext:()=>pen}),body:{appendChild(el){elements[el.id]=el;}}},createVideo:()=>({elt:videoElement,hide(){},size(){},remove(){}}),ml5:{handPose:()=>({ready,detect:async()=>{assert(modelReady,'Inference started before weights loaded');detectCalls++;if(failInference)throw Error('GPU unavailable');return [];}})},setTimeout:(fn,ms)=>ms===0?0:setTimeout(fn,ms),clearTimeout};
vm.createContext(ctx);vm.runInContext(fs.readFileSync(require('path').join(__dirname,'..','sketch.js'),'utf8'),ctx);
(async()=>{
const startup=vm.runInContext('startCamera()',ctx);
await new Promise(resolve=>setImmediate(resolve));
assert.equal(detectCalls,0);assert(elements.status.textContent.includes('第 2 步'));
releaseReady();await startup;
assert(detectCalls>=2);assert(vm.runInContext('cameraReady',ctx));
failInference=true;await vm.runInContext('detectionLoop(trackingSession)',ctx);
assert.equal(vm.runInContext('cameraReady',ctx),false);assert(elements.status.textContent.includes('GPU unavailable'));
console.log('PASS: synchronous ml5 constructor waits for ready, first inference verified, asynchronous inference errors surfaced.');
})().catch(e=>{console.error(e);process.exitCode=1;});
