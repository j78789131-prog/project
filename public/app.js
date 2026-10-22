const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
const FALLBACK_MODEL = 'https://raw.githubusercontent.com/KhronosGroup/glTF-Sample-Assets/main/Models/CesiumAir/glTF-Binary/CesiumAir.glb';
const aircraft = [
  {id:'a320',name:'Airbus A320 · S7',speed:450,emoji:'✈',desc:'Commercial · 450 KTS',model:'https://raw.githubusercontent.com/kristimsu-beep/pinnogram/main/games/airbus_a320_s7_airlines.glb'},
  {id:'darkstar',name:'SR-72 Darkstar',speed:5884,emoji:'◆',desc:'Hypersonic · 5,884 KTS',model:'https://raw.githubusercontent.com/wprojecter-cmd/flight-simulator/main/static/models/lockheed_martin_sr72_darkstar__topgun_maverick.glb'},
  {id:'cessna172',name:'Cessna 172',speed:122,emoji:'🛩',desc:'Trainer · 122 KTS',model:FALLBACK_MODEL},
  {id:'f16',name:'F-16 Fighting Falcon',speed:650,emoji:'✦',desc:'Multirole · 650 KTS',model:FALLBACK_MODEL},
  {id:'f22',name:'F-22 Raptor',speed:1300,emoji:'◇',desc:'Stealth · 1,300 KTS',model:FALLBACK_MODEL},
  {id:'boeing787',name:'Boeing 787',speed:488,emoji:'✈',desc:'Airliner · 488 KTS',model:FALLBACK_MODEL},
  {id:'spitfire',name:'Supermarine Spitfire',speed:240,emoji:'✧',desc:'Classic · 240 KTS',model:FALLBACK_MODEL},
  {id:'helicopter',name:'Rescue helicopter',speed:140,emoji:'🚁',desc:'Rotorcraft · 140 KTS',model:FALLBACK_MODEL},
  {id:'glider',name:'High-performance glider',speed:80,emoji:'⟡',desc:'Glider · 80 KTS',model:FALLBACK_MODEL},
  {id:'fighter',name:'Eurofighter Typhoon',speed:650,emoji:'✦',desc:'Multirole · 650 KTS',model:FALLBACK_MODEL}
];
let token='',user=null,mode='register',selected='a320',viewer=null,flight=false,paused=false;
let position={lat:40.6413,lon:-73.7781,altitude:1000},heading=90,throttle=.25,verticalSpeed=0,keys={},socket=null;
let peerConnections=new Map(),localStream=null,muted=false,weatherImagery=null,routeEntity=null,lastFrame=0,lastWeather=0;
const remotePilots=new Map(), modelUrls=new Map();
const authHeaders=()=>({'Content-Type':'application/json',Authorization:'Bearer '+token});
async function api(url,body,method='POST'){
  const r=await fetch(url,{method,headers:authHeaders(),...(body!==undefined?{body:JSON.stringify(body)}:{})});
  const d=await r.json().catch(()=>({error:'Invalid server response'}));if(!r.ok)throw Error(d.error||'Request failed');return d;
}
function show(id){$('#'+id).classList.remove('hidden')}function hide(id){$('#'+id).classList.add('hidden')}
function safeText(node,text){node.textContent=String(text??'')}
function renderAircraft(){
  $('#aircraft-grid').innerHTML=aircraft.map(a=>'<button class="aircraft-card '+(selected===a.id?'selected':'')+'" data-plane="'+a.id+'"><div class="aircraft-art">'+a.emoji+'</div><strong>'+a.name+'</strong><small>'+a.desc+'</small></button>').join('');
  $$('[data-plane]').forEach(b=>b.onclick=()=>choosePlane(b.dataset.plane));
}
async function choosePlane(id){
  if(!aircraft.some(a=>a.id===id))return;
  selected=id;renderAircraft();
  if(token)try{await api('/api/me/plane',{planeId:id},'PATCH')}catch(e){console.warn(e)}
  if(flight){ensureAircraftModel('my-plane',position,heading,selected,Cesium.Color.CYAN,true);syncMyModel();}
}
function initGlobe(){
  if(!window.Cesium){$('#route-status').textContent='Cesium failed to load. Check network access.';return}
  if(window.GAME_CONFIG?.cesiumIonToken)Cesium.Ion.defaultAccessToken=window.GAME_CONFIG.cesiumIonToken;
  const imagery=window.GAME_CONFIG?.cesiumIonToken
    ? Cesium.ImageryLayer.fromProviderAsync(Cesium.IonImageryProvider.fromAssetId(2))
    : Cesium.ImageryLayer.fromProviderAsync(Cesium.TileMapServiceImageryProvider.fromUrl(Cesium.buildModuleUrl('Assets/Textures/NaturalEarthII')));
  viewer=new Cesium.Viewer('globe',{animation:false,timeline:false,baseLayerPicker:false,geocoder:false,homeButton:false,sceneModePicker:false,navigationHelpButton:false,fullscreenButton:false,infoBox:false,selectionIndicator:false,shouldAnimate:true,baseLayer:imagery,terrainProvider:new Cesium.EllipsoidTerrainProvider()});
  viewer.scene.globe.enableLighting=true;viewer.scene.globe.showGroundAtmosphere=true;viewer.scene.skyAtmosphere.show=true;viewer.scene.fog.enabled=true;
  viewer.camera.setView({destination:Cesium.Cartesian3.fromDegrees(12,24,25000000)});
  if(window.GAME_CONFIG?.cesiumIonToken){
    Cesium.createWorldTerrainAsync({requestVertexNormals:true,requestWaterMask:true}).then(t=>{if(viewer){viewer.terrainProvider=t;viewer.scene.requestRender()}}).catch(e=>console.warn('Terrain unavailable; check Cesium ion access and asset permissions.',e));
  } else $('#route-status').textContent='Globe ready. Add CESIUM_ION_TOKEN in Render to enable real elevation terrain.';
  viewer.screenSpaceEventHandler.setInputAction(e=>{
    if(!user||flight)return;
    const c=viewer.camera.pickEllipsoid(e.position,viewer.scene.globe.ellipsoid);if(!c)return;
    const g=Cesium.Cartographic.fromCartesian(c);
    $('#to-lat').value=Cesium.Math.toDegrees(g.latitude).toFixed(5);
    $('#to-lon').value=Cesium.Math.toDegrees(g.longitude).toFixed(5);updateRoute();
  },Cesium.ScreenSpaceEventType.LEFT_CLICK);
}
function updateRoute(){
  const a=[$('#from-lat').value,$('#from-lon').value,$('#to-lat').value,$('#to-lon').value].map(Number);
  const ok=a.every(Number.isFinite)&&a[0]>=-90&&a[0]<=90&&a[2]>=-90&&a[2]<=90&&a[1]>=-180&&a[1]<=180&&a[3]>=-180&&a[3]<=180&&$('#to-lat').value!==''&&$('#to-lon').value!=='';
  $('#start-flight').disabled=!ok;$('#route-status').textContent=ok?'Route ready · '+distanceNm(a[0],a[1],a[2],a[3]).toFixed(0)+' NM':'Choose a destination to unlock your flight.';
  if(ok&&viewer){
    const old=viewer.entities.getById('planned-route');if(old)viewer.entities.remove(old);
    viewer.entities.add({id:'planned-route',polyline:{positions:Cesium.Cartesian3.fromDegreesArray([a[1],a[0],a[3],a[2]]),width:2,material:Cesium.Color.CYAN.withAlpha(.75),arcType:Cesium.ArcType.GEODESIC}});
    const dest=viewer.entities.getById('destination');if(dest)viewer.entities.remove(dest);
    viewer.entities.add({id:'destination',position:Cesium.Cartesian3.fromDegrees(a[3],a[2]),point:{pixelSize:10,color:Cesium.Color.ORANGE,outlineColor:Cesium.Color.WHITE,outlineWidth:2},label:{text:'DESTINATION',font:'12px monospace',fillColor:Cesium.Color.WHITE,outlineColor:Cesium.Color.BLACK,outlineWidth:3,style:Cesium.LabelStyle.FILL_AND_OUTLINE,pixelOffset:new Cesium.Cartesian2(0,-18)}});
  }
}
function distanceNm(a,b,c,d){const r=Math.PI/180,dl=(c-a)*r,dn=(d-b)*r,x=Math.sin(dl/2)**2+Math.cos(a*r)*Math.cos(c*r)*Math.sin(dn/2)**2;return 3440.065*2*Math.atan2(Math.sqrt(x),Math.sqrt(Math.max(0,1-x)))}
function addPin(id,lat,lon,label,color){if(!viewer)return;const existing=viewer.entities.getById(id);if(existing)viewer.entities.remove(existing);viewer.entities.add({id,position:Cesium.Cartesian3.fromDegrees(lon,lat),point:{pixelSize:9,color,outlineColor:Cesium.Color.WHITE,outlineWidth:2},label:{text:label,font:'12px monospace',fillColor:Cesium.Color.WHITE,outlineColor:Cesium.Color.BLACK,outlineWidth:3,style:Cesium.LabelStyle.FILL_AND_OUTLINE,pixelOffset:new Cesium.Cartesian2(0,-17),distanceDisplayCondition:new Cesium.DistanceDisplayCondition(0,12000000)}})}
function hpr(position,hdg,pitch=0,roll=0){return Cesium.Transforms.headingPitchRollQuaternion(Cesium.Cartesian3.fromDegrees(position.lon,position.lat,position.altitude*0.3048),new Cesium.HeadingPitchRoll(Cesium.Math.toRadians(90-hdg),pitch,roll))}
function modelUrl(id){return aircraft.find(a=>a.id===id)?.model||FALLBACK_MODEL}
function ensureAircraftModel(id,pos,hdg,planeId,color,isMine=false){
  if(!viewer)return;
  const old=viewer.entities.getById(id);if(old)viewer.entities.remove(old);
  const url=modelUrl(planeId);
  const ent=viewer.entities.add({id,position:Cesium.Cartesian3.fromDegrees(pos.lon,pos.lat,Math.max(0,pos.altitude||0)*0.3048),orientation:hpr(pos,hdg),model:{uri:url,scale:1,minimumPixelSize:isMine?64:36,maximumScale:250,runAnimations:true},label:{text:isMine?'':String(pos.username||'Pilot'),font:'11px monospace',fillColor:color,outlineColor:Cesium.Color.BLACK,outlineWidth:3,style:Cesium.LabelStyle.FILL_AND_OUTLINE,pixelOffset:new Cesium.Cartesian2(0,-20),distanceDisplayCondition:new Cesium.DistanceDisplayCondition(0,5000000)}});
  modelUrls.set(id,url);return ent;
}
function syncMyModel(){
  if(!viewer||!flight)return;
  const ent=viewer.entities.getById('my-plane');
  const p=Cesium.Cartesian3.fromDegrees(position.lon,position.lat,position.altitude*.3048);
  if(ent){ent.position=p;ent.orientation=hpr(position,heading,keys.w?-.04:keys.s?.04:0,keys.a?.08:keys.d?-.08:0)}
  const camera=$('#camera-mode')?.value||'chase';
  if(camera==='free')return;
  const target=Cesium.Cartesian3.clone(p);
  const offset=new Cesium.HeadingPitchRange(Cesium.Math.toRadians(90-heading),Cesium.Math.toRadians(camera==='cockpit'?-3:-18),camera==='cockpit'?12:Math.max(120,position.altitude*.12+220));
  viewer.camera.lookAt(target,offset);
}
function startFlight(){
  position={lat:Number($('#from-lat').value),lon:Number($('#from-lon').value),altitude:1000};heading=90;throttle=.25;verticalSpeed=0;
  flight=true;paused=false;hide('hangar');show('flight-hud');show('voice-panel');show('ai-panel');$('#pause-flight').textContent='PAUSE';
  if(viewer){viewer.trackedEntity=undefined;ensureAircraftModel('my-plane',{...position,username:user.username},heading,selected,Cesium.Color.CYAN,true);syncMyModel();viewer.scene.requestRender()}
  updateInstruments();if(socket)socket.emit('pilot:position',netPosition());
  loadWeather();if(token)api('/api/me/position',position,'PATCH').catch(()=>{});
  if($('#weather-layer').value!=='none')setWeatherLayer($('#weather-layer').value);
}
function stopFlight(){flight=false;if(viewer){viewer.camera.lookAtTransform(Cesium.Matrix4.IDENTITY);viewer.entities.removeById('my-plane')}hide('flight-hud');show('hangar')}
function updateInstruments(){
  const a=aircraft.find(x=>x.id===selected),speed=a.speed*throttle;
  $('#speed').innerHTML=Math.round(speed)+' <small>KTS</small>';
  $('#altitude').innerHTML=Math.round(position.altitude).toLocaleString()+' <small>FT</small>';
  $('#heading').textContent=String(Math.round(heading)).padStart(3,'0')+'°';
  $('#vertical-speed').innerHTML=Math.round(verticalSpeed)+' <small>FPM</small>';
}
function netPosition(){return {lat:position.lat,lon:position.lon,altitude:position.altitude,heading,speedKts:aircraft.find(x=>x.id===selected).speed*throttle,planeId:selected}}
function tick(ts){
  requestAnimationFrame(tick);if(!viewer)return;
  const dt=Math.min(.08,lastFrame?((ts-lastFrame)/1000):.016);lastFrame=ts;
  if(!flight||paused)return;
  const a=aircraft.find(x=>x.id===selected),speedKts=a.speed*throttle;
  const speedMps=speedKts*.514444;
  if(keys.a)heading=(heading-55*dt+360)%360;if(keys.d)heading=(heading+55*dt)%360;
  if(keys.shift)throttle=Math.min(1,throttle+.18*dt);if(keys.control)throttle=Math.max(.03,throttle-.18*dt);if(keys[' '])throttle=Math.max(0,throttle-.6*dt);
  const rad=Cesium.Math.toRadians(heading),distance=speedMps*dt,earth=6371008.8,latRad=Cesium.Math.toRadians(position.lat);
  const nextLat=latRad+(distance*Math.cos(rad))/earth;
  const denom=Math.max(.015,Math.cos(latRad));
  const nextLon=Cesium.Math.toRadians(position.lon)+(distance*Math.sin(rad))/(earth*denom);
  position.lat=Math.max(-89.95,Math.min(89.95,Cesium.Math.toDegrees(nextLat)));
  position.lon=((Cesium.Math.toDegrees(nextLon)+540)%360)-180;
  const climb=(keys.w?1:0)-(keys.s?1:0);
  verticalSpeed=climb*(selected==='glider'?350:1800)*Math.max(.2,throttle);
  position.altitude=Math.max(0,Math.min(65000,position.altitude+verticalSpeed*dt/60));
  updateInstruments();syncMyModel();
  if(socket)socket.volatile.emit('pilot:position',netPosition());
  if(Date.now()-lastWeather>60000){lastWeather=Date.now();loadWeather()}
  if(Date.now()%1000<80)api('/api/me/position',position,'PATCH').catch(()=>{});
  viewer.scene.requestRender();
}
function connectNetwork(){
  socket=io({auth:{token}});
  socket.on('connect',()=>{socket.emit('pilot:join',{...position,planeId:selected});safeText($('#voice-status'),'Connected to multiplayer. Enable microphone to talk.')});
  socket.on('connect_error',e=>safeText($('#voice-status'),'Online sign-in failed: '+e.message));
  socket.on('pilots:update',ps=>{ps.forEach(p=>{if(p.id!==socket.id)upsertRemote(p)});updatePilotList(ps)});
  socket.on('pilot:joined',p=>{upsertRemote(p);if(localStream)initiatePeer(p.id);refreshPilotList()});
  socket.on('pilot:moved',p=>upsertRemote(p));
  socket.on('pilot:left',id=>{viewer?.entities.removeById('pilot-'+id);remotePilots.delete(id);closePeer(id);refreshPilotList()});
  setupVoiceSignaling();
}
function upsertRemote(p){
  if(!p||p.id===socket?.id)return;remotePilots.set(p.id,p);
  const pos={lat:p.lat,lon:p.lon,altitude:p.altitude||1000,username:p.username};
  const old=viewer?.entities.getById('pilot-'+p.id);
  if(!old)ensureAircraftModel('pilot-'+p.id,pos,p.heading||0,p.planeId||'a320',Cesium.Color.LIME,false);
  else {old.position=Cesium.Cartesian3.fromDegrees(p.lon,p.lat,(p.altitude||1000)*.3048);old.orientation=hpr(pos,p.heading||0)}
  refreshPilotList();
}
function updatePilotList(ps){
  remotePilots.clear();ps.forEach(p=>{if(p.id!==socket?.id)remotePilots.set(p.id,p)});
  const count=ps.length;$('#pilot-count').textContent=count+' PILOT'+(count===1?'':'S');refreshPilotList();
}
function refreshPilotList(){
  const list=$('#pilot-list');list.replaceChildren();
  const own=document.createElement('div');own.textContent='● '+(user?.username||'You')+' (YOU)';own.style.color='#63e4ed';list.append(own);
  for(const p of remotePilots.values()){const row=document.createElement('div');row.textContent='● '+p.username+' · '+(p.planeId||'aircraft');row.title='Altitude '+Math.round(p.altitude||0)+' ft';list.append(row)}
  $('#pilot-count').textContent=(remotePilots.size+1)+' PILOT'+(remotePilots.size===0?'':'S');
}
async function locatePlace(){
  const q=$('#place-search').value.trim();if(!q)return;
  const coord=q.match(/^\s*(-?\d+(?:\.\d+)?)\s*[, ]\s*(-?\d+(?:\.\d+)?)\s*$/);
  if(coord){const lat=+coord[1],lon=+coord[2];if(Math.abs(lat)>90||Math.abs(lon)>180)return alert('Coordinates out of range.');$('#to-lat').value=lat;$('#to-lon').value=lon;viewer.camera.flyTo({destination:Cesium.Cartesian3.fromDegrees(lon,lat,1500000)});updateRoute();return}
  try{
    const r=await fetch('https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&q='+encodeURIComponent(q));
    const d=await r.json();if(!d.length)throw Error('Place not found. Try a more specific name or coordinates.');
    $('#to-lat').value=Number(d[0].lat).toFixed(5);$('#to-lon').value=Number(d[0].lon).toFixed(5);$('#place-search').value=d[0].display_name;
    viewer.camera.flyTo({destination:Cesium.Cartesian3.fromDegrees(+d[0].lon,+d[0].lat,1500000)});updateRoute();
  }catch(e){alert(e.message)}
}
async function loadWeather(){
  if(!token)return;
  try{
    const d=await api('/api/weather?lat='+position.lat+'&lon='+position.lon,undefined,'GET');
    $('#weather').textContent='WEATHER · '+d.temperature+'°C · '+d.description+' · humidity '+d.humidity+'% · wind '+d.windMs+' m/s'+(d.city?' · '+d.city:'');
  }catch(e){$('#weather').textContent=e.message}
}
function setWeatherLayer(layer){
  if(!viewer)return;
  if(weatherImagery){viewer.imageryLayers.remove(weatherImagery,false);weatherImagery=null}
  if(layer==='none'){viewer.scene.requestRender();return}
  const provider=new Cesium.UrlTemplateImageryProvider({
    url:'/api/weather/tiles/'+layer+'/{z}/{x}/{y}.png',
    tilingScheme: new Cesium.WebMercatorTilingScheme(),
    maximumLevel:18,
    credit:'Weather tiles © OpenWeather'
  });
  weatherImagery=viewer.imageryLayers.addImageryProvider(provider);
  weatherImagery.alpha=.62;viewer.scene.requestRender();
}
$('#auth-form').onsubmit=async e=>{
  e.preventDefault();$('#auth-error').textContent='';
  try{
    const r=await fetch('/api/auth/'+mode,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:$('#username').value,password:$('#password').value})});
    const d=await r.json();if(!r.ok)throw Error(d.error||'Sign in failed');
    token=d.token;user=d.user;selected=user.planeId||'a320';hide('auth-panel');show('hangar');show('logout');renderAircraft();connectNetwork();
    if(d.user.lastPosition){$('#from-lat').value=d.user.lastPosition.lat??40.6413;$('#from-lon').value=d.user.lastPosition.lon??-73.7781}
  }catch(err){$('#auth-error').textContent=err.message}
};
$$('.tab').forEach(b=>b.onclick=()=>{mode=b.dataset.mode;$$('.tab').forEach(x=>x.classList.toggle('active',x===b));$('#auth-submit').innerHTML=mode==='register'?'CREATE YOUR ACCOUNT <span>↗</span>':'SIGN IN <span>↗</span>';$('#password').autocomplete=mode==='register'?'new-password':'current-password'});
['from-lat','from-lon','to-lat','to-lon'].forEach(id=>$('#'+id).addEventListener('input',updateRoute));
$('#search-place').onclick=locatePlace;$('#place-search').addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();locatePlace()}});
$('#start-flight').onclick=startFlight;
$('#pause-flight').onclick=()=>{paused=!paused;$('#pause-flight').textContent=paused?'RESUME':'PAUSE'};
$('#return-hangar').onclick=stopFlight;
$('#logout').onclick=()=>{socket?.disconnect();location.reload()};
$('#camera-mode').onchange=()=>syncMyModel();
$('#weather-layer').onchange=e=>setWeatherLayer(e.target.value);
$('#time-of-day').oninput=e=>{if(viewer){const h=+e.target.value;viewer.clock.currentTime=Cesium.JulianDate.fromDate(new Date(Date.UTC(2025,5,21,Math.floor(h),Math.round((h%1)*60))));viewer.scene.globe.enableLighting=true;viewer.scene.requestRender()}};
window.addEventListener('keydown',e=>{if(['INPUT','TEXTAREA','SELECT'].includes(document.activeElement.tagName))return;const k=e.key.toLowerCase();if(['w','a','s','d','shift','control',' '].includes(k)){keys[k]=true;if(k===' ')e.preventDefault()}if(k==='c'&&flight){const m=$('#camera-mode');m.value=m.value==='chase'?'cockpit':m.value==='cockpit'?'free':'chase';syncMyModel()}});
window.addEventListener('keyup',e=>{keys[e.key.toLowerCase()]=false});
$$('[data-control]').forEach(b=>{const k={left:'a',right:'d',up:'w',down:'s',throttle:'shift'}[b.dataset.control];b.addEventListener('pointerdown',e=>{e.preventDefault();keys[k]=true});['pointerup','pointerleave','pointercancel'].forEach(ev=>b.addEventListener(ev,()=>keys[k]=false))});
$('#chat-form').onsubmit=async e=>{
  e.preventDefault();const input=$('#chat-input'),message=input.value.trim();if(!message)return;input.value='';
  $('#chat-log').textContent+='\n\nYOU: '+message;
  try{const d=await api('/api/assistant',{message,position,aircraft:selected,heading,speedKts:aircraft.find(x=>x.id===selected).speed*throttle,altitudeFt:position.altitude});$('#chat-log').textContent+='\n\nCOPILOT: '+d.reply}
  catch(err){$('#chat-log').textContent+='\n\nCOPILOT: '+err.message}
  $('#chat-log').scrollTop=$('#chat-log').scrollHeight;
};
function createPeer(id){
  if(peerConnections.has(id))return peerConnections.get(id);
  const pc=new RTCPeerConnection({iceServers:[
    {urls:'stun:stun.l.google.com:19302'},
    ...(window.GAME_CONFIG?.turnUrl&&window.GAME_CONFIG?.turnUsername&&window.GAME_CONFIG?.turnCredential?[{urls:window.GAME_CONFIG.turnUrl,username:window.GAME_CONFIG.turnUsername,credential:window.GAME_CONFIG.turnCredential}]:[])
  ]});
  if(localStream)localStream.getTracks().forEach(t=>pc.addTrack(t,localStream));
  pc.onicecandidate=e=>{if(e.candidate&&socket?.connected)socket.emit('voice:ice',{to:id,candidate:e.candidate})};
  pc.ontrack=e=>{
    let audio=document.getElementById('audio-'+id);
    if(!audio){audio=document.createElement('audio');audio.id='audio-'+id;audio.autoplay=true;audio.playsInline=true;document.body.append(audio)}
    audio.srcObject=e.streams[0];audio.play().catch(()=>safeText($('#voice-status'),'Click the page to allow incoming audio playback.'));
  };
  pc.onconnectionstatechange=()=>{if(pc.connectionState==='failed'||pc.connectionState==='closed')closePeer(id)};
  peerConnections.set(id,pc);return pc;
}
async function initiatePeer(id){
  if(!localStream||!socket?.connected||id===socket.id||peerConnections.has(id))return;
  try{const pc=createPeer(id),offer=await pc.createOffer();await pc.setLocalDescription(offer);socket.emit('voice:offer',{to:id,offer})}
  catch(e){console.warn('Voice connection could not start',e)}
}
function closePeer(id){const pc=peerConnections.get(id);if(pc){pc.ontrack=null;pc.close();peerConnections.delete(id)}document.getElementById('audio-'+id)?.remove()}
function setupVoiceSignaling(){
  socket.on('voice:offer',async({from,offer})=>{
    if(!localStream)return;
    try{const pc=createPeer(from);await pc.setRemoteDescription(offer);const answer=await pc.createAnswer();await pc.setLocalDescription(answer);socket.emit('voice:answer',{to:from,answer})}catch(e){console.warn('Voice offer failed',e)}
  });
  socket.on('voice:answer',async({from,answer})=>{try{const pc=peerConnections.get(from);if(pc&&!pc.remoteDescription)await pc.setRemoteDescription(answer)}catch(e){console.warn(e)}});
  socket.on('voice:ice',async({from,candidate})=>{try{await peerConnections.get(from)?.addIceCandidate(candidate)}catch{}});
}
$('#voice-toggle').onclick=async()=>{
  try{
    if(!socket?.connected)throw Error('Sign in to multiplayer again before starting voice.');
    localStream=await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:true,noiseSuppression:true,autoGainControl:true}});
    muted=false;$('#voice-toggle').textContent='VOICE CONNECTED';$('#voice-mute').disabled=false;$('#voice-mute').textContent='MUTE MICROPHONE';safeText($('#voice-status'),'Microphone live. Use mute to pause your outgoing audio.');
    for(const id of remotePilots.keys())await initiatePeer(id);
  }catch(e){safeText($('#voice-status'),'Microphone unavailable: '+e.message)}
};
$('#voice-mute').onclick=()=>{if(!localStream)return;muted=!muted;localStream.getAudioTracks().forEach(t=>t.enabled=!muted);$('#voice-mute').textContent=muted?'UNMUTE MICROPHONE':'MUTE MICROPHONE';safeText($('#voice-status'),muted?'Your microphone is muted.':'Your microphone is live.')};
initGlobe();renderAircraft();requestAnimationFrame(tick);