declare module 'coordtransform' {
  const converter: {
    gcj02towgs84(lng: number, lat: number): [number, number];
    wgs84togcj02(lng: number, lat: number): [number, number];
    gcj02tobd09(lng: number, lat: number): [number, number];
  };
  export default converter;
}
