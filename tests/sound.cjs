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
sound.motion({x:100,y:100},1000);sound.motion({x:200,y:100},1100);assert.equal(sound.airGain.gain.value,.008);assert.equal(sound.voices.size,1,'Movement makes a quiet note');sound.motion({x:260,y:100},1150);assert.equal(sound.voices.size,1,'Movement note cooldown');sound.motion(null,1200);assert.equal(sound.airGain.gain.value,.008);for(const voice of [...sound.voices])voice.onended();
sound.plant({seed:12,size:145});assert.equal(sound.voices.size,4,'A large flower gets a short layered chime');
sound.gesture('open',2000);assert.equal(sound.padFilter.frequency.value,1600);const count=sound.voices.size;sound.gesture('fist',2100);assert.equal(sound.voices.size,count,'Gesture jitter cannot flood notes');sound.gesture('fist',3000);assert.equal(sound.padFilter.frequency.value,260);
for(let i=0;i<100;i++)sound.plant({seed:i,size:145});assert(sound.voices.size<=18,'Polyphony is bounded');for(const voice of [...sound.voices])voice.onended();assert.equal(sound.voices.size,0,'Finished voices are disconnected');
sound.setVolume(0);assert.equal(sound.master.gain.value,0);sound.setVolume(50);assert.equal(sound.master.gain.value,.19);sound.setVolume('invalid');assert.equal(sound.volume,.5);
await sound.toggle();assert(!sound.enabled);assert.equal(sound.ctx.state,'suspended');sound.plant({seed:2,size:145});assert.equal(sound.voices.size,0);
await sound.toggle();assert.equal(contexts,1,'Re-enable reuses context');await sound.hide();assert(!sound.enabled);assert.equal(sound.ctx.state,'suspended');
await sound.toggle();sound.ctx.currentTime=sound.nextBackground+.1;sound.motion(null,4000);assert.equal(sound.voices.size,2,'Quiet background melody must play without moving');sound.motion(null,4100);assert.equal(sound.voices.size,2,'No background note flood per frame');await sound.hide();
console.log('PASS: quiet background melody and interval;  click-to-start, sparse movement notes and cooldown, silence on lost input, flower chimes, gesture cooldown, bounded and cleaned voices, volume, mute/re-enable, background pause.');
})().catch(e=>{console.error(e);process.exitCode=1;});
