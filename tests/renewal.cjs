const fs=require('fs'),vm=require('vm'),assert=require('assert'),path=require('path');let now=1000;
const pen=new Proxy({}, {get:(o,k)=>o[k]??(()=>{}),set:(o,k,v)=>(o[k]=v,true)});pen.createRadialGradient=()=>({addColorStop(){}});
const ctx={window:{addEventListener(){}},document:{getElementById:()=>null,createElement:()=>({getContext:()=>pen})},drawingContext:pen,width:1000,height:700,millis:()=>now,Math,lerp:(a,b,t)=>a+(b-a)*t,keyIsDown:()=>false,mouseX:500,mouseY:350};vm.createContext(ctx);vm.runInContext(fs.readFileSync(path.join(__dirname,'..','sketch.js'),'utf8'),ctx);
// 模拟长时间创作，用轻量花数据隔离高成本纹理生成，原有花型检查单独保留。
vm.runInContext('makeParticleFlower=(x,y,size,type,seed)=>({x,y,size,type,seed,createdStep:gardenSteps,born:sceneTime,bloom:1,goal:1,autoAt:0});flowers=[];stems=[];sceneTime=10;gardenSteps=0',ctx);
let early=0,late=0;
for(let i=0;i<900;i++){
 ctx.step=i;vm.runInContext('sceneTime+=1;advanceGardenStep();pruneGarden();placeBranchNear({x:350+(step%14)*38,y:270+Math.floor(step/14)%6*45},0,millis())',ctx);
 if(i%12===0){const f=vm.runInContext('advanceGardenStep(3);placeParticleFlower(450+(step%3)*100,360+(step%2)*100,"random")',ctx);if(f){if(i<120)early++;else late++;}}
 assert(vm.runInContext('stems.filter(isGrowing).length<=54 && flowers.filter(isGrowing).length<=14',ctx),'Active scene must remain bounded');
}
assert(early>0&&late>0,'Flowers must still grow late in a long session');assert(vm.runInContext('userPlantings>14',ctx),'Cumulative creations must exceed visible budget');assert(vm.runInContext('stems.length<110 && flowers.length<45',ctx),'Faded objects must release their textures/references');
vm.runInContext('flowers=[];stems=[];gardenSteps=0;sceneTime=0;var oldFlower=makeParticleFlower(500,350,40,"veil",8);flowers.push(oldFlower);retirePlant(oldFlower)',ctx);assert.equal(vm.runInContext('plantOpacity(oldFlower)',ctx),1);
vm.runInContext('sceneTime=6',ctx);assert.equal(vm.runInContext('plantOpacity(oldFlower)',ctx),.5);vm.runInContext('sceneTime=12;pruneGarden()',ctx);assert.equal(vm.runInContext('flowers.length',ctx),0);
// 大花优先保留，移动造成的生长步数不会在一分钟内清走主花。
vm.runInContext('sceneTime=0;gardenSteps=0;flowers=[{size:150,born:0,createdStep:0},{size:35,born:0,createdStep:0}];stems=[];gardenSteps=250;sceneTime=35;maintainGarden()',ctx);
assert(vm.runInContext('isGrowing(flowers[0]) && !isGrowing(flowers[1])',ctx),'Large flower outlives smaller flower');
vm.runInContext('flowers=[];stems=[];sceneTime=20',ctx);
// 失败的按下也只消费一次，松开后可以再次播种。
vm.runInContext('gardenSteps=0;filteredHand=null;resetPlantGesture();var actualPlant=placeParticleFlower;placeParticleFlower=()=>null;handleParticleInteraction(millis())',ctx);
ctx.mouseIsPressed=true;now=2101;vm.runInContext('handleParticleInteraction(millis())',ctx);assert.equal(vm.runInContext('plantGesture.armed',ctx),false);
vm.runInContext('placeParticleFlower=actualPlant',ctx);now=3202;vm.runInContext('handleParticleInteraction(millis())',ctx);assert.equal(vm.runInContext('flowers.length',ctx),0,'Holding after failure must not auto plant');
ctx.mouseIsPressed=false;vm.runInContext('handleParticleInteraction(millis())',ctx);ctx.mouseIsPressed=true;now+=500;vm.runInContext('handleParticleInteraction(millis())',ctx);assert.equal(vm.runInContext('flowers.length',ctx),1,'Release must allow retry');
console.log('PASS: 900-step continued growth, late flower creation, bounded active plants, gradual fade and cleanup, failed press can retry after release.');
