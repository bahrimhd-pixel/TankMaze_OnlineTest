// Small, dependency-free public WebSocket host for the Tank Maze 1v1 playtest.
// The page automatically uses WSS when this server is behind an HTTPS host.
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const PORT = Number(process.env.PORT || 8080);
const PAGE = path.join(__dirname, 'tank-maze-online.html');
const W = 1100, H = 770, SCALE = 1.1;
const peers = new Set();
const clients = [null, null];
const enc = new TextEncoder();

function frame(data) {
  const body = Buffer.from(typeof data === 'string' ? data : JSON.stringify(data));
  let head;
  if (body.length < 126) head = Buffer.from([0x81, body.length]);
  else if (body.length < 65536) { head = Buffer.alloc(4); head[0]=0x81; head[1]=126; head.writeUInt16BE(body.length,2); }
  else { head = Buffer.alloc(10); head[0]=0x81; head[1]=127; head.writeBigUInt64BE(BigInt(body.length),2); }
  return Buffer.concat([head, body]);
}
function send(peer, data) { if (peer && !peer.closed) peer.socket.write(frame(data)); }
function broadcast(data) { for (const peer of peers) send(peer, data); }
function readFrames(peer, chunk) {
  peer.buffer = Buffer.concat([peer.buffer, chunk]);
  while (peer.buffer.length >= 2) {
    const b0=peer.buffer[0], b1=peer.buffer[1], opcode=b0&15, masked=!!(b1&128);
    let size=b1&127, offset=2;
    if (size===126) { if(peer.buffer.length<4)return; size=peer.buffer.readUInt16BE(2); offset=4; }
    else if(size===127) { if(peer.buffer.length<10)return; const n=peer.buffer.readBigUInt64BE(2); if(n>65536n){peer.socket.destroy();return;} size=Number(n); offset=10; }
    const maskBytes=masked?4:0; if(peer.buffer.length<offset+maskBytes+size)return;
    let payload=peer.buffer.subarray(offset+maskBytes,offset+maskBytes+size);
    if(masked){payload=Buffer.from(payload);const mask=peer.buffer.subarray(offset,offset+4);for(let i=0;i<payload.length;i++)payload[i]^=mask[i%4];}
    peer.buffer=peer.buffer.subarray(offset+maskBytes+size);
    if(opcode===8){peer.socket.end();return;} if(opcode===9){peer.socket.write(Buffer.from([0x8a,payload.length,...payload]));continue;}
    if(opcode===1){try{onMessage(peer,JSON.parse(payload.toString('utf8')));}catch{}}
  }
}

function emptyMatch() {
  const tank=(id,x,y,a)=>({id,x,y,a,moveA:a,hp:100,lives:3,alive:true,respawn:0,cooldown:0,boost:0});
  const add=(x,y,w,h,hp=0)=>({x:x*SCALE,y:y*SCALE,w,h,hp,max:hp,dead:false});
  const wall=(x,y,w,h)=>({x,y,w,h,hp:0,max:0,dead:false});
  const world=[wall(0,0,W,22),wall(0,H-22,W,22),wall(0,0,22,H),wall(W-22,0,22,H)];
  [[245,105,145,30],[610,105,145,30],[245,565,145,30],[610,565,145,30],[420,90,34,128],[548,482,34,128],[160,280,120,30],[720,390,120,30]].forEach(a=>world.push(add(...a)));
  [[435,240,58,36,100],[510,422,58,36,100],[325,350,38,64,75],[637,315,38,64,75],[378,458,52,32,80],[570,210,52,32,80],[185,420,48,38,85],[760,255,48,38,85]].forEach(a=>world.push(add(...a)));
  return {phase:'waiting',tanks:[tank(0,145*SCALE,550*SCALE,-.55),tank(1,855*SCALE,150*SCALE,2.6)],world,bullets:[],pickups:[],elapsed:0,time:240,lockdown:-1,warned:[false,false],nextSupply:18,pendingSupply:null,winner:null,rematch:[false,false],message:'Waiting for the second player'};
}
let game=emptyMatch();
function dist(a,b){return Math.hypot(a.x-b.x,a.y-b.y)}
function clamp(v,a,b){return Math.max(a,Math.min(b,v))}
function safeRect(){const margins=[0,215,295],m=margins[game.lockdown+1]??295;return {l:22+m,r:W-22-m,t:22+m*.72,b:H-22-m*.72}}
function blocked(x,y,r){return game.world.some(o=>!o.dead&&x+r>o.x&&x-r<o.x+o.w&&y+r>o.y&&y-r<o.y+o.h)}
function move(t,dx,dy){let nx=clamp(t.x+dx,39,W-39);if(!blocked(nx,t.y,17))t.x=nx;let ny=clamp(t.y+dy,39,H-39);if(!blocked(t.x,ny,17))t.y=ny}
function notice(message){game.message=message;game.noticeUntil=Date.now()+2600;}
function startMatch(){game=emptyMatch();game.phase='playing';game.message='';notice('MATCH STARTED');}
function endMatch(winner){game.phase='ended';game.winner=winner;game.rematch=[false,false];game.message=winner===-1?'DRAW':`PLAYER ${winner+1} WINS`;}
function onMessage(peer, msg){
  if(msg.type==='input'&&game.phase==='playing'){
    const t=game.tanks[peer.slot]; if(!t)return;
    t.input={x:clamp(Number(msg.x)||0,-1,1),y:clamp(Number(msg.y)||0,-1,1),a:Number.isFinite(msg.a)?msg.a:t.a,fire:!!msg.fire};
  }
  if(msg.type==='rematch'&&game.phase==='ended'){
    game.rematch[peer.slot]=true;broadcast({type:'ready',rematch:game.rematch});
    if(game.rematch[0]&&game.rematch[1])startMatch();
  }
}
function disconnect(peer){if(peer.closed)return;peer.closed=true;peers.delete(peer);if(clients[peer.slot]===peer)clients[peer.slot]=null;if(game.phase==='playing'){game.phase='waiting';game.message=`Player ${peer.slot+1} disconnected. Match paused.`;}broadcast({type:'status',players:clients.map(Boolean),message:game.message});}
const server=http.createServer((req,res)=>{
  if(req.url==='/'||req.url==='/tank-maze-lan.html'){
    fs.readFile(PAGE,(err,data)=>{if(err){res.writeHead(500);res.end('Could not open Tank Maze LAN prototype.');return;}res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store'});res.end(data);});
  } else {res.writeHead(404);res.end('Not found');}
});
server.on('upgrade',(req,socket)=>{
  const key=req.headers['sec-websocket-key'];if(!key){socket.destroy();return;}
  const accept=crypto.createHash('sha1').update(key+'258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
  socket.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: '+accept+'\r\n\r\n');
  if(clients[0]&&clients[1]){socket.write(frame({type:'full',message:'This private room already has two players.'}));socket.end();return;}
  const slot=clients[0]?1:0,peer={socket,slot,buffer:Buffer.alloc(0),closed:false};clients[slot]=peer;peers.add(peer);
  socket.on('data',b=>readFrames(peer,b));socket.on('close',()=>disconnect(peer));socket.on('error',()=>disconnect(peer));
  send(peer,{type:'welcome',slot,players:clients.map(Boolean),message:slot===0?'You are Player 1. Waiting for Player 2.':'You are Player 2. Starting match.'});
  broadcast({type:'status',players:clients.map(Boolean),message:clients[0]&&clients[1]?'Both players connected. Match starting.':'Waiting for the second player.'});
  if(clients[0]&&clients[1]){startMatch();broadcast({type:'state',game});}
});

function tick(dt){
  if(game.phase!=='playing')return;
  game.elapsed+=dt;game.time=Math.max(0,game.time-dt);
  for(let i=0;i<2;i++){const stageAt=[120,180][i];if(!game.warned[i]&&game.elapsed>=stageAt-7){game.warned[i]=true;notice('LOCKDOWN WARNING');}}
  if(game.elapsed>=120&&game.lockdown<0){game.lockdown=0;notice('DISTRICT 1 SEALED');}
  if(game.elapsed>=180&&game.lockdown<1){game.lockdown=1;notice('DISTRICT 2 SEALED');}
  const rect=safeRect();
  for(const t of game.tanks){
    t.cooldown=Math.max(0,t.cooldown-dt);t.boost=Math.max(0,t.boost-dt);
    if(!t.alive){t.respawn-=dt;if(t.respawn<=0&&t.lives>0){t.alive=true;t.hp=100;let p=t.id===0?{x:145*SCALE,y:550*SCALE}:{x:855*SCALE,y:150*SCALE};if(p.x<rect.l+25||p.x>rect.r-25||p.y<rect.t+25||p.y>rect.b-25)p={x:(rect.l+rect.r)/2+(t.id===0?-100:100),y:(rect.t+rect.b)/2+(t.id===0?66:-66)};t.x=p.x;t.y=p.y;notice(`PLAYER ${t.id+1} RESPAWNED`);}continue;}
    if(t.x<rect.l||t.x>rect.r||t.y<rect.t||t.y>rect.b){damage(t,12*dt);if(game.phase!=='playing')return;}
    const i=t.input||{x:0,y:0,a:t.a,fire:false};t.a=i.a;const mag=Math.hypot(i.x,i.y);if(mag>.04){t.moveA=Math.atan2(i.y,i.x);const n=Math.max(1,mag),speed=(t.boost>0?195:174)*dt;move(t,i.x/n*speed*Math.min(1,mag),i.y/n*speed*Math.min(1,mag));}
    if(i.fire&&t.cooldown<=0){t.cooldown=.42;const speed=430*SCALE;game.bullets.push({x:t.x+Math.cos(t.a)*24*SCALE,y:t.y+Math.sin(t.a)*24*SCALE,vx:Math.cos(t.a)*speed,vy:Math.sin(t.a)*speed,team:t.id,life:1.8,damage:20});}
  }
  game.nextSupply-=dt;
  if(!game.pendingSupply&&game.nextSupply<=0){const spots=[{x:500*SCALE,y:145*SCALE},{x:205*SCALE,y:350*SCALE},{x:795*SCALE,y:350*SCALE},{x:500*SCALE,y:545*SCALE}];const s=spots[Math.floor(Math.random()*spots.length)];game.pendingSupply={x:s.x,y:s.y,timer:5};notice('FIELD SUPPLY INCOMING');}
  if(game.pendingSupply){game.pendingSupply.timer-=dt;if(game.pendingSupply.timer<=0){game.pickups.push({x:game.pendingSupply.x,y:game.pendingSupply.y,type:Math.random()<.5?'boost':'repair',life:14,supply:true});game.pendingSupply=null;game.nextSupply=38;notice('FIELD SUPPLY ARRIVED');}}
  for(let i=game.bullets.length-1;i>=0;i--){const b=game.bullets[i];b.x+=b.vx*dt;b.y+=b.vy*dt;b.life-=dt;let remove=b.life<=0||b.x<20||b.x>W-20||b.y<20||b.y>H-20;
    for(const o of game.world){if(!remove&&!o.dead&&b.x>o.x&&b.x<o.x+o.w&&b.y>o.y&&b.y<o.y+o.h){if(o.hp>0){o.hp-=b.damage;if(o.hp<=0){o.dead=true;if(Math.random()<.36)game.pickups.push({x:o.x+o.w/2,y:o.y+o.h/2,type:Math.random()<.5?'boost':'repair',life:12});}}remove=true;break;}}
    for(const t of game.tanks){if(!remove&&t.id!==b.team&&t.alive&&Math.hypot(b.x-t.x,b.y-t.y)<19){damage(t,b.damage);remove=true;}}
    if(remove)game.bullets.splice(i,1);
  }
  for(let i=game.pickups.length-1;i>=0;i--){const p=game.pickups[i];p.life-=dt;if(p.life<=0){game.pickups.splice(i,1);continue;}for(const t of game.tanks)if(t.alive&&dist(t,p)<30){if(p.type==='boost')t.boost=5;else t.hp=Math.min(100,t.hp+24);game.pickups.splice(i,1);notice(p.type==='boost'?'SPEED BOOST · 5 SEC':'FIELD REPAIR · +24 HP');break;}}
  if(game.time<=0){const [a,b]=game.tanks;endMatch(a.lives===b.lives?(a.hp===b.hp?-1:a.hp>b.hp?0:1):a.lives>b.lives?0:1);}
}
function damage(t,amount){if(!t.alive)return;t.hp-=amount;if(t.hp<=0){t.lives--;t.alive=false;t.respawn=10;t.hp=100;if(t.lives<=0)endMatch(1-t.id);}}
setInterval(()=>{tick(1/30);if(game.phase==='playing'||peers.size)broadcast({type:'state',game});},50);
server.listen(PORT,'0.0.0.0',()=>{
  console.log(`Tank Maze online room is running on port ${PORT}.`);
  if(process.env.RENDER_EXTERNAL_URL)console.log(`Public game link: ${process.env.RENDER_EXTERNAL_URL}`);
  else{const os=require('node:os');for(const rows of Object.values(os.networkInterfaces()))for(const item of rows||[])if(item.family==='IPv4'&&!item.internal)console.log(`Local test address: http://${item.address}:${PORT}`);}
  console.log('Keep this server instance running during a match.');
});
