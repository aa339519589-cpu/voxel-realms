import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

/* 基础工具 */
function mulberry32(a){return function(){a|=0;a=a+0x6D2B79F5|0;let t=Math.imul(a^a>>>15,1|a);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296;};}
const rand = mulberry32(20261023);
const R = (a,b)=>a+(b-a)*rand();
const pick = arr => arr[Math.floor(rand()*arr.length)];
function hash2(x,z){let h=(x*374761393+z*668265263)|0;h=Math.imul(h^(h>>>13),1274126177);h^=h>>>16;return (h>>>0)/4294967296;}

/* 渲染器 / 场景 / 相机 */
const isMobile = /Android|iPhone|iPad|Mobile/i.test(navigator.userAgent) || window.innerWidth < 680;
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
const PR = Math.min(window.devicePixelRatio || 1, isMobile ? 1.15 : 1.6);
renderer.setPixelRatio(PR);
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = !isMobile;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(42, window.innerWidth / window.innerHeight, 0.5, 1500);
const SUNDIR = new THREE.Vector3(52, 24, 22).normalize();

/* 天空（渐变 + 夕阳 + 星星）与环境光反射 */
function skyMaterial(disc){
  return new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: { sunDir: { value: SUNDIR.clone() }, disc: { value: disc } },
    vertexShader: `varying vec3 vDir; void main(){ vDir = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
    fragmentShader: `
      varying vec3 vDir; uniform vec3 sunDir; uniform float disc;
      float hash(vec3 p){ p = fract(p*0.3183099+.1); p *= 17.0; return fract(p.x*p.y*p.z*(p.x+p.y+p.z)); }
      void main(){
        vec3 d = normalize(vDir); float h = d.y;
        vec3 horizon = vec3(1.0,0.74,0.45);
        vec3 coral   = vec3(0.98,0.48,0.44);
        vec3 rose    = vec3(0.62,0.32,0.55);
        vec3 top     = vec3(0.16,0.15,0.40);
        vec3 col = mix(horizon, coral, smoothstep(0.0,0.18,h));
        col = mix(col, rose, smoothstep(0.10,0.42,h));
        col = mix(col, top,  smoothstep(0.35,0.95,h));
        vec3 below = mix(horizon*0.85, vec3(0.40,0.24,0.46), smoothstep(0.0,0.6,-h));
        col = mix(col, below, 1.0 - smoothstep(-0.05,0.0,h));
        float s = max(dot(d, sunDir), 0.0);
        col += vec3(1.0,0.62,0.30) * pow(s,5.0) * 0.55 * (0.6 + 0.4*(1.0-abs(h)));
        col += vec3(1.0,0.80,0.50) * pow(s,40.0) * 0.8;
        col += vec3(1.0,0.90,0.70) * smoothstep(0.9990,0.9996,s) * 6.0 * disc;
        float st = hash(floor(d*220.0));
        st = step(0.9975, st) * smoothstep(0.45,0.8,h);
        col += vec3(st) * 0.8 * disc;
        col = pow(col, vec3(2.2));
        gl_FragColor = vec4(col, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`
  });
}
const skyMesh = new THREE.Mesh(new THREE.SphereGeometry(600, 48, 24), skyMaterial(1));
skyMesh.renderOrder = -10;
scene.add(skyMesh);

{ // 用天空生成环境反射（水面、整体柔和补光）
  const envScene = new THREE.Scene();
  envScene.add(new THREE.Mesh(new THREE.SphereGeometry(50, 32, 16), skyMaterial(0)));
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(envScene, 0.04).texture;
  scene.environmentIntensity = 0.6;
}

/* 光照：温暖夕阳 + 冷色补光 + 阴影 */
const sun = new THREE.DirectionalLight(0xffcf9a, 3.4);
sun.position.copy(SUNDIR).multiplyScalar(90);
sun.target.position.set(0, 6, 0);
sun.castShadow = !isMobile;

const SM = isMobile ? 1024 : 2048;
sun.shadow.mapSize.set(SM, SM);
Object.assign(sun.shadow.camera, { left: -46, right: 46, top: 46, bottom: -46, near: 10, far: 220 });
sun.shadow.bias = -0.0003;
sun.shadow.normalBias = 0.04;
scene.add(sun, sun.target);
const fill = new THREE.DirectionalLight(0x9db4ff, 0.8);
fill.position.set(-40, 18, -30);
scene.add(fill);
scene.add(new THREE.HemisphereLight(0xffd6b0, 0x7a5a9a, 0.8));

/* 体素世界数据结构 */
const solids = new Map();
const key = (x,y,z) => x + ',' + y + ',' + z;
function col(hex, j = 0.04){
  const c = new THREE.Color(hex);
  if (j){ const o = {}; c.getHSL(o); c.setHSL(o.h, o.s, THREE.MathUtils.clamp(o.l + (rand()-0.5)*j*2, 0, 1)); }
  return c;
}
function put(x,y,z,hex,tag='',opt={}){
  solids.set(key(x,y,z), { x,y,z, c: col(hex, opt.glow ? 0 : (opt.j ?? 0.04)), glow: opt.glow || 0, tag });
}
const get = (x,y,z) => solids.get(key(x,y,z));
const del = (x,y,z) => solids.delete(key(x,y,z));
const decor = [];
function rect(cx,cz,w,d,y,colorFn,tag){
  const hx=(w-1)/2, hz=(d-1)/2;
  for(let x=cx-hx;x<=cx+hx;x++) for(let z=cz-hz;z<=cz+hz;z++)
    put(x,y,z, typeof colorFn==='function' ? colorFn(x,z) : colorFn, tag);
}

/* 浮空岛主体 */
const IR = 16, ID = 16;
const grassCols = [0x73c24b,0x68b744,0x7ccc52,0x5fae40];
const dirtCols  = [0x8a5a3a,0x7d5034,0x946240,0x70472f];
const stoneCols = [0x80838c,0x70737c,0x62656e,0x8b8d94];
for (let d = 0; d < ID; d++){
  const y = -d;
  const rr = IR * Math.pow(1 - d/ID, 0.75);
  const amp = d === 0 ? 0.5 : 1.4;
  const lim = Math.ceil(rr + 2);
  for (let x=-lim;x<=lim;x++) for (let z=-lim;z<=lim;z++){
    const n = (hash2(x,z)-0.5)*2*amp + Math.sin(x*0.45+z*0.3)*0.5*(d>0?1:0.3);
    if (Math.hypot(x,z) > rr + n) continue;
    const h = hash2(x*3+d, z*3-d);
    if (d === 0) put(x,y,z, grassCols[Math.floor(hash2(x*5,z*5)*4)], 'grass');
    else if (d === 1) put(x,y,z, h<0.3 ? 0x4c9a38 : dirtCols[Math.floor(h*4)%4], 'dirt');
    else if (d < 5) put(x,y,z, dirtCols[Math.floor(h*4)%4], 'dirt');
    else put(x,y,z, h<0.18 ? dirtCols[Math.floor(h*20)%4] : stoneCols[Math.floor(h*4)%4], 'deep');
  }
}

/* 锦鲤池 */
const POND = { x:-5, z:6, rx:6.5, rz:4 };
const inPond = (x,z,k=1) => ((x-POND.x)/(POND.rx*k))**2 + ((z-POND.z)/(POND.rz*k))**2 <= 1;
const inBridgeZone = (x,z) => x>=-14 && x<=3 && z>=3 && z<=9;
const waterCells = [];
for (let x=-14;x<=6;x++) for (let z=0;z<=12;z++){
  if (inPond(x,z) && get(x,0,z)){
    del(x,0,z);
    put(x,-1,z, pick([0x6f7f86,0x5d6d75,0xb9a67a,0x66767e]), 'bed');
    waterCells.push([x,z]);
  }
}
const rockCols = [0x8d8f96,0x7b7e86,0xa0a2a6,0x6d8a6a];
for (let x=-14;x<=6;x++) for (let z=0;z<=12;z++){
  if (!inPond(x,z) && inPond(x,z,1.28) && get(x,0,z)?.tag==='grass' && !inBridgeZone(x,z) && rand()<0.55){
    put(x,0,z,pick(rockCols),'rock');
    if (rand()<0.3) put(x,1,z,pick(rockCols),'rock');
  }
}
function boulder(x,z){
  for (let dx=0;dx<2;dx++) for (let dz=0;dz<2;dz++){
    if (inPond(x+dx,z+dz) || inBridgeZone(x+dx,z+dz)) continue;
    const h = 1 + Math.floor(rand()*2.2);
    for (let yy=0;yy<h;yy++) put(x+dx,yy,z+dz,pick(rockCols),'rock');
  }
}
[0.2, 1.2, 2.2, 3.1, 4.3, 5.4].forEach(a=>{
  boulder(Math.round(POND.x+(POND.rx+1.4)*Math.cos(a)), Math.round(POND.z+(POND.rz+1.4)*Math.sin(a)));
});

/* 木桥（拱形） */
(function bridge(){
  const woods = [0x9a5b34,0x8c5030,0xa4653a], red = 0xb5322a, dark = 0x5b3420;
  for (let x=-12;x<=1;x++){
    const t = x + 5.5;
    const h = Math.abs(t) <= 4 ? 2 : 1;
    for (let z=5;z<=7;z++) put(x,h,z, woods[(x+z)&1 ? 0 : 2], 'wood');
    for (const z of [5,7]){
      put(x,h+1,z,red,'rail');
      if (((x%3)+3)%3===0){ put(x,h+2,z,red,'rail'); put(x,h+3,z,0xe0b040,'rail'); }
      if (h===2) put(x,1,z,dark,'wood');
    }
    if (h===2 && Math.abs(t)<=3) put(x,1,6,dark,'wood');
  }
  for (const x of [-10,-1]) for (const z of [5,7]){ put(x,0,z,dark,'wood'); put(x,-1,z,dark,'wood'); }
  for (const x of [-6,-5]) for (const z of [5,7]){ put(x,1,z,dark,'wood'); put(x,0,z,dark,'wood'); put(x,-1,z,dark,'wood'); }
})();

/* 小径 */
for (let x=2;x<=4;x++) for (let z=4;z<=13;z++){
  if (get(x,0,z) && rand()<0.92) { del(x,0,z); put(x,0,z, rand()<0.25 ? 0x9a9a98 : pick([0xe6d9b5,0xdfd0a8,0xeadfc0]), 'path'); }
}

/* 五层宝塔 */
const lightsDef = [];
function pagoda(cx,cz){
  const stoneA=[0xbfb8a6,0xb3ac9b,0xc8c1b0], stoneB=[0xd1cab8,0xc6bfae];
  rect(cx,cz,15,15,0,()=>pick(stoneA),'stone');
  rect(cx,cz,11,11,1,()=>pick(stoneB),'stone');
  for (let x=cx-2;x<=cx+2;x++) put(x,1,cz+6,pick(stoneB),'stone');
  const red=0xb52a25, cream=0xf3e6c8;
  const tiers=[{bw:7,rw:13,bh:3},{bw:7,rw:11,bh:2},{bw:5,rw:9,bh:2},{bw:5,rw:7,bh:2},{bw:3,rw:5,bh:2}];
  let y0=2;
  tiers.forEach((t,i)=>{
    rect(cx,cz,t.bw+2,t.bw+2,y0,()=>pick([0x6b4426,0x7a4f2c]),'wood');
    const h=(t.bw-1)/2, winRow=t.bh-1;
    for (let dy=1;dy<=t.bh;dy++){
      for (let dx=-h;dx<=h;dx++) for (let dz=-h;dz<=h;dz++){
        const edge = Math.abs(dx)===h || Math.abs(dz)===h; if(!edge) continue;
        const corner = Math.abs(dx)===h && Math.abs(dz)===h;
        let c=cream, glow=0;
        if (corner) c=red;
        else if (dy===t.bh) c=red;
        else if (dy===winRow && ((dx===0&&Math.abs(dz)===h)||(dz===0&&Math.abs(dx)===h))) { c=0xffb85c; glow=1.5; }
        put(cx+dx,y0+dy,cz+dz,c,'wall',{glow});
      }
    }
    if (i===0) for (let dy=1;dy<=2;dy++) put(cx,y0+dy,cz+h,0xffb85c,'wall',{glow:1.3});
    const yr1=y0+t.bh+1, yr2=yr1+1, hr=(t.rw-1)/2;
    rect(cx,cz,t.rw,t.rw,yr1,(x,z)=>((x+z)&1?0x3f5268:0x485e76),'roof');
    rect(cx,cz,t.rw-2,t.rw-2,yr2,(x,z)=>((x+z)&1?0x4d647d:0x566f8a),'roof');
    for (const sx of [-1,1]) for (const sz of [-1,1]){
      put(cx+sx*hr,yr2,cz+sz*hr,0x566f8a,'roof');
      put(cx+sx*hr,yr2,cz+sz*(hr-1),0x4d647d,'roof');
      put(cx+sx*(hr-1),yr2,cz+sz*hr,0x4d647d,'roof');
      put(cx+sx*hr,yr1-1,cz+sz*hr,0xe6b64a,'gold',{glow:0.9});
    }
    y0 += t.bh + 3;
  });
  const sy = y0;
  for (let y=sy;y<=sy+5;y++) put(cx,y,cz,0xe0a82e,'gold');
  for (const y of [sy+1,sy+3,sy+5]) for (const [dx,dz] of [[1,0],[-1,0],[0,1],[0,-1]]) put(cx+dx,y,cz+dz,0xe8b840,'gold');
  put(cx,sy+6,cz,0xffd35a,'gold',{glow:1.4});
  lightsDef.push({x:cx,y:4.5,z:cz,i:40,d:16});
}
pagoda(3,-4);

/* 红色鸟居 */
function torii(cx,cz){
  const red=0xc9302a, blk=0x26262b;
  for (const dx of [-3,-2,2,3]) for (const dz of [0,1]){
    put(cx+dx,1,cz+dz,0x2b2b2b,'torii');
    for (let y=2;y<=8;y++) put(cx+dx,y,cz+dz,red,'torii');
  }
  for (let dx=-4;dx<=4;dx++) for (const dz of [0,1]){
    put(cx+dx,5,cz+dz,red,'torii');
    put(cx+dx,8,cz+dz,red,'torii');
  }
  for (const dz of [0,1]){ put(cx,6,cz+dz,0x3a2a1a,'torii'); put(cx,7,cz+dz,0xd8a838,'torii'); }
  for (const dz of [0,1]) for (let dx=-6;dx<=6;dx++){
    if (Math.abs(dx)<=5) put(cx+dx,9,cz+dz,blk,'torii');
    put(cx+dx,10,cz+dz,blk,'torii');
    if (Math.abs(dx)>=5) put(cx+dx,11,cz+dz,blk,'torii');
  }
}
torii(3,10);

/* 石灯笼 */
function lantern(cx,cz){
  const st=[0x9a9a98,0x8a8a88,0xa6a6a2], dk=[0x6e6e6c,0x5f5f5d];
  put(cx,1,cz,pick(st),'stone'); put(cx,2,cz,pick(st),'stone');
  for (let dx=-1;dx<=1;dx++) for (let dz=-1;dz<=1;dz++){
    put(cx+dx,3,cz+dz,pick(st),'stone');
    put(cx+dx,5,cz+dz,pick(dk),'stone');
  }
  for (const [dx,dz] of [[1,1],[1,-1],[-1,1],[-1,-1]]) put(cx+dx,4,cz+dz,pick(st),'stone');
  put(cx,4,cz,0xffc060,'glow',{glow:2.4});
  put(cx,6,cz,pick(dk),'stone'); put(cx,7,cz,pick(st),'stone');
  lightsDef.push({x:cx,y:4,z:cz,i:14,d:10});
}
[[6,6],[-13,3],[-8,-1],[12,0]].forEach(([x,z])=>lantern(x,z));

/* 樱花树 */
const trees = [];
const sakuraCols = [0xffc7d9,0xffc7d9,0xffb3cb,0xffb3cb,0xffa0bd,0xffdde8,0xfff2f6];
function sakura(tx,tz,H,cr,thick){
  const trunk=[0x5a3b2a,0x4e3324,0x664430];
  let x=tx, z=tz;
  const ends=[];
  for (let y=1;y<=H;y++){
    put(x,y,z,pick(trunk),'wood');
    if (thick && y<=Math.ceil(H*0.5)){ put(x+1,y,z,pick(trunk),'wood'); put(x,y,z+1,pick(trunk),'wood'); put(x+1,y,z+1,pick(trunk),'wood'); }
    if (y>=2 && y<H-1 && rand()<0.28){
      const nx = x + (rand()<0.5?-1:1), nz = z;
      put(nx,y,nz,pick(trunk),'wood'); x=nx;
    }
  }
  const dirs=[[1,0],[-1,0],[0,1],[0,-1],[1,1],[-1,-1],[1,-1],[-1,1]];
  const nb = 4 + Math.floor(rand()*2);
  for (let b=0;b<nb;b++){
    const [dx,dz]=pick(dirs), L=2+Math.floor(rand()*3), yb=H-3+Math.floor(rand()*3);
    for (let k=1;k<=L;k++) put(x+dx*k, yb+(k>=2?1:0), z+dz*k, pick(trunk),'wood');
    ends.push([x+dx*L, yb+1, z+dz*L]);
  }
  ends.push([x,H+1,z],[x,H+2,z]);
  for (let k=0;k<3;k++) ends.push([x+Math.round(R(-2,2)),H+Math.round(R(0,2)),z+Math.round(R(-2,2))]);
  ends.forEach(([ex,ey,ez])=>{
    const rr = cr*R(0.55,0.8), ri=Math.ceil(rr);
    for (let dx=-ri;dx<=ri;dx++) for (let dy=-ri;dy<=ri;dy++) for (let dz=-ri;dz<=ri;dz++){
      const dd = Math.sqrt(dx*dx+dz*dz+(dy*1.3)**2);
      if (dd > rr) continue;
      if (rand() < 0.1 + (dd/rr)*0.18) continue;
      const px=ex+dx, py=ey+dy, pz=ez+dz;
      if (py < 3 || solids.has(key(px,py,pz))) continue;
      put(px,py,pz,pick(sakuraCols),'blossom',{j:0.03});
    }
  });
  trees.push({x:tx,z:tz,cy:H+1,cr});
}
sakura(-11,-4,9,5.5,true);
sakura(12,5,7,4.5,false);
sakura(-7,-12,8,4.5,false);

/* 草地装饰：灌木、花、草丛、落瓣、莲叶 */
const freeGrass = (x,z) => get(x,0,z)?.tag==='grass' && !get(x,1,z) && !inPond(x,z,1.4) && !(x>=1&&x<=5&&z>=3&&z<=14);
for (let i=0;i<16;i++){
  const x=Math.round(R(-14,14)), z=Math.round(R(-14,14));
  if (!freeGrass(x,z) || Math.hypot(x,z)>13.5) continue;
  const gc=[0x3f8f3a,0x4aa044,0x35803a];
  for (let dx=0;dx<2;dx++) for (let dz=0;dz<2;dz++) if (freeGrass(x+dx,z+dz)){
    put(x+dx,1,z+dz,pick(gc),'bush');
    if (rand()<0.5) put(x+dx,2,z+dz,pick(gc),'bush');
  }
}
for (let i=0;i<4;i++){
  const a=R(0,6.28), r=R(11,13.5), x=Math.round(Math.cos(a)*r), z=Math.round(Math.sin(a)*r);
  if (freeGrass(x,z)) boulder(x,z);
}
for (let i=0;i<150;i++){
  const x=Math.round(R(-15,15)), z=Math.round(R(-15,15));
  if (!freeGrass(x,z)) continue;
  if (rand()<0.55) decor.push({x:x+R(-.3,.3),y:0.5+0.25,z:z+R(-.3,.3),sx:0.25,sy:0.5,sz:0.25,ry:R(0,3),c:pick([0x4f9f3a,0x58ad40,0x449333])});
  else decor.push({x:x+R(-.3,.3),y:0.5+0.15,z:z+R(-.3,.3),sx:0.3,sy:0.3,sz:0.3,ry:R(0,3),c:pick([0xffffff,0xffe14d,0xff8fb0,0xc9a6ff])});
}
trees.forEach(t=>{
  for (let i=0;i<70;i++){
    const a=R(0,6.28), r=Math.sqrt(rand())*t.cr*1.2;
    const x=Math.round(t.x+Math.cos(a)*r), z=Math.round(t.z+Math.sin(a)*r);
    if (get(x,0,z)?.tag==='grass' && !get(x,1,z)) decor.push({x:x+R(-.3,.3),y:0.53,z:z+R(-.3,.3),sx:0.3,sy:0.05,sz:0.22,ry:R(0,3),c:pick([0xffc7d9,0xffb3cb,0xffdde8])});
  }
});
waterCells.forEach(([x,z])=>{
  if (rand()<0.14){
    decor.push({x:x+R(-.1,.1),y:0.24,z:z+R(-.1,.1),sx:0.85,sy:0.08,sz:0.85,ry:R(0,3),c:pick([0x3d9a45,0x469f4c,0x358c3f])});
    if (rand()<0.4) decor.push({x,y:0.43,z,sx:0.3,sy:0.3,sz:0.3,ry:R(0,3),c:pick([0xff9fc0,0xffffff])});
  } else if (rand()<0.1){
    decor.push({x:x+R(-.3,.3),y:0.22,z:z+R(-.3,.3),sx:0.3,sy:0.04,sz:0.22,ry:R(0,3),c:pick([0xffc7d9,0xffdde8])});
  }
});

/* 周围的小型浮空岩 */
function floatRock(cx,cy,cz,r){
  const depth=Math.ceil(r*1.7);
  for (let d=0;d<=depth;d++){
    const rr = r*Math.pow(1-d/(depth+1),0.8);
    const li=Math.ceil(rr+1);
    for (let x=-li;x<=li;x++) for (let z=-li;z<=li;z++){
      const n=(hash2(x+cx*7,z+cz*7)-0.5)*1.2;
      if (Math.hypot(x,z) > rr+n) continue;
      const c = d===0 ? pick(grassCols) : d===1 ? pick(dirtCols) : pick(stoneCols);
      put(cx+x,cy-d,cz+z,c,'float');
    }
  }
}
floatRock(-24,-5,6,3);
floatRock(22,-9,-10,2.6);
floatRock(-18,-17,-17,3.5);
floatRock(25,-2,13,2);
floatRock(6,-14,26,2.5);

/* 水晶（岛底发光点缀）+ 隐藏体素剔除 + 生成实例网格 */
const dirs6 = [[1,0,0],[-1,0,0],[0,1,0],[0,-1,0],[0,0,1],[0,0,-1]];
const buried = v => dirs6.every(([a,b,c]) => solids.has(key(v.x+a,v.y+b,v.z+c)));
const all = [...solids.values()];
all.forEach(v=>{
  if (v.tag==='deep' && !buried(v) && rand()<0.04){
    v.c.setHex(pick([0x7fe8ff,0xb08cff,0xff9ad0])); v.glow=1.8; v.tag='crystal';
  }
});
const stdList = all.filter(v=>!v.glow && !buried(v));
const glowList = all.filter(v=>v.glow);
const boxGeo = new THREE.BoxGeometry(1,1,1);
function buildInstanced(list, geo, mat, shadows){
  const m = new THREE.InstancedMesh(geo, mat, list.length);
  const mtx = new THREE.Matrix4();
  list.forEach((v,i)=>{
    mtx.setPosition(v.x,v.y,v.z);
    m.setMatrixAt(i,mtx);
    m.setColorAt(i, v.glow ? v.c.clone().multiplyScalar(v.glow) : v.c);
  });
  m.instanceMatrix.needsUpdate = true;
  m.instanceColor.needsUpdate = true;
  m.castShadow = shadows; m.receiveShadow = shadows;
  return m;
}
const world = new THREE.Group();
scene.add(world);
world.add(buildInstanced(stdList, boxGeo, new THREE.MeshStandardMaterial({ roughness: 0.85, metalness: 0 }), true));
world.add(buildInstanced(glowList, boxGeo, new THREE.MeshBasicMaterial({ color: 0xffffff }), false));

// 小装饰（花、草、莲叶、落瓣）
{
  const m = new THREE.InstancedMesh(boxGeo, new THREE.MeshStandardMaterial({ roughness: 0.8 }), decor.length);
  const o = new THREE.Object3D();
  decor.forEach((d,i)=>{
    o.position.set(d.x,d.y,d.z); o.rotation.set(0,d.ry,0); o.scale.set(d.sx,d.sy,d.sz); o.updateMatrix();
    m.setMatrixAt(i,o.matrix); m.setColorAt(i,new THREE.Color(d.c));
  });
  m.receiveShadow = true;
  world.add(m);
}

/* 水面（逐格平面，避免透明接缝）+ 闪烁 */
const waterGeo = new THREE.PlaneGeometry(1,1); waterGeo.rotateX(-Math.PI/2);
const waterMat = new THREE.MeshStandardMaterial({ color: 0xffffff, transparent: true, opacity: 0.66, roughness: 0.08, metalness: 0.0, depthWrite: false });
const water = new THREE.InstancedMesh(waterGeo, waterMat, waterCells.length);
const waterBase = [];
{
  const mtx = new THREE.Matrix4();
  waterCells.forEach(([x,z],i)=>{
    mtx.setPosition(x,0.2,z); water.setMatrixAt(i,mtx);
    const c = new THREE.Color(pick([0x3fa7d0,0x3a9fcb,0x45add6])); waterBase.push(c); water.setColorAt(i,c);
  });
  water.receiveShadow = true;
  water.instanceColor.setUsage(THREE.DynamicDrawUsage);
  world.add(water);
}
const tmpC = new THREE.Color();

/* 锦鲤 */
const koiDefs = [
  { c:0xff6a2b, spot:0xfff4e8, ax:4.4, az:2.4, sp:0.33, ph:0.0, dir: 1, s:1.3 },
  { c:0xfff4e8, spot:0xff5a2a, ax:3.6, az:2.0, sp:0.42, ph:2.0, dir:-1, s:1.2 },
  { c:0xffb02e, spot:0xffffff, ax:4.9, az:2.8, sp:0.28, ph:4.0, dir: 1, s:1.25 },
  { c:0xe8381f, spot:0xfff0e0, ax:2.6, az:1.4, sp:0.50, ph:1.0, dir:-1, s:1.1 },
  { c:0x30303a, spot:0xff7a3a, ax:4.0, az:2.2, sp:0.36, ph:5.2, dir:-1, s:1.2 }
];
const kois = koiDefs.map(d=>{
  const g = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ color: d.c, roughness: 0.6 });
  const spotMat = new THREE.MeshStandardMaterial({ color: d.spot, roughness: 0.6 });
  const eyeMat = new THREE.MeshBasicMaterial({ color: 0x111111 });
  const add = (geo,m,x,y,z,parent=g)=>{ const me=new THREE.Mesh(geo,m); me.position.set(x,y,z); parent.add(me); return me; };
  add(new THREE.BoxGeometry(0.5,0.26,0.9),mat,0,0,0);
  add(new THREE.BoxGeometry(0.42,0.22,0.3),mat,0,0,0.55);
  add(new THREE.BoxGeometry(0.34,0.06,0.45),spotMat,0,0.15,0.05);
  add(new THREE.BoxGeometry(0.06,0.06,0.06),eyeMat,0.2,0.08,0.66);
  add(new THREE.BoxGeometry(0.06,0.06,0.06),eyeMat,-0.2,0.08,0.66);
  const f1 = add(new THREE.BoxGeometry(0.3,0.04,0.2),spotMat,0.32,-0.06,0.2); f1.rotation.z = -0.4;
  const f2 = add(new THREE.BoxGeometry(0.3,0.04,0.2),spotMat,-0.32,-0.06,0.2); f2.rotation.z = 0.4;
  const tailG = new THREE.Group(); tailG.position.z = -0.45; g.add(tailG);
  add(new THREE.BoxGeometry(0.22,0.16,0.4),mat,0,0,-0.2,tailG);
  add(new THREE.BoxGeometry(0.34,0.06,0.2),spotMat,0,0,-0.45,tailG);
  g.scale.setScalar(d.s);
  scene.add(g);
  return { g, tailG, d };
});

/* 灯光：石灯笼 / 宝塔点光源 */
const pLights = lightsDef.map(l=>{
  const p = new THREE.PointLight(0xffa860, l.i, l.d, 2);
  p.position.set(l.x,l.y,l.z); scene.add(p);
  return { p, base: l.i, ph: Math.random()*10 };
});

/* 体素云（天空与脚下云海） */
const clouds = [];
function makeCloud(){
  const u = R(2.2,3.2), cells = new Map();
  const nb = 3 + Math.floor(rand()*4);
  for (let b=0;b<nb;b++){
    const bx=Math.round(R(-5,5)), bz=Math.round(R(-3,3)), rx=R(2,4), ry=R(1,1.8), rz=R(1.5,3);
    for (let x=-5;x<=5;x++) for (let y=0;y<=2;y++) for (let z=-4;z<=4;z++){
      if (((x)/rx)**2+((y)/ry)**2+((z)/rz)**2 <= 1) cells.set(key(x+bx,y,z+bz),[x+bx,y,z+bz]);
    }
  }
  const list=[...cells.values()];
  const m = new THREE.InstancedMesh(boxGeo, new THREE.MeshBasicMaterial({ color: 0xffffff, fog:false }), list.length);
  const mtx = new THREE.Matrix4(), top=new THREE.Color(0xffeedd), bot=new THREE.Color(0xf29a98), c=new THREE.Color();
  list.forEach(([x,y,z],i)=>{
    mtx.makeScale(u,u,u); mtx.setPosition(x*u,y*u,z*u); m.setMatrixAt(i,mtx);
    c.lerpColors(bot,top,Math.min(1,y/2 + rand()*0.25)); m.setColorAt(i,c);
  });
  return m;
}
function addCloud(rMin,rMax,yMin,yMax){
  const m = makeCloud(); scene.add(m);
  clouds.push({ m, r:R(rMin,rMax), th:R(0,6.28), y:R(yMin,yMax), w:R(0.002,0.006) });
}
for (let i=0;i<(isMobile ? 9 : 16);i++) addCloud(30,140,-40,-26);
for (let i=0;i<(isMobile ? 5 : 9);i++) addCloud(90,150,18,55);

/* 飘落的樱花花瓣 */
const NP = isMobile ? 170 : 320;
const petalGeo = new THREE.BoxGeometry(0.26,0.05,0.18);
const petals = new THREE.InstancedMesh(petalGeo, new THREE.MeshStandardMaterial({ roughness: 0.7, emissive: 0x401a28, emissiveIntensity: 0.4 }), NP);
petals.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
petals.frustumCulled = false;
scene.add(petals);
const PP = new Float32Array(NP*3), PV = new Float32Array(NP), PH = new Float32Array(NP), PS = new Float32Array(NP*3), PW = new Float32Array(NP), PR_ = new Float32Array(NP*3);
const petalCols = [0xffc7d9,0xffb3cb,0xffdde8,0xff9fbf];
function spawnPetal(i, initial){
  let x,y,z;
  if (rand()<0.72){
    const t = trees[Math.floor(rand()*trees.length)];
    const a=rand()*6.283, r=Math.sqrt(rand())*t.cr;
    x=t.x+Math.cos(a)*r; z=t.z+Math.sin(a)*r; y=t.cy+R(-1.5,t.cr*0.8);
  } else {
    const a=rand()*6.283, r=Math.sqrt(rand())*18;
    x=Math.cos(a)*r; z=Math.sin(a)*r; y=R(6,30);
  }
  if (initial) y = R(1,26);
  PP[i*3]=x; PP[i*3+1]=y; PP[i*3+2]=z;
  PV[i]=R(0.55,1.2); PH[i]=R(0,6.28); PW[i]=R(0.25,0.8);
  PS[i*3]=R(-2,2); PS[i*3+1]=R(-2,2); PS[i*3+2]=R(-2,2);
}
for (let i=0;i<NP;i++){
  spawnPetal(i,true);
  PR_[i*3]=R(0,6); PR_[i*3+1]=R(0,6); PR_[i*3+2]=R(0,6);
  petals.setColorAt(i,new THREE.Color(pick(petalCols)));
}
const dummy = new THREE.Object3D();
function updatePetals(dt,t){
  for (let i=0;i<NP;i++){
    PP[i*3]   += (0.35 + Math.sin(t*0.8+PH[i])*PW[i])*dt;
    PP[i*3+1] -= PV[i]*dt;
    PP[i*3+2] += (0.12 + Math.cos(t*0.6+PH[i]*1.7)*PW[i])*dt;
    PR_[i*3]+=PS[i*3]*dt; PR_[i*3+1]+=PS[i*3+1]*dt; PR_[i*3+2]+=PS[i*3+2]*dt;
    const r = Math.hypot(PP[i*3],PP[i*3+2]);
    if ((PP[i*3+1] < 0.75 && r < 15) || PP[i*3+1] < -30) spawnPetal(i,false);
    dummy.position.set(PP[i*3],PP[i*3+1],PP[i*3+2]);
    dummy.rotation.set(PR_[i*3],PR_[i*3+1],PR_[i*3+2]);
    dummy.updateMatrix();
    petals.setMatrixAt(i,dummy.matrix);
  }
  petals.instanceMatrix.needsUpdate = true;
}

/* 控制器：自动旋转 + 自由观察 */
const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(1, 9, -1);
controls.enableDamping = true; controls.dampingFactor = 0.06;
controls.minDistance = 20; controls.maxDistance = 220;
controls.maxPolarAngle = Math.PI * 0.92;
controls.autoRotate = true; controls.autoRotateSpeed = 0.7;
function frameCamera(){
  const aspect = window.innerWidth / window.innerHeight;
  const vfov = THREE.MathUtils.degToRad(camera.fov);
  const hfov = 2 * Math.atan(Math.tan(vfov/2) * aspect);
  const distV = 42 / (2*Math.tan(vfov/2)) * 1.25;
  const distH = 44 / (2*Math.tan(hfov/2));
  const dist = Math.max(distV, distH, 60);
  const dir = new THREE.Vector3(-0.55, 0.38, 0.75).normalize();
  camera.position.copy(controls.target).addScaledVector(dir, dist);
}
frameCamera();
controls.update();
let autoOn = true, resumeTimer = null;
const rotBtn = document.getElementById('rot');
function setAuto(v){ autoOn = v; controls.autoRotate = v; rotBtn.textContent = '自动旋转：' + (v ? '开' : '关'); }
controls.addEventListener('start', ()=>{ controls.autoRotate = false; clearTimeout(resumeTimer); });
controls.addEventListener('end', ()=>{ clearTimeout(resumeTimer); resumeTimer = setTimeout(()=>{ if (autoOn) controls.autoRotate = true; }, 3500); });
rotBtn.addEventListener('click', ()=>setAuto(!autoOn));
window.addEventListener('keydown', e=>{ if (e.code === 'Space'){ e.preventDefault(); setAuto(!autoOn); } });

/* 后期：柔和泛光（备用：直接渲染） */
let composer = null;
if (!isMobile) try {
  composer = new EffectComposer(renderer);
  composer.renderTarget1.samples = 2;
  composer.renderTarget2.samples = 2;
  composer.setPixelRatio(PR);
  composer.setSize(window.innerWidth, window.innerHeight);
  composer.addPass(new RenderPass(scene, camera));
  composer.addPass(new UnrealBloomPass(new THREE.Vector2(window.innerWidth, window.innerHeight), 0.5, 0.8, 1.05));
  composer.addPass(new OutputPass());
} catch (e) { console.warn('Bloom disabled', e); composer = null; }
window.addEventListener('resize', ()=>{
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  if (composer) composer.setSize(window.innerWidth, window.innerHeight);
});

/* 动画循环 */
const clock = new THREE.Clock();
let first = true;
function animate(){
  requestAnimationFrame(animate);
  const dt = Math.min(clock.getDelta(), 0.05), t = clock.elapsedTime;
  controls.update();
  skyMesh.position.copy(camera.position);
  updatePetals(dt, t);
  // 水面闪烁
  for (let i=0;i<waterCells.length;i++){
    const [x,z] = waterCells[i];
    tmpC.copy(waterBase[i]).offsetHSL(0, 0, 0.05*Math.sin(t*1.6 + x*0.9 + z*0.7));
    water.setColorAt(i, tmpC);
  }
  water.instanceColor.needsUpdate = true;
  // 锦鲤游动
  kois.forEach(({g,tailG,d})=>{
    const th = d.ph + t*d.sp*d.dir;
    const k = 1 + 0.15*Math.sin(t*0.3 + d.ph);
    const x = POND.x + d.ax*k*Math.cos(th), z = POND.z + d.az*k*Math.sin(th);
    const dx = -d.ax*Math.sin(th)*d.dir, dz = d.az*Math.cos(th)*d.dir;
    g.position.set(x, -0.12 + Math.sin(t*0.8+d.ph)*0.04, z);
    g.rotation.y = Math.atan2(dx,dz) + Math.sin(t*5+d.ph)*0.06;
    tailG.rotation.y = Math.sin(t*6+d.ph)*0.5;
  });
  // 灯笼微弱闪烁
  pLights.forEach(l=>{ l.p.intensity = l.base * (0.9 + 0.1*Math.sin(t*3 + l.ph) + 0.05*Math.sin(t*7.3 + l.ph*2)); });
  // 云缓缓漂移
  clouds.forEach(c=>{
    c.th += c.w*dt;
    c.m.position.set(Math.cos(c.th)*c.r, c.y, Math.sin(c.th)*c.r);
  });
  if (composer) composer.render(); else renderer.render(scene, camera);
  if (first){ window.gardenReady = true; first = false; const l = document.getElementById('loading'); l.classList.add('hide'); setTimeout(()=>l.remove(), 900); }
}
animate();
