declare module "probe-image-size" {
  const probe: { sync(buffer: Buffer): { width: number; height: number } | null };
  export default probe;
}
