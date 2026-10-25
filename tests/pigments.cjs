const fs=require('fs'),vm=require('vm'),assert=require('assert'),path=require('path');
const pen=new Proxy({}, {get:(o,k)=>o[k]??(()=>{}),set:(o,k,v)=>(o[k]=v,true)});
const ctx={window:{addEventListener(){}},document:{getElementById:()=>null,createElement:()=>({getContext:()=>pen})},width:1000,height:700,Math};vm.createContext(ctx);vm.runInContext(fs.readFileSync(path.join(__dirname,'..','sketch.js'),'utf8'),ctx);
for(let run=0;run<20;run++){
 vm.runInContext('userPlantings=0;plantingColors=[];openingColorOrder=OPENING_COLOR_ORDERS['+(run%4)+'].slice()',ctx);
 const colors=[];for(let i=0;i<30;i++){ctx.seed=i*997+run*37;const color=vm.runInContext('var next=nextPlantingScheme(seed);plantingColors.push(next);userPlantings++;next',ctx);colors.push(color);}
 assert.equal(new Set(colors.slice(0,7)).size,7);for(let i=0;i<colors.length-2;i++)assert.equal(new Set(colors.slice(i,i+3)).size,3,'Consecutive three must have different dominant hues');
}
vm.runInContext('userPlantings=0;plantingForms=[];flowers=[]',ctx);const forms=[];for(let i=0;i<7;i++){const form=vm.runInContext('nextFlowerForm(true,160,()=>.2)',ctx);ctx.chosen=form;vm.runInContext('plantingForms.push(chosen);userPlantings++',ctx);forms.push(form);}assert.equal(new Set(forms).size,7,'First seven large forms must be unique even after old flowers fade');
for(const form of forms){ctx.form=form;const flower=vm.runInContext('makeParticleFlower(500,350,160,form,111,"azure")',ctx);assert(flower.petals.length>=12&&new Set(flower.petals.map(p=>p.angle.toFixed(1))).size>5,'Each new large form has a developed, varied structure');}
const f=vm.runInContext('makeParticleFlower(500,350,170,"coral",101,"seafoam")',ctx);assert.equal(f.scheme,'seafoam');assert(new Set(f.petals.map(p=>p.scheme)).size===3,'Large flower must have a main palette and two localized companion palettes');assert(f.petals.filter(p=>p.scheme===f.scheme).length/f.petals.length>.6,'Main color should remain dominant');assert(f.stamens.length>0&&f.petals.length>=29,'Detailed flower retains layers and fine stamens');
console.log('PASS: seven opening hues and seven distinct large flower forms, no duplicates among any three consecutive plantings, dominant pigment with two companion palettes, layered petals and fine stamens.');
