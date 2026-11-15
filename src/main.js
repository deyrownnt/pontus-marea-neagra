let THREE = null;
const THREE_SOURCES = [
  { label: 'cdnjs', url: 'https://cdnjs.cloudflare.com/ajax/libs/three.js/0.172.0/three.module.js' },
  { label: 'unpkg', url: 'https://unpkg.com/three@0.172.0/build/three.module.js' },
  { label: 'jsDelivr', url: 'https://cdn.jsdelivr.net/npm/three@0.172.0/build/three.module.js' }
];
async function loadThreeEngine() {
  const failures = [];
  for (const source of THREE_SOURCES) {
    let timeoutId = 0;
    try {
      const module = await Promise.race([
        import(source.url),
        new Promise((_, reject) => {
          timeoutId = setTimeout(() => reject(new Error(`Timeout la încărcarea Three.js de pe ${source.label}.`)), 4500);
        })
      ]);
      if (!module?.WebGLRenderer || module.REVISION !== '172') {
        throw new Error(`Versiune Three.js neașteptată de la ${source.label}.`);
      }
      window.PONTUS_3D_ENGINE = { available: true, revision: module.REVISION, source: source.label };
      document.documentElement.dataset.threeSource = source.label;
      console.info(`PONTUS 3D: Three.js r${module.REVISION} încărcat de pe ${source.label}.`);
      return module;
    } catch (error) {
      failures.push(`${source.label}: ${error?.message || error}`);
      console.warn(`PONTUS 3D: sursa ${source.label} nu a răspuns; încerc următoarea sursă.`, error);
    } finally {
      if (timeoutId) clearTimeout(timeoutId);
    }
  }
  const error = new Error(`Three.js nu a putut fi încărcat de pe niciuna dintre sursele disponibile. ${failures.join(' | ')}`);
  window.PONTUS_3D_ENGINE = { available: false, failures };
  window.__PONTUS_3D_IMPORT_ERROR__ = error.message;
  throw error;
}
try {
  THREE = await loadThreeEngine();
} catch (error) {
  console.error('PONTUS: motorul 3D nu este disponibil; este activat atlasul vizual local de rezervă.', error);
  document.documentElement.classList.add('no-webgl', 'world-fallback-active');
}
import { bibliography, milestones, chapters } from './data.js';
import { readParticipantRoster } from './participants-store.js';
import { BLACK_SEA_BOUNDS } from './geo-data.js';
import { MAP_WIDTH, WATER_LEVEL, MAP_DEPTH, geoToMap } from './geography.js';
import { BLACK_SEA_MASK_CONTOURS } from './coastline-fallback.js';

const $ = (s, root=document) => root.querySelector(s);
const $$ = (s, root=document) => [...root.querySelectorAll(s)];
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
const coarsePointer = matchMedia('(pointer: coarse)').matches;
const loading = $('#loading-screen');
let progress = 0;
const loadTick = setInterval(() => { progress = Math.min(progress + 7, 92); $('#loading-percent').textContent = String(progress).padStart(2,'0'); $('#loading-line-fill').style.width = `${progress}%`; }, 55);

// --- A single coherent WebGL narrative: the Black Sea relief becomes an archival volume. ---
let renderer, scene, camera, mapGroup, archiveGroup, ship, archiveShip, routeCurve, archiveRouteCurve, routePulseMesh, routeProgressLine, archiveRouteProgressLine, archiveRoutePulse, animationFrame;
// The vessel follows the reader from the first line to the end of the complete documentary.
const SHIP_BOW_LOCAL = THREE ? new THREE.Vector3(0, 0, -1) : null;
// Route centerline is kept offshore from the Bosphorus mouth to the waters just east of Caffa.
// Coordinates were checked against the bundled sea/land mask; the terminal city marker remains
// on the actual harbour location while the vessel stops just offshore, not on the shoreline.
const VOYAGE_COORDS = [[29.15,41.25],[29.65,41.68],[30.45,42.18],[31.55,42.72],[32.65,43.25],[33.70,43.85],[34.65,44.45],[35.50,45.03]];
// The main vessel and the archival chart miniature use the same normalized reading progress.
let lessonRouteProgress = 0;
let lessonRouteTarget = 0;
let lessonRouteRaf = 0;
let waterNormalTexture, waterSurfaceMaterial, waterSurfaceGeometry, waterBasePositions;
let bathymetryState = 'fallback';
let sceneTransition = null, queuedWorldMode = null, transitionToken = 0;
const sailMeshes = [];
const shipLanternLights = [];
const wakeLineMeshes = [];
let worldMode = 'map';
const canvas = $('#world');
let worldElapsed = 0;
let lastWorldFrame = 0;
let qualityScale = matchMedia('(pointer: coarse)').matches ? .76 : 1.22;
const minQualityScale = matchMedia('(pointer: coarse)').matches ? .58 : .82;
const maxQualityScale = matchMedia('(pointer: coarse)').matches ? .94 : 1.42;
let worldPaused = false;
let perfWindowStart = 0;
let perfFrameCount = 0;
let perfSlowWindows = 0;
let perfFastWindows = 0;
let lastQualityAdjustment = 0;
// Let requestAnimationFrame follow the display's native refresh rate. A fixed 60 Hz gate
// can halve cadence on 75 Hz panels (for example, producing ~37.5 frames/s).
const mapPins = [];
let storyWorld = null;
let storyWasActive = false;
let desiredStoryMode = '';
let desiredStoryProgress = 0;
let storyScrollRaf = 0;

function makeCanvasTexture(draw, width=1024, height=1024) {
  const c=document.createElement('canvas'); c.width=width;c.height=height;
  const ctx=c.getContext('2d'); draw(ctx,width,height);
  const t=new THREE.CanvasTexture(c); t.colorSpace=THREE.SRGBColorSpace; t.anisotropy=8; return t;
}

function createSail(width,height,color,registerAnimation=true) {
  const geo=new THREE.BufferGeometry(); const verts=[],uv=[],idx=[]; const nx=28,ny=30;
  for(let y=0;y<=ny;y++) for(let x=0;x<=nx;x++){
    const u=x/nx,v=y/ny;
    const curve=Math.sin(v*Math.PI)*Math.sin(u*Math.PI)*.12;
    verts.push((u-.5)*width+curve, (v-.5)*height, Math.sin(u*Math.PI)*.045);
    uv.push(u,v);
  }
  for(let y=0;y<ny;y++)for(let x=0;x<nx;x++){const a=y*(nx+1)+x,b=a+1,c=a+nx+1,d=c+1;idx.push(a,c,b,b,c,d);}
  geo.setAttribute('position',new THREE.Float32BufferAttribute(verts,3));geo.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));geo.setIndex(idx);geo.computeVertexNormals();
  if(!createSail.texture){
    createSail.texture=makeCanvasTexture((ctx,w,h)=>{
      ctx.fillStyle='#ded0b3';ctx.fillRect(0,0,w,h);
      for(let i=0;i<420;i++){
        const y=(i/420)*h;ctx.strokeStyle=i%3===0?'rgba(92,72,48,.065)':'rgba(255,255,255,.10)';
        ctx.lineWidth=i%7===0?1.5:.7;ctx.beginPath();ctx.moveTo(0,y);ctx.lineTo(w,y+Math.sin(i*.31)*1.8);ctx.stroke();
      }
      // Reinforced vertical panels and stitched hems make the sail read as woven canvas.
      ctx.strokeStyle='rgba(87,66,43,.19)';ctx.lineWidth=2;
      for(let x=64;x<w;x+=64){ctx.beginPath();ctx.moveTo(x,12);ctx.lineTo(x,w-12);ctx.stroke();}
      ctx.strokeStyle='rgba(255,249,231,.42)';ctx.lineWidth=5;ctx.strokeRect(12,12,w-24,h-24);
      ctx.setLineDash([3,7]);ctx.strokeStyle='rgba(86,63,40,.36)';ctx.lineWidth=1.4;ctx.strokeRect(20,20,w-40,h-40);ctx.setLineDash([]);
      for(let i=0;i<180;i++){const x=(i*73)%w,y=(i*137)%h;ctx.fillStyle='rgba(74,59,43,.07)';ctx.fillRect(x,y,1.2,1.2);}
      for(let i=0;i<32;i++){const x=(i*149)%w,y=(i*83)%h;ctx.fillStyle='rgba(150,125,88,.035)';ctx.beginPath();ctx.ellipse(x,y,10+(i%4)*3,3+(i%3),0,0,Math.PI*2);ctx.fill();}
    },768,768);
    createSail.texture.wrapS=THREE.ClampToEdgeWrapping;createSail.texture.wrapT=THREE.ClampToEdgeWrapping;
  }
  const mat=new THREE.MeshStandardMaterial({color,roughness:.94,side:THREE.DoubleSide,map:createSail.texture});
  const mesh=new THREE.Mesh(geo,mat);
  mesh.userData.basePositions=Float32Array.from(geo.attributes.position.array);
  mesh.userData.sailHeight=height;
  if(registerAnimation)sailMeshes.push(mesh);
  return mesh;
}

function addLine(parent,points,material,radius=.008){
  const curve=new THREE.CatmullRomCurve3(points.map(p=>new THREE.Vector3(...p)));
  const mesh=new THREE.Mesh(new THREE.TubeGeometry(curve,Math.max(24,points.length*10),radius,5,false),material);
  parent.add(mesh); return {mesh,curve};
}

function createShip({animateSails=true}={}){
  const g=new THREE.Group();
  const woodTexture=makeCanvasTexture((ctx,w,h)=>{
    ctx.fillStyle='#533725';ctx.fillRect(0,0,w,h);
    for(let i=0;i<90;i++){
      const y=(i/90)*h;ctx.strokeStyle=i%4===0?'rgba(20,10,6,.22)':'rgba(208,156,103,.12)';
      ctx.lineWidth=i%5===0?3:1;ctx.beginPath();ctx.moveTo(0,y);ctx.bezierCurveTo(w*.25,y+Math.sin(i)*4,w*.7,y+Math.cos(i*.7)*3,w,y+Math.sin(i*.2)*2);ctx.stroke();
    }
    for(let i=0;i<210;i++){const x=(i*97)%w,y=(i*53)%h;ctx.fillStyle='rgba(21,13,9,.22)';ctx.fillRect(x,y,2+(i%3),1);}
  },512,512);
  woodTexture.wrapS=woodTexture.wrapT=THREE.RepeatWrapping;woodTexture.repeat.set(2,3);
  const wood=new THREE.MeshStandardMaterial({color:0xffffff,map:woodTexture,roughness:.72,metalness:.04});
  const woodLight=new THREE.MeshStandardMaterial({color:0x98704c,roughness:.68});
  const darkWood=new THREE.MeshStandardMaterial({color:0x241a14,roughness:.75});
  const iron=new THREE.MeshStandardMaterial({color:0x303b3c,roughness:.36,metalness:.75});
  const brass=new THREE.MeshStandardMaterial({color:0xc29b64,metalness:.78,roughness:.27});
  // Full, asymmetrical merchant hull: a fine raised bow forward (-Z) and a broad,
  // transom stern aft (+Z). The extra sections keep the silhouette smooth in motion.
  const stations=[[-1.48,.018],[-1.34,.105],[-1.16,.22],[-.91,.33],[-.62,.41],[-.26,.455],[.16,.47],[.53,.445],[.82,.39],[1.06,.31],[1.26,.235],[1.32,.23]];
  const verts=[],hullUvs=[],indices=[],rings=44;
  stations.forEach(([z,w],stationIndex)=>{for(let j=0;j<=rings;j++){
    const a=j/rings*Math.PI*2;const x=Math.sin(a)*w;const y=.18+Math.cos(a)*(.18+w*.09);
    verts.push(x,y,z);hullUvs.push(stationIndex/(stations.length-1),j/rings);
  }});
  for(let i=0;i<stations.length-1;i++)for(let j=0;j<rings;j++){
    const a=i*(rings+1)+j,b=a+1,c=(i+1)*(rings+1)+j,d=c+1;
    // Outward-facing winding is important: the previous inward-facing faces
    // forced DoubleSide lighting and made the hull look torn under directional light.
    indices.push(a,c,b,b,c,d);
  }
  const hullGeo=new THREE.BufferGeometry();
  hullGeo.setAttribute('position',new THREE.Float32BufferAttribute(verts,3));
  hullGeo.setAttribute('uv',new THREE.Float32BufferAttribute(hullUvs,2));
  hullGeo.setIndex(indices);hullGeo.computeVertexNormals();
  const hull=new THREE.Mesh(hullGeo,wood);hull.material.side=THREE.FrontSide;g.add(hull);
  // A shaped transom closes the aft end instead of leaving a pinched, hollow point.
  const transomShape=new THREE.Shape();
  transomShape.moveTo(-.225,.055);transomShape.lineTo(-.215,.275);
  transomShape.quadraticCurveTo(0,.395,.215,.275);transomShape.lineTo(.225,.055);transomShape.lineTo(-.225,.055);
  const transom=new THREE.Mesh(new THREE.ShapeGeometry(transomShape,16),wood);
  transom.position.z=1.305;transom.material.side=THREE.DoubleSide;g.add(transom);
  // Plank strakes follow the actual hull sections rather than floating straight decorative lines.
  for(const side of [-1,1])for(let level=0;level<7;level++){
    const pts=[];stations.slice(1,-1).forEach(([z,w])=>{
      const x=side*w*(.94-level*.047);const y=.105+level*.043;pts.push([x,y,z]);
    });
    addLine(g,pts,level%2?darkWood:woodLight,.009);
  }
  // Deck follows the real hull outline: no rectangular slab protrudes past the bow or stern.
  const deckVertices=[],deckIndices=[];
  stations.forEach(([z,w])=>deckVertices.push(-w*.88,.345,z,w*.88,.345,z));
  for(let i=0;i<stations.length-1;i++){
    const a=i*2,b=a+1,c=a+2,d=a+3;deckIndices.push(a,c,b,b,c,d);
  }
  const deckGeometry=new THREE.BufferGeometry();
  deckGeometry.setAttribute('position',new THREE.Float32BufferAttribute(deckVertices,3));
  deckGeometry.setIndex(deckIndices);deckGeometry.computeVertexNormals();
  const deck=new THREE.Mesh(deckGeometry,new THREE.MeshStandardMaterial({color:0x8d6845,roughness:.79}));g.add(deck);
  const halfWidthAt=z=>{
    for(let i=0;i<stations.length-1;i++){
      const a=stations[i],b=stations[i+1];
      if(z>=a[0]&&z<=b[0])return THREE.MathUtils.lerp(a[1],b[1],(z-a[0])/(b[0]-a[0]));
    }
    return .018;
  };
  const plankGeo=new THREE.BoxGeometry(1,.012,.015),planks=new THREE.InstancedMesh(plankGeo,wood,25),dummy=new THREE.Object3D();
  for(let i=0;i<25;i++){
    const z=-1.28+i*.104;dummy.position.set(0,.355,z);dummy.scale.set(Math.max(.025,halfWidthAt(z)*1.72),1,1);
    dummy.updateMatrix();planks.setMatrixAt(i,dummy.matrix);
  }
  planks.instanceMatrix.needsUpdate=true;g.add(planks);
  // Gunwales and evenly spaced stanchions follow the changing beam of the hull.
  for(const side of [-1,1]){
    const railPoints=stations.map(([z,w])=>[side*w*.94,.47,z]);
    addLine(g,railPoints,woodLight,.023);
    for(let i=1;i<stations.length-1;i++){
      const [z,w]=stations[i],post=new THREE.Mesh(new THREE.BoxGeometry(.027,.145,.027),woodLight);
      post.position.set(side*w*.92,.405,z);g.add(post);
    }
  }
  // Hull portholes, dark iron rims, and a fine waterline seam.
  const portholeMat=new THREE.MeshStandardMaterial({color:0x172125,metalness:.58,roughness:.34});
  const portholeRim=new THREE.MeshStandardMaterial({color:0x6e5137,metalness:.64,roughness:.38});
  for(const side of [-1,1])for(let i=0;i<5;i++){
    const z=-.48+i*.23;const width=.43-Math.abs(z)*.14;
    const rim=new THREE.Mesh(new THREE.TorusGeometry(.027,.006,5,14),portholeRim);rim.position.set(side*width,.225,z);rim.rotation.y=side*Math.PI/2;g.add(rim);
    const glass=new THREE.Mesh(new THREE.CircleGeometry(.023,12),portholeMat);glass.position.set(side*(width+.003),.225,z);glass.rotation.y=side*Math.PI/2;g.add(glass);
  }
  for(const side of [-1,1])addLine(g,stations.slice(1,-1).map(([z,w])=>[side*w*.88,.185,z]),darkWood,.006);
  // Compact raised forecastle forward and quarterdeck aft stay inside the hull rails.
  const foredeck=new THREE.Mesh(new THREE.BoxGeometry(.43,.13,.40),wood);foredeck.position.set(0,.425,-1.065);g.add(foredeck);
  const sterncastle=new THREE.Mesh(new THREE.BoxGeometry(.56,.24,.43),wood);sterncastle.position.set(0,.535,.93);g.add(sterncastle);
  const sternRoof=new THREE.Mesh(new THREE.BoxGeometry(.62,.045,.48),woodLight);sternRoof.position.set(0,.68,.93);g.add(sternRoof);
  for(let x of [-.16,0,.16]){const window=new THREE.Mesh(new THREE.BoxGeometry(.065,.055,.012),darkWood);window.position.set(x,.55,1.155);g.add(window);}
  // One principal mast and square sail: a restrained interpretive medieval merchant-vessel silhouette.
  const mastHeight=1.72,mast=new THREE.Mesh(new THREE.CylinderGeometry(.043,.062,mastHeight,12),woodLight);mast.position.set(0,.40+mastHeight/2,-.12);g.add(mast);
  const yard=new THREE.Mesh(new THREE.CylinderGeometry(.025,.025,.98,10),woodLight);yard.rotation.z=Math.PI/2;yard.position.set(0,1.55,-.12);g.add(yard);
  const sail=createSail(.91,1.02,0xd7c7a8,animateSails);sail.position.set(0,1.18,-.135);g.add(sail);
  // A compact topsail and fore staysail give the merchant vessel a layered, believable rig.
  const topSail=createSail(.48,.43,0xe0d2b7,animateSails);topSail.position.set(0,1.83,-.12);topSail.scale.set(.94,.92,1);g.add(topSail);
  const ropeRiggingMat=new THREE.MeshStandardMaterial({color:0x9a805d,roughness:1});
  const foreMast=new THREE.Mesh(new THREE.CylinderGeometry(.026,.036,.92,10),woodLight);foreMast.position.set(0,.83,-.83);g.add(foreMast);
  const foreYard=new THREE.Mesh(new THREE.CylinderGeometry(.017,.017,.58,8),woodLight);foreYard.rotation.z=Math.PI/2;foreYard.position.set(0,1.18,-.83);g.add(foreYard);
  const foreSail=createSail(.57,.64,0xd8c9aa,animateSails);foreSail.position.set(0,.83,-.82);foreSail.rotation.z=-.06;g.add(foreSail);
  addLine(g,[[-.48,.48,-1.18],[0,2.12,-.12],[.46,.48,1.22]],darkWood,.008);
  // Taut standing rigging links the foremast, main mast, bowsprit and stern quarters.
  addLine(g,[[0,1.28,-1.03],[0,2.12,-.12],[-.43,.53,1.16]],ropeRiggingMat,.006);
  addLine(g,[[0,1.28,-1.03],[0,2.12,-.12],[.43,.53,1.16]],ropeRiggingMat,.006);
  addLine(g,[[-.29,.50,-1.45],[0,1.30,-.83],[.42,.52,-.06]],ropeRiggingMat,.0055);
  addLine(g,[[.29,.50,-1.45],[0,1.30,-.83],[-.42,.52,-.06]],ropeRiggingMat,.0055);
  // Deck hatches, cleats and a compact capstan are separate pieces, not painted decoration.
  const hatchFrameMat=new THREE.MeshStandardMaterial({color:0x493020,metalness:.14,roughness:.78});
  const hatchTopMat=new THREE.MeshStandardMaterial({color:0x8e6743,metalness:.03,roughness:.84});
  const hatch=new THREE.Mesh(new THREE.BoxGeometry(.34,.035,.28),hatchFrameMat);hatch.position.set(0,.435,.03);g.add(hatch);
  const hatchLid=new THREE.Mesh(new THREE.BoxGeometry(.29,.018,.23),hatchTopMat);hatchLid.position.set(0,.461,.03);g.add(hatchLid);
  for(let i=-2;i<=2;i++){const seam=new THREE.Mesh(new THREE.BoxGeometry(.27,.004,.006),darkWood);seam.position.set(0,.472,.03+i*.043);g.add(seam);}
  const capstanBase=new THREE.Mesh(new THREE.CylinderGeometry(.09,.105,.10,16),iron);capstanBase.position.set(0,.45,.58);g.add(capstanBase);
  const capstanCore=new THREE.Mesh(new THREE.CylinderGeometry(.04,.05,.20,12),woodLight);capstanCore.position.set(0,.58,.58);g.add(capstanCore);
  for(let i=0;i<6;i++){const a=i/6*Math.PI*2,bar=new THREE.Mesh(new THREE.BoxGeometry(.21,.018,.018),woodLight);bar.position.set(Math.cos(a)*.09,.64,.58+Math.sin(a)*.09);bar.rotation.y=-a;g.add(bar);}
  // Additional guardrail stanchions and fine brass belaying pins along both rails.
  for(const side of [-1,1])for(let i=0;i<8;i++){
    const z=-.66+i*.22,railPin=new THREE.Mesh(new THREE.CylinderGeometry(.009,.012,.075,7),brass);
    railPin.position.set(side*(.39+Math.sin(i*.36)*.035),.59,z);g.add(railPin);
  }
  addLine(g,[[.48,.48,-1.18],[0,2.12,-.12],[-.46,.48,1.22]],darkWood,.008);
  addLine(g,[[0,2.12,-.12],[0,.47,1.33]],darkWood,.007);
  addLine(g,[[-.5,1.55,-.12],[0,1.55,-.12],[.5,1.55,-.12]],darkWood,.006);
  // Bowsprit, rudder, steering oar and anchor hardware.
  const bowsprit=new THREE.Mesh(new THREE.CylinderGeometry(.018,.029,.72,10),woodLight);bowsprit.rotation.x=-Math.PI/2;bowsprit.rotation.z=-.06;bowsprit.position.set(0,.455,-1.25);g.add(bowsprit);
  // A compact brass prow cap marks the exact forward tip of the hull.
  const prow=new THREE.Mesh(new THREE.ConeGeometry(.048,.22,10),brass);prow.rotation.x=-Math.PI/2;prow.position.set(0,.34,-1.52);g.add(prow);
  const rudder=new THREE.Mesh(new THREE.BoxGeometry(.075,.36,.045),darkWood);rudder.position.set(0,.095,1.405);g.add(rudder);
  const steering=new THREE.Mesh(new THREE.CylinderGeometry(.014,.018,.48,8),woodLight);steering.rotation.z=.22;steering.position.set(.30,.43,1.02);g.add(steering);
  const anchor=new THREE.Mesh(new THREE.TorusGeometry(.085,.016,6,18),iron);anchor.position.set(-.31,.30,-.84);anchor.rotation.x=Math.PI/2;g.add(anchor);
  // Small cargo: barrels, timber crates and rope coils, instanced where possible.
  const barrelMat=woodLight;for(let i=0;i<3;i++){
    const bx=-.24+i*.22;
    const barrel=new THREE.Mesh(new THREE.CylinderGeometry(.085,.095,.20,16),barrelMat);barrel.position.set(bx,.53,.42);g.add(barrel);
    for(const y of [.455,.505,.565,.61]){const hoop=new THREE.Mesh(new THREE.TorusGeometry(.084,.006,5,20),iron);hoop.rotation.x=Math.PI/2;hoop.position.set(bx,y,.42);g.add(hoop);}
    const lid=new THREE.Mesh(new THREE.CircleGeometry(.074,16),darkWood);lid.rotation.x=-Math.PI/2;lid.position.set(bx,.632,.42);g.add(lid);
  }
  for(let i=0;i<2;i++){
    const crate=new THREE.Mesh(new THREE.BoxGeometry(.19,.16,.18),wood);crate.position.set(i?.25:-.22,.50,-.42);g.add(crate);
    const braceMat=woodLight;
    for(const side of [-1,1]){const brace=new THREE.Mesh(new THREE.BoxGeometry(.012,.17,.19),braceMat);brace.position.set((i?.25:-.22)+side*.047,.50,-.42);g.add(brace);}
  }
  // Brass fastening pins along both hull strakes, instanced to keep the added detail inexpensive.
  const rivetGeo=new THREE.SphereGeometry(.012,8,7),rivets=new THREE.InstancedMesh(rivetGeo,brass,36),rivetDummy=new THREE.Object3D();
  let rivetIndex=0;
  for(const side of [-1,1])for(let i=0;i<18;i++){
    const z=-.94+i*.108;const width=Math.max(.19,.43-Math.abs(z)*.14);
    rivetDummy.position.set(side*width,.285,z);rivetDummy.scale.set(1,.78,1);rivetDummy.updateMatrix();rivets.setMatrixAt(rivetIndex++,rivetDummy.matrix);
  }
  rivets.instanceMatrix.needsUpdate=true;g.add(rivets);
  // Coiled hemp lines and compact deck fittings make the cargo area read as a working vessel.
  const ropeMat=new THREE.MeshStandardMaterial({color:0x9a805d,roughness:1});
  for(let i=0;i<2;i++){
    const coil=new THREE.Mesh(new THREE.TorusGeometry(.075,.012,5,28),ropeMat);coil.rotation.x=Math.PI/2;coil.position.set(i?-.30:.30,.423,.02);g.add(coil);
    const cleat=new THREE.Mesh(new THREE.BoxGeometry(.045,.035,.09),iron);cleat.position.set(i?-.30:.30,.43,-.10);g.add(cleat);
  }
  const lantern=new THREE.Group();const lampBody=new THREE.Mesh(new THREE.BoxGeometry(.10,.13,.10),brass);lantern.add(lampBody);
  const lampGlass=new THREE.Mesh(new THREE.BoxGeometry(.072,.09,.072),new THREE.MeshStandardMaterial({color:0xf1c986,emissive:0xffa744,emissiveIntensity:.7,transparent:true,opacity:.82,roughness:.2}));lampGlass.position.y=.01;lantern.add(lampGlass);
  const lampGlow=new THREE.Mesh(new THREE.SphereGeometry(.035,12,10),new THREE.MeshBasicMaterial({color:0xffd28a}));lantern.add(lampGlow);lantern.position.set(0,.88,1.1);g.add(lantern);
  if(animateSails){const lanternLight=new THREE.PointLight(0xffc779,.11,.95,2);lanternLight.position.copy(lantern.position).add(new THREE.Vector3(0,.02,0));lanternLight.userData.baseIntensity=.11;g.add(lanternLight);shipLanternLights.push(lanternLight);}
  const pennant=new THREE.Mesh(new THREE.ConeGeometry(.075,.19,4),brass);pennant.rotation.z=Math.PI/2;pennant.position.set(0,2.21,-.12);g.add(pennant);
  g.traverse(node=>{if(node.isMesh){node.castShadow=true;node.receiveShadow=true;}});
  return g;
}

function buildGeographicSurfaceGeometry(segmentsX,segmentsZ){
  const positions=new Float32Array((segmentsX+1)*(segmentsZ+1)*3);
  const uvs=new Float32Array((segmentsX+1)*(segmentsZ+1)*2);
  const indices=new Uint32Array(segmentsX*segmentsZ*6);let pi=0,ui=0,ii=0;
  for(let iz=0;iz<=segmentsZ;iz++){
    const v=iz/segmentsZ,lat=BLACK_SEA_BOUNDS.north-v*(BLACK_SEA_BOUNDS.north-BLACK_SEA_BOUNDS.south);
    for(let ix=0;ix<=segmentsX;ix++){
      const u=ix/segmentsX,lon=BLACK_SEA_BOUNDS.west+u*(BLACK_SEA_BOUNDS.east-BLACK_SEA_BOUNDS.west);
      const [x,z]=geoToMap(lon,lat);positions[pi++]=x;positions[pi++]=0;positions[pi++]=z;
      uvs[ui++]=u;uvs[ui++]=1-v;
    }
  }
  for(let iz=0;iz<segmentsZ;iz++)for(let ix=0;ix<segmentsX;ix++){
    const a=iz*(segmentsX+1)+ix,b=a+1,c=a+segmentsX+1,d=c+1;
    indices[ii++]=a;indices[ii++]=c;indices[ii++]=b;indices[ii++]=b;indices[ii++]=c;indices[ii++]=d;
  }
  const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.BufferAttribute(positions,3));
  geometry.setAttribute('uv',new THREE.BufferAttribute(uvs,2));geometry.setIndex(new THREE.BufferAttribute(indices,1));geometry.computeVertexNormals();
  return geometry;
}
function makeHeightSampler(heightPixels,width,height){
  return (lon,lat)=>{
    const u=THREE.MathUtils.clamp((lon-BLACK_SEA_BOUNDS.west)/(BLACK_SEA_BOUNDS.east-BLACK_SEA_BOUNDS.west),0,1);
    const v=THREE.MathUtils.clamp((BLACK_SEA_BOUNDS.north-lat)/(BLACK_SEA_BOUNDS.north-BLACK_SEA_BOUNDS.south),0,1);
    const x=u*(width-1),y=v*(height-1),x0=Math.floor(x),y0=Math.floor(y),x1=Math.min(width-1,x0+1),y1=Math.min(height-1,y0+1),fx=x-x0,fy=y-y0;
    const a=heightPixels[(y0*width+x0)*4]/255,b=heightPixels[(y0*width+x1)*4]/255,c=heightPixels[(y1*width+x0)*4]/255,d=heightPixels[(y1*width+x1)*4]/255;
    return (a*(1-fx)+b*fx)*(1-fy)+(c*(1-fx)+d*fx)*fy;
  };
}
async function nextPaint(){
  // A render-frame yield keeps long geometry loops responsive. The timer fallback
  // prevents startup from waiting forever when a background tab throttles RAF.
  return new Promise(resolve=>{
    let settled=false,frame=0,timer=0;
    const finish=()=>{if(settled)return;settled=true;if(frame)cancelAnimationFrame(frame);if(timer)clearTimeout(timer);resolve();};
    frame=requestAnimationFrame(finish);
    timer=setTimeout(finish,80);
  });
}
async function computeProjectedGridNormals(geometry,segmentsX,segmentsZ,rowsPerBatch=48){
  const position=geometry.attributes.position;
  const normals=new Float32Array(position.count*3);
  const vertex=(x,z)=>((z*(segmentsX+1)+x)*3);
  for(let rowStart=0;rowStart<=segmentsZ;rowStart+=rowsPerBatch){
    const rowEnd=Math.min(segmentsZ+1,rowStart+rowsPerBatch);
    for(let z=rowStart;z<rowEnd;z++)for(let x=0;x<=segmentsX;x++){
      const zl=Math.max(0,z-1),zr=Math.min(segmentsZ,z+1),xl=Math.max(0,x-1),xr=Math.min(segmentsX,x+1);
      const a=vertex(x,zr),b=vertex(x,zl),c=vertex(xr,z),d=vertex(xl,z);
      const ax=position.array[a]-position.array[b],ay=position.array[a+1]-position.array[b+1],az=position.array[a+2]-position.array[b+2];
      const bx=position.array[c]-position.array[d],by=position.array[c+1]-position.array[d+1],bz=position.array[c+2]-position.array[d+2];
      let nx=ay*bz-az*by,ny=az*bx-ax*bz,nz= ax*by-ay*bx;
      const length=Math.hypot(nx,ny,nz)||1;nx/=length;ny/=length;nz/=length;
      const i=(z*(segmentsX+1)+x)*3;normals[i]=nx;normals[i+1]=ny;normals[i+2]=nz;
    }
    await nextPaint();
  }
  geometry.setAttribute('normal',new THREE.BufferAttribute(normals,3));
  geometry.computeBoundingSphere();
}
function createRasterSampler(raster,width,height,bounds,noData){
  const [west,south,east,north]=bounds;
  const noDataValue=(noData===null||noData===undefined||noData==='')?Number.NaN:Number(noData);
  const valid=value=>Number.isFinite(value)&&Math.abs(value)<12000&&(!Number.isFinite(noDataValue)||Math.abs(value-noDataValue)>.01);
  return (u,v)=>{
    const lon=BLACK_SEA_BOUNDS.west+u*(BLACK_SEA_BOUNDS.east-BLACK_SEA_BOUNDS.west);
    const lat=BLACK_SEA_BOUNDS.north-v*(BLACK_SEA_BOUNDS.north-BLACK_SEA_BOUNDS.south);
    if(lon<west-.0001||lon>east+.0001||lat<south-.0001||lat>north+.0001)return null;
    const rasterU=THREE.MathUtils.clamp((lon-west)/(east-west),0,1),rasterV=THREE.MathUtils.clamp((north-lat)/(north-south),0,1);
    const fx=rasterU*(width-1),fy=rasterV*(height-1);
    const x0=Math.floor(fx),y0=Math.floor(fy),x1=Math.min(width-1,x0+1),y1=Math.min(height-1,y0+1),tx=fx-x0,ty=fy-y0;
    const values=[raster[y0*width+x0],raster[y0*width+x1],raster[y1*width+x0],raster[y1*width+x1]];
    const weights=[(1-tx)*(1-ty),tx*(1-ty),(1-tx)*ty,tx*ty];let sum=0,weight=0;
    for(let i=0;i<4;i++){const value=Number(values[i]);if(valid(value)){sum+=value*weights[i];weight+=weights[i];}}
    return weight>.12?sum/weight:null;
  };
}
async function buildReliefGeometry(heightPixels,heightWidth,heightHeight,segmentsX=1024,segmentsZ=Math.round(1024*MAP_DEPTH/MAP_WIDTH),waterMaskPixels=null,maskWidth=0,maskHeight=0){
  const vertexCount=(segmentsX+1)*(segmentsZ+1);
  const positions=new Float32Array(vertexCount*3);
  const uvs=new Float32Array(vertexCount*2);
  const indices=new Uint32Array(segmentsX*segmentsZ*6);
  const sample=makeHeightSampler(heightPixels,heightWidth,heightHeight);
  const isSea=(u,v)=>{
    if(!waterMaskPixels||!maskWidth||!maskHeight)return true;
    const x=Math.min(maskWidth-1,Math.max(0,Math.round(u*(maskWidth-1))));
    const y=Math.min(maskHeight-1,Math.max(0,Math.round(v*(maskHeight-1))));
    return waterMaskPixels[(y*maskWidth+x)*4]>127;
  };
  let vi=0,ui=0,ii=0;
  // Generate vertex rows in short batches; the loading screen and surrounding UI
  // remain responsive instead of freezing during a multi-million vertex build.
  const rowsPerBatch=28;
  for(let izStart=0;izStart<=segmentsZ;izStart+=rowsPerBatch){
    const izEnd=Math.min(segmentsZ+1,izStart+rowsPerBatch);
    for(let iz=izStart;iz<izEnd;iz++){
      const v=iz/segmentsZ,lat=BLACK_SEA_BOUNDS.north-v*(BLACK_SEA_BOUNDS.north-BLACK_SEA_BOUNDS.south);
      for(let ix=0;ix<=segmentsX;ix++){
        const u=ix/segmentsX,lon=BLACK_SEA_BOUNDS.west+u*(BLACK_SEA_BOUNDS.east-BLACK_SEA_BOUNDS.west);
        const [x,z]=geoToMap(lon,lat),h=sample(lon,lat);
        positions[vi++]=x;positions[vi++]=.48+(h-.5)*.95;positions[vi++]=z;
        uvs[ui++]=u;uvs[ui++]=1-v;
      }
    }
    await nextPaint();
  }
  for(let izStart=0;izStart<segmentsZ;izStart+=rowsPerBatch){
    const izEnd=Math.min(segmentsZ,izStart+rowsPerBatch);
    for(let iz=izStart;iz<izEnd;iz++)for(let ix=0;ix<segmentsX;ix++){
      const a=iz*(segmentsX+1)+ix,b=a+1,c=a+segmentsX+1,d=c+1;
      indices[ii++]=a;indices[ii++]=c;indices[ii++]=b;indices[ii++]=b;indices[ii++]=c;indices[ii++]=d;
    }
    await nextPaint();
  }
  const geo=new THREE.BufferGeometry();
  geo.setAttribute('position',new THREE.BufferAttribute(positions,3));
  geo.setAttribute('uv',new THREE.BufferAttribute(uvs,2));
  geo.setIndex(new THREE.BufferAttribute(indices,1));
  await computeProjectedGridNormals(geo,segmentsX,segmentsZ);
  const applyRasterToGrid=async(raster,rasterWidth,rasterHeight,noData,bounds,kind)=>{
    if(!raster||raster.length!==rasterWidth*rasterHeight)throw new Error('Grila altimetrică are dimensiuni neașteptate.');
    const sampler=createRasterSampler(raster,rasterWidth,rasterHeight,bounds,noData);
    let positive=0,negative=0,sampled=0;
    for(let i=0;i<raster.length;i+=Math.max(1,Math.floor(raster.length/16000))){
      const v=Number(raster[i]);if(Number.isFinite(v)&&Math.abs(v)<12000){sampled++;if(v>0)positive++;else if(v<0)negative++;}
    }
    if(sampled<100)throw new Error('Grila raster nu conține suficiente valori numerice valide.');
    const sign=kind==='bathy'?(positive>negative?-1:1):1;
    const pos=geo.attributes.position;let appliedValues=0;
    const updateRows=32;
    for(let rowStart=0;rowStart<=segmentsZ;rowStart+=updateRows){
      const rowEnd=Math.min(segmentsZ+1,rowStart+updateRows);
      for(let iz=rowStart;iz<rowEnd;iz++){
        const v=iz/segmentsZ,lat=BLACK_SEA_BOUNDS.north-v*(BLACK_SEA_BOUNDS.north-BLACK_SEA_BOUNDS.south);
        for(let ix=0;ix<=segmentsX;ix++){
          const u=ix/segmentsX,sea=isSea(u,v);
          if((kind==='land'&&sea)||(kind==='bathy'&&!sea))continue;
          const elevation=sampler(u,v);if(elevation===null)continue;
          appliedValues++;
          const metres=kind==='bathy'?THREE.MathUtils.clamp(elevation*sign,-6500,0):THREE.MathUtils.clamp(elevation,-500,5200);
          pos.array[(iz*(segmentsX+1)+ix)*3+1]=WATER_LEVEL+metres*.00016;
        }
      }
      await nextPaint();
    }
    if(appliedValues<1000)throw new Error(`Grila ${kind==='land'?'topografică':'batimetrică'} a modificat prea puține noduri (${appliedValues}).`);
    pos.needsUpdate=true;
    await computeProjectedGridNormals(geo,segmentsX,segmentsZ);
    return {validSamples:sampled,appliedValues,sign,vertices:pos.count};
  };
  const applyBathymetry=(raster,rasterWidth,rasterHeight,noData,bounds=[26,39,43,48])=>applyRasterToGrid(raster,rasterWidth,rasterHeight,noData,bounds,'bathy');
  const applyLandElevation=(raster,rasterWidth,rasterHeight,noData,bounds=[26,39,43,48])=>applyRasterToGrid(raster,rasterWidth,rasterHeight,noData,bounds,'land');
  geo.computeBoundingSphere();
  return {geometry:geo,sampleHeight:sample,applyBathymetry,applyLandElevation,segmentsX,segmentsZ};
}
function addMapLabel(parent,text,lon,lat,opts={}){
  const canvas=document.createElement('canvas');canvas.width=512;canvas.height=128;const ctx=canvas.getContext('2d');
  ctx.fillStyle='rgba(5,16,21,.78)';ctx.strokeStyle='rgba(198,159,105,.8)';ctx.lineWidth=3;
  const r=14;ctx.beginPath();ctx.roundRect(8,10,496,108,r);ctx.fill();ctx.stroke();
  ctx.fillStyle='#e9dcc5';ctx.font='500 34px Georgia';ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText(text.toLocaleUpperCase('ro'),256,64);
  const texture=new THREE.CanvasTexture(canvas);texture.colorSpace=THREE.SRGBColorSpace;texture.anisotropy=4;
  const sprite=new THREE.Sprite(new THREE.SpriteMaterial({map:texture,transparent:true,depthWrite:false,opacity:.92}));
  const [x,z]=geoToMap(lon,lat);sprite.position.set(x,opts.y??.76,z);sprite.scale.set(opts.width||1.18,.30,1);parent.add(sprite);return sprite;
}
function addPortLandmark(parent,{lon,lat,kind='lighthouse',scale=1,baseY=.48,offset=[0,0]}={}){
  const [mapX,mapZ]=geoToMap(lon,lat);const x=mapX+offset[0],z=mapZ+offset[1];
  const stone=new THREE.MeshStandardMaterial({color:0x938875,roughness:.9});
  const cutStone=new THREE.MeshStandardMaterial({color:0xc9b89a,roughness:.84});
  const deepStone=new THREE.MeshStandardMaterial({color:0x4a4035,roughness:.88});
  const roof=new THREE.MeshStandardMaterial({color:0x514036,roughness:.8});
  const metal=new THREE.MeshStandardMaterial({color:0xb89460,metalness:.76,roughness:.31});
  const glass=new THREE.MeshStandardMaterial({color:0x9bc2bd,emissive:0x244c4b,emissiveIntensity:.26,roughness:.22,metalness:.12});
  const detail=new THREE.Group();
  const plinth=new THREE.Mesh(new THREE.CylinderGeometry(.125,.15,.04,24),stone);plinth.position.y=.02;detail.add(plinth);
  const plinthBand=new THREE.Mesh(new THREE.TorusGeometry(.13,.009,5,24),metal);plinthBand.rotation.x=Math.PI/2;plinthBand.position.y=.039;detail.add(plinthBand);
  if(kind==='citadel'){
    // A compact, readable coastal fortress: curtain wall, keep, corner towers, gate and crenellations.
    const keep=new THREE.Mesh(new THREE.BoxGeometry(.17,.26,.16),cutStone);keep.position.set(0,.19,-.006);detail.add(keep);
    const wallSpecs=[{p:[0,.115,-.125],s:[.39,.17,.045]},{p:[0,.115,.125],s:[.39,.17,.045]},{p:[-.175,.115,0],s:[.045,.17,.25]},{p:[.175,.115,0],s:[.045,.17,.25]}];
    wallSpecs.forEach(({p,s})=>{const wall=new THREE.Mesh(new THREE.BoxGeometry(...s),stone);wall.position.set(...p);detail.add(wall);});
    for(const [sx,sz] of [[-.18,-.13],[.18,-.13],[-.18,.13],[.18,.13]]){
      const tower=new THREE.Mesh(new THREE.CylinderGeometry(.035,.044,.29,12),cutStone);tower.position.set(sx,.19,sz);detail.add(tower);
      const capBand=new THREE.Mesh(new THREE.TorusGeometry(.035,.006,5,16),metal);capBand.position.set(sx,.31,sz);detail.add(capBand);
      const cap=new THREE.Mesh(new THREE.ConeGeometry(.047,.075,8),roof);cap.position.set(sx,.375,sz);detail.add(cap);
      const slit=new THREE.Mesh(new THREE.BoxGeometry(.012,.055,.009),deepStone);slit.position.set(sx,.205,sz+.039);detail.add(slit);
    }
    // Parapet merlons and a shallow arched gate.
    const merlons=new THREE.InstancedMesh(new THREE.BoxGeometry(.035,.045,.052),cutStone,12),dummy=new THREE.Object3D();let n=0;
    for(const side of [-1,1])for(let i=0;i<3;i++){dummy.position.set(-.11+i*.11,.225,side*.128);dummy.updateMatrix();merlons.setMatrixAt(n++,dummy.matrix);}
    for(const side of [-1,1])for(let i=0;i<3;i++){dummy.position.set(side*.18,.225,-.075+i*.075);dummy.rotation.y=Math.PI/2;dummy.updateMatrix();merlons.setMatrixAt(n++,dummy.matrix);dummy.rotation.y=0;}
    merlons.instanceMatrix.needsUpdate=true;detail.add(merlons);
    const gate=new THREE.Mesh(new THREE.BoxGeometry(.075,.115,.012),deepStone);gate.position.set(0,.095,.153);detail.add(gate);
    const gateArch=new THREE.Mesh(new THREE.TorusGeometry(.039,.008,5,16,Math.PI),metal);gateArch.position.set(0,.15,.156);detail.add(gateArch);
    for(let i=0;i<3;i++){const window=new THREE.Mesh(new THREE.BoxGeometry(.018,.04,.012),deepStone);window.position.set(-.045+i*.045,.24,.087);detail.add(window);}
  }else if(kind==='harbor'){
    const quay=new THREE.Mesh(new THREE.BoxGeometry(.42,.075,.15),cutStone);quay.position.set(-.015,.075,.025);detail.add(quay);
    const quayCap=new THREE.Mesh(new THREE.BoxGeometry(.44,.018,.17),stone);quayCap.position.set(-.015,.122,.025);detail.add(quayCap);
    const pier=new THREE.Mesh(new THREE.BoxGeometry(.13,.045,.31),stone);pier.position.set(.19,.048,-.115);detail.add(pier);
    // Timber pilings are slightly tapered and carry iron collars.
    for(const [px,pz] of [[.14,-.25],[.25,-.25],[.14,.02],[.25,.02]]){
      const pile=new THREE.Mesh(new THREE.CylinderGeometry(.014,.021,.23,9),roof);pile.position.set(px,-.005,pz);detail.add(pile);
      const collar=new THREE.Mesh(new THREE.TorusGeometry(.017,.004,5,12),metal);collar.rotation.x=Math.PI/2;collar.position.set(px,.07,pz);detail.add(collar);
    }
    // A small cargo crane with braced mast, boom, pulley, rope and hook.
    const crane=new THREE.Group();
    const mast=new THREE.Mesh(new THREE.CylinderGeometry(.018,.026,.27,9),roof);mast.position.set(-.11,.20,-.02);crane.add(mast);
    const boom=new THREE.Mesh(new THREE.CylinderGeometry(.012,.017,.30,9),metal);boom.rotation.z=-.70;boom.position.set(-.025,.31,-.02);crane.add(boom);
    const brace=new THREE.Mesh(new THREE.CylinderGeometry(.008,.008,.22,7),roof);brace.rotation.z=.72;brace.position.set(-.14,.235,-.02);crane.add(brace);
    const pulley=new THREE.Mesh(new THREE.TorusGeometry(.035,.008,5,16),metal);pulley.position.set(.08,.405,-.02);crane.add(pulley);
    const rope=new THREE.Mesh(new THREE.CylinderGeometry(.003,.003,.22,5),deepStone);rope.position.set(.09,.29,-.02);crane.add(rope);
    const hook=new THREE.Mesh(new THREE.TorusGeometry(.018,.004,5,10,Math.PI*1.4),metal);hook.rotation.z=Math.PI;hook.position.set(.09,.17,-.02);crane.add(hook);
    detail.add(crane);
    for(let i=0;i<2;i++){
      const crate=new THREE.Mesh(new THREE.BoxGeometry(.075,.07,.07),roof);crate.position.set(-.17+i*.09,.17,.10);detail.add(crate);
      const band=new THREE.Mesh(new THREE.BoxGeometry(.079,.009,.074),metal);band.position.set(-.17+i*.09,.19,.10);detail.add(band);
    }
    const bollardGeo=new THREE.CylinderGeometry(.012,.016,.055,8);
    for(const px of [-.16,.02]){const bollard=new THREE.Mesh(bollardGeo,metal);bollard.position.set(px,.15,.085);detail.add(bollard);}
  }else{
    // Stone lighthouse with stepped base, narrow door, lantern glazing and a delicate balcony.
    for(const [radius,y,h] of [[.075,.055,.035],[.060,.20,.25],[.070,.345,.035]]){
      const tierMaterial=y<.10?stone:cutStone;const tier=new THREE.Mesh(new THREE.CylinderGeometry(radius*.84,radius,h,16),tierMaterial);tier.position.y=y;detail.add(tier);
    }
    const towerBand=new THREE.Mesh(new THREE.TorusGeometry(.063,.006,5,20),metal);towerBand.rotation.x=Math.PI/2;towerBand.position.y=.33;detail.add(towerBand);
    const door=new THREE.Mesh(new THREE.BoxGeometry(.022,.085,.012),deepStone);door.position.set(0,.09,.063);detail.add(door);
    const doorArch=new THREE.Mesh(new THREE.TorusGeometry(.013,.004,4,12,Math.PI),metal);doorArch.position.set(0,.132,.066);detail.add(doorArch);
    for(const [wx,wy] of [[-.028,.22],[.028,.22],[0,.29]]){const slit=new THREE.Mesh(new THREE.BoxGeometry(.009,.026,.008),deepStone);slit.position.set(wx,wy,.061);detail.add(slit);}
    const balcony=new THREE.Mesh(new THREE.TorusGeometry(.074,.009,5,28),metal);balcony.rotation.x=Math.PI/2;balcony.position.y=.345;detail.add(balcony);
    const railPosts=new THREE.InstancedMesh(new THREE.CylinderGeometry(.003,.003,.045,5),metal,24),dummy=new THREE.Object3D();
    for(let i=0;i<24;i++){const a=i/24*Math.PI*2;dummy.position.set(Math.cos(a)*.074,.365,Math.sin(a)*.074);dummy.updateMatrix();railPosts.setMatrixAt(i,dummy.matrix);}railPosts.instanceMatrix.needsUpdate=true;detail.add(railPosts);
    const lanternGlass=new THREE.Mesh(new THREE.CylinderGeometry(.047,.047,.074,12,1,true),glass);lanternGlass.position.y=.405;detail.add(lanternGlass);
    for(let i=0;i<8;i++){const bar=new THREE.Mesh(new THREE.CylinderGeometry(.003,.003,.078,5),metal);const a=i/8*Math.PI*2;bar.position.set(Math.cos(a)*.048,.405,Math.sin(a)*.048);detail.add(bar);}
    const roofCap=new THREE.Mesh(new THREE.ConeGeometry(.068,.085,12),roof);roofCap.position.y=.485;detail.add(roofCap);
    const finial=new THREE.Mesh(new THREE.SphereGeometry(.012,8,6),metal);finial.position.y=.535;detail.add(finial);
    const beacon=new THREE.Mesh(new THREE.SphereGeometry(.019,10,8),new THREE.MeshBasicMaterial({color:0xffd99b}));beacon.position.y=.407;detail.add(beacon);
  }
  detail.position.set(x,baseY,z);detail.scale.setScalar(scale);detail.userData.kind=kind;detail.userData.coordinates={lon,lat};
  detail.traverse(node=>{if(node.isMesh){node.castShadow=true;node.receiveShadow=true;}});
  parent.add(detail);return detail;
}

async function createMapScene(assets){
  const g=new THREE.Group();
  const boardMat=new THREE.MeshStandardMaterial({color:0x111b1f,roughness:.58,metalness:.35});
  const edgeMat=new THREE.MeshStandardMaterial({color:0x9c7951,roughness:.28,metalness:.82});
  const underlay=new THREE.Mesh(new THREE.BoxGeometry(MAP_WIDTH+.38,.30,MAP_DEPTH+.38),edgeMat);underlay.position.set(0,-.26,0);g.add(underlay);
  const board=new THREE.Mesh(new THREE.BoxGeometry(MAP_WIDTH+.31,.28,MAP_DEPTH+.31),boardMat);board.position.set(0,-.22,0);g.add(board);
  const cornerGeo=new THREE.CylinderGeometry(.055,.055,.035,24);const cornerMat=edgeMat;
  for(const x of [-MAP_WIDTH/2-.11,MAP_WIDTH/2+.11])for(const z of [-MAP_DEPTH/2-.11,MAP_DEPTH/2+.11]){
    const bolt=new THREE.Mesh(cornerGeo,cornerMat);bolt.position.set(x,-.055,z);bolt.castShadow=true;g.add(bolt);
    const inset=new THREE.Mesh(new THREE.CylinderGeometry(.022,.022,.006,16),new THREE.MeshStandardMaterial({color:0x4f3a29,metalness:.58,roughness:.42}));inset.position.set(x,-.034,z);g.add(inset);
  }
  // Fine metal rails and small engraved scale marks frame the relief without covering the geography.
  const railMat=new THREE.MeshStandardMaterial({color:0xb28b5d,metalness:.76,roughness:.32});
  for(const z of [-MAP_DEPTH/2-.145,MAP_DEPTH/2+.145]){
    const rail=new THREE.Mesh(new THREE.BoxGeometry(MAP_WIDTH+.20,.025,.024),railMat);rail.position.set(0,-.065,z);rail.castShadow=true;g.add(rail);
  }
  for(const x of [-MAP_WIDTH/2-.145,MAP_WIDTH/2+.145]){
    const rail=new THREE.Mesh(new THREE.BoxGeometry(.024,.025,MAP_DEPTH+.20),railMat);rail.position.set(x,-.065,0);rail.castShadow=true;g.add(rail);
  }
  const graduationMat=new THREE.MeshStandardMaterial({color:0xd8bd8f,metalness:.62,roughness:.38});
  const horizontalTicks=new THREE.InstancedMesh(new THREE.BoxGeometry(.012,.010,.075),graduationMat,34),tickDummy=new THREE.Object3D();
  for(let i=0;i<34;i++){tickDummy.position.set(-MAP_WIDTH/2+i*(MAP_WIDTH/33),-.047,-MAP_DEPTH/2-.145);tickDummy.scale.set(1,1,i%4===0?1.7:1);tickDummy.updateMatrix();horizontalTicks.setMatrixAt(i,tickDummy.matrix);}horizontalTicks.instanceMatrix.needsUpdate=true;g.add(horizontalTicks);
  const verticalTicks=new THREE.InstancedMesh(new THREE.BoxGeometry(.075,.010,.012),graduationMat,25);
  for(let i=0;i<25;i++){tickDummy.position.set(-MAP_WIDTH/2-.145,-.047,-MAP_DEPTH/2+i*(MAP_DEPTH/24));tickDummy.scale.set(i%4===0?1.7:1,1,1);tickDummy.updateMatrix();verticalTicks.setMatrixAt(i,tickDummy.matrix);}verticalTicks.instanceMatrix.needsUpdate=true;g.add(verticalTicks);
  const desktopMesh= !coarsePointer && (navigator.hardwareConcurrency||4)>=8 && (navigator.deviceMemory||8)>=8;
  const reliefSegmentsX=coarsePointer?512:(desktopMesh?1536:1024);
  const {geometry:terrainGeometry,sampleHeight,applyBathymetry,applyLandElevation,segmentsX,segmentsZ}=await buildReliefGeometry(assets.heightPixels,assets.heightWidth,assets.heightHeight,reliefSegmentsX,Math.round(reliefSegmentsX*MAP_DEPTH/MAP_WIDTH),assets.waterMaskPixels,assets.maskWidth,assets.maskHeight);
  const terrainMat=new THREE.MeshStandardMaterial({map:assets.albedo,normalMap:assets.reliefNormal||null,normalScale:new THREE.Vector2(.52,.52),bumpMap:assets.heightMap||null,bumpScale:.026,roughness:.88,metalness:.022});
  const terrain=new THREE.Mesh(terrainGeometry,terrainMat);terrain.name='WGS84 Lambert Conformal Conic regional terrain: local ETOPO1 visual fallback + high-detail shading normal + EMODnet numeric bathymetry when available';terrain.receiveShadow=true;g.add(terrain);
  // A separate, moderately tessellated sea surface clips to the real GSHHS water mask.
  // The bathymetric mesh remains below it, so the transparent sea reveals the actual basin relief.
  const waterSegmentsX=coarsePointer?192:320;
  const waterSegmentsZ=Math.round(waterSegmentsX*MAP_DEPTH/MAP_WIDTH);
  waterSurfaceGeometry=buildGeographicSurfaceGeometry(waterSegmentsX,waterSegmentsZ);
  waterBasePositions=Float32Array.from(waterSurfaceGeometry.attributes.position.array);
  waterSurfaceMaterial=new THREE.MeshPhysicalMaterial({color:0xffffff,roughness:.205,metalness:.065,clearcoat:.96,clearcoatRoughness:.045,reflectivity:.58,ior:1.333,normalMap:assets.waterNormal,normalScale:new THREE.Vector2(.39,.34),alphaMap:assets.waterMask,transparent:true,opacity:.43,depthWrite:false,side:THREE.DoubleSide});
  const water=new THREE.Mesh(waterSurfaceGeometry,waterSurfaceMaterial);water.name='GSHHG/GSHHS-masked animated sea surface';water.position.y=WATER_LEVEL+.004;water.renderOrder=2;g.add(water);
  // The land DEM and sea DTM arrive independently. Serialize their writes to the
  // shared vertex buffer so neither job can calculate normals while the other is
  // halfway through changing positions.
  let terrainUpdateQueue=Promise.resolve();
  const queueTerrainUpdate=(operation,...args)=>{
    const job=terrainUpdateQueue.then(()=>operation(...args));
    terrainUpdateQueue=job.catch(()=>{});
    return job;
  };
  g.userData.applyBathymetry=(...args)=>queueTerrainUpdate(applyBathymetry,...args);
  g.userData.applyLandElevation=(...args)=>queueTerrainUpdate(applyLandElevation,...args);
  g.userData.reliefResolution={segmentsX,segmentsZ,vertices:terrainGeometry.attributes.position.count};
  g.userData.waterSurface=water;g.userData.terrain=terrain;g.userData.terrainMaterial=terrainMat;
  // Real shoreline vectors are overlaid on the textured relief to preserve the shape at high visual zoom.
  const coastMat=new THREE.LineBasicMaterial({color:0xd9b37e,transparent:true,opacity:.88,depthWrite:false});
  const coastGlowMat=new THREE.LineBasicMaterial({color:0x4bb3bd,transparent:true,opacity:.18,depthWrite:false});
  const coastlineLayer=new THREE.Group();
  for(const segment of BLACK_SEA_MASK_CONTOURS){
    if(segment.length<4)continue;
    const points=segment.map(([lon,lat])=>{const [x,z]=geoToMap(lon,lat);return new THREE.Vector3(x,WATER_LEVEL+.026,z);});
    const lineGeometry=new THREE.BufferGeometry().setFromPoints(points);
    const glow=new THREE.Line(lineGeometry,coastGlowMat);glow.renderOrder=2.8;coastlineLayer.add(glow);
    const edge=new THREE.Line(lineGeometry,coastMat);edge.renderOrder=3;coastlineLayer.add(edge);
  }
  g.add(coastlineLayer);g.userData.coastlineLayer=coastlineLayer;g.userData.coastlineSource='GSHHS intermediate shoreline-mask contours; live GSHHG high-resolution vectors replace this fallback when available';
  // Geographic graticule, correctly registered to longitude and latitude.
  const gridPos=[];
  const addGeoGridPath=coordinates=>{for(let i=0;i<coordinates.length-1;i++){const [ax,az]=geoToMap(...coordinates[i]);const [bx,bz]=geoToMap(...coordinates[i+1]);gridPos.push(ax,.505,az,bx,.505,bz);}};
  for(let lon=26;lon<=42;lon+=2){const path=[];for(let lat=39;lat<=48.001;lat+=.12)path.push([lon,Math.min(lat,48)]);addGeoGridPath(path);}
  for(let lat=40;lat<=48;lat+=2){const path=[];for(let lon=26;lon<=43.001;lon+=.12)path.push([Math.min(lon,43),lat]);addGeoGridPath(path);}
  const gridGeo=new THREE.BufferGeometry();gridGeo.setAttribute('position',new THREE.Float32BufferAttribute(gridPos,3));
  g.add(new THREE.LineSegments(gridGeo,new THREE.LineBasicMaterial({color:0xc7aa7d,transparent:true,opacity:.15,depthTest:true})));
  // Named geographic reference points. Their positions are transformed from longitude/latitude.
  const markerMat=new THREE.MeshStandardMaterial({color:0xe3b978,metalness:.8,roughness:.24,emissive:0x513318,emissiveIntensity:.25});
  const markerData=[
    {name:'Constanța',lon:28.65,lat:44.17,width:1.1},
    {name:'Delta Dunării',lon:29.65,lat:45.16,width:1.35},
    {name:'Bosfor',lon:29.0,lat:41.12,width:.9},
    {name:'Caffa',lon:35.38,lat:45.03,width:.8},
    {name:'Batumi',lon:41.64,lat:41.65,width:.85}
  ];
  markerData.forEach(d=>{
    const [x,z]=geoToMap(d.lon,d.lat),y=Math.max(WATER_LEVEL+.035,.48+(sampleHeight(d.lon,d.lat)-.5)*.95+.035);
    const pin=new THREE.Group();const base=new THREE.Mesh(new THREE.CylinderGeometry(.075,.09,.025,24),markerMat);base.position.y=0;pin.add(base);
    const stem=new THREE.Mesh(new THREE.CylinderGeometry(.018,.025,.17,10),markerMat);stem.position.y=.095;pin.add(stem);
    const head=new THREE.Mesh(new THREE.SphereGeometry(.047,18,14),new THREE.MeshStandardMaterial({color:0xffdca8,emissive:0xa15e27,emissiveIntensity:.45}));head.position.y=.20;pin.add(head);
    pin.position.set(x,y,z);pin.userData.baseY=y;pin.userData.label=d.name;g.add(pin);mapPins.push(pin);
    addMapLabel(g,d.name,d.lon,d.lat,{width:d.width,y:y+.25});
  });
  // Three small, geographically anchored vignettes: a Bosporus lighthouse, a Constanța quay,
  // and the Crimean citadel at Caffa. They make the map read as a lived maritime region.
  const landmarkY=(lon,lat)=>Math.max(WATER_LEVEL+.02,.48+(sampleHeight(lon,lat)-.5)*.95+.025);
  addPortLandmark(g,{lon:29.0,lat:41.12,kind:'lighthouse',scale:.42,baseY:landmarkY(29.0,41.12),offset:[0,0]});
  addPortLandmark(g,{lon:28.65,lat:44.17,kind:'harbor',scale:.42,baseY:landmarkY(28.65,44.17),offset:[0,0]});
  addPortLandmark(g,{lon:35.38,lat:45.03,kind:'citadel',scale:.42,baseY:landmarkY(35.38,45.03),offset:[0,0]});
  // An explicitly illustrative maritime itinerary connecting the Bosporus with Crimea.
  const routePts=VOYAGE_COORDS.map(([lon,lat])=>{const [x,z]=geoToMap(lon,lat);return new THREE.Vector3(x,WATER_LEVEL+.055,z);});
  routeCurve=new THREE.CatmullRomCurve3(routePts,false,'centripetal',.35);
  const route=new THREE.Mesh(new THREE.TubeGeometry(routeCurve,240,.014,8,false),new THREE.MeshBasicMaterial({color:0xe3b67d,transparent:true,opacity:.25,depthWrite:false}));g.add(route);
  // A brighter route segment is revealed progressively as the reader advances through the lesson.
  const routeSamples=routeCurve.getPoints(320);
  const routeProgressGeometry=new THREE.BufferGeometry().setFromPoints(routeSamples);
  routeProgressLine=new THREE.Line(routeProgressGeometry,new THREE.LineBasicMaterial({color:0xffd49a,transparent:true,opacity:.98,depthWrite:false}));
  routeProgressLine.frustumCulled=false;routeProgressLine.renderOrder=4;routeProgressGeometry.setDrawRange(0,0);g.add(routeProgressLine);
  routePulseMesh=new THREE.Mesh(new THREE.SphereGeometry(.052,20,16),new THREE.MeshBasicMaterial({color:0xffe0ad}));g.add(routePulseMesh);
  const shipScale=coarsePointer?.36:.42;
  const shipGroup=createShip();shipGroup.scale.setScalar(shipScale);
  // The route point is the brass prow tip (local -Z), not the hull centre.
  shipGroup.userData.bowOffset=1.63*shipScale;
  shipGroup.userData.bowHeight=.34*shipScale;
  shipGroup.userData.vesselScale=shipScale;
  const initialShipPoint=routeCurve.getPointAt(0),initialShipTangent=routeCurve.getTangentAt(0);
  shipGroup.quaternion.setFromUnitVectors(SHIP_BOW_LOCAL,initialShipTangent);
  shipGroup.position.set(initialShipPoint.x-initialShipTangent.x*shipGroup.userData.bowOffset,WATER_LEVEL+.055-shipGroup.userData.bowHeight,initialShipPoint.z-initialShipTangent.z*shipGroup.userData.bowOffset);
  shipGroup.userData.forwardAxis=SHIP_BOW_LOCAL.clone();g.add(shipGroup);ship=shipGroup;
  // A pair of narrow, low-contrast wake ribbons trails the vessel and follows its real route.
  const wakeMatA=new THREE.LineBasicMaterial({color:0x9bd5d5,transparent:true,opacity:.23,depthWrite:false});
  const wakeMatB=new THREE.LineBasicMaterial({color:0x6bb8c1,transparent:true,opacity:.16,depthWrite:false});
  for(const [side,mat] of [[-1,wakeMatA],[1,wakeMatB]]){
    const wakeGeo=new THREE.BufferGeometry();wakeGeo.setAttribute('position',new THREE.BufferAttribute(new Float32Array(12*3),3));
    const wake=new THREE.Line(wakeGeo,mat);wake.frustumCulled=false;wake.visible=false;wake.renderOrder=2.4;g.add(wake);wakeLineMeshes.push({line:wake,side});
  }
  // Small corner legend stays subordinate to the real geography.
  const legendTex=makeCanvasTexture((ctx,w,h)=>{ctx.fillStyle='rgba(11,22,27,.92)';ctx.fillRect(0,0,w,h);ctx.strokeStyle='#b58d5d';ctx.lineWidth=4;ctx.strokeRect(12,12,w-24,h-24);ctx.fillStyle='#e0d1b6';ctx.font='bold 34px Georgia';ctx.fillText('PONTUS / RELIEF MODEL',36,66);ctx.font='23px monospace';ctx.fillStyle='#aab7b1';ctx.fillText('GSHHG / GSHHS · EMODnet DTM + WMS',36,112);},620,145);
  const legend=new THREE.Mesh(new THREE.PlaneGeometry(2.25,.53),new THREE.MeshBasicMaterial({map:legendTex,transparent:true,depthWrite:false}));legend.rotation.x=-Math.PI/2;legend.position.set(3.65,.02,MAP_DEPTH/2-.48);g.add(legend);
  return g;
}


function createArchiveScene(assets){
  const g=new THREE.Group();
  const deskTexture=makeCanvasTexture((ctx,w,h)=>{
    ctx.fillStyle='#30231b';ctx.fillRect(0,0,w,h);
    for(let i=0;i<150;i++){const y=i/150*h;ctx.strokeStyle=i%5===0?'rgba(9,7,5,.42)':'rgba(190,137,84,.10)';ctx.lineWidth=i%6===0?3:1;ctx.beginPath();ctx.moveTo(0,y);ctx.bezierCurveTo(w*.28,y+Math.sin(i*.7)*8,w*.68,y+Math.cos(i*.35)*6,w,y+Math.sin(i*.21)*5);ctx.stroke();}
    for(let i=0;i<520;i++){const x=(i*89)%w,y=(i*173)%h;ctx.fillStyle=i%3?'rgba(8,5,3,.10)':'rgba(226,184,128,.08)';ctx.fillRect(x,y,1+(i%2),1);}
  },1024,768);
  deskTexture.wrapS=deskTexture.wrapT=THREE.RepeatWrapping;deskTexture.repeat.set(2.4,1.8);
  const deskMat=new THREE.MeshStandardMaterial({color:0xffffff,map:deskTexture,roughness:.74,metalness:.08});
  const desk=new THREE.Mesh(new THREE.BoxGeometry(6.2,.18,4.3),deskMat);desk.position.y=-.18;desk.castShadow=true;desk.receiveShadow=true;g.add(desk);
  const deskEdgeMat=new THREE.MeshStandardMaterial({color:0x9b754d,metalness:.68,roughness:.36});
  for(const z of [-2.12,2.12]){const inlay=new THREE.Mesh(new THREE.BoxGeometry(6.06,.012,.018),deskEdgeMat);inlay.position.set(0,-.074,z);g.add(inlay);}
  for(const x of [-3.07,3.07]){const inlay=new THREE.Mesh(new THREE.BoxGeometry(.018,.012,4.08),deskEdgeMat);inlay.position.set(x,-.074,0);g.add(inlay);}
  const deskStuds=new THREE.InstancedMesh(new THREE.SphereGeometry(.026,8,7),deskEdgeMat,8),deskDummy=new THREE.Object3D();let studIndex=0;
  for(const x of [-3.02,3.02])for(const z of [-2.04,2.04])for(const extra of [-.12,.12]){deskDummy.position.set(x,-.075,z+extra);deskDummy.scale.set(1,.42,1);deskDummy.updateMatrix();deskStuds.setMatrixAt(studIndex++,deskDummy.matrix);}
  deskStuds.instanceMatrix.needsUpdate=true;g.add(deskStuds);
  const leatherTexture=makeCanvasTexture((ctx,w,h)=>{
    ctx.fillStyle='#34241b';ctx.fillRect(0,0,w,h);
    for(let i=0;i<1200;i++){const x=(i*71)%w,y=(i*139)%h;ctx.fillStyle=i%2?'rgba(12,7,4,.12)':'rgba(207,159,103,.075)';ctx.beginPath();ctx.arc(x,y,((i%4)+1)*.45,0,Math.PI*2);ctx.fill();}
    for(let i=0;i<34;i++){ctx.strokeStyle='rgba(8,5,3,.11)';ctx.lineWidth=1;ctx.beginPath();ctx.moveTo(0,i/34*h);ctx.lineTo(w,i/34*h+Math.sin(i)*2);ctx.stroke();}
  },512,512);
  const leather=new THREE.MeshStandardMaterial({color:0xffffff,map:leatherTexture,roughness:.83});
  const pageTexture=makeCanvasTexture((ctx,w,h)=>{
    ctx.fillStyle='#d7c9ad';ctx.fillRect(0,0,w,h);
    for(let i=0;i<380;i++){const x=(i*47)%w,y=(i*113)%h;ctx.fillStyle='rgba(109,83,54,.07)';ctx.fillRect(x,y,1+(i%2),1);}
    for(let col=0;col<2;col++)for(let row=0;row<28;row++){const x=34+col*250,y=32+row*15+(col?0:0);ctx.strokeStyle=`rgba(82,65,48,${.12+(row%4)*.015})`;ctx.lineWidth=row%7===0?2:1;ctx.beginPath();ctx.moveTo(x,y);ctx.lineTo(x+170+(row%5)*9,y);ctx.stroke();}
  },512,512);
  const pageMat=new THREE.MeshStandardMaterial({color:0xffffff,map:pageTexture,roughness:.94});
  const gold=new THREE.MeshStandardMaterial({color:0xb08a58,metalness:.72,roughness:.3});
  // Archive props use their own warm wood material; createShip()'s woodLight is function-scoped.
  const archiveWoodLight=new THREE.MeshStandardMaterial({color:0x98704c,roughness:.68});
  const book=new THREE.Group();book.position.set(.6,.02,0);book.rotation.y=-.14;g.add(book);
  const pageBlock=new THREE.Mesh(new THREE.BoxGeometry(2.0,.22,2.55),pageMat);pageBlock.position.y=.12;book.add(pageBlock);
  const cover=new THREE.Mesh(new THREE.BoxGeometry(2.12,.11,2.66),leather);cover.position.y=-.015;book.add(cover);
  const coverTop=new THREE.Mesh(new THREE.BoxGeometry(2.12,.035,2.66),leather);coverTop.position.y=.27;book.add(coverTop);
  const spine=new THREE.Mesh(new THREE.BoxGeometry(.18,.35,2.66),new THREE.MeshStandardMaterial({color:0x211812,roughness:.68}));spine.position.x=-1.04;spine.position.y=.12;book.add(spine);
  for(let i=0;i<3;i++){const line=new THREE.Mesh(new THREE.BoxGeometry(.03,.018,2.48),gold);line.position.set(-.82+i*.82,.295,0);book.add(line);}
  for(let i=0;i<4;i++){const rib=new THREE.Mesh(new THREE.BoxGeometry(.035,.035,.12),gold);rib.position.set(-1.04,.14,-.94+i*.62);book.add(rib);}
  const medallion=new THREE.Mesh(new THREE.TorusGeometry(.24,.012,7,48),gold);medallion.position.set(0,.296,-.38);book.add(medallion);
  const medallionInner=new THREE.Mesh(new THREE.TorusGeometry(.19,.004,5,48),gold);medallionInner.position.set(0,.299,-.38);book.add(medallionInner);
  const compassCross=new THREE.Group();
  for(let i=0;i<8;i++){const a=i*Math.PI/4;const needle=new THREE.Mesh(new THREE.ConeGeometry(.026,.22,4),gold);needle.position.set(Math.sin(a)*.095,.303,-.38+Math.cos(a)*.095);needle.rotation.y=a;needle.rotation.x=Math.PI/2;compassCross.add(needle);}
  book.add(compassCross);
  for(const sx of [-.94,.94])for(const sz of [-1.18,1.18]){const corner=new THREE.Mesh(new THREE.BoxGeometry(.16,.022,.16),gold);corner.position.set(sx,.298,sz);book.add(corner);const stud=new THREE.Mesh(new THREE.SphereGeometry(.018,8,8),new THREE.MeshStandardMaterial({color:0xead09c,metalness:.82,roughness:.24}));stud.position.set(sx,.316,sz);book.add(stud);}
  const bookTitleTexture=makeCanvasTexture((ctx,w,h)=>{
    ctx.clearRect(0,0,w,h);ctx.fillStyle='rgba(30,20,14,.88)';ctx.fillRect(18,18,w-36,h-36);
    ctx.strokeStyle='#c8a36f';ctx.lineWidth=5;ctx.strokeRect(28,28,w-56,h-56);ctx.strokeStyle='rgba(232,206,160,.55)';ctx.lineWidth=1.5;ctx.strokeRect(40,40,w-80,h-80);
    ctx.fillStyle='#e4c99a';ctx.textAlign='center';ctx.font='bold 38px Georgia';ctx.fillText('G. I. BRĂTIANU',w/2,h*.43);
    ctx.font='italic 30px Georgia';ctx.fillText('STUDII PONTICE',w/2,h*.68);
  },640,360);
  const bookTitle=new THREE.Mesh(new THREE.PlaneGeometry(1.10,.62),new THREE.MeshBasicMaterial({map:bookTitleTexture,transparent:true,side:THREE.DoubleSide,depthWrite:false}));
  bookTitle.rotation.x=-Math.PI/2;bookTitle.position.set(.42,.306,.72);book.add(bookTitle);
  // Fine exposed page layers and a stitched headband add believable book construction.
  const pageEdgeMat=new THREE.MeshStandardMaterial({color:0xe4d7bd,roughness:.96});
  for(let i=0;i<5;i++){const edge=new THREE.Mesh(new THREE.BoxGeometry(1.94,.006,2.48),pageEdgeMat);edge.position.set(0,.245+i*.004,-.01);book.add(edge);}
  const headbandMat=new THREE.MeshStandardMaterial({color:0x8b6040,roughness:.92});
  for(const z of [-1.24,1.24]){const headband=new THREE.Mesh(new THREE.BoxGeometry(.15,.035,.035),headbandMat);headband.position.set(-1.03,.12,z);book.add(headband);}
  const frame=new THREE.Group();frame.position.set(-1.65,1.35,-.05);frame.rotation.y=.2;g.add(frame);
  const frameMat=new THREE.MeshStandardMaterial({color:0x9f8055,metalness:.74,roughness:.28});
  const frameBacking=new THREE.Mesh(new THREE.BoxGeometry(1.75,2.38,.09),frameMat);frame.add(frameBacking);
  const frameRim=new THREE.Mesh(new THREE.BoxGeometry(1.64,2.27,.045),new THREE.MeshStandardMaterial({color:0x4b3727,roughness:.72}));frameRim.position.z=.065;frame.add(frameRim);
  const frameInner=new THREE.Mesh(new THREE.BoxGeometry(1.58,2.20,.028),new THREE.MeshStandardMaterial({color:0xc4a675,metalness:.58,roughness:.4}));frameInner.position.z=.09;frame.add(frameInner);
  for(const x of [-.80,.80])for(const y of [-1.08,1.08]){const stud=new THREE.Mesh(new THREE.SphereGeometry(.035,10,8),new THREE.MeshStandardMaterial({color:0xd5b37c,metalness:.8,roughness:.26}));stud.position.set(x,y,.12);frame.add(stud);}
  const portraitFallback=makeCanvasTexture((ctx,w,h)=>{
    const bg=ctx.createLinearGradient(0,0,w,h);bg.addColorStop(0,'#b8a27d');bg.addColorStop(.52,'#d3c2a0');bg.addColorStop(1,'#887356');ctx.fillStyle=bg;ctx.fillRect(0,0,w,h);
    const vignette=ctx.createRadialGradient(w*.5,h*.43,w*.08,w*.5,h*.5,w*.72);vignette.addColorStop(0,'rgba(244,230,199,.20)');vignette.addColorStop(1,'rgba(30,23,17,.55)');ctx.fillStyle=vignette;ctx.fillRect(0,0,w,h);
    ctx.fillStyle='rgba(49,38,29,.20)';ctx.fillRect(w*.08,h*.07,w*.84,h*.86);
    // A neutral archival silhouette guarantees a polished local frame even offline.
    ctx.fillStyle='#40352b';ctx.beginPath();ctx.moveTo(w*.16,h*.94);ctx.quadraticCurveTo(w*.19,h*.70,w*.38,h*.66);ctx.lineTo(w*.62,h*.66);ctx.quadraticCurveTo(w*.82,h*.72,w*.84,h*.94);ctx.closePath();ctx.fill();
    ctx.fillStyle='#6b5842';ctx.beginPath();ctx.ellipse(w*.5,h*.37,w*.19,h*.23,0,0,Math.PI*2);ctx.fill();
    ctx.fillStyle='#493b30';ctx.beginPath();ctx.moveTo(w*.30,h*.39);ctx.quadraticCurveTo(w*.28,h*.12,w*.5,h*.13);ctx.quadraticCurveTo(w*.73,h*.13,w*.70,h*.40);ctx.quadraticCurveTo(w*.65,h*.25,w*.5,h*.27);ctx.quadraticCurveTo(w*.36,h*.26,w*.30,h*.39);ctx.fill();
    ctx.strokeStyle='rgba(231,211,177,.42)';ctx.lineWidth=5;ctx.strokeRect(18,18,w-36,h-36);
    ctx.fillStyle='rgba(242,226,195,.84)';ctx.font='bold 28px Georgia';ctx.textAlign='center';ctx.fillText('GHEORGHE I. BRĂTIANU',w/2,h*.985-18);
  },600,840);
  const portraitMaterial=new THREE.MeshBasicMaterial({map:portraitFallback,color:0xffffff});
  const portrait=new THREE.Mesh(new THREE.PlaneGeometry(1.56,2.18),portraitMaterial);portrait.position.set(0,0,.111);frame.add(portrait);
  // The authentic Wikimedia portrait upgrades the local archival placeholder when available.
  // Failure is intentionally silent: the framed fallback is already rendered and remains visible offline.
  new THREE.TextureLoader().load('https://upload.wikimedia.org/wikipedia/commons/0/04/Gh._I._Bratianu.jpg',texture=>{
    texture.colorSpace=THREE.SRGBColorSpace;texture.anisotropy=Math.min(8,renderer?.capabilities?.getMaxAnisotropy?.()||1);
    const previous=portraitMaterial.map;portraitMaterial.map=texture;portraitMaterial.needsUpdate=true;
    if(previous&&previous!==portraitFallback)previous.dispose();
  },undefined,()=>{});
  // The photograph sits inside a tilted archival mount; the frame remains an actual 3D object.
  const labelTex=makeCanvasTexture((ctx,w,h)=>{ctx.fillStyle='#d8c9ad';ctx.fillRect(0,0,w,h);ctx.fillStyle='#40372e';ctx.font='bold 46px Georgia';ctx.fillText('GHEORGHE I. BRĂTIANU',44,88);ctx.font='28px monospace';ctx.fillStyle='#746552';ctx.fillText('1898 — 1953  /  ISTORIC',44,142);ctx.strokeStyle='#a8895f';ctx.lineWidth=3;ctx.strokeRect(20,20,w-40,h-40);});
  const label=new THREE.Mesh(new THREE.PlaneGeometry(1.65,.42),new THREE.MeshBasicMaterial({map:labelTex}));label.rotation.x=-Math.PI/2;label.position.set(.68,.012,1.55);g.add(label);
  // A quill and inkpot are period-appropriate archival props, kept secondary to the photograph/book.
  const inkMat=new THREE.MeshStandardMaterial({color:0x101719,metalness:.46,roughness:.22});
  const ink=new THREE.Mesh(new THREE.CylinderGeometry(.13,.16,.24,32),inkMat);ink.position.set(2.1,.10,.75);g.add(ink);
  const inkNeck=new THREE.Mesh(new THREE.CylinderGeometry(.061,.076,.075,24),inkMat);inkNeck.position.set(2.1,.25,.75);g.add(inkNeck);
  const inkLip=new THREE.Mesh(new THREE.TorusGeometry(.069,.009,6,24),gold);inkLip.rotation.x=Math.PI/2;inkLip.position.set(2.1,.29,.75);g.add(inkLip);
  const inkStopper=new THREE.Mesh(new THREE.CylinderGeometry(.043,.052,.065,16),new THREE.MeshStandardMaterial({color:0x47382b,roughness:.72}));inkStopper.position.set(2.1,.335,.75);g.add(inkStopper);
  const inkSeal=new THREE.Mesh(new THREE.SphereGeometry(.018,8,7),new THREE.MeshStandardMaterial({color:0x7b3329,roughness:.7}));inkSeal.position.set(2.1,.37,.75);g.add(inkSeal);
  const quill=new THREE.Group();const quillMat=new THREE.MeshStandardMaterial({color:0xd2b98c,roughness:.52});
  const shaft=new THREE.Mesh(new THREE.CylinderGeometry(.009,.018,1.42,10),quillMat);shaft.rotation.z=-.48;shaft.position.y=.75;quill.add(shaft);
  const featherMat=new THREE.MeshStandardMaterial({color:0xeee4d2,side:THREE.DoubleSide,roughness:.92});
  for(let i=0;i<22;i++){const v=i/21,side=i%2?1:-1;const barb=new THREE.Mesh(new THREE.ConeGeometry(.012,.13*(1-Math.abs(v-.48)*1.45),4),featherMat);barb.rotation.z=-.48+side*.30;barb.position.set(side*(.025+v*.03),.28+v*.95,.006);quill.add(barb);}
  const nib=new THREE.Mesh(new THREE.ConeGeometry(.018,.10,6),new THREE.MeshStandardMaterial({color:0x8f9b9b,metalness:.82,roughness:.28}));nib.rotation.z=Math.PI-.48;nib.position.set(-.36,.13,0);quill.add(nib);
  quill.position.set(2.15,.23,-.1);quill.rotation.z=.16;g.add(quill);
  // A compact brass astrolabe and a sealed chart roll make the desk read as a working navigational archive.
  const astrolabe=new THREE.Group();
  const astrolabeOuter=new THREE.Mesh(new THREE.TorusGeometry(.34,.018,8,56),gold);astrolabe.add(astrolabeOuter);
  const astrolabeInner=new THREE.Mesh(new THREE.TorusGeometry(.23,.009,6,48),gold);astrolabeInner.rotation.x=.62;astrolabe.add(astrolabeInner);
  const astrolabeCross=new THREE.Mesh(new THREE.CylinderGeometry(.012,.012,.62,8),gold);astrolabeCross.rotation.z=Math.PI/2;astrolabe.add(astrolabeCross);
  const astrolabePivot=new THREE.Mesh(new THREE.SphereGeometry(.045,12,10),new THREE.MeshStandardMaterial({color:0xd6b174,metalness:.82,roughness:.2}));astrolabe.add(astrolabePivot);
  const astrolabeTicks=new THREE.InstancedMesh(new THREE.BoxGeometry(.008,.045,.006),gold,48),tickObject=new THREE.Object3D();
  for(let i=0;i<48;i++){const a=i/48*Math.PI*2;tickObject.position.set(Math.cos(a)*.305,Math.sin(a)*.305,0);tickObject.rotation.z=a-Math.PI/2;tickObject.scale.y=i%4===0?1.7:1;tickObject.updateMatrix();astrolabeTicks.setMatrixAt(i,tickObject.matrix);}astrolabeTicks.instanceMatrix.needsUpdate=true;astrolabe.add(astrolabeTicks);
  const sightRule=new THREE.Mesh(new THREE.BoxGeometry(.018,.58,.008),gold);sightRule.rotation.z=.22;sightRule.position.z=.014;astrolabe.add(sightRule);
  const suspension=new THREE.Mesh(new THREE.TorusGeometry(.055,.008,6,20),gold);suspension.position.y=.385;astrolabe.add(suspension);
  astrolabe.position.set(2.35,.27,-1.48);astrolabe.rotation.set(.18,.25,.1);g.add(astrolabe);
  const scrollRoll=new THREE.Group();const rollMat=new THREE.MeshStandardMaterial({color:0xbba47f,roughness:.9});
  const roll=new THREE.Mesh(new THREE.CylinderGeometry(.055,.055,.82,18),rollMat);roll.rotation.z=Math.PI/2;scrollRoll.add(roll);
  for(const x of [-.39,.39]){const end=new THREE.Mesh(new THREE.CylinderGeometry(.061,.061,.025,16),gold);end.rotation.z=Math.PI/2;end.position.x=x;scrollRoll.add(end);}
  const vellumBand=new THREE.Mesh(new THREE.CylinderGeometry(.058,.058,.08,20),new THREE.MeshStandardMaterial({color:0x8f7859,roughness:.94}));
  vellumBand.rotation.z=Math.PI/2;vellumBand.position.x=-.17;scrollRoll.add(vellumBand);
  const cord=new THREE.Mesh(new THREE.TorusGeometry(.068,.006,5,24),new THREE.MeshStandardMaterial({color:0x7f5c36,roughness:1}));cord.position.set(.18,.065,.035);scrollRoll.add(cord);
  const wax=new THREE.Mesh(new THREE.CylinderGeometry(.07,.075,.028,20),new THREE.MeshStandardMaterial({color:0x762d25,roughness:.48}));wax.position.set(.18,.082,.02);scrollRoll.add(wax);
  const waxStamp=new THREE.Mesh(new THREE.TorusGeometry(.035,.006,5,16),gold);waxStamp.position.set(.18,.099,.02);scrollRoll.add(waxStamp);
  scrollRoll.position.set(-2.42,-.075,-1.52);scrollRoll.rotation.z=.035;g.add(scrollRoll);

  // A compact brass surveying telescope: a period-appropriate instrument for reading the coastline.
  const telescope=new THREE.Group();
  const telescopeTubeMat=new THREE.MeshStandardMaterial({color:0x715534,metalness:.78,roughness:.28});
  const telescopeDarkMat=new THREE.MeshStandardMaterial({color:0x18252a,metalness:.42,roughness:.22});
  const tube=new THREE.Mesh(new THREE.CylinderGeometry(.073,.105,1.18,28,1,true),telescopeTubeMat);tube.rotation.z=Math.PI/2;telescope.add(tube);
  const tubeInner=new THREE.Mesh(new THREE.CylinderGeometry(.057,.058,1.12,24,1,true),telescopeDarkMat);tubeInner.rotation.z=Math.PI/2;telescope.add(tubeInner);
  for(const x of [-.52,-.36,.38,.55]){const band=new THREE.Mesh(new THREE.CylinderGeometry(x<0?.112:.078,x<0?.112:.078,.055,28),gold);band.rotation.z=Math.PI/2;band.position.x=x;telescope.add(band);}
  const objective=new THREE.Mesh(new THREE.CircleGeometry(.074,32),new THREE.MeshPhysicalMaterial({color:0x6f9ba0,metalness:.35,roughness:.12,transmission:.18,transparent:true,opacity:.78,clearcoat:1}));objective.rotation.y=Math.PI/2;objective.position.x=.595;telescope.add(objective);
  const eyepiece=new THREE.Mesh(new THREE.CylinderGeometry(.055,.065,.12,24),telescopeDarkMat);eyepiece.rotation.z=Math.PI/2;eyepiece.position.x=-.64;telescope.add(eyepiece);
  const focusRing=new THREE.Mesh(new THREE.TorusGeometry(.083,.009,6,32),gold);focusRing.rotation.y=Math.PI/2;focusRing.position.x=-.24;telescope.add(focusRing);
  for(let i=0;i<18;i++){const a=i/18*Math.PI*2;const screw=new THREE.Mesh(new THREE.SphereGeometry(.009,6,5),gold);screw.position.set(.53,Math.sin(a)*.08,Math.cos(a)*.08);telescope.add(screw);}
  const telescopeStand=new THREE.Group();
  const standFoot=new THREE.Mesh(new THREE.BoxGeometry(.54,.035,.18),telescopeTubeMat);telescopeStand.add(standFoot);
  const standPost=new THREE.Mesh(new THREE.CylinderGeometry(.025,.035,.22,10),gold);standPost.position.y=.12;telescopeStand.add(standPost);
  const saddle=new THREE.Mesh(new THREE.TorusGeometry(.115,.012,6,24,Math.PI),gold);saddle.rotation.x=Math.PI/2;saddle.position.y=.235;telescopeStand.add(saddle);
  telescope.add(telescopeStand);telescope.position.set(-2.18,.17,.55);telescope.rotation.set(.12,.08,-.08);g.add(telescope);

  // A small brass magnifier rests beside the notes; its lens remains subtle to avoid visual clutter.
  const magnifier=new THREE.Group();
  const lensRim=new THREE.Mesh(new THREE.TorusGeometry(.17,.018,8,40),gold);magnifier.add(lensRim);
  const lens=new THREE.Mesh(new THREE.CircleGeometry(.153,40),new THREE.MeshPhysicalMaterial({color:0x9bbdc0,transparent:true,opacity:.18,roughness:.08,metalness:.12,clearcoat:1,side:THREE.DoubleSide}));lens.position.z=-.004;magnifier.add(lens);
  const handle=new THREE.Mesh(new THREE.CylinderGeometry(.027,.033,.42,12),archiveWoodLight);handle.rotation.z=-.58;handle.position.set(.21,-.22,0);magnifier.add(handle);
  const handleCap=new THREE.Mesh(new THREE.SphereGeometry(.035,10,8),gold);handleCap.position.set(.32,-.41,0);magnifier.add(handleCap);
  magnifier.position.set(2.48,.085,1.28);magnifier.rotation.x=-.05;magnifier.rotation.z=-.22;g.add(magnifier);

  // A fine brass-and-walnut scale ruler anchors the chart-reading tools to the desk.
  const ruler=new THREE.Group();
  const rulerWood=new THREE.MeshStandardMaterial({color:0x58402a,roughness:.8});
  const rulerBase=new THREE.Mesh(new THREE.BoxGeometry(1.58,.036,.16),rulerWood);ruler.add(rulerBase);
  for(const z of [-.074,.074]){const edge=new THREE.Mesh(new THREE.BoxGeometry(1.58,.009,.008),gold);edge.position.z=z;ruler.add(edge);}
  const rulerTicks=new THREE.InstancedMesh(new THREE.BoxGeometry(.009,.008,.05),gold,31),rulerDummy=new THREE.Object3D();
  for(let i=0;i<31;i++){rulerDummy.position.set(-.75+i*.05,.022,-.018);rulerDummy.scale.y=i%5===0?2:1;rulerDummy.updateMatrix();rulerTicks.setMatrixAt(i,rulerDummy.matrix);}rulerTicks.instanceMatrix.needsUpdate=true;ruler.add(rulerTicks);
  const rulerEndCaps=new THREE.InstancedMesh(new THREE.BoxGeometry(.025,.012,.17),gold,2);
  for(let i=0;i<2;i++){rulerDummy.position.set(i?-.79:.79,.022,0);rulerDummy.updateMatrix();rulerEndCaps.setMatrixAt(i,rulerDummy.matrix);}rulerEndCaps.instanceMatrix.needsUpdate=true;ruler.add(rulerEndCaps);
  ruler.position.set(.15,-.075,1.83);ruler.rotation.y=-.08;ruler.rotation.z=-.012;g.add(ruler);

  // A compact glass ink well with a brass collar and dark enamel inset.
  const inkWell=new THREE.Group();
  const inkGlass=new THREE.MeshPhysicalMaterial({color:0x183b3c,roughness:.16,metalness:.14,transparent:true,opacity:.86,clearcoat:1,clearcoatRoughness:.08});
  const inkBody=new THREE.Mesh(new THREE.CylinderGeometry(.12,.15,.21,24,1,true),inkGlass);inkBody.position.y=.12;inkWell.add(inkBody);
  const inkBase=new THREE.Mesh(new THREE.CylinderGeometry(.15,.15,.035,24),new THREE.MeshStandardMaterial({color:0x263535,roughness:.25,metalness:.35}));inkBase.position.y=.025;inkWell.add(inkBase);
  const inkWellNeck=new THREE.Mesh(new THREE.CylinderGeometry(.064,.085,.075,20),inkGlass);inkWellNeck.position.y=.255;inkWell.add(inkWellNeck);
  const inkCollar=new THREE.Mesh(new THREE.CylinderGeometry(.09,.09,.025,24),gold);inkCollar.position.y=.292;inkWell.add(inkCollar);
  const inkWellStopper=new THREE.Mesh(new THREE.CylinderGeometry(.052,.058,.085,16),new THREE.MeshStandardMaterial({color:0x30251c,roughness:.78}));inkWellStopper.position.y=.345;inkWell.add(inkWellStopper);
  const inkTop=new THREE.Mesh(new THREE.SphereGeometry(.036,12,8),gold);inkTop.position.y=.393;inkWell.add(inkTop);
  const inkWellBand=new THREE.Mesh(new THREE.TorusGeometry(.145,.008,5,24),gold);inkWellBand.rotation.x=Math.PI/2;inkWellBand.position.y=.045;inkWell.add(inkWellBand);
  inkWell.position.set(-2.72,-.075,-.48);inkWell.rotation.x=.035;g.add(inkWell);

  // Brass plotting dividers: two articulated legs, a hinge pin and fine metal points.
  const dividers=new THREE.Group();
  const dividerGold=new THREE.MeshStandardMaterial({color:0xb99260,metalness:.82,roughness:.24});
  const dividerDark=new THREE.MeshStandardMaterial({color:0x293337,metalness:.68,roughness:.3});
  const hinge=new THREE.Mesh(new THREE.SphereGeometry(.055,16,12),dividerGold);hinge.position.set(0,.16,0);dividers.add(hinge);
  const hingeCap=new THREE.Mesh(new THREE.CylinderGeometry(.033,.033,.022,20),dividerDark);hingeCap.position.set(0,.205,0);dividers.add(hingeCap);
  for(const side of [-1,1]){
    const leg=new THREE.Mesh(new THREE.CylinderGeometry(.018,.009,.58,10),dividerGold);leg.position.set(side*.12,-.11,0);leg.rotation.z=side*.19;dividers.add(leg);
    const sleeve=new THREE.Mesh(new THREE.CylinderGeometry(.026,.026,.09,12),dividerDark);sleeve.position.set(side*.12,-.24,0);sleeve.rotation.z=side*.19;dividers.add(sleeve);
    const point=new THREE.Mesh(new THREE.ConeGeometry(.012,.11,8),dividerGold);point.position.set(side*.17,-.44,0);point.rotation.z=Math.PI;dividers.add(point);
  }
  dividers.position.set(2.43,.45,1.86);dividers.rotation.set(.06,.18,-.10);g.add(dividers);

  // A compact surveyor's compass adds a second, functional navigation instrument.
  // Its rose, graduated bezel, screws and floating needle are all separate meshes.
  const compass=new THREE.Group();
  const compassCaseMat=new THREE.MeshStandardMaterial({color:0x493a2a,metalness:.78,roughness:.27});
  const compassEnamelMat=new THREE.MeshStandardMaterial({color:0x14272a,metalness:.34,roughness:.24});
  const compassGlassMat=new THREE.MeshPhysicalMaterial({color:0xaac8c5,metalness:.12,roughness:.08,transparent:true,opacity:.22,clearcoat:1,clearcoatRoughness:.045,side:THREE.DoubleSide});
  const compassCase=new THREE.Mesh(new THREE.CylinderGeometry(.292,.315,.092,64),compassCaseMat);compassCase.position.y=.045;compass.add(compassCase);
  const compassInset=new THREE.Mesh(new THREE.CylinderGeometry(.253,.253,.014,64),compassEnamelMat);compassInset.position.y=.098;compass.add(compassInset);
  const compassBezel=new THREE.Mesh(new THREE.TorusGeometry(.258,.018,10,72),gold);compassBezel.rotation.x=Math.PI/2;compassBezel.position.y=.108;compass.add(compassBezel);
  const compassDialTexture=makeCanvasTexture((ctx,w,h)=>{
    const cx=w/2,cy=h/2,r=w*.465;
    ctx.clearRect(0,0,w,h);
    ctx.strokeStyle='rgba(212,183,135,.84)';ctx.lineWidth=3;ctx.beginPath();ctx.arc(cx,cy,r,0,Math.PI*2);ctx.stroke();
    ctx.strokeStyle='rgba(212,183,135,.60)';ctx.lineWidth=2;
    for(let i=0;i<72;i++){const a=i/72*Math.PI*2,outer=r-7,inner=r-(i%6===0?27:14);ctx.beginPath();ctx.moveTo(cx+Math.sin(a)*inner,cy-Math.cos(a)*inner);ctx.lineTo(cx+Math.sin(a)*outer,cy-Math.cos(a)*outer);ctx.stroke();}
    ctx.fillStyle='#e2cfaa';ctx.textAlign='center';ctx.textBaseline='middle';ctx.font='bold 35px Georgia';
    [['N',0,-r*.69],['E',r*.69,0],['S',0,r*.69],['W',-r*.69,0]].forEach(([t,x,y])=>ctx.fillText(t,cx+x,cy+y));
    ctx.strokeStyle='rgba(211,173,111,.55)';ctx.lineWidth=1.5;ctx.beginPath();ctx.arc(cx,cy,r*.43,0,Math.PI*2);ctx.stroke();
  },512,512);
  const compassDial=new THREE.Mesh(new THREE.PlaneGeometry(.49,.49),new THREE.MeshBasicMaterial({map:compassDialTexture,transparent:true,side:THREE.DoubleSide,depthWrite:false}));compassDial.rotation.x=-Math.PI/2;compassDial.position.y=.108;compass.add(compassDial);
  const compassNeedle=new THREE.Group();
  const makeNeedleFace=(points,material)=>{
    const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute(points,3));
    geometry.setIndex([0,1,2]);geometry.computeVertexNormals();
    const mesh=new THREE.Mesh(geometry,material);mesh.frustumCulled=false;compassNeedle.add(mesh);
  };
  makeNeedleFace([0,.116,.168,-.045,.116,-.012,.045,.116,-.012],new THREE.MeshStandardMaterial({color:0xb64d39,metalness:.48,roughness:.28,side:THREE.DoubleSide}));
  makeNeedleFace([0,.116,-.168,.045,.116,.012,-.045,.116,.012],new THREE.MeshStandardMaterial({color:0xe2d0ad,metalness:.58,roughness:.3,side:THREE.DoubleSide}));
  const needlePivot=new THREE.Mesh(new THREE.SphereGeometry(.027,16,12),new THREE.MeshStandardMaterial({color:0xe0bd81,metalness:.84,roughness:.2}));needlePivot.position.y=.121;compassNeedle.add(needlePivot);
  const needleCap=new THREE.Mesh(new THREE.CylinderGeometry(.013,.013,.012,20),compassCaseMat);needleCap.position.y=.151;compassNeedle.add(needleCap);
  compass.add(compassNeedle);
  const compassGlass=new THREE.Mesh(new THREE.CircleGeometry(.238,64),compassGlassMat);compassGlass.rotation.x=-Math.PI/2;compassGlass.position.y=.158;compass.add(compassGlass);
  const compassScrews=new THREE.InstancedMesh(new THREE.SphereGeometry(.012,8,6),gold,8),compassDummy=new THREE.Object3D();
  for(let i=0;i<8;i++){const a=i/8*Math.PI*2;compassDummy.position.set(Math.cos(a)*.278,.104,Math.sin(a)*.278);compassDummy.scale.set(1,.55,1);compassDummy.updateMatrix();compassScrews.setMatrixAt(i,compassDummy.matrix);}compassScrews.instanceMatrix.needsUpdate=true;compass.add(compassScrews);
  compass.position.set(-1.18,-.09,-1.38);compass.rotation.set(.015,.08,-.015);g.add(compass);

  // The archive contains a physical chart of the Black Sea. Its miniature vessel
  // continues the same journey while the full-size map scene is replaced by the desk.
  const chart = new THREE.Group();
  chart.position.set(-2.08,-.16,.72);
  const chartWidth=1.58, chartDepth=chartWidth*MAP_DEPTH/MAP_WIDTH;
  const chartFrame=new THREE.Mesh(new THREE.BoxGeometry(chartWidth+.13,.09,chartDepth+.13),new THREE.MeshStandardMaterial({color:0x9c7951,metalness:.78,roughness:.27}));
  chart.add(chartFrame);
  const chartBacking=new THREE.Mesh(new THREE.BoxGeometry(chartWidth+.075,.035,chartDepth+.075),new THREE.MeshStandardMaterial({color:0x17252a,roughness:.55,metalness:.25}));
  chartBacking.position.y=.052;chart.add(chartBacking);
  const chartGeometry=buildGeographicSurfaceGeometry(260,Math.round(260*MAP_DEPTH/MAP_WIDTH));
  const chartSurface=new THREE.Mesh(chartGeometry,new THREE.MeshStandardMaterial({map:assets.albedo,roughness:.92,metalness:.025,side:THREE.DoubleSide}));
  chartSurface.scale.set(chartWidth/MAP_WIDTH,1,chartDepth/MAP_DEPTH);chartSurface.position.y=.074;chart.add(chartSurface);g.userData.chartSurface=chartSurface;
  const chartRoutePts=VOYAGE_COORDS.map(([lon,lat])=>{
    const [mapX,mapZ]=geoToMap(lon,lat);return new THREE.Vector3(mapX/MAP_WIDTH*chartWidth,.091,mapZ/MAP_DEPTH*chartDepth);
  });
  archiveRouteCurve=new THREE.CatmullRomCurve3(chartRoutePts,false,'centripetal',.35);
  const chartRoute=new THREE.Mesh(new THREE.TubeGeometry(archiveRouteCurve,180,.008,6,false),new THREE.MeshBasicMaterial({color:0xd0a46d,transparent:true,opacity:.48,depthWrite:false}));chartRoute.renderOrder=4;chart.add(chartRoute);
  const chartSamples=archiveRouteCurve.getPoints(240);
  const chartProgressGeometry=new THREE.BufferGeometry().setFromPoints(chartSamples);
  archiveRouteProgressLine=new THREE.Line(chartProgressGeometry,new THREE.LineBasicMaterial({color:0xffd49a,transparent:true,opacity:1,depthWrite:false}));
  archiveRouteProgressLine.frustumCulled=false;archiveRouteProgressLine.renderOrder=5;chartProgressGeometry.setDrawRange(0,0);chart.add(archiveRouteProgressLine);
  archiveRoutePulse=new THREE.Mesh(new THREE.SphereGeometry(.022,14,10),new THREE.MeshBasicMaterial({color:0xffe0ad}));chart.add(archiveRoutePulse);
  archiveShip=createShip({animateSails:false});archiveShip.scale.setScalar(.105);
  archiveShip.userData.bowOffset=1.63*.105;archiveShip.userData.bowHeight=.30*.105;archiveShip.userData.forwardAxis=SHIP_BOW_LOCAL.clone();
  const archiveStart=archiveRouteCurve.getPointAt(0),archiveStartTangent=archiveRouteCurve.getTangentAt(0);
  archiveShip.quaternion.setFromUnitVectors(SHIP_BOW_LOCAL,archiveStartTangent);
  archiveShip.position.set(archiveStart.x-archiveStartTangent.x*archiveShip.userData.bowOffset,.125-archiveShip.userData.bowHeight,archiveStart.z-archiveStartTangent.z*archiveShip.userData.bowOffset);chart.add(archiveShip);
  // Engraved caption identifies the inset as a working route chart, not decoration.
  const chartCaptionTex=makeCanvasTexture((ctx,w,h)=>{ctx.fillStyle='#17252a';ctx.fillRect(0,0,w,h);ctx.fillStyle='#d8c5a4';ctx.font='bold 30px Georgia';ctx.fillText('ITINERARIU PONTIC',20,43);ctx.font='18px monospace';ctx.fillStyle='#b99565';ctx.fillText('BOSFOR  →  CAFFA',20,76);},360,100);
  const chartCaption=new THREE.Mesh(new THREE.PlaneGeometry(.90,.25),new THREE.MeshBasicMaterial({map:chartCaptionTex,transparent:false}));chartCaption.rotation.x=-Math.PI/2;chartCaption.position.set(-.28,.078,chartDepth/2+.17);chart.add(chartCaption);
  g.add(chart);g.userData.voyageChart=chart;g.userData.idleProps={quill,astrolabe,scrollRoll,telescope,magnifier,book,inkWell,dividers,compass,compassNeedle};
  g.userData.idleBase={quillZ:quill.rotation.z,astrolabeY:astrolabe.rotation.y,scrollZ:scrollRoll.rotation.z,telescopeZ:telescope.rotation.z,magnifierZ:magnifier.rotation.z,bookY:book.position.y,inkWellY:inkWell.position.y,dividersZ:dividers.rotation.z,compassY:compass.position.y,compassNeedleY:compassNeedle.rotation.y};

  // Period props share the same physically lit materials and soft shadow setup as the relief scene.
  g.traverse(node=>{if(node.isMesh){node.castShadow=true;node.receiveShadow=true;}});
  // Floating archive dust.
  return g;
}

async function loadLocalTexture(path,{color=false,repeat=1,anisotropy=8}={}){
  const texture=await new Promise((resolve,reject)=>new THREE.TextureLoader().load(path,resolve,undefined,reject));
  if(color)texture.colorSpace=THREE.SRGBColorSpace;texture.anisotropy=Math.min(anisotropy,renderer.capabilities.getMaxAnisotropy());
  if(repeat!==1){texture.wrapS=texture.wrapT=THREE.RepeatWrapping;texture.repeat.set(repeat,repeat);}
  return texture;
}
// Optional high-detail land hillshade. The request is cropped in WGS84 geographic
// coordinates to the exact same UV extent as the map. Local ETOPO1 textures remain
// the immediate fallback, so offline or blocked requests never leave an empty model.
async function loadRegionalHillshade(baseTexture,waterMaskPixels,maskWidth,maskHeight){
  const width=coarsePointer?2048:3072,height=Math.round(width*9/17);
  const endpoint='https://services.arcgisonline.com/ArcGIS/rest/services/Elevation/World_Hillshade/MapServer/export';
  const params=new URLSearchParams({bbox:'26,39,43,48',bboxSR:'4326',imageSR:'4326',size:`${width},${height}`,format:'jpg',transparent:'false',adjustAspectRatio:'false',f:'image'});
  const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),11000);
  try{
    const response=await fetch(`${endpoint}?${params.toString()}`,{mode:'cors',credentials:'omit',signal:controller.signal,cache:'force-cache'});
    if(!response.ok)throw new Error(`World Hillshade HTTP ${response.status}`);
    const type=response.headers.get('content-type')||'';if(!type.includes('image/'))throw new Error('World Hillshade nu a returnat o imagine raster.');
    const declared=Number(response.headers.get('content-length')||0);
    if(declared>48*1024*1024)throw new Error('Hillshade-ul depășește limita de transfer sigură.');
    const blob=await response.blob();if(blob.size<1024||blob.size>48*1024*1024)throw new Error('Hillshade-ul are o dimensiune neașteptată.');
    const bitmap=await createImageBitmap(blob);
    const shadeCanvas=document.createElement('canvas');shadeCanvas.width=width;shadeCanvas.height=height;
    const shadeCtx=shadeCanvas.getContext('2d',{willReadFrequently:true});shadeCtx.drawImage(bitmap,0,0,width,height);bitmap.close?.();
    // Build a mask in the same normalized WGS84 extent (26–43 E, 39–48 N).
    const maskCanvas=document.createElement('canvas');maskCanvas.width=maskWidth;maskCanvas.height=maskHeight;
    const maskCtx=maskCanvas.getContext('2d',{willReadFrequently:true}),maskImage=maskCtx.createImageData(maskWidth,maskHeight);
    for(let y=0,p=0;y<maskHeight;y++)for(let x=0;x<maskWidth;x++,p+=4){
      const land=waterMaskPixels[p]<128?255:0;maskImage.data[p]=255;maskImage.data[p+1]=255;maskImage.data[p+2]=255;maskImage.data[p+3]=land;
    }
    maskCtx.putImageData(maskImage,0,0);
    const landCanvas=document.createElement('canvas');landCanvas.width=width;landCanvas.height=height;
    const landCtx=landCanvas.getContext('2d');
    landCtx.fillStyle='#9a8968';landCtx.fillRect(0,0,width,height);
    landCtx.globalCompositeOperation='multiply';landCtx.globalAlpha=.57;landCtx.drawImage(shadeCanvas,0,0);landCtx.globalAlpha=1;landCtx.globalCompositeOperation='source-over';
    landCtx.globalCompositeOperation='soft-light';landCtx.globalAlpha=.20;landCtx.fillStyle='#d6b987';landCtx.fillRect(0,0,width,height);landCtx.globalAlpha=1;landCtx.globalCompositeOperation='source-over';
    landCtx.globalCompositeOperation='destination-in';landCtx.drawImage(maskCanvas,0,0,width,height);landCtx.globalCompositeOperation='source-over';
    const canvas=document.createElement('canvas');canvas.width=width;canvas.height=height;
    const ctx=canvas.getContext('2d',{alpha:false});
    const sea=ctx.createLinearGradient(0,0,0,height);sea.addColorStop(0,'#123d4a');sea.addColorStop(.5,'#092f3e');sea.addColorStop(1,'#123847');
    ctx.fillStyle=sea;ctx.fillRect(0,0,width,height);ctx.drawImage(landCanvas,0,0);
    // Very restrained bathymetric grain on sea only; measured WMS/DTM overlays sit above it.
    ctx.globalAlpha=.10;ctx.globalCompositeOperation='soft-light';ctx.drawImage(shadeCanvas,0,0);ctx.globalAlpha=1;ctx.globalCompositeOperation='source-over';
    const texture=new THREE.CanvasTexture(canvas);texture.colorSpace=THREE.SRGBColorSpace;
    texture.anisotropy=Math.min(16,renderer.capabilities.getMaxAnisotropy());texture.generateMipmaps=true;
    texture.minFilter=THREE.LinearMipmapLinearFilter;texture.magFilter=THREE.LinearFilter;texture.needsUpdate=true;
    return texture;
  }finally{clearTimeout(timeout);}
}
async function initWorld(){
  if(!THREE){
    document.documentElement.classList.add('no-webgl','world-fallback-active');
    document.documentElement.classList.remove('world-loading');
    const fallbackStatus=$('#world-fallback-status');if(fallbackStatus)fallbackStatus.textContent='SE PORNEȘTE MODELUL 3D LOCAL…';
    await window.PONTUS_LOCAL_3D_FALLBACK?.start?.();
    return;
  }
  try{
    canvas?.addEventListener('webglcontextlost',event=>{
      event.preventDefault();pauseWorld();document.documentElement.classList.remove('world-ready');document.documentElement.classList.add('webgl-context-lost','world-fallback-active');
      window.PONTUS_LOCAL_3D_FALLBACK?.start?.();
      const status=$('#world-fallback-status');if(status)status.textContent='RECONFIGURARE GRAFICĂ · MODELUL 3D LOCAL ESTE ACTIV';
      const topo=$('#topography-status');if(topo){topo.textContent='RECONFIGURARE GRAFICĂ · SE RESTABILEȘTE';topo.dataset.state='loading';}
    },{passive:false});
    canvas?.addEventListener('webglcontextrestored',()=>{
      document.documentElement.classList.remove('webgl-context-lost','world-fallback-active');
      window.PONTUS_LOCAL_3D_FALLBACK?.stop?.(true);
      resizeWorld();
      if(renderer&&scene){renderer.render(scene,camera);document.documentElement.classList.add('world-ready');}
      resumeWorld();
    },{passive:true});
    renderer=new THREE.WebGLRenderer({canvas,alpha:true,antialias:true,powerPreference:'high-performance',stencil:false,depth:true,preserveDrawingBuffer:false});
    renderer.setPixelRatio(Math.min(devicePixelRatio||1,qualityScale));renderer.setSize(innerWidth,innerHeight,false);renderer.setClearColor(0x000000,0);
    renderer.outputColorSpace=THREE.SRGBColorSpace;renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=1.10;renderer.shadowMap.enabled=!coarsePointer&&(navigator.hardwareConcurrency||4)>=8&&(navigator.deviceMemory||8)>=8;renderer.shadowMap.type=THREE.PCFSoftShadowMap;renderer.info.autoReset=true;
    const loadPreferredTexture=async(preferred,fallback,options={})=>{
      try{return await loadLocalTexture(preferred,options);}
      catch(error){console.warn(`Assetul detaliat ${preferred} nu s-a încărcat; folosesc fallback-ul local.`,error);return loadLocalTexture(fallback,options);}
    };
    const [albedo,height,waterMask,waterNormal,reliefNormal]=await Promise.all([
      loadPreferredTexture('./assets/black-sea-relief-albedo-detail.webp','./assets/black-sea-relief-albedo.webp',{color:true,anisotropy:16}),
      loadLocalTexture('./assets/black-sea-height.webp',{anisotropy:8}),
      loadLocalTexture('./assets/black-sea-water-mask.webp',{anisotropy:8}),
      loadLocalTexture('./assets/black-sea-water-normal.webp',{repeat:6,anisotropy:12}),
      loadPreferredTexture('./assets/black-sea-terrain-detail-normal.webp','./assets/black-sea-relief-normal.webp',{anisotropy:16})
    ]);
    waterNormalTexture=waterNormal;
    const hc=document.createElement('canvas');hc.width=height.image.naturalWidth||height.image.width;hc.height=height.image.naturalHeight||height.image.height;
    const hctx=hc.getContext('2d',{willReadFrequently:true});hctx.drawImage(height.image,0,0);const heightPixels=hctx.getImageData(0,0,hc.width,hc.height).data;
    // Upsample the local mask before live vector replacement; high-resolution shoreline vectors
    // are rasterized directly at this working size, keeping the shoreline crisp on the 3D surface.
    const sourceMaskWidth=waterMask.image.naturalWidth||waterMask.image.width;
    const sourceMaskHeight=waterMask.image.naturalHeight||waterMask.image.height;
    const maskWorkingWidth=coarsePointer?1536:2560;
    const mc=document.createElement('canvas');mc.width=maskWorkingWidth;mc.height=Math.round(maskWorkingWidth*sourceMaskHeight/sourceMaskWidth);
    const mctx=mc.getContext('2d',{willReadFrequently:true});mctx.imageSmoothingEnabled=true;mctx.imageSmoothingQuality='high';mctx.drawImage(waterMask.image,0,0,mc.width,mc.height);
    waterMask.image=mc;waterMask.generateMipmaps=true;waterMask.minFilter=THREE.LinearMipmapLinearFilter;waterMask.magFilter=THREE.LinearFilter;waterMask.needsUpdate=true;
    const waterMaskPixels=mctx.getImageData(0,0,mc.width,mc.height).data;
    scene=new THREE.Scene();scene.fog=new THREE.FogExp2(0x081116,.021);
    camera=new THREE.PerspectiveCamera(39,innerWidth/innerHeight,.1,120);camera.position.set(.1,8.5,10.5);camera.lookAt(0,.10,0);
    scene.add(new THREE.HemisphereLight(0x9ab9c4,0x17100a,1.18));
    const key=new THREE.DirectionalLight(0xffdfb4,2.75);key.position.set(-5,9,6);
    if(renderer.shadowMap.enabled){key.castShadow=true;key.shadow.mapSize.set(2048,2048);key.shadow.camera.near=.1;key.shadow.camera.far=28;key.shadow.camera.left=-7;key.shadow.camera.right=7;key.shadow.camera.top=6;key.shadow.camera.bottom=-6;key.shadow.camera.updateProjectionMatrix();key.shadow.bias=-.00016;key.shadow.normalBias=.022;key.shadow.radius=3;}
    scene.add(key);
    const rim=new THREE.DirectionalLight(0x3d9eb0,1.75);rim.position.set(5,6,-6);scene.add(rim);
    const fill=new THREE.DirectionalLight(0xd29a5b,.62);fill.position.set(1,4,4);scene.add(fill);
    mapGroup=await createMapScene({albedo,heightMap:height,reliefNormal,heightPixels,heightWidth:hc.width,heightHeight:hc.height,waterMask,waterMaskPixels,maskWidth:mc.width,maskHeight:mc.height,waterNormal});mapGroup.position.set(.52,-.03,0);
    mapGroup.userData.waterMaskTexture=waterMask;mapGroup.userData.waterMaskPixels=waterMaskPixels;mapGroup.userData.maskWidth=mc.width;mapGroup.userData.maskHeight=mc.height;scene.add(mapGroup);
    archiveGroup=createArchiveScene({albedo});archiveGroup.visible=false;archiveGroup.scale.setScalar(.98);archiveGroup.position.set(.05,-.16,0);scene.add(archiveGroup);
    if(queuedWorldMode&&queuedWorldMode!==worldMode)runWorldTransition();
    // First upgrade the generalized local coastline to the GSHHG high-resolution
    // polygons. All later land-shading and numerical terrain layers reuse this same mask.
    const coastPromise=loadHighResolutionCoastline(mapGroup,waterMask,waterMaskPixels,mc.width,mc.height).catch(err=>{
      const coastStatus=$('#coast-status');if(coastStatus){coastStatus.textContent='GSHHS INTERMEDIAR · FALLBACK LOCAL';coastStatus.dataset.state='fallback';}
      console.info('GSHHG high-resolution coastline unavailable; local intermediate shoreline remains active.',err);
    });
    // Heavy raster requests run in a deliberate sequence. This keeps the browser from
    // holding two large GeoTIFFs plus several full-size canvases at the same time.
    // Each enhancement is optional: a failed request leaves the already-rendered local
    // or previous live layer in place and does not prevent the next stage from running.
    const runOptionalEnhancements=async()=>{
      await coastPromise;
      try{await loadWorldElevationModel(mapGroup);}
      catch(error){const status=$('#topography-status');if(status){status.textContent='TOPOGRAFIE LOCALĂ · FALLBACK ACTIV';status.dataset.state='fallback';}console.info('ArcGIS terrain elevation unavailable; local ETOPO1 relief remains active.',error);}
      try{await loadEMODnetDepthModel(mapGroup,waterMaskPixels,mc.width,mc.height);}
      catch(error){bathymetryState='fallback';const status=$('#dem-status');if(status){status.textContent='BATIMETRIE EMODNET INDISPONIBILĂ · FALLBACK LOCAL';status.dataset.state='fallback';}console.info('EMODnet numeric DTM unavailable; local visual relief remains active.',error);}
      try{
        const texture=await loadRegionalHillshade(albedo,waterMaskPixels,mc.width,mc.height);
        if(mapGroup?.userData.terrainMaterial){const previous=mapGroup.userData.terrainMaterial.map;mapGroup.userData.terrainMaterial.map=texture;mapGroup.userData.terrainMaterial.needsUpdate=true;mapGroup.userData.landHillshade='ArcGIS World Hillshade · WGS84 26–43E / 39–48N';if(previous&&previous!==albedo)previous.dispose();}
        const chartSurface=archiveGroup?.userData.chartSurface;if(chartSurface){chartSurface.material.map=texture;chartSurface.material.needsUpdate=true;}
        const status=$('#hillshade-status');if(status){status.textContent='HILLSHADE REGIONAL · WGS84';status.dataset.state='live';}
      }catch(error){const status=$('#hillshade-status');if(status){status.textContent='HILLSHADE LOCAL · FALLBACK ACTIV';status.dataset.state='fallback';}console.info('Regional hillshade unavailable; bundled relief texture remains active.',error);}
      try{await loadEMODnetBathymetry(mapGroup,waterMask);}
      catch(error){console.info('EMODnet WMS overlay unavailable; local relief remains active.',error);}
    };
    runOptionalEnhancements().catch(error=>console.warn('Unele straturi geografice opționale au rămas pe fallback-ul local.',error));
    const dustCount=145,positions=new Float32Array(dustCount*3);
    for(let i=0;i<dustCount;i++){positions[i*3]=(Math.random()-.5)*16;positions[i*3+1]=Math.random()*7-1.5;positions[i*3+2]=(Math.random()-.5)*13;}
    const dustGeo=new THREE.BufferGeometry();dustGeo.setAttribute('position',new THREE.BufferAttribute(positions,3));
    const dust=new THREE.Points(dustGeo,new THREE.PointsMaterial({color:0xc7b18e,size:.014,transparent:true,opacity:.20,depthWrite:false,sizeAttenuation:true}));scene.add(dust);scene.userData.dust=dust;
    const handleWorldVisibility=()=>{
      if(document.hidden){
        settlePendingWorldTransition();
        pauseWorld();
      }else if(!document.body.classList.contains('locked')&&!$('#photo-lightbox')?.open){
        resizeWorld();
        if(reducedMotion){if(renderer&&scene)renderer.render(scene,camera);}
        else resumeWorld();
      }
    };
    document.addEventListener('visibilitychange',handleWorldVisibility,{passive:true});
    // A page can enter/leave the back-forward cache without a normal visibility
    // transition. Finish any half-crossfade before suspension, then restore the
    // renderer and its viewport deterministically when the page returns.
    addEventListener('pagehide',()=>{settlePendingWorldTransition();pauseWorld();},{passive:true});
    addEventListener('pageshow',event=>{
      if(!event.persisted)return;
      settlePendingWorldTransition();
      resizeWorld();
      if(document.body.classList.contains('locked')||$('#photo-lightbox')?.open)return;
      if(reducedMotion){if(renderer&&scene)renderer.render(scene,camera);}
      else resumeWorld();
    },{passive:true});
    addEventListener('resize',resizeWorld,{passive:true});
    if(reducedMotion){lessonRouteProgress=lessonRouteTarget;updateVoyageVisuals(lessonRouteProgress,0,worldElapsed);renderer.render(scene,camera);}else{renderer.render(scene,camera);animationFrame=requestAnimationFrame(animateWorld);}
    document.documentElement.classList.remove('no-webgl','world-loading','world-fallback-active');
    document.documentElement.classList.add('world-ready');
    window.PONTUS_LOCAL_3D_FALLBACK?.stop?.(true);
    if(window.__PONTUS_BOOT_WATCHDOG__)clearTimeout(window.__PONTUS_BOOT_WATCHDOG__);
    const fallbackStatus=$('#world-fallback-status');if(fallbackStatus)fallbackStatus.textContent='MODEL 3D ACTIV';
  }catch(err){
    console.error('PONTUS WebGL initialization failed; local atlas fallback is active.',err);
    window.__PONTUS_3D_ERROR__=err?.stack||String(err);
    document.documentElement.classList.add('no-webgl','world-fallback-active');
    document.documentElement.classList.remove('world-loading','world-ready');
    const fallbackStatus=$('#world-fallback-status');if(fallbackStatus)fallbackStatus.textContent='SE PORNEȘTE MODELUL 3D LOCAL…';
    await window.PONTUS_LOCAL_3D_FALLBACK?.start?.();
  }
}
function clipGeographicSegment(a,b,bounds){
  const [x0,y0]=a,[x1,y1]=b,dx=x1-x0,dy=y1-y0;
  let t0=0,t1=1;
  const p=[-dx,dx,-dy,dy],q=[x0-bounds.west,bounds.east-x0,y0-bounds.south,bounds.north-y0];
  for(let i=0;i<4;i++){
    if(Math.abs(p[i])<1e-12){if(q[i]<0)return null;continue;}
    const r=q[i]/p[i];
    if(p[i]<0)t0=Math.max(t0,r);else t1=Math.min(t1,r);
    if(t0>t1)return null;
  }
  return [[x0+t0*dx,y0+t0*dy],[x0+t1*dx,y0+t1*dy]];
}
async function drawGeoJSONWaterMask(features,width,height){
  const c=document.createElement('canvas');c.width=width;c.height=height;
  const ctx=c.getContext('2d',{willReadFrequently:true});ctx.fillStyle='#fff';ctx.fillRect(0,0,width,height);
  const ordered=[...features].sort((a,b)=>Number(a.properties?.level_??a.properties?.level??1)-Number(b.properties?.level_??b.properties?.level??1));
  const drawRing=(ring)=>{
    if(!ring||ring.length<4)return;
    let started=false,lastX=-1e9,lastY=-1e9;
    for(const point of ring){
      const lon=Number(point[0]),lat=Number(point[1]);if(!Number.isFinite(lon)||!Number.isFinite(lat))continue;
      const x=(lon-BLACK_SEA_BOUNDS.west)/(BLACK_SEA_BOUNDS.east-BLACK_SEA_BOUNDS.west)*width;
      const y=(BLACK_SEA_BOUNDS.north-lat)/(BLACK_SEA_BOUNDS.north-BLACK_SEA_BOUNDS.south)*height;
      // Sub-pixel thinning preserves the high-resolution coastline at the rendered mask scale.
      if(!started){ctx.moveTo(x,y);started=true;lastX=x;lastY=y;}
      else if(Math.abs(x-lastX)+Math.abs(y-lastY)>.32){ctx.lineTo(x,y);lastX=x;lastY=y;}
    }
    if(started)ctx.closePath();
  };
  for(let featureIndex=0;featureIndex<ordered.length;featureIndex++){
    const feature=ordered[featureIndex];
    const level=Number(feature.properties?.level_??feature.properties?.level??1);
    if(![1,2,3,4].includes(level))continue;
    const geom=feature.geometry;if(!geom)continue;
    let polygons=[];
    if(geom.type==='Polygon')polygons=[geom.coordinates];
    else if(geom.type==='MultiPolygon')polygons=geom.coordinates;
    else continue;
    // GSHHG hierarchy: L1 land, L2 lakes, L3 islands in lakes, L4 ponds.
    ctx.fillStyle=level%2===1?'#000':'#fff';
    for(const polygon of polygons){
      ctx.beginPath();for(const ring of polygon)drawRing(ring);
      ctx.fill('evenodd');
    }
    if(featureIndex%8===7)await nextPaint();
  }
  return c;
}
async function loadHighResolutionCoastline(parent,waterMaskTexture,maskPixels,maskWidth,maskHeight){
  // The full vector upgrade is optional; bound the entire multi-batch operation,
  // not just each individual HTTP request, so a slow tile group cannot linger.
  const controller=new AbortController(),totalTimeout=setTimeout(()=>controller.abort(),36000);
  try{
  const status=$('#coast-status');
  const setStatus=(text,state)=>{if(status){status.textContent=text;status.dataset.state=state;}};
  setStatus('SE ÎNCARCĂ GSHHG HIGH-RES…','loading');
  const endpoint='https://services7.arcgis.com/WSiUmUhlFx4CtMBB/ArcGIS/rest/services/GSHHS_GlobalCoastlines_HighResolution/FeatureServer/0/query';
  const base={where:'1=1',geometry:'26,39,43,48',geometryType:'esriGeometryEnvelope',inSR:'4326',spatialRel:'esriSpatialRelIntersects'};
  const idsParams=new URLSearchParams({...base,returnIdsOnly:'true',f:'json'});
  const idsResponse=await fetch(`${endpoint}?${idsParams}`,{mode:'cors',credentials:'omit',signal:controller.signal});
  if(!idsResponse.ok)throw new Error(`GSHHG IDs HTTP ${idsResponse.status}`);
  const idsBody=await idsResponse.json();if(idsBody.error)throw new Error(idsBody.error.message||'Eroare ArcGIS');
  const ids=(idsBody.objectIds||[]).sort((a,b)=>a-b);if(!ids.length)throw new Error('Nu au fost găsite poligoane de coastă în zona Mării Negre.');
  const batches=[];for(let i=0;i<ids.length;i+=80)batches.push(ids.slice(i,i+80));
  const features=[];
  for(let i=0;i<batches.length;i+=3){
    const chunk=await Promise.all(batches.slice(i,i+3).map(async batch=>{
      const p=new URLSearchParams({objectIds:batch.join(','),outFields:'*',returnGeometry:'true',outSR:'4326',f:'json'});
      const r=await fetch(`${endpoint}?${p}`,{mode:'cors',credentials:'omit',signal:controller.signal});
      if(!r.ok)throw new Error(`GSHHG geometries HTTP ${r.status}`);
      const data=await r.json();if(data.error)throw new Error(data.error.message||'GSHHG JSON indisponibil');
      // ArcGIS FeatureServer's documented query response is an ESRI FeatureSet.
      // Convert its WGS84 polygon rings explicitly; the existing even-odd rasterizer
      // then preserves holes, islands and nested GSHHG hierarchy levels.
      if(Array.isArray(data.features)&&data.features.length&&data.features[0].geometry?.rings){
        return data.features.map(feature=>({
          type:'Feature',
          properties:feature.attributes||{},
          geometry:{type:'Polygon',coordinates:feature.geometry.rings}
        }));
      }
      return data.features||[];
    }));
    chunk.forEach(batch=>features.push(...batch));
  }
  if(features.length<3)throw new Error('Serviciul a returnat prea puține geometrii de coastă.');
  const maskCanvas=await drawGeoJSONWaterMask(features,maskWidth,maskHeight);
  const ctx=maskCanvas.getContext('2d',{willReadFrequently:true});
  const pixels=ctx.getImageData(0,0,maskWidth,maskHeight).data;maskPixels.set(pixels);
  waterMaskTexture.image=maskCanvas;waterMaskTexture.needsUpdate=true;waterMaskTexture.generateMipmaps=true;
  waterMaskTexture.minFilter=THREE.LinearMipmapLinearFilter;waterMaskTexture.magFilter=THREE.LinearFilter;
  // Build a single high-resolution shoreline LineSegments buffer from real GSHHG polygon edges.
  const linePositions=[];let shorelineVertices=0;
  const pushSegment=(a,b)=>{
    const clipped=clipGeographicSegment(a,b,BLACK_SEA_BOUNDS);if(!clipped)return;
    for(const point of clipped){const [x,z]=geoToMap(point[0],point[1]);linePositions.push(x,WATER_LEVEL+.024,z);shorelineVertices++;}
  };
  for(let featureIndex=0;featureIndex<features.length;featureIndex++){
    const feature=features[featureIndex];
    const level=Number(feature.properties?.level_??feature.properties?.level??1);if(level!==1)continue;
    const geom=feature.geometry;if(!geom)continue;
    let polygons=[];if(geom.type==='Polygon')polygons=[geom.coordinates];else if(geom.type==='MultiPolygon')polygons=geom.coordinates;else continue;
    for(const polygon of polygons)for(const ring of polygon){
      if(ring.length<3)continue;
      const closed=ring.length>3&&ring[0][0]===ring[ring.length-1][0]&&ring[0][1]===ring[ring.length-1][1];
      const edgeCount=closed?ring.length-1:ring.length;
      for(let j=0;j<edgeCount;j++)pushSegment(ring[j],ring[(j+1)%edgeCount]);
    }
    if(featureIndex%8===7)await nextPaint();
  }
  if(linePositions.length<24)throw new Error('Geometriile returnate nu conțin linii de litoral utilizabile.');
  const highResLayer=new THREE.Group();highResLayer.name='GSHHG high-resolution shoreline';
  const geom=new THREE.BufferGeometry();geom.setAttribute('position',new THREE.Float32BufferAttribute(linePositions,3));
  const glow=new THREE.LineSegments(geom,new THREE.LineBasicMaterial({color:0x3fa5b2,transparent:true,opacity:.19,depthWrite:false}));glow.scale.setScalar(1.0005);glow.renderOrder=2.8;highResLayer.add(glow);
  const edge=new THREE.LineSegments(geom,new THREE.LineBasicMaterial({color:0xd9b37e,transparent:true,opacity:.91,depthWrite:false}));edge.renderOrder=3;highResLayer.add(edge);
  parent.userData.coastlineLayer?.removeFromParent();parent.add(highResLayer);parent.userData.coastlineLayer=highResLayer;
  parent.userData.coastlineSource='GSHHG high resolution';parent.userData.highResolutionShorelineVertices=shorelineVertices;
  setStatus(`GSHHG HIGH · ${shorelineVertices.toLocaleString('ro-RO')} VÂRFURI DE LITORAL`,'live');
  return {features:features.length,shorelineVertices};
  }finally{clearTimeout(totalTimeout);}
}
async function addBathymetricContours(parent,raster,width,height,noData,sign){
  parent.userData.isobathGroup?.removeFromParent();
  const group=new THREE.Group();group.name='EMODnet measured-depth contours';
  const noDataValue=(noData===null||noData===undefined||noData==='')?Number.NaN:Number(noData);
  const get=(x,y)=>{const v=Number(raster[y*width+x]);return Number.isFinite(v)&&Math.abs(v)<12000&&(!Number.isFinite(noDataValue)||Math.abs(v-noDataValue)>.0001)?v*sign:null;};
  const levels=[-50,-100,-200,-350,-500,-750,-1000,-1500,-2000,-2500,-3000];
  const colors=[0x9bd3d0,0x86c5c4,0x70b5bc,0x62a7b4,0x5798ad,0x50889f,0x527a94,0x5d748c,0x6e7888,0x82847f,0x9a927f];
  const stride=4;
  for(let levelIndex=0;levelIndex<levels.length;levelIndex++){
    const level=levels[levelIndex],vertices=[];
    const edgePairs=[[0,1],[1,2],[2,3],[3,0]];
    for(let y=0;y<height-1;y+=stride)for(let x=0;x<width-1;x+=stride){
      const coords=[[x,y],[Math.min(width-1,x+stride),y],[Math.min(width-1,x+stride),Math.min(height-1,y+stride)],[x,Math.min(height-1,y+stride)]];
      const vals=coords.map(([cx,cy])=>get(cx,cy));if(vals.some(v=>v===null))continue;
      const crossings=[];
      for(const [ia,ib] of edgePairs){const va=vals[ia],vb=vals[ib];if((va<level&&vb>=level)||(vb<level&&va>=level)){
        const t=(level-va)/(vb-va),[ax,ay]=coords[ia],[bx,by]=coords[ib];
        const px=(ax+(bx-ax)*t)/(width-1),py=(ay+(by-ay)*t)/(height-1);
        crossings.push([px,py]);
      }}
      if(crossings.length>=2){
        const pairs=crossings.length===4?[[0,1],[2,3]]:[[0,1]];
        for(const [a,b] of pairs)for(const [u,v] of [crossings[a],crossings[b]]){
          const lon=BLACK_SEA_BOUNDS.west+u*(BLACK_SEA_BOUNDS.east-BLACK_SEA_BOUNDS.west);
          const lat=BLACK_SEA_BOUNDS.north-v*(BLACK_SEA_BOUNDS.north-BLACK_SEA_BOUNDS.south);
          const [xw,zw]=geoToMap(lon,lat);vertices.push(xw,WATER_LEVEL+level*.00016+.005,zw);
        }
      }
    }
    if(vertices.length){const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute(vertices,3));
      const material=new THREE.LineBasicMaterial({color:colors[levelIndex],transparent:true,opacity:.43,depthWrite:false});
      const lines=new THREE.LineSegments(geometry,material);lines.renderOrder=1.2;group.add(lines);
    }
    await nextPaint();
  }
  parent.add(group);parent.userData.isobathGroup=group;return group.children.length;
}

async function loadEMODnetDepthModel(parent,waterMaskPixels,maskWidth,maskHeight){
  const status=$('#dem-status');
  const setStatus=(text,state)=>{if(status){status.textContent=text;status.dataset.state=state;}};
  setStatus('SE ÎNCARCĂ GRILA BATIMETRICĂ EMODNET…','loading');
  const params=new URLSearchParams({
    service:'wcs',version:'1.0.0',request:'GetCoverage',coverage:'emodnet:mean',crs:'EPSG:4326',
    BBOX:'26,39,43,48',format:'image/tiff',interpolation:'nearest',
    // 15 arc-seconds requested grid. The source DTM has variable data provenance/resolution;
    // it must not be interpreted as a uniform 450 m survey everywhere.
    resx:'0.0041666667',resy:'0.0041666667'
  });
  const response=await fetch(`https://ows.emodnet-bathymetry.eu/wcs?${params.toString()}`,{mode:'cors',credentials:'omit',headers:{Accept:'image/tiff,application/octet-stream;q=0.9,*/*;q=0.5'},signal:AbortSignal.timeout(30000)});
  if(!response.ok)throw new Error(`EMODnet WCS HTTP ${response.status}`);
  const contentType=response.headers.get('content-type')||'';
  if(contentType.includes('xml')||contentType.includes('text'))throw new Error('Serviciul a returnat un mesaj XML, nu o grilă GeoTIFF.');
  const declaredBytes=Number(response.headers.get('content-length')||0);
  if(declaredBytes>64*1024*1024)throw new Error('Grila EMODnet depășește limita de transfer sigură de 64 MB.');
  const buffer=await response.arrayBuffer();
  if(buffer.byteLength<1024||buffer.byteLength>64*1024*1024)throw new Error('Dimensiunea grilei batimetrice este neașteptată.');
  const GeoTIFF=await import('geotiff');
  const tiff=await GeoTIFF.fromArrayBuffer(buffer);
  const image=await tiff.getImage();
  const rasterWidth=image.getWidth(),rasterHeight=image.getHeight();
  if(rasterWidth<1024||rasterHeight<512||rasterWidth>9000||rasterHeight>5000||rasterWidth*rasterHeight>16_000_000)throw new Error(`Dimensiuni WCS neașteptate: ${rasterWidth} × ${rasterHeight}.`);
  const coverageBounds=image.getBoundingBox?.();
  if(Array.isArray(coverageBounds)&&coverageBounds.length===4){
    const [west,south,east,north]=coverageBounds;
    if(Math.abs(west-26)>.12||Math.abs(south-39)>.12||Math.abs(east-43)>.12||Math.abs(north-48)>.12)throw new Error('Extinderea geografică a grilei WCS nu corespunde hărții.');
  }
  const bands=await image.readRasters({samples:[0],interleave:false});
  const raster=Array.isArray(bands)?bands[0]:bands;
  if(!raster||raster.length!==rasterWidth*rasterHeight)throw new Error('Grila GeoTIFF nu corespunde dimensiunilor declarate.');
  const nodata=image.getGDALNoData?.();
  const result=await parent.userData.applyBathymetry(raster,rasterWidth,rasterHeight,nodata);
  const contourCount=await addBathymetricContours(parent,raster,rasterWidth,rasterHeight,nodata,result.sign);
  bathymetryState='emodnet';
  setStatus(`EMODNET DTM · ${result.appliedValues.toLocaleString('ro-RO')} NODURI · ${contourCount} NIVELURI IZOBATICE`,'live');
  parent.userData.bathymetrySource='EMODnet Bathymetry WCS — emodnet:mean';
  return result;
}
async function loadWorldElevationModel(parent){
  const status=$('#topography-status');
  const setStatus=(text,state)=>{if(status){status.textContent=text;status.dataset.state=state;}};
  setStatus('SE ÎNCARCĂ MODELUL TOPOGRAFIC…','loading');
  const params=new URLSearchParams({
    bbox:'26,39,43,48',bboxSR:'4326',imageSR:'4326',size:coarsePointer?'2040,1080':'4080,2160',
    format:'tiff',pixelType:'F32',interpolation:'RSP_BilinearInterpolation',adjustAspectRatio:'false',f:'image'
  });
  const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),14000);
  try{
    const endpoint='https://elevation3d.arcgis.com/arcgis/rest/services/WorldElevation3D/Terrain3D/ImageServer/exportImage';
    const response=await fetch(`${endpoint}?${params.toString()}`,{mode:'cors',credentials:'omit',cache:'force-cache',signal:controller.signal,headers:{Accept:'image/tiff,application/octet-stream;q=0.9,*/*;q=0.5'}});
    if(!response.ok)throw new Error(`ArcGIS Terrain3D HTTP ${response.status}`);
    const type=response.headers.get('content-type')||'';
    if(type.includes('xml')||type.includes('text')||type.includes('json'))throw new Error('ArcGIS Terrain3D nu a returnat un GeoTIFF raster.');
    const declared=Number(response.headers.get('content-length')||0);
    if(declared>72*1024*1024)throw new Error('Rasterul topografic depășește limita de transfer sigură.');
    const buffer=await response.arrayBuffer();
    if(buffer.byteLength<4096||buffer.byteLength>72*1024*1024)throw new Error('Dimensiunea rasterului topografic este neașteptată.');
    const GeoTIFF=await import('geotiff');
    const tiff=await GeoTIFF.fromArrayBuffer(buffer),image=await tiff.getImage();
    const rasterWidth=image.getWidth(),rasterHeight=image.getHeight();
    if(rasterWidth<1024||rasterHeight<512||rasterWidth>6000||rasterHeight>3600||rasterWidth*rasterHeight>12_000_000)throw new Error(`Dimensiuni Terrain3D neașteptate: ${rasterWidth} × ${rasterHeight}.`);
    const bbox=image.getBoundingBox?.()||[26,39,43,48];
    if(!Array.isArray(bbox)||bbox.length!==4)throw new Error('GeoTIFF-ul nu conține limite geografice valide.');
    const [west,south,east,north]=bbox;
    if(Math.abs(west-26)>.15||Math.abs(south-39)>.15||Math.abs(east-43)>.15||Math.abs(north-48)>.15)throw new Error('Limitele rasterului Terrain3D nu corespund hărții.');
    const bands=await image.readRasters({samples:[0],interleave:false});
    const raster=Array.isArray(bands)?bands[0]:bands;
    if(!raster||raster.length!==rasterWidth*rasterHeight)throw new Error('Rasterul Terrain3D este incomplet.');
    const result=await parent.userData.applyLandElevation(raster,rasterWidth,rasterHeight,image.getGDALNoData?.(),bbox);
    parent.userData.topographySource='ArcGIS WorldElevation3D Terrain3D ImageServer · WGS84';
    const terrain=parent.userData.terrain;if(terrain)terrain.name='WGS84 LCC terrain: ArcGIS Terrain3D land elevations + EMODnet numeric bathymetry + GSHHG high-resolution coastline';
    setStatus(`ARC GIS TERRAIN3D · ${result.appliedValues.toLocaleString('ro-RO')} NODURI DE USCAT`,'live');
    return result;
  }finally{clearTimeout(timeout);}
}
async function loadEMODnetBathymetry(parent,mask){
  const status=$('#dem-status');
  const params=new URLSearchParams({service:'WMS',version:'1.1.1',request:'GetMap',layers:'emodnet:mean_multicolour',styles:'',srs:'EPSG:4326',bbox:'26,39,43,48',width:coarsePointer?'2048':'3072',height:coarsePointer?'1084':'1626',format:'image/png',transparent:'true'});
  const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),12000);
  try{
    const response=await fetch(`https://ows.emodnet-bathymetry.eu/wms?${params.toString()}`,{mode:'cors',credentials:'omit',signal:controller.signal,cache:'force-cache'});
    if(!response.ok)throw new Error(`EMODnet WMS HTTP ${response.status}`);
    const type=response.headers.get('content-type')||'';
    if(!type.startsWith('image/'))throw new Error('EMODnet WMS nu a returnat o imagine raster.');
    const declared=Number(response.headers.get('content-length')||0);
    if(declared>32*1024*1024)throw new Error('Suprapunerea WMS depășește limita de 32 MB.');
    const blob=await response.blob();
    if(blob.size<1024||blob.size>32*1024*1024)throw new Error('Imaginea WMS are o dimensiune neașteptată.');
    const bitmap=await createImageBitmap(blob);
    const canvas=document.createElement('canvas');canvas.width=bitmap.width;canvas.height=bitmap.height;
    const ctx=canvas.getContext('2d');if(!ctx)throw new Error('Nu este disponibil canvas-ul pentru suprapunerea batimetrică.');
    ctx.drawImage(bitmap,0,0);bitmap.close?.();
    const texture=new THREE.CanvasTexture(canvas);texture.colorSpace=THREE.SRGBColorSpace;
    texture.anisotropy=Math.min(8,renderer.capabilities.getMaxAnisotropy());texture.generateMipmaps=true;
    texture.minFilter=THREE.LinearMipmapLinearFilter;texture.magFilter=THREE.LinearFilter;
    if(waterSurfaceMaterial){waterSurfaceMaterial.map=texture;waterSurfaceMaterial.color.set(0xffffff);waterSurfaceMaterial.opacity=.40;waterSurfaceMaterial.needsUpdate=true;}
    parent.userData.bathymetryColorSource='EMODnet WMS · mean_multicolour';
    if(status){
      status.textContent=bathymetryState==='emodnet'
        ?`${status.textContent} · HARTĂ CROMATICĂ`
        :'EMODNET WMS · HARTĂ CROMATICĂ · RELIEF NUMERIC LOCAL';
      status.dataset.state='live';
    }
    return texture;
  }finally{clearTimeout(timeout);}
}
function settlePendingWorldTransition(){
  // There are only two stage environments (map/archive), so at most two queued
  // crossfades can need completing when a tab is backgrounded or enters bfcache.
  for(let pass=0;pass<2&&sceneTransition;pass++){
    const active=sceneTransition;
    try{active.progress(1);}
    catch(error){console.info('A fost finalizată de siguranță tranziția scenei.',error);}
    if(sceneTransition===active){
      try{active.kill();}catch{}
      sceneTransition=null;
    }
  }
}
function pauseWorld(){worldPaused=true;if(animationFrame){cancelAnimationFrame(animationFrame);animationFrame=0;}lastWorldFrame=0;}
function resumeWorld(){worldPaused=false;if(!reducedMotion&&!document.hidden&&!animationFrame&&renderer&&scene){lastWorldFrame=0;animationFrame=requestAnimationFrame(animateWorld);}}

let worldResizeRaf=0;
function resizeWorld(){
  if(!renderer||!camera)return;
  if(worldResizeRaf)cancelAnimationFrame(worldResizeRaf);
  worldResizeRaf=requestAnimationFrame(()=>{
    worldResizeRaf=0;
    if(!renderer||!camera)return;
    const width=Math.max(1,window.innerWidth),height=Math.max(1,window.innerHeight);
    camera.aspect=width/height;camera.updateProjectionMatrix();
    renderer.setPixelRatio(Math.min(devicePixelRatio||1,qualityScale));
    renderer.setSize(width,height,false);
    storyWorld?.resize?.();
  });
}
function updateVoyageVisuals(progress,dt=0,t=worldElapsed){
  const poseVessel=(vessel,curve,baseY,wave=false)=>{
    if(!vessel||!curve)return null;
    const u=THREE.MathUtils.clamp(progress,0,1);
    const p=curve.getPointAt(u);
    const before=curve.getPointAt(Math.max(0,u-.0025));
    const after=curve.getPointAt(Math.min(1,u+.0025));
    const tangent=after.sub(before).normalize();
    // Local -Z is physically marked as the prow: the quaternion maps that axis
    // directly onto the direction of increasing route progress.
    const forward=vessel.userData.forwardAxis||SHIP_BOW_LOCAL;
    const heading=new THREE.Quaternion().setFromUnitVectors(forward,tangent);
    vessel.quaternion.copy(heading);
    const offset=vessel.userData.bowOffset||0;
    const yWave=wave?Math.sin(p.x*1.15+t*.68)*.009+Math.sin(p.z*1.72-t*.49)*.007+Math.sin((p.x+p.z)*2.9+t*.31)*.0025:0;
    vessel.position.set(p.x-tangent.x*offset,baseY-(vessel.userData.bowHeight||0)+yWave+Math.sin(t*1.1)*.003,p.z-tangent.z*offset);
    return {p,tangent,yWave};
  };
  const mainPose=poseVessel(ship,routeCurve,WATER_LEVEL+.055,true);
  const archivePose=poseVessel(archiveShip,archiveRouteCurve,.125,false);
  if(mainPose){const offset=ship?.userData.bowOffset||0;window.PONTUS_VESSEL_DEBUG={renderer:'threejs',progress:THREE.MathUtils.clamp(progress,0,1),x:ship.position.x,y:ship.position.y,z:ship.position.z,routeX:mainPose.p.x,routeY:mainPose.p.y,routeZ:mainPose.p.z,bowX:ship.position.x+mainPose.tangent.x*offset,bowZ:ship.position.z+mainPose.tangent.z*offset,heading:Math.atan2(mainPose.tangent.x,mainPose.tangent.z),scale:ship?.userData.vesselScale||null,bowOffset:offset};}
  const setLineProgress=line=>{
    if(!line)return;
    const count=line.geometry.attributes.position.count;
    line.geometry.setDrawRange(0,Math.max(1,Math.floor(progress*(count-1))+1));
  };
  setLineProgress(routeProgressLine);setLineProgress(archiveRouteProgressLine);
  if(mainPose&&routePulseMesh){routePulseMesh.position.set(mainPose.p.x,WATER_LEVEL+.075+mainPose.yWave,mainPose.p.z);const pulse=1+Math.sin(t*2.0)*.10;routePulseMesh.scale.setScalar(pulse);}
  if(archivePose&&archiveRoutePulse){archiveRoutePulse.position.set(archivePose.p.x,.112,archivePose.p.z);const pulse=1+Math.sin(t*2.0)*.10;archiveRoutePulse.scale.setScalar(pulse);}
  const progressReadout=$('#voyage-progress-value');if(progressReadout){const value=Math.round(progress*100);if(progressReadout.textContent!==`${String(value).padStart(2,'0')}%`)progressReadout.textContent=`${String(value).padStart(2,'0')}%`;}
  const progressFill=$('#voyage-progress-fill');if(progressFill)progressFill.style.transform=`scaleX(${progress})`;
}

function animateWorld(now=performance.now()){
  if(document.hidden||worldPaused||!renderer||!scene)return;
  animationFrame=requestAnimationFrame(animateWorld);
  const dt=lastWorldFrame?Math.min((now-lastWorldFrame)/1000,.04):1/60;lastWorldFrame=now;worldElapsed+=dt;const t=worldElapsed;
  // One damped progress value drives both the large map vessel and the miniature
  // on the archival chart, so route movement stays visible through every chapter.
  lessonRouteProgress += (lessonRouteTarget-lessonRouteProgress)*(1-Math.exp(-12*dt));
  if(Math.abs(lessonRouteTarget-lessonRouteProgress)<.00035)lessonRouteProgress=lessonRouteTarget;
  updateVoyageVisuals(lessonRouteProgress,dt,t);
  for(const sail of sailMeshes){
    const attr=sail.geometry.attributes.position,base=sail.userData.basePositions,height=sail.userData.sailHeight;
    for(let i=0;i<attr.count;i++){const x=base[i*3],y=base[i*3+1],v=y/height+.5,env=Math.sin(Math.max(0,Math.min(1,v))*Math.PI);attr.array[i*3+2]=base[i*3+2]+Math.sin(t*1.0+y*1.9+x*2.4)*.014*env;}
    attr.needsUpdate=true;attr.computeVertexNormals?.();
  }
  if(worldMode==='map'&&waterNormalTexture){waterNormalTexture.offset.x=(t*.0034)%1;waterNormalTexture.offset.y=(t*.0018)%1;}
  if(worldMode==='map'&&waterSurfaceMaterial){waterSurfaceMaterial.normalScale.set(.29+Math.sin(t*.19)*.006,.27+Math.cos(t*.17)*.006);}
  if(worldMode==='map'&&waterSurfaceGeometry&&waterBasePositions){
    const attr=waterSurfaceGeometry.attributes.position;
    for(let i=0;i<attr.count;i++){
      const x=waterBasePositions[i*3],z=waterBasePositions[i*3+2];
      const wave=Math.sin(x*1.08+t*.62)*.014+Math.sin(z*1.58-t*.46)*.010+Math.sin((x+z)*2.55+t*.29)*.0042;
      attr.array[i*3+1]=waterBasePositions[i*3+1]+wave;
    }
    attr.needsUpdate=true;
  }
  if(worldMode==='map'&&mapPins.length){mapPins.forEach((pin,i)=>{pin.position.y=pin.userData.baseY+Math.sin(t*1.15+i*.7)*.010;});}
  if(worldMode==='map'&&ship){
    ship.rotateX(Math.sin(t*.72)*.0075);ship.rotateZ(Math.cos(t*.58)*.0055);
    const forward=new THREE.Vector3(0,0,-1).applyQuaternion(ship.quaternion);const lateral=new THREE.Vector3(forward.z,0,-forward.x).normalize();
    wakeLineMeshes.forEach(({line,side})=>{
      line.visible=lessonRouteProgress>.006;const attr=line.geometry.attributes.position;
      for(let i=0;i<attr.count;i++){const u=i/(attr.count-1),back=.14+u*.76,spread=.024+u*.135;
        attr.setXYZ(i,ship.position.x-forward.x*back+lateral.x*spread*side,WATER_LEVEL+.014+Math.sin(t*1.7+u*3)*.002,ship.position.z-forward.z*back+lateral.z*spread*side);}
      attr.needsUpdate=true;line.geometry.computeBoundingSphere();
      line.material.opacity=Math.min(.30,lessonRouteProgress*1.6)*(1-side*.08);
    });
  }
  shipLanternLights.forEach((light,i)=>{light.intensity=light.userData.baseIntensity*(.93+Math.sin(t*4.2+i)*.035+Math.sin(t*7.1+i*.7)*.018);});
  const dust=scene.userData.dust;if(dust){dust.rotation.y=t*.002;dust.position.y=Math.sin(t*.13)*.025;}
  if(mapGroup&&worldMode==='map')mapGroup.rotation.z=Math.sin(t*.08)*.0018;
  if(archiveGroup&&worldMode==='archive'){
    archiveGroup.rotation.z=Math.sin(t*.08)*.0012;
    const props=archiveGroup.userData.idleProps,base=archiveGroup.userData.idleBase;
    if(props&&base){
      props.quill.rotation.z=base.quillZ+Math.sin(t*.34)*.006;
      props.astrolabe.rotation.y=base.astrolabeY+Math.sin(t*.18)*.004;
      props.scrollRoll.rotation.z=base.scrollZ+Math.sin(t*.22)*.0015;
      props.telescope.rotation.z=base.telescopeZ+Math.sin(t*.16)*.0012;
      props.magnifier.rotation.z=base.magnifierZ+Math.sin(t*.20)*.001;
      props.book.position.y=base.bookY+Math.sin(t*.26)*.0018;
      props.inkWell.position.y=base.inkWellY+Math.sin(t*.31+1)*.0008;
      props.dividers.rotation.z=base.dividersZ+Math.sin(t*.22+.4)*.0009;
      props.compass.position.y=base.compassY+Math.sin(t*.24+1.2)*.00075;
      props.compassNeedle.rotation.y=base.compassNeedleY+Math.sin(t*.17+.6)*.012;
    }
  }
  if(storyWorld?.active){
    if(mapGroup)mapGroup.visible=false;
    if(archiveGroup)archiveGroup.visible=false;
    storyWasActive=true;
    storyWorld.update(dt,t);
  }else if(storyWasActive){
    if(mapGroup)mapGroup.visible=worldMode==='map';
    if(archiveGroup)archiveGroup.visible=worldMode==='archive';
    storyWasActive=false;
  }
  renderer.render(scene,storyWorld?.active?storyWorld.camera:camera);
  storyWorld?.renderDockOverlay?.();
  perfFrameCount++;
  if(!perfWindowStart)perfWindowStart=now;
  // Use several sample windows and a cooldown instead of reacting to one noisy FPS
  // measurement. This prevents resolution oscillation during scene transitions.
  if(now-perfWindowStart>3200){
    const fps=perfFrameCount/((now-perfWindowStart)/1000);
    if(fps<47){perfSlowWindows++;perfFastWindows=0;}
    else if(fps>59){perfFastWindows++;perfSlowWindows=0;}
    else{perfSlowWindows=0;perfFastWindows=0;}
    if(now-lastQualityAdjustment>5200){
      let next=qualityScale;
      if(perfSlowWindows>=2)next=Math.max(minQualityScale,qualityScale-.06);
      else if(perfFastWindows>=3)next=Math.min(maxQualityScale,qualityScale+.025);
      if(perfSlowWindows>=3&&renderer.shadowMap.enabled){renderer.shadowMap.enabled=false;perfSlowWindows=0;perfFastWindows=0;}
      if(Math.abs(next-qualityScale)>.01){
        qualityScale=next;
        renderer.setPixelRatio(Math.min(devicePixelRatio||1,qualityScale));
        renderer.setSize(innerWidth,innerHeight,false);
        lastQualityAdjustment=now;
      }
    }
    perfWindowStart=now;perfFrameCount=0;
  }
}

function collectWorldMaterials(group){
  const seen=new Set(),items=[];
  group?.traverse(node=>{
    if(!node.material)return;
    const list=Array.isArray(node.material)?node.material:[node.material];
    list.forEach(material=>{
      if(!material||seen.has(material))return;seen.add(material);
      items.push({material,opacity:material.opacity??1,transparent:material.transparent,depthWrite:material.depthWrite});
    });
  });
  return items;
}
function applyWorldOpacity(items,alpha){
  const a=THREE.MathUtils.clamp(alpha,0,1);
  items.forEach(item=>{
    const transparent=item.transparent||a<.999;
    if(item.material.transparent!==transparent){item.material.transparent=transparent;item.material.needsUpdate=true;}
    item.material.opacity=item.opacity*a;
    item.material.depthWrite=a>.985?item.depthWrite:false;
  });
}
function restoreWorldMaterials(items){
  items.forEach(item=>{
    item.material.opacity=item.opacity;if(item.material.transparent!==item.transparent){item.material.transparent=item.transparent;item.material.needsUpdate=true;}item.material.depthWrite=item.depthWrite;
  });
}
function transitionWorld(mode){
  queuedWorldMode=mode;
  if(!mapGroup||!archiveGroup||!camera)return;
  if(sceneTransition)return;
  runWorldTransition();
}
function runWorldTransition(){
  const mode=queuedWorldMode;queuedWorldMode=null;
  if(!mode||mode===worldMode){if(queuedWorldMode&&queuedWorldMode!==worldMode)runWorldTransition();return;}
  const old=worldMode==='map'?mapGroup:archiveGroup;
  const next=mode==='map'?mapGroup:archiveGroup;
  const curtain=$('#scene-curtain');
  const target=mode==='map'?{position:[.1,8.5,10.5],look:[0,.10,0],group:[.52,-.03,0]}:{position:[.25,5.9,8.6],look:[0,.13,0],group:[.05,-.16,0]};
  const snapMaterials=collectWorldMaterials(old),nextMaterials=collectWorldMaterials(next);
  const setFinal=()=>{
    old.visible=false;restoreWorldMaterials(snapMaterials);
    next.visible=true;restoreWorldMaterials(nextMaterials);
    next.position.set(...target.group);next.scale.setScalar(mode==='map'?1:.98);next.rotation.set(0,0,0);
    camera.position.set(...target.position);camera.lookAt(...target.look);
    worldMode=mode;
    document.querySelector('.stage')?.classList.toggle('archive-mode',mode==='archive');
    const readout=$('#stage-readout');if(readout){$('b',readout).textContent=mode==='archive'?'ARHIVA BIOGRAFICĂ':'BAZINUL PONTIC';$('span',readout).textContent=mode==='archive'?'SCENA 02':'SCENA 01';}
    if(window.gsap&&!reducedMotion&&readout)gsap.fromTo(readout,{autoAlpha:0,y:5},{autoAlpha:1,y:0,duration:.34,ease:'power3.out',overwrite:true});
  };
  if(!window.gsap||reducedMotion||!curtain){
    old.visible=false;next.visible=true;next.position.set(...target.group);next.scale.setScalar(mode==='map'?1:.98);next.rotation.set(0,0,0);
    camera.position.set(...target.position);camera.lookAt(...target.look);worldMode=mode;
    document.querySelector('.stage')?.classList.toggle('archive-mode',mode==='archive');
    const readout=$('#stage-readout');if(readout){$('b',readout).textContent=mode==='archive'?'ARHIVA BIOGRAFICĂ':'BAZINUL PONTIC';$('span',readout).textContent=mode==='archive'?'SCENA 02':'SCENA 01';}
    if(renderer&&scene)renderer.render(scene,camera);
    if(queuedWorldMode&&queuedWorldMode!==worldMode)runWorldTransition();return;
  }

  const oldAlpha={value:1},nextAlpha={value:0},cameraAim={x:0,y:worldMode==='map'?.10:.13,z:0};
  const oldPosition={x:old.position.x,y:old.position.y,z:old.position.z};
  const oldRotation={x:old.rotation.x,y:old.rotation.y,z:old.rotation.z};
  const oldScale={x:old.scale.x,y:old.scale.y,z:old.scale.z};
  const nextStart={x:target.group[0]+(mode==='map'?.18:-.12),y:target.group[1]-.24,z:target.group[2]-.38};
  const cameraEnd={x:target.position[0],y:target.position[1],z:target.position[2]};
  next.visible=true;next.position.set(nextStart.x,nextStart.y,nextStart.z);next.scale.setScalar(mode==='map'?.88:.86);next.rotation.set(mode==='map'?.025:-.022,mode==='map'?-.045:.045,mode==='map'?.016:-.018);
  applyWorldOpacity(nextMaterials,0);
  gsap.killTweensOf(curtain);
  const label=curtain.querySelector('span');if(label)label.textContent=mode==='archive'?'HARTA DEVINE ARHIVĂ':'ARHIVA REVINE LA BAZIN';
  gsap.set(curtain,{autoAlpha:0,xPercent:0,scale:.82,transformOrigin:'50% 50%'});
  let transitionFinalized=false;
  const finalizeTransition=()=>{
    if(transitionFinalized)return;transitionFinalized=true;
    setFinal();
    gsap.set(curtain,{autoAlpha:0,scale:1,clearProps:'transform,opacity,visibility'});
    sceneTransition=null;
    if(window.ScrollTrigger)window.ScrollTrigger.update();
    if(queuedWorldMode&&queuedWorldMode!==worldMode)runWorldTransition();
  };
  sceneTransition=gsap.timeline({defaults:{overwrite:'auto'},onComplete:finalizeTransition,onInterrupt:finalizeTransition});
  // A soft cartographic light pulse marks the change of scene; the worlds themselves
  // crossfade and move through the same camera space instead of being hidden by a wipe.
  sceneTransition.to(curtain,{autoAlpha:.22,scale:1.02,duration:.34,ease:'power2.out'},0)
    .to(curtain,{autoAlpha:0,scale:1.22,duration:.66,ease:'power3.out'},.26)
    .to(oldAlpha,{value:0,duration:.72,ease:'power2.inOut',onUpdate:()=>applyWorldOpacity(snapMaterials,oldAlpha.value)},0)
    .to(nextAlpha,{value:1,duration:.82,ease:'power2.out',onUpdate:()=>applyWorldOpacity(nextMaterials,nextAlpha.value)},.12)
    .to(old.position,{x:oldPosition.x-.08,y:oldPosition.y-.20,z:oldPosition.z-.28,duration:.82,ease:'power3.in'},0)
    .to(old.rotation,{x:oldRotation.x+.035,y:oldRotation.y+.022,z:oldRotation.z-.016,duration:.82,ease:'power3.in'},0)
    .to(old.scale,{x:oldScale.x*.93,y:oldScale.y*.93,z:oldScale.z*.93,duration:.82,ease:'power3.in'},0)
    .to(next.position,{x:target.group[0],y:target.group[1],z:target.group[2],duration:.92,ease:'power3.out'},.10)
    .to(next.rotation,{x:0,y:0,z:0,duration:.92,ease:'power3.out'},.10)
    .to(next.scale,{x:mode==='map'?1: .98,y:mode==='map'?1:.98,z:mode==='map'?1:.98,duration:.92,ease:'power3.out'},.10)
    .to(camera.position,{x:cameraEnd.x,y:cameraEnd.y,z:cameraEnd.z,duration:.98,ease:'power3.inOut'},0)
    .to(cameraAim,{x:target.look[0],y:target.look[1],z:target.look[2],duration:.98,ease:'power3.inOut',onUpdate:()=>camera.lookAt(cameraAim.x,cameraAim.y,cameraAim.z)},0);
}

// --- Stable cinematic choreography: one observer for content, a small set of scroll timelines. ---
function initNativeRevealSystem(){
  if(window.PONTUS_REVEAL_RUNTIME?.init){window.PONTUS_REVEAL_RUNTIME.init();return;}

  const registered=new WeakSet();
  const timers=new WeakMap();
  const generations=new WeakMap();
  let observer=null;
  const revealDuration=820;
  const clearRevealTimer=el=>{const timer=timers.get(el);if(timer){clearTimeout(timer);timers.delete(el);}};
  const nextGeneration=el=>{const value=(generations.get(el)||0)+1;generations.set(el,value);return value;};
  const makeVisible=(el,immediate=false)=>{
    if(!el)return;
    clearRevealTimer(el);nextGeneration(el);
    el.dataset.revealState='visible';
    el.classList.remove('reveal-pending');
    el.classList.add('reveal-enabled','is-visible');
    if(immediate){el.style.removeProperty('--reveal-delay');}
  };
  const resetForReentry=el=>{
    if(!el||!el.isConnected)return;
    const state=el.dataset.revealState;
    if(state!=='visible'&&state!=='animating')return;
    clearRevealTimer(el);nextGeneration(el);
    el.dataset.revealState='pending';
    el.classList.remove('is-visible');
    el.classList.add('reveal-enabled','reveal-pending');
  };
  const revealOnEntry=el=>{
    if(!el||!el.isConnected||el.dataset.revealState==='visible'||el.dataset.revealState==='animating')return;
    clearRevealTimer(el);
    const generation=nextGeneration(el);
    const siblings=el.parentElement?[...el.parentElement.children].filter(node=>node.classList?.contains('reveal')):[];
    const inHero=Boolean(el.closest('.hero'));
    const heroItems=inHero?$$('.hero .reveal'):[];
    const position=inHero?Math.max(0,heroItems.indexOf(el)):Math.max(0,siblings.indexOf(el));
    const delay=Math.min(inHero?260:150,position*(inHero?42:26));
    el.style.setProperty('--reveal-delay',`${delay}ms`);
    el.dataset.revealState='animating';
    el.classList.add('reveal-enabled','reveal-pending');
    el.classList.remove('is-visible');
    // Commit the hidden pose before the next frame; this prevents IO callbacks
    // from collapsing the start/end styles into a single paint on fast scroll.
    void el.offsetWidth;
    void getComputedStyle(el).opacity;
    requestAnimationFrame(()=>{
      if(!el.isConnected||generations.get(el)!==generation||el.dataset.revealState!=='animating')return;
      el.classList.remove('reveal-pending');
      el.classList.add('is-visible');
      const timer=setTimeout(()=>{
        if(generations.get(el)===generation&&el.dataset.revealState==='animating')el.dataset.revealState='visible';
        timers.delete(el);
      },delay+revealDuration+180);
      timers.set(el,timer);
    });
  };
  const finishAnimating=()=>$$('.reveal[data-reveal-state="animating"]').forEach(el=>makeVisible(el,false));
  const showAll=()=>$$('.reveal').forEach(el=>makeVisible(el,true));
  const register=el=>{
    if(!(el instanceof HTMLElement)||registered.has(el))return;
    registered.add(el);
    if(reducedMotion||!('IntersectionObserver' in window)||document.hidden||!observer){makeVisible(el,true);return;}
    el.dataset.revealState='pending';
    el.classList.remove('is-visible');
    el.classList.add('reveal-pending');
    try{observer.observe(el);}catch(error){console.warn('Un element nu a putut fi observat; rămâne vizibil.',error);makeVisible(el,true);}
  };

  if(!reducedMotion&&'IntersectionObserver' in window){
    try{
      // A generous outside buffer prevents edge jitter. Leaving this buffer resets
      // the card; entering it again replays the complete animation in either direction.
      observer=new IntersectionObserver(entries=>{
        entries.forEach(entry=>{
          const el=entry.target;
          if(!el?.isConnected)return;
          try{
            if(entry.isIntersecting)revealOnEntry(el);
            else resetForReentry(el);
          }catch(error){console.warn('Animația de apariție a fost finalizată în siguranță.',error);makeVisible(el,true);}
        });
      },{root:null,rootMargin:'160px 0px 160px 0px',threshold:0});
      $$('.reveal').forEach(register);
    }catch(error){
      console.warn('IntersectionObserver indisponibil; conținutul rămâne vizibil.',error);
      observer?.disconnect();observer=null;showAll();
    }
  }else{
    $$('.reveal').forEach(el=>{registered.add(el);makeVisible(el,true);});
  }

  // Dynamically inserted chapter cards and contribution panels get identical
  // repeatable behaviour without scanning the entire DOM on every scroll frame.
  if(observer&&'MutationObserver' in window){
    const mutationObserver=new MutationObserver(records=>{
      records.forEach(record=>record.addedNodes.forEach(node=>{
        if(!(node instanceof HTMLElement))return;
        if(node.matches?.('.reveal'))register(node);
        node.querySelectorAll?.('.reveal').forEach(register);
      }));
    });
    mutationObserver.observe(document.querySelector('main')||document.body,{childList:true,subtree:true});
  }

  document.addEventListener('visibilitychange',()=>{
    if(document.hidden)finishAnimating();
    else if(observer){
      // Re-observe on tab return so elements in the active viewport are reconciled
      // even after the browser has throttled IntersectionObserver delivery.
      $$('.reveal').forEach(el=>{if(registered.has(el)){try{observer.unobserve(el);observer.observe(el);}catch{}}});
    }
  },{passive:true});
  window.addEventListener('pageshow',()=>{
    finishAnimating();
    if(observer)requestAnimationFrame(()=>$$('.reveal').forEach(el=>{if(registered.has(el)){try{observer.unobserve(el);observer.observe(el);}catch{}}}));
  },{passive:true});
}

function initWorldSectionScroll(){
  let worldRaf=0,worldDwell=0,lastRequestedWorld='';
  const evaluate=()=>{
    worldRaf=0;
    const focus=innerHeight*.5;
    let candidate=null,best=Infinity;
    $$('.story-section[data-world]').forEach(section=>{
      const r=section.getBoundingClientRect();
      if(r.top<=focus&&r.bottom>=focus){const score=Math.abs((r.top+r.bottom)*.5-focus);if(score<best){best=score;candidate=section;}}
    });
    const desired=candidate?.dataset.world;
    if(!desired){clearTimeout(worldDwell);lastRequestedWorld='';return;}
    if(desired===worldMode&&!sceneTransition){clearTimeout(worldDwell);lastRequestedWorld=desired;return;}
    if(desired===lastRequestedWorld)return;
    lastRequestedWorld=desired;clearTimeout(worldDwell);
    worldDwell=setTimeout(()=>{
      const focusNow=innerHeight*.5;
      const stillActive=$$('.story-section[data-world]').find(section=>{const r=section.getBoundingClientRect();return r.top<=focusNow&&r.bottom>=focusNow;});
      if(lastRequestedWorld===desired&&stillActive?.dataset.world===desired&&(desired!==worldMode||sceneTransition))transitionWorld(desired);
    },135);
  };
  const schedule=()=>{if(!worldRaf)worldRaf=requestAnimationFrame(evaluate);};
  addEventListener('scroll',schedule,{passive:true});
  addEventListener('resize',schedule,{passive:true});
  addEventListener('pageshow',schedule,{passive:true});
  schedule();
}

function initMotion(){
  // Content reveals are self-contained and still animate when GSAP/CDN is absent.
  initNativeRevealSystem();
  // World switching also works without ScrollTrigger; transitionWorld has its own
  // deterministic no-GSAP branch.
  initWorldSectionScroll();
  if(!window.gsap||!window.ScrollTrigger||reducedMotion)return;

  const gsap=window.gsap;
  const ST=window.ScrollTrigger;
  try{
    gsap.registerPlugin(ST);
    gsap.ticker.lagSmoothing(650,24);
    gsap.defaults({overwrite:'auto'});
    ST.config({ignoreMobileResize:true,limitCallbacks:true,autoRefreshEvents:'visibilitychange,DOMContentLoaded,load'});
  }catch(error){console.warn('ScrollTrigger indisponibil; tranzițiile de conținut native rămân active.',error);return;}

  ST.create({trigger:'#intro',start:'top bottom',end:'bottom top',scrub:1.15,invalidateOnRefresh:true,onUpdate:self=>{
    if(sceneTransition)return;
    if(mapGroup){mapGroup.position.y=-.03+self.progress*.052;mapGroup.rotation.x=.0015+Math.sin(self.progress*Math.PI)*.0012;}
  }});
  ST.create({trigger:'#bratianu',start:'top bottom',end:'bottom top',scrub:1.15,invalidateOnRefresh:true,onUpdate:self=>{
    if(sceneTransition)return;
    if(archiveGroup){archiveGroup.position.y=-.16+self.progress*.052;archiveGroup.rotation.x=.001+Math.sin(self.progress*Math.PI)*.001;}
  }});
  ST.create({trigger:'#hero',start:'top top',end:'bottom top',scrub:1.1,invalidateOnRefresh:true,onUpdate:self=>{
    if(sceneTransition)return;
    if(mapGroup)mapGroup.position.z=-.06+self.progress*.075;
    const lightfield=$('.stage-atmosphere');if(lightfield)lightfield.style.setProperty('--scroll-drift',`${self.progress*18}px`);
  }});
  $$('.photo-card').forEach(card=>{
    const image=$('img',card);if(!image)return;
    gsap.set(image,{scale:1.045,yPercent:0,transformOrigin:'50% 50%'});
    ST.create({trigger:card,start:'top 90%',end:'bottom 10%',scrub:1.25,invalidateOnRefresh:true,onUpdate:self=>{
      gsap.set(image,{yPercent:(self.progress-.5)*-3.4,scale:1.035+Math.sin(self.progress*Math.PI)*.014});
    }});
    if(!coarsePointer){
      const rotateX=gsap.quickTo(card,'rotationX',{duration:.55,ease:'power3.out'});
      const rotateY=gsap.quickTo(card,'rotationY',{duration:.55,ease:'power3.out'});
      card.addEventListener('pointermove',event=>{
        const r=card.getBoundingClientRect();if(!r.width||!r.height)return;
        const nx=(event.clientX-r.left)/r.width-.5,ny=(event.clientY-r.top)/r.height-.5;
        rotateX(-ny*1.7);rotateY(nx*2.1);
        card.style.setProperty('--pointer-x',`${(nx+.5)*100}%`);
        card.style.setProperty('--pointer-y',`${(ny+.5)*100}%`);
      },{passive:true});
      card.addEventListener('pointerleave',()=>{rotateX(0);rotateY(0);});
    }
  });
  if(document.fonts?.ready)document.fonts.ready.then(()=>ST.refresh()).catch(()=>{});
  ST.refresh();
}

// Reading progress drives the vessel: it starts at the introduction and reaches Caffa
// exactly when the reader reaches the end of the documentary. Newly added chapters are
// automatically included because the closing section moves with the page content.
function initLessonRouteProgress(){
  window.PONTUS_MAIN_PROGRESS_DRIVER__=true;
  let measureRaf=0;
  const update=()=>{
    measureRaf=0;
    const doc=document.documentElement;
    const maxScroll=Math.max(0,Math.max(doc.scrollHeight,document.body.scrollHeight)-window.innerHeight);
    const intro=document.querySelector('#intro');
    const routeStart=intro?intro.getBoundingClientRect().top+window.scrollY:0;
    const denominator=Math.max(1,maxScroll-routeStart);
    const raw=(window.scrollY-routeStart)/denominator;
    lessonRouteTarget=THREE?THREE.MathUtils.clamp(raw,0,1):Math.max(0,Math.min(1,raw));
    window.PONTUS_SET_VOYAGE_PROGRESS?.(lessonRouteTarget);
    if(!window.PONTUS_SET_VOYAGE_PROGRESS){
      window.PONTUS_VOYAGE_PROGRESS=lessonRouteTarget;
      const readout=$('#voyage-progress-value');if(readout)readout.textContent=`${String(Math.round(lessonRouteTarget*100)).padStart(2,'0')}%`;
      const fill=$('#voyage-progress-fill');if(fill)fill.style.transform=`scaleX(${lessonRouteTarget})`;
    }
    if(reducedMotion&&renderer&&scene){lessonRouteProgress=lessonRouteTarget;updateVoyageVisuals(lessonRouteProgress,0,worldElapsed);renderer.render(scene,camera);}
  };
  const schedule=()=>{if(!measureRaf)measureRaf=requestAnimationFrame(update);};
  addEventListener('scroll',schedule,{passive:true});
  addEventListener('resize',schedule,{passive:true});
  addEventListener('load',schedule,{once:true});
  addEventListener('pageshow',schedule,{passive:true});
  addEventListener('hashchange',schedule,{passive:true});
  if('ResizeObserver' in window){const observer=new ResizeObserver(schedule);observer.observe(document.querySelector('main')||document.body);observer.observe(document.body);}
  if('MutationObserver' in window){const content=document.querySelector('#contribution-sections');if(content)new MutationObserver(schedule).observe(content,{childList:true,subtree:true,characterData:true});}
  if(document.fonts?.ready)document.fonts.ready.then(schedule).catch(()=>{});
  update();
}

// A clean cartographic scrollytelling sequence for chapter 03.
// The map remains pinned while the reader moves from physical geography to strategic economy.
function renderBlackSeaStrategyChapter(section,ch){
  section.classList.add('blacksea-strategy-section');

  const header=document.createElement('header');header.className='bso-heading reveal';
  const index=document.createElement('div');index.className='section-index';
  const no=document.createElement('span');no.textContent=ch.id;
  const line=document.createElement('i');
  const category=document.createElement('span');category.textContent=ch.category;
  index.append(no,line,category);
  const titleBlock=document.createElement('div');titleBlock.className='bso-title-block';
  const title=document.createElement('h2');title.className='section-title';title.textContent=ch.title;
  const byline=document.createElement('p');byline.className='bso-author';byline.textContent=`CONTRIBUȚIE · ${ch.author||'ECHIPA PROIECTULUI'}`;
  titleBlock.append(title,byline);header.append(index,titleBlock);section.append(header);

  const layout=document.createElement('div');layout.className='bso-layout';
  const dock=document.createElement('aside');dock.className='bso-visual-dock';
  dock.setAttribute('aria-label','Vizualizare cartografică a Mării Negre');
  const screen=document.createElement('div');screen.className='bso-screen';screen.dataset.blackseaScreen='';screen.dataset.activeStep='physical';
  const screenTop=document.createElement('div');screenTop.className='bso-screen-top';
  const screenBrand=document.createElement('span');screenBrand.className='bso-screen-brand';screenBrand.textContent='PONTUS / ATLAS';
  const screenReadout=document.createElement('span');screenReadout.className='bso-screen-readout';screenReadout.dataset.blackseaReadout='';screenReadout.textContent='01 / 02';
  screenTop.append(screenBrand,screenReadout);

  const mapFigure=document.createElement('figure');mapFigure.className='bso-map-figure';mapFigure.dataset.blackseaMap='';
  const mapImage=document.createElement('img');mapImage.src=ch.blackSeaMapImage?.src||'';mapImage.alt=ch.blackSeaMapImage?.alt||'Hartă a Mării Negre';mapImage.loading='eager';mapImage.decoding='async';mapImage.draggable=false;
  mapImage.addEventListener('error',()=>mapFigure.classList.add('is-image-unavailable'));
  mapFigure.append(mapImage);
  const mapFrame=document.createElement('span');mapFrame.className='bso-map-frame';mapFrame.setAttribute('aria-hidden','true');mapFigure.append(mapFrame);
  const mapScan=document.createElement('span');mapScan.className='bso-map-scan';mapScan.setAttribute('aria-hidden','true');mapFigure.append(mapScan);

  const portFigure=document.createElement('figure');portFigure.className='bso-port-figure';portFigure.dataset.blackseaPort='';
  const portImage=document.createElement('img');portImage.src=ch.blackSeaPortImage?.src||'';portImage.alt=ch.blackSeaPortImage?.alt||'Portul Constanța';portImage.loading='eager';portImage.decoding='async';portImage.draggable=false;
  portImage.addEventListener('error',()=>portFigure.classList.add('is-image-unavailable'));
  const portCaption=document.createElement('figcaption');portCaption.textContent=ch.blackSeaPortImage?.caption||'';
  portFigure.append(portImage,portCaption);

  const compass=document.createElement('div');compass.className='bso-compass';compass.setAttribute('aria-hidden','true');
  compass.innerHTML='<svg viewBox="0 0 64 64" focusable="false"><circle cx="32" cy="32" r="26"/><path d="M32 7V57M7 32H57M32 15L38 32L32 49L26 32Z"/><path class="bso-compass-needle" d="M32 15L38 32L32 29L26 32Z"/></svg>';
  const axis=document.createElement('div');axis.className='bso-axis';axis.setAttribute('aria-hidden','true');
  const sceneNote=document.createElement('span');sceneNote.className='bso-scene-note';sceneNote.dataset.blackseaSceneNote='';sceneNote.textContent='MODEL 3D ILUSTRATIV · PLATFORMĂ OFFSHORE ȘI ECOSISTEM PONTIC';sceneNote.setAttribute('aria-hidden','true');
  const screenBottom=document.createElement('div');screenBottom.className='bso-screen-bottom';
  const progress=document.createElement('div');progress.className='bso-screen-progress';progress.innerHTML='<i data-blacksea-progress="physical"></i><i data-blacksea-progress="strategic"></i><i data-blacksea-progress="resources"></i>';
  const activeLabel=document.createElement('span');activeLabel.className='bso-active-label';activeLabel.dataset.blackseaActiveLabel='';activeLabel.textContent='Poziția geografică și caracteristicile fizice ale Mării Negre';
  screenBottom.append(progress,activeLabel);screen.append(sceneNote);
  screen.append(screenTop,mapFigure,portFigure,compass,axis,screenBottom);dock.append(screen);

  const rail=document.createElement('div');rail.className='bso-content-rail';
  (ch.blackSeaPanels||[]).forEach((panel,index)=>{
    const article=document.createElement('article');article.className='bso-scroll-step';article.dataset.blackseaStep=panel.id;
    const stepHeader=document.createElement('header');stepHeader.className='bso-step-header';
    const stepNum=document.createElement('span');stepNum.className='bso-step-number';stepNum.textContent=`0${index+1}`;
    const stepTitle=document.createElement('h3');stepTitle.textContent=panel.heading;
    stepHeader.append(stepNum,stepTitle);
    const list=document.createElement('ul');list.className='bso-fact-list';
    (panel.items||[]).forEach((item,itemIndex)=>{
      const li=document.createElement('li');li.className='bso-fact';
      if(panel.id==='resources'){li.dataset.blackseaFactIndex=String(itemIndex);}
      const marker=document.createElement('span');marker.className='bso-fact-marker';marker.textContent=String(itemIndex+1).padStart(2,'0');
      const copy=document.createElement('p');
      const colon=item.indexOf(':');
      if(colon>0){const label=document.createElement('strong');label.textContent=item.slice(0,colon+1);copy.append(label,document.createTextNode(item.slice(colon+1)));}
      else copy.textContent=item;
      if(panel.id==='resources'){
        const current=copy.textContent;
        const terms=['Neptun Deep','eutrofizare','Marea Neagră','România, Bulgaria, Turcia'];
        const match=terms.map(term=>({term,index:current.indexOf(term)})).filter(x=>x.index>=0).sort((a,b)=>a.index-b.index);
        if(match.length){copy.replaceChildren();let cursor=0;for(const found of match){if(found.index<cursor)continue;copy.append(document.createTextNode(current.slice(cursor,found.index)));const strong=document.createElement('strong');strong.textContent=found.term;copy.append(strong);cursor=found.index+found.term.length;}copy.append(document.createTextNode(current.slice(cursor)));}
      }
      li.append(marker,copy);list.append(li);
    });
    article.append(stepHeader,list);rail.append(article);
  });
  layout.append(dock,rail);section.append(layout);
}

// A compact ancient-colonies chart: a single map and three selectable coastal markers.
// The route is a visual connector between the labelled sites, not a claimed ancient sailing track.
function renderAncientColoniesChapter(section,ch){
  section.classList.add('ancient-colonies-section');

  const header=document.createElement('header');header.className='ancient-heading reveal';
  const index=document.createElement('div');index.className='ancient-index';
  const chapterNo=document.createElement('span');chapterNo.textContent=ch.id;
  const category=document.createElement('small');category.textContent=ch.category;
  index.append(chapterNo,category);
  const titleBlock=document.createElement('div');titleBlock.className='ancient-title-block';
  const eyebrow=document.createElement('p');eyebrow.className='ancient-eyebrow';eyebrow.textContent='PONTOS EUXEINOS';
  const title=document.createElement('h2');title.textContent=ch.title;
  const author=document.createElement('p');author.className='ancient-author';author.textContent=`CONTRIBUȚIE · ${ch.author||'ECHIPA PROIECTULUI'}`;
  titleBlock.append(eyebrow,title,author);header.append(index,titleBlock);section.append(header);

  const explorer=document.createElement('section');explorer.className='ancient-explorer reveal';explorer.dataset.ancientExplorer='';
  const mapHead=document.createElement('div');mapHead.className='ancient-map-head';
  const mapTitle=document.createElement('span');mapTitle.textContent='HARTA COLONIILOR GRECEȘTI';
  const mapMeta=document.createElement('span');mapMeta.textContent='ȚĂRMUL VESTIC · PONTUL EUXIN';
  mapHead.append(mapTitle,mapMeta);

  const mapFrame=document.createElement('div');mapFrame.className='ancient-map-frame';
  const mapImage=document.createElement('img');mapImage.className='ancient-map-image';mapImage.src=ch.ancientMap?.src||'';mapImage.alt=ch.ancientMap?.alt||'Hartă a coloniilor grecești de la Marea Neagră';mapImage.loading='eager';mapImage.decoding='async';mapImage.draggable=false;
  mapImage.addEventListener('error',()=>{mapFrame.classList.add('is-map-unavailable');mapImage.remove();});
  mapFrame.append(mapImage);
  const routes=document.createElementNS('http://www.w3.org/2000/svg','svg');routes.classList.add('ancient-route-svg');routes.setAttribute('viewBox','0 0 751 460');routes.setAttribute('preserveAspectRatio','none');routes.setAttribute('aria-hidden','true');
  routes.innerHTML='<path class="ancient-route-base" d="M121 184 C105 195 107 203 122 211 C135 219 133 225 122 230"/><path class="ancient-route-flow" d="M121 184 C105 195 107 203 122 211 C135 219 133 225 122 230"/>';
  mapFrame.append(routes);
  const places=[
    {id:'histria',label:'Histria',x:16.11,y:40.0},
    {id:'tomis',label:'Tomis',x:16.11,y:45.9},
    {id:'callatis',label:'Callatis',x:16.11,y:50.0}
  ];
  places.forEach(place=>{
    const marker=document.createElement('button');marker.type='button';marker.className='ancient-map-marker';marker.dataset.ancientPlace=place.id;
    marker.style.left=`${place.x}%`;marker.style.top=`${place.y}%`;marker.setAttribute('aria-label',`Selectează ${place.label} pe hartă`);marker.setAttribute('aria-pressed','false');
    marker.innerHTML='<i aria-hidden="true"></i>';mapFrame.append(marker);
  });
  const mapStamp=document.createElement('span');mapStamp.className='ancient-map-stamp';mapStamp.textContent='PONTUS / EUXIN';mapFrame.append(mapStamp);

  const mapFooter=document.createElement('div');mapFooter.className='ancient-map-footer';
  const controls=document.createElement('div');controls.className='ancient-place-controls';controls.setAttribute('role','group');controls.setAttribute('aria-label','Selectează o colonie grecească');
  places.forEach((place,i)=>{
    const button=document.createElement('button');button.type='button';button.className='ancient-place-button';button.dataset.ancientPlace=place.id;button.setAttribute('aria-pressed','false');
    const number=document.createElement('span');number.textContent=`0${i+1}`;
    const label=document.createElement('strong');label.textContent=place.label;
    const dot=document.createElement('i');dot.setAttribute('aria-hidden','true');button.append(number,label,dot);controls.append(button);
  });
  const readout=document.createElement('div');readout.className='ancient-map-readout';readout.setAttribute('aria-live','polite');
  const readoutLabel=document.createElement('small');readoutLabel.textContent='REPER SELECTAT';
  const readoutValue=document.createElement('strong');readoutValue.dataset.ancientReadout='';readoutValue.textContent='—';
  readout.append(readoutLabel,readoutValue);mapFooter.append(controls,readout);
  explorer.append(mapHead,mapFrame,mapFooter);section.append(explorer);

  const textGrid=document.createElement('div');textGrid.className='ancient-text-grid';
  (ch.ancientText||[]).forEach((paragraph,i)=>{
    const article=document.createElement('article');article.className='ancient-text-card reveal';
    const no=document.createElement('span');no.className='ancient-text-number';no.textContent=`0${i+1}`;
    const copy=document.createElement('p');
    const tokens=paragraph.split(/(\*\*[^*]+\*\*|Histria|Tomis|Callatis)/g);
    tokens.forEach(token=>{
      if(!token)return;
      if(token.startsWith('**')&&token.endsWith('**')){const strong=document.createElement('strong');strong.textContent=token.slice(2,-2);copy.append(strong);}
      else if(['Histria','Tomis','Callatis'].includes(token)){const span=document.createElement('span');span.dataset.ancientHighlight=token.toLowerCase();span.textContent=token;copy.append(span);}
      else copy.append(document.createTextNode(token));
    });
    article.append(no,copy);textGrid.append(article);
  });
  section.append(textGrid);
}

// A relational atlas for the medieval chapter. It is intentionally thematic rather than
// chronological: readers switch between strategic control, commerce, and the Danube coast.
function renderPonticChapter(section,ch){
  section.classList.add('contributed-pontic');
  const header=document.createElement('header');header.className='pontic-heading';
  const index=document.createElement('div');index.className='section-index reveal';
  const number=document.createElement('span');number.textContent=ch.id;
  const rule=document.createElement('i');
  const category=document.createElement('span');category.textContent=ch.category;
  index.append(number,rule,category);
  const titleBlock=document.createElement('div');titleBlock.className='pontic-title-block reveal';
  const eyebrow=document.createElement('p');eyebrow.className='eyebrow';eyebrow.textContent='SECOLELE VI–XV · GEOGRAFIE, COMERȚ ȘI PUTERE';
  const title=document.createElement('h2');title.className='section-title';title.textContent=ch.title;
  const author=document.createElement('p');author.className='pontic-author';author.textContent=`CONTRIBUȚIE · ${ch.author||'ECHIPA PROIECTULUI'}`;
  titleBlock.append(eyebrow,title,author);
  const mark=document.createElement('div');mark.className='pontic-heading-mark';mark.setAttribute('aria-hidden','true');
  mark.innerHTML='<span></span><i></i><span></span>';
  header.append(index,titleBlock,mark);section.append(header);

  if(ch.lead){const lead=document.createElement('p');lead.className='pontic-lead reveal';lead.textContent=ch.lead;section.append(lead);}

  const network=ch.network||{};
  const atlas=document.createElement('section');atlas.className='pontic-atlas reveal';atlas.dataset.ponticAtlas='';
  const atlasTop=document.createElement('div');atlasTop.className='pontic-atlas-top';
  const atlasTitle=document.createElement('div');atlasTitle.className='pontic-atlas-heading';
  const atlasEyebrow=document.createElement('span');atlasEyebrow.textContent='ATLASUL RELAȚIILOR PONTICE';
  const atlasHeading=document.createElement('h3');atlasHeading.textContent='O mare, trei sisteme de legături.';
  atlasTitle.append(atlasEyebrow,atlasHeading);
  const atlasFlag=document.createElement('span');atlasFlag.className='pontic-atlas-flag';atlasFlag.textContent='EXPLORARE INTERACTIVĂ';
  atlasTop.append(atlasTitle,atlasFlag);

  const atlasBody=document.createElement('div');atlasBody.className='pontic-atlas-body';
  const mapFrame=document.createElement('div');mapFrame.className='pontic-map-frame';
  mapFrame.setAttribute('role','group');mapFrame.setAttribute('aria-label','Hartă interactivă cu repere medievale de la Marea Neagră');
  const mapImage=document.createElement('img');mapImage.className='pontic-map-image';mapImage.src=network.image||'';mapImage.alt=network.imageAlt||'Hartă fizică a Mării Negre';mapImage.loading='lazy';mapImage.decoding='async';
  mapImage.addEventListener('error',()=>{mapFrame.classList.add('is-map-unavailable');mapImage.remove();});
  mapFrame.append(mapImage);
  const routeSvg=document.createElementNS('http://www.w3.org/2000/svg','svg');
  routeSvg.classList.add('pontic-network-lines');routeSvg.setAttribute('viewBox','0 0 100 100');routeSvg.setAttribute('preserveAspectRatio','none');routeSvg.setAttribute('aria-hidden','true');
  routeSvg.innerHTML=`
    <defs><linearGradient id="ponticRouteGradient" x1="0" y1="1" x2="1" y2="0"><stop offset="0" stop-color="#d9b77e" stop-opacity=".18"/><stop offset=".52" stop-color="#f0d3a0" stop-opacity=".92"/><stop offset="1" stop-color="#75bdc2" stop-opacity=".5"/></linearGradient></defs>
    <path class="pontic-route pontic-route-control" data-layer="control" d="M15.47 76.65 Q29.5 48 44.24 35.01"/>
    <path class="pontic-route pontic-route-control" data-layer="control" d="M15.47 76.65 Q16 76 16.07 75.41"/>
    <path class="pontic-route pontic-route-control" data-layer="control" d="M15.47 76.65 Q8.5 56 10.92 38.99"/>
    <path class="pontic-route pontic-route-trade" data-layer="trade" d="M15.47 76.65 Q40 67 56.28 30.11"/>
    <path class="pontic-route pontic-route-trade" data-layer="trade" d="M44.24 35.01 Q64 13 82.14 6.21"/>
    <path class="pontic-route pontic-route-trade" data-layer="trade" d="M56.28 30.11 Q70 16 82.14 6.21"/>
    <path class="pontic-route pontic-route-danube" data-layer="danube" d="M10.92 38.99 Q13.5 29 17.30 25.49"/>
    <path class="pontic-route pontic-route-danube" data-layer="danube" d="M17.30 25.49 Q21 20 24.31 16.82"/>`;
  mapFrame.append(routeSvg);

  const nodes=Array.isArray(network.nodes)?network.nodes:[];
  nodes.forEach(node=>{
    const button=document.createElement('button');button.type='button';button.className='pontic-map-node';
    button.dataset.ponticNode=node.id;button.style.left=`${node.x}%`;button.style.top=`${node.y}%`;
    button.dataset.labelAlign=node.labelAlign||'right';button.style.setProperty('--label-dy',`${node.labelDy??-12}px`);
    button.setAttribute('aria-label',`Selectează ${node.label}`);button.setAttribute('aria-pressed','false');
    const dot=document.createElement('i');const label=document.createElement('span');label.textContent=node.label;
    button.append(dot,label);mapFrame.append(button);
  });
  const mapStamp=document.createElement('div');mapStamp.className='pontic-map-stamp';mapStamp.textContent='PONTUS / SCHEMĂ DE RELAȚII';mapFrame.append(mapStamp);

  const panel=document.createElement('aside');panel.className='pontic-network-panel';panel.setAttribute('aria-live','polite');panel.setAttribute('aria-atomic','true');
  const panelStatus=document.createElement('div');panelStatus.className='pontic-panel-status';
  panelStatus.innerHTML='<span><i></i> SISTEM SELECTAT</span><small data-pontic-status>STRAT 01 / 03</small>';
  const layerTag=document.createElement('span');layerTag.className='pontic-panel-kicker';layerTag.dataset.ponticKicker='';
  const panelTitle=document.createElement('h4');panelTitle.dataset.ponticTitle='';
  const panelCopy=document.createElement('p');panelCopy.dataset.ponticCopy='';
  const nodeMeta=document.createElement('div');nodeMeta.className='pontic-node-meta';
  const nodeKind=document.createElement('span');nodeKind.dataset.ponticKind='';
  const nodePeriod=document.createElement('small');nodePeriod.dataset.ponticPeriod='';
  nodeMeta.append(nodeKind,nodePeriod);
  const layerHint=document.createElement('div');layerHint.className='pontic-layer-hint';
  layerHint.innerHTML='<span>SELECTEAZĂ UN NOD PE HARTĂ</span><i></i>';
  panel.append(panelStatus,layerTag,panelTitle,panelCopy,nodeMeta,layerHint);
  atlasBody.append(mapFrame,panel);

  const controls=document.createElement('div');controls.className='pontic-layer-controls';controls.setAttribute('aria-label','Alege un sistem de relații');
  const layers=Array.isArray(network.layers)?network.layers:[];
  layers.forEach((layer,index)=>{
    const button=document.createElement('button');button.type='button';button.className='pontic-layer-button';button.dataset.ponticLayer=layer.id;
    button.setAttribute('aria-pressed',String(index===0));
    const no=document.createElement('span');no.textContent=`0${index+1}`;
    const label=document.createElement('strong');label.textContent=layer.label;
    const arrow=document.createElement('i');arrow.textContent='↗';
    button.append(no,label,arrow);controls.append(button);
  });
  const note=document.createElement('p');note.className='pontic-atlas-note';note.textContent=network.note||'Schemă orientativă, nu hartă de frontiere.';
  atlas.append(atlasTop,atlasBody,controls,note);section.append(atlas);

  const documentary=document.createElement('div');documentary.className='pontic-documentary';
  const documentaryHead=document.createElement('div');documentaryHead.className='pontic-documentary-heading reveal';
  const docEyebrow=document.createElement('p');docEyebrow.className='eyebrow';docEyebrow.textContent='DOSAR DOCUMENTAR';
  const docTitle=document.createElement('h3');docTitle.textContent='Evoluția unei mări între imperii și porturi.';
  documentaryHead.append(docEyebrow,docTitle);documentary.append(documentaryHead);
  const content=document.createElement('div');content.className='pontic-documentary-grid';
  (ch.sections||[]).forEach((part,i)=>{
    const article=document.createElement('article');article.className=`pontic-documentary-part reveal${i===0||i===4||i===8?' pontic-part-wide':''}`;
    const no=document.createElement('span');no.className='pontic-documentary-no';no.textContent=String(i+1).padStart(2,'0');
    const heading=document.createElement('h4');heading.textContent=part.heading||`Secțiunea ${i+1}`;
    const body=document.createElement('p');body.textContent=part.body||'';
    article.append(no,heading,body);
    const images=Array.isArray(part.images)&&part.images.length?part.images:(part.image?[{src:part.image,alt:part.imageAlt,caption:part.imageCaption}]:[]);
    if(images.length){
      const gallery=document.createElement('div');gallery.className=`pontic-documentary-gallery${images.length>1?' is-pair':''}`;
      images.forEach(image=>{
        const figure=document.createElement('figure');
        const img=document.createElement('img');img.src=image.src;img.alt=image.alt||part.heading||ch.title;img.loading='lazy';img.decoding='async';
        img.addEventListener('error',()=>{figure.classList.add('is-unavailable');img.remove();});
        figure.append(img);
        if(image.caption||image.label){const caption=document.createElement('figcaption');caption.textContent=image.caption||image.label;figure.append(caption);}
        gallery.append(figure);
      });
      article.append(gallery);
    }
    if(part.source){
      const source=document.createElement('small');source.className='pontic-documentary-source';
      if(part.sourceUrl){const link=document.createElement('a');link.href=part.sourceUrl;link.target='_blank';link.rel='noopener noreferrer';link.textContent=`SURSĂ: ${part.source} ↗`;source.append(link);}
      else source.textContent=`SURSĂ: ${part.source}`;
      article.append(source);
    }
    content.append(article);
  });
  documentary.append(content);section.append(documentary);

  if(Array.isArray(ch.impacts)&&ch.impacts.length){
    const impacts=document.createElement('div');impacts.className='pontic-impact-grid';
    ch.impacts.forEach((impact,index)=>{
      const card=document.createElement('article');card.className='pontic-impact-card reveal';
      const no=document.createElement('span');no.textContent=`0${index+1}`;
      const heading=document.createElement('h4');heading.textContent=impact.label;
      const body=document.createElement('p');body.textContent=impact.body;
      card.append(no,heading,body);impacts.append(card);
    });
    section.append(impacts);
  }
  if(Array.isArray(ch.continuations)&&ch.continuations.length){
    const continuations=document.createElement('nav');continuations.className='pontic-continuations';continuations.setAttribute('aria-label','Continuă explorarea');
    ch.continuations.forEach(item=>{
      const link=document.createElement('a');link.href=item.href;
      const small=document.createElement('small');small.textContent=item.note||'';
      const strong=document.createElement('strong');strong.textContent=item.label||'CONTINUĂ';
      const arrow=document.createElement('i');arrow.textContent='↗';link.append(small,strong,arrow);continuations.append(link);
    });
    section.append(continuations);
  }
}


// A five-image 3D trade chamber. The supplied images act as selectable visual anchors;
// the three documentary panels hold the contributor's exact provided text.
function renderTradeImmersiveChapter(section,ch){
  section.classList.add('trade-immersive-section');

  const header=document.createElement('header');header.className='trade-heading reveal';
  const index=document.createElement('div');index.className='trade-heading-index';
  index.innerHTML=`<span>${ch.id}</span><i></i><small>${ch.category}</small>`;
  const titleBlock=document.createElement('div');titleBlock.className='trade-title-block';
  const eyebrow=document.createElement('p');eyebrow.className='eyebrow';eyebrow.textContent='COMERȚ MARITIM · BAZINUL PONTIC';
  const title=document.createElement('h2');title.className='section-title';title.textContent=ch.title;
  const author=document.createElement('p');author.className='trade-author';author.textContent=`CONTRIBUȚIE · ${ch.author||'ECHIPA PROIECTULUI'}`;
  titleBlock.append(eyebrow,title,author);
  const seal=document.createElement('div');seal.className='trade-heading-seal';seal.setAttribute('aria-hidden','true');
  seal.innerHTML='<span></span><i></i><b></b>';
  header.append(index,titleBlock,seal);section.append(header);

  const experience=document.createElement('div');experience.className='trade-experience reveal';
  const scene=document.createElement('div');scene.className='trade-scene';scene.dataset.tradeScene='';
  scene.setAttribute('aria-label','Galerie interactivă tridimensională cu cinci imagini despre comerțul genovez și venețian');
  const sceneHud=document.createElement('div');sceneHud.className='trade-scene-hud';
  sceneHud.innerHTML='<span><i></i> PONTUS / COMMERȚ</span><small>GALERIE SPAȚIALĂ · 05 IMAGINI</small>';
  const world=document.createElement('div');world.className='trade-visual-world';
  const orbit=document.createElement('div');orbit.className='trade-orbit trade-orbit-a';orbit.setAttribute('aria-hidden','true');
  const orbitB=document.createElement('div');orbitB.className='trade-orbit trade-orbit-b';orbitB.setAttribute('aria-hidden','true');
  const route=document.createElementNS('http://www.w3.org/2000/svg','svg');route.classList.add('trade-scene-route');
  route.setAttribute('viewBox','0 0 1000 720');route.setAttribute('preserveAspectRatio','none');route.setAttribute('aria-hidden','true');
  route.innerHTML='<defs><linearGradient id="tradeRouteGlow" x1="0" y1="1" x2="1" y2="0"><stop offset="0" stop-color="#c39b65" stop-opacity=".08"/><stop offset=".52" stop-color="#ecd0a1" stop-opacity=".92"/><stop offset="1" stop-color="#78b5b4" stop-opacity=".18"/></linearGradient></defs><path class="trade-route-base" d="M80 505 C220 390 255 290 420 310 S675 430 910 160"/><path class="trade-route-glow" d="M80 505 C220 390 255 290 420 310 S675 430 910 160"/><circle cx="80" cy="505" r="5"/><circle cx="420" cy="310" r="5"/><circle cx="910" cy="160" r="5"/>';
  world.append(orbit,orbitB,route);
  (ch.tradeImages||[]).forEach((item,i)=>{
    const button=document.createElement('button');button.type='button';
    button.className=`trade-object trade-object-${item.id}`;button.dataset.tradeObject=item.id;button.dataset.tradePanels=item.panel||'';
    button.setAttribute('aria-label',`Selectează imaginea ${item.label} pentru a afișa secțiunea relevantă`);
    const frame=document.createElement('span');frame.className='trade-object-frame';
    const img=document.createElement('img');img.src=item.src;img.alt=item.alt||'';img.loading='eager';img.decoding='async';img.draggable=false;
    img.addEventListener('error',()=>{button.classList.add('is-unavailable');img.remove();});
    const gloss=document.createElement('span');gloss.className='trade-object-gloss';gloss.setAttribute('aria-hidden','true');
    const label=document.createElement('span');label.className='trade-object-label';label.textContent=item.label||`IMAGINE ${String(i+1).padStart(2,'0')}`;
    const number=document.createElement('span');number.className='trade-object-number';number.textContent=String(i+1).padStart(2,'0');
    frame.append(img,gloss);button.append(frame,label,number);world.append(button);
  });
  const sceneReadout=document.createElement('div');sceneReadout.className='trade-scene-readout';
  sceneReadout.innerHTML='<span>STRAT 3D</span><i></i><span>SELECTEAZĂ O IMAGINE</span>';
  scene.append(sceneHud,world,sceneReadout);

  const consolePanel=document.createElement('article');consolePanel.className='trade-console';
  const consoleTop=document.createElement('div');consoleTop.className='trade-console-top';
  consoleTop.innerHTML='<span><i></i> DOSAR COMERCIAL</span><small>06 / PONTUS</small>';
  const tabs=document.createElement('div');tabs.className='trade-tabs';tabs.setAttribute('role','tablist');tabs.setAttribute('aria-label','Secțiunile comerțului genovez și venețian');
  const panelHost=document.createElement('div');panelHost.className='trade-panel-host';
  (ch.tradePanels||[]).forEach((item,i)=>{
    const tab=document.createElement('button');tab.type='button';tab.className='trade-tab';tab.dataset.tradeTab=item.id;
    tab.setAttribute('role','tab');tab.setAttribute('aria-selected',String(i===0));tab.setAttribute('aria-controls',`trade-panel-${item.id}`);tab.id=`trade-tab-${item.id}`;
    const num=document.createElement('span');num.textContent=`0${i+1}`;
    const text=document.createElement('strong');text.textContent=item.id==='centres'?'CENTRE':item.id==='goods'?'MĂRFURI':'RIVALITATE';
    const arrow=document.createElement('i');arrow.textContent='↗';
    tab.append(num,text,arrow);tabs.append(tab);

    const panel=document.createElement('section');panel.className='trade-copy-panel';panel.dataset.tradePanel=item.id;panel.id=`trade-panel-${item.id}`;
    panel.setAttribute('role','tabpanel');panel.setAttribute('aria-labelledby',tab.id);panel.tabIndex=0;panel.hidden=i!==0;
    const panelIndex=document.createElement('div');panelIndex.className='trade-panel-index';panelIndex.textContent=`DOSAR 0${i+1} / 03`;
    const heading=document.createElement('h3');heading.textContent=item.heading;
    const list=document.createElement('ul');list.className='trade-copy-list';
    (item.items||[]).forEach(entry=>{
      const li=document.createElement('li');if(entry.emphasis)li.classList.add('is-emphasis');
      if(entry.lead){const lead=document.createElement('strong');lead.textContent=entry.lead;li.append(lead);}
      const copy=document.createElement('span');copy.textContent=entry.text||'';li.append(copy);list.append(li);
    });
    panel.append(panelIndex,heading,list);panelHost.append(panel);
  });
  const consoleFoot=document.createElement('div');consoleFoot.className='trade-console-foot';
  consoleFoot.innerHTML='<span>SELECTEAZĂ UN REPER VIZUAL SAU O SECȚIUNE</span><i></i>';
  consolePanel.append(consoleTop,tabs,panelHost,consoleFoot);
  experience.append(scene,consolePanel);section.append(experience);
}

function initAncientColonies(){
  const root=$('[data-ancient-explorer]');if(!root)return;
  const places=['histria','tomis','callatis'];
  const buttons=$$('[data-ancient-place]',root);
  const readout=$('[data-ancient-readout]',root);
  const activate=id=>{
    if(!places.includes(id))return;
    buttons.forEach(button=>{
      const active=button.dataset.ancientPlace===id;
      button.classList.toggle('is-active',active);
      button.setAttribute('aria-pressed',String(active));
    });
    $$('[data-ancient-highlight]',root.parentElement).forEach(item=>item.classList.toggle('is-focus',item.dataset.ancientHighlight===id));
    if(readout)readout.textContent=id.charAt(0).toUpperCase()+id.slice(1);
    root.dataset.activeColony=id;
  };
  buttons.forEach(button=>button.addEventListener('click',()=>activate(button.dataset.ancientPlace)));
  activate('histria');
}

function initBlackSeaStrategy(){
  const roots=$$('.blacksea-strategy-section');
  if(!roots.length)return;
  roots.forEach(root=>{
    const screen=root.querySelector('[data-blacksea-screen]');
    const steps=$$('[data-blacksea-step]',root);
    const readout=root.querySelector('[data-blacksea-readout]');
    const activeLabel=root.querySelector('[data-blacksea-active-label]');
    const progressItems=$$('[data-blacksea-progress]',root);
    if(!screen||!steps.length)return;
    const panelData=chapters.find(item=>item.layout==='blacksea-strategy-scroll')?.blackSeaPanels||[];
    const titles=new Map(panelData.map(item=>[item.id,item.heading]));
    let activeId=null;
    let raf=0;
    const activate=id=>{
      if(!id||id===activeId&&screen.dataset.activeStep===id)return;
      activeId=id;screen.dataset.activeStep=id;
      const index=steps.findIndex(step=>step.dataset.blackseaStep===id);
      if(readout)readout.textContent=`${String(Math.max(0,index)+1).padStart(2,'0')} / ${String(steps.length).padStart(2,'0')}`;
      if(activeLabel)activeLabel.textContent=titles.get(id)||'';
      progressItems.forEach(item=>item.classList.toggle('is-active',item.dataset.blackseaProgress===id));
      steps.forEach(step=>step.classList.toggle('is-current',step.dataset.blackseaStep===id));
      if(id!=='resources'){
        window.PONTUS_ADONIS_FACT_INDEX=0;
        window.PONTUS_SET_ADONIS_FACT?.(0);
      }
    };
    const measure=()=>{
      raf=0;
      const center=innerHeight*.52;
      let nearest=null,nearestDistance=Infinity;
      steps.forEach(step=>{
        const rect=step.getBoundingClientRect();
        const distance=Math.abs((rect.top+rect.bottom)/2-center);
        if(rect.bottom>0&&rect.top<innerHeight&&distance<nearestDistance){nearest=step;nearestDistance=distance;}
      });
      if(nearest){
        activate(nearest.dataset.blackseaStep);
        if(nearest.dataset.blackseaStep==='resources'){
          const facts=$$('[data-blacksea-fact-index]',nearest);let chosen=0,chosenDistance=Infinity;
          facts.forEach(fact=>{const r=fact.getBoundingClientRect();const distance=Math.abs((r.top+r.bottom)/2-center);if(r.bottom>0&&r.top<innerHeight&&distance<chosenDistance){chosenDistance=distance;chosen=Number(fact.dataset.blackseaFactIndex)||0;}});
          window.PONTUS_ADONIS_FACT_INDEX=chosen;
          window.PONTUS_SET_ADONIS_FACT?.(chosen);
          const labels=['RESURSE ENERGETICE ȘI PISCICOLE','ECOSISTEM UNIC ȘI VULNERABIL','NAVIGAȚIE ȘI COOPERARE REGIONALĂ'];
          const sceneNotes=['MODEL 3D ILUSTRATIV · PLATFORMĂ OFFSHORE ȘI RESURSE PONTICE','VIZUALIZARE ILUSTRATIVĂ · HABITAT SUBMARIN ȘI EUTROFIZARE','SCHEMĂ ILUSTRATIVĂ · NAVIGAȚIE CIVILĂ ȘI COOPERARE'];
          if(activeLabel)activeLabel.textContent=labels[chosen]||titles.get('resources')||'';
          const sceneNote=root.querySelector('[data-blacksea-scene-note]');
          if(sceneNote)sceneNote.textContent=sceneNotes[chosen]||sceneNotes[0];
        }
      }
    };
    const schedule=()=>{if(!raf)raf=requestAnimationFrame(measure);};
    addEventListener('scroll',schedule,{passive:true});
    addEventListener('resize',schedule,{passive:true});
    if('ResizeObserver' in window){
      const resizeObserver=new ResizeObserver(schedule);
      resizeObserver.observe(root);steps.forEach(step=>resizeObserver.observe(step));
    }
    steps.forEach((step,index)=>{
      step.classList.toggle('is-current',index===0);
      step.setAttribute('aria-label',`Secțiunea ${index+1}: ${titles.get(step.dataset.blackseaStep)||''}`);
    });
    activate(steps[0].dataset.blackseaStep);measure();
  });
}

function initPonticNetwork(){
  const root=$('[data-pontic-atlas]');if(!root)return;
  const chapter=chapters.find(item=>item.layout==='pontic-network');
  const layers=chapter?.network?.layers||[];const nodes=chapter?.network?.nodes||[];
  if(!layers.length||!nodes.length)return;
  const layerButtons=$$('[data-pontic-layer]',root),nodeButtons=$$('[data-pontic-node]',root);
  const status=$('[data-pontic-status]',root),kicker=$('[data-pontic-kicker]',root),title=$('[data-pontic-title]',root),copy=$('[data-pontic-copy]',root),kind=$('[data-pontic-kind]',root),period=$('[data-pontic-period]',root);
  let activeLayer=layers[0],activeNode=null;
  const renderLayer=layer=>{
    activeLayer=layer;activeNode=null;
    layerButtons.forEach(button=>{const active=button.dataset.ponticLayer===layer.id;button.classList.toggle('is-active',active);button.setAttribute('aria-pressed',String(active));});
    nodeButtons.forEach(button=>{const related=layer.nodeIds.includes(button.dataset.ponticNode);button.classList.toggle('is-related',related);button.classList.remove('is-selected');button.setAttribute('aria-pressed','false');});
    $$('.pontic-route',root).forEach(path=>path.classList.toggle('is-visible',path.dataset.layer===layer.id));
    const index=layers.findIndex(item=>item.id===layer.id)+1;
    status.textContent=`STRAT ${String(index).padStart(2,'0')} / 0${layers.length}`;
    kicker.textContent=layer.tag;title.textContent=layer.title;copy.textContent=layer.summary;
    kind.textContent='REȚEA TEMATICĂ';period.textContent='Selectează un reper pentru detalii';
  };
  const renderNode=node=>{
    activeNode=node;
    nodeButtons.forEach(button=>{const selected=button.dataset.ponticNode===node.id;button.classList.toggle('is-selected',selected);button.setAttribute('aria-pressed',String(selected));});
    kicker.textContent=node.kind;title.textContent=node.label;copy.textContent=node.detail;kind.textContent='REPER ISTORIC';period.textContent=node.period||'';
  };
  layerButtons.forEach(button=>button.addEventListener('click',()=>{
    const layer=layers.find(item=>item.id===button.dataset.ponticLayer);if(layer)renderLayer(layer);
  }));
  nodeButtons.forEach(button=>button.addEventListener('click',()=>{
    const node=nodes.find(item=>item.id===button.dataset.ponticNode);if(node)renderNode(node);
  }));
  renderLayer(layers[0]);
  const initial=nodes.find(item=>item.id===layers[0].focusNode);if(initial)renderNode(initial);
}


// Immersive archive for Bratianu's works: four floating source images reveal
// their associated documentary text as layered, accessible folios.
function renderBratianuWorksChapter(section,ch){
  section.classList.add('bratianu-works-section');
  const header=document.createElement('header');header.className='works-heading reveal';
  const index=document.createElement('div');index.className='section-index';index.innerHTML='<span>02</span><i></i><span>OPERA ȘI CERCETARE</span>';
  const titleBlock=document.createElement('div');titleBlock.className='works-title-block';
  const eyebrow=document.createElement('p');eyebrow.className='eyebrow';eyebrow.textContent='ARHIVA OPEREI · GHEORGHE I. BRĂTIANU';
  const title=document.createElement('h2');title.className='section-title';title.textContent=ch.title;
  const byline=document.createElement('p');byline.className='works-author';byline.textContent=`CONTRIBUȚIE · ${ch.author||'ECHIPA PROIECTULUI'}`;
  titleBlock.append(eyebrow,title,byline);header.append(index,titleBlock);section.append(header);

  const experience=document.createElement('div');experience.className='works-experience reveal';
  const stage=document.createElement('div');stage.className='works-stage';stage.dataset.worksStage='';
  stage.setAttribute('aria-label','Arhivă tridimensională interactivă a operelor lui Gheorghe I. Brătianu');
  const stageGrid=document.createElement('div');stageGrid.className='works-stage-grid';
  const stageAura=document.createElement('div');stageAura.className='works-stage-aura';stageAura.setAttribute('aria-hidden','true');
  const stageOrbit=document.createElement('div');stageOrbit.className='works-stage-orbit';stageOrbit.setAttribute('aria-hidden','true');
  stageGrid.append(stageAura,stageOrbit);
  (ch.worksImages||[]).forEach((item,i)=>{
    const button=document.createElement('button');button.type='button';button.className=`works-artifact works-artifact-${item.id}`;
    button.dataset.worksArtifact=item.id;button.setAttribute('aria-label',`Deschide dosarul: ${item.label}`);
    button.setAttribute('aria-pressed',String(i===0));
    const frame=document.createElement('span');frame.className='works-artifact-frame';
    const img=document.createElement('img');img.src=item.src;img.alt=item.alt||'';img.loading='eager';img.decoding='async';img.draggable=false;
    img.addEventListener('error',()=>{button.classList.add('is-unavailable');img.remove();});
    const sheen=document.createElement('span');sheen.className='works-artifact-sheen';sheen.setAttribute('aria-hidden','true');
    const caption=document.createElement('span');caption.className='works-artifact-caption';caption.textContent=item.label;
    const number=document.createElement('small');number.className='works-artifact-number';number.textContent=`0${i+1}`;
    frame.append(img,sheen);button.append(frame,caption,number);stageGrid.append(button);
  });
  const stageFoot=document.createElement('div');stageFoot.className='works-stage-foot';
  stageFoot.innerHTML='<span>COLECȚIE DOCUMENTARĂ</span><i></i><span>04 OBIECTE · 04 DOSARE</span>';
  stage.append(stageGrid,stageFoot);

  const folio=document.createElement('article');folio.className='works-folio';folio.id='works-folio';folio.setAttribute('role','tabpanel');folio.setAttribute('aria-live','polite');
  const folioTop=document.createElement('div');folioTop.className='works-folio-top';
  folioTop.innerHTML='<span><i></i> FIȘĂ DE CERCETARE</span><small data-works-count>01 / 04</small>';
  const folioKicker=document.createElement('p');folioKicker.className='works-folio-kicker';folioKicker.dataset.worksKicker='';
  const folioTitle=document.createElement('h3');folioTitle.dataset.worksTitle='';
  const folioCopy=document.createElement('div');folioCopy.className='works-folio-copy';folioCopy.dataset.worksCopy='';
  const folioBottom=document.createElement('div');folioBottom.className='works-folio-bottom';
  folioBottom.innerHTML='<span>GHEORGHE I. BRĂTIANU</span><span>PONTUS / ARHIVĂ</span>';
  folio.append(folioTop,folioKicker,folioTitle,folioCopy,folioBottom);
  experience.append(stage,folio);

  const tabs=document.createElement('nav');tabs.className='works-index';tabs.setAttribute('role','tablist');tabs.setAttribute('aria-label','Alege o lucrare sau direcție de cercetare');
  (ch.worksPanels||[]).forEach((panel,i)=>{
    const tab=document.createElement('button');tab.type='button';tab.className='works-index-tab';tab.dataset.worksTab=panel.id;
    tab.id=`works-tab-${panel.id}`;tab.setAttribute('role','tab');tab.setAttribute('aria-selected',String(i===0));tab.setAttribute('aria-controls','works-folio');tab.tabIndex=i===0?0:-1;
    const num=document.createElement('span');num.textContent=`0${i+1}`;
    const label=document.createElement('strong');label.textContent=panel.heading;
    const arrow=document.createElement('i');arrow.textContent='↗';
    tab.append(num,label,arrow);tabs.append(tab);
  });
  experience.append(tabs);section.append(experience);
}

// Chapter index and extensible contributor sections. Teammates only edit data.js.
function renderOttomanChapter(section,ch){
  section.classList.add('contributed-ottoman');

  const header=document.createElement('header');
  header.className='ottoman-heading';
  const index=document.createElement('div');
  index.className='section-index reveal';
  index.innerHTML='<span>07</span><i></i><span>GEOPOLITICĂ</span>';
  const titleBlock=document.createElement('div');
  titleBlock.className='ottoman-title-block reveal';
  const eyebrow=document.createElement('p');
  eyebrow.className='eyebrow';
  eyebrow.textContent='1461 — 1484';
  const title=document.createElement('h2');
  title.className='section-title';
  title.textContent=ch.title;
  const byline=document.createElement('p');
  byline.className='ottoman-author-line';
  byline.textContent=`CONTRIBUȚIE · ${ch.author||'ECHIPA PROIECTULUI'}`;
  titleBlock.append(eyebrow,title,byline);
  const ornament=document.createElement('div');
  ornament.className='ottoman-heading-mark';
  ornament.setAttribute('aria-hidden','true');
  ornament.innerHTML='<span></span><i></i><span></span>';
  header.append(index,titleBlock,ornament);
  section.append(header);

  const events=Array.isArray(ch.events)?ch.events:[];
  const journey=document.createElement('div');
  journey.className='ottoman-time-journey';
  journey.dataset.timeJourney='';

  const sticky=document.createElement('div');
  sticky.className='ottoman-time-sticky';
  sticky.setAttribute('aria-label','Capsulă temporală interactivă. Derulează pentru a explora anii 1461, 1475 și 1484.');

  const topbar=document.createElement('div');
  topbar.className='time-journey-topbar';
  topbar.innerHTML='<span><i></i> CAPSULĂ TEMPORALĂ · CRONICĂ PONTICĂ</span><span class="time-journey-live">SCROLL PENTRU A CĂLĂTORI <b>↓</b></span>';

  const grid=document.createElement('div');
  grid.className='time-journey-grid';

  const machine=document.createElement('div');
  machine.className='time-machine-column';
  const machineHead=document.createElement('div');
  machineHead.className='time-machine-label';
  machineHead.innerHTML='<span>CHRONOS / PONTUS</span><small>EXPEDIȚIE TEMPORALĂ <i>·</i> MAREA NEAGRĂ</small>';
  const viewport=document.createElement('div');
  viewport.className='time-machine-viewport';
  viewport.innerHTML=`
    <svg class="time-machine-route" viewBox="0 0 520 360" preserveAspectRatio="none" aria-hidden="true">
      <defs><linearGradient id="timeRouteGradient" x1="0" y1="1" x2="1" y2="0"><stop offset="0" stop-color="#8f704b" stop-opacity=".08"/><stop offset=".5" stop-color="#d3b17a" stop-opacity=".9"/><stop offset="1" stop-color="#8f704b" stop-opacity=".22"/></linearGradient><filter id="timeRouteGlow"><feGaussianBlur stdDeviation="4" result="blur"/><feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge></filter></defs>
      <path class="time-route-base" d="M30 294 C115 228 106 121 220 160 S375 255 485 54"/>
      <path class="time-route-progress" data-time-route-progress d="M30 294 C115 228 106 121 220 160 S375 255 485 54"/>
      <circle class="time-route-node" cx="30" cy="294" r="5"/><circle class="time-route-node" cx="220" cy="160" r="5"/><circle class="time-route-node" cx="485" cy="54" r="5"/>
    </svg>
    <div class="time-machine-coordinates time-coord-a">41° 13′ N <i>·</i> BOSFOR</div>
    <div class="time-machine-coordinates time-coord-b">45° 02′ N <i>·</i> CRIMEEA</div>
    <div class="time-machine-coordinates time-coord-c">45° 21′ N <i>·</i> DUNĂRE</div>
    <div class="time-capsule-halo" aria-hidden="true"></div>
    <div class="time-capsule-anchor" data-time-capsule>
      <div class="time-capsule-float">
        <div class="time-capsule-orbit time-capsule-orbit-a"></div>
        <div class="time-capsule-orbit time-capsule-orbit-b"></div>
        <div class="time-capsule-body">
          <div class="time-capsule-end time-capsule-end-left"><i></i><b></b><em></em></div>
          <div class="time-capsule-shell"></div>
          <div class="time-capsule-glass"></div>
          <div class="time-capsule-window"><img data-capsule-image alt="Imagine istorică în capsula temporală"/><span>MEMORY CORE</span></div>
          <div class="time-capsule-rib time-capsule-rib-a"></div><div class="time-capsule-rib time-capsule-rib-b"></div>
          <div class="time-capsule-end time-capsule-end-right"><i></i><b></b><em></em></div>
          <div class="time-capsule-indicator"></div>
        </div>
      </div>
      <div class="time-capsule-shadow"></div>
    </div>
    <div class="time-machine-scanline" aria-hidden="true"></div>
    <div class="time-machine-corner time-machine-corner-tl"></div><div class="time-machine-corner time-machine-corner-br"></div>
  `;
  const machineFoot=document.createElement('div');
  machineFoot.className='time-machine-foot';
  machineFoot.innerHTML='<span><i class="time-machine-status-dot"></i> TRASEU ISTORIC ÎNCĂRCAT</span><span data-time-machine-readout>COORDONATE: 41.13° N</span>';
  machine.append(machineHead,viewport,machineFoot);

  const panel=document.createElement('article');
  panel.className='time-story-panel';
  panel.setAttribute('aria-live','polite');
  panel.setAttribute('aria-atomic','true');
  const panelTop=document.createElement('div');
  panelTop.className='time-story-top';
  panelTop.innerHTML='<span data-time-stage-label>ETAPA 01 / 03</span><span class="time-story-live"><i></i> ARHIVĂ ACTIVĂ</span>';
  const year=document.createElement('div');
  year.className='time-story-year';
  year.dataset.timeYear='';
  const location=document.createElement('p');
  location.className='time-story-location';
  location.dataset.timeLocation='';
  const heading=document.createElement('h3');
  heading.className='time-story-heading';
  heading.dataset.timeHeading='';
  const body=document.createElement('p');
  body.className='time-story-copy';
  body.dataset.timeCopy='';
  const media=document.createElement('div');
  media.className='time-story-media';
  const mediaLink=document.createElement('a');
  mediaLink.className='time-story-image-link';
  mediaLink.target='_blank';mediaLink.rel='noopener noreferrer';
  mediaLink.dataset.timeImageLink='';
  const image=document.createElement('img');
  image.className='time-story-image';image.dataset.timeImage='';image.loading='eager';image.decoding='async';
  image.alt='';
  const imageOverlay=document.createElement('span');
  imageOverlay.className='time-story-image-overlay';imageOverlay.textContent='DESCHIDE SURSA ↗';
  mediaLink.append(image,imageOverlay);
  const imageCaption=document.createElement('div');
  imageCaption.className='time-story-image-caption';
  imageCaption.innerHTML='<span data-time-image-label></span><small data-time-image-credit></small>';
  media.append(mediaLink,imageCaption);
  const thumbnails=document.createElement('div');
  thumbnails.className='time-story-thumbnails';
  thumbnails.setAttribute('aria-label','Imagini ale evenimentului');
  const panelBottom=document.createElement('div');
  panelBottom.className='time-story-bottom';
  panelBottom.innerHTML='<span>CRONICĂ PONTICĂ <i>·</i> SECOLUL XV</span><span data-time-progress-label>00 — 33%</span>';
  panel.append(panelTop,year,location,heading,body,media,thumbnails,panelBottom);

  grid.append(machine,panel);
  const nav=document.createElement('div');
  nav.className='time-journey-controls';
  nav.setAttribute('aria-label','Selectează o etapă istorică');
  events.forEach((event,i)=>{
    const button=document.createElement('button');
    button.type='button';button.className='time-journey-stop';button.dataset.timeJump=String(i);
    button.setAttribute('aria-label',`Mergi la ${event.year}`);
    const num=document.createElement('span');num.textContent=`0${i+1}`;
    const label=document.createElement('strong');label.textContent=event.year;
    const line=document.createElement('i');
    button.append(num,label,line);nav.append(button);
  });
  const progress=document.createElement('div');
  progress.className='time-journey-progress';
  progress.innerHTML='<i><b data-time-progress></b></i><span>ÎNAINTEAZĂ PRIN TIMP</span><span data-time-progress-value>00%</span>';
  sticky.append(topbar,grid,nav,progress);

  const track=document.createElement('div');
  track.className='time-journey-track';
  track.setAttribute('aria-hidden','true');
  events.forEach((event,i)=>{
    const stop=document.createElement('div');
    stop.className='time-journey-track-stop';stop.dataset.timeStop=String(i);
    stop.innerHTML=`<span>${String(event.year)}</span>`;
    track.append(stop);
  });
  journey.append(sticky,track);
  section.append(journey);

  const impacts=document.createElement('div');
  impacts.className='ottoman-impacts';
  (ch.impacts||[]).forEach((impact,index)=>{
    const card=document.createElement('article');
    card.className='ottoman-impact reveal';
    const number=document.createElement('span');number.className='ottoman-impact-number';number.textContent=`0${index+1}`;
    const label=document.createElement('h3');label.textContent=impact.label;
    const copy=document.createElement('p');copy.textContent=impact.body;
    const line=document.createElement('i');line.className='ottoman-impact-line';
    card.append(number,label,copy,line);impacts.append(card);
  });
  section.append(impacts);
}


// Chapter 08 — a scroll-driven 3D corridor. The reader is the camera:
// six document panels are placed on a shared Z-axis and approached in sequence.
// Rendering is CSS 3D (not another WebGL renderer) to keep the experience stable.
function renderSpaceConclusionChapter(section,ch){
  section.classList.add('space-conclusion-section');

  const header=document.createElement('header');header.className='space-conclusion-heading reveal';
  const index=document.createElement('div');index.className='space-conclusion-index';
  const number=document.createElement('span');number.textContent=ch.id;
  const rule=document.createElement('i');
  const category=document.createElement('small');category.textContent=ch.category;
  index.append(number,rule,category);
  const titleBlock=document.createElement('div');titleBlock.className='space-conclusion-title-block';
  const eyebrow=document.createElement('p');eyebrow.className='space-conclusion-eyebrow';eyebrow.textContent='PONTUS / CĂLĂTORIE DE SINTEZĂ';
  const title=document.createElement('h2');title.textContent=ch.title;
  const author=document.createElement('p');author.className='space-conclusion-author';author.textContent=`CONTRIBUȚIE · ${ch.author||'ECHIPA PROIECTULUI'}`;
  titleBlock.append(eyebrow,title,author);header.append(index,titleBlock);section.append(header);

  const stages=Array.isArray(ch.journeyStages)?ch.journeyStages:[];
  const track=document.createElement('div');track.className='pontus-final-track';track.dataset.spaceVoyage='';
  track.style.setProperty('--voyage-count',String(stages.length));
  track.style.height=`${Math.max(stages.length,1)*100}svh`;
  const scene=document.createElement('div');scene.className='pontus-final-sticky';scene.dataset.voyageScene='';
  scene.setAttribute('role','region');scene.setAttribute('aria-label','Călătorie 3D prin concluziile cercetării');

  const telemetry=document.createElement('div');telemetry.className='pontus-final-telemetry';
  telemetry.innerHTML='<span><i></i> PONTUS · ATLASUL MĂRII NEGRE</span><span>EXPOZIȚIE DOCUMENTARĂ / 3D</span>';

  // Every conclusion has a source image in data.js. Render that source here instead
  // of leaving a blank media slot while the generic background scene keeps moving.
  const media=document.createElement('figure');media.className='pontus-final-media';media.dataset.voyageMedia='';
  const mediaFrame=document.createElement('div');mediaFrame.className='pontus-final-media-frame';
  const mediaImage=document.createElement('img');mediaImage.dataset.voyageImage='';mediaImage.alt=stages[0]?.imageAlt||stages[0]?.heading||'Document vizual';
  mediaImage.loading='eager';mediaImage.decoding='async';mediaImage.draggable=false;
  if(stages[0]?.image)mediaImage.src=stages[0].image;
  const mediaOverlay=document.createElement('div');mediaOverlay.className='pontus-final-media-overlay';
  const mediaLabel=document.createElement('span');mediaLabel.className='pontus-final-media-label';mediaLabel.dataset.voyageMediaLabel='';mediaLabel.textContent=stages[0]?.visualLabel||'';
  const mediaCount=document.createElement('small');mediaCount.className='pontus-final-media-count';mediaCount.dataset.voyageMediaCount='';mediaCount.textContent=`01 / ${String(stages.length).padStart(2,'0')}`;
  mediaOverlay.append(mediaLabel,mediaCount);mediaFrame.append(mediaImage,mediaOverlay);
  const mediaReference=document.createElement('div');mediaReference.className='pontus-final-media-reference';mediaReference.dataset.voyageReferenceWrap='';mediaReference.hidden=true;
  const mediaReferenceImage=document.createElement('img');mediaReferenceImage.dataset.voyageReference='';mediaReferenceImage.alt=stages[0]?.referenceImageAlt||'';mediaReferenceImage.loading='eager';mediaReferenceImage.decoding='async';
  const mediaReferenceLabel=document.createElement('span');mediaReferenceLabel.textContent='DOCUMENT DE REFERINȚĂ';
  mediaReference.append(mediaReferenceImage,mediaReferenceLabel);media.append(mediaFrame,mediaReference);
  const mediaNote=document.createElement('figcaption');mediaNote.className='pontus-final-media-note';mediaNote.dataset.voyageMediaNote='';mediaNote.textContent=stages[0]?.visualCaption||stages[0]?.imageAlt||'';media.append(mediaNote);
  if(stages[0]?.referenceImage){mediaReferenceImage.src=stages[0].referenceImage;mediaReference.hidden=false;}

  const copy=document.createElement('article');copy.className='pontus-final-copy';copy.setAttribute('aria-live','polite');
  const copyTop=document.createElement('div');copyTop.className='pontus-final-copy-top';
  const count=document.createElement('small');count.dataset.voyageIndex='01 / 06';count.textContent=`01 / ${String(stages.length).padStart(2,'0')}`;
  const label=document.createElement('span');label.dataset.voyageLabel='';label.textContent=stages[0]?.visualLabel||'';copyTop.append(count,label);
  const kicker=document.createElement('div');kicker.className='pontus-final-copy-kicker';kicker.innerHTML='<i></i> DOSAR DE SINTEZĂ';
  const heading=document.createElement('h3');heading.dataset.voyageHeading='';heading.textContent=stages[0]?.heading||'';
  const body=document.createElement('p');body.dataset.voyageBody='';body.textContent=stages[0]?.body||'';
  const copyFoot=document.createElement('div');copyFoot.className='pontus-final-copy-foot';
  copyFoot.innerHTML='<span>SPAȚIUL PONTIC · ISTORIE ÎN MIȘCARE</span><i></i>';
  copy.append(copyTop,kicker,heading,body,copyFoot);

  const nav=document.createElement('nav');nav.className='pontus-final-nav';nav.setAttribute('aria-label','Navighează între concluzii');
  stages.forEach((stage,i)=>{
    const button=document.createElement('button');button.type='button';button.dataset.voyageJump=String(i);
    button.setAttribute('aria-label',`Mergi la concluzia ${i+1}: ${stage.heading.replace(/:$/,'')}`);
    button.setAttribute('aria-current',i===0?'step':'false');
    const number=document.createElement('span');number.textContent=String(i+1).padStart(2,'0');
    const dot=document.createElement('i');button.append(number,dot);nav.append(button);
  });
  const meter=document.createElement('div');meter.className='pontus-final-meter';meter.setAttribute('aria-hidden','true');
  const fill=document.createElement('i');fill.dataset.voyageMeter='';meter.append(fill);
  const hint=document.createElement('span');hint.className='pontus-final-hint';hint.textContent='DERULEAZĂ PENTRU A CONTINUA CĂLĂTORIA';
  scene.append(telemetry,media,copy,nav,meter,hint);

  const triggers=document.createElement('div');triggers.className='pontus-final-steps';
  stages.forEach((stage,i)=>{
    const trigger=document.createElement('div');trigger.className='pontus-final-step';
    trigger.dataset.voyageStep=String(i);trigger.setAttribute('aria-hidden','true');
    triggers.append(trigger);
  });
  track.append(scene,triggers);section.append(track);
  const endNote=document.createElement('div');endNote.className='space-voyage-end reveal';
  endNote.innerHTML='<span>FINAL / 06</span><i></i><small>PONTUS · SPAȚIUL ROMÂNESC ȘI MAREA NEAGRĂ</small>';
  section.append(endNote);
}

function initChapters(){
  const grid=$('#team-grid');
  const root=$('#contribution-sections');
  chapters.forEach(ch=>{
    const isReady=ch.status==='published';
    const card=document.createElement(isReady?'a':'article');
    card.className=`team-card ${isReady?'team-card-active':''} reveal`;
    card.innerHTML=`<span>${ch.id}</span><b></b><small>${isReady?'CAPITOL PUBLICAT':'ÎN PREGĂTIRE'}</small><i>${isReady?'↗':ch.id}</i>`;
    card.querySelector('b').textContent=ch.title;
    if(isReady)card.href=ch.href||`#chapter-${ch.id}`;
    grid.append(card);
    if(!isReady)return;

    const section=document.createElement('section');
    section.className='contributed story-section';
    section.id=`chapter-${ch.id}`;
    section.dataset.world=ch.world||'map';

    if(ch.layout==='space-conclusion-voyage'){
      renderSpaceConclusionChapter(section,ch);
      root.append(section);
      return;
    }
    if(ch.layout==='ancient-colonies-map'){
      renderAncientColoniesChapter(section,ch);
      root.append(section);
      return;
    }
    if(ch.layout==='blacksea-strategy-scroll'){
      renderBlackSeaStrategyChapter(section,ch);
      root.append(section);
      return;
    }
    if(ch.layout==='pontic-network'){
      renderPonticChapter(section,ch);
      root.append(section);
      return;
    }
    if(ch.layout==='trade-immersive'){
      renderTradeImmersiveChapter(section,ch);
      root.append(section);
      return;
    }
    if(ch.layout==='bratianu-works-immersive'){
      renderBratianuWorksChapter(section,ch);
      root.append(section);
      return;
    }
    if(ch.layout==='ottoman-chronicle'){
      renderOttomanChapter(section,ch);
      root.append(section);
      return;
    }
    if(!Array.isArray(ch.sections)||!ch.sections.length)return;

    const heading=document.createElement('div');
    heading.className='contributed-head reveal';
    heading.innerHTML=`<div class="section-index"><span>${ch.id}</span><i></i><span>${ch.category}</span></div><p class="eyebrow">CAPITOL DOCUMENTAR</p><h2 class="section-title"></h2>`;
    heading.querySelector('.section-title').textContent=ch.title;
    section.append(heading);
    if(ch.lead){const lead=document.createElement('p');lead.className='contributed-lead reveal';lead.textContent=ch.lead;section.append(lead);}
    const content=document.createElement('div');content.className='contributed-grid';
    ch.sections.forEach((part,i)=>{
      const article=document.createElement('article');article.className='contributed-part reveal';
      const no=document.createElement('span');no.className='contributed-no';no.textContent=String(i+1).padStart(2,'0');
      const h=document.createElement('h3');h.textContent=part.heading||`Secțiunea ${i+1}`;
      const p=document.createElement('p');p.textContent=part.body||'';
      article.append(no,h,p);
      const imageItems=Array.isArray(part.images)&&part.images.length?part.images:(part.image?[{src:part.image,alt:part.imageAlt,caption:part.imageCaption}]:[]);
      if(imageItems.length){const gallery=document.createElement('div');gallery.className=`contributed-images${imageItems.length>1?' contributed-images-pair':''}`;imageItems.forEach((item,imageIndex)=>{const figure=document.createElement('figure');figure.className='contributed-image';const img=document.createElement('img');img.src=item.src;img.alt=item.alt||part.heading||ch.title;img.loading='lazy';img.decoding='async';img.addEventListener('error',()=>{figure.classList.add('image-unavailable');img.remove();});figure.append(img);const captionText=item.caption||(imageItems.length===1?part.imageCaption:'');if(captionText){const caption=document.createElement('figcaption');caption.textContent=captionText;figure.append(caption);}gallery.append(figure);});article.append(gallery);}
      if(part.source){const source=document.createElement('small');source.className='contributed-source';if(part.sourceUrl){const link=document.createElement('a');link.href=part.sourceUrl;link.target='_blank';link.rel='noopener noreferrer';link.textContent=`SURSĂ: ${part.source} ↗`;source.append(link);}else source.textContent=`SURSĂ: ${part.source}`;article.append(source);}
      content.append(article);
    });
    section.append(content);root.append(section);
  });
}


// A pinned, scroll-driven time capsule for the Ottoman chapter. One RAF owns all
// progress/transform updates; image panels only change when the active year changes.

function initTradeImmersive(){
  const root=$('#chapter-06');if(!root)return;
  const scene=$('[data-trade-scene]',root);
  const tabs=$$('[data-trade-tab]',root);
  const panels=$$('[data-trade-panel]',root);
  const objects=$$('[data-trade-object]',root);
  if(!tabs.length||!panels.length||!objects.length)return;
  const activate=id=>{
    const target=panels.find(panel=>panel.dataset.tradePanel===id);if(!target)return;
    tabs.forEach(tab=>{
      const active=tab.dataset.tradeTab===id;
      tab.classList.toggle('is-active',active);tab.setAttribute('aria-selected',String(active));
      tab.tabIndex=active?0:-1;
    });
    panels.forEach(panel=>{const active=panel===target;panel.hidden=!active;panel.classList.toggle('is-active',active);});
    objects.forEach(object=>{
      const related=(object.dataset.tradePanels||'').split(/\s+/).includes(id);
      object.classList.toggle('is-spotlit',related);object.classList.toggle('is-muted',!related);
    });
    if(scene)scene.dataset.activePanel=id;
  };
  tabs.forEach((tab,index)=>{
    tab.addEventListener('click',()=>activate(tab.dataset.tradeTab));
    tab.addEventListener('keydown',event=>{
      const direction=event.key==='ArrowRight'?1:event.key==='ArrowLeft'?-1:0;
      if(!direction)return;
      event.preventDefault();
      const next=tabs[(index+direction+tabs.length)%tabs.length];
      next.focus();activate(next.dataset.tradeTab);
    });
  });
  objects.forEach(object=>object.addEventListener('click',()=>activate((object.dataset.tradePanels||'centres').split(/\s+/)[0])));
  if(scene&&!reducedMotion&&!coarsePointer){
    let raf=0;
    scene.addEventListener('pointermove',event=>{
      const rect=scene.getBoundingClientRect();
      const nx=((event.clientX-rect.left)/rect.width-.5)*2;
      const ny=((event.clientY-rect.top)/rect.height-.5)*2;
      if(raf)return;
      raf=requestAnimationFrame(()=>{
        scene.style.setProperty('--trade-tilt-x',`${(-ny*3.2).toFixed(2)}deg`);
        scene.style.setProperty('--trade-tilt-y',`${(nx*4.1).toFixed(2)}deg`);
        raf=0;
      });
    },{passive:true});
    scene.addEventListener('pointerleave',()=>{
      if(raf){cancelAnimationFrame(raf);raf=0;}
      scene.style.setProperty('--trade-tilt-x','0deg');scene.style.setProperty('--trade-tilt-y','0deg');
    },{passive:true});
  }
  activate(tabs[0].dataset.tradeTab);
}


function initBratianuWorks(){
  const root=$('#chapter-02');if(!root)return;
  const tabs=$$('[data-works-tab]',root),artifacts=$$('[data-works-artifact]',root);
  const folio=root.querySelector('.works-folio');
  const kicker=$('[data-works-kicker]',root),title=$('[data-works-title]',root),copy=$('[data-works-copy]',root),count=$('[data-works-count]',root);
  const chapter=chapters.find(item=>item.layout==='bratianu-works-immersive');
  const panels=chapter?.worksPanels||[];
  if(!tabs.length||!artifacts.length||!folio||!panels.length)return;
  const activate=id=>{
    const panel=panels.find(item=>item.id===id);
    if(!panel){storyWorld?.setWorksFocus?.(id);return;}
    tabs.forEach((tab,index)=>{const active=tab.dataset.worksTab===id;tab.setAttribute('aria-selected',String(active));tab.tabIndex=active?0:-1;tab.classList.toggle('is-active',active);});
    artifacts.forEach((item,index)=>{const active=item.dataset.worksArtifact===id;item.classList.toggle('is-active',active);item.classList.toggle('is-dimmed',!active);item.setAttribute('aria-pressed',String(active));});
    const imageIndex=(chapter.worksImages||[]).findIndex(item=>item.id===id);
    count.textContent=`${String(Math.max(0,imageIndex)+1).padStart(2,'0')} / 04`;
    kicker.textContent=panel.kicker;title.textContent=panel.heading;
    copy.replaceChildren();
    panel.paragraphs.forEach((paragraph,index)=>{
      const p=document.createElement('p');p.className='works-paragraph';p.textContent=paragraph;
      p.style.setProperty('--paragraph-index',String(index));copy.append(p);
    });
    folio.classList.remove('is-revealing');void folio.offsetWidth;folio.classList.add('is-revealing');
    root.querySelector('[data-works-stage]').dataset.activeArtifact=id;
    storyWorld?.setWorksFocus?.(id);
  };
  tabs.forEach((tab,index)=>{
    tab.addEventListener('click',()=>activate(tab.dataset.worksTab));
    tab.addEventListener('keydown',event=>{
      const dir=event.key==='ArrowRight'?1:event.key==='ArrowLeft'?-1:0;if(!dir)return;
      event.preventDefault();const next=tabs[(index+dir+tabs.length)%tabs.length];next.focus();activate(next.dataset.worksTab);
    });
  });
  artifacts.forEach(item=>item.addEventListener('click',()=>activate(item.dataset.worksArtifact)));
  const stage=root.querySelector('[data-works-stage]');
  if(stage&&!reducedMotion&&!coarsePointer){
    let raf=0;
    stage.addEventListener('pointermove',event=>{
      const rect=stage.getBoundingClientRect(),nx=(event.clientX-rect.left)/rect.width-.5,ny=(event.clientY-rect.top)/rect.height-.5;
      if(raf)return;
      raf=requestAnimationFrame(()=>{
        stage.style.setProperty('--works-tilt-x',`${(-ny*2.2).toFixed(2)}deg`);
        stage.style.setProperty('--works-tilt-y',`${(nx*2.8).toFixed(2)}deg`);raf=0;
      });
    },{passive:true});
    stage.addEventListener('pointerleave',()=>{if(raf){cancelAnimationFrame(raf);raf=0;}stage.style.setProperty('--works-tilt-x','0deg');stage.style.setProperty('--works-tilt-y','0deg');},{passive:true});
  }
  activate(tabs[0].dataset.worksTab);
}


// The supplied story models share the original PONTUS renderer and GPU context.
// They only replace the scene layer for the opening, Bratianu's works and finale;
// every original 2D section, image, control and background remains in the document.
async function initPontusStoryWorld(){
  if(!THREE||!scene||!renderer)return null;
  try{
    const module=await import('./story-world.js');
    const statusCard=$('#story-model-status');
    const statusMessage=$('[data-story-model-message]',statusCard||document);
    const statusProgress=$('[data-story-model-progress]',statusCard||document);
    let hideStatusTimer=0;
    storyWorld=module.createPontusStoryWorld({
      THREE,scene,renderer,createShip,
      adonisViewport:document.querySelector('#chapter-03 [data-blacksea-screen]'),
      coarsePointer,reducedMotion,
      onStatus:({text,percent,state})=>{
        if(!statusCard)return;
        clearTimeout(hideStatusTimer);
        statusCard.hidden=false;
        statusCard.dataset.state=state||'loading';
        if(statusMessage)statusMessage.textContent=text||'SE PREGĂTEȘTE SCENA 3D…';
        if(statusProgress){
          statusProgress.style.width=percent==null?(state==='loading'?'32%':'100%'):`${Math.max(0,Math.min(100,percent))}%`;
          statusProgress.parentElement?.classList.toggle('is-indeterminate',percent==null&&state==='loading');
        }
        if(state==='ready')hideStatusTimer=setTimeout(()=>{statusCard.hidden=true;},1900);
        else if(state==='fallback')hideStatusTimer=setTimeout(()=>{statusCard.hidden=true;},6500);
      }
    });
    window.PONTUS_STORY_3D=storyWorld;
    window.PONTUS_SET_ADONIS_FACT=index=>storyWorld?.setAdonisFact?.(index);
    storyWorld.setAdonisFact?.(window.PONTUS_ADONIS_FACT_INDEX||0);
    const activeWorksTab=$('[data-works-tab][aria-selected="true"]');
    if(activeWorksTab)storyWorld.setWorksFocus(activeWorksTab.dataset.worksTab);
    const finalChapter=$('#chapter-08');
    if(finalChapter&&'IntersectionObserver' in window){
      const finalPreloadObserver=new IntersectionObserver(entries=>{
        if(entries.some(entry=>entry.isIntersecting)){
          storyWorld?.preloadFinale?.();
          finalPreloadObserver.disconnect();
        }
      },{rootMargin:'1400px 0px'});
      finalPreloadObserver.observe(finalChapter);
    }
    if(desiredStoryMode){
      storyWorld.activate(desiredStoryMode,desiredStoryProgress);
      storyWorld.setProgress(desiredStoryProgress);
      $('.stage')?.classList.add('cinematic-mode');
    }
    return storyWorld;
  }catch(error){
    console.warn('PONTUS: scenele cinematice 3D nu au putut fi inițializate; scena originală rămâne disponibilă.',error);
    const statusCard=$('#story-model-status');
    const statusMessage=$('[data-story-model-message]',statusCard||document);
    if(statusCard&&statusMessage){statusCard.hidden=false;statusCard.dataset.state='fallback';statusMessage.textContent='SCENA CINEMATICĂ NU ESTE DISPONIBILĂ · MODELUL ORIGINAL RĂMÂNE ACTIV';setTimeout(()=>{statusCard.hidden=true;},6500);}
    return null;
  }
}

function initPontusStorySceneScroll(){
  const clamp=(value,min=0,max=1)=>Math.max(min,Math.min(max,value));
  const storyTargets=[
    {selector:'#hero',mode:'opening'},
    {selector:'#intro',mode:'opening'},
    {selector:'#bratianu',mode:'opening'},
    {selector:'#photo-essay',mode:'opening'},
    {selector:'#timeline',mode:'opening'},
    {selector:'.places',mode:'opening'},
    {selector:'#team',mode:'opening'},
    // The standalone closing card is not the six-stage documentary voyage.
    // Let the original geographic world handle it instead of forcing stage 06.
    {selector:'#chapter-01',mode:'opening'},
    {selector:'#chapter-02',mode:'works'},
    {selector:'#chapter-03',mode:'adonis'},
    {selector:'#chapter-08',mode:'final'}
  ].map(item=>({...item,node:$(item.selector)})).filter(item=>item.node);
  if(!storyTargets.length)return;

  const evaluate=()=>{
    storyScrollRaf=0;
    const focusY=innerHeight*.52;
    let selected=null,best=Infinity;
    for(const item of storyTargets){
      const rect=item.node.getBoundingClientRect();
      if(rect.top<=focusY&&rect.bottom>=focusY){
        const distance=Math.abs((rect.top+rect.bottom)*.5-focusY);
        if(distance<best){best=distance;selected=item;}
      }
    }

    if(!selected){
      desiredStoryMode='';desiredStoryProgress=0;
      if(storyWorld?.active)storyWorld.activate('');
      $('.stage')?.classList.remove('cinematic-mode');
      return;
    }

    let nextProgress=0;
    if(selected.mode==='opening'){
      const first=$('#hero'),archive=$('#chapter-02');
      const start=first?scrollY+first.getBoundingClientRect().top:scrollY;
      const end=archive?scrollY+archive.getBoundingClientRect().top:start+innerHeight;
      nextProgress=clamp((scrollY+focusY-start)/Math.max(innerHeight,end-start));
    }else if(selected.mode==='works'){
      const rect=selected.node.getBoundingClientRect();
      nextProgress=clamp((focusY-rect.top)/Math.max(innerHeight,rect.height-innerHeight));
    }else if(selected.mode==='final'){
      const track=$('[data-space-voyage]',selected.node);
      if(track){
        const rect=track.getBoundingClientRect();
        nextProgress=clamp(-rect.top/Math.max(1,track.offsetHeight-innerHeight));
      }else nextProgress=1; // Keep the completed sea voyage alive through the closing card.
    }

    desiredStoryProgress=nextProgress;
    if(desiredStoryMode!==selected.mode){
      desiredStoryMode=selected.mode;
      storyWorld?.activate?.(selected.mode,nextProgress);
      $('.stage')?.classList.add('cinematic-mode');
    }else storyWorld?.setProgress?.(nextProgress);
  };
  const schedule=()=>{if(!storyScrollRaf)storyScrollRaf=requestAnimationFrame(evaluate);};
  addEventListener('scroll',schedule,{passive:true});
  addEventListener('resize',schedule,{passive:true});
  addEventListener('pageshow',schedule,{passive:true});
  schedule();
}


function initSpaceConclusionVoyage(){
  const track=$('[data-space-voyage]');if(!track)return;
  const triggers=$$('[data-voyage-step]',track),buttons=$$('[data-voyage-jump]',track);
  const indexNode=$('[data-voyage-index]',track),labelNode=$('[data-voyage-label]',track);
  const headingNode=$('[data-voyage-heading]',track),bodyNode=$('[data-voyage-body]',track);
  const meter=$('[data-voyage-meter]',track);
  const media=$('[data-voyage-media]',track),mediaImage=$('[data-voyage-image]',track);
  const mediaLabel=$('[data-voyage-media-label]',track),mediaCount=$('[data-voyage-media-count]',track);
  const mediaNote=$('[data-voyage-media-note]',track),referenceWrap=$('[data-voyage-reference-wrap]',track);
  const referenceImage=$('[data-voyage-reference]',track);
  const stages=chapters.find(item=>item.layout==='space-conclusion-voyage')?.journeyStages||[];
  if(!triggers.length||triggers.length!==stages.length||buttons.length!==stages.length)return;
  const clamp=(value,min=0,max=1)=>Math.max(min,Math.min(max,value));
  const reduced=matchMedia('(prefers-reduced-motion: reduce)').matches;
  let active=-1,progress=0,raf=0;

  // Preload every local source once. A stage only changes after its own image is
  // decoded, so a slow disk/cache never flashes an empty image between paragraphs.
  const stageImageCache=new Map();
  const preloadStageImage=src=>{
    if(!src)return null;
    if(stageImageCache.has(src))return stageImageCache.get(src);
    const image=new Image();image.decoding='async';
    const entry={image,ready:false,failed:false,promise:null};
    entry.promise=new Promise(resolve=>{
      image.onload=()=>{entry.ready=true;resolve(true);};
      image.onerror=()=>{entry.failed=true;resolve(false);};
      image.src=src;
      if(image.complete){entry.ready=image.naturalWidth>0;entry.failed=!entry.ready;resolve(entry.ready);}
    });
    stageImageCache.set(src,entry);return entry;
  };
  stages.forEach(stage=>{preloadStageImage(stage.image);preloadStageImage(stage.referenceImage);});
  const setStageMedia=(stage,index)=>{
    if(!media||!mediaImage)return;
    const src=stage.image||'';
    const entry=preloadStageImage(src);
    media.classList.add('is-changing');media.classList.remove('is-missing');
    if(mediaLabel)mediaLabel.textContent=stage.visualLabel||`ETAPA ${index+1}`;
    if(mediaCount)mediaCount.textContent=`${String(index+1).padStart(2,'0')} / ${String(stages.length).padStart(2,'0')}`;
    if(mediaNote)mediaNote.textContent=stage.visualCaption||stage.imageAlt||stage.heading||'';
    const apply=()=>{
      if(active!==index)return;
      mediaImage.src=src;mediaImage.alt=stage.imageAlt||stage.heading||'Document vizual';
      mediaImage.style.objectFit=stage.imageFit==='contain'?'contain':'cover';
      media.classList.remove('is-changing','is-missing');
    };
    const missing=()=>{if(active===index){media.classList.remove('is-changing');media.classList.add('is-missing');}};
    if(!src){missing();}
    else if(entry?.ready){apply();}
    else if(entry?.failed){missing();}
    else if(entry){entry.promise.then(ok=>ok?apply():missing());}

    if(referenceWrap&&referenceImage){
      const reference=stage.referenceImage||'';
      referenceWrap.hidden=!reference;
      if(reference){
        const refEntry=preloadStageImage(reference);
        const applyReference=()=>{if(active===index){referenceImage.src=reference;referenceImage.alt=stage.referenceImageAlt||'Document de referință';}};
        if(refEntry?.ready)applyReference();else if(refEntry&&!refEntry.failed)refEntry.promise.then(ok=>{if(ok)applyReference();});
      }else{referenceImage.removeAttribute('src');referenceImage.alt='';}
    }
    media.dataset.imageFit=stage.imageFit==='contain'?'contain':'cover';
  };

  const setActive=next=>{
    const safe=clamp(next,0,stages.length-1);if(safe===active)return;active=safe;
    const stage=stages[safe];
    if(indexNode)indexNode.textContent=`${String(safe+1).padStart(2,'0')} / ${String(stages.length).padStart(2,'0')}`;
    if(labelNode)labelNode.textContent=stage.visualLabel||'';
    if(headingNode)headingNode.textContent=stage.heading||'';
    if(bodyNode)bodyNode.textContent=stage.body||'';
    setStageMedia(stage,safe);
    buttons.forEach((button,i)=>{const selected=i===safe;button.classList.toggle('is-active',selected);button.setAttribute('aria-current',selected?'step':'false');});
    const copy=$('.pontus-final-copy',track);
    if(copy){copy.classList.remove('is-updating');void copy.offsetWidth;copy.classList.add('is-updating');}
  };
  const update=()=>{
    raf=0;
    const rect=track.getBoundingClientRect();
    const total=Math.max(1,track.offsetHeight-innerHeight);
    progress=clamp(-rect.top/total);
    const stepFloat=progress*Math.max(0,stages.length-1);
    setActive(Math.min(stages.length-1,Math.floor(stepFloat+.12)));
    if(meter)meter.style.transform=`scaleX(${Math.max(.015,progress)})`;
    window.PONTUS_STORY_3D?.setProgress?.(progress);
  };
  const schedule=()=>{if(!raf)raf=requestAnimationFrame(update);};
  addEventListener('scroll',schedule,{passive:true});addEventListener('resize',schedule,{passive:true});
  buttons.forEach((button,i)=>button.addEventListener('click',()=>{
    const target=triggers[i];const top=scrollY+target.getBoundingClientRect().top+innerHeight*.08;
    window.scrollTo({top,behavior:reduced?'auto':'smooth'});
  }));
  schedule();
}

function initOttomanTimeTravel(){
  const root=$('[data-time-journey]');
  if(!root)return;
  const track=$('.time-journey-track',root),sticky=$('.ottoman-time-sticky',root);
  const capsule=$('[data-time-capsule]',root),capsuleImage=$('[data-capsule-image]',root);
  const routeProgress=$('[data-time-route-progress]',root);
  const progressFill=$('[data-time-progress]',root);
  const progressValue=$('[data-time-progress-value]',root);
  const progressLabel=$('[data-time-progress-label]',root);
  const machineReadout=$('[data-time-machine-readout]',root);
  const yearNode=$('[data-time-year]',root),locationNode=$('[data-time-location]',root);
  const headingNode=$('[data-time-heading]',root),copyNode=$('[data-time-copy]',root);
  const imageNode=$('[data-time-image]',root),imageLink=$('[data-time-image-link]',root);
  const imageLabel=$('[data-time-image-label]',root),imageCredit=$('[data-time-image-credit]',root);
  const stageLabel=$('[data-time-stage-label]',root),thumbs=$('.time-story-thumbnails',root);
  const buttons=$$('[data-time-jump]',root);
  const events=chapters.find(ch=>ch.layout==='ottoman-chronicle')?.events||[];
  if(!track||!sticky||!capsule||!events.length)return;

  const coords=['41.13° N · 29.00° E','45.02° N · 35.38° E','45.21° N · 28.72° E'];
  let target=0,current=0,activeIndex=-1,activeImage=0,raf=0,lastTime=0,imageToken=0,resizeObserver=null,journeyObserver=null,isInView=false,lastPercent=-1,lastCoordIndex=-1;
  const clamp=(value,min=0,max=1)=>Math.max(min,Math.min(max,value));
  const ease=window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const routeLength=routeProgress.getTotalLength?.()||800;
  imageNode.addEventListener('error',()=>$('.time-story-media',root)?.classList.add('is-unavailable'));
  capsuleImage.addEventListener('error',()=>capsuleImage.classList.add('is-missing'));

  function setImage(index,imageIndex,{animate=true}={}){
    const event=events[index];const item=event?.images?.[imageIndex];if(!item)return;
    activeImage=imageIndex;
    const token=++imageToken;
    const apply=()=>{
      if(token!==imageToken)return;
      const update=()=>{
        const media=$('.time-story-media',root);
        media?.classList.remove('is-unavailable');
        capsuleImage.classList.remove('is-missing');
        imageNode.src=item.src;imageNode.alt=item.alt||item.label||'';
        capsuleImage.src=item.src;capsuleImage.alt=item.alt||'';
        imageLink.href=item.sourceUrl||item.src;
        imageLabel.textContent=item.label||event.stage||'';
        imageCredit.textContent=item.credit||'Imagine documentară';
        imageNode.classList.remove('is-loading');capsuleImage.classList.remove('is-loading');
        if(animate&&!ease){imageNode.classList.add('is-entering');capsuleImage.classList.add('is-entering');requestAnimationFrame(()=>{imageNode.classList.remove('is-entering');capsuleImage.classList.remove('is-entering');});}
      };
      update();
    };
    imageNode.classList.toggle('is-loading',animate&&!ease);
    capsuleImage.classList.toggle('is-loading',animate&&!ease);
    const preload=new Image();preload.decoding='async';preload.onload=apply;preload.onerror=apply;preload.src=item.src;
    if(preload.complete)apply();
    thumbs.replaceChildren();
    (event.images||[]).forEach((thumb,thumbIndex)=>{
      const button=document.createElement('button');button.type='button';button.className='time-story-thumb';
      button.classList.toggle('is-active',thumbIndex===imageIndex);
      button.setAttribute('aria-label',`Imagine ${thumbIndex+1}: ${thumb.label||event.year}`);
      button.setAttribute('aria-pressed',String(thumbIndex===imageIndex));
      const thumbImg=document.createElement('img');thumbImg.src=thumb.src;thumbImg.alt='';thumbImg.loading='lazy';thumbImg.decoding='async';
      button.append(thumbImg);
      button.addEventListener('click',()=>setImage(index,thumbIndex));
      thumbs.append(button);
    });
  }

  function renderEvent(index){
    index=clamp(index,0,events.length-1)|0;
    if(index===activeIndex)return;
    activeIndex=index;activeImage=0;
    const event=events[index];
    const panel=$('.time-story-panel',root);
    if(panel&&!ease)panel.classList.add('is-switching');
    yearNode.textContent=event.year;
    locationNode.textContent=event.stage||`ETAPA 0${index+1}`;
    headingNode.textContent=event.stage||'Eveniment istoric';
    copyNode.textContent=event.body||'';
    stageLabel.textContent=`ETAPA 0${index+1} / 0${events.length}`;
    progressLabel.textContent=`0${index+1} — ${Math.round((index+1)/events.length*100)}%`;
    buttons.forEach((button,i)=>{
      const selected=i===index;button.classList.toggle('is-active',selected);
      button.setAttribute('aria-current',selected?'step':'false');
    });
    setImage(index,0,{animate:true});
    if(panel&&!ease){
      clearTimeout(panel._timeSwapTimer);
      panel._timeSwapTimer=setTimeout(()=>panel.classList.remove('is-switching'),220);
    }
  }

  function measure(){
    const rect=track.getBoundingClientRect();
    const stickyTop=parseFloat(getComputedStyle(sticky).top)||82;
    const travel=Math.max(1,rect.height+innerHeight-stickyTop);
    target=clamp((innerHeight-rect.top)/travel);
    if(!raf)raf=requestAnimationFrame(tick);
  }

  function tick(now){
    raf=0;
    const dt=lastTime?Math.min(48,now-lastTime):16.7;lastTime=now;
    const factor=ease?1:1-Math.exp(-dt/105);
    current+=(target-current)*factor;
    if(Math.abs(target-current)<.00045)current=target;

    const p=current;
    const x=-40+p*80;
    const y=18-Math.sin(p*Math.PI)*34;
    const rz=-7+p*14;
    const ry=-17+p*34;
    capsule.style.transform=`translate3d(${x}px,${y}px,0) rotateZ(${rz}deg) rotateY(${ry}deg)`;
    capsule.style.setProperty('--capsule-progress',String(p));
    progressFill.style.transform=`scaleX(${p})`;
    routeProgress.style.strokeDasharray=String(routeLength);
    routeProgress.style.strokeDashoffset=String(routeLength*(1-p));
    const percent=Math.round(p*100);
    if(percent!==lastPercent){progressValue.textContent=`${String(percent).padStart(2,'0')}%`;lastPercent=percent;}
    const coordIndex=Math.min(coords.length-1,Math.floor(p*coords.length));
    if(coordIndex!==lastCoordIndex){machineReadout.textContent=`COORDONATE: ${coords[coordIndex]}`;lastCoordIndex=coordIndex;}

    const eventIndex=Math.min(events.length-1,Math.floor(Math.min(.999999,p)*events.length));
    renderEvent(eventIndex);
    if(Math.abs(target-current)>.00045)raf=requestAnimationFrame(tick);
  }

  buttons.forEach((button,index)=>button.addEventListener('click',()=>{
    const rect=track.getBoundingClientRect();
    const docTop=window.scrollY+rect.top;
    const stickyTop=parseFloat(getComputedStyle(sticky).top)||82;
    const travel=Math.max(1,rect.height+innerHeight-stickyTop);
    const desired=(index+.5)/events.length;
    const top=docTop-innerHeight+desired*travel;
    window.scrollTo({top:Math.max(0,top),behavior:ease?'auto':'smooth'});
  }));

  let scrollPending=false;
  const onScroll=()=>{if(!isInView||scrollPending)return;scrollPending=true;requestAnimationFrame(()=>{scrollPending=false;measure();});};
  addEventListener('scroll',onScroll,{passive:true});
  addEventListener('resize',()=>{if(isInView)measure();},{passive:true});
  addEventListener('pageshow',()=>{if(isInView)measure();},{passive:true});
  if('ResizeObserver' in window){resizeObserver=new ResizeObserver(()=>{if(isInView)measure();});resizeObserver.observe(track);resizeObserver.observe(sticky);}
  if('IntersectionObserver' in window){
    journeyObserver=new IntersectionObserver(entries=>{
      isInView=Boolean(entries[0]?.isIntersecting);
      sticky.classList.toggle('is-in-view',isInView);
      if(isInView)measure();
    },{rootMargin:'120px 0px 120px 0px',threshold:0});
    journeyObserver.observe(root);
  }else{isInView=true;sticky.classList.add('is-in-view');}
  if(document.fonts?.ready)document.fonts.ready.then(()=>{if(isInView)measure();}).catch(()=>{});
  renderEvent(0);measure();
}

// Public contributor credits: management is intentionally kept on the unlinked /elevi route.
function initParticipants(){
  const mount=$('#hero-participant-list');
  if(!mount)return;
  const render=()=>{
    const {all}=readParticipantRoster();
    mount.replaceChildren();
    all.forEach((person,index)=>{
      const chip=document.createElement('span');
      chip.className='hero-credit-person';
      chip.setAttribute('role','listitem');
      const number=document.createElement('i');
      number.textContent=String(index+1).padStart(2,'0');
      const name=document.createElement('strong');
      name.textContent=person.name;
      chip.append(number,name);
      mount.append(chip);
    });
    mount.setAttribute('role','list');
    mount.setAttribute('aria-label',`${all.length} participanți la proiect`);
  };
  render();
  addEventListener('storage',event=>{
    if(!event.key||event.key==='pontus-participants-v1')render();
  });
}

// Timeline controls.
function initTimeline(){const buttons=$$('.timeline-item');const update=(index)=>{const m=milestones[index];buttons.forEach((b,i)=>{b.classList.toggle('is-active',i===index);b.setAttribute('aria-selected',String(i===index));});const panel=$('.timeline-detail');if(window.gsap&&!reducedMotion){gsap.to(panel,{autoAlpha:0,y:10,duration:.18,onComplete:()=>{render();gsap.fromTo(panel,{autoAlpha:0,y:12},{autoAlpha:1,y:0,duration:.5,ease:'power3.out'});}});}else render();function render(){$('#timeline-label').textContent=m.label;$('#timeline-count').textContent=`${String(index+1).padStart(2,'0')} — 07`;$('#timeline-date').textContent=m.date;$('#timeline-title').textContent=m.title;$('#timeline-copy').textContent=m.text;$('#timeline-meter-fill').style.width=`${(index+1)/7*100}%`;}};buttons.forEach((b,i)=>b.addEventListener('click',()=>update(i)));}

// Map callouts, no hidden or fictional location details.
function initMapPoints(){const box=$('#map-detail');$$('.map-point').forEach(btn=>btn.addEventListener('click',()=>{$('#map-detail-title').textContent=btn.dataset.point;$('#map-detail-text').textContent=btn.dataset.description;box.classList.add('open');box.setAttribute('aria-hidden','false');}));$('#map-detail-close').addEventListener('click',()=>{box.classList.remove('open');box.setAttribute('aria-hidden','true');});}

// Bibliography archive with search and filter.
function initArchive(){const shell=$('#archive-shell'),list=$('#archive-list'),search=$('#archive-search');let filter='all';
  function render(){const q=search.value.trim().toLocaleLowerCase('ro');const items=bibliography.filter(x=>(filter==='all'||x.type===filter)&&`${x.id} ${x.title} ${x.category} ${x.source} ${x.description}`.toLocaleLowerCase('ro').includes(q));list.innerHTML='';items.forEach(x=>{const row=document.createElement('article');row.className='archive-entry';row.innerHTML=`<div class="archive-entry-id">${x.id}</div><div><div class="category">${x.category}</div><h3></h3><p></p><div class="source"></div><a target="_blank" rel="noopener noreferrer"></a></div>`;row.querySelector('h3').textContent=x.title;row.querySelector('p').textContent=x.description;row.querySelector('.source').textContent=x.source;const a=row.querySelector('a');a.href=x.url;a.textContent=x.type==='image'?'DESCHIDE FIȘIERUL ↗':'CONSULTĂ SURSA ↗';list.append(row);});if(!items.length)list.innerHTML='<p class="archive-entry">Nu există rezultate pentru căutarea introdusă.</p>';}
  function open(){shell.classList.add('open');shell.setAttribute('aria-hidden','false');document.body.classList.add('locked');pauseWorld();if(window.gsap&&!reducedMotion)gsap.fromTo('.archive-title-block > *',{y:22,autoAlpha:0},{y:0,autoAlpha:1,duration:.7,stagger:.08,ease:'power3.out'});}
  function close(){shell.classList.remove('open');shell.setAttribute('aria-hidden','true');document.body.classList.remove('locked');resumeWorld();}
  $$('.archive-filters button').forEach(btn=>{const count=btn.querySelector('small');if(count){const n=btn.dataset.filter==='all'?bibliography.length:bibliography.filter(item=>item.type===btn.dataset.filter).length;count.textContent=String(n).padStart(2,'0');}});  $('#open-archive').addEventListener('click',open);$('#footer-archive').addEventListener('click',open);$('#mobile-open-archive').addEventListener('click',()=>{closeMobile();open();});$('#close-archive').addEventListener('click',close);$('#archive-scrim').addEventListener('click',close);search.addEventListener('input',render);$$('.archive-filters button').forEach(btn=>btn.addEventListener('click',()=>{filter=btn.dataset.filter;$$('.archive-filters button').forEach(b=>b.classList.toggle('active',b===btn));render();}));render();}
function initPhotoEssay(){
  const cards=$$('.photo-card'),dialog=$('#photo-lightbox');
  if(!dialog||!cards.length)return;
  const photos=[
    {title:'Ruginoasa',caption:'Localitatea natală a lui Gheorghe I. Brătianu. Imaginea prezintă Palatul Alexandru Ioan Cuza din localitate, nu casa exactă în care s-a născut.',full:'https://upload.wikimedia.org/wikipedia/commons/0/07/Palatul_Alexandru_Ioan_Cuza_01.jpg',source:'https://commons.wikimedia.org/wiki/File:Palatul_Alexandru_Ioan_Cuza_01.jpg'},
    {title:'Sorbona, Paris',caption:'Un reper al formării sale academice la Paris. Fotografia arată fațada clădirii Sorbonei.',full:'https://upload.wikimedia.org/wikipedia/commons/f/f1/Sorbonne_Front.jpg',source:'https://commons.wikimedia.org/wiki/File:Sorbonne_Front.jpg'},
    {title:'Histria',caption:'Piața principală a orașului antic Histria, un reper arheologic al litoralului vestic pontic.',full:'https://upload.wikimedia.org/wikipedia/commons/3/3f/The_Main_Square_of_the_late_Roman_city,_Histria,_Moesia_Inferior,_Romania_(28636949588).jpg',source:'https://commons.wikimedia.org/wiki/File:The_Main_Square_of_the_late_Roman_city,_Histria,_Moesia_Inferior,_Romania_(28636949588).jpg'},
    {title:'Memorialul Sighet',caption:'Fosta închisoare din Sighetu Marmației, locul în care Gheorghe I. Brătianu a murit în aprilie 1953.',full:'https://upload.wikimedia.org/wikipedia/commons/1/16/Memorialul_Victimelor_Comunismului_%C8%99i_al_Rezisten%C8%9Bei_Sighet_01.jpg',source:'https://commons.wikimedia.org/wiki/File:Memorialul_Victimelor_Comunismului_și_al_Rezistenței_Sighet_01.jpg'},
    {title:'Universitatea din Iași',caption:'Fotografie de epocă publicată în 1901–1904. Brătianu a devenit profesor la Universitatea din Iași în 1924.',full:"https://upload.wikimedia.org/wikipedia/commons/e/e0/L%27Universite_de_Jassy.jpg",source:"https://commons.wikimedia.org/wiki/File:L'Universite_de_Jassy.jpg"},
    {title:'Universitatea din Cernăuți',caption:'Clădirea Universității din Cernăuți. Brătianu a obținut aici doctoratul în filosofie în 1923; fotografia este o imagine contemporană a clădirii, nu o fotografie din anii studiilor.',full:'https://upload.wikimedia.org/wikipedia/commons/4/40/University_of_Chernivtsi.jpg',source:'https://commons.wikimedia.org/wiki/File:University_of_Chernivtsi.jpg'},
    {title:'Academia Română',caption:'Clădirea Academiei Române din București. Gheorghe I. Brătianu a fost ales membru titular în 1942.',full:'https://upload.wikimedia.org/wikipedia/commons/c/cd/AcademiaRomana12rhd.jpg',source:'https://commons.wikimedia.org/wiki/File:AcademiaRomana12rhd.jpg'},
    {title:'Gheorghe I. Brătianu — portret documentar',caption:'Fotografie documentară datată înainte de 1950 în fișa Wikimedia Commons. Autorul nu este identificat; fișierul este publicat sub licența CC BY-SA 4.0.',full:'https://upload.wikimedia.org/wikipedia/commons/1/1c/Gheorghe_I._Br%C4%83tianu.jpg',source:'https://commons.wikimedia.org/wiki/File:Gheorghe_I._Br%C4%83tianu.jpg'},
    {title:'Gheorghe I. Brătianu în detenție',caption:'Fotografie de identificare catalogată de Wikimedia Commons ca imagine a istoricului în detenție. Fișa fișierului o marchează drept domeniu public în Uniunea Europeană.',full:'https://upload.wikimedia.org/wikipedia/commons/f/fd/Gheorghe-i-bratianu.jpg',source:'https://commons.wikimedia.org/wiki/File:Gheorghe-i-bratianu.jpg'},
    {title:'Raport de percheziție — 16 mai 1950',caption:'Document identificat în fișa Wikimedia Commons drept raport de percheziție asociat detenției lui Gheorghe I. Brătianu la Sighet, datat 16 mai 1950.',full:'https://upload.wikimedia.org/wikipedia/commons/9/98/Rapporto_di_Gheorghe_I._Br%C4%83tianu_%28Carcere_di_Sighet%29.jpg',source:'https://commons.wikimedia.org/wiki/File:Rapporto_di_Gheorghe_I._Br%C4%83tianu_(Carcere_di_Sighet).jpg'}
  ];
  const img=$('#lightbox-image'),title=$('#lightbox-title'),caption=$('#lightbox-caption'),source=$('#lightbox-source'),counter=$('#lightbox-counter'),progress=$('#lightbox-progress-fill');
  let current=-1,touchStartX=0;
  const setProgress=index=>{progress.style.transform=`scaleX(${(index+1)/photos.length})`;};
  const showPhoto=index=>{
    current=(index+photos.length)%photos.length;
    const p=photos[current];
    img.classList.add('is-switching');
    title.textContent=p.title;caption.textContent=p.caption;source.href=p.source;
    counter.textContent=`IMAGINE ${String(current+1).padStart(2,'0')} / ${String(photos.length).padStart(2,'0')}`;
    setProgress(current);
    const nextSrc=p.full;
    const preload=new Image();preload.decoding='async';preload.onload=()=>{
      if(current<0||photos[current]!==p)return;
      img.src=nextSrc;img.alt=p.title;
      if(window.gsap&&!reducedMotion)gsap.fromTo(img,{autoAlpha:.35,scale:1.012},{autoAlpha:1,scale:1,duration:.42,ease:'power2.out',overwrite:true});
      else img.classList.remove('is-switching');
    };
    preload.onerror=()=>{img.src=nextSrc;img.alt=p.title;img.classList.remove('is-switching');};
    preload.src=nextSrc;
    if(!dialog.open){dialog.showModal();pauseWorld();}
    if(window.gsap&&!reducedMotion)gsap.fromTo(dialog.querySelector('figure'),{y:18,autoAlpha:0},{y:0,autoAlpha:1,duration:.48,ease:'power3.out',overwrite:true});
  };
  cards.forEach(card=>card.addEventListener('click',()=>showPhoto(Number(card.dataset.photo)||0)));
  $('#lightbox-prev').addEventListener('click',()=>showPhoto(current-1));
  $('#lightbox-next').addEventListener('click',()=>showPhoto(current+1));
  $('#lightbox-close').addEventListener('click',()=>dialog.close());
  dialog.addEventListener('keydown',event=>{
    if(event.key==='ArrowLeft'){event.preventDefault();showPhoto(current-1);}
    if(event.key==='ArrowRight'){event.preventDefault();showPhoto(current+1);}
  });
  dialog.addEventListener('touchstart',event=>{touchStartX=event.changedTouches[0]?.clientX||0;},{passive:true});
  dialog.addEventListener('touchend',event=>{const dx=(event.changedTouches[0]?.clientX||touchStartX)-touchStartX;if(Math.abs(dx)>55)showPhoto(current+(dx<0?1:-1));},{passive:true});
  dialog.addEventListener('click',event=>{if(event.target===dialog)dialog.close();});
  dialog.addEventListener('close',()=>{img.classList.remove('is-switching');resumeWorld();});
}
function closeMobile(){const n=$('#mobile-nav'),b=$('#menu-trigger');n.classList.remove('open');b.setAttribute('aria-expanded','false');}
function initNavigation(){const menu=$('#menu-trigger'),nav=$('#mobile-nav');menu.addEventListener('click',()=>{const open=!nav.classList.contains('open');nav.classList.toggle('open',open);menu.setAttribute('aria-expanded',String(open));});$$('.mobile-nav a').forEach(a=>a.addEventListener('click',closeMobile));const progressFill=$('#progress-fill'),header=$('#topbar');addEventListener('scroll',()=>{const max=document.documentElement.scrollHeight-innerHeight;progressFill.style.transform=`scaleX(${max>0?scrollY/max:0})`;header.classList.toggle('scrolled',scrollY>25);},{passive:true});$$('.desktop-nav a').forEach(a=>a.addEventListener('click',()=>{$$('.desktop-nav a').forEach(x=>x.classList.toggle('active',x===a));}));}
function initCursor(){if(coarsePointer||reducedMotion)return;const c=$('#cursor');addEventListener('pointermove',e=>{c.style.left=`${e.clientX}px`;c.style.top=`${e.clientY}px`;c.classList.add('visible');c.classList.toggle('active',!!e.target.closest('a,button,.place-card,.team-card'));},{passive:true});document.addEventListener('pointerout',e=>{if(!e.relatedTarget)c.classList.remove('visible');});}

const worldReady=initWorld();
initChapters();initPontusStorySceneScroll();
worldReady.then(()=>initPontusStoryWorld()).catch(error=>console.warn('PONTUS cinematic 3D initialization skipped.',error));
initAncientColonies();initBlackSeaStrategy();initPonticNetwork();initTradeImmersive();initBratianuWorks();initSpaceConclusionVoyage();initOttomanTimeTravel();initParticipants();initLessonRouteProgress();initTimeline();initMapPoints();initArchive();initPhotoEssay();initNavigation();initCursor();
initMotion();
clearInterval(loadTick);
Promise.resolve(worldReady).finally(()=>{ $('#loading-percent').textContent='100'; $('#loading-line-fill').style.width='100%'; setTimeout(()=>loading.classList.add('done'),420); });
