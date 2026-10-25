const fs=require('fs'),vm=require('vm'),assert=require('assert'),path=require('path');
let contexts=0;const params=[];class Param{constructor(value=0){this.value=value;params.push(this);}setValueAtTime(v){this.value=v;}linearRampToValueAtTime(v){this.value=v;}exponentialRampToValueAtTime(v){this.value=v;}setTargetAtTime(v){this.value=v;}}
class Node{constructor(){for(const k of ['gain','frequency','detune','Q','threshold','knee','ratio'])this[k]=new Param();this.connections=[];}connect(node){this.connections.push(node);}disconnect(){this.connections=[];}start(t){this.startAt=t||0;}stop(t){this.stopAt=t;}}
class Audio{constructor(){contexts++;this.currentTime=1;this.sampleRate=1000;this.state='suspended';this.destination=new Node();}createGain(){return new Node();}createDynamicsCompressor(){return new Node();}createConvolver(){return new Node();}createBiquadFilter(){return new Node();}createBufferSource(){return new Node();}createOscillator(){return new Node();}createBuffer(ch,length){const buffers=Array.from({length:ch},()=>new Float32Array(length));return {getChannelData:i=>buffers[i]};}async resume(){this.state='running';}async suspend(){this.state='suspended';}}
const elements={sound:{setAttribute(k,v){this[k]=v;}},'sound-state':{},'volume-value':{}};
const sandbox={window:{AudioContext:Audio,addEventListener(){}},document:{getElementById:id=>elements[id]},Math};vm.createContext(sandbox);vm.runInContext(fs.readFileSync(path.join(__dirname,'..','sketch.js'),'utf8'),sandbox);
const sound=vm.runInContext('gardenSound',sandbox);
(async()=>{
assert.equal(contexts,0,'No sound before a user click');sound.plant({seed:1,size:130});assert.equal(contexts,0);
await sound.toggle();assert.equal(contexts,1);assert.equal(sound.ctx.state,'running');assert(sound.enabled);assert.equal(elements.sound['aria-pressed'],'true');
sound.motion({x:100,y:100},1000);sound.motion({x:200,y:100},1100);assert(sound.airGain.gain.value>.008,'Movement wind is audible above the background');assert.equal(sound.voices.size,0,'Movement does not immediately rush into a note');
for(let i=1;i<=50;i++)sound.motion({x:200+i*20,y:100},1100+i*50);
assert(sound.voices.size>0&&sound.voices.size<=2,'Moving notes remain slow and sparse');
const movingCount=sound.voices.size;for(let i=1;i<=60;i++)sound.motion({x:1200,y:100},3600+i*50);assert.equal(sound.voices.size,movingCount,'Stationary hand cannot release accumulated notes');
sound.motion(null,7000);for(const voice of [...sound.voices])voice.onended();
const originalBell=sound.bell;let movementEvents=[];sound.bell=(...args)=>movementEvents.push(args);
function measureTempo(step){movementEvents=[];sound.previous=null;sound.motionTravel=0;sound.lastMotionNote=null;sound.motionSpeed=0;for(let i=0;i<=200;i++)sound.motion({x:100+i*step,y:100},10000+i*50);return {notes:movementEvents.length,wind:sound.airGain.gain.value,filter:sound.airFilter.frequency.value};}
const slow=measureTempo(2),fast=measureTempo(25);assert(fast.wind>slow.wind&&fast.filter>slow.filter,'Wind grows louder and brighter with faster movement');assert(slow.notes>=3&&fast.notes>slow.notes&&fast.notes<=11,'Faster hand movement must play more notes than slow movement, without becoming frantic');sound.bell=originalBell;sound.motion(null,22000);
sound.plant({seed:12,size:145});assert.equal(sound.voices.size,4,'A large flower gets a short layered chime');
const gestureNotes=[];sound.bell=function(...args){gestureNotes.push(args);return originalBell.apply(this,args);};sound.gesture('open',2000);assert(gestureNotes[0][2]>=.15&&gestureNotes[3][0]>gestureNotes[0][0],'Bloom sound is prominent and rises');assert.equal(sound.padFilter.frequency.value,1600);const count=sound.voices.size;sound.gesture('fist',2100);assert.equal(sound.voices.size,count,'Gesture jitter cannot flood notes');sound.gesture('fist',3000);assert.equal(sound.padFilter.frequency.value,260);assert(gestureNotes[5][2]>=.13&&gestureNotes[8][0]<gestureNotes[5][0],'Closure is prominent and descends');sound.bell=originalBell;
for(let i=0;i<100;i++)sound.plant({seed:i,size:145});assert(sound.voices.size<=18,'Polyphony is bounded');for(const voice of [...sound.voices])voice.onended();assert.equal(sound.voices.size,0,'Finished voices are disconnected');
sound.setVolume(0);assert.equal(sound.master.gain.value,0);sound.setVolume(50);assert.equal(sound.master.gain.value,.19);sound.setVolume('invalid');assert.equal(sound.volume,.5);
await sound.toggle();assert(!sound.enabled);assert.equal(sound.ctx.state,'suspended');sound.plant({seed:2,size:145});assert.equal(sound.voices.size,0);
await sound.toggle();assert.equal(contexts,1,'Re-enable reuses context');await sound.hide();assert(!sound.enabled);assert.equal(sound.ctx.state,'suspended');
await sound.toggle();sound.ctx.currentTime=sound.nextBackground+.1;sound.motion(null,4000);assert.equal(sound.voices.size,2,'Quiet background melody must play without moving');sound.motion(null,4100);assert.equal(sound.voices.size,2,'No background note flood per frame');await sound.hide();
console.log('PASS: quiet background melody and interval;  click-to-start, speed-responsive slow movement notes, no stationary notes, prominent rising/falling gesture sounds and cooldown, silence on lost input, flower chimes, gesture cooldown, bounded and cleaned voices, volume, mute/re-enable, background pause.');
})().catch(e=>{console.error(e);process.exitCode=1;});
