import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';

/**
 * PONTUS story scenes: one shared Three.js renderer, one reusable camera and
 * three physically-lit scenes that take over only the WebGL layer.
 * Existing HTML copy, cards, images and 2D section backgrounds remain untouched.
 */
export function createPontusStoryWorld({ THREE, scene, renderer, createShip, adonisViewport=null, coarsePointer=false, reducedMotion=false, onStatus=()=>{} }) {
  const root = new THREE.Group();
  root.name = 'PONTUS cinematic story world';
  root.visible = false;
  scene.add(root);

  const opening = new THREE.Group(); opening.name = 'Opening · Black Sea scan'; opening.visible = false; root.add(opening);
  const works = new THREE.Group(); works.name = 'Bratianu archive · 3D study'; works.visible = false; root.add(works);
  const finale = new THREE.Group(); finale.name = 'Final voyage · Enisala and Black Sea'; finale.visible = false; root.add(finale);

  const camera = new THREE.PerspectiveCamera(39, Math.max(1, innerWidth) / Math.max(1, innerHeight), .1, 180);
  const cameraPosition = new THREE.Vector3(1.0, 6.1, 11.6);
  const cameraLook = new THREE.Vector3(.6, .1, 0);
  const targetPosition = cameraPosition.clone();
  const targetLook = cameraLook.clone();
  const cameraLookScratch = new THREE.Vector3();
  const shipForwardAxis = new THREE.Vector3(0, 0, -1);
  const currentCameraPosition = cameraPosition.clone();
  camera.position.copy(cameraPosition); camera.lookAt(cameraLook);

  const gold = new THREE.MeshStandardMaterial({ color: 0xb9925e, metalness: .78, roughness: .28, envMapIntensity: .72 });
  const darkMetal = new THREE.MeshStandardMaterial({ color: 0x17272c, metalness: .62, roughness: .38, envMapIntensity: .55 });
  const stone = new THREE.MeshStandardMaterial({ color: 0x55534b, roughness: .92, metalness: .015 });
  const darkStone = new THREE.MeshStandardMaterial({ color: 0x17232a, roughness: .72, metalness: .18 });
  const cyan = new THREE.MeshStandardMaterial({ color: 0x62c5c7, emissive: 0x1a818b, emissiveIntensity: .8, metalness: .36, roughness: .24 });
  const warmGlow = new THREE.MeshBasicMaterial({ color: 0xf3c88e });

  // A small procedural environment gives the scanned materials and water something
  // to reflect without depending on remote HDR files.
  function makeEnvironment() {
    const canvas = document.createElement('canvas'); canvas.width = 1024; canvas.height = 512;
    const ctx = canvas.getContext('2d');
    const sky = ctx.createLinearGradient(0, 0, 0, 512);
    sky.addColorStop(0, '#08131d'); sky.addColorStop(.39, '#17343b'); sky.addColorStop(.54, '#94765c'); sky.addColorStop(.61, '#29464b'); sky.addColorStop(1, '#07141b');
    ctx.fillStyle = sky; ctx.fillRect(0, 0, 1024, 512);
    const glow = ctx.createRadialGradient(690, 267, 8, 690, 267, 220);
    glow.addColorStop(0, 'rgba(245,207,151,.88)'); glow.addColorStop(.18, 'rgba(215,161,105,.34)'); glow.addColorStop(1, 'rgba(215,161,105,0)');
    ctx.fillStyle = glow; ctx.fillRect(430, 30, 520, 470);
    for (let i = 0; i < 34; i++) {
      const x = (i * 173) % 1024, y = 80 + ((i * 89) % 170);
      ctx.fillStyle = `rgba(220,232,219,${.012 + (i % 5) * .004})`;
      ctx.fillRect(x, y, 40 + (i % 4) * 24, 1 + (i % 2));
    }
    const texture = new THREE.CanvasTexture(canvas);
    texture.mapping = THREE.EquirectangularReflectionMapping;
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.needsUpdate = true;
    return texture;
  }
  const environment = makeEnvironment();
  // Adonis' chapter uses the same renderer/GPU context, but a dedicated scene
  // rendered through a scissor viewport inside the existing atlas dock.
  const adonisScene = new THREE.Scene();
  adonisScene.background = new THREE.Color(0x07151c);
  adonisScene.environment = environment;
  adonisScene.fog = new THREE.Fog(0x07151c, 18, 42);
  const adonisCamera = new THREE.PerspectiveCamera(39, 1, .1, 90);
  const adonisCameraTarget = new THREE.Vector3(0, 1.15, 0);
  const adonisCameraPosition = new THREE.Vector3(9.2, 6.1, 10.6);
  const adonisDesiredTarget = adonisCameraTarget.clone();
  const adonisDesiredPosition = adonisCameraPosition.clone();
  adonisCamera.position.copy(adonisCameraPosition);
  adonisCamera.lookAt(adonisCameraTarget);
  const sceneMaterials = [];
  const auxiliaryTextures = [];
  const artifactTexturePaths = [
    '../assets/chapters/bratianu-works/bratianu-enigma-book.webp',
    '../assets/chapters/bratianu-works/bratianu-medieval-states-book.webp',
    '../assets/chapters/bratianu-works/bratianu-genoese-venetian-book.webp',
    '../assets/chapters/bratianu-works/bratianu-portolan.webp'
  ];
  const artifactTextures = artifactTexturePaths.map(path => {
    const texture = new THREE.TextureLoader().load(new URL(path, import.meta.url).href);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
    texture.needsUpdate = true;
    return texture;
  });

  // The fourth written study is Byzantine economic and social history. The
  // supplied portolan artwork is a separate archive artefact, not its cover.
  // Build a restrained, period-inspired cover for the 3D volume so the object
  // matches the selected chapter text without inventing a source photograph.
  function makeByzantineCoverTexture() {
    const canvas=document.createElement('canvas');canvas.width=768;canvas.height=1024;
    const ctx=canvas.getContext('2d');
    const base=ctx.createLinearGradient(0,0,768,1024);
    base.addColorStop(0,'#243d3c');base.addColorStop(.52,'#39483f');base.addColorStop(1,'#1b3032');
    ctx.fillStyle=base;ctx.fillRect(0,0,768,1024);
    const glow=ctx.createRadialGradient(384,460,20,384,460,460);
    glow.addColorStop(0,'rgba(185,150,91,.22)');glow.addColorStop(1,'rgba(185,150,91,0)');
    ctx.fillStyle=glow;ctx.fillRect(0,0,768,1024);
    for(let i=0;i<2200;i++){
      const x=(i*193)%768,y=(i*317)%1024;
      ctx.fillStyle=`rgba(235,218,178,${.012+(i%4)*.004})`;ctx.fillRect(x,y,1+(i%3),1);
    }
    ctx.strokeStyle='rgba(213,181,125,.88)';ctx.lineWidth=5;ctx.strokeRect(48,48,672,928);
    ctx.strokeStyle='rgba(213,181,125,.45)';ctx.lineWidth=2;ctx.strokeRect(65,65,638,894);
    ctx.beginPath();ctx.arc(384,282,94,0,Math.PI*2);ctx.strokeStyle='rgba(223,192,135,.82)';ctx.lineWidth=3;ctx.stroke();
    ctx.beginPath();ctx.arc(384,282,76,0,Math.PI*2);ctx.strokeStyle='rgba(223,192,135,.42)';ctx.lineWidth=1.5;ctx.stroke();
    ctx.save();ctx.translate(384,282);ctx.strokeStyle='rgba(225,194,137,.9)';ctx.lineWidth=4;
    for(let i=0;i<8;i++){ctx.rotate(Math.PI/4);ctx.beginPath();ctx.moveTo(0,-58);ctx.lineTo(0,-20);ctx.stroke();}
    ctx.beginPath();ctx.arc(0,0,15,0,Math.PI*2);ctx.stroke();ctx.restore();
    ctx.textAlign='center';ctx.fillStyle='#e3d1a8';
    ctx.font='500 36px Georgia,serif';ctx.fillText('ÉTUDES',384,474);
    ctx.font='600 54px Georgia,serif';ctx.fillText('BYZANTINES',384,545);
    ctx.strokeStyle='rgba(218,187,132,.7)';ctx.lineWidth=2;ctx.beginPath();ctx.moveTo(168,584);ctx.lineTo(600,584);ctx.stroke();
    ctx.font='italic 23px Georgia,serif';ctx.fillStyle='rgba(231,219,190,.88)';
    ctx.fillText("HISTOIRE ÉCONOMIQUE",384,642);ctx.fillText('ET SOCIALE',384,676);
    ctx.font='500 19px Georgia,serif';ctx.fillStyle='rgba(220,194,145,.83)';ctx.fillText('GEORGES I. BRĂTIANU',384,824);
    ctx.font='16px Georgia,serif';ctx.fillStyle='rgba(220,194,145,.68)';ctx.fillText('1938  ·  ÉTUDES HISTORIQUES',384,866);
    const texture=new THREE.CanvasTexture(canvas);texture.colorSpace=THREE.SRGBColorSpace;
    texture.anisotropy=Math.min(8,renderer.capabilities.getMaxAnisotropy());texture.needsUpdate=true;
    return texture;
  }
  const byzantineCoverTexture=makeByzantineCoverTexture();

  // The supplied scans are dense photographic meshes. They should receive the scene's
  // physically based lighting, but must not enter the shared 2048px shadow pass: that
  // duplicates hundreds of thousands of triangles every frame and can stall integrated GPUs.
  function tuneModelMaterials(object, { roughness=.84, envIntensity=.34, castShadow=false, receiveShadow=false, preferTextureColor=false }={}) {
    object.traverse(node => {
      if (!node.isMesh) return;
      node.castShadow = castShadow; node.receiveShadow = receiveShadow;
      const source = Array.isArray(node.material) ? node.material : [node.material];
      const tuned = source.map(material => {
        if (!material) return new THREE.MeshStandardMaterial({ color: 0x817968, roughness });
        const map = material.map || null;
        if (map) { map.colorSpace = THREE.SRGBColorSpace; map.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy()); map.needsUpdate = true; }
        const next = new THREE.MeshStandardMaterial({
          color: (preferTextureColor && map) ? new THREE.Color(0xffffff) : (material.color?.clone?.() || new THREE.Color(0xc0b7a5)),
          map,
          normalMap: material.normalMap || null,
          roughness: Math.max(.66, roughness),
          metalness: .025,
          envMap: environment,
          envMapIntensity: envIntensity,
          side: material.side ?? THREE.FrontSide,
          vertexColors: !!material.vertexColors && !(preferTextureColor && map)
        });
        if (next.normalMap) next.normalScale.set(.55, .55);
        sceneMaterials.push(next);
        return next;
      });
      node.material = Array.isArray(node.material) ? tuned : tuned[0];
      node.frustumCulled = true;
    });
  }

  function centerAndScale(object, maxSize, rotateZUp=false) {
    const wrapper = new THREE.Group(); wrapper.add(object);
    if (rotateZUp) object.rotation.x = -Math.PI / 2;
    wrapper.updateMatrixWorld(true);
    const bounds = new THREE.Box3().setFromObject(wrapper);
    const center = bounds.getCenter(new THREE.Vector3());
    object.position.sub(center);
    wrapper.updateMatrixWorld(true);
    const size = new THREE.Box3().setFromObject(wrapper).getSize(new THREE.Vector3());
    const max = Math.max(size.x, size.y, size.z) || 1;
    wrapper.scale.setScalar(maxSize / max);
    wrapper.userData.normalizedSize = size.multiplyScalar(maxSize / max);
    wrapper.userData.sourceCenter = center;
    return wrapper;
  }

  function addWater(parent, { size=42, y=-.78 }={}) {
    const segments = coarsePointer ? 70 : 118;
    const geometry = new THREE.PlaneGeometry(size, size * .78, segments, Math.round(segments * .78));
    geometry.rotateX(-Math.PI / 2);
    const material = new THREE.MeshPhysicalMaterial({
      color: 0x367985, roughness: .18, metalness: .24,
      clearcoat: 1, clearcoatRoughness: .075, reflectivity: .82,
      envMap: environment, envMapIntensity: .72,
      transparent: true, opacity: .94, side: THREE.DoubleSide
    });
    material.onBeforeCompile = shader => {
      shader.uniforms.uPontusTime = { value: 0 };
      shader.vertexShader = shader.vertexShader.replace('#include <common>', '#include <common>\nuniform float uPontusTime;');
      shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
        float waveA = sin(position.x * 0.72 + uPontusTime * 0.66) * 0.030;
        float waveB = sin(position.z * 1.15 - uPontusTime * 0.47) * 0.018;
        float waveC = sin((position.x + position.z) * 1.8 + uPontusTime * 0.32) * 0.008;
        transformed.y += waveA + waveB + waveC;`);
      material.userData.shader = shader;
    };
    material.customProgramCacheKey = () => 'pontus-water-surface-v2';
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.y = y; mesh.rotation.x = 0; mesh.receiveShadow = true;
    parent.add(mesh);
    return mesh;
  }

  function addPlatform(parent, { width=9.1, depth=10.6, y=-.06 }={}) {
    const base = new THREE.Mesh(new THREE.BoxGeometry(width, .34, depth), darkStone);
    base.position.y = y; base.castShadow = true; base.receiveShadow = true; parent.add(base);
    const top = new THREE.Mesh(new THREE.BoxGeometry(width-.16, .045, depth-.16), stone);
    top.position.y = y + .19; top.receiveShadow = true; parent.add(top);
    const rim = new THREE.Group();
    for (const z of [-depth/2, depth/2]) {
      const rail = new THREE.Mesh(new THREE.BoxGeometry(width+.08, .028, .045), gold);
      rail.position.set(0, y+.185, z); rim.add(rail);
    }
    for (const x of [-width/2, width/2]) {
      const rail = new THREE.Mesh(new THREE.BoxGeometry(.045, .028, depth+.08), gold);
      rail.position.set(x, y+.185, 0); rim.add(rail);
    }
    parent.add(rim);
    const bolts = new THREE.InstancedMesh(new THREE.CylinderGeometry(.034,.034,.018,16), gold, 4);
    const dummy = new THREE.Object3D();
    let i = 0;
    for (const x of [-width/2+.16, width/2-.16]) for (const z of [-depth/2+.16, depth/2-.16]) {
      dummy.position.set(x, y+.22, z); dummy.updateMatrix(); bolts.setMatrixAt(i++, dummy.matrix);
    }
    bolts.instanceMatrix.needsUpdate = true; parent.add(bolts);
    return { base, top, rim };
  }

  function addRing(parent, radius, tube, colorMaterial, y=0, scaleZ=1) {
    const ring = new THREE.Mesh(new THREE.TorusGeometry(radius, tube, 8, coarsePointer?84:144), colorMaterial);
    ring.rotation.x = Math.PI / 2; ring.position.y = y; ring.scale.z = scaleZ;
    parent.add(ring); return ring;
  }

  function addParticles(parent, count=460, bounds=[18,7,18]) {
    const positions = new Float32Array(count * 3);
    const drift = new Float32Array(count * 3);
    for (let i=0;i<count;i++) {
      positions[i*3]=(Math.random()-.5)*bounds[0];
      positions[i*3+1]=(Math.random()-.5)*bounds[1];
      positions[i*3+2]=(Math.random()-.5)*bounds[2];
      drift[i*3]=(Math.random()-.5)*.018;
      drift[i*3+1]=.006+Math.random()*.018;
      drift[i*3+2]=(Math.random()-.5)*.018;
    }
    const geometry = new THREE.BufferGeometry(); geometry.setAttribute('position', new THREE.BufferAttribute(positions,3));
    const material = new THREE.PointsMaterial({ color:0xc4d9d2, size:coarsePointer?.022:.018, transparent:true, opacity:.46, depthWrite:false, sizeAttenuation:true });
    const points = new THREE.Points(geometry,material); points.userData.drift=drift; points.userData.bounds=bounds; points.frustumCulled=false; parent.add(points);
    return points;
  }

  function createBook(index) {
    const artifact = new THREE.Group();
    artifact.userData.floatPhase = index * .85;
    const coverColor = [0x33444a, 0x4d3c2c, 0x263e45, 0x2a3e3a][index] ?? 0x34424a;
    const coverMap = index===3 ? byzantineCoverTexture : artifactTextures[index];
    const coverMaterial = new THREE.MeshStandardMaterial({ color: coverColor, roughness: .76, metalness: .06, envMap: environment, envMapIntensity: .22 });
    const pages = new THREE.Mesh(new THREE.BoxGeometry(.72, .92, .105), new THREE.MeshStandardMaterial({ color: 0xd6cbb4, roughness: .96 }));
    artifact.add(pages);
    for (const side of [-1, 1]) {
      const cover = new THREE.Mesh(new THREE.BoxGeometry(.78, .98, .025), coverMaterial);
      cover.position.z = side * .066;
      cover.castShadow = true;
      artifact.add(cover);
    }
    const spine = new THREE.Mesh(new THREE.BoxGeometry(.075, .98, .14), coverMaterial);
    spine.position.x = -.385;
    artifact.add(spine);
    for (const y of [-.37, .34]) {
      const band = new THREE.Mesh(new THREE.BoxGeometry(.076, .018, .151), gold);
      band.position.set(-.385, y, 0);
      artifact.add(band);
    }
    const coverArt = new THREE.Mesh(
      new THREE.PlaneGeometry(.69, .88),
      new THREE.MeshStandardMaterial({ map: coverMap, roughness: .88, metalness: 0, side: THREE.DoubleSide })
    );
    coverArt.position.z = .081;
    artifact.add(coverArt);
    artifact.userData.floatPhase = index * .85;
    return artifact;
  }

  function createPortolanScroll() {
    const chart=new THREE.Group();chart.name='Portolan chart · rolled parchment';
    const parchment=new THREE.Mesh(
      new THREE.PlaneGeometry(1.18,.78),
      new THREE.MeshStandardMaterial({map:artifactTextures[3],roughness:.94,metalness:0,side:THREE.DoubleSide})
    );
    parchment.rotation.x=-Math.PI/2;parchment.position.y=.014;chart.add(parchment);
    const rollerMaterial=new THREE.MeshStandardMaterial({color:0x765638,roughness:.58,metalness:.12});
    const capMaterial=new THREE.MeshStandardMaterial({color:0xb88d58,roughness:.32,metalness:.7});
    for(const z of [-.405,.405]){
      const roller=new THREE.Mesh(new THREE.CylinderGeometry(.045,.045,1.27,20),rollerMaterial);
      roller.rotation.z=Math.PI/2;roller.position.set(0,.03,z);roller.castShadow=true;chart.add(roller);
      for(const side of [-1,1]){
        const cap=new THREE.Mesh(new THREE.CylinderGeometry(.052,.052,.025,18),capMaterial);
        cap.rotation.z=Math.PI/2;cap.position.set(side*.65,.03,z);chart.add(cap);
      }
    }
    const tieMaterial=new THREE.MeshStandardMaterial({color:0x8c6845,roughness:.83});
    for(const x of [-.47,.47]){
      const tie=new THREE.Mesh(new THREE.BoxGeometry(.035,.012,.86),tieMaterial);
      tie.position.set(x,.024,0);chart.add(tie);
    }
    return chart;
  }

  function createGull() {
    const bird = new THREE.Group();
    const body = new THREE.Mesh(
      new THREE.SphereGeometry(.055, 10, 8),
      new THREE.MeshStandardMaterial({ color: 0xd8d9d2, roughness: .98 })
    );
    body.scale.set(.62, .56, 1.5);
    bird.add(body);
    const wingShape = new THREE.Shape();
    wingShape.moveTo(0, 0);
    wingShape.quadraticCurveTo(.16, .10, .42, .045);
    wingShape.quadraticCurveTo(.24, -.035, .015, -.045);
    wingShape.closePath();
    const wingGeometry = new THREE.ShapeGeometry(wingShape, 5);
    const wingMaterial = new THREE.MeshStandardMaterial({ color: 0xe1e1d9, roughness: .95, side: THREE.DoubleSide });
    const left = new THREE.Group();
    const right = new THREE.Group();
    const leftMesh = new THREE.Mesh(wingGeometry, wingMaterial);
    const rightMesh = new THREE.Mesh(wingGeometry, wingMaterial);
    leftMesh.rotation.y = .025;
    rightMesh.scale.x = -1;
    left.add(leftMesh); right.add(rightMesh);
    left.position.set(-.018, .005, 0); right.position.set(.018, .005, 0);
    bird.add(left, right);
    bird.userData.wings = [left, right];
    return bird;
  }

  function addGullFlock(parent, count = 5) {
    const birds = [];
    for (let i = 0; i < count; i++) {
      const bird = createGull();
      bird.position.set(-4.6 + i * 2.2, 3.2 + Math.sin(i * 1.7) * .58, -4.2 - (i % 3) * 1.4);
      bird.scale.setScalar(.52 + (i % 3) * .10);
      bird.userData.phase = i * 1.13;
      bird.userData.home = bird.position.clone();
      parent.add(bird);
      birds.push(bird);
    }
    return birds;
  }

  function createWake(parent) {
    const wakes = [];
    for (const side of [-1, 1]) {
      const positions = new Float32Array(26 * 3);
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
      const material = new THREE.LineBasicMaterial({ color: 0xc4e1df, transparent: true, opacity: .18, depthWrite: false });
      const line = new THREE.Line(geometry, material);
      line.frustumCulled = false;
      parent.add(line);
      wakes.push({ line, side });
    }
    return wakes;
  }

  function updateWake(wakes, boat, tangent, time, waterY) {
    if (!wakes || !boat || !tangent) return;
    const lateral = new THREE.Vector3(tangent.z, 0, -tangent.x).normalize();
    wakes.forEach(({ line, side }) => {
      const attr = line.geometry.attributes.position;
      for (let i = 0; i < attr.count; i++) {
        const u = i / (attr.count - 1);
        const back = .92 + u * 2.05;
        const spread = .035 + u * .28;
        const x = boat.position.x - tangent.x * back + lateral.x * spread * side;
        const z = boat.position.z - tangent.z * back + lateral.z * spread * side;
        const wave = Math.sin(time * 1.7 + u * 7 + side) * .004;
        attr.setXYZ(i, x, waterY + .012 + wave, z);
      }
      attr.needsUpdate = true;
      line.material.opacity = .20 * (1 - .18 * Math.sin(time * 1.1));
    });
  }

  function updateGulls(birds, time) {
    if(reducedMotion)return;
    birds?.forEach((bird, i) => {
      const phase = time * 2.15 + bird.userData.phase;
      bird.position.set(
        bird.userData.home.x + Math.sin(time * .12 + i) * .62,
        bird.userData.home.y + Math.sin(time * .72 + i * .8) * .12,
        bird.userData.home.z + Math.cos(time * .15 + i) * .42
      );
      bird.userData.wings[0].rotation.z = Math.sin(phase) * .38;
      bird.userData.wings[1].rotation.z = -Math.sin(phase) * .38;
      bird.rotation.y = -.12 + Math.sin(time * .2 + i) * .08;
    });
  }

  function addSpot(parent, color, intensity, position, target) {
    const light = new THREE.SpotLight(color,intensity,26,Math.PI/5,.52,1.3);
    light.position.set(...position); light.target.position.set(...target); light.castShadow=false;
    parent.add(light,light.target);
    return light;
  }

  function buildSceneScaffolding() {
    // OPENING: one scanned physical relief floating above a moving Black Sea surface.
    const openingWater=addWater(opening,{size:46,y:-.78});
    const openingDeck=new THREE.Group(); openingDeck.position.set(.95,0,0); opening.add(openingDeck);
    addPlatform(openingDeck,{width:9.5,depth:10.3,y:-.1});
    addRing(openingDeck,5.02,.018,gold,.11,.92);
    addRing(openingDeck,4.72,.008,cyan,.105,.92);
    const openingSpot=addSpot(opening,0xf2d2a0,115,[2,9,6],[.8,.2,0]);
    const openingRim=addSpot(opening,0x3aa5b1,78,[-7,5,-5],[.5,.2,0]);
    const routePoints=[[-5.7,-.62,3.8],[-4.2,-.60,2.6],[-2.8,-.58,1.6],[-1.1,-.58,.8],[1.0,-.58,-.2],[3.2,-.58,-1.8],[5.6,-.58,-3.2]].map(p=>new THREE.Vector3(...p));
    const routeCurve=new THREE.CatmullRomCurve3(routePoints,false,'centripetal',.32);
    const route=new THREE.Mesh(new THREE.TubeGeometry(routeCurve,220,.014,7,false),new THREE.MeshStandardMaterial({color:0x8fc9c4,emissive:0x1a7d86,emissiveIntensity:.68,metalness:.58,roughness:.25,transparent:true,opacity:.72}));
    opening.add(route);
    const routePulse=new THREE.Mesh(new THREE.SphereGeometry(.07,20,16),warmGlow); opening.add(routePulse);
    const pulseHalo=new THREE.Mesh(new THREE.TorusGeometry(.16,.012,6,36),new THREE.MeshBasicMaterial({color:0x7dd8d5,transparent:true,opacity:.64}));pulseHalo.rotation.x=Math.PI/2;opening.add(pulseHalo);
    const ship=createShip?.({animateSails:true})||new THREE.Group(); ship.scale.setScalar(.88); opening.add(ship);
    const wake=createWake(opening);
    const gulls=addGullFlock(opening,coarsePointer?3:6);
    const particles=addParticles(opening,coarsePointer?150:320,[24,8,22]);
    opening.userData.water=openingWater; opening.userData.deck=openingDeck; opening.userData.routeCurve=routeCurve; opening.userData.routePulse=routePulse; opening.userData.pulseHalo=pulseHalo; opening.userData.ship=ship; opening.userData.wake=wake; opening.userData.gulls=gulls; opening.userData.particles=particles; opening.userData.spots=[openingSpot,openingRim];

    // WORKS: the same scan becomes a museum-grade research object with four physical volumes.
    const worksWater=addWater(works,{size:34,y:-1.38});
    const worksDeck=new THREE.Group(); worksDeck.position.set(.55,.1,0); works.add(worksDeck);
    addPlatform(worksDeck,{width:10.4,depth:8.4,y:-.10});
    addRing(worksDeck,4.35,.018,gold,.22,.84); addRing(worksDeck,4.09,.009,cyan,.205,.84);
    const books=[];
    const bookPositions=[[-3.6,.62,-2.25],[-3.9,.70,2.05],[3.45,.59,-2.25],[3.8,.63,2.05]];
    for(let i=0;i<4;i++){
      const book=createBook(i);book.position.set(...bookPositions[i]);book.rotation.set(.10+(i%2)*.08,[-.36,.45,2.65,-2.35][i],[-.16,.12,.17,-.12][i]);book.scale.setScalar(1.12);worksDeck.add(book);books.push(book);
    }
    const portolanScroll=createPortolanScroll();portolanScroll.position.set(0,.31,3.02);portolanScroll.rotation.y=-.045;portolanScroll.scale.setScalar(.94);worksDeck.add(portolanScroll);
    const worksSpotA=addSpot(works,0xf0ce9d,140,[2.5,10,5],[.2,.4,0]);
    const worksSpotB=addSpot(works,0x4dabb8,95,[-7,6,-4],[0,.3,0]);
    const worksParticles=addParticles(works,coarsePointer?140:280,[20,7,18]);
    works.userData.water=worksWater;works.userData.deck=worksDeck;works.userData.books=books;works.userData.portolanScroll=portolanScroll;works.userData.spots=[worksSpotA,worksSpotB];works.userData.particles=worksParticles;

    // FINALE: six separate, text-matched exhibits. Only the exhibit for the
    // active conclusion is visible; unrelated ship/fortress/terrain models never
    // remain scattered through every chapter of the conclusion.
    const finalStageGroups=Array.from({length:6},(_,i)=>{
      const group=new THREE.Group();group.name=`Final conclusion exhibit ${i+1}`;group.visible=false;
      group.position.x=2.45;finale.add(group);return group;
    });
    const finalSpots=[
      addSpot(finale,0xf5d8a9,150,[1.6,10,7],[2.4,.35,0]),
      addSpot(finale,0x4bb3bd,105,[7.2,6,-5],[2.4,.35,0])
    ];
    const finalParticles=addParticles(finale,coarsePointer?90:180,[20,5,16]);

    // 01 — Brătianu's research: a real volume on an archival desk, not a random scan.
    const archiveExhibit=finalStageGroups[0];
    addPlatform(archiveExhibit,{width:5.6,depth:4.1,y:-.18});
    const archiveBook=createBook(0);archiveBook.position.set(-.15,.62,-.05);archiveBook.rotation.set(.22,-.20,.015);archiveBook.scale.setScalar(1.46);archiveExhibit.add(archiveBook);
    const archiveQuill=new THREE.Group();archiveQuill.position.set(1.45,.43,.55);archiveQuill.rotation.set(.10,0,-.62);archiveExhibit.add(archiveQuill);
    const quillShaft=new THREE.Mesh(new THREE.CylinderGeometry(.018,.026,.92,8),new THREE.MeshStandardMaterial({color:0x8a6845,roughness:.68}));quillShaft.position.y=.44;archiveQuill.add(quillShaft);
    const quillTip=new THREE.Mesh(new THREE.ConeGeometry(.075,.24,7),new THREE.MeshStandardMaterial({color:0xc3b79d,roughness:.82,side:THREE.DoubleSide}));quillTip.position.set(0,.99,0);archiveQuill.add(quillTip);

    // 02 — the medieval Romanian states: the supplied book and a framed regional map.
    const stateExhibit=finalStageGroups[1];
    addPlatform(stateExhibit,{width:6.1,depth:4.5,y:-.18});
    const stateBook=createBook(1);stateBook.position.set(-1.62,.50,.25);stateBook.rotation.set(.18,.48,-.04);stateBook.scale.setScalar(1.28);stateExhibit.add(stateBook);
    const regionalTexture=new THREE.TextureLoader().load(new URL('../assets/chapters/black-sea-strategy/black-sea-regional-map.webp',import.meta.url).href);
    regionalTexture.colorSpace=THREE.SRGBColorSpace;regionalTexture.anisotropy=Math.min(8,renderer.capabilities.getMaxAnisotropy());auxiliaryTextures.push(regionalTexture);
    const mapPanel=new THREE.Group();mapPanel.position.set(.78,1.0,-.48);mapPanel.rotation.y=-.12;stateExhibit.add(mapPanel);
    const mapBacking=new THREE.Mesh(new THREE.BoxGeometry(3.25,2.28,.10),darkMetal);mapBacking.castShadow=true;mapPanel.add(mapBacking);
    const mapFace=new THREE.Mesh(new THREE.PlaneGeometry(3.05,2.08),new THREE.MeshStandardMaterial({map:regionalTexture,roughness:.88,metalness:0,side:THREE.DoubleSide}));mapFace.position.z=.058;mapPanel.add(mapFace);

    // 03 — medieval trade: the vessel, wake and route exist only for the trade chapter.
    const tradeExhibit=finalStageGroups[2];
    const finalWater=addWater(tradeExhibit,{size:35,y:-.92});
    const shipFinal=createShip?.({animateSails:true})||new THREE.Group();shipFinal.scale.setScalar(.72);tradeExhibit.add(shipFinal);
    const finalWake=createWake(tradeExhibit);
    const finalGulls=addGullFlock(tradeExhibit,coarsePointer?2:4);
    const finalPoints=[[-5.6,-.78,3.6],[-4.1,-.77,2.35],[-2.5,-.76,1.25],[-.8,-.75,.40],[1.1,-.75,-.48],[3.0,-.76,-1.55],[5.1,-.78,-2.7]].map(p=>new THREE.Vector3(...p));
    const finalCurve=new THREE.CatmullRomCurve3(finalPoints,false,'centripetal',.38);
    const finalRoute=new THREE.Mesh(new THREE.TubeGeometry(finalCurve,220,.014,7,false),new THREE.MeshStandardMaterial({color:0x9bc9c0,emissive:0x1c7480,emissiveIntensity:.62,metalness:.45,roughness:.28,transparent:true,opacity:.70}));tradeExhibit.add(finalRoute);
    const finalPulse=new THREE.Mesh(new THREE.SphereGeometry(.075,18,14),warmGlow);tradeExhibit.add(finalPulse);
    const waypoints=[];
    for(let i=0;i<6;i++){
      const point=finalCurve.getPointAt(.12+i*.15);
      const marker=new THREE.Group();marker.position.copy(point);tradeExhibit.add(marker);
      const orb=new THREE.Mesh(new THREE.SphereGeometry(.05,14,10),warmGlow);marker.add(orb);
      const halo=new THREE.Mesh(new THREE.TorusGeometry(.13,.008,5,24),new THREE.MeshBasicMaterial({color:0x75d1d0,transparent:true,opacity:.48}));halo.rotation.x=Math.PI/2;marker.add(halo);
      waypoints.push(marker);
    }

    // 04 — Ottoman expansion and regional defensive architecture. The supplied
    // Enisala scan is added to this exhibit only, and is labelled separately in copy.
    const fortressExhibit=finalStageGroups[3];
    addPlatform(fortressExhibit,{width:8.75,depth:8.10,y:-.20});
    const fortressPedestal=new THREE.Mesh(new THREE.BoxGeometry(7.85,.20,7.35),darkStone);fortressPedestal.position.y=.12;fortressPedestal.castShadow=true;fortressPedestal.receiveShadow=true;fortressExhibit.add(fortressPedestal);
    // A contextual architectural fallback is visible immediately while the supplied
    // 70 MB Enisala scan loads. It is an illustrative Dobruja fortress, not Chilia/Caffa.
    const fortressFallback=new THREE.Group();fortressFallback.name='Regional medieval fortress · loading fallback';fortressExhibit.add(fortressFallback);
    const fortressStone=new THREE.MeshStandardMaterial({color:0x8a887d,roughness:.96,metalness:0});
    const fortressShadowStone=new THREE.MeshStandardMaterial({color:0x555a58,roughness:.98,metalness:0});
    const fortressTopStone=new THREE.MeshStandardMaterial({color:0xa39d8d,roughness:.92,metalness:0});
    sceneMaterials.push(fortressStone,fortressShadowStone,fortressTopStone);
    const fortressBase=new THREE.Mesh(new THREE.CylinderGeometry(1.85,1.95,.13,12),fortressShadowStone);fortressBase.position.y=.31;fortressFallback.add(fortressBase);
    const wallVertices=Array.from({length:6},(_,i)=>new THREE.Vector3(Math.cos(i*Math.PI/3)*1.48,.0,Math.sin(i*Math.PI/3)*1.17));
    for(let i=0;i<wallVertices.length;i++){
      const a=wallVertices[i],b=wallVertices[(i+1)%wallVertices.length],dx=b.x-a.x,dz=b.z-a.z;
      const length=Math.hypot(dx,dz),wall=new THREE.Mesh(new THREE.BoxGeometry(length,1.02,.17),fortressStone);
      wall.position.set((a.x+b.x)/2,.88,(a.z+b.z)/2);wall.rotation.y=Math.atan2(-dz,dx);wall.castShadow=true;wall.receiveShadow=true;fortressFallback.add(wall);
      const parapet=new THREE.Mesh(new THREE.BoxGeometry(length,.13,.21),fortressTopStone);parapet.position.set((a.x+b.x)/2,1.455,(a.z+b.z)/2);parapet.rotation.y=wall.rotation.y;fortressFallback.add(parapet);
      const merlons=Math.max(2,Math.floor(length/.34));
      for(let j=0;j<=merlons;j++){
        const t=j/merlons,crenel=new THREE.Mesh(new THREE.BoxGeometry(.13,.20,.22),fortressTopStone);
        crenel.position.set(a.x+dx*t,1.60,a.z+dz*t);crenel.castShadow=true;fortressFallback.add(crenel);
      }
    }
    wallVertices.forEach((point,i)=>{
      const tower=new THREE.Group();tower.position.set(point.x,.24,point.z);fortressFallback.add(tower);
      const shaft=new THREE.Mesh(new THREE.CylinderGeometry(.255,.31,1.58,12),fortressStone);shaft.position.y=.79;shaft.castShadow=true;shaft.receiveShadow=true;tower.add(shaft);
      const crown=new THREE.Mesh(new THREE.CylinderGeometry(.30,.30,.16,12),fortressTopStone);crown.position.y=1.63;tower.add(crown);
      for(let k=0;k<8;k++){
        const angle=k/8*Math.PI*2,merlon=new THREE.Mesh(new THREE.BoxGeometry(.12,.22,.13),fortressTopStone);
        merlon.position.set(Math.cos(angle)*.245,1.81,Math.sin(angle)*.245);merlon.rotation.y=angle;merlon.castShadow=true;tower.add(merlon);
      }
      const slit=new THREE.Mesh(new THREE.BoxGeometry(.055,.34,.012),fortressShadowStone);slit.position.set(0,.90,.307);tower.add(slit);
    });
    const keep=new THREE.Mesh(new THREE.BoxGeometry(.94,1.28,.82),fortressShadowStone);keep.position.set(-.08,.95,-.06);keep.castShadow=true;keep.receiveShadow=true;fortressFallback.add(keep);
    const keepCap=new THREE.Mesh(new THREE.BoxGeometry(1.05,.14,.93),fortressTopStone);keepCap.position.set(-.08,1.66,-.06);fortressFallback.add(keepCap);
    const gateMaterial=new THREE.MeshStandardMaterial({color:0x272d2b,roughness:1});sceneMaterials.push(gateMaterial);
    const gate=new THREE.Mesh(new THREE.BoxGeometry(.38,.66,.035),gateMaterial);gate.position.set(0,.57,1.185);fortressFallback.add(gate);
    const gateLintel=new THREE.Mesh(new THREE.BoxGeometry(.68,.13,.22),fortressTopStone);gateLintel.position.set(0,1.02,1.18);fortressFallback.add(gateLintel);
    fortressFallback.userData.materials=[fortressStone,fortressShadowStone,fortressTopStone];

    // 05 — present-day Constanța: a compact, physically modelled container terminal.
    const portExhibit=finalStageGroups[4];
    const portDeck=new THREE.Mesh(new THREE.BoxGeometry(8.2,.34,4.9),new THREE.MeshStandardMaterial({color:0x343b3b,roughness:.9,metalness:.08}));portDeck.position.y=-.24;portDeck.receiveShadow=true;portExhibit.add(portDeck);
    const quayLine=new THREE.Mesh(new THREE.BoxGeometry(8.35,.045,.10),gold);quayLine.position.set(0,-.035,2.39);portExhibit.add(quayLine);
    const containerMats=[0x9d5945,0x354e5b,0x8a7653,0x526c67].map(color=>new THREE.MeshStandardMaterial({color,roughness:.72,metalness:.12}));
    const containers=[];
    for(let row=0;row<2;row++)for(let i=0;i<5;i++){
      const box=new THREE.Mesh(new THREE.BoxGeometry(.82,.55,.72),containerMats[(i+row*2)%containerMats.length]);
      box.position.set(-2.0+i*.88,.22+row*.56,-.55+(row%2)*.72);box.castShadow=true;box.receiveShadow=true;portExhibit.add(box);containers.push(box);
    }
    function addGantryCrane(parent,x,z,phase=0){
      const crane=new THREE.Group();crane.position.set(x,0,z);parent.add(crane);
      const steel=new THREE.MeshStandardMaterial({color:0x53636a,metalness:.54,roughness:.42});
      const beam=(w,h,d,px,py,pz)=>{const m=new THREE.Mesh(new THREE.BoxGeometry(w,h,d),steel);m.position.set(px,py,pz);m.castShadow=true;crane.add(m);return m;};
      beam(.18,3.45,.18,-.78,1.70,0);beam(.18,3.45,.18,.78,1.70,0);
      beam(2.15,.22,.25,0,3.40,0);beam(1.86,.12,.17,0,3.17,0);
      beam(.16,.42,.18,-.78,.24,0);beam(.16,.42,.18,.78,.24,0);
      const trolley=beam(.46,.26,.38,.18,3.16,.02);trolley.material=steel;
      const cableMat=new THREE.MeshStandardMaterial({color:0x242c30,metalness:.68,roughness:.46});
      const cable=new THREE.Mesh(new THREE.CylinderGeometry(.018,.018,1.18,8),cableMat);cable.position.set(.18,2.46,.02);crane.add(cable);
      const spreader=beam(.92,.09,.42,.18,1.86,.02);
      crane.userData.trolley=trolley;crane.userData.cable=cable;crane.userData.spreader=spreader;crane.userData.phase=phase;
      return crane;
    }
    const portCranes=[addGantryCrane(portExhibit,-2.65,-1.55,.3),addGantryCrane(portExhibit,2.75,-1.50,1.7)];
    // A modern cargo vessel is represented separately from the medieval galley.
    const cargoHullShape=new THREE.Shape();cargoHullShape.moveTo(-2.15,.12);cargoHullShape.lineTo(2.2,.12);cargoHullShape.lineTo(1.78,-.52);cargoHullShape.lineTo(-1.78,-.52);cargoHullShape.closePath();
    const cargoHull=new THREE.Mesh(new THREE.ExtrudeGeometry(cargoHullShape,{depth:1.08,bevelEnabled:true,bevelSegments:2,steps:1,bevelSize:.05,bevelThickness:.05}),new THREE.MeshStandardMaterial({color:0x203a48,metalness:.48,roughness:.4}));
    cargoHull.position.set(.28,.12,1.0);cargoHull.castShadow=true;portExhibit.add(cargoHull);
    const cargoBridge=new THREE.Mesh(new THREE.BoxGeometry(.70,.82,.82),new THREE.MeshStandardMaterial({color:0xe0ddd0,roughness:.65}));cargoBridge.position.set(-1.55,.70,1.50);cargoBridge.castShadow=true;portExhibit.add(cargoBridge);
    const cargoContainers=[];
    for(let i=0;i<4;i++){
      const box=new THREE.Mesh(new THREE.BoxGeometry(.62,.45,.46),containerMats[(i+1)%containerMats.length]);box.position.set(-.82+i*.68,.48,1.28);box.castShadow=true;portExhibit.add(box);cargoContainers.push(box);
    }

    // 06 — Black Sea geopolitics and ecosystem: a genuine displaced bathymetric relief.
    const ecologyExhibit=finalStageGroups[5];
    const reliefBase=new THREE.Mesh(new THREE.BoxGeometry(9.5,.44,6.9),darkStone);reliefBase.position.y=-.47;reliefBase.castShadow=true;reliefBase.receiveShadow=true;ecologyExhibit.add(reliefBase);
    const reliefRim=new THREE.Mesh(new THREE.BoxGeometry(9.28,.10,6.68),gold);reliefRim.position.y=-.205;ecologyExhibit.add(reliefRim);
    const reliefTexture=new THREE.TextureLoader().load(new URL('../assets/black-sea-relief-albedo-detail.webp',import.meta.url).href);
    const reliefHeight=new THREE.TextureLoader().load(new URL('../assets/black-sea-height.webp',import.meta.url).href);
    reliefTexture.colorSpace=THREE.SRGBColorSpace;reliefHeight.colorSpace=THREE.NoColorSpace;
    reliefTexture.anisotropy=Math.min(8,renderer.capabilities.getMaxAnisotropy());
    auxiliaryTextures.push(reliefTexture,reliefHeight);
    const reliefGeometry=new THREE.PlaneGeometry(9.12,6.52,160,116);reliefGeometry.rotateX(-Math.PI/2);
    const reliefMaterial=new THREE.MeshStandardMaterial({map:reliefTexture,displacementMap:reliefHeight,displacementScale:.68,displacementBias:-.25,roughness:.83,metalness:.02,side:THREE.DoubleSide});
    const bathymetryRelief=new THREE.Mesh(reliefGeometry,reliefMaterial);bathymetryRelief.position.y=-.145;bathymetryRelief.receiveShadow=true;ecologyExhibit.add(bathymetryRelief);
    const reliefGrid=new THREE.GridHelper(9.0,24,0x8eaa9f,0x465d5d);reliefGrid.position.y=-.12;reliefGrid.material.transparent=true;reliefGrid.material.opacity=.11;ecologyExhibit.add(reliefGrid);

    finale.userData.stageGroups=finalStageGroups;finale.userData.activeStage=-1;
    finale.userData.water=finalWater;finale.userData.ship=shipFinal;finale.userData.wake=finalWake;finale.userData.gulls=finalGulls;
    finale.userData.spots=finalSpots;finale.userData.routeCurve=finalCurve;finale.userData.routePulse=finalPulse;finale.userData.waypoints=waypoints;
    finale.userData.portCranes=portCranes;finale.userData.containers=containers;finale.userData.cargoContainers=cargoContainers;finale.userData.fortressFallback=fortressFallback;
    finale.userData.bathymetry=bathymetryRelief;
  }
  buildSceneScaffolding();

  // ADONIS / CHAPTER 03 — offshore resources, vulnerable ecosystem and safe
  // civilian navigation. The platform is a procedural illustrative model based
  // on the reference photo supplied by the user; it is not a replica of Neptun Deep.
  const adonisMaterials=[];
  const adonisFish=[];
  let adonisRig=null, adonisWaterMaterial=null, adonisWaterShader=null;
  let adonisCargoShip=null, adonisCargoCurve=null, adonisNavigationBeacons=[], adonisNavigationRouteObjects=[];
  let adonisAlgaePlume=null, adonisPlankton=null, adonisOilLights=[];
  let adonisFactIndex=0;
  function adMat(material){adonisMaterials.push(material);return material;}
  function adBeam(parent,a,b,radius,material,radial=8){
    const start=new THREE.Vector3(...a),end=new THREE.Vector3(...b),delta=end.clone().sub(start);
    const mesh=new THREE.Mesh(new THREE.CylinderGeometry(radius,radius,delta.length(),radial),material);
    mesh.position.copy(start).add(end).multiplyScalar(.5);
    mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0,1,0),delta.normalize());
    mesh.castShadow=false;mesh.receiveShadow=true;parent.add(mesh);return mesh;
  }
  function adBox(parent,geometry,material,position,rotation=null){
    const mesh=new THREE.Mesh(geometry,material);mesh.position.set(...position);if(rotation)mesh.rotation.set(...rotation);mesh.castShadow=false;mesh.receiveShadow=true;parent.add(mesh);return mesh;
  }
  function makeAdonisFloorTexture(){
    const canvas=document.createElement('canvas');canvas.width=512;canvas.height=512;const ctx=canvas.getContext('2d');
    const grad=ctx.createLinearGradient(0,0,512,512);grad.addColorStop(0,'#3b4a43');grad.addColorStop(.55,'#263c3b');grad.addColorStop(1,'#162c32');ctx.fillStyle=grad;ctx.fillRect(0,0,512,512);
    for(let i=0;i<10500;i++){const x=(i*197)%512,y=(i*313)%512;const alpha=.025+(i%7)*.006;ctx.fillStyle=i%5===0?`rgba(176,151,111,${alpha})`:`rgba(166,200,183,${alpha*.65})`;ctx.fillRect(x,y,1+(i%3),1+(i%2));}
    for(let i=0;i<38;i++){const y=i*14;ctx.strokeStyle=`rgba(153,178,157,${.025+(i%4)*.008})`;ctx.lineWidth=1;ctx.beginPath();ctx.moveTo(0,y);ctx.bezierCurveTo(120,y+8,320,y-9,512,y+4);ctx.stroke();}
    const tex=new THREE.CanvasTexture(canvas);tex.colorSpace=THREE.SRGBColorSpace;tex.wrapS=tex.wrapT=THREE.RepeatWrapping;tex.repeat.set(2.5,1.7);auxiliaryTextures.push(tex);return tex;
  }
  const adonisFishBodyGeometry=new THREE.SphereGeometry(.18,12,8);
  const adonisFishTailShape=new THREE.Shape();adonisFishTailShape.moveTo(-.15,0);adonisFishTailShape.lineTo(-.47,.24);adonisFishTailShape.lineTo(-.43,0);adonisFishTailShape.lineTo(-.47,-.24);adonisFishTailShape.closePath();
  const adonisFishTailGeometry=new THREE.ShapeGeometry(adonisFishTailShape);
  const adonisFishDorsalGeometry=new THREE.ConeGeometry(.10,.23,4);
  const adonisFishMaterials=[
    adMat(new THREE.MeshStandardMaterial({color:0xa7c6c4,roughness:.42,metalness:.16,envMap:environment,envMapIntensity:.32})),
    adMat(new THREE.MeshStandardMaterial({color:0x829fa0,roughness:.46,metalness:.14,envMap:environment,envMapIntensity:.30})),
    adMat(new THREE.MeshStandardMaterial({color:0xb4c5bb,roughness:.48,metalness:.12,envMap:environment,envMapIntensity:.28}))
  ];
  const adonisFishFinMaterial=adMat(new THREE.MeshStandardMaterial({color:0x829e9c,roughness:.57,metalness:.08,side:THREE.DoubleSide}));
  function createAdonisFish({size=1,color=0xa7c6c4,phase=0,depth=-1.7,flat=false}={}){
    const fish=new THREE.Group();fish.userData.phase=phase;fish.userData.depth=depth;fish.userData.base=new THREE.Vector3((Math.random()-.5)*7,depth,(Math.random()-.5)*5);
    const material=adonisFishMaterials[color===0x829fa0?1:color===0xb4c5bb?2:0];
    const body=new THREE.Mesh(adonisFishBodyGeometry,material);body.scale.set(flat?1.35:1.55,flat?.30:.58,.60);fish.add(body);
    const tail=new THREE.Mesh(adonisFishTailGeometry,adonisFishFinMaterial);tail.position.x=-.22;fish.add(tail);
    const dorsal=new THREE.Mesh(adonisFishDorsalGeometry,adonisFishFinMaterial);dorsal.position.set(.02,.12,0);dorsal.rotation.z=Math.PI;dorsal.scale.set(.65,.8,.7);fish.add(dorsal);
    fish.scale.setScalar(size);adonisScene.add(fish);adonisFish.push(fish);return fish;
  }
  function buildAdonisScene(){
    const root=new THREE.Group();root.name='Adonis chapter · offshore and ecosystem cutaway';adonisScene.add(root);
    const ambient=new THREE.HemisphereLight(0x9cc7cb,0x13252a,1.35);adonisScene.add(ambient);
    const key=new THREE.DirectionalLight(0xf5d9b0,2.15);key.position.set(7,10,6);adonisScene.add(key);
    const rim=new THREE.DirectionalLight(0x4aaeb7,1.5);rim.position.set(-8,5,-5);adonisScene.add(rim);
    const waterGeo=new THREE.PlaneGeometry(25,19,coarsePointer?34:58,coarsePointer?26:44);waterGeo.rotateX(-Math.PI/2);
    adonisWaterMaterial=adMat(new THREE.MeshPhysicalMaterial({color:0x43828c,roughness:.22,metalness:.14,clearcoat:.82,clearcoatRoughness:.14,transparent:true,opacity:.34,depthWrite:false,side:THREE.DoubleSide,envMap:environment,envMapIntensity:.62}));
    adonisWaterMaterial.onBeforeCompile=shader=>{shader.uniforms.uAdonisTime={value:0};shader.vertexShader=shader.vertexShader.replace('#include <common>','#include <common>\nuniform float uAdonisTime;');shader.vertexShader=shader.vertexShader.replace('#include <begin_vertex>',`#include <begin_vertex>\nfloat wa=sin(position.x*.65+uAdonisTime*.48)*.045;float wb=sin(position.z*1.05-uAdonisTime*.37)*.025;transformed.y+=wa+wb;`);adonisWaterShader=shader;};
    adonisWaterMaterial.customProgramCacheKey=()=> 'pontus-adonis-water-v1';
    const water=new THREE.Mesh(waterGeo,adonisWaterMaterial);water.position.y=.18;water.renderOrder=2;root.add(water);

    const floorGeo=new THREE.PlaneGeometry(23,17,coarsePointer?34:70,coarsePointer?26:52);floorGeo.rotateX(-Math.PI/2);
    const floorAttr=floorGeo.attributes.position;
    for(let i=0;i<floorAttr.count;i++){const x=floorAttr.getX(i),z=floorAttr.getZ(i);floorAttr.setY(i,.11*Math.sin(x*.34+z*.19)+.075*Math.cos(z*.62)+.04*Math.sin(x*.91));}
    floorGeo.computeVertexNormals();
    const floorMat=adMat(new THREE.MeshStandardMaterial({map:makeAdonisFloorTexture(),color:0xffffff,roughness:.96,metalness:.015}));
    const floor=new THREE.Mesh(floorGeo,floorMat);floor.position.y=-3.55;floor.receiveShadow=true;root.add(floor);
    // Three illustrative geological layers under the waterline; no precise deposit coordinates are implied.
    const strataMat=adMat(new THREE.MeshStandardMaterial({color:0x8d7657,roughness:.9,transparent:true,opacity:.26,side:THREE.DoubleSide}));
    for(let i=0;i<3;i++){
      const layer=new THREE.Mesh(new THREE.PlaneGeometry(17-i*1.1,.13),strataMat);layer.rotation.x=-Math.PI/2;layer.position.set(-.2,-3.28-i*.20,.15+i*.32);layer.rotation.z=(i-1)*.045;root.add(layer);
    }
    const reservoirGold=adMat(new THREE.MeshStandardMaterial({color:0xc7a36d,emissive:0x5d3514,emissiveIntensity:.52,roughness:.38,metalness:.38}));
    const reservoirCyan=adMat(new THREE.MeshStandardMaterial({color:0x48aeb7,emissive:0x176c75,emissiveIntensity:.75,roughness:.32,metalness:.34}));
    for(let i=0;i<4;i++){
      const points=[[-5+i*.45,-3.08,-2.4+i*.95],[-3.5+i*.35,-3.02,-1.2+i*.86],[-1.3+i*.24,-3.10,-.5+i*.72],[.5+i*.22,-3.04,.35+i*.65],[2.6+i*.18,-3.11,.75+i*.45]].map(v=>new THREE.Vector3(...v));
      const curve=new THREE.CatmullRomCurve3(points);const tube=new THREE.Mesh(new THREE.TubeGeometry(curve,70,.018+(i%2)*.008,7,false),i%2?reservoirCyan:reservoirGold);root.add(tube);
    }
    const reservoirs=new THREE.Group();
    for(let i=0;i<5;i++){const pocket=new THREE.Mesh(new THREE.SphereGeometry(.33+(i%2)*.1,16,12),i%2?reservoirCyan:reservoirGold);pocket.scale.set(1.9,.38,.75);pocket.position.set(-3.7+i*1.7,-3.02,1.35+Math.sin(i*1.8)*.45);reservoirs.add(pocket);}
    root.add(reservoirs);

    // Semi-submersible offshore drilling unit modeled after the supplied reference photograph.
    adonisRig=new THREE.Group();adonisRig.name='Platformă offshore · model 3D ilustrativ';root.add(adonisRig);
    const steel=adMat(new THREE.MeshStandardMaterial({color:0x647579,metalness:.68,roughness:.38,envMap:environment,envMapIntensity:.44}));
    const steelDark=adMat(new THREE.MeshStandardMaterial({color:0x263b42,metalness:.58,roughness:.48}));
    const deckMat=adMat(new THREE.MeshStandardMaterial({color:0x8a8c7f,metalness:.32,roughness:.66}));
    const safety=adMat(new THREE.MeshStandardMaterial({color:0xc77b3d,metalness:.22,roughness:.48}));
    const white=adMat(new THREE.MeshStandardMaterial({color:0xc7cebf,metalness:.16,roughness:.5}));
    const darkRubber=adMat(new THREE.MeshStandardMaterial({color:0x18272d,metalness:.22,roughness:.82}));
    // Twin submerged pontoons and four buoyancy columns.
    for(const x of [-2.35,2.35]){
      const pontoon=adBox(adonisRig,new THREE.BoxGeometry(1.08,.78,6.35),darkRubber,[x,-1.08,0]);
      pontoon.rotation.z=x<0?-.018:.018;
      for(const z of [-2.0,2.0]){
        const column=new THREE.Mesh(new THREE.CylinderGeometry(.34,.43,2.62,18),steel);column.position.set(x,.12,z);column.castShadow=false;adonisRig.add(column);
        const collar=adBox(adonisRig,new THREE.CylinderGeometry(.455,.455,.16,18),safety,[x,-.58,z]);
        const topCollar=adBox(adonisRig,new THREE.CylinderGeometry(.39,.39,.11,18),white,[x,1.37,z]);
        adBeam(adonisRig,[x,.94,z],[x*.90,1.44,z*.90],.045,steelDark,7);
      }
      // Pontoon cross ties and access walkways.
      adBeam(adonisRig,[x,-.64,-2.9],[x,-.64,2.9],.07,steel,8);
    }
    // Cross-bracing beneath deck; the orange collars and steel diagonal braces read clearly against water.
    for(const z of [-2,2]){
      adBeam(adonisRig,[-2.35,-.60,z],[2.35,.78,z],.055,steelDark,8);
      adBeam(adonisRig,[2.35,-.60,z],[-2.35,.78,z],.055,steelDark,8);
    }
    for(const x of [-2.35,2.35]){
      adBeam(adonisRig,[x,-.62,-2],[x,.76,2],.05,steelDark,8);
      adBeam(adonisRig,[x,-.62,2],[x,.76,-2],.05,steelDark,8);
    }
    // Main working deck and underside beams.
    adBox(adonisRig,new THREE.BoxGeometry(7.25,.34,5.05),deckMat,[0,1.55,0]);
    for(const x of [-3.2,-1.6,0,1.6,3.2])adBeam(adonisRig,[x,1.16,-2.35],[x,1.16,2.35],.06,steelDark,7);
    for(const z of [-2.25,-.75,.75,2.25])adBeam(adonisRig,[-3.45,1.17,z],[3.45,1.17,z],.055,steel,7);
    // Outer guardrails and stanchions.
    const railY=1.88;for(const z of [-2.4,2.4])for(let i=0;i<=14;i++){const x=-3.38+i*.483;adBeam(adonisRig,[x,1.72,z],[x,railY,z],.018,safety,6);}
    for(const x of [-3.38,3.38])for(let i=0;i<=9;i++){const z=-2.4+i*.53;adBeam(adonisRig,[x,1.72,z],[x,railY,z],.018,safety,6);}
    for(const z of [-2.4,2.4]){adBeam(adonisRig,[-3.38,railY,z],[3.38,railY,z],.022,white,6);adBeam(adonisRig,[-3.38,1.80,z],[3.38,1.80,z],.014,steelDark,6);}
    for(const x of [-3.38,3.38]){adBeam(adonisRig,[x,railY,-2.4],[x,railY,2.4],.022,white,6);adBeam(adonisRig,[x,1.80,-2.4],[x,1.80,2.4],.014,steelDark,6);}
    // Compact processing modules, pipework and utility equipment.
    const modules=[[-2.15,1.98,-1.1,1.15,.55,1.15],[2.20,1.98,1.1,1.35,.56,1.10],[-2.35,2.15,1.3,.72,.82,.72],[2.35,2.02,-1.25,.78,.62,.84]];
    modules.forEach(([x,y,z,w,h,d],i)=>{adBox(adonisRig,new THREE.BoxGeometry(w,h,d),i%2?white:steelDark,[x,y,z]);adBox(adonisRig,new THREE.BoxGeometry(w*.82,.055,.045),safety,[x,y+h*.18,z+d*.51]);});
    for(let i=0;i<6;i++){const pipe=new THREE.Mesh(new THREE.CylinderGeometry(.045,.045,2.6,10),i%2?safety:steel);pipe.rotation.z=Math.PI/2;pipe.position.set(-.8+i*.32,2.02,1.82);adonisRig.add(pipe);}
    // The central drilling derrick: four tapered legs with repeated cross-bracing and crown block.
    const derrick=new THREE.Group();derrick.position.set(0,1.79,-.18);adonisRig.add(derrick);
    const derrickLevels=8,baseW=1.55,topW=.72,height=4.95;
    const cornerAt=(level,index)=>{const t=level/derrickLevels,w=baseW+(topW-baseW)*t,h=height*t;return [[-w/2,w/2,w/2,-w/2][index],h,[-.72,-.72,.72,.72][index]];};
    for(let i=0;i<4;i++){const a=cornerAt(0,i),b=cornerAt(derrickLevels,i);adBeam(derrick,a,b,.055,steelDark,8);}
    for(let level=0;level<=derrickLevels;level++){
      const coords=Array.from({length:4},(_,i)=>cornerAt(level,i));
      for(let i=0;i<4;i++)adBeam(derrick,coords[i],coords[(i+1)%4],.035,steel,7);
      if(level<derrickLevels){const upper=Array.from({length:4},(_,i)=>cornerAt(level+1,i));for(let i=0;i<4;i++){adBeam(derrick,coords[i],upper[(i+1)%4],.025,steelDark,6);adBeam(derrick,coords[(i+1)%4],upper[i],.025,steelDark,6);}}
    }
    adBeam(derrick,[0,.15,0],[0,height+.55,0],.045,darkMetal,8);
    const crown=adBox(derrick,new THREE.BoxGeometry(1.0,.32,.9),safety,[0,height+.06,0]);
    for(let i=0;i<3;i++){const pulley=new THREE.Mesh(new THREE.CylinderGeometry(.20,.20,.12,18),darkMetal);pulley.rotation.x=Math.PI/2;pulley.position.set(0,height+.22,i*.16-.16);derrick.add(pulley);}
    const drillHoist=new THREE.Group();drillHoist.name='Derrick traveling block · slow vertical service motion';drillHoist.position.set(0,height-.32,0);derrick.add(drillHoist);
    adBeam(drillHoist,[0,0,0],[0,-.74,0],.014,steelDark,7);
    adBox(drillHoist,new THREE.BoxGeometry(.28,.25,.22),safety,[0,-.88,0]);
    const hookArc=new THREE.Mesh(new THREE.TorusGeometry(.095,.018,8,18,Math.PI*1.55),steelDark);hookArc.position.set(0,-1.04,.015);hookArc.rotation.z=Math.PI*.18;drillHoist.add(hookArc);
    adonisRig.userData.drillHoist=drillHoist;adonisRig.userData.drillHoistBaseY=drillHoist.position.y;
    // Side crane and its cable/spreader, matching the industrial silhouette in the user's photo.
    const crane=new THREE.Group();crane.position.set(-2.55,1.96,-.65);adonisRig.add(crane);
    adBeam(crane,[0,0,0],[-.12,1.55,0],.065,safety,8);adBeam(crane,[-.1,1.50,0],[1.9,2.30,0],.052,steel,8);adBeam(crane,[-.1,1.50,0],[1.25,2.05,.02],.026,steelDark,6);adBeam(crane,[1.88,2.30,0],[1.88,.88,0],.014,darkMetal,6);
    adBox(crane,new THREE.BoxGeometry(.70,.10,.24),safety,[1.88,.84,0]);
    // Work lights and small beacons.
    const lampMat=adMat(new THREE.MeshStandardMaterial({color:0xffd58e,emissive:0xffa84c,emissiveIntensity:2.0}));
    for(const pos of [[-3.0,2.02,-2.0],[3.0,2.02,-2.0],[-3.0,2.02,2.0],[3.0,2.02,2.0],[0,6.95,-.18]]){
      const lamp=adBox(adonisRig,new THREE.SphereGeometry(.055,10,8),lampMat,pos);lamp.scale.set(1,.8,1);adonisOilLights.push(lamp);
      const light=new THREE.PointLight(0xffbe78,8,4,.9);light.position.set(...pos);adonisRig.add(light);adonisOilLights.push(light);
    }
    // Small ladders, pipe racks and access gantries on the deck.
    for(const x of [-.95,.95]){adBeam(adonisRig,[x,1.75,-1.15],[x,4.30,-1.15],.018,safety,6);for(let j=0;j<13;j++)adBeam(adonisRig,[x-.12,1.85+j*.19,-1.15],[x+.12,1.85+j*.19,-1.15],.012,white,5);}

    // Marine life: multiple schools plus two larger sturgeon silhouettes near the seabed.
    const shoalA=[];for(let i=0;i<(coarsePointer?8:15);i++){const fish=createAdonisFish({size:.45+(i%4)*.08,color:i%3===0?0xb4c8c1:0x6f9699,phase:i*.62,depth:-1.0-(i%4)*.21});fish.userData.base.set(-4.2+(i%5)*.66,-1.05-(i%4)*.22,-1.5+Math.floor(i/5)*.8);shoalA.push(fish);}
    const shoalB=[];for(let i=0;i<(coarsePointer?6:10);i++){const fish=createAdonisFish({size:.68+(i%3)*.08,color:0x829fa0,phase:i*.78+1.7,depth:-2.0-(i%3)*.14});fish.userData.base.set(1.0+(i%4)*.62,-2.0-(i%3)*.14,-2.4+Math.floor(i/4)*.9);shoalB.push(fish);}
    const sturgeonMat=adMat(new THREE.MeshStandardMaterial({color:0x7b8c82,roughness:.74,metalness:.04}));
    const sturgeons=[];for(let i=0;i<2;i++){const fish=new THREE.Group();const body=adBox(fish,new THREE.SphereGeometry(.26,18,12),sturgeonMat,[0,0,0]);body.scale.set(1.95,.62,.62);const snout=adBox(fish,new THREE.ConeGeometry(.095,.55,10),sturgeonMat,[.50,.015,0],[0,0,-Math.PI/2]);snout.scale.set(1,.62,1);for(let j=0;j<5;j++){const scute=adBox(fish,new THREE.SphereGeometry(.035,7,6),white,[-.42+j*.20,.15,0]);scute.scale.set(1,.5,1);}fish.position.set(-1.5+i*2.5,-2.8,.35+i*.9);fish.scale.setScalar(1.1);fish.userData.base=fish.position.clone();fish.userData.phase=i*2.6;adonisScene.add(fish);sturgeons.push(fish);adonisFish.push(fish);}

    // River plume and a restrained set of floating debris/algae markers; purely illustrative.
    const plumeMat=adMat(new THREE.MeshBasicMaterial({color:0x5a9d7e,transparent:true,opacity:.13,depthWrite:false,side:THREE.DoubleSide}));
    adonisAlgaePlume=new THREE.Group();adonisAlgaePlume.name='River plume and eutrophication visualisation';
    for(let i=0;i<5;i++){const plume=new THREE.Mesh(new THREE.CircleGeometry(1.05+i*.24,48),plumeMat);plume.rotation.x=-Math.PI/2;plume.position.set(-5.4+i*.55,.205-i*.006,-2.7+i*.24);plume.scale.set(1.0+i*.10,.62+i*.09,1);adonisAlgaePlume.add(plume);}
    const algaeMat=adMat(new THREE.MeshStandardMaterial({color:0x7ab58a,emissive:0x1f553d,emissiveIntensity:.55,roughness:.58,transparent:true,opacity:.82}));
    const microplasticMat=adMat(new THREE.MeshStandardMaterial({color:0xb9c6c0,roughness:.78,metalness:.12}));
    for(let i=0;i<14;i++){const debris=adBox(adonisAlgaePlume,new THREE.BoxGeometry(.035+(i%3)*.012,.022,.025),i%4===0?microplasticMat:algaeMat,[-6.0+(i%7)*.63,.23+Math.sin(i*1.3)*.06,-3.0+Math.floor(i/7)*.55],[i*.17,i*.31,i*.11]);}
    adonisScene.add(adonisAlgaePlume);
    adonisPlankton=addParticles(adonisScene,coarsePointer?90:180,[15,2.4,10]);adonisPlankton.position.y=-.75;adonisPlankton.material.color.setHex(0x8cc9a6);adonisPlankton.material.opacity=.28;

    // Civilian cargo route and navigation buoys; risk is represented abstractly, not tactically.
    adonisCargoShip=new THREE.Group();adonisCargoShip.name='Nava comercială · coridor pontic';
    const hullMat=adMat(new THREE.MeshStandardMaterial({color:0x253f4b,metalness:.5,roughness:.4}));
    const hull=adBox(adonisCargoShip,new THREE.BoxGeometry(2.75,.36,.68),hullMat,[0,0,0]);hull.scale.set(1,.78,1);hull.rotation.z=.025;
    const bow=adBox(adonisCargoShip,new THREE.ConeGeometry(.38,.58,4),hullMat,[1.55,-.02,0],[0,0,-Math.PI/2]);
    const deckShip=adBox(adonisCargoShip,new THREE.BoxGeometry(1.72,.15,.60),deckMat,[-.10,.23,0]);
    for(let row=0;row<2;row++)for(let col=0;col<4;col++)adBox(adonisCargoShip,new THREE.BoxGeometry(.34,.28,.27),[safety,steel,white,steelDark][(row+col)%4],[-.82+col*.42,.45+row*.27,0]);
    adBox(adonisCargoShip,new THREE.BoxGeometry(.48,.55,.48),white,[-1.02,.48,0]);
    adonisScene.add(adonisCargoShip);
    const routePts=[[-6,.24,3.5],[-4,.25,2.7],[-1.5,.25,2.2],[.8,.25,2.7],[3.4,.25,2.1],[6,.24,1.2]].map(v=>new THREE.Vector3(...v));
    adonisCargoCurve=new THREE.CatmullRomCurve3(routePts,false,'centripetal',.38);
    const routeMat=adMat(new THREE.MeshStandardMaterial({color:0x7bd4cc,emissive:0x1c6973,emissiveIntensity:.9,metalness:.45,roughness:.26,transparent:true,opacity:.82}));
    const route=new THREE.Mesh(new THREE.TubeGeometry(adonisCargoCurve,120,.014,6,false),routeMat);adonisScene.add(route);adonisNavigationRouteObjects.push(route);
    const routeSecondary=new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3([[-5,.235,-3.1],[-2.7,.24,-2.7],[0,.24,-3.15],[2.8,.24,-2.65],[5.7,.235,-3.3]].map(v=>new THREE.Vector3(...v)),false,'centripetal',.4),90,.009,5,false),routeMat);adonisScene.add(routeSecondary);adonisNavigationRouteObjects.push(routeSecondary);
    const buoyMat=adMat(new THREE.MeshStandardMaterial({color:0xc37e48,emissive:0x743b17,emissiveIntensity:.4,roughness:.46}));
    for(const pos of [[-3.7,.28,2.55],[.4,.28,2.62],[4.8,.28,1.58]]){const buoy=new THREE.Group();const float=adBox(buoy,new THREE.CylinderGeometry(.12,.18,.26,12),buoyMat,[0,0,0]);const mast=adBox(buoy,new THREE.CylinderGeometry(.018,.018,.42,7),white,[0,.28,0]);const beacon=adBox(buoy,new THREE.SphereGeometry(.065,10,8),lampMat,[0,.53,0]);buoy.position.set(...pos);adonisScene.add(buoy);adonisNavigationBeacons.push(buoy);}
    // Camera targets define the three reading beats in the supplied Adonis section.
    adonisCamera.userData.poses=[
      {position:new THREE.Vector3(9.2,6.1,10.6),target:new THREE.Vector3(0,1.18,0)},
      {position:new THREE.Vector3(7.0,1.4,8.4),target:new THREE.Vector3(-.5,-1.75,-.3)},
      {position:new THREE.Vector3(8.8,5.1,10.2),target:new THREE.Vector3(1.25,.55,1.15)}
    ];
    adonisScene.userData.root=root;adonisScene.userData.rig=adonisRig;adonisScene.userData.shoalA=shoalA;adonisScene.userData.shoalB=shoalB;adonisScene.userData.sturgeons=sturgeons;adonisScene.userData.reservoirs=reservoirs;adonisScene.userData.plankton=adonisPlankton;
    setAdonisFact(0);
  }
  function setAdonisFact(index){
    adonisFactIndex=THREE.MathUtils.clamp(Math.floor(Number(index)||0),0,2);
    const pose=adonisCamera.userData.poses?.[adonisFactIndex];if(pose){adonisDesiredPosition.copy(pose.position);adonisDesiredTarget.copy(pose.target);}
    if(adonisAlgaePlume)adonisAlgaePlume.visible=adonisFactIndex===1;
    if(adonisScene.userData.plankton)adonisScene.userData.plankton.visible=adonisFactIndex===1;
    if(adonisScene.userData.reservoirs)adonisScene.userData.reservoirs.visible=adonisFactIndex===0;
    const marineLifeVisible=adonisFactIndex!==2;
    [...(adonisScene.userData.shoalA||[]),...(adonisScene.userData.shoalB||[]),...(adonisScene.userData.sturgeons||[])].forEach(fish=>{fish.visible=marineLifeVisible;});
    if(adonisCargoShip){
      adonisCargoShip.visible=adonisFactIndex===2;
      if(adonisFactIndex===2&&adonisCargoCurve){
        const point=adonisCargoCurve.getPointAt(.24),tangent=adonisCargoCurve.getTangentAt(.24);
        adonisCargoShip.position.set(point.x,.42,point.z);
        adonisCargoShip.rotation.y=Math.atan2(-tangent.z,tangent.x);
      }
    }
    adonisNavigationBeacons.forEach(buoy=>{buoy.visible=adonisFactIndex===2;});
    adonisNavigationRouteObjects.forEach(object=>{object.visible=adonisFactIndex===2;});
    if(adonisRig)adonisRig.visible=adonisFactIndex===0;
  }
  buildAdonisScene();

  let blackSeaPromise=null, enisalaPromise=null;
  let blackSeaModel=null, enisalaModel=null;
  let mode=''; let progress=0; let worksFocus='enigma';
  let finalProgress=0; let finalStageIndex=-1; let openingProgress=0;
  let pointerX=0,pointerY=0,pointerTargetX=0,pointerTargetY=0;
  let lastStatus='';

  function status(text, percent=null, state='loading') {
    const signature=`${state}:${percent ?? ''}:${text}`;
    if(signature===lastStatus)return;
    lastStatus=signature;onStatus({text,percent,state});
  }

  // A network/model failure must never leave the scene status in an endless spinner.
  // The underlying Three.js request may finish later, but only the winning result is attached.
  function withLoadTimeout(promise, milliseconds, label) {
    let timer=0;
    const timeout=new Promise((_,reject)=>{
      timer=setTimeout(()=>reject(new Error(`${label} · timeout după ${Math.round(milliseconds/1000)} s`)),milliseconds);
    });
    return Promise.race([promise,timeout]).finally(()=>clearTimeout(timer));
  }

  function decorateAndNormalize(wrapper, maxSize, rotateZUp=false, options={}) {
    const normalized=centerAndScale(wrapper,maxSize,rotateZUp);
    tuneModelMaterials(normalized,options);
    return normalized;
  }

  async function ensureBlackSea() {
    if(blackSeaModel)return blackSeaModel;
    if(blackSeaPromise)return blackSeaPromise;
    blackSeaPromise=(async()=>{
      status('SE ÎNCARCĂ SCANAREA 3D BLACK SEA',0);
      const loader=new GLTFLoader();
      const url=new URL('../assets/models/blacksea-scan.glb',import.meta.url).href;
      const gltf=await withLoadTimeout(loader.loadAsync(url,(event)=>{
        const percent=event.total?Math.min(97,Math.round(event.loaded/event.total*97)):null;
        status('SE DESCARCĂ SCANAREA 3D BLACK SEA',percent);
      }),35000,'Scanarea Black Sea nu a răspuns');
      status('SE PREGĂTEȘTE SUPRAFAȚA 3D BLACK SEA',98);
      const model=decorateAndNormalize(gltf.scene,7.4,true,{roughness:.91,envIntensity:.28,castShadow:false,receiveShadow:false});
      model.name='BlackSea · scan 3D furnizată';
      blackSeaModel=model;
      // Model is duplicated as the same scan in the opening, the archive exhibit and the finale.
      const openingModel=model.clone(true);openingModel.position.set(0,.53,0);openingModel.rotation.y=.14;opening.userData.deck.add(openingModel);opening.userData.scan=openingModel;
      const worksModel=model.clone(true);worksModel.position.set(.20,.53,-.04);worksModel.rotation.y=-.28;worksModel.scale.multiplyScalar(.82);works.userData.deck.add(worksModel);works.userData.scan=worksModel;
      // The scan belongs to the opening/archive story; finale uses its own stage-specific exhibits.
      status('SCANAREA 3D ESTE PREGĂTITĂ',100,'ready');
      return model;
    })().catch(error=>{
      blackSeaPromise=null;status('SCANAREA BLACK SEA NU A PUTUT FI ÎNCĂRCATĂ · SCENA RĂMÂNE ACTIVĂ',null,'fallback');
      console.warn('PONTUS story scene: BlackSea GLB failed.',error);return null;
    });
    return blackSeaPromise;
  }

  async function ensureEnisala() {
    if(enisalaModel)return enisalaModel;
    if(enisalaPromise)return enisalaPromise;
    enisalaPromise=(async()=>{
      status('SE ÎNCARCĂ MODELUL CETĂȚII ENISALA',0);
      const manager=new THREE.LoadingManager();
      manager.setURLModifier(url=>/EnisalaLow\.jpg/i.test(url)
        ? new URL('../assets/models/enisala-texture.webp',import.meta.url).href
        : url);
      const loader=new FBXLoader(manager);
      const url=new URL('../assets/models/enisala-scan.fbx',import.meta.url).href;
      const model=await withLoadTimeout(loader.loadAsync(url,(event)=>{
        const percent=event.total?Math.min(97,Math.round(event.loaded/event.total*97)):null;
        status('SE DESCARCĂ MODELUL CETĂȚII ENISALA',percent);
      }),75000,'Modelul Enisala nu a răspuns');
      status('SE PREGĂTEȘTE SUPRAFAȚA 3D ENISALA',98);
      // EnisalaLow.fbx declares UpAxis=2 (Z-up). FBXLoader r172 leaves the
      // source axis untouched, so convert it to Three.js Y-up before measuring,
      // normalizing and placing the photogrammetry scan.
      // Its color atlas already contains the photographed albedo; avoid multiplying
      // it by the scan's dark per-vertex tint, which made the fortress nearly black.
      const normalized=decorateAndNormalize(model,7.45,true,{roughness:.84,envIntensity:.62,castShadow:false,receiveShadow:false,preferTextureColor:true});
      normalized.name='Cetatea Enisala · scanare 3D · Z-up converted to Y-up';
      const terrainHeight=normalized.userData.normalizedSize?.y || 1.4;
      normalized.position.set(0,.22+terrainHeight*.5,-.10);
      // The fortress enclosure is on the far ridge in the scan; turn it toward
      // the camera so the real walls, gate and bastions are visible in this exhibit.
      normalized.rotation.y=Math.PI-.32;
      finale.userData.stageGroups[3].add(normalized);finale.userData.enisala=normalized;
      if(finale.userData.fortressFallback)finale.userData.fortressFallback.visible=false;
      enisalaModel=normalized;
      status('MODELUL CETĂȚII ESTE PREGĂTIT',100,'ready');
      return normalized;
    })().catch(error=>{
      enisalaPromise=null;status('MODELUL ENISALA NU A PUTUT FI ÎNCĂRCAT · CETATEA ILUSTRATIVĂ RĂMÂNE VIZIBILĂ',null,'fallback');
      console.warn('PONTUS story scene: Enisala FBX failed.',error);return null;
    });
    return enisalaPromise;
  }

  function activate(nextMode, nextProgress=0) {
    const safeMode=['opening','works','final','adonis'].includes(nextMode)?nextMode:'';
    mode=safeMode; progress=THREE.MathUtils.clamp(Number(nextProgress)||0,0,1);
    root.visible=!!mode;
    opening.visible=mode==='opening';works.visible=mode==='works';finale.visible=mode==='final';
    if(!mode){status('MODELUL 3D ORIGINAL PONTUS',100,'ready');return;}
    if(mode==='opening'){
      openingProgress=progress;
      targetPosition.set(1.25+progress*.65,6.1-progress*.65,11.4-progress*1.0);
      targetLook.set(.85,.05,0);
      ensureBlackSea();
      status('EXPLORARE 3D · MODELUL BLACK SEA',null,'loading');
    } else if(mode==='works'){
      targetPosition.set(7.6,5.1,9.8);targetLook.set(.45,.25,0);
      ensureBlackSea();
      status('ARHIVA 3D · STUDII ȘI LUCRĂRI',null,'loading');
    } else if(mode==='adonis'){
      setAdonisFact(adonisFactIndex);
      targetPosition.set(1.3,5.8,12.3);targetLook.set(.7,.3,0);
      status('RESURSE OFFSHORE · ECOSISTEM PONTIC · NAVIGAȚIE CIVILĂ',100,'ready');
    } else {
      finalProgress=progress;
      applyFinalCamera(progress);
      applyFinalStage(progress);
      status('EXPOZIȚIE 3D · OBIECTE ASOCIATE FIECĂREI CONCLUZII',null,'loading');
    }
    if(reducedMotion){currentCameraPosition.copy(targetPosition);camera.position.copy(targetPosition);camera.lookAt(targetLook);}
  }

  function applyFinalCamera(value) {
    const p=THREE.MathUtils.clamp(value,0,1);
    const positions=[
      [2.35,5.4,11.8,2.45,.42,0],
      [2.05,5.8,12.4,2.48,.52,-.05],
      [2.10,5.0,11.5,2.55,.20,0],
      [2.55,5.25,8.95,2.48,1.02,0],
      [2.1,5.4,12.6,2.55,.35,0],
      [2.1,7.5,12.6,2.45,.05,0]
    ];
    const scaled=p*(positions.length-1),index=Math.min(positions.length-2,Math.floor(scaled)),blend=scaled-index;
    const smooth=blend*blend*(3-2*blend),a=positions[index],b=positions[index+1];
    targetPosition.set(a[0]+(b[0]-a[0])*smooth,a[1]+(b[1]-a[1])*smooth,a[2]+(b[2]-a[2])*smooth);
    targetLook.set(a[3]+(b[3]-a[3])*smooth,a[4]+(b[4]-a[4])*smooth,a[5]+(b[5]-a[5])*smooth);
  }

  function applyFinalStage(value) {
    const stageIndex=Math.min(5,Math.max(0,Math.floor(THREE.MathUtils.clamp(value,0,1)*5+.12)));
    if(stageIndex===finalStageIndex)return;
    finalStageIndex=stageIndex;
    finale.userData.activeStage=stageIndex;
    finale.userData.stageGroups.forEach((group,index)=>{group.visible=index===stageIndex;});
    // The 70 MB Enisala scan is loaded only when the matching architectural stage is active.
    if(stageIndex===3&&!enisalaModel)ensureEnisala();
    status(`ETAPA ${String(stageIndex+1).padStart(2,'0')} / 06 · EXHIBIT CORELAT CU TEXTUL`,100,'ready');
  }

  function setProgress(nextProgress) {
    progress=THREE.MathUtils.clamp(Number(nextProgress)||0,0,1);
    if(mode==='opening'){
      openingProgress=progress;
      targetPosition.set(1.1+progress*.7,6.35-progress*.65,11.7-progress*1.1);
      targetLook.set(.85,.05,0);
    } else if(mode==='works') {
      const focusAngles={enigma:-.45,states:.48,blacksea:1.45,byzantine:2.35,portolan:2.35};
      const angle=focusAngles[worksFocus]??-.45;
      targetPosition.set(.55+Math.sin(angle)*8.4,5.15,Math.cos(angle)*9.4);
      targetLook.set(.25,.35,0);
    } else if(mode==='final') {
      finalProgress=progress;applyFinalCamera(progress);applyFinalStage(progress);
    }
  }

  function setWorksFocus(id) {
    if(!['enigma','states','blacksea','byzantine','portolan'].includes(id))return;
    worksFocus=id;
    const index=({enigma:0,states:1,blacksea:2,byzantine:3,portolan:3})[id];
    works.userData.books?.forEach((book,i)=>{
      book.userData.focus=i===index?1:.52;
      book.userData.targetY=i===index?.88:.62;
      book.userData.targetScale=i===index?1.19:1.04;
    });
    if(mode==='works')setProgress(progress);
  }

  function resize() {
    camera.aspect=Math.max(1,innerWidth)/Math.max(1,innerHeight);camera.updateProjectionMatrix();
  }

  function update(dt,time) {
    if(!root.visible)return;
    const motionTime=reducedMotion?0:time;
    const ease=reducedMotion?1:1-Math.exp(-dt*2.65);
    currentCameraPosition.lerp(targetPosition,ease);
    const pointerEase=reducedMotion?1:1-Math.exp(-dt*3.4);
    pointerX+=(pointerTargetX-pointerX)*pointerEase;pointerY+=(pointerTargetY-pointerY)*pointerEase;
    const parallax=(mode==='final'?.12:.22);
    // Apply parallax from the smoothed base position every frame; never accumulate offsets.
    camera.position.set(currentCameraPosition.x+pointerX*parallax*.30,currentCameraPosition.y-pointerY*parallax*.20,currentCameraPosition.z);
    cameraLookScratch.set(targetLook.x+pointerX*.14,targetLook.y-pointerY*.08,targetLook.z);
    camera.lookAt(cameraLookScratch);
    if(opening.userData.scan&&mode==='opening'){
      opening.userData.scan.rotation.y=.14+Math.sin(motionTime*.13)*.055+openingProgress*.2;
      opening.userData.deck.rotation.y=Math.sin(motionTime*.055)*.018;
      opening.userData.routePulse.position.copy(opening.userData.routeCurve.getPointAt(THREE.MathUtils.clamp(.10+openingProgress*.76+Math.sin(motionTime*.17)*.012,.025,.975)));
      opening.userData.pulseHalo.position.copy(opening.userData.routePulse.position);opening.userData.pulseHalo.scale.setScalar(1+Math.sin(motionTime*2.1)*.12);
      const boat=opening.userData.ship;
      const u=THREE.MathUtils.clamp(.055+openingProgress*.82+(reducedMotion?0:Math.sin(motionTime*.19)*.012),.025,.975);
      const point=opening.userData.routeCurve.getPointAt(u),tangent=opening.userData.routeCurve.getTangentAt(u);
      boat.position.set(point.x,point.y+(reducedMotion?0:Math.sin(motionTime*1.2)*.035),point.z);
      boat.quaternion.setFromUnitVectors(shipForwardAxis,tangent);
      boat.rotateX(Math.sin(motionTime*.7)*.006);boat.rotateZ(Math.cos(motionTime*.55)*.004);
      updateWake(opening.userData.wake,boat,tangent,motionTime,-.78);
      updateGulls(opening.userData.gulls,motionTime);
      opening.userData.spots[0].intensity=105+Math.sin(motionTime*.22)*7;
      opening.userData.spots[1].intensity=74+Math.cos(motionTime*.18)*6;
      updateParticles(opening.userData.particles,dt);
    }
    if(mode==='works'){
      if(works.userData.scan)works.userData.scan.rotation.y+=reducedMotion?0:dt*.028;
      works.userData.books?.forEach((book,i)=>{
        const phase=motionTime*.38+book.userData.floatPhase;
        const targetY=book.userData.targetY??.62;
        book.position.y+=(targetY+Math.sin(phase)*.028-book.position.y)*(reducedMotion?1:.035);
        book.rotation.y+=reducedMotion?0:dt*(i%2?-.018:.018);
        const targetScale=book.userData.targetScale??1.04;
        const current=book.scale.x;const next=current+(targetScale-current)*(reducedMotion?1:.05);book.scale.setScalar(next);
      });
      if(works.userData.portolanScroll&&!reducedMotion){
        works.userData.portolanScroll.rotation.y=-.045+Math.sin(motionTime*.16)*.012;
        works.userData.portolanScroll.position.y=.31+Math.sin(motionTime*.45)*.008;
      }
      works.userData.spots[0].intensity=132+Math.sin(motionTime*.26)*8;
      updateParticles(works.userData.particles,dt);
    }
    if(mode==='final'){
      if(finalStageIndex===2){
        const ship=finale.userData.ship,curve=finale.userData.routeCurve;
        const tradeStart=(2-.12)/5,tradeEnd=(3-.12)/5;
        const localProgress=THREE.MathUtils.clamp((finalProgress-tradeStart)/(tradeEnd-tradeStart),0,1);
        const u=THREE.MathUtils.clamp(.06+localProgress*.80+(reducedMotion?0:Math.sin(motionTime*.19)*.009),.025,.975);
        const point=curve.getPointAt(u),tangent=curve.getTangentAt(u);
        ship.position.set(point.x,point.y+(reducedMotion?0:Math.sin(motionTime*1.12)*.027),point.z);
        ship.quaternion.setFromUnitVectors(shipForwardAxis,tangent);
        ship.rotateX(Math.sin(motionTime*.62)*.005);ship.rotateZ(Math.cos(motionTime*.5)*.004);
        updateWake(finale.userData.wake,ship,tangent,motionTime,-.92);
        updateGulls(finale.userData.gulls,motionTime);
        finale.userData.routePulse.position.copy(curve.getPointAt(Math.min(.995,.12+localProgress*.76)));
        finale.userData.waypoints.forEach((marker,i)=>{
          const isPast=(i+1)/6<=localProgress+.04;
          marker.scale.setScalar(isPast?1.15:1+Math.sin(motionTime*1.8+i)*.06);
          marker.children[0].material=isPast?cyan:warmGlow;
        });
      }
      if(finalStageIndex===3&&finale.userData.enisala&&!reducedMotion)finale.userData.enisala.rotation.y+=dt*.002;
      if(finalStageIndex===4&&!reducedMotion){
        finale.userData.portCranes.forEach(crane=>{
          const phase=motionTime*.42+crane.userData.phase;
          const x=Math.sin(phase)*.48;
          crane.userData.trolley.position.x=x;
          crane.userData.cable.position.x=x;
          crane.userData.spreader.position.x=x;
        });
      }
      if(finalStageIndex===5&&!reducedMotion)finale.userData.bathymetry.rotation.z=Math.sin(motionTime*.10)*.004;
      finale.userData.spots[0].intensity=140+Math.sin(motionTime*.19)*9;
      finale.userData.spots[1].intensity=100+Math.cos(motionTime*.16)*7;
      updateParticles(finale.userData.particles,dt);
    }
    if(mode==='adonis'&&adonisViewport?.dataset.activeStep==='resources'){
      const cameraEase=reducedMotion?1:1-Math.exp(-dt*2.35);
      adonisCameraPosition.lerp(adonisDesiredPosition,cameraEase);
      adonisCameraTarget.lerp(adonisDesiredTarget,cameraEase);
      adonisCamera.position.copy(adonisCameraPosition);adonisCamera.lookAt(adonisCameraTarget);
      if(adonisRig&&adonisRig.visible&&!reducedMotion){
        adonisRig.rotation.y=Math.sin(motionTime*.07)*.004;
        adonisRig.position.y=Math.sin(motionTime*.52)*.022;
        const hoist=adonisRig.userData.drillHoist;
        if(hoist)hoist.position.y=adonisRig.userData.drillHoistBaseY+Math.sin(motionTime*.24)*.16;
      }
      if(adonisWaterShader)adonisWaterShader.uniforms.uAdonisTime.value=reducedMotion?0:motionTime;
      if(!reducedMotion){
        adonisFish.forEach((fish,i)=>{if(!fish.visible)return;const phase=motionTime*.20+fish.userData.phase,base=fish.userData.base;fish.position.set(base.x+Math.sin(phase)*(.28+(i%3)*.05),base.y+Math.sin(phase*1.8)*.045,base.z+Math.cos(phase*.72)*.26);fish.rotation.y=Math.sin(phase*.7)*.12;});
        if(adonisCargoShip&&adonisFactIndex===2&&adonisCargoCurve){const u=(motionTime*.018)%1,point=adonisCargoCurve.getPointAt(u),tangent=adonisCargoCurve.getTangentAt(u);adonisCargoShip.position.set(point.x,.42,point.z);adonisCargoShip.rotation.y=Math.atan2(-tangent.z,tangent.x);}
        if(adonisFactIndex===1&&adonisAlgaePlume){adonisAlgaePlume.children.forEach((child,i)=>{if(i<5)child.material.opacity=.11+Math.sin(motionTime*.25+i*.55)*.025;});}
        if(adonisRig?.visible)adonisOilLights.forEach((light,i)=>{if(light.isPointLight)light.intensity=7.1+Math.sin(motionTime*3.1+i*.8)*.65;});
        adonisNavigationBeacons.forEach((beacon,i)=>{beacon.scale.setScalar(1+Math.sin(motionTime*2.2+i)*.12);});
        if(adonisFactIndex===1)updateParticles(adonisPlankton,dt);
      }
    }
    [opening.userData.water,works.userData.water,finale.userData.water].forEach(water=>{
      const shader=water?.material?.userData?.shader;
      if(shader)shader.uniforms.uPontusTime.value=motionTime;
    });
  }

  function restoreAdonisDockLayer(){
    const canvas=renderer?.domElement;
    const stage=canvas?.closest('.stage');
    if(stage?.classList.contains('adonis-dock-overlay'))stage.classList.remove('adonis-dock-overlay');
    if(canvas&&(canvas.style.clipPath||canvas.style.webkitClipPath)){canvas.style.clipPath='';canvas.style.webkitClipPath='';}
    if(adonisViewport)delete adonisViewport.dataset.adonisReady;
  }

  function renderDockOverlay(){
    if(mode!=='adonis'||!adonisViewport||adonisViewport.dataset.activeStep!=='resources'||document.documentElement.classList.contains('no-webgl')||document.documentElement.classList.contains('webgl-context-lost')){
      restoreAdonisDockLayer();return;
    }
    const canvas=renderer.domElement,stage=canvas.closest('.stage');
    const canvasRect=canvas.getBoundingClientRect(),rect=adonisViewport.getBoundingClientRect();
    // Leave the small 2D labels and frame above the scene. Only the central viewing
    // aperture is rendered by the shared WebGL canvas and clipped above the page.
    const left=Math.max(rect.left+11,canvasRect.left),right=Math.min(rect.right-11,canvasRect.right);
    const top=Math.max(rect.top+82,canvasRect.top),bottom=Math.min(rect.bottom-62,canvasRect.bottom);
    const width=right-left,height=bottom-top;
    if(width<24||height<24){restoreAdonisDockLayer();return;}
    const x=left-canvasRect.left,y=canvasRect.bottom-bottom;
    const previousViewport=renderer.getViewport(new THREE.Vector4());
    const previousScissor=renderer.getScissor(new THREE.Vector4());
    const previousScissorTest=renderer.getScissorTest();
    try{
      // The page's normal DOM content sits above the full-screen world canvas. Raise
      // the canvas only while the Adonis 3D viewport is active, and clip it to that
      // viewport so it cannot cover chapter text, navigation or other page content.
      if(stage&&!stage.classList.contains('adonis-dock-overlay'))stage.classList.add('adonis-dock-overlay');
      const clipTop=Math.max(0,top-canvasRect.top),clipRight=Math.max(0,canvasRect.right-right);
      const clipBottom=Math.max(0,canvasRect.bottom-bottom),clipLeft=Math.max(0,left-canvasRect.left);
      const clip=`inset(${clipTop}px ${clipRight}px ${clipBottom}px ${clipLeft}px round 14px)`;
      if(canvas.style.clipPath!==clip)canvas.style.clipPath=clip;
      if(canvas.style.webkitClipPath!==clip)canvas.style.webkitClipPath=clip;
      adonisCamera.aspect=width/height;adonisCamera.updateProjectionMatrix();
      renderer.setScissorTest(true);renderer.setViewport(x,y,width,height);renderer.setScissor(x,y,width,height);
      renderer.clearDepth();renderer.render(adonisScene,adonisCamera);
      adonisViewport.dataset.adonisReady='true';
    }catch(error){
      restoreAdonisDockLayer();
      console.warn('PONTUS Adonis 3D dock: randarea locală nu a reușit; panoul 2D rămâne disponibil.',error);
    }finally{
      renderer.setViewport(previousViewport);renderer.setScissor(previousScissor);renderer.setScissorTest(previousScissorTest);
    }
  }

  function updateParticles(points,dt) {
    if(!points||reducedMotion)return;
    const attr=points.geometry.attributes.position,drift=points.userData.drift,bounds=points.userData.bounds;
    for(let i=0;i<attr.count;i++){
      let x=attr.array[i*3]+drift[i*3]*dt*8;
      let y=attr.array[i*3+1]+drift[i*3+1]*dt*8;
      let z=attr.array[i*3+2]+drift[i*3+2]*dt*8;
      if(y>bounds[1]/2){y=-bounds[1]/2;x=(Math.random()-.5)*bounds[0];z=(Math.random()-.5)*bounds[2];}
      if(Math.abs(x)>bounds[0]/2)x*=-.96;if(Math.abs(z)>bounds[2]/2)z*=-.96;
      attr.setXYZ(i,x,y,z);
    }
    attr.needsUpdate=true;
  }

  function onPointerMove(event) {
    if(!mode||reducedMotion||coarsePointer)return;
    pointerTargetX=THREE.MathUtils.clamp((event.clientX/Math.max(1,innerWidth)-.5)*2,-1,1);
    pointerTargetY=THREE.MathUtils.clamp((event.clientY/Math.max(1,innerHeight)-.5)*2,-1,1);
  }
  window.addEventListener('pointermove',onPointerMove,{passive:true});
  window.addEventListener('pointerleave',()=>{pointerTargetX=0;pointerTargetY=0;},{passive:true});

  function dispose() {
    restoreAdonisDockLayer();
    window.removeEventListener('pointermove',onPointerMove);
    scene.remove(root);
    environment.dispose();
    artifactTextures.forEach(texture=>texture.dispose());
    auxiliaryTextures.forEach(texture=>texture.dispose());
    byzantineCoverTexture.dispose();
    sceneMaterials.forEach(material=>material.dispose());
    adonisMaterials.forEach(material=>material.dispose());
    adonisScene.traverse(object=>{if(object.geometry)object.geometry.dispose();});
  }

  setWorksFocus(worksFocus);

  return {
    activate, setProgress, setWorksFocus, setAdonisFact, renderDockOverlay, update, resize, dispose,
    preloadFinale(){ /* stage images preload in the document; heavy fortress scan waits for its matching section */ },
    get active(){return !!mode;},
    get mode(){return mode;},
    get camera(){return camera;},
    get status(){return lastStatus;}
  };
}
