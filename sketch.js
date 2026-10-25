// 指尖花园：p5.js 负责画面，ml5.js Hand Pose 负责手部关键点。
// 不在 preload 中加载模型，鼠标模式可以立即开始使用。
let flowers = [], hands = [];
let video, handPose, cameraStream;
let mode = 'mouse', cameraReady = false, startingCamera = false;
let cameraPreviewReady = false, lastDetectionState = '';
let trackingSession = 0, detectionFrames = 0;
let inferenceMs=0;
let trackingRuntime='tfjs';
let lastTrackedVideoTime=-1;
function withTimeout(promise, milliseconds, message) {
  let timer;
  return Promise.race([promise,new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error(message)),milliseconds);})]).finally(()=>clearTimeout(timer));
}
let cursorPoint = null;

function setup(){
  const canvas=createCanvas(window.innerWidth,window.innerHeight);
  canvas.parent('canvas-container');pixelDensity(1);frameRate(45);
  canvas.elt.addEventListener('pointerdown',event=>{if(mode==='mouse'&&event.button===0)pendingMousePlant={x:event.clientX,y:event.clientY};});
  document.getElementById('camera').addEventListener('click',startCamera);
  document.getElementById('mouse').addEventListener('click',()=>{mode='mouse';hands=[];filteredHand=null;resetPlantGesture();document.getElementById('mouse').setAttribute('aria-pressed','true');updateParticleCount();setStatus('点击种花，大小随机 · 空格张掌绽放 · F 键握拳闭合');});
  document.getElementById('clear').addEventListener('click',resetScene);
  document.getElementById('save').addEventListener('click',saveParticleArtwork);
  setupGardenSound();
  resetScene();
}

function setStatus(message) { const el = document.getElementById('status'); if (el) el.textContent = message; }

async function startCamera() {
  if (startingCamera) return;
  trackingSession++; cameraReady=false; hands=[];
  document.getElementById('tracking-overlay')?.remove();
  const button = document.getElementById('camera');
  startingCamera = true; if (button) button.disabled = true;
  setStatus('第 1 步：正在请求摄像头，请允许浏览器访问。');
  try {
    if (!navigator.mediaDevices?.getUserMedia) throw new Error('请通过 localhost 或 HTTPS 打开网页');
    // 重试之前停止上一次的视频，避免摄像头被本页面重复占用。
    cameraStream?.getTracks().forEach(track=>track.stop());
    video?.remove(); cameraPreviewReady=false;
    cameraStream = await navigator.mediaDevices.getUserMedia({video: {width:{ideal:320}, height:{ideal:240},frameRate:{ideal:30,max:30}}, audio:false});
    video = createVideo([]); video.hide();
    video.elt.muted = true; video.elt.setAttribute('playsinline', '');
    const loaded = new Promise((resolve,reject)=>{
      video.elt.addEventListener('loadeddata',resolve,{once:true});
      video.elt.addEventListener('error',()=>reject(new Error('摄像头画面读取失败')),{once:true});
    });
    video.elt.srcObject = cameraStream;
    await withTimeout(video.elt.play(),15000,'摄像头无法播放，请检查是否被其他软件占用');
    if(video.elt.readyState<2) await withTimeout(loaded,15000,'没有收到摄像头画面，请检查 Windows 摄像头隐私设置');
    video.size(320,240); cameraPreviewReady=true;
    video.elt.style.cssText='display:block;position:fixed;right:20px;top:90px;width:160px;height:120px;object-fit:cover;transform:scaleX(-1);z-index:4;border:1px solid #a99ad8;border-radius:12px;pointer-events:none';
    setStatus('第 2 步：摄像头已开启，右上角应有画面。正在加载手势模型…');
    if(typeof ml5==='undefined') throw new Error('摄像头正常，但 ml5.js 未加载，请检查网络后刷新');
    trackingSession++; hands=[]; detectionFrames=0;
    lastTrackedVideoTime=-1;
    const tracker=await loadHandTracker(video.elt);
    handPose=tracker.model;hands=tracker.results;trackingRuntime=tracker.runtime;
    detectionFrames=1;
    cameraReady = true; mode = 'hand';resetPlantGesture();updateParticleCount();
    document.getElementById('mouse')?.setAttribute('aria-pressed', 'false');
    if (button) button.textContent = '重新识别';
    lastDetectionState='';
    setStatus(hands.length?'已找到手：张掌种花并绽放，食指移动引藤，握拳闭合。':'识别运行正常，尚未找到手。请将手掌放入右上角画面。');
    detectionLoop(trackingSession);
  } catch (error) {
    if(!cameraPreviewReady){cameraStream?.getTracks().forEach(track=>track.stop());video?.remove();video=null;}
    cameraReady=false; mode='mouse';
    const reasons={NotAllowedError:'摄像头被浏览器或 Windows 阻止，请检查两处权限',NotFoundError:'未找到摄像头，请检查设备连接',NotReadableError:'摄像头无法读取，可能正被其他软件占用'};
    const reason = reasons[error.name] || error.message;
    setStatus(`无法启动：${reason}。仍可用鼠标培育植物。`);
  } finally { startingCamera = false; if (button) button.disabled = false; }
}

async function loadHandTracker(source){
  let lastError;
  for(const runtime of ['mediapipe','tfjs']){
    try{
      setStatus(runtime==='mediapipe'?'第 2 步：加载实时手势模式…':'第 2 步：实时模式不可用，正在加载兼容模式…');
      const model=await withTimeout(Promise.resolve(ml5.handPose({maxHands:1,modelType:'lite',runtime,flipped:false})),35000,'模型初始化超时');
      if(model.ready)await withTimeout(model.ready,35000,'模型文件下载超时');
      setStatus('第 3 步：模型已加载，正在确认识别画面…');
      const results=await withTimeout(model.detect(source),15000,'模型未返回识别结果');
      return {model,results,runtime};
    }catch(error){lastError=error;}
  }
  throw lastError||new Error('手势识别启动失败');
}

// 顺序处理视频帧，捕获异步识别错误，避免失败后界面一直假装在运行。
async function detectionLoop(session) {
  if(session!==trackingSession || !cameraReady)return;
  const timestamp=video?.elt?.currentTime;
  if(Number.isFinite(timestamp)&&timestamp===lastTrackedVideoTime){setTimeout(()=>detectionLoop(session),10);return;}
  if(Number.isFinite(timestamp))lastTrackedVideoTime=timestamp;
  try {
    const started=performance.now();
    const result=await withTimeout(handPose.detect(video.elt),15000,'识别无响应，请点击重新识别');
    if(session!==trackingSession)return;
    hands=result;detectionFrames++;inferenceMs=performance.now()-started;
    const meter=document.getElementById('tracking-speed');
    if(meter)meter.textContent=`${trackingRuntime==='mediapipe'?'实时':'兼容'}模式 · 单次识别 ${Math.round(inferenceMs)} 毫秒`;
    paintTrackingOverlay();
    if(mode==='hand') {
      const state=hands.length?'found':'searching';
      if(state!==lastDetectionState){lastDetectionState=state;setStatus(hands.length?'已识别到手 · 张掌种花并绽放 · 握拳闭合':'识别运行中，未找到手。请把手掌完整放入镜头，掌心朝向摄像头。');}
    }
    // 保留单次推理在途，完成后立即让出主线程并处理最新视频帧，不累积旧帧。
    setTimeout(()=>detectionLoop(session),0);
  } catch(error) {
    if(session!==trackingSession)return;
    cameraReady=false;mode='mouse';hands=[];
    setStatus(`摄像头正常，手部识别失败：${error.message}。点击重新识别可重试。`);
  }
}

function paintTrackingOverlay() {
  let overlay=document.getElementById('tracking-overlay');
  if(!overlay){overlay=document.createElement('canvas');overlay.id='tracking-overlay';overlay.width=320;overlay.height=240;overlay.style.cssText='position:fixed;right:20px;top:90px;width:160px;height:120px;z-index:5;pointer-events:none;transform:scaleX(-1)';document.body.appendChild(overlay);}
  const c=overlay.getContext('2d');c.clearRect(0,0,320,240);
  const sx=320/(video.elt.videoWidth||640),sy=240/(video.elt.videoHeight||480);
  c.strokeStyle='#f5df70';c.fillStyle='#fff5ba';c.lineWidth=2;
  for(const hand of hands){const k=hand.keypoints;for(const chain of [[0,1,2,3,4],[0,5,6,7,8],[5,9,13,17,0],[0,9,10,11,12],[0,13,14,15,16],[0,17,18,19,20]]){c.beginPath();chain.forEach((i,j)=>j?c.lineTo(k[i].x*sx,k[i].y*sy):c.moveTo(k[i].x*sx,k[i].y*sy));c.stroke();}for(const p of k){c.beginPath();c.arc(p.x*sx,p.y*sy,2.5,0,7);c.fill();}}
}




function readGesture(k){
  if(!k || k.length<21)return {open:false,fist:false,canRearm:false};
  const wrist=k[0],palm=max(12,dist(wrist.x,wrist.y,k[9].x,k[9].y));
  const extended=[8,12,16,20].filter(i=>dist(k[i].x,k[i].y,wrist.x,wrist.y)>dist(k[i-2].x,k[i-2].y,wrist.x,wrist.y)*1.055).length;
  const curled=[8,12,16,20].filter(i=>dist(k[i].x,k[i].y,wrist.x,wrist.y)<dist(k[i-2].x,k[i-2].y,wrist.x,wrist.y)*.95).length;
  const fist=curled>=3 && dist(k[8].x,k[8].y,wrist.x,wrist.y)<palm*1.15;
  const spread=dist(k[8].x,k[8].y,k[20].x,k[20].y)>palm*.4;
  return {fist,open:!fist&&extended>=3&&spread,canRearm:extended<=2};
}
function butterflyMotion(state,point,now){
  const dt=Math.min(.08,Math.max(.001,(now-(state.time??now-16))/1000));state.time=now;
  const distance=point&&state.lastPoint?Math.hypot(point.x-state.lastPoint.x,point.y-state.lastPoint.y):0;
  const speed=distance<1.8?0:Math.min(800,distance/dt);
  state.speed=(state.speed||0)*.85+speed*.15;
  if(point){state.lastPoint={...point};state.x=lerp(state.x,point.x,1-Math.exp(-dt*17));state.y=lerp(state.y,point.y,1-Math.exp(-dt*17));}
  const activity=Math.max(0,Math.min(1,(state.speed-12)/450));
  state.phase=(state.phase||0)+dt*activity*(.3+activity*.5)*Math.PI*2;
  // 放大开合幅度但降低频率；静止时舒展停留，不追随关键点抖动。
  state.fold=lerp(state.fold??.92,.92-activity*.3+Math.sin(state.phase)*activity*.55,Math.min(1,dt*8));
  return activity;
}
// 黑底粒子植物：手势改变生长状态，作品自身保留呼吸与流动。
let stems=[], ambient=[], vineLinks=[], filteredHand=null,userPlantings=0;
let pendingMousePlant=null;
let plantGesture={armed:false,lastAttempt:-Infinity,flashUntil:0,message:''};
let gardenSteps=0;
let plantingColors=[],openingColorOrder=[];
const OPENING_COLOR_ORDERS=[['ivory','blush','seafoam','violet'],['vermilion','violet','ivory','seafoam'],['seafoam','vermilion','violet','ivory'],['blush','seafoam','ivory','vermilion']];
function nextPlantingScheme(seed){
  if(userPlantings<4)return openingColorOrder[userPlantings]||OPENING_COLOR_ORDERS[0][userPlantings];
  const recent=plantingColors.slice(-2),choices=['blush','violet','ivory','vermilion','seafoam'].filter(s=>!recent.includes(s));
  const r=seeded(seed+87251);r();return choices[Math.floor(r()*choices.length)];
}
function mixPigment(a,b,t){
  t=Math.max(0,Math.min(1,t));const channels=[1,3,5].map(i=>Math.round(parseInt(a.slice(i,i+2),16)*(1-t)+parseInt(b.slice(i,i+2),16)*t));
  return '#'+channels.map(n=>n.toString(16).padStart(2,'0')).join('');
}
const petalDepth={blush:['#9d4c81','#fff0e4'],rose:['#95447f','#f8e3f1'],violet:['#655081','#f0e6fa'],ivory:['#b4a781','#fff7dd'],vermilion:['#af625f','#ffe5bc'],apricot:['#ad7d8a','#fff0d6'],amber:['#ac7f42','#fff2c9'],seafoam:['#427f7d','#e4f3d9'],leaf:['#54806b','#dbe5aa']};

const GARDEN_FADE_SECONDS=12;
function isGrowing(item){return item.retireAt==null;}
function plantOpacity(item){
  if(isGrowing(item))return 1;
  const t=Math.max(0,Math.min(1,(sceneTime-item.retireAt)/GARDEN_FADE_SECONDS));
  return 1-t*t*(3-2*t);
}
function retirePlant(item){if(isGrowing(item))item.retireAt=sceneTime;}
function maintainGarden(){
  for(const s of stems)if(gardenSteps-(s.createdStep??0)>110)retirePlant(s);
  for(const f of flowers)if(gardenSteps-(f.createdStep??0)>(f.size>75?360:200)&&sceneTime-(f.born??0)>(f.size>75?60:30))retirePlant(f);
  const flowerBudget=Math.max(6,Math.min(14,Math.floor(width*height/55000)));
  for(const [items,limit] of [[stems,54],[flowers,flowerBudget]]){
    const active=items.filter(isGrowing).sort((a,b)=>(items===flowers?Number(a.size>75)-Number(b.size>75):0)||(a.createdStep??0)-(b.createdStep??0));
    for(let i=0;i<active.length-limit;i++)retirePlant(active[i]);
  }
}
function advanceGardenStep(amount=1){gardenSteps+=amount;maintainGarden();}
function pruneGarden(){
  const before=flowers.length+stems.length;
  flowers=flowers.filter(f=>plantOpacity(f)>0);stems=stems.filter(s=>plantOpacity(s)>0);
  if(before!==flowers.length+stems.length){rebuildVineLinks();updateParticleCount();}
}

let gestureMotes=[],feedbackAnchor=null,liveVineTip=null,liveVineLength=0;
let butterfly={x:0,y:0,visible:0}, currentGesture='move', lastFrame=0, sceneTime=0;
let lastBranch=0, branchAnchor=null, lastOpen=0, lastBloomPoint=null, movementHeading=-1;
const flowerForms=['plume','veil','drift','coral','orchid','seed'];
const petalPalettes={
  blush:['#efb0c6','#e893c0','#f7d1d7','#e877b5','#f2b2ca'],
  ivory:['#fff1c6','#f4d98f','#f9e9b5','#ead2a1','#fff6da'],
  violet:['#bc9fe7','#dcc4f0','#a494da','#e2c1ed','#a3b4ed'],
  vermilion:['#f0a47c','#f58c72','#efbd92','#e87575','#ffd7ac'],
  rose:['#e38dc4','#edb1d6','#d775b6','#eac1e0','#c996d6'],
  amber:['#ebc76b','#f4dc99','#e9ac64','#f9eab8','#e4cf89'],
  apricot:['#f0d8ba','#eecbbf','#f7e2cd','#e2b3b4','#e8c19a'],
  seafoam:['#8ed1bb','#6bbba9','#d3e8c7','#8fb8c6','#b7dbac'],
  leaf:['#a6c45e','#bdd65f','#d3dd87','#97bb53','#78ab5a']
};
const pigmentAccents={seafoam:['#d9b8d0','#a9b5cf','#d4da9a'],blush:['#99aca0','#bec9b0','#d0b9df'],ivory:['#a6bb91','#e2c4cb','#c8ad8d'],apricot:['#9eb6a1','#d3b8cc','#b9b9d1'],violet:['#93ada3','#e6c1d3','#9bafcf'],vermilion:['#a2ad91','#eac8ac','#caabcb'],rose:['#92ad9d','#c2cbb8','#ad8ec0'],amber:['#a0b991','#d9b4c9','#d8bd8b'],leaf:['#6b9c70','#b7c78b','#4c995b','#91a8a0']};
const palettePairs={mixed:[['#bcdbef','#efc6d9'],['#ddd0a7','#d1e7f5'],['#d4bbec','#98d2da']],pink:[['#efb7d5','#d7b9ed']],gold:[['#e6d2a2','#f0ad95']],purple:[['#c0b5ec','#a6c9e7']]};
function seeded(seed){return ()=>{seed=(seed*1664525+1013904223)>>>0;return seed/4294967296;};}
function gaussian(r){return Math.sqrt(-2*Math.log(Math.max(.0001,r())))*Math.cos(6.283185*r());}
function resetScene(){
  gardenSteps=0;plantingColors=[];openingColorOrder=OPENING_COLOR_ORDERS[Math.floor(Math.random()*OPENING_COLOR_ORDERS.length)].slice();flowers=[];stems=[];ambient=[];resetPlantGesture();branchAnchor=null;lastBloomPoint=null;userPlantings=0;currentGesture='move';gestureMotes=[];feedbackAnchor=null;liveVineTip=null;liveVineLength=0;lastBranch=0;
  const r=seeded(7103);
  for(let i=0;i<130;i++)ambient.push({x:r()*width,y:r()*height,phase:r()*7,size:.3+r()*.7});
  const scale=Math.min(1.3,Math.min(width/1000,height/700));
  for(const [x,y,size,type] of [[.76,.34,60,'veil'],[.23,.75,42,'coral'],[.83,.81,24,'seed'],[.4,.86,20,'plume']]){
    const f=makeParticleFlower(x*width,y*height,size*Math.max(.55,scale),type,Math.floor(r()*1e8));
    f.bloom=size>75?.22:.55;f.goal=size>75?.48:1;f.autoAt=sceneTime+r()*.3;flowers.push(f);
  }
  for(const f of flowers)addBranchGroup(f.x+f.size*.15,f.y+f.size*.6,-1.6,Math.floor(r()*1e8),true,Math.min(1,f.size/110));
  rebuildVineLinks();updateParticleCount();
}
function draw(){
  const now=millis(),dt=Math.min(.05,Math.max(.001,(now-(lastFrame||now-16))/1000));lastFrame=now;sceneTime+=dt;
  pruneGarden();
  handleParticleInteraction(now);
  for(const f of flowers){const target=sceneTime<f.autoAt?0:f.goal;f.bloom+=Math.sign(target-f.bloom)*Math.min(Math.abs(target-f.bloom),dt*(target===0?1.7:f.size>75?.4:.75));}
  drawParticleArtwork();drawGestureFeedback(now);drawParticleButterfly(now);
}
function drawParticleArtwork(){
  const c=drawingContext;c.save();c.globalAlpha=1;c.globalCompositeOperation='source-over';c.fillStyle='#000000';c.fillRect(0,0,width,height);
  const mist=c.createRadialGradient(width*.61,height*.65,5,width*.61,height*.65,width*.6);
  mist.addColorStop(0,'rgba(35,43,64,.18)');mist.addColorStop(1,'rgba(5,7,11,0)');c.fillStyle=mist;c.fillRect(0,0,width,height);
  for(const p of ambient){const x=p.x+Math.sin(sceneTime*.1+p.phase)*3,y=p.y+Math.cos(sceneTime*.12+p.phase)*3;c.globalAlpha=.12+.1*Math.sin(p.phase+sceneTime*.2);c.fillStyle='#a4b8cd';c.fillRect(x,y,p.size,p.size);}
  c.globalAlpha=1;
  for(const stem of stems)drawParticleStem(c,stem);
  drawVineLinks(c);
  for(const f of flowers)drawParticleFlower(c,f);
  drawFloatingPollen(c);
  c.restore();
}
function addBranchGroup(x,y,heading,seed,initial=false,plantScale=1){
  maintainGarden();
  const r=seeded(seed),segments=[],leaves=[],flowersOnVine=[],variant=seed%4,scale=Math.max(.45,plantScale);
  const mainAngle=heading+(r()-.5)*1.8,len=(70+r()*100)*scale,bend=(r()-.5)*len*1.4;
  const curve=t=>({x:Math.cos(mainAngle)*len*t+Math.sin(mainAngle)*bend*Math.sin(t*Math.PI*.9),y:Math.sin(mainAngle)*len*t-Math.cos(mainAngle)*bend*Math.sin(t*Math.PI*.9)});
  const branchCount=variant===0?1:variant===1?2:3;
  for(let branch=0;branch<branchCount;branch++){
    const at=branch===0?0:.22+r()*.55,start=curve(at),angle=mainAngle+(branch===0?0:(r()>.5?1:-1)*(.6+r()*.7)),branchLen=branch===0?len:len*(.25+r()*.35),points=[];
    for(let i=0;i<180;i++){
      const t=i/179;if(r()<.15)continue;
      let p=branch===0?curve(t):{x:start.x+Math.cos(angle)*branchLen*t+Math.sin(t*3.3)*branchLen*.17,y:start.y+Math.sin(angle)*branchLen*t+Math.sin(t*5+branch)*branchLen*.1};
      const thickness=branch===0?(variant===0?.5:1.2+r()*2.6):.4+r()*.9;
      for(let j=0;j<(branch===0&&variant>1?3:1);j++)points.push({x:p.x+(r()-.5)*thickness*2,y:p.y+(r()-.5)*thickness*2,t,radius:.35+r()*.8,tone:['#779977','#b5cb73','#97bba1','#bfcf85','#599653'][(seed+j+branch)%5]});
    }
    segments.push({points,alpha:.28+r()*.4,weight:branch===0?.65+r()*1.8:.5+r()*.5});
    const leafCount=variant===0?0:branch===0?1+Math.floor(r()*2):r()>.6?1:0;
    for(let j=0;j<leafCount;j++){
      const t=.2+r()*.6,p=branch===0?curve(t):{x:start.x+Math.cos(angle)*branchLen*t,y:start.y+Math.sin(angle)*branchLen*t};
      const length=(16+r()*38)*scale,w=length*(.11+r()*.2);
      leaves.push({x:p.x,y:p.y,angle:angle+(r()>.5?1:-1)*(.3+r()*.9)+Math.PI/2,texture:petalTexture(length,w,(r()-.5)*length,seed+branch*71+j*97,false),phase:r()*7});
    }
    if(branch>0||variant===0){
      const p=branch===0?curve(.85):{x:start.x+Math.cos(angle)*branchLen*.9,y:start.y+Math.sin(angle)*branchLen*.9};
      for(let j=0;j<2+Math.floor(r()*3);j++)flowersOnVine.push({x:p.x+(r()-.5)*16,y:p.y+(r()-.5)*15,size:1.4+r()*3,phase:r()*7,tone:['#d7b1d3','#e7cc83','#b2bfdd','#df9bba'][(seed+j)%4]});
    }
  }
  const tip=curve(1);stems.push({x,y,segments,leaves,flowersOnVine,variant,phase:r()*7,born:initial?-10:sceneTime,createdStep:gardenSteps,end:{x:x+tip.x,y:y+tip.y}});maintainGarden();
}
function drawParticleStem(c,stem){
  const opacity=plantOpacity(stem);if(opacity<=0)return;
  const progress=Math.min(1,(sceneTime-stem.born)/1.2);
  c.save();c.translate(stem.x,stem.y);c.rotate(Math.sin(sceneTime*.15+stem.phase)*.016);
  for(const s of stem.segments)for(const p of s.points){
    if(p.t>progress)continue;
    c.globalAlpha=(s.alpha*(.7+p.t*.2))*opacity;c.fillStyle=p.tone;
    const x=p.x+Math.sin(sceneTime*.27+stem.phase+p.t*2)*p.t*1.1,size=p.radius*s.weight;c.fillRect(x,p.y,size,size);
  }
  for(const leaf of stem.leaves){
    c.save();c.translate(leaf.x,leaf.y);c.rotate(leaf.angle+Math.sin(sceneTime*.34+leaf.phase)*.04);c.scale(progress,progress);c.globalAlpha=(.65)*opacity;
    const texture=leaf.texture;c.drawImage(texture.canvas,-150/texture.factor,-260/texture.factor,300/texture.factor,320/texture.factor);c.restore();
  }
  for(const blossom of stem.flowersOnVine)drawVineBlossom(c,blossom,progress,opacity);
  c.restore();
}

function filteredPoint(raw,now){
  if(!filteredHand){filteredHand={...raw,time:now};return {...raw};}
  const dt=Math.min(.08,Math.max(.001,(now-filteredHand.time)/1000));filteredHand.time=now;
  const dx=raw.x-filteredHand.x,dy=raw.y-filteredHand.y,d=Math.hypot(dx,dy);
  if(d>12){const alpha=1-Math.exp(-dt/(d>120?.08:.16)),gain=(d-7)/d;filteredHand.x+=dx*alpha*gain;filteredHand.y+=dy*alpha*gain;}
  return {x:filteredHand.x,y:filteredHand.y};
}
function resetPlantGesture(){pendingMousePlant=null;plantGesture={armed:mode==='hand',releaseSince:null,lastAttempt:-Infinity,flashUntil:0,message:''};}
function triggerPlantGesture(pressed,released,point,now){
  if(released){plantGesture.armed=true;return null;}
  if(!pressed||!plantGesture.armed||now-plantGesture.lastAttempt<350)return null;
  // 一次张掌只播种一次；持续张掌或短暂丢手不重新解锁。
  plantGesture.armed=false;plantGesture.lastAttempt=now;advanceGardenStep(3);
  const planted=placeParticleFlower(point.x,point.y,'random');
  if(planted)gardenSound.plant(planted);
  plantGesture.flashUntil=now+1000;
  plantGesture.message=planted?(mode==='mouse'?'已种下 · 点击继续':'已种下 · 收拢后再张掌'):'这里有点拥挤 · 换个位置再试';
  setStatus(planted?`你种下了第 ${userPlantings} 朵花。收拢手指后再张掌，即可继续。`:'这里正在腾出位置，收拢手指，换个位置再张掌。');
  return planted;
}
function handleParticleInteraction(now){
  let raw=null,open=false,fist=false,pinching=false,released=false;
  const mouseDown=typeof mouseIsPressed!=='undefined'&&mouseIsPressed&&(typeof mouseButton==='undefined'||mouseButton==='left');
  if(mode==='hand'&&hands.length){
    const k=hands[0].keypoints,g=readGesture(k);open=g.open;fist=g.fist;pinching=open;
    if(g.canRearm){plantGesture.releaseSince??=now;released=now-plantGesture.releaseSince>=160;}else plantGesture.releaseSince=null;
    const p=fist?k[9]:k[8];raw={x:(1-p.x/(video.elt.videoWidth||320))*width,y:p.y/(video.elt.videoHeight||240)*height};
  }else if(mode==='mouse'&&mouseX>=0&&mouseX<=width&&mouseY>=0&&mouseY<=height&&!document.elementFromPoint?.(mouseX,mouseY)?.closest('button,select,input,nav,.sound-controls')){
    raw=pendingMousePlant?{...pendingMousePlant}:{x:mouseX,y:mouseY};if(pendingMousePlant)filteredHand=null;open=keyIsDown(32);fist=keyIsDown(70);pinching=Boolean(mouseDown||pendingMousePlant);released=!mouseDown&&!pendingMousePlant;
  }
  if(!raw){
    plantGesture.releaseSince=null;pendingMousePlant=null;
    if(mode==='mouse')plantGesture.armed=!mouseDown;
    gardenSound.motion(null,now);cursorPoint=null;filteredHand=null;branchAnchor=null;feedbackAnchor=null;return;
  }
  const point=filteredPoint(raw,now);cursorPoint=point;gardenSound.motion(point,now);emitGestureFeedback(point,now);
  const gesture=fist?'fist':open?'open':pinching?'plant':'move',changed=gesture!==currentGesture;
  if(changed)gardenSound.gesture(gesture,now);
  if(changed)setStatus(({open:mode==='hand'?'张掌 · 种花并绽放':'空格 · 绽放',fist:'握拳 · 花序闭合',plant:'点击播种',move:mode==='mouse'?'点击种花 · 移动引藤 · 空格绽放 · F 闭合':'张掌种花并绽放 · 食指移动引藤 · 握拳闭合'})[gesture]);
  triggerPlantGesture(mode==='hand'?open&&!fist:pinching&&!open&&!fist,released,point,now);pendingMousePlant=null;
  if(!open&&!fist){
    if(branchAnchor){const dx=point.x-branchAnchor.x,dy=point.y-branchAnchor.y,d=Math.hypot(dx,dy);if(d>28&&now-lastBranch>180){movementHeading=Math.atan2(dy,dx);advanceGardenStep();placeBranchNear(point,movementHeading,now);branchAnchor={...point};}}
    else branchAnchor={...point};
  }else{
    branchAnchor={...point};
    const active=flowers.filter(isGrowing),nearby=active.filter(f=>Math.hypot(f.x-point.x,f.y-point.y)<340);
    const targets=nearby.length?nearby:active.sort((a,b)=>Math.hypot(a.x-point.x,a.y-point.y)-Math.hypot(b.x-point.x,b.y-point.y)).slice(0,1);
    for(const f of targets){const previous=f.goal;f.goal=fist?0:1;f.closed=fist;if(open){f.autoAt=0;if(changed||previous<1)f.responsePulse=sceneTime;}}
  }
  currentGesture=gesture;
}

function placeParticleFlower(x,y,large,retry=false){
  if(x<25||x>width-25||y<70||y>height-75||x<width*.31&&y<height*.3)return null;
  maintainGarden();
  const r=seeded(Math.floor(x*71+y*191+flowers.length*997+userPlantings*521));
  const roll=r(),isRandom=large==='random',openingMain=isRandom&&(userPlantings===1||userPlantings===2);
  let size=isRandom?(roll<.32?20+r()*18:roll<.78?42+r()*30:Math.min(170,Math.min(width,height)*(.17+r()*.065))):large?Math.min(135,Math.min(width,height)*.18):15+r()*17;
  // 前三次成功播种先形成中景和两朵主花，随后恢复大小随机。
  if(isRandom&&userPlantings===0)size=70+r()*20;
  if(openingMain)size=Math.min(220,Math.max(115,Math.min(width,height)*(.24+r()*.04)));
  if(isRandom&&userPlantings===3)size=44+r()*24;
  size=Math.min(size,(width-36)/1.85,(height-140)/1.95);
  const room=Math.min(x,width-x,y,height-y-65);
  if(!openingMain&&size>room*.9)size=Math.max(20,Math.min(60,room*.65));
  const isLarge=size>75;
  const attempts=64,spread=openingMain?Math.min(380,Math.max(width,height)*.36):Math.min(300,Math.max(width,height)*.3);
  for(let i=0;i<attempts;i++){
    const a=i*2.4,d=i===0?0:spread*Math.sqrt(i/(attempts-1));
    let cx=x+Math.cos(a)*d,cy=y+Math.sin(a)*d;
    if(openingMain){cx=Math.max(size*.9+8,Math.min(width-size*.9-8,cx));cy=Math.max(size*1.1+8,Math.min(height-size*.7-73,cy));}
    if(cx<size*.9||cx>width-size*.9||cy<size*1.1||cy>height-size*.7-65||cx<width*.32&&cy<height*.3)continue;
    if(flowers.some(f=>isGrowing(f)&&Math.hypot(cx-f.x,cy-f.y)<(size+f.size)*.88+15))continue;
    const pool=isLarge?['veil','coral','orchid']:size>40?['veil','coral','orchid','drift','plume']:['seed','drift','plume'];
    const used=flowers.filter(f=>isGrowing(f)&&f.size>75).map(f=>f.type),fresh=pool.filter(t=>!used.includes(t));
    const types=isLarge&&fresh.length?fresh:pool;
    const flowerSeed=Math.floor(r()*1e8),scheme=nextPlantingScheme(flowerSeed);
    const f=makeParticleFlower(cx,cy,size,types[Math.floor(r()*types.length)],flowerSeed,scheme);plantingColors.push(scheme);f.userCreated=true;f.openingMain=openingMain;f.goal=openingMain?.8:isLarge?.65:1;flowers.push(f);userPlantings++;maintainGarden();
    addBranchGroup(cx+size*.2,cy+size*.3,-1.5+(r()-.5),Math.floor(r()*1e8),false,Math.min(1,size/110));rebuildVineLinks();updateParticleCount();return f;
  }
  if(!retry){
    const nearby=flowers.filter(f=>isGrowing(f)&&(!f.openingMain||userPlantings>=4)&&gardenSteps-(f.createdStep??0)>=(openingMain?0:5)&&(openingMain||sceneTime-(f.born??0)>=(f.size>75?60:f.userCreated?25:12))&&Math.hypot(f.x-x,f.y-y)<(size+f.size)*1.2+(openingMain?spread:100)).sort((a,b)=>(a.createdStep??0)-(b.createdStep??0));
    if(nearby.length){nearby.slice(0,2).forEach(retirePlant);return placeParticleFlower(x,y,large,true);}
  }
  return null;
}
function emitGestureFeedback(point,now){
  if(!feedbackAnchor){feedbackAnchor={...point};return;}
  const distance=Math.hypot(point.x-feedbackAnchor.x,point.y-feedbackAnchor.y);
  if(distance<3)return;
  const r=seeded(Math.floor(now+point.x*17+point.y*23)),count=Math.min(7,2+Math.floor(distance/9));
  for(let i=0;i<count;i++){
    const t=(i+.5)/count,spread=3+r()*10;
    gestureMotes.push({x:lerp(feedbackAnchor.x,point.x,t)+(r()-.5)*spread,y:lerp(feedbackAnchor.y,point.y,t)+(r()-.5)*spread,born:now,life:550+r()*500,phase:r()*7,size:.65+r()*1.2,tone:['#b0d3c4','#d8b9d8','#dace9f'][i%3]});
  }
  gestureMotes=gestureMotes.slice(-160);feedbackAnchor={...point};
}
function drawGestureFeedback(now){
  gestureMotes=gestureMotes.filter(p=>now-p.born<p.life);
  const c=drawingContext;c.save();
  for(const p of gestureMotes){const age=(now-p.born)/p.life;c.globalAlpha=(1-age)*.65;c.fillStyle=p.tone;const x=p.x+Math.sin(age*2+p.phase)*age*7,y=p.y-age*7;c.fillRect(x,y,p.size*(1-age*.4),p.size*(1-age*.4));}
  c.restore();
}
function placeBranchNear(point,heading,now){
  if(point.x<25||point.x>width-25||point.y<70||point.y>height-75||point.x<width*.31&&point.y<height*.3)return null;
  const r=seeded(Math.floor(point.x*71+point.y*119+stems.length*173+gardenSteps*47));
  // 连续运动形成一个有宽度的生长区域；只有部分区域露出藤蔓骨架。
  const kind=['vine','meadow','flowers','meadow','vine'][Math.floor(point.x/95+point.y/83)%5];
  let start=liveVineTip&&Math.hypot(liveVineTip.x-point.x,liveVineTip.y-point.y)<150?{...liveVineTip}:null;
  if(!start){const end=stems.filter(s=>isGrowing(s)&&s.end&&Math.hypot(s.end.x-point.x,s.end.y-point.y)<95).at(-1)?.end;start=end?{...end}:{x:point.x-Math.cos(heading)*36,y:point.y-Math.sin(heading)*36};}
  const dx=point.x-start.x,dy=point.y-start.y,d=Math.hypot(dx,dy);if(d<18)return null;
  const length=Math.min(80,d),ux=dx/d,uy=dy/d,end={x:start.x+ux*length,y:start.y+uy*length};
  if(stems.some(s=>isGrowing(s)&&s.end&&Math.hypot(end.x-s.end.x,end.y-s.end.y)<17))return null;
  const segments=[],blossoms=[],bend=(r()-.5)*length*.7,band=12+r()*32;
  const greens=['#699982','#aac572','#c5d78d','#749d8b','#b1c8a2'];
  const pointOn=t=>{const curve=Math.sin(t*Math.PI)*bend;return {x:dx/d*length*t-uy*curve,y:dy/d*length*t+ux*curve};};
  function sprig(root,angle,len,width){const points=[];for(let i=0;i<80;i++){const t=r(),w=Math.sin(Math.PI*t)*(1-t*.6)*width;const curve=Math.sin(t*2.8)*len*.22;const a=Math.cos(angle)*len*t-Math.sin(angle)*curve,b=Math.sin(angle)*len*t+Math.cos(angle)*curve;points.push({x:root.x+a+(r()-.5)*w,y:root.y+b+(r()-.5)*w,t,radius:.4+r()*.8,tone:greens[Math.floor(r()*greens.length)]});}segments.push({points,alpha:.4+r()*.35,weight:.7+r()*.85});}
  if(kind==='vine'){
    const points=[];for(let i=0;i<240;i++){const t=i/239,p=pointOn(t),width=(1.2+Math.sin(t*5+r())*1.1)*(1-t*.55);points.push({x:p.x+(r()-.5)*width*2,y:p.y+(r()-.5)*width*2,t,radius:.4+r()*.7,tone:greens[i%5]});}segments.push({points,alpha:.6+r()*.25,weight:.8+r()*1.3});
    for(let i=0;i<2+Math.floor(r()*3);i++){const t=.15+r()*.7,p=pointOn(t),side=i%2?1:-1;sprig(p,heading+side*(.55+r()*.9),10+r()*22,2+r()*5);}
  }else{
    // 草叶成簇、交错倾斜，留出空隙，不沿着一根主线均匀排队。
    const count=kind==='flowers'?3+Math.floor(r()*3):5+Math.floor(r()*6);
    for(let i=0;i<count;i++){const p=pointOn(r()),offset=gaussian(r)*band*.45;p.x-=uy*offset;p.y+=ux*offset;sprig(p,-1.8+(r()-.5)*2.4,6+r()*24,1.5+r()*4);}
  }
  const amount=kind==='flowers'?5+Math.floor(r()*6):kind==='vine'?1+Math.floor(r()*3):r()>.5?2:0;
  const colors=['#edb4cd','#d8c7ec','#e2d791','#e99477','#9fcace','#ce7daa'];
  for(let i=0;i<amount;i++){const p=pointOn(.1+r()*.85),off=gaussian(r)*band*(kind==='vine'?.16:.65);blossoms.push({x:p.x-uy*off,y:p.y+ux*off-3-r()*12,size:1.8+r()*5.6,phase:r()*7,tone:colors[Math.floor(r()*colors.length)],form:Math.floor(r()*4),angle:(r()-.5)*1.2});}
  const stem={x:start.x,y:start.y,segments,leaves:[],flowersOnVine:blossoms,variant:kind,phase:r()*7,born:sceneTime,createdStep:gardenSteps,end};
  stems.push(stem);maintainGarden();liveVineTip=end;liveVineLength+=length;lastBranch=now;updateParticleCount();return stem;
}
function drawVineBlossom(c,b,progress,opacity=1){
  const s=b.size*progress;if(s<.05)return;c.save();c.translate(b.x+Math.sin(sceneTime*.3+b.phase),b.y);c.rotate(b.angle||0);c.fillStyle=b.tone;c.globalAlpha=(.7)*opacity;
  if(b.form===1){for(let i=0;i<5;i++){c.save();c.rotate(i*1.256+.15*Math.sin(b.phase+i));c.beginPath();c.ellipse(0,-s*.65,s*.34,s*.75,.15,0,7);c.fill();c.restore();}}
  else if(b.form===2){c.beginPath();c.ellipse(0,-s*.3,s*.65,s, .3,0,7);c.fill();c.fillStyle='#c4d89a';c.globalAlpha=(.65)*opacity;c.beginPath();c.ellipse(-s*.3,s*.45,s*.3,s*.6,-.5,0,7);c.fill();}
  else if(b.form===3){for(let i=0;i<7;i++){c.globalAlpha=(.4+(i%3)*.2)*opacity;c.beginPath();c.arc(Math.sin(i*2.4)*s*.7,Math.cos(i*2.4)*s*.6,s*(.2+(i%2)*.08),0,7);c.fill();}}
  else for(let j=0;j<3;j++){c.beginPath();c.ellipse((j-1)*s*.65,j%2?s*.3:0,s*.55,s*.8,(j-1)*.6,0,7);c.fill();}
  c.fillStyle='#efce6b';c.globalAlpha=(.9)*opacity;c.fillRect(-.6,-.6,1.4,1.4);c.restore();
}

function drawParticleButterfly(now){
  if(cursorPoint){if(!butterfly.visible){butterfly.x=cursorPoint.x;butterfly.y=cursorPoint.y;butterfly.lastPoint={...cursorPoint};}butterfly.visible=Math.min(1,butterfly.visible+.12);}else butterfly.visible=Math.max(0,butterfly.visible-.06);
  butterflyMotion(butterfly,cursorPoint,now);if(!butterfly.visible)return;
  const c=drawingContext;c.save();c.translate(butterfly.x,butterfly.y);c.globalAlpha=butterfly.visible;
  for(const side of [-1,1]){
    c.save();c.scale(side*butterfly.fold,1);c.rotate(side===1?.1:-.1);
    const r=seeded(side===1?67:199);for(let i=0;i<90;i++){
      const u=r(),v=r(),x=3+u*(side===1?27:22),y=(v-.5)*32-u*9;
      if(Math.pow((x-12)/18,2)+Math.pow((y+4)/20,2)>1)continue;
      c.globalAlpha=butterfly.visible*(.15+r()*.65);c.fillStyle=i%3?'#b5d1e0':'#e2bfda';c.fillRect(x,y,.6+r(),.6+r());
    }c.restore();
  }
  if(currentGesture==='open'||currentGesture==='fist'){c.globalAlpha=.75;c.font='11px sans-serif';c.fillStyle='#b1bed3';c.fillText(currentGesture==='open'?'张掌 · 种花绽放':'握拳 · 闭合',32,-15);}
  else {
    const recent=now<plantGesture.flashUntil;
    if(recent){c.globalAlpha=Math.max(0,(plantGesture.flashUntil-now)/1000)*.55;c.strokeStyle='#c3d7b2';c.lineWidth=1;c.beginPath();c.arc(0,0,24+(1-(plantGesture.flashUntil-now)/1000)*15,0,Math.PI*2);c.stroke();}
    c.globalAlpha=.65;c.font='10px sans-serif';c.fillStyle='#b8c8b0';
    c.fillText(recent?plantGesture.message:mode==='mouse'?'点击种花':plantGesture.armed?'张掌种花':'收拢后再张掌',32,3);
  }
  c.restore();
}
function drawFloatingPollen(c){
  const r=seeded(6931);c.save();
  for(let i=0;i<52;i++){
    const owner=flowers[i%flowers.length];if(!owner)break;
    const a=r()*Math.PI*2+sceneTime*(.025+r()*.035),distance=owner.size*(.65+r()*.65);
    const x=owner.x+Math.cos(a)*distance,y=owner.y+Math.sin(a)*distance+Math.sin(sceneTime*.3+i)*9;
    const size=1.5+r()*2.5;c.globalAlpha=owner.bloom*(.25+r()*.45)*plantOpacity(owner);c.strokeStyle=i%3?'#e578db':'#e4e99a';c.lineWidth=.65;
    c.save();c.translate(x,y);c.rotate(sceneTime*.12+i);c.beginPath();
    if(i%4===0){for(let j=0;j<10;j++){const a=j/10*Math.PI*2,radius=j%2?size*.45:size;const px=Math.cos(a)*radius,py=Math.sin(a)*radius;j?c.lineTo(px,py):c.moveTo(px,py);}c.closePath();}
    else{c.moveTo(-size,0);c.lineTo(0,-size*.7);c.lineTo(size,0);c.lineTo(0,size*.7);c.closePath();}c.stroke();c.restore();
  }c.restore();
}
function saveParticleArtwork(){drawParticleArtwork();saveCanvas('living-particles','png');}
function updateParticleCount(){const e=document.getElementById('count');if(e)e.textContent=`你种下了 ${userPlantings} 朵花 · ${stems.filter(isGrowing).length} 组枝影`;const hint=document.querySelector?.('header p');if(hint)hint.textContent=userPlantings?'这座花园，正沿着你的动作生长。':(mode==='hand'?'张开手掌，种下你的第一朵花。':'点击画面，种下你的第一朵花。');}
function windowResized(){const ow=width,oh=height;resizeCanvas(window.innerWidth,window.innerHeight);for(const f of flowers){f.x*=width/ow;f.y*=height/oh;}for(const s of stems){s.x*=width/ow;s.y*=height/oh;if(s.end){s.end.x*=width/ow;s.end.y*=height/oh;}}for(const p of ambient){p.x*=width/ow;p.y*=height/oh;}filteredHand=null;branchAnchor=null;feedbackAnchor=null;liveVineTip=null;liveVineLength=0;}
window.addEventListener('pagehide',()=>{trackingSession++;cameraReady=false;handPose?.detectStop();cameraStream?.getTracks().forEach(track=>track.stop());});

function rebuildVineLinks(){
  vineLinks=[];
  for(let i=0;i<flowers.length;i++){
    const f=flowers[i],others=flowers.slice(0,i).map(q=>({q,d:Math.hypot(q.x-f.x,q.y-f.y)})).sort((a,b)=>a.d-b.d);
    if(!others.length||others[0].d>Math.min(280,width*.27))continue;
    const q=others[0].q,r=seeded(f.seed+q.seed),dx=q.x-f.x,dy=q.y-f.y,d=Math.hypot(dx,dy),nx=-dy/d,ny=dx/d;
    const points=[];
    for(let j=0;j<430;j++){
      const t=r(),curve=Math.sin(t*Math.PI)*d*.16,spread=gaussian(r)*(1.5+Math.pow(Math.sin(t*8),2)*4);
      if(t<.12||t>.88||t>.4&&t<.57||r()> .3+.6*Math.pow(Math.sin(t*9),2))continue;
      points.push({x:f.x+dx*t+nx*(curve+spread),y:f.y+dy*t+ny*(curve+spread),phase:r()*7,alpha:.18+r()*.32,size:.4+r()*1.1,tone:['#8caf92','#b7cb88','#7fae9f'][j%3]});
    }
    vineLinks.push({points,phase:r()*7,owners:[f,q]});
  }
}
function drawVineLinks(c){
  c.save();c.fillStyle='#bdce79';
  for(const link of vineLinks)for(const p of link.points){c.globalAlpha=p.alpha*Math.min(...link.owners.map(plantOpacity));c.fillStyle=p.tone;c.fillRect(p.x+Math.sin(sceneTime*.24+p.phase)*1.2,p.y+Math.cos(sceneTime*.21+p.phase)*1.2,p.size,p.size);}
  c.restore();
}
function vineRibbonTexture(length,seed){
  const canvas=document.createElement('canvas');canvas.width=380;canvas.height=440;
  const c=canvas.getContext('2d'),r=seeded(seed),factor=210/length;c.translate(190,380);c.scale(factor,factor);
  for(let i=0;i<6800;i++){
    const t=r(),u=r()*2-1,curve=Math.sin(t*5.1+seed*.01)*length*.18*t;
    const thick=(2+Math.sin(t*Math.PI)*5)*(1-t*.65);
    c.fillStyle=petalPalettes.leaf[Math.floor(r()*petalPalettes.leaf.length)];c.globalAlpha=.3+r()*.5;
    const x=curve+u*thick,y=-length*t+Math.sin(t*8)*length*.04;c.fillRect(x,y,(.6+r())/factor,(.6+r())/factor);
  }
  // 卷须在主体旁断续延伸，不是把每一个落点接成直线。
  for(let j=0;j<3;j++){
    c.strokeStyle=j%2?'#c4ce79':'#91b65c';c.globalAlpha=.3;c.lineWidth=.5/factor;c.beginPath();
    for(let i=0;i<60;i++){const t=i/59,a=t*4.8+j*.6,x=Math.sin(a)*length*.22+(j-1)*8,y=-length*.7-t*length*.45+Math.cos(a)*length*.13;i?c.lineTo(x,y):c.moveTo(x,y);}c.stroke();
  }
  return {canvas,factor};
}
function petalTexture(length,width,bend,seed,pink,rounded=false){
  const canvas=document.createElement('canvas');canvas.width=300;canvas.height=320;
  const c=canvas.getContext('2d'),r=seeded(seed),factor=130/Math.max(length,width*1.6);
  c.translate(150,260);c.scale(factor,factor);
  const scheme=typeof pink==='string'?pink:pink?'blush':'leaf',shades=petalPalettes[scheme],accents=pigmentAccents[scheme];
  const depth=petalDepth[scheme],gradientTones=Array.from({length:16},(_,band)=>shades.map(shade=>band<5?mixPigment(shade,depth[0],(1-band/5)*.48):mixPigment(shade,depth[1],Math.max(0,(band-7)/8)*.62)));
  // 同一朵花也有不同边缘：局部卷边、柔边、完全化开的边。
  const edgeMode=Math.abs(seed)%3,feather=edgeMode===0?.12:edgeMode===1?.32:.56;
  const silhouette=t=>rounded?(1-Math.exp(-t*10))*Math.pow(1-t,.32)*(.9+.1*Math.sin(t*5+seed)):Math.pow(Math.sin(Math.PI*t),.7)*(.72+.26*Math.sin(t*7+seed)+.13*Math.cos(t*15+seed*.1));
  const position=(t,u)=>({x:u*width*silhouette(t)+bend*Math.sin(t*2.8)*t+Math.sin(t*5+seed)*length*.1*t,y:-length*t+u*u*length*.12+Math.sin(t*4+seed)*length*.13*t+u*length*.11*t});
  const patches=[{t:.38+(seed%5)*.06,u:-.4,wt:.23,wu:.34,color:accents[0]},{t:.7,u:.35,wt:.16,wu:.29,color:accents[1]}];
  for(let i=0;i<8800;i++){
    const t=r(),u=r()*2-1,edge=Math.abs(u);
    // 颜料沿曲面凝聚成不等宽的带，保留透气的疏区和靠近根部的空隙。
    const fold=.5+.5*Math.sin(u*8+t*6+seed*.13),density=(.42+.58*fold)*(.3+.7*Math.min(1,t*4));
    if(r()>density)continue;
    const fringe=Math.max(0,(edge-(1-feather))/feather),softness=Math.pow(1-fringe,edgeMode===2?2.5:1.2);
    if(r()>softness)continue;
    const bleed=fringe*fringe*gaussian(r)*width*feather*.35,point=position(t,u);
    c.globalAlpha=(.25+r()*.45)*softness*(.7+.3*fold);
    const shade=Math.min(shades.length-1,Math.floor((u+1)*.5*shades.length));
    c.fillStyle=gradientTones[Math.min(15,Math.floor(t*16))][shade];
    for(const patch of patches){const d=Math.pow((t-patch.t)/patch.wt,2)+Math.pow((u-patch.u)/patch.wu,2);if(d<1+(r()-.5)*.14){c.fillStyle=patch.color;break;}}
    const size=.45+r()*.85;c.fillRect(point.x+bleed,point.y,size/factor,size/factor);
  }
  // 薄的色丝只出现在部分曲面，避免每片都带同样的描边。
  for(let vein=0;vein<4;vein++){
    c.globalAlpha=.07;c.strokeStyle=shades[(vein+2)%shades.length];c.lineWidth=.35/factor;c.beginPath();
    for(let j=0;j<30;j++){const t=.18+j/40,u=(vein-1.5)/3,point=position(t,u);j?c.lineTo(point.x,point.y):c.moveTo(point.x,point.y);}c.stroke();
  }
  if(edgeMode===0){
    c.globalAlpha=.2;c.strokeStyle=shades[2];c.lineWidth=.45/factor;
    const side=seed%2?1:-1;c.beginPath();
    for(let i=0;i<20;i++){const t=.35+i*.025,point=position(t,side);i?c.lineTo(point.x,point.y):c.moveTo(point.x,point.y);}c.stroke();
  }
  // 羽化花瓣的外层稀薄颜料，和主体同一色域，向外逐步消失。
  for(let i=0;i<(edgeMode===0?75:260);i++){
    const t=.15+r()*.8,side=r()>.5?1:-1,spread=Math.pow(r(),2)*feather*.65,point=position(t,side*(1+spread));
    c.globalAlpha=(1-spread/(feather*.65))*.12;c.fillStyle=shades[Math.floor(r()*shades.length)];
    const size=(.35+r()*.6)/factor;c.fillRect(point.x,point.y,size,size);
  }
  return {canvas,factor,length,width,edgeMode};
}
function splashedCore(seed,scheme){
  const canvas=document.createElement('canvas');canvas.width=120;canvas.height=120;
  const c=canvas.getContext('2d'),r=seeded(seed+777);
  const tones=scheme==='ivory'?['#d9435b','#2d73b5','#efa449','#bc66a3']:scheme==='violet'?['#e9bf3d','#d34585','#28a998','#f49259']:['#ee693f','#bc3f98','#79bb68','#e5c148'];
  c.translate(60,60);
  for(let i=0;i<4;i++){
    const a=i*2.35+.4,x=Math.cos(a)*(14+r()*9),y=Math.sin(a)*(11+r()*8),radius=2+r()*4;
    c.fillStyle=tones[i%4];c.globalAlpha=.55+r()*.35;c.beginPath();
    for(let j=0;j<13;j++){const a=j/13*Math.PI*2,d=radius*(.6+r()*.6),px=x+Math.cos(a)*d,py=y+Math.sin(a)*d;j?c.lineTo(px,py):c.moveTo(px,py);}c.closePath();c.fill();
    for(let j=0;j<8;j++){const px=x+gaussian(r)*radius*1.3,py=y+gaussian(r)*radius*1.3;c.globalAlpha=.25+r()*.4;c.fillRect(px,py,.5+r()*1.2,.5+r()*1.2);}
  }
  return canvas;
}
function randomFlowerScheme(type,seed){
  const choices={veil:['blush','violet','ivory','apricot'],coral:['apricot','blush','ivory','rose'],orchid:['violet','rose','ivory'],plume:['vermilion','rose','amber'],drift:['rose','violet','blush'],seed:['amber','apricot','ivory','vermilion']}[type]||['blush','ivory','violet'];
  const colorRandom=seeded(seed+19871);colorRandom();colorRandom();
  return choices[Math.floor(colorRandom()*choices.length)];
}
function makeParticleFlower(x,y,size,type,seed,schemeOverride=null){
  const r=seeded(seed),f={x,y,size,type,seed,phase:r()*7,bloom:0,goal:1,autoAt:sceneTime+.3,points:[],petals:[],dust:[],closed:false,born:sceneTime,createdStep:gardenSteps};
  // 每朵花独立选择协调的主色组；花瓣内部继续保留局部辅色。
  f.scheme=schemeOverride||randomFlowerScheme(type,seed);
  f.filaments=[];
  const airy=type==='drift'||type==='plume'||type==='seed';
  const detailed=size>75;const count=type==='orchid'?(detailed?17:9):type==='seed'?1:airy?2:type==='coral'?(detailed?33:23):(detailed?19:5);
  const angles=type==='orchid'?[-1.8,-.25,1.25,2.4]:type==='seed'?[-.35]:type==='coral'?[-2.3,-1.5,-.6,.4,1.7,2.7,3.4]:[-2.4,-.95,-.1,1.2,2.7];
  for(let i=0;i<count;i++){
    const layer=type==='coral'?(i<12?0:i<24?1:2):type==='orchid'?(i<7?0:i<13?1:2):detailed?Math.floor(i/7):0;
    const length=size*(type==='coral'?(.66+r()*.17)*(1-layer*.2):type==='orchid'?(.65+r()*.4)*(1-layer*.25):(.65+r()*.55)*(1-layer*.19)),w=length*(type==='coral'?.4+r()*.17:type==='orchid'?.18+r()*.12:type==='plume'?.14:type==='veil'?.26+r()*.2:type==='seed'?.23:.19+r()*.26),bend=(r()-.5)*length*(type==='coral'?.35:.95);
    const angle=type==='coral'?(i/8.3*Math.PI*2+layer*.4+(r()-.5)*.26):type==='orchid'?(i<6?i/6*Math.PI*2:i/3*Math.PI*2+.42)+(r()-.5)*.25:angles[i%5]+layer*.65+(r()-.5)*.65;
    const px=(r()-.5)*size*(type==='coral'?.1:.25),py=(r()-.5)*size*(type==='coral'?.1:.2);
    const companions={blush:['ivory','seafoam'],violet:['blush','seafoam'],ivory:['apricot','seafoam'],vermilion:['apricot','ivory'],seafoam:['ivory','violet'],apricot:['ivory','blush'],rose:['ivory','violet'],amber:['apricot','ivory']}[f.scheme]||[f.scheme,f.scheme];
    const accentScheme=detailed&&i%7===2?companions[0]:detailed&&i%11===5?companions[1]:f.scheme;
    const rounded=type==='coral'||detailed&&type==='veil'&&i%3!==0||detailed&&type==='orchid'&&layer>0;
    f.petals.push({texture:petalTexture(length,w,bend,seed+i*67,accentScheme,rounded),scheme:accentScheme,angle,x:px,y:py,phase:r()*7,scale:.75+r()*.3});
    for(let j=0;j<(i%3===0?30:85);j++){
      const t=.08+r()*.86,side=r()>.5?1:-1,envelope=Math.pow(Math.sin(Math.PI*t),.7)*(.72+.26*Math.sin(t*7+seed+i*67)+.13*Math.cos(t*15+(seed+i*67)*.1));
      const spread=Math.pow(r(),2)*size*(i%3===0?.1:.24);
      const ex=side*(w*envelope+spread)+bend*Math.sin(t*2.8)*t+Math.sin(t*5+seed+i*67)*length*.1*t;
      const ey=-length*t+length*.12+Math.sin(t*4+seed+i*67)*length*.13*t+side*length*.11*t;
      f.dust.push({x:px+ex*Math.cos(angle)-ey*Math.sin(angle),y:py+ex*Math.sin(angle)+ey*Math.cos(angle),radius:.3+r()*.9,phase:r()*7,tone:petalPalettes[accentScheme][j%5],speed:.12+r()*.25,edge:true,fade:1-spread/(size*.25)});
    }
  }
  for(let i=0;i<(airy?64:17);i++){
    const a=-3.2+r()*5.5,len=size*(.55+r()*.6),bend=(r()-.5)*size*.35;
    f.filaments.push({x:Math.cos(a)*len,y:Math.sin(a)*len,bend,phase:r()*7,tone:petalPalettes[f.scheme][i%5]});
  }
  for(let i=0;i<220;i++){
    const a=r()*Math.PI*2,d=.35+r()*.85;
    f.dust.push({x:Math.cos(a)*size*d,y:Math.sin(a)*size*d,radius:.65+r()*1.4,phase:r()*7,tone:i%4?petalPalettes[f.scheme][0]:'#d9db7c',speed:.15+r()*.3});
  }
  f.stamens=[];if(detailed)for(let i=0;i<11;i++){const a=r()*Math.PI*2,len=size*(.1+r()*.15);f.stamens.push({x:Math.cos(a)*len,y:Math.sin(a)*len-size*.04,bend:(r()-.5)*size*.1,head:1+r()*1.2,phase:r()*7,tone:['#e8c572','#b9d5ac','#e2a4c4'][i%3]});}
  const coreTones={violet:['#e9b84b','#df7fab','#8cbdb0'],seafoam:['#f2d17f','#9e83ba','#e9a4be'],ivory:['#dd724d','#93b19a','#c297bf'],vermilion:['#f4bf64','#9cbba2','#e4a5bf']}[f.scheme]||['#efb74f','#a4c7a0','#db94b7'];
  const coreIslands=Array.from({length:3},(_,i)=>{const a=i*2.3+f.phase;return {x:Math.cos(a)*size*.13,y:Math.sin(a)*size*.11};});
  for(let i=0;i<(detailed?48:42);i++){const island=coreIslands[i%3];f.points.push({x:island.x+gaussian(r)*size*.023,y:island.y+gaussian(r)*size*.023,phase:r()*7,tone:coreTones[i%3],radius:.4+r()*1.1});}
  f.ink=splashedCore(seed,f.scheme);
  f.bubbles=[];
  for(let i=0;i<9+Math.floor(r()*6);i++){
    const a=r()*7,d=size*(.12+r()*.7);
    f.bubbles.push({x:Math.cos(a)*d,y:Math.sin(a)*d,size:1.5+r()*5.5,phase:r()*7,tone:['#d6f16e','#f5b1d6','#e4c773','#9ac9c8','#bc9ade'][i%5]});
  }
  return f;
}
function drawParticleFlower(c,f){
  const opacity=plantOpacity(f);if(opacity<=0)return;
  const b=Math.max(0,Math.min(1,f.bloom)),ease=b*b*(3-2*b);
  c.save();c.translate(f.x+Math.sin(sceneTime*.18+f.phase)*2,f.y+Math.cos(sceneTime*.2+f.phase)*2);
  const response=f.responsePulse==null?0:Math.max(0,1-(sceneTime-f.responsePulse)/.8);
  c.scale(1+response*.06,1+response*.06);
  for(const thread of f.filaments){
    const sway=Math.sin(sceneTime*.45+thread.phase)*f.size*.025;
    c.globalAlpha=(.18+ease*.2)*opacity;c.strokeStyle=thread.tone;c.lineWidth=.45;c.beginPath();c.moveTo(0,0);c.bezierCurveTo(thread.x*.3+thread.bend,thread.y*.2,thread.x*.75+sway,thread.y*.8,thread.x*ease+sway,thread.y*(.2+ease*.8));c.stroke();
  }
  for(const petal of f.petals){
    const wind=Math.sin(sceneTime*.55+petal.phase)*.055+Math.sin(sceneTime*.23+f.phase)*.025;
    c.save();c.translate(petal.x*ease,petal.y*ease);c.rotate(petal.angle*ease+wind*ease);
    const opening=.07+ease*.93;
    c.scale(opening*petal.scale,(.38+ease*.62)*petal.scale*(1+Math.sin(sceneTime*.4+petal.phase)*.025));
    c.globalAlpha=(.35+ease*.65)*opacity;
    const texture=petal.texture;
    c.drawImage(texture.canvas,-150/texture.factor,-260/texture.factor,300/texture.factor,320/texture.factor);
    c.restore();
  }
  for(const p of f.points){c.globalAlpha=(.6+Math.sin(sceneTime*.7+p.phase)*.22)*opacity;c.fillStyle=p.tone;const s=p.radius;c.fillRect(p.x*(.2+ease*.8),p.y*(.3+ease*.7),s,s);}
  c.globalAlpha=((.25+ease*.7))*opacity;const inkSize=f.size*.52;c.drawImage(f.ink,-inkSize/2,-inkSize/2,inkSize,inkSize);
  for(const stamen of f.stamens||[]){
    const x=stamen.x*ease+Math.sin(sceneTime*.5+stamen.phase),y=stamen.y*ease;
    c.globalAlpha=.5*ease*opacity;c.strokeStyle=stamen.tone;c.lineWidth=.65;c.beginPath();c.moveTo(0,0);c.bezierCurveTo(stamen.bend,-f.size*.025,x+stamen.bend,y*.75,x,y);c.stroke();
    c.globalAlpha=.85*ease*opacity;c.fillStyle=stamen.tone;c.beginPath();c.ellipse(x,y,stamen.head,stamen.head*.65,stamen.phase,0,Math.PI*2);c.fill();
  }
  for(const p of f.dust){
    const dx=Math.sin(sceneTime*p.speed+p.phase)*f.size*(p.edge?.035:.16),dy=Math.cos(sceneTime*p.speed*.7+p.phase)*f.size*(p.edge?.04:.12);
    c.globalAlpha=((p.edge?(.1+.4*(p.fade??1)):(.18+.4*(.5+.5*Math.sin(sceneTime*.5+p.phase))))*ease)*opacity;c.fillStyle=p.tone;c.fillRect(p.x+dx,p.y+dy,p.radius,p.radius);
  }
  for(const bubble of f.bubbles){
    const x=bubble.x+Math.sin(sceneTime*.22+bubble.phase)*f.size*.06,y=bubble.y+Math.cos(sceneTime*.18+bubble.phase)*f.size*.055,s=bubble.size;
    c.globalAlpha=(.5*ease)*opacity;c.strokeStyle=bubble.tone;c.lineWidth=.55;c.beginPath();c.arc(x,y,s,0,Math.PI*2);c.stroke();
    c.globalAlpha=(.12*ease)*opacity;c.fillStyle=bubble.tone;c.beginPath();c.arc(x,y,s*.65,0,7);c.fill();
    c.globalAlpha=(.6*ease)*opacity;c.fillStyle='#f4f4d7';c.beginPath();c.arc(x-s*.25,y-s*.3,Math.max(.5,s*.14),0,7);c.fill();
  }
  c.restore();
}

// 声音由浏览器实时合成，无需音频素材。点击声音按钮后才创建 AudioContext。
class GardenSound {
  constructor(){this.ctx=null;this.enabled=false;this.volume=.3;this.previous=null;this.lastGesture=-Infinity;this.voices=new Set();this.busy=false;this.nextBackground=Infinity;this.phrase=0;}
  init(){
    const Audio=window.AudioContext||window.webkitAudioContext;
    if(!Audio)throw Error('当前浏览器不支持声音，请尝试 Chrome 或 Edge。');
    const ctx=new Audio();this.ctx=ctx;
    this.master=ctx.createGain();this.master.gain.value=0;
    const limiter=ctx.createDynamicsCompressor();limiter.threshold.value=-16;limiter.knee.value=18;limiter.ratio.value=4;
    this.master.connect(limiter);limiter.connect(ctx.destination);
    this.input=ctx.createGain();this.input.connect(this.master);
    const reverb=ctx.createConvolver(),impulse=ctx.createBuffer(2,Math.floor(ctx.sampleRate*2.8),ctx.sampleRate);
    for(let ch=0;ch<2;ch++){const data=impulse.getChannelData(ch);for(let i=0;i<data.length;i++)data[i]=(Math.random()*2-1)*Math.pow(1-i/data.length,3)*.38;}
    reverb.buffer=impulse;const wet=ctx.createGain();wet.gain.value=.28;this.input.connect(reverb);reverb.connect(wet);wet.connect(this.master);
    this.airFilter=ctx.createBiquadFilter();this.airFilter.type='lowpass';this.airFilter.frequency.value=480;this.airFilter.Q.value=.45;
    this.airGain=ctx.createGain();this.airGain.gain.value=.008;
    const noise=ctx.createBuffer(1,ctx.sampleRate*3,ctx.sampleRate),data=noise.getChannelData(0);let smooth=0;
    for(let i=0;i<data.length;i++){smooth=(smooth+.035*(Math.random()*2-1))/1.035;data[i]=smooth*3;}
    this.air=ctx.createBufferSource();this.air.buffer=noise;this.air.loop=true;this.air.connect(this.airFilter);this.airFilter.connect(this.airGain);this.airGain.connect(this.input);this.air.start();
    this.padFilter=ctx.createBiquadFilter();this.padFilter.type='lowpass';this.padFilter.frequency.value=620;
    const pad=ctx.createGain();pad.gain.value=.06;this.padFilter.connect(pad);pad.connect(this.input);
    this.drones=[];
    for(const [i,hz] of [130.813,195.998,261.626].entries()){
      const osc=ctx.createOscillator(),gain=ctx.createGain();osc.type='sine';osc.frequency.value=hz;osc.detune.value=(i-1)*4;gain.gain.value=.18;
      const breath=ctx.createOscillator(),depth=ctx.createGain();breath.frequency.value=.065+i*.018;depth.gain.value=.055;breath.connect(depth);depth.connect(gain.gain);
      osc.connect(gain);gain.connect(this.padFilter);osc.start();breath.start();this.drones.push(osc,breath);
    }
  }
  updateUI(message){
    const button=document.getElementById('sound');if(button){button.textContent=this.enabled?'声音：开':'开启声音';button.setAttribute('aria-pressed',String(this.enabled));}
    const state=document.getElementById('sound-state');if(state)state.textContent=message||(this.enabled?'轻风与慢速旋律 · 随手势呼吸':'声音已关闭');
  }
  async toggle(){
    if(this.busy)return;this.busy=true;
    try{
      if(!this.ctx)this.init();
      if(this.enabled){this.enabled=false;this.master.gain.setTargetAtTime(0,this.ctx.currentTime,.045);await this.ctx.suspend();}
      else {await this.ctx.resume();if(this.ctx.state!=='running')throw Error('声音未启动，请再次点击开启声音。');this.enabled=true;this.master.gain.setTargetAtTime(this.volume*.38,this.ctx.currentTime,.35);this.previous=null;this.nextBackground=this.ctx.currentTime+4;}
      this.updateUI();
    }catch(error){this.enabled=false;this.updateUI(error.message||'声音启动失败，请重试。');}
    finally{this.busy=false;}
  }
  setVolume(value){
    const n=Number(value);if(!Number.isFinite(n))return;this.volume=Math.max(0,Math.min(1,n/100));
    if(this.ctx)this.master.gain.setTargetAtTime(this.enabled?this.volume*.38:0,this.ctx.currentTime,.08);
    const output=document.getElementById('volume-value');if(output)output.textContent=Math.round(this.volume*100)+'%';
  }
  motion(point,now){
    if(!this.enabled||this.ctx?.state!=='running'){this.previous=null;this.motionTravel=0;return;}
    this.background();
    let speed=0,distance=0;
    if(point&&this.previous){const dt=Math.max(16,now-this.previous.now);distance=Math.hypot(point.x-this.previous.x,point.y-this.previous.y);speed=Math.min(1,distance/dt*1.6);}
    this.previous=point?{...point,now}:null;
    // 背景风保持很轻；移动改为稀疏的五声音阶，不随每帧触发。
    this.airGain.gain.setTargetAtTime(.008,this.ctx.currentTime,.2);
    this.airFilter.frequency.setTargetAtTime(420,this.ctx.currentTime,.25);
    if(!point){this.motionTravel=0;return;}
    this.motionTravel=(this.motionTravel||0)+(distance>1.5?Math.min(distance,45):0);
    if(this.motionTravel>=28&&now-(this.lastMotionNote??-Infinity)>=650){
      const scale=[523.251,587.33,659.255,783.991,880,1046.502],h=typeof height==='number'?height:700;
      const index=Math.max(0,Math.min(5,Math.floor((1-point.y/h)*6)));
      this.bell(scale[index],0,.025+speed*.018,2.4);
      this.lastMotionNote=now;this.motionTravel=0;
    }
  }
  background(){
    if(!this.enabled||this.ctx?.state!=='running'||this.ctx.currentTime<this.nextBackground)return;
    const notes=[261.626,329.628,391.995,293.665,440,329.628],hz=notes[this.phrase%notes.length];
    this.bell(hz,0,.025,5.5);this.bell(hz*.5,.45,.012,6);
    this.phrase++;this.nextBackground=this.ctx.currentTime+8+(this.phrase%3)*2;
  }
  bell(hz,time,strength=.1,duration=2.6){
    if(!this.enabled||this.ctx?.state!=='running'||this.voices.size>=18)return;
    const ctx=this.ctx,t=ctx.currentTime+time,amp=ctx.createGain(),osc=ctx.createOscillator();
    osc.type='sine';osc.frequency.setValueAtTime(hz,t);osc.frequency.exponentialRampToValueAtTime(hz*.998,t+duration);
    amp.gain.setValueAtTime(0,t);amp.gain.linearRampToValueAtTime(strength,t+.028);amp.gain.exponentialRampToValueAtTime(.0001,t+duration);
    osc.connect(amp);amp.connect(this.input);this.voices.add(osc);
    osc.onended=()=>{osc.disconnect();amp.disconnect();this.voices.delete(osc);};osc.start(t);osc.stop(t+duration+.05);
  }
  plant(flower){
    if(!this.enabled)return;
    const scale=[261.626,293.665,329.628,391.995,440,523.251],base=scale[Math.abs(flower.seed)%scale.length]*(flower.size<40?2:1);
    this.bell(base,0,.13,3);this.bell(base*2,.055,.035,2.2);
    if(flower.size>75){this.bell(base*1.5,.19,.07,3.8);this.bell(base*2,.38,.04,3.2);}
  }
  gesture(kind,now){
    if(!this.enabled||!['open','fist'].includes(kind)||now-this.lastGesture<850)return;this.lastGesture=now;
    const opening=kind==='open';this.padFilter.frequency.setTargetAtTime(opening?1600:260,this.ctx.currentTime,.65);
    const notes=opening?[329.628,391.995,523.251]:[391.995,293.665,195.998];
    notes.forEach((note,i)=>this.bell(note,i*.22,opening?.075:.05,opening?3.5:2.5));
    this.updateUI(opening?'张掌 · 铃音缓缓展开':'握拳 · 音色渐暗、回落');
  }
  async hide(){
    this.previous=null;if(this.ctx?.state==='running'){this.enabled=false;this.master.gain.value=0;await this.ctx.suspend();this.updateUI('页面已暂停声音，点击可重新开启');}
  }
}
const gardenSound=new GardenSound();
function setupGardenSound(){
  document.getElementById('sound')?.addEventListener('click',()=>gardenSound.toggle());
  document.getElementById('volume')?.addEventListener('input',event=>gardenSound.setVolume(event.target.value));
  document.addEventListener?.('visibilitychange',()=>{if(document.hidden)gardenSound.hide().catch(()=>{});});
}
