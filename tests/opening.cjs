const fs=require('fs'),vm=require('vm'),assert=require('assert'),path=require('path');
const ctx={window:{addEventListener(){}},document:{getElementById:()=>null},width:1000,height:700,Math};vm.createContext(ctx);vm.runInContext(fs.readFileSync(path.join(__dirname,'..','sketch.js'),'utf8'),ctx);
vm.runInContext('makeParticleFlower=(x,y,size,type,seed,scheme)=>({x,y,size,type,seed,scheme,createdStep:gardenSteps,bloom:0,goal:1,autoAt:0});addBranchGroup=()=>{}',ctx);
for(const [w,h,x,y] of [[1000,700,500,350],[1280,720,640,360],[1000,700,950,500],[390,844,220,430]]){
 ctx.width=w;ctx.height=h;ctx.x=x;ctx.y=y;vm.runInContext('resetScene()',ctx);const planted=[];
 for(let i=0;i<4;i++){const f=vm.runInContext('advanceGardenStep(3);placeParticleFlower(x,y,"random")',ctx);assert(f,'Opening planting '+(i+1)+' must fit or make room at '+w+'x'+h);planted.push(f);}
 assert(new Set(planted.map(f=>f.scheme)).size===4,'Opening four flowers must have different dominant color families');
 assert(planted[1].size>100&&planted[3].size>100,'Second and fourth need large flowers');
 assert(planted[1].goal>=.8&&planted[3].goal>=.8,'Opening main flowers should visibly unfurl without waiting for another gesture');
 assert.notEqual(planted[1].type,planted[3].type,'Early main flowers should use different forms');
 assert(vm.runInContext('flowers.filter(f=>f.openingMain&&isGrowing(f)).length',ctx)>=2,'Both main flowers must stay visible');
 assert(planted[0].size<=75 && planted[2].size<=50,'Medium and small flowers must separate the large flowers');
}
vm.runInContext('resetScene()',ctx);ctx.width=1280;ctx.height=900;const sizes=[];for(let i=0;i<7;i++){ctx.x=300+(i%3)*300;ctx.y=300+Math.floor(i/3)*190;vm.runInContext('flowers=[];stems=[];advanceGardenStep(3)',ctx);const f=vm.runInContext('placeParticleFlower(x,y,"random")',ctx);assert(f);sizes.push(f.size);}assert.deepEqual(sizes.map(s=>s>75),[false,true,false,true,false,true,false],'First seven large flowers must alternate with smaller flowers');
console.log('PASS: first four plantings form medium/large/small/large rhythm; repeated positions, edges and phone layout retain two varied, visibly unfurling main flowers.');

