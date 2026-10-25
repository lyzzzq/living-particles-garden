const fs=require('fs'),vm=require('vm'),assert=require('assert'),path=require('path');
const ctx={window:{addEventListener(){}},document:{getElementById:()=>null},width:1000,height:700,Math};vm.createContext(ctx);vm.runInContext(fs.readFileSync(path.join(__dirname,'..','sketch.js'),'utf8'),ctx);
vm.runInContext('makeParticleFlower=(x,y,size,type,seed)=>({x,y,size,type,seed,createdStep:gardenSteps,bloom:0,goal:1,autoAt:0});addBranchGroup=()=>{}',ctx);
for(const [w,h,x,y] of [[1000,700,500,350],[1280,720,640,360],[1000,700,950,500],[390,844,220,430]]){
 ctx.width=w;ctx.height=h;ctx.x=x;ctx.y=y;vm.runInContext('resetScene()',ctx);const planted=[];
 for(let i=0;i<4;i++){const f=vm.runInContext('advanceGardenStep(3);placeParticleFlower(x,y,"random")',ctx);assert(f,'Opening planting '+(i+1)+' must fit or make room at '+w+'x'+h);planted.push(f);}
 assert(planted[1].size>100&&planted[2].size>100,'Second and third need large flowers');
 assert(planted[1].goal>=.8&&planted[2].goal>=.8,'Opening main flowers should visibly unfurl without waiting for another gesture');
 assert.notEqual(planted[1].type,planted[2].type,'Early main flowers should use different forms');
 assert(vm.runInContext('flowers.filter(f=>f.openingMain&&isGrowing(f)).length',ctx)>=2,'Both main flowers must stay visible');
 assert(planted[3].size<planted[1].size,'Fourth planting restores size hierarchy');
}
console.log('PASS: first four plantings form medium/large/large/smaller rhythm; repeated positions, edges and phone layout retain two varied, visibly unfurling main flowers.');
