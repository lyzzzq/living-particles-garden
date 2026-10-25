const fs=require('fs'),vm=require('vm'),assert=require('assert'),path=require('path');
const pen=new Proxy({}, {get:(o,k)=>o[k]??(()=>{}),set:(o,k,v)=>(o[k]=v,true)});
const ctx={window:{addEventListener(){}},document:{getElementById:()=>null,createElement:()=>({getContext:()=>pen})},width:1000,height:700,Math};vm.createContext(ctx);vm.runInContext(fs.readFileSync(path.join(__dirname,'..','sketch.js'),'utf8'),ctx);
for(let run=0;run<20;run++){
 vm.runInContext('userPlantings=0;plantingColors=[];openingColorOrder=OPENING_COLOR_ORDERS['+(run%4)+'].slice()',ctx);
 const colors=[];for(let i=0;i<30;i++){ctx.seed=i*997+run*37;const color=vm.runInContext('var next=nextPlantingScheme(seed);plantingColors.push(next);userPlantings++;next',ctx);colors.push(color);}
 assert.equal(new Set(colors.slice(0,4)).size,4);for(let i=0;i<colors.length-2;i++)assert.equal(new Set(colors.slice(i,i+3)).size,3,'Consecutive three must have different dominant hues');
}
const f=vm.runInContext('makeParticleFlower(500,350,170,"coral",101,"seafoam")',ctx);assert.equal(f.scheme,'seafoam');assert(new Set(f.petals.map(p=>p.scheme)).size===3,'Large flower must have a main palette and two localized companion palettes');assert(f.petals.filter(p=>p.scheme===f.scheme).length/f.petals.length>.6,'Main color should remain dominant');assert(f.stamens.length>0&&f.petals.length>=29,'Detailed flower retains layers and fine stamens');
console.log('PASS: four opening hues, no duplicates among any three consecutive plantings, dominant pigment with two companion palettes, layered petals and fine stamens.');
