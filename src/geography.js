import { BLACK_SEA_BOUNDS } from './geo-data.js';

export const MAP_WIDTH = 10.8;
export const WATER_LEVEL = 0.465;

// WGS84 Lambert Conformal Conic projection for the Black Sea regional extent.
// The same transform is used by the relief, coastlines, grid, bathymetry,
// port landmarks, itinerary and miniature chart so nothing drifts between layers.
export const GEO_PROJECTION = Object.freeze({
  a: 6378137,
  eccentricity: 0.08181919084262149,
  lon0: 34.5 * Math.PI / 180,
  lat0: 43.5 * Math.PI / 180,
  lat1: 40 * Math.PI / 180,
  lat2: 47 * Math.PI / 180
});

const lccM = phi => Math.cos(phi) / Math.sqrt(1 - GEO_PROJECTION.eccentricity ** 2 * Math.sin(phi) ** 2);
const lccT = phi => {
  const e=GEO_PROJECTION.eccentricity, sin=Math.sin(phi);
  return Math.tan(Math.PI/4-phi/2) / Math.pow((1-e*sin)/(1+e*sin),e/2);
};
const LCC_N = (Math.log(lccM(GEO_PROJECTION.lat1))-Math.log(lccM(GEO_PROJECTION.lat2))) /
  (Math.log(lccT(GEO_PROJECTION.lat1))-Math.log(lccT(GEO_PROJECTION.lat2)));
const LCC_F = lccM(GEO_PROJECTION.lat1) / (LCC_N * Math.pow(lccT(GEO_PROJECTION.lat1),LCC_N));
const LCC_RHO0 = GEO_PROJECTION.a * LCC_F * Math.pow(lccT(GEO_PROJECTION.lat0),LCC_N);

export function projectWGS84(lon,lat){
  const lambda=lon*Math.PI/180,phi=lat*Math.PI/180;
  const rho=GEO_PROJECTION.a*LCC_F*Math.pow(lccT(phi),LCC_N);
  const theta=LCC_N*(lambda-GEO_PROJECTION.lon0);
  return [rho*Math.sin(theta),LCC_RHO0-rho*Math.cos(theta)];
}

export function calculateProjectedBounds(bounds=BLACK_SEA_BOUNDS){
  const {west,east,south,north}=bounds;
  let minX=Infinity,maxX=-Infinity,minY=Infinity,maxY=-Infinity;
  const samples=512;
  for(let i=0;i<=samples;i++){
    const f=i/samples;
    for(const [lon,lat] of [
      [west+f*(east-west),south],[west+f*(east-west),north],
      [west,south+f*(north-south)],[east,south+f*(north-south)]
    ]){
      const [x,y]=projectWGS84(lon,lat);
      minX=Math.min(minX,x);maxX=Math.max(maxX,x);minY=Math.min(minY,y);maxY=Math.max(maxY,y);
    }
  }
  return Object.freeze({minX,maxX,minY,maxY,width:maxX-minX,height:maxY-minY});
}

export const MAP_PROJECTED_BOUNDS=calculateProjectedBounds();
export const MAP_DEPTH=MAP_WIDTH*(MAP_PROJECTED_BOUNDS.height/MAP_PROJECTED_BOUNDS.width);

export function geoToMap(lon,lat){
  const [projectedX,projectedY]=projectWGS84(lon,lat);
  const x=((projectedX-MAP_PROJECTED_BOUNDS.minX)/MAP_PROJECTED_BOUNDS.width-.5)*MAP_WIDTH;
  const z=(.5-(projectedY-MAP_PROJECTED_BOUNDS.minY)/MAP_PROJECTED_BOUNDS.height)*MAP_DEPTH;
  return [x,z];
}
