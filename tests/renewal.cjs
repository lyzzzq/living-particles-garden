const fs=require('fs'),vm=require('vm'),assert=require('assert'),path=require('path');let now=1000;
const pen=new Proxy({}, {get:(o,k)=>o[k]??(()=>{}),set:(o,k,v)=>(o[k]=v,true)});pen.createRadialGradient=()=>({addColorStop(){}});
const ctx={window:{addEventListener(){}},document:{getElementById:()=>null,createElement:()=>({getContext:()=>pen})},drawingContext:pen,width:1000,height:700,millis:()=>now,Math,lerp:(a,b,t)=>a+(b-a)*t,keyIsDown:()=>false,mouseX:500,mouseY:350};vm.createContext(ctx);vm.runInContext(fs.readFileSync(path.join(__dirname,'..','sketch.js'),'utf8'),ctx);
// 模拟长时间创作，用轻量花数据隔离高成本纹理生成，原有花型检查单独保留。
vm.runInContext('makeParticleFlower=(x,y,size,type,seed)=>({x,y,size,type,seed,createdStep:gardenSteps,born:sceneTime,bloom:1,goal:1,autoAt:0});flowers=[];stems=[];sceneTime=10;gardenSteps=0',ctx);
let early=0,late=0;
for(let i=0;i<260;i++){
 ctx.step=i;vm.runInContext('sceneTime+=.3;advanceGardenStep();pruneGarden();placeBranchNear({x:350+(step%14)*38,y:270+Math.floor(step/14)%6*45},0,millis())',ctx);
 if(i%12===0){const f=vm.runInContext('advanceGardenStep(3);placeParticleFlower(450+(step%3)*100,360+(step%2)*100,"random")',ctx);if(f){if(i<120)early++;else late++;}}
 assert(vm.runInContext('stems.filter(isGrowing).length<=54 && flowers.filter(isGrowing).length<=14',ctx),'Active scene must remain bounded');
}
assert(early>0&&late>0,'Flowers must still grow late in a long session');assert(vm.runInContext('userPlantings>14',ctx),'Cumulative creations must exceed visible budget');assert(vm.runInContext('stems.length<90 && flowers.length<30',ctx),'Faded objects must release their textures/references');
vm.runInContext('flowers=[];stems=[];gardenSteps=0;sceneTime=0;var oldFlower=makeParticleFlower(500,350,40,"veil",8);flowers.push(oldFlower);retirePlant(oldFlower)',ctx);assert.equal(vm.runInContext('plantOpacity(oldFlower)',ctx),1);
vm.runInContext('sceneTime=2',ctx);assert.equal(vm.runInContext('plantOpacity(oldFlower)',ctx),.5);vm.runInContext('sceneTime=4;pruneGarden()',ctx);assert.equal(vm.runInContext('flowers.length',ctx),0);
// 失败的按下也只消费一次，松开后可以再次播种。
vm.runInContext('gardenSteps=0;filteredHand=null;resetPlantGesture();var actualPlant=placeParticleFlower;placeParticleFlower=()=>null;handleParticleInteraction(millis())',ctx);
ctx.mouseIsPressed=true;now=2101;vm.runInContext('handleParticleInteraction(millis())',ctx);assert.equal(vm.runInContext('plantGesture.armed',ctx),false);
vm.runInContext('placeParticleFlower=actualPlant',ctx);now=3202;vm.runInContext('handleParticleInteraction(millis())',ctx);assert.equal(vm.runInContext('flowers.length',ctx),0,'Holding after failure must not auto plant');
ctx.mouseIsPressed=false;vm.runInContext('handleParticleInteraction(millis())',ctx);ctx.mouseIsPressed=true;now+=500;vm.runInContext('handleParticleInteraction(millis())',ctx);assert.equal(vm.runInContext('flowers.length',ctx),1,'Release must allow retry');
console.log('PASS: 260-step continued growth, late flower creation, bounded active plants, gradual fade and cleanup, failed press can retry after release.');
