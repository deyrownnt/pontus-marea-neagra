/* PONTUS local WebGL relief renderer.
 * A dependency-free, true 3D fallback for the opening Black Sea map.
 * It uses the bundled WGS84 atlas texture, height raster and shoreline mask;
 * no CDN, import map, shader package or remote asset is required.
 */
(() => {
  'use strict';
  const ROOT = document.documentElement;
  // Match src/geography.js exactly: WGS84 / Lambert Conformal Conic.
  const WIDTH = 10.8;
  const GEO = { a: 6378137, e: 0.08181919084262149, lon0: 34.5*Math.PI/180, lat0: 43.5*Math.PI/180, lat1: 40*Math.PI/180, lat2: 47*Math.PI/180 };
  const m = phi => Math.cos(phi) / Math.sqrt(1 - GEO.e ** 2 * Math.sin(phi) ** 2);
  const t = phi => Math.tan(Math.PI/4 - phi/2) / Math.pow((1-GEO.e*Math.sin(phi))/(1+GEO.e*Math.sin(phi)), GEO.e/2);
  const n = (Math.log(m(GEO.lat1))-Math.log(m(GEO.lat2))) / (Math.log(t(GEO.lat1))-Math.log(t(GEO.lat2)));
  const f = m(GEO.lat1) / (n * Math.pow(t(GEO.lat1),n));
  const rho0 = GEO.a * f * Math.pow(t(GEO.lat0),n);
  const project = (lon,lat) => { const lambda=lon*Math.PI/180,phi=lat*Math.PI/180,rho=GEO.a*f*Math.pow(t(phi),n),theta=n*(lambda-GEO.lon0); return [rho*Math.sin(theta),rho0-rho*Math.cos(theta)]; };
  const projectedBounds = (() => { let minX=Infinity,maxX=-Infinity,minY=Infinity,maxY=-Infinity; for(let i=0;i<=512;i++){const q=i/512;for(const [lon,lat] of [[26+q*17,39],[26+q*17,48],[26,39+q*9],[43,39+q*9]]){const [x,y]=project(lon,lat);minX=Math.min(minX,x);maxX=Math.max(maxX,x);minY=Math.min(minY,y);maxY=Math.max(maxY,y);}} return {minX,maxX,minY,maxY,width:maxX-minX,height:maxY-minY}; })();
  const DEPTH = WIDTH * (projectedBounds.height / projectedBounds.width);
  const BOUNDS = { west: 26, east: 43, south: 39, north: 48 };
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const ROUTE = [[29.15,41.25],[29.65,41.68],[30.45,42.18],[31.55,42.72],[32.65,43.25],[33.70,43.85],[34.65,44.45],[35.50,45.03]];
  const clamp01 = value => Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));

  // One shared progress channel feeds the main Three.js vessel and both local
  // fallback renderers. It is also active if the ES module fails before boot.
  window.PONTUS_VOYAGE_PROGRESS = clamp01(Number(window.PONTUS_VOYAGE_PROGRESS || 0));
  window.PONTUS_SET_VOYAGE_PROGRESS = value => {
    const progress = clamp01(Number(value));
    window.PONTUS_VOYAGE_PROGRESS = progress;
    const readout = document.getElementById('voyage-progress-value');
    if (readout) readout.textContent = `${String(Math.round(progress * 100)).padStart(2, '0')}%`;
    const fill = document.getElementById('voyage-progress-fill');
    if (fill) fill.style.transform = `scaleX(${progress})`;
    window.dispatchEvent(new Event('pontus:voyage-progress'));
    return progress;
  };
  let progressRaf = 0;
  const measurePageProgress = () => {
    progressRaf = 0;
    if (window.PONTUS_MAIN_PROGRESS_DRIVER__) return;
    const intro = document.getElementById('intro');
    const startY = intro ? intro.getBoundingClientRect().top + window.scrollY : 0;
    const maxY = Math.max(0, Math.max(document.documentElement.scrollHeight, document.body?.scrollHeight || 0) - window.innerHeight);
    const progress = clamp01((window.scrollY - startY) / Math.max(1, maxY - startY));
    window.PONTUS_SET_VOYAGE_PROGRESS(progress);
  };
  const schedulePageProgress = () => { if (!progressRaf) progressRaf = requestAnimationFrame(measurePageProgress); };
  window.addEventListener('scroll', schedulePageProgress, { passive: true });
  window.addEventListener('resize', schedulePageProgress, { passive: true });
  window.addEventListener('pageshow', schedulePageProgress, { passive: true });
  window.addEventListener('hashchange', schedulePageProgress, { passive: true });
  document.addEventListener('DOMContentLoaded', schedulePageProgress, { once: true });
  schedulePageProgress();

  let state = 'idle';
  let gl = null, canvas = null, frame = 0, raf = 0, startTime = 0, program = null, boatProgram = null;
  let terrain = null, route = null, boat = null, colorTexture = null, maskTexture = null, routeSampleTable = [], routeSampleLength = 0;
  let resizeObserver = null, resizeHandler = null, visibilityHandler = null, progressEventHandler = null, lastWidth = 0, lastHeight = 0;

  const vertexSource = `
    attribute vec3 aPosition;
    attribute vec3 aNormal;
    attribute vec2 aUv;
    uniform mat4 uMvp;
    uniform mat4 uModel;
    varying vec2 vUv;
    varying vec3 vNormal;
    varying vec3 vWorld;
    void main(){
      vec4 world = uModel * vec4(aPosition, 1.0);
      vWorld = world.xyz;
      vNormal = normalize(mat3(uModel) * aNormal);
      vUv = aUv;
      gl_Position = uMvp * vec4(aPosition, 1.0);
    }
  `;
  const fragmentSource = `
    precision highp float;
    uniform sampler2D uColor;
    uniform sampler2D uMask;
    uniform float uTime;
    uniform vec3 uCamera;
    varying vec2 vUv;
    varying vec3 vNormal;
    varying vec3 vWorld;
    void main(){
      vec3 base = texture2D(uColor, vUv).rgb;
      // Bundled mask convention: white = water, black = land.
      float water = texture2D(uMask, vUv).r;
      vec3 n = normalize(vNormal);
      vec3 lightDir = normalize(vec3(-0.38, 0.88, 0.42));
      float diffuse = max(dot(n, lightDir), 0.0);
      float ambient = 0.68 + diffuse * 0.43;
      float rippleA = sin(vUv.x * 188.0 + vUv.y * 31.0 - uTime * 0.72);
      float rippleB = sin(vUv.y * 226.0 - vUv.x * 42.0 + uTime * 0.48);
      float shimmer = (rippleA * rippleB * 0.5 + 0.5) * water;
      base += vec3(0.014, 0.055, 0.067) * shimmer;
      vec3 viewDir = normalize(uCamera - vWorld);
      float rim = pow(1.0 - max(dot(n, viewDir), 0.0), 2.0) * 0.10;
      vec3 lit = base * ambient + vec3(0.035, 0.055, 0.054) * rim;
      float distanceToCamera = length(uCamera - vWorld);
      float fog = smoothstep(13.0, 25.0, distanceToCamera) * 0.42;
      lit = mix(lit, vec3(0.035, 0.075, 0.082), fog);
      gl_FragColor = vec4(lit, 1.0);
    }
  `;
  const coloredVertex = `
    attribute vec3 aPosition;
    attribute vec3 aColor;
    attribute vec3 aNormal;
    uniform mat4 uMvp;
    uniform mat4 uModel;
    uniform float uLighting;
    varying vec3 vColor;
    varying float vLight;
    void main(){
      vec3 n=normalize(mat3(uModel)*aNormal);
      float diffuse=max(dot(n,normalize(vec3(-.38,.84,.42))),0.0);
      vLight=mix(1.0,.58+diffuse*.54,uLighting);
      vColor=aColor;
      gl_Position=uMvp*vec4(aPosition,1.0);
      gl_PointSize=2.0;
    }
  `;
  const coloredFragment = `
    precision mediump float;
    varying vec3 vColor;
    varying float vLight;
    uniform float uAlpha;
    void main(){ gl_FragColor=vec4(vColor*vLight,uAlpha); }
  `;

  function createShader(glContext, type, source) {
    const shader = glContext.createShader(type);
    glContext.shaderSource(shader, source);
    glContext.compileShader(shader);
    if (!glContext.getShaderParameter(shader, glContext.COMPILE_STATUS)) {
      const error = glContext.getShaderInfoLog(shader) || 'Shader compilation failed';
      glContext.deleteShader(shader);
      throw new Error(error);
    }
    return shader;
  }
  function createProgram(glContext, vs, fs) {
    const p = glContext.createProgram();
    glContext.attachShader(p, createShader(glContext, glContext.VERTEX_SHADER, vs));
    glContext.attachShader(p, createShader(glContext, glContext.FRAGMENT_SHADER, fs));
    glContext.linkProgram(p);
    if (!glContext.getProgramParameter(p, glContext.LINK_STATUS)) throw new Error(glContext.getProgramInfoLog(p) || 'Program linking failed');
    return p;
  }
  function loadImage(src) {
    return new Promise((resolve, reject) => {
      const image = new Image();
      image.decoding = 'async';
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error(`Asset local indisponibil: ${src}`));
      image.src = src;
      if (image.decode) image.decode().then(() => resolve(image)).catch(() => {});
    });
  }
  function imagePixels(image) {
    const c = document.createElement('canvas'); c.width = image.naturalWidth; c.height = image.naturalHeight;
    const ctx = c.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(image, 0, 0);
    return { width: c.width, height: c.height, data: ctx.getImageData(0, 0, c.width, c.height).data };
  }
  function sampleGray(image, x, y) {
    const ix = Math.max(0, Math.min(image.width - 1, x));
    const iy = Math.max(0, Math.min(image.height - 1, y));
    return image.data[(iy * image.width + ix) * 4];
  }
  function buildTerrain(heightImage, maskImage) {
    const sx = 192, sz = Math.max(96, Math.round(sx * DEPTH / WIDTH));
    const count = (sx + 1) * (sz + 1);
    const positions = new Float32Array(count * 3), uvs = new Float32Array(count * 2), normals = new Float32Array(count * 3);
    const heights = new Float32Array(count);
    for (let z = 0; z <= sz; z++) {
      for (let x = 0; x <= sx; x++) {
        const index = z * (sx + 1) + x, u = x / sx, v = z / sz;
        const hx = Math.round(u * (heightImage.width - 1)), hy = Math.round(v * (heightImage.height - 1));
        const mx = Math.round(u * (maskImage.width - 1)), my = Math.round(v * (maskImage.height - 1));
        const h = sampleGray(heightImage, hx, hy) / 255;
        const water = sampleGray(maskImage, mx, my) / 255;
        // Sea floor stays below the sailing plane; the land rises from the coast.
        const y = water > 0.5 ? -0.105 - h * 0.14 : 0.025 + Math.max(0, h - 0.24) * 0.56;
        heights[index] = y;
        positions[index * 3] = (u - 0.5) * WIDTH;
        positions[index * 3 + 1] = y;
        positions[index * 3 + 2] = (v - 0.5) * DEPTH;
        uvs[index * 2] = u; uvs[index * 2 + 1] = 1 - v;
      }
    }
    const dx = WIDTH / sx, dz = DEPTH / sz;
    for (let z = 0; z <= sz; z++) for (let x = 0; x <= sx; x++) {
      const index = z * (sx + 1) + x;
      const left = heights[z * (sx + 1) + Math.max(0, x - 1)];
      const right = heights[z * (sx + 1) + Math.min(sx, x + 1)];
      const up = heights[Math.max(0, z - 1) * (sx + 1) + x];
      const down = heights[Math.min(sz, z + 1) * (sx + 1) + x];
      let nx = -(right - left) / Math.max(dx, 0.001) * 0.36;
      let ny = 1.0;
      let nz = (up - down) / Math.max(dz, 0.001) * 0.36;
      const inv = 1 / Math.hypot(nx, ny, nz);
      normals[index * 3] = nx * inv; normals[index * 3 + 1] = ny * inv; normals[index * 3 + 2] = nz * inv;
    }
    const indices = new Uint16Array(sx * sz * 6); let ptr = 0;
    for (let z = 0; z < sz; z++) for (let x = 0; x < sx; x++) {
      const a = z * (sx + 1) + x, b = a + 1, c = a + sx + 1, d = c + 1;
      indices[ptr++] = a; indices[ptr++] = c; indices[ptr++] = b;
      indices[ptr++] = b; indices[ptr++] = c; indices[ptr++] = d;
    }
    return { positions, uvs, normals, indices, indexCount: indices.length };
  }
  function uploadBuffer(target, data, usage = gl.STATIC_DRAW) {
    const buffer = gl.createBuffer(); gl.bindBuffer(target, buffer); gl.bufferData(target, data, usage); return buffer;
  }
  function makeTexture(image) {
    let source = image;
    const maxSize = gl.getParameter(gl.MAX_TEXTURE_SIZE) || 2048;
    if (image.naturalWidth > maxSize || image.naturalHeight > maxSize) {
      const scale = Math.min(maxSize / image.naturalWidth, maxSize / image.naturalHeight);
      const c = document.createElement('canvas'); c.width = Math.round(image.naturalWidth * scale); c.height = Math.round(image.naturalHeight * scale);
      c.getContext('2d').drawImage(image, 0, 0, c.width, c.height); source = c;
    }
    const texture = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    return texture;
  }
  function makeTerrainBuffers(data) {
    return {
      position: uploadBuffer(gl.ARRAY_BUFFER, data.positions),
      normal: uploadBuffer(gl.ARRAY_BUFFER, data.normals),
      uv: uploadBuffer(gl.ARRAY_BUFFER, data.uvs),
      index: uploadBuffer(gl.ELEMENT_ARRAY_BUFFER, data.indices),
      count: data.indexCount
    };
  }
  function geoToScene(lon, lat) {
    const [x,y]=project(lon,lat);
    const u=(x-projectedBounds.minX)/projectedBounds.width;
    const v=(y-projectedBounds.minY)/projectedBounds.height;
    return [(u-.5)*WIDTH,-.118,(.5-v)*DEPTH];
  }
  function catmullPoint(p0, p1, p2, p3, t) {
    const t2=t*t,t3=t2*t;
    return [0,1,2].map(axis => .5 * ((2*p1[axis]) + (-p0[axis]+p2[axis])*t + (2*p0[axis]-5*p1[axis]+4*p2[axis]-p3[axis])*t2 + (-p0[axis]+3*p1[axis]-3*p2[axis]+p3[axis])*t3));
  }
  function buildRouteSamples(toScene) {
    const controls=ROUTE.map(([lon,lat])=>toScene(lon,lat));
    const samples=[];
    const steps=48;
    for(let i=0;i<controls.length-1;i++){
      const p0=controls[Math.max(0,i-1)],p1=controls[i],p2=controls[i+1],p3=controls[Math.min(controls.length-1,i+2)];
      for(let j=0;j<steps;j++){
        const t=j/steps,point=catmullPoint(p0,p1,p2,p3,t);
        samples.push({x:point[0],y:point[1],z:point[2],distance:0});
      }
    }
    const last=controls.at(-1);samples.push({x:last[0],y:last[1],z:last[2],distance:0});
    let distance=0;
    for(let i=0;i<samples.length;i++){
      if(i){const a=samples[i-1],b=samples[i];distance+=Math.hypot(b.x-a.x,b.y-a.y,b.z-a.z);}
      samples[i].distance=distance;
    }
    routeSampleLength=distance;
    routeSampleTable=samples;
    return samples;
  }
  function buildRoute(maskImage) {
    const samples=buildRouteSamples((lon,lat)=>{
      const point=geoToScene(lon,lat);
      // geoToScene returns [x, y, z]. The previous two-value destructuring
      // accidentally treated the fixed water level as Z, flattening the entire route.
      return [point[0],-.118,point[2]];
    });
    // Validate every Catmull–Rom sample against the bundled shoreline mask.
    // White means water. This catches accidental coast crossings before the vessel moves.
    let offWater=0;
    for(const point of samples){
      const u=point.x/WIDTH+.5, v=.5-point.z/DEPTH;
      const mx=Math.round(u*(maskImage.width-1)), my=Math.round((1-v)*(maskImage.height-1));
      if(sampleGray(maskImage,mx,my)<=127)offWater++;
    }
    window.PONTUS_ROUTE_WATER_DEBUG={samples:samples.length,offWater,allWater:offWater===0,first:{x:samples[0].x,z:samples[0].z},last:{x:samples.at(-1).x,z:samples.at(-1).z}};
    if(offWater>0)console.warn(`PONTUS: ${offWater} puncte ale rutei sunt în afara măștii de apă.`);
    const half=.014,verts=[];
    for(let i=0;i<samples.length;i++){
      const a=samples[Math.max(0,i-1)],b=samples[Math.min(samples.length-1,i+1)];
      const dx=b.x-a.x,dz=b.z-a.z,length=Math.hypot(dx,dz)||1;
      const px=-dz/length*half,pz=dx/length*half,p=samples[i];
      verts.push([p.x+px,p.y+.025,p.z+pz],[p.x-px,p.y+.025,p.z-pz]);
    }
    const data=[];
    for(let i=0;i<verts.length-2;i+=2){const a=verts[i],b=verts[i+1],c=verts[i+2],d=verts[i+3];data.push(...a,...b,...c,...b,...d,...c);}
    const colors=new Float32Array(data.length/3*3);
    for(let i=0;i<colors.length;i+=3){colors[i]=.83;colors[i+1]=.61;colors[i+2]=.34;}
    return {position:uploadBuffer(gl.ARRAY_BUFFER,new Float32Array(data)),color:uploadBuffer(gl.ARRAY_BUFFER,colors),count:data.length/3};
  }
  function buildBoat() {
    // A true low-poly 3D medieval merchant vessel for the standalone WebGL1 renderer.
    // Flat face normals and per-face warm materials preserve a carved model appearance.
    const vertices=[];
    const colors={
      hullDark:[.105,.071,.048],hullShadow:[.20,.12,.075],hull:[.34,.20,.115],
      hullLight:[.49,.30,.16],plank:[.59,.38,.22],trim:[.72,.52,.30],
      brass:[.73,.54,.30],iron:[.20,.23,.22],rope:[.39,.31,.21],
      sail:[.82,.76,.64],sailLight:[.91,.85,.73],sailShade:[.64,.56,.43],
      sailSeam:[.69,.61,.49],crate:[.43,.27,.15],crateLight:[.58,.39,.23]
    };
    const tri=(a,b,c,color)=>{
      const ab=[b[0]-a[0],b[1]-a[1],b[2]-a[2]],ac=[c[0]-a[0],c[1]-a[1],c[2]-a[2]];
      let nx=ab[1]*ac[2]-ab[2]*ac[1],ny=ab[2]*ac[0]-ab[0]*ac[2],nz=ab[0]*ac[1]-ab[1]*ac[0];
      const len=Math.hypot(nx,ny,nz)||1;nx/=len;ny/=len;nz/=len;
      for(const p of [a,b,c])vertices.push(p[0],p[1],p[2],color[0],color[1],color[2],nx,ny,nz);
    };
    const quad=(a,b,c,d,colorA,colorB=colorA)=>{tri(a,b,c,colorA);tri(a,c,d,colorB);};
    const cable=(a,b,width,color)=>{
      const dx=b[0]-a[0],dy=b[1]-a[1],dz=b[2]-a[2],len=Math.hypot(dx,dy,dz)||1;
      let sx=-dz,sy=0,sz=dx,sl=Math.hypot(sx,sz);
      if(sl<1e-5){sx=1;sz=0;sl=1;}sx=sx/sl*width;sz=sz/sl*width;
      const a1=[a[0]+sx,a[1]+sy,a[2]+sz],a2=[a[0]-sx,a[1]-sy,a[2]-sz];
      const b1=[b[0]+sx,b[1]+sy,b[2]+sz],b2=[b[0]-sx,b[1]-sy,b[2]-sz];
      quad(a1,b1,b2,a2,color);
    };
    const box=(cx,cy,cz,sx,sy,sz,top=colors.crateLight,side=colors.crate)=>{
      const x0=cx-sx/2,x1=cx+sx/2,y0=cy-sy/2,y1=cy+sy/2,z0=cz-sz/2,z1=cz+sz/2;
      quad([x0,y1,z0],[x1,y1,z0],[x1,y1,z1],[x0,y1,z1],top);
      quad([x0,y0,z0],[x0,y0,z1],[x1,y0,z1],[x1,y0,z0],colors.hullDark);
      quad([x0,y0,z0],[x1,y0,z0],[x1,y1,z0],[x0,y1,z0],side);
      quad([x1,y0,z0],[x1,y0,z1],[x1,y1,z1],[x1,y1,z0],side);
      quad([x1,y0,z1],[x0,y0,z1],[x0,y1,z1],[x1,y1,z1],colors.hullShadow);
      quad([x0,y0,z1],[x0,y0,z0],[x0,y1,z0],[x0,y1,z1],colors.hullShadow);
    };
    const cylinder=(cx,cz,y0,y1,r,color,sides=10,topColor=color)=>{
      for(let i=0;i<sides;i++){
        const a=i/sides*Math.PI*2,b=(i+1)/sides*Math.PI*2;
        const p0=[cx+Math.cos(a)*r,y0,cz+Math.sin(a)*r],p1=[cx+Math.cos(b)*r,y0,cz+Math.sin(b)*r];
        const p2=[cx+Math.cos(b)*r,y1,cz+Math.sin(b)*r],p3=[cx+Math.cos(a)*r,y1,cz+Math.sin(a)*r];
        const shade=(i%3===0)?topColor:color;quad(p0,p1,p2,p3,shade,shade);
        tri([cx,y1,cz],p3,p2,topColor);
      }
    };
    const ring=(cx,cz,y,r,tube,color,segments=24)=>{
      for(let i=0;i<segments;i++){
        const a=i/segments*Math.PI*2,b=(i+1)/segments*Math.PI*2;
        const p0=[cx+Math.cos(a)*r,y,cz+Math.sin(a)*r],p1=[cx+Math.cos(b)*r,y,cz+Math.sin(b)*r];
        const q0=[cx+Math.cos(a)*(r-tube),y+.001,cz+Math.sin(a)*(r-tube)],q1=[cx+Math.cos(b)*(r-tube),y+.001,cz+Math.sin(b)*(r-tube)];
        quad(p0,p1,q1,q0,color);
      }
    };
    const sailGrid=(zCenter,width,height,bottom,top,curvature=.07,shade=0)=>{
      const nx=12,ny=14,grid=[];
      for(let y=0;y<=ny;y++){
        const v=y/ny,row=[];
        for(let x=0;x<=nx;x++){
          const u=x/nx,edge=Math.sin(Math.PI*u),belly=edge*Math.sin(Math.PI*v)*curvature;
          row.push([(u-.5)*width*(.92+.08*v),bottom+v*height,zCenter+belly+(u-.5)*.025]);
        }
        grid.push(row);
      }
      for(let y=0;y<ny;y++)for(let x=0;x<nx;x++){
        const a=grid[y][x],b=grid[y][x+1],c=grid[y+1][x+1],d=grid[y+1][x];
        const stripe=(Math.floor(x/2)%2===0),base=stripe?colors.sail:colors.sailLight;
        const col=shade&&y>ny*.72?colors.sailShade:base;
        quad(a,d,c,b,col,stripe?colors.sailLight:colors.sail);
        // A fine stitched seam on every fourth panel.
        if(x%4===0) cable(a,d,.0015,colors.sailSeam);
      }
      // Reinforced sail perimeter and horizontal reef bands.
      for(let x=0;x<nx;x++)cable(grid[0][x],grid[0][x+1],.006,colors.trim);
      for(let y=0;y<ny;y++){cable(grid[y][0],grid[y+1][0],.005,colors.trim);cable(grid[y][nx],grid[y+1][nx],.005,colors.trim);}
      for(const row of [4,8,12])for(let x=0;x<nx;x++)cable(grid[row][x],grid[row][x+1],.0025,colors.sailSeam);
    };

    // Tapered clinker-built hull. The pointed bow is +Z; the broad transom and rudder are -Z.
    const stations=[
      {z:-.62,w:.18,deck:.14,keel:-.095},{z:-.48,w:.22,deck:.15,keel:-.16},
      {z:-.30,w:.245,deck:.16,keel:-.20},{z:-.06,w:.255,deck:.17,keel:-.21},
      {z:.20,w:.225,deck:.16,keel:-.19},{z:.42,w:.15,deck:.15,keel:-.15},
      {z:.62,w:.025,deck:.13,keel:-.085}
    ];
    for(let i=0;i<stations.length-1;i++){
      const a=stations[i],b=stations[i+1];
      const al=[-a.w,a.deck,a.z],ar=[a.w,a.deck,a.z],ak=[0,a.keel,a.z];
      const bl=[-b.w,b.deck,b.z],br=[b.w,b.deck,b.z],bk=[0,b.keel,b.z];
      quad(al,bl,bk,ak,i%2?colors.hull:colors.hullLight,colors.hullShadow);
      quad(ak,bk,br,ar,colors.hullDark,colors.hullShadow);
      quad(al,ar,br,bl,i%2?colors.hullLight:colors.hull,colors.plank);
      quad(al,bl,[bl[0]*.72,.03,b.z],[al[0]*.72,.03,a.z],colors.hullShadow);
      quad([ar[0]*.72,.03,a.z],[br[0]*.72,.03,b.z],br,ar,colors.hullLight);
    }
    // Close the stern with a wide transom so the aft hull is not a second sharp bow.
    const stern=stations[0];
    quad([-stern.w,stern.deck,stern.z],[-stern.w*.68,.012,stern.z],[stern.w*.68,.012,stern.z],[stern.w,stern.deck,stern.z],colors.hull,colors.hullShadow);
    cable([0,-.12,-.56],[0,-.12,.56],.018,colors.hullDark);
    for(const side of [-1,1]){
      for(let level=0;level<5;level++){
        const pts=stations.slice(1,-1).map(s=>[side*s.w*(.92-level*.055),.02+level*.031,s.z]);
        for(let i=0;i<pts.length-1;i++)cable(pts[i],pts[i+1],.0045,level%2?colors.hullLight:colors.hullShadow);
      }
      const rail=stations.map(s=>[side*s.w*.94,s.deck+.095,s.z]);
      for(let i=0;i<rail.length-1;i++)cable(rail[i],rail[i+1],.012,colors.trim);
      for(let i=0;i<9;i++){
        const z=-.42+i*.125;const w=.17+Math.sin(i/8*Math.PI)*.07;
        cable([side*w,.15,z],[side*w,.255,z],.009,colors.trim);
      }
    }
    // Planked deck with individual seams and metal fastening dots.
    const deckLeft=stations.slice(1,-1).map(s=>[-s.w*.90,s.deck+.012,s.z]);
    const deckRight=stations.slice(1,-1).map(s=>[s.w*.90,s.deck+.012,s.z]);
    for(let i=0;i<deckLeft.length-1;i++)quad(deckLeft[i],deckLeft[i+1],deckRight[i+1],deckRight[i],i%2?colors.plank:colors.hullLight);
    for(let i=0;i<12;i++){
      const z=-.43+i*.085;const w=.19+Math.sin(i/11*Math.PI)*.04;
      cable([-w,.18,z],[w,.18,z],.0018,colors.hullShadow);
      for(const side of [-1,1])tri([side*w,.19,z],[side*w+.012,.19,z+.012],[side*w,.19,z+.024],colors.brass);
    }
    // Aft quarterdeck (-Z) and raised forward forecastle (+Z), with clean deck edges.
    box(0,.235,-.37,.30,.19,.27,colors.hullLight,colors.hull);
    box(0,.36,-.37,.34,.035,.30,colors.trim,colors.hullShadow);
    box(0,.255,.37,.38,.24,.32,colors.hullLight,colors.hull);
    box(0,.39,.37,.44,.045,.37,colors.trim,colors.hullShadow);
    for(const x of [-.105,0,.105]){
      box(x,.27,.54,.052,.055,.012,colors.brass,colors.hullDark);
    }
    box(0,.20,.05,.29,.045,.22,colors.hullShadow,colors.hull);
    for(let i=0;i<4;i++)cable([-.12,.228,-.03+i*.052],[.12,.228,-.03+i*.052],.0025,colors.trim);
    // Cargo: lidded barrels with hoops, timber crates and rope coils.
    for(let i=0;i<3;i++){
      const x=-.16+i*.16,z=.19;
      cylinder(x,z,.19,.34,.055,colors.hullLight,12,colors.plank);
      for(const y of [.22,.27,.32])ring(x,z,y,.055,.004,colors.iron,16);
      ring(x,z,.341,.047,.003,colors.trim,16);
    }
    box(-.13,.245,-.19,.13,.12,.13,colors.crateLight,colors.crate);
    box(.13,.245,-.19,.13,.12,.13,colors.crateLight,colors.crate);
    for(const x of [-.13,.13]){
      cable([x-.052,.19,-.255],[x+.052,.30,-.125],.006,colors.trim);
      cable([x+.052,.19,-.255],[x-.052,.30,-.125],.006,colors.trim);
    }
    for(const x of [-.22,.22])ring(x,.01,.19,.052,.009,colors.rope,24);
    // Main mast, yard, large curved sail and upper topsail.
    cylinder(0,-.015,.17,1.42,.027,colors.hullLight,10,colors.trim);
    cable([-.36,1.12,-.015],[.36,1.12,-.015],.015,colors.trim);
    sailGrid(-.02,.72,.93,.40,1.12,.075,1);
    cable([-.39,1.12,-.02],[0,1.62,-.02],.006,colors.rope);
    cable([.39,1.12,-.02],[0,1.62,-.02],.006,colors.rope);
    cable([0,1.42,-.015],[0,1.70,-.015],.016,colors.hullLight);
    cable([-.20,1.70,-.015],[.20,1.70,-.015],.009,colors.trim);
    sailGrid(-.018,.40,.34,1.36,1.70,.032,0);
    // A small foremast and staysail make the rig read as a three-dimensional working vessel.
    cylinder(0,.36,.17,.91,.020,colors.hullLight,8,colors.trim);
    cable([-.23,.79,.36],[.23,.79,.36],.010,colors.trim);
    sailGrid(.365,.43,.57,.24,.78,.045,1);
    // Standing rigging: shrouds, forestays, backstays and bow sprit.
    cable([0,1.70,-.02],[-.20,.25,-.56],.0045,colors.rope);
    cable([0,1.70,-.02],[.20,.25,-.56],.0045,colors.rope);
    cable([-.20,1.70,-.02],[-.22,.25,.44],.004,colors.rope);
    cable([.20,1.70,-.02],[.22,.25,.44],.004,colors.rope);
    cable([0,.36,.60],[0,.53,.80],.012,colors.trim);
    cable([-.08,.30,.58],[0,.50,.81],.004,colors.rope);
    cable([.08,.30,.58],[0,.50,.81],.004,colors.rope);
    // Rudder, steering oar, anchor, mast pennant and a warm stern lantern.
    box(0,.03,-.59,.055,.25,.045,colors.hullDark,colors.hullShadow);
    cable([.20,.30,.42],[.32,.43,.47],.012,colors.trim);
    ring(-.20,.44,.26,.067,.009,colors.iron,20);
    cable([-.20,.26,.44],[-.20,.26,.60],.006,colors.iron);
    box(0,.69,.48,.09,.12,.08,colors.brass,colors.iron);
    box(0,.69,.48,.055,.085,.052,colors.sailLight,colors.trim);
    // A small pennant at the masthead.
    tri([0,1.72,-.02],[.17,1.67,-.02],[0,1.61,-.02],colors.brass);
    // Brass rivets around the hull and belaying pins on deck.
    for(const side of [-1,1])for(let i=0;i<14;i++){
      const z=-.47+i*.078,w=.11+Math.sin(i/13*Math.PI)*.095;
      cylinder(side*w,z,.13,.145,.007,colors.brass,6,colors.trim);
    }
    const data=new Float32Array(vertices);
    return {buffer:uploadBuffer(gl.ARRAY_BUFFER,data),count:data.length/9};
  }

  function shaderUniform(programRef, name) { return gl.getUniformLocation(programRef, name); }
  function makePerspective(fov, aspect, near, far) {
    const f = 1 / Math.tan(fov / 2), nf = 1 / (near - far), out = new Float32Array(16);
    out[0] = f / aspect; out[5] = f; out[10] = (far + near) * nf; out[11] = -1; out[14] = 2 * far * near * nf; return out;
  }
  function lookAt(eye, center, up) {
    let zx=eye[0]-center[0], zy=eye[1]-center[1], zz=eye[2]-center[2]; let len=Math.hypot(zx,zy,zz)||1; zx/=len;zy/=len;zz/=len;
    let xx=up[1]*zz-up[2]*zy, xy=up[2]*zx-up[0]*zz, xz=up[0]*zy-up[1]*zx; len=Math.hypot(xx,xy,xz)||1;xx/=len;xy/=len;xz/=len;
    const yx=zy*xz-zz*xy, yy=zz*xx-zx*xz, yz=zx*xy-zy*xx;
    return new Float32Array([xx,yx,zx,0,xy,yy,zy,0,xz,yz,zz,0,-(xx*eye[0]+xy*eye[1]+xz*eye[2]),-(yx*eye[0]+yy*eye[1]+yz*eye[2]),-(zx*eye[0]+zy*eye[1]+zz*eye[2]),1]);
  }
  function multiply(a,b) {
    const out = new Float32Array(16);
    for(let col=0;col<4;col++)for(let row=0;row<4;row++)out[col*4+row]=a[row]*b[col*4]+a[4+row]*b[col*4+1]+a[8+row]*b[col*4+2]+a[12+row]*b[col*4+3];
    return out;
  }
  function modelMatrix(x=0,y=0,z=0,yaw=0,scale=1) {
    const c=Math.cos(yaw)*scale,s=Math.sin(yaw)*scale;
    return new Float32Array([c,0,-s,0,0,scale,0,0,s,0,c,0,x,y,z,1]);
  }
  function bindAttribute(buffer, location, size) {
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer); gl.enableVertexAttribArray(location); gl.vertexAttribPointer(location, size, gl.FLOAT, false, 0, 0);
  }
  function drawTerrain(mvp, model, time, eye) {
    gl.useProgram(program);
    bindAttribute(terrain.position, gl.getAttribLocation(program,'aPosition'),3);
    bindAttribute(terrain.normal, gl.getAttribLocation(program,'aNormal'),3);
    bindAttribute(terrain.uv, gl.getAttribLocation(program,'aUv'),2);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, terrain.index);
    gl.uniformMatrix4fv(shaderUniform(program,'uMvp'),false,mvp);
    gl.uniformMatrix4fv(shaderUniform(program,'uModel'),false,model);
    gl.uniform1f(shaderUniform(program,'uTime'),time);
    gl.uniform3fv(shaderUniform(program,'uCamera'),eye);
    gl.activeTexture(gl.TEXTURE0);gl.bindTexture(gl.TEXTURE_2D,colorTexture);gl.uniform1i(shaderUniform(program,'uColor'),0);
    gl.activeTexture(gl.TEXTURE1);gl.bindTexture(gl.TEXTURE_2D,maskTexture);gl.uniform1i(shaderUniform(program,'uMask'),1);
    gl.drawElements(gl.TRIANGLES,terrain.count,gl.UNSIGNED_SHORT,0);
  }
  function drawColored(item, mvp, alpha=1, mode=gl.TRIANGLES, model=null) {
    gl.useProgram(boatProgram);
    const pos=gl.getAttribLocation(boatProgram,'aPosition'),color=gl.getAttribLocation(boatProgram,'aColor'),normal=gl.getAttribLocation(boatProgram,'aNormal');
    const identity=model||new Float32Array([1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1]);
    if(item.color){
      bindAttribute(item.position,pos,3);bindAttribute(item.color,color,3);
      gl.disableVertexAttribArray(normal);gl.vertexAttrib3f(normal,0,1,0);gl.uniform1f(shaderUniform(boatProgram,'uLighting'),0);
    }else{
      gl.bindBuffer(gl.ARRAY_BUFFER,item.buffer);
      gl.enableVertexAttribArray(pos);gl.vertexAttribPointer(pos,3,gl.FLOAT,false,36,0);
      gl.enableVertexAttribArray(color);gl.vertexAttribPointer(color,3,gl.FLOAT,false,36,12);
      gl.enableVertexAttribArray(normal);gl.vertexAttribPointer(normal,3,gl.FLOAT,false,36,24);
      gl.uniform1f(shaderUniform(boatProgram,'uLighting'),1);
    }
    gl.uniformMatrix4fv(shaderUniform(boatProgram,'uMvp'),false,mvp);
    gl.uniformMatrix4fv(shaderUniform(boatProgram,'uModel'),false,identity);
    gl.uniform1f(shaderUniform(boatProgram,'uAlpha'),alpha);
    gl.drawArrays(mode,0,item.count);
  }
  function positionOnRoute(progress) {
    if(routeSampleTable.length<2)return {x:0,z:0,yaw:0};
    const target=clamp01(progress)*routeSampleLength;
    let lo=0,hi=routeSampleTable.length-1;
    while(lo<hi){const mid=(lo+hi)>>1;if(routeSampleTable[mid].distance<target)lo=mid+1;else hi=mid;}
    const i=Math.max(1,lo),a=routeSampleTable[i-1],b=routeSampleTable[i];
    const span=Math.max(1e-8,b.distance-a.distance),t=clamp01((target-a.distance)/span);
    const x=a.x+(b.x-a.x)*t,z=a.z+(b.z-a.z)*t;
    // This fallback mesh's bowsprit points along local +Z. Its yaw therefore
    // maps +Z directly onto increasing route progress (the Three.js mesh uses -Z).
    return {x,z,yaw:Math.atan2(b.x-a.x,b.z-a.z),tx:(b.x-a.x)/span,tz:(b.z-a.z)/span};
  }
  function readVoyageProgress(){
    const globalProgress=Number(window.PONTUS_VOYAGE_PROGRESS);
    if(Number.isFinite(globalProgress))return clamp01(globalProgress);
    const text=Number.parseFloat(document.getElementById('voyage-progress-value')?.textContent||'');
    return Number.isFinite(text)?clamp01(text/100):0;
  }
  function coarsePointerScale(){return matchMedia('(pointer: coarse)').matches?1.50:1.72;}
  let smoothedVoyageProgress=0,lastDrawTime=0;
  function draw(time) {
    if(!gl||state!=='running')return;
    const w=canvas.clientWidth||innerWidth,h=canvas.clientHeight||innerHeight;
    const dpr=Math.min(devicePixelRatio||1,1.35);
    const cw=Math.max(1,Math.round(w*dpr)),ch=Math.max(1,Math.round(h*dpr));
    if(cw!==canvas.width||ch!==canvas.height){canvas.width=cw;canvas.height=ch;gl.viewport(0,0,cw,ch);}
    const dt=lastDrawTime?Math.max(0,Math.min(.05,(time-lastDrawTime)/1000)):1/60;lastDrawTime=time;
    const targetProgress=readVoyageProgress();
    smoothedVoyageProgress=reducedMotion?targetProgress:smoothedVoyageProgress+(targetProgress-smoothedVoyageProgress)*(1-Math.exp(-8.5*dt));
    const aspect=cw/ch, seconds=(time-startTime)/1000;
    const eye=[Math.sin(seconds*.075)*.32,9.25+Math.sin(seconds*.11)*.11,13.7+Math.cos(seconds*.06)*.2];
    const projection=makePerspective(39*Math.PI/180,aspect,.1,70);
    const view=lookAt(eye,[0,.02,0],[0,1,0]);
    const model=modelMatrix(Math.sin(seconds*.035)*.025,0,0,Math.sin(seconds*.035)*.006,1);
    const mvp=multiply(projection,multiply(view,model));
    gl.enable(gl.DEPTH_TEST);gl.depthFunc(gl.LEQUAL);gl.enable(gl.CULL_FACE);gl.cullFace(gl.BACK);
    gl.clearColor(0,0,0,0);gl.clear(gl.COLOR_BUFFER_BIT|gl.DEPTH_BUFFER_BIT);
    gl.disable(gl.BLEND);drawTerrain(mvp,model,seconds,eye);
    gl.enable(gl.BLEND);gl.blendFunc(gl.SRC_ALPHA,gl.ONE_MINUS_SRC_ALPHA);gl.depthMask(false);gl.disable(gl.CULL_FACE);
    drawColored(route,mvp,.68,gl.TRIANGLES);
    const p=positionOnRoute(smoothedVoyageProgress),bob=Math.sin(seconds*2.2)*.018;
    const boatScale=coarsePointerScale();
    // The bowsprit is the route anchor. This fallback hull's bow reaches local Z=+.80.
    const bowOffset=.78*boatScale;const hullX=p.x-p.tx*bowOffset,hullZ=p.z-p.tz*bowOffset;
    window.PONTUS_VESSEL_DEBUG={renderer:'webgl1-local',progress:smoothedVoyageProgress,x:hullX,z:hullZ,routeX:p.x,routeZ:p.z,bowX:hullX+Math.sin(p.yaw)*bowOffset,bowZ:hullZ+Math.cos(p.yaw)*bowOffset,heading:p.yaw,scale:boatScale,bowOffset};
    const boatModel=modelMatrix(hullX,-.045+bob,hullZ,p.yaw+Math.sin(seconds*1.25)*.012,boatScale);
    const boatWorldModel=multiply(model,boatModel);
    drawColored(boat,multiply(projection,multiply(view,boatWorldModel)),1,gl.TRIANGLES,boatWorldModel);
    gl.depthMask(true);gl.enable(gl.CULL_FACE);gl.disable(gl.BLEND);
    if(!reducedMotion)raf=requestAnimationFrame(draw);
  }

  function makeCanvasReliefRenderer(albedoImg){
    // 2.5D emergency renderer: one high-resolution, geographically registered map
    // plane, not a low-resolution triangle mosaic. The ship and route remain live.
    const ctx=canvas.getContext('2d',{alpha:true,desynchronized:true});
    if(!ctx)throw new Error('Canvas 2D nu este disponibil.');
    const mapAspect=albedoImg.naturalWidth/albedoImg.naturalHeight;
    let offscreen=document.createElement('canvas'),offCtx=offscreen.getContext('2d');
    if(!offCtx)throw new Error('Canvas 2D offscreen nu este disponibil.');
    let viewport={w:0,h:0,dpr:1},plate={x:0,y:0,w:0,h:0},map={x:0,y:0,w:0,h:0},particles=[],canvasRouteSamples=[],canvasRouteLength=0,smoothedProgress=0,lastPaintTime=0;
    const routePixels=()=>ROUTE.map(([lon,lat])=>{
      const [px,py]=project(lon,lat),u=(px-projectedBounds.minX)/projectedBounds.width,v=(py-projectedBounds.minY)/projectedBounds.height;
      return {x:map.x+u*map.w,y:map.y+(1-v)*map.h};
    });
    const geoPixel=(lon,lat)=>{
      const [px,py]=project(lon,lat),u=(px-projectedBounds.minX)/projectedBounds.width,v=(py-projectedBounds.minY)/projectedBounds.height;
      return {x:map.x+u*map.w,y:map.y+(1-v)*map.h};
    };
    function roundRectPath(c,x,y,w,h,r){
      const rr=Math.min(r,w/2,h/2);c.beginPath();c.moveTo(x+rr,y);c.arcTo(x+w,y,x+w,y+h,rr);c.arcTo(x+w,y+h,x,y+h,rr);c.arcTo(x,y+h,x,y,rr);c.arcTo(x,y,x+w,y,rr);c.closePath();
    }
    function drawScrew(c,x,y,r){
      c.save();c.fillStyle='#493a27';c.strokeStyle='rgba(226,190,136,.84)';c.lineWidth=1;c.beginPath();c.arc(x,y,r,0,Math.PI*2);c.fill();c.stroke();
      c.strokeStyle='rgba(225,198,155,.68)';c.lineWidth=.7;c.beginPath();c.moveTo(x-r*.42,y);c.lineTo(x+r*.42,y);c.stroke();c.restore();
    }
    function catmull2D(p0,p1,p2,p3,t){const t2=t*t,t3=t2*t;return{x:.5*((2*p1.x)+(-p0.x+p2.x)*t+(2*p0.x-5*p1.x+4*p2.x-p3.x)*t2+(-p0.x+3*p1.x-3*p2.x+p3.x)*t3),y:.5*((2*p1.y)+(-p0.y+p2.y)*t+(2*p0.y-5*p1.y+4*p2.y-p3.y)*t2+(-p0.y+3*p1.y-3*p2.y+p3.y)*t3)}}
    function rebuildRouteSamples(){
      const controls=ROUTE.map(([lon,lat])=>geoPixel(lon,lat)),samples=[],steps=44;
      for(let i=0;i<controls.length-1;i++){
        const p0=controls[Math.max(0,i-1)],p1=controls[i],p2=controls[i+1],p3=controls[Math.min(controls.length-1,i+2)];
        for(let j=0;j<steps;j++)samples.push(catmull2D(p0,p1,p2,p3,j/steps));
      }
      samples.push(controls[controls.length-1]);
      let total=0;for(let i=0;i<samples.length;i++){if(i){const a=samples[i-1],b=samples[i];total+=Math.hypot(b.x-a.x,b.y-a.y);}samples[i].distance=total;}
      canvasRouteSamples=samples;canvasRouteLength=total;
    }
    function rebuild(width,height){
      const dpr=Math.min(devicePixelRatio||1,1.5),w=Math.max(1,width),h=Math.max(1,height);
      viewport={w,h,dpr};canvas.width=Math.max(1,Math.round(w*dpr));canvas.height=Math.max(1,Math.round(h*dpr));
      offscreen.width=canvas.width;offscreen.height=canvas.height;
      ctx.setTransform(dpr,0,0,dpr,0,0);offCtx.setTransform(dpr,0,0,dpr,0,0);
      const mobile=w<760;
      const maxMapW=w*(mobile?.94:.86),maxMapH=h*(mobile?.50:1.02);
      const mapW=Math.min(maxMapW,maxMapH*mapAspect),mapH=mapW/mapAspect;
      const framePad=Math.max(7,Math.min(13,w*.009));
      map={x:(w-mapW)/2,y:(h-mapH)/2+(mobile?0:Math.min(12,h*.012)),w:mapW,h:mapH};
      plate={x:map.x-framePad,y:map.y-framePad,w:map.w+framePad*2,h:map.h+framePad*2};
      offCtx.clearRect(0,0,w,h);
      // Layered dark walnut / oxidized brass frame, with a restrained depth shadow.
      offCtx.save();roundRectPath(offCtx,plate.x-2,plate.y+9,plate.w+4,plate.h+8,8);
      offCtx.shadowColor='rgba(0,0,0,.62)';offCtx.shadowBlur=30;offCtx.shadowOffsetY=13;offCtx.fillStyle='rgba(2,10,14,.96)';offCtx.fill();offCtx.restore();
      const metal=offCtx.createLinearGradient(plate.x,plate.y,plate.x+plate.w,plate.y+plate.h);
      metal.addColorStop(0,'#6e5637');metal.addColorStop(.22,'#c7a36e');metal.addColorStop(.5,'#59452e');metal.addColorStop(.78,'#b18b58');metal.addColorStop(1,'#4e3b29');
      roundRectPath(offCtx,plate.x,plate.y,plate.w,plate.h,7);offCtx.fillStyle=metal;offCtx.fill();
      roundRectPath(offCtx,plate.x+2.5,plate.y+2.5,plate.w-5,plate.h-5,5);offCtx.fillStyle='#101a1c';offCtx.fill();
      // Small bevel highlight gives the plate a real physical edge without noisy geometry.
      offCtx.strokeStyle='rgba(246,220,177,.56)';offCtx.lineWidth=1;roundRectPath(offCtx,plate.x+3.5,plate.y+3.5,plate.w-7,plate.h-7,4);offCtx.stroke();
      offCtx.save();roundRectPath(offCtx,map.x,map.y,map.w,map.h,2);offCtx.clip();
      offCtx.drawImage(albedoImg,map.x,map.y,map.w,map.h);
      const shade=offCtx.createLinearGradient(map.x,map.y,map.x,map.y+map.h);shade.addColorStop(0,'rgba(3,13,17,.08)');shade.addColorStop(.55,'rgba(4,18,22,0)');shade.addColorStop(1,'rgba(3,11,14,.19)');offCtx.fillStyle=shade;offCtx.fillRect(map.x,map.y,map.w,map.h);
      const gloss=offCtx.createLinearGradient(map.x,map.y,map.x+map.w*.7,map.y+map.h*.8);gloss.addColorStop(0,'rgba(255,235,198,.14)');gloss.addColorStop(.25,'rgba(255,235,198,.035)');gloss.addColorStop(.65,'rgba(255,235,198,0)');offCtx.fillStyle=gloss;offCtx.fillRect(map.x,map.y,map.w,map.h);
      offCtx.restore();
      offCtx.strokeStyle='rgba(228,194,139,.62)';offCtx.lineWidth=.8;offCtx.strokeRect(map.x+.5,map.y+.5,map.w-1,map.h-1);
      const screwR=Math.max(2.2,Math.min(4.2,w*.003));
      [[plate.x+7,plate.y+7],[plate.x+plate.w-7,plate.y+7],[plate.x+7,plate.y+plate.h-7],[plate.x+plate.w-7,plate.y+plate.h-7]].forEach(([x,y])=>drawScrew(offCtx,x,y,screwR));
      offCtx.save();offCtx.font=`${Math.max(7,Math.min(10,w*.007))}px 'DM Mono',monospace`;offCtx.fillStyle='rgba(232,207,166,.78)';offCtx.textBaseline='bottom';
      offCtx.fillText('PONTUS · CARTA BATHYMETRICA',plate.x+12,plate.y-5);offCtx.textAlign='right';offCtx.fillText('BOSFOR  —  CAFFA',plate.x+plate.w-12,plate.y-5);offCtx.restore();
      rebuildRouteSamples();
      particles=Array.from({length:Math.round(mobile?12:25)},()=>({x:Math.random()*w,y:Math.random()*h,r:.45+Math.random()*.8,phase:Math.random()*Math.PI*2,speed:.12+Math.random()*.16,drift:3+Math.random()*8}));
    }
    function routePosition(progress){
      if(canvasRouteSamples.length<2)return{x:map.x+map.w*.5,y:map.y+map.h*.5,angle:0};
      const target=clamp01(progress)*canvasRouteLength;let lo=0,hi=canvasRouteSamples.length-1;
      while(lo<hi){const mid=(lo+hi)>>1;if(canvasRouteSamples[mid].distance<target)lo=mid+1;else hi=mid;}
      const i=Math.max(1,lo),a=canvasRouteSamples[i-1],b=canvasRouteSamples[i],span=Math.max(1e-6,b.distance-a.distance),t=clamp01((target-a.distance)/span);
      return{x:a.x+(b.x-a.x)*t,y:a.y+(b.y-a.y)*t,angle:Math.atan2(b.y-a.y,b.x-a.x)};
    }
    function drawRoute(time,progress){
      const pts=canvasRouteSamples;
      ctx.save();ctx.lineCap='round';ctx.lineJoin='round';ctx.beginPath();pts.forEach((p,i)=>i?ctx.lineTo(p.x,p.y):ctx.moveTo(p.x,p.y));
      ctx.strokeStyle='rgba(12,30,34,.72)';ctx.lineWidth=4;ctx.stroke();
      ctx.setLineDash([7,9]);ctx.lineDashOffset=-(time*11);ctx.strokeStyle='rgba(236,194,128,.74)';ctx.lineWidth=1.35;ctx.shadowColor='rgba(237,192,122,.56)';ctx.shadowBlur=6;ctx.stroke();ctx.setLineDash([]);
      // The completed part of the route lights up behind the moving vessel.
      const travelled=clamp01(progress)*canvasRouteLength;ctx.beginPath();let started=false;
      for(const point of pts){if(point.distance>travelled)break;if(!started){ctx.moveTo(point.x,point.y);started=true;}else ctx.lineTo(point.x,point.y);}
      const vesselPoint=routePosition(progress);if(started)ctx.lineTo(vesselPoint.x,vesselPoint.y);
      ctx.strokeStyle='rgba(246,211,157,.94)';ctx.lineWidth=2.0;ctx.shadowColor='rgba(237,192,122,.82)';ctx.shadowBlur=9;ctx.stroke();ctx.setLineDash([]);ctx.restore();
      const markers=[{p:[29,41.12],label:'BOSFOR',dx:-10,dy:18,align:'right'},{p:[28.65,44.18],label:'CONSTANȚA',dx:-8,dy:-10,align:'right'},{p:[35.38,45.03],label:'CAFFA',dx:9,dy:-9,align:'left'}];
      for(const item of markers){const q=geoPixel(...item.p);ctx.save();ctx.fillStyle='#f0cf98';ctx.shadowColor='rgba(244,194,119,.85)';ctx.shadowBlur=9;ctx.beginPath();ctx.arc(q.x,q.y,2.6,0,Math.PI*2);ctx.fill();ctx.shadowBlur=0;ctx.font=`600 ${Math.max(7,Math.min(9,8))}px 'DM Mono',monospace`;ctx.textAlign=item.align;ctx.fillStyle='rgba(12,25,29,.86)';ctx.fillText(item.label,q.x+item.dx+1,q.y+item.dy+1);ctx.fillStyle='rgba(247,222,180,.94)';ctx.fillText(item.label,q.x+item.dx,q.y+item.dy);ctx.restore();}
    }
    function drawBoat(time,progress){
      const p=routePosition(progress),scale=Math.max(.86,Math.min(1.52,map.w/850)),bob=Math.sin(time*1.86)*1.5;
      // In the Canvas2D side view the bow is the +X tip of the hull; align that tip to the route.
      const bowOffset=38*scale,centerX=p.x-Math.cos(p.angle)*bowOffset,centerY=p.y-Math.sin(p.angle)*bowOffset;
      window.PONTUS_VESSEL_DEBUG={renderer:'canvas2d-local',progress,x:centerX,y:centerY,routeX:p.x,routeY:p.y,bowX:centerX+Math.cos(p.angle)*bowOffset,bowY:centerY+Math.sin(p.angle)*bowOffset,heading:p.angle,scale,bowOffset};
      // Wake is drawn before the hull and follows the boat's heading.
      ctx.save();ctx.translate(centerX,centerY+bob);ctx.rotate(p.angle);ctx.scale(scale,scale);
      ctx.globalAlpha=.42;ctx.strokeStyle='rgba(185,221,215,.85)';ctx.lineWidth=1.5;for(let i=0;i<4;i++){ctx.beginPath();ctx.moveTo(-21,5+i*2.5);ctx.quadraticCurveTo(-37-i*4,9+i*3,-52-i*5,6+i*3+Math.sin(time*2+i)*1.5);ctx.stroke();}ctx.globalAlpha=1;
      ctx.shadowColor='rgba(0,0,0,.52)';ctx.shadowBlur=13;ctx.shadowOffsetY=7;
      // Carved hull, gunwale and deck.
      ctx.beginPath();ctx.moveTo(-34,-2);ctx.quadraticCurveTo(-28,11,-9,13);ctx.lineTo(23,9);ctx.quadraticCurveTo(34,4,38,-3);ctx.lineTo(24,-1);ctx.quadraticCurveTo(0,5,-22,-3);ctx.closePath();
      const hull=ctx.createLinearGradient(0,-5,0,14);hull.addColorStop(0,'#b48754');hull.addColorStop(.25,'#79502f');hull.addColorStop(.75,'#3f291d');hull.addColorStop(1,'#1c1713');ctx.fillStyle=hull;ctx.fill();ctx.strokeStyle='#d5af78';ctx.lineWidth=1.3;ctx.stroke();
      ctx.shadowBlur=0;ctx.shadowOffsetY=0;ctx.beginPath();ctx.moveTo(-24,-1);ctx.quadraticCurveTo(0,5,29,-1);ctx.strokeStyle='rgba(239,204,150,.75)';ctx.lineWidth=1.1;ctx.stroke();
      // Deckhouse, coaming, hatch seams and visible cargo details add a stronger 3D read.
      ctx.fillStyle='#4b3020';ctx.fillRect(8,-8,16,10);ctx.strokeStyle='#c29a64';ctx.lineWidth=.9;ctx.strokeRect(8,-8,16,10);
      ctx.fillStyle='#8d6844';ctx.fillRect(10,-11,12,4);ctx.strokeRect(10,-11,12,4);
      ctx.strokeStyle='rgba(231,197,148,.55)';ctx.lineWidth=.55;for(let i=0;i<4;i++){ctx.beginPath();ctx.moveTo(-18+i*8,2);ctx.lineTo(-16+i*8,6);ctx.stroke();}
      ctx.fillStyle='#705034';ctx.fillRect(-10,-5,10,6);ctx.strokeStyle='#c39a63';ctx.lineWidth=.65;ctx.strokeRect(-10,-5,10,6);ctx.fillStyle='#987149';ctx.fillRect(3,-4,8,5);ctx.strokeRect(3,-4,8,5);
      // Barrel bands, lashings, portholes and a raised stern rail.
      ctx.fillStyle='#815c38';ctx.beginPath();ctx.ellipse(-12,-2,5,6,0,0,Math.PI*2);ctx.fill();ctx.strokeStyle='#c29a64';ctx.lineWidth=.75;ctx.stroke();
      ctx.beginPath();ctx.ellipse(-12,-2,5,2,0,0,Math.PI*2);ctx.stroke();ctx.beginPath();ctx.ellipse(-12,2,5,2,0,0,Math.PI*2);ctx.stroke();
      ctx.strokeStyle='rgba(218,185,138,.76)';ctx.lineWidth=.7;ctx.beginPath();ctx.moveTo(-27,-4);ctx.lineTo(-25,-10);ctx.lineTo(25,-10);ctx.lineTo(30,-4);ctx.stroke();
      for(const x of [-18,-7,7,18]){ctx.fillStyle='#1d2525';ctx.beginPath();ctx.arc(x,4,1.25,0,Math.PI*2);ctx.fill();ctx.strokeStyle='#b98b58';ctx.stroke();}
      // Main mast, two curved sails, rigging and a small masthead pennant.
      ctx.strokeStyle='#4b3421';ctx.lineWidth=2.4;ctx.beginPath();ctx.moveTo(-1,0);ctx.lineTo(-1,-55);ctx.stroke();
      ctx.beginPath();ctx.moveTo(-2,-51);ctx.quadraticCurveTo(-19,-47,-25,-39);ctx.quadraticCurveTo(-14,-24,-3,-7);ctx.closePath();
      const sailA=ctx.createLinearGradient(-25,-48,-2,-7);sailA.addColorStop(0,'#f1e6cf');sailA.addColorStop(.55,'#dfd0b2');sailA.addColorStop(1,'#a99572');ctx.fillStyle=sailA;ctx.fill();ctx.strokeStyle='rgba(255,244,222,.78)';ctx.lineWidth=.7;ctx.stroke();
      ctx.beginPath();ctx.moveTo(1,-46);ctx.quadraticCurveTo(18,-39,23,-30);ctx.lineTo(3,-8);ctx.closePath();ctx.fillStyle='#c8b38e';ctx.fill();ctx.stroke();
      // Smaller forward staysail and a short upper sail create layered sail planes.
      ctx.beginPath();ctx.moveTo(-1,-42);ctx.quadraticCurveTo(-12,-33,-21,-19);ctx.lineTo(-2,-18);ctx.closePath();
      const foreSail=ctx.createLinearGradient(-21,-40,-2,-18);foreSail.addColorStop(0,'#eadfc9');foreSail.addColorStop(1,'#9d896c');ctx.fillStyle=foreSail;ctx.fill();ctx.stroke();
      ctx.beginPath();ctx.moveTo(-1,-70);ctx.quadraticCurveTo(-12,-67,-14,-58);ctx.lineTo(-2,-56);ctx.closePath();ctx.fillStyle='#e2d5bd';ctx.fill();ctx.stroke();
      ctx.strokeStyle='rgba(221,196,155,.82)';ctx.lineWidth=.65;ctx.beginPath();ctx.moveTo(-1,-54);ctx.lineTo(-28,-39);ctx.moveTo(-1,-46);ctx.lineTo(24,-30);ctx.moveTo(-1,-54);ctx.lineTo(0,-2);ctx.moveTo(-1,-42);ctx.lineTo(-23,-17);ctx.stroke();
      ctx.fillStyle='#d9ad6d';ctx.beginPath();ctx.moveTo(-2,-55);ctx.lineTo(11,-52+Math.sin(time*1.7)*1.5);ctx.lineTo(-2,-49);ctx.closePath();ctx.fill();
      ctx.restore();
      // Soft moving halo underneath the vessel; deliberately subdued.
      const glow=ctx.createRadialGradient(p.x,p.y,0,p.x,p.y,19*scale);glow.addColorStop(0,'rgba(219,190,144,.16)');glow.addColorStop(1,'rgba(219,190,144,0)');ctx.fillStyle=glow;ctx.beginPath();ctx.arc(p.x,p.y,19*scale,0,Math.PI*2);ctx.fill();
    }
    function paint(time){
      const w=viewport.w,h=viewport.h,dpr=viewport.dpr;ctx.setTransform(dpr,0,0,dpr,0,0);ctx.clearRect(0,0,w,h);ctx.drawImage(offscreen,0,0,w,h);
      const dt=lastPaintTime?Math.max(0,Math.min(.05,time-lastPaintTime)):1/60;lastPaintTime=time;
      const target=readVoyageProgress();smoothedProgress=reducedMotion?target:smoothedProgress+(target-smoothedProgress)*(1-Math.exp(-8.5*dt));
      const progress=clamp01(smoothedProgress);
      drawRoute(time,progress);drawBoat(time,progress);
      for(const dot of particles){const pulse=.22+.22*Math.sin(time*dot.speed+dot.phase);ctx.globalAlpha=pulse;ctx.fillStyle='#e4d1ac';ctx.beginPath();ctx.arc(dot.x+Math.sin(time*.12+dot.phase)*dot.drift,dot.y+Math.cos(time*.10+dot.phase)*dot.drift,dot.r,0,Math.PI*2);ctx.fill();}ctx.globalAlpha=1;
      // Very subtle moving sheen over the sea keeps the fallback from feeling like a still poster.
      const sheen=ctx.createLinearGradient(map.x+Math.sin(time*.16)*map.w*.3,map.y,map.x+map.w*.55+Math.sin(time*.16)*map.w*.3,map.y+map.h);sheen.addColorStop(0,'rgba(255,255,255,0)');sheen.addColorStop(.48,'rgba(182,218,210,.035)');sheen.addColorStop(1,'rgba(255,255,255,0)');ctx.save();ctx.globalCompositeOperation='screen';ctx.fillStyle=sheen;ctx.fillRect(map.x,map.y,map.w,map.h);ctx.restore();
    }
    function resize(){rebuild(canvas.clientWidth||innerWidth,canvas.clientHeight||innerHeight);}
    function render(){
      if(state!=='running')return;
      try{if(!document.hidden)paint((performance.now()-startTime)/1000);}
      catch(error){state='failed';console.error('Randarea atlasului local a eșuat; rămâne activ fundalul static.',error);ROOT.classList.remove('local-relief-2d-ready');ROOT.classList.add('world-fallback-active');const status=document.getElementById('world-fallback-status');if(status)status.textContent='ATLAS STATIC ACTIV · RANDĂRE ANIMATĂ INDISPONIBILĂ';return;}
      if(!reducedMotion&&!document.hidden)raf=requestAnimationFrame(render);
    }
    resize();return {render,resize};
  }


  function observeResize(callback){
    if(typeof ResizeObserver==='function'){
      resizeObserver=new ResizeObserver(callback);resizeObserver.observe(canvas);
    }else{
      resizeHandler=callback;window.addEventListener('resize',resizeHandler,{passive:true});
    }
  }
  function observeVisibility(drawOnce){
    visibilityHandler=()=>{
      if(document.hidden){if(raf)cancelAnimationFrame(raf);raf=0;}
      else if(state==='running'){
        if(reducedMotion){drawOnce(performance.now());}
        else if(!raf)raf=requestAnimationFrame(drawOnce);
      }
    };
    document.addEventListener('visibilitychange',visibilityHandler,{passive:true});
  }

  async function start() {
    if(state==='running'||state==='starting')return;
    state='starting';
    canvas=document.getElementById('world-fallback-3d');
    if(!canvas){state='idle';return;}
    try {
      gl=canvas.getContext('webgl',{alpha:true,antialias:true,depth:true,stencil:false,powerPreference:'low-power',preserveDrawingBuffer:false})||canvas.getContext('experimental-webgl');
      const albedoImg=await loadImage('./assets/black-sea-relief-albedo-detail.webp');
      if(state!=='starting')return;
      if(!gl){
        const renderer2d=makeCanvasReliefRenderer(albedoImg);
        canvas.style.opacity='1';ROOT.classList.add('local-relief-2d-ready','world-fallback-active');ROOT.classList.remove('world-loading');
        const status=document.getElementById('world-fallback-status');if(status)status.textContent='RELIEF PERSPECTIV LOCAL · NAVĂ ANIMATĂ';
        if(window.__PONTUS_BOOT_WATCHDOG__)clearTimeout(window.__PONTUS_BOOT_WATCHDOG__);
        state='running';startTime=performance.now();smoothedVoyageProgress=readVoyageProgress();lastDrawTime=0;
        const progressHandler=()=>{if(reducedMotion&&state==='running'&&!document.hidden)renderer2d.render();};
        window.addEventListener('pontus:voyage-progress',progressHandler);progressEventHandler=progressHandler;
        observeResize(()=>{renderer2d.resize();if(reducedMotion)renderer2d.render();});observeVisibility(renderer2d.render);
        canvas.addEventListener('webglcontextlost',onContextLost,{passive:false});if(reducedMotion)renderer2d.render();else raf=requestAnimationFrame(renderer2d.render);return;
      }
      const [heightImg,maskImg]=await Promise.all([
        loadImage('./assets/black-sea-height.webp'),
        loadImage('./assets/black-sea-water-mask.webp')
      ]);
      if(state!=='starting')return;
      const heights=imagePixels(heightImg),mask=imagePixels(maskImg),data=buildTerrain(heights,mask);
      program=createProgram(gl,vertexSource,fragmentSource);boatProgram=createProgram(gl,coloredVertex,coloredFragment);
      terrain=makeTerrainBuffers(data);route=buildRoute(mask);boat=buildBoat();colorTexture=makeTexture(albedoImg);maskTexture=makeTexture(maskImg);
      gl.clearColor(0,0,0,0);gl.enable(gl.DEPTH_TEST);
      canvas.style.opacity='1';ROOT.classList.add('local-3d-fallback-ready','world-fallback-active','world-local-ready');ROOT.classList.remove('world-loading');
      const status=document.getElementById('world-fallback-status');if(status)status.textContent='MODEL 3D LOCAL ACTIV · ATLAS REGIONAL';
      if(window.__PONTUS_BOOT_WATCHDOG__)clearTimeout(window.__PONTUS_BOOT_WATCHDOG__);
      state='running';startTime=performance.now();smoothedVoyageProgress=readVoyageProgress();lastDrawTime=0;
      const progressHandler=()=>{if(reducedMotion&&state==='running'&&!document.hidden)draw(performance.now());};
      window.addEventListener('pontus:voyage-progress',progressHandler);progressEventHandler=progressHandler;
      observeResize(()=>{lastWidth=0;lastHeight=0;if(reducedMotion&&state==='running'){if(raf)cancelAnimationFrame(raf);raf=requestAnimationFrame(draw);}});observeVisibility(draw);
      canvas.addEventListener('webglcontextlost',onContextLost,{passive:false});
      if(reducedMotion)draw(performance.now());else raf=requestAnimationFrame(draw);
    } catch(error) {
      state='failed';
      console.error('PONTUS local 3D fallback failed; static atlas remains visible.',error);
      ROOT.classList.remove('local-3d-fallback-ready');ROOT.classList.add('world-fallback-active');
      const status=document.getElementById('world-fallback-status');if(status)status.textContent='ATLAS LOCAL ACTIV · RANDARE 3D INDISPONIBILĂ';
    }
  }
  function onContextLost(event){event.preventDefault();stop(true);ROOT.classList.add('world-fallback-active');const status=document.getElementById('world-fallback-status');if(status)status.textContent='CONTEXT GRAFIC INACTIV · ATLAS LOCAL ACTIV';}
  function stop(hide=true) {
    if(raf)cancelAnimationFrame(raf);raf=0;
    resizeObserver?.disconnect();resizeObserver=null;
    if(resizeHandler){window.removeEventListener('resize',resizeHandler);resizeHandler=null;}
    if(visibilityHandler){document.removeEventListener('visibilitychange',visibilityHandler);visibilityHandler=null;}
    if(progressEventHandler){window.removeEventListener('pontus:voyage-progress',progressEventHandler);progressEventHandler=null;}
    if(hide){ROOT.classList.remove('local-3d-fallback-ready','local-relief-2d-ready','world-local-ready');if(canvas)canvas.style.opacity='0';}
    state='stopped';
  }
  window.PONTUS_LOCAL_3D_FALLBACK={start,stop,get state(){return state;},get renderer(){return gl?'WebGL1 local, fără biblioteci externe':state==='running'?'Canvas 2D · perspectivă topografică':'atlas static';}};
})();
