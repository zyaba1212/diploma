/** Align client URL with server/cache rounding for reverse geocode. */
export function quantizeCoordPair(lat: number, lng: number, decimals: number): { lat: number; lng: number } {
  const f = 10 ** decimals;
  return {
    lat: Math.round(lat * f) / f,
    lng: Math.round(lng * f) / f,
  };
}
