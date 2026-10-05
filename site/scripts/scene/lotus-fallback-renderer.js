import { lotusFallbackData } from "./lotus-fallback-data.js?v=369d26343c4a";

/** Replay baked poses of the real model without a GPU or image decoding. */
export function createLotusFallbackRenderer({
  loadMotion = () => import("./lotus-fallback-motion.js?v=369d26343c4a"),
} = {}) {
  const data = lotusFallbackData;
  const encoded = atob(data.runs);
  const source = new Uint8Array(data.width * data.height * 4);
  let cursor = 0;
  for (let offset = 0; offset < encoded.length;) {
    cursor +=
      encoded.charCodeAt(offset++) | (encoded.charCodeAt(offset++) << 8);
    const count =
      encoded.charCodeAt(offset++) | (encoded.charCodeAt(offset++) << 8);
    for (let byte = 0; byte < count * 4; byte++)
      source[cursor * 4 + byte] = encoded.charCodeAt(offset++);
    cursor += count;
  }
  let cachedKey = "";
  let pixels;
  let motion = null;
  let motionRequest = null;
  let hasMotionFailed = false;
  return {
    isFallback: true,
    isAnimated: () => Boolean(motion),
    /** True while requested motion may still arrive. */
    isLoadingMotion: () => Boolean(motionRequest) && !motion && !hasMotionFailed,
    /** Motion is optional and only requested after a graphics failure. */
    ensureMotion() {
      if (!motionRequest)
        motionRequest = loadMotion()
          .then(({ lotusFallbackMotion: baked }) => {
            const frames = baked.frames.map((frame) => {
              const packed = atob(frame);
              const unpacked = new Uint8Array(baked.width * baked.height * 4);
              let target = 0;
              for (let offset = 0; offset < packed.length;) {
                target +=
                  packed.charCodeAt(offset++) |
                  (packed.charCodeAt(offset++) << 8);
                const count =
                  packed.charCodeAt(offset++) |
                  (packed.charCodeAt(offset++) << 8);
                for (let index = 0; index < count; index++, target++) {
                  const value = packed.charCodeAt(offset++);
                  unpacked[target * 4] = Math.round(((value & 31) / 31) * 255);
                  unpacked[target * 4 + 1] = value & 64 ? 64 : 0;
                  unpacked[target * 4 + 2] = value & 32 ? 255 : 0;
                  unpacked[target * 4 + 3] = packed.charCodeAt(offset++);
                }
              }
              return unpacked;
            });
            motion = { width: baked.width, height: baked.height, frames };
            cachedKey = "";
            return true;
          })
          .catch(() => {
            hasMotionFailed = true;
            return false;
          });
      return motionRequest;
    },
    render(
      columns,
      rows,
      viewportWidth,
      viewportHeight,
      bloom,
      rotation,
      placement,
    ) {
      const progress = motion
        ? Math.round(Math.max(0, Math.min(1, bloom)) * 1000) / 1000
        : 1;
      const key = [
        columns,
        rows,
        viewportWidth,
        viewportHeight,
        ...placement,
        progress,
      ].join(",");
      if (key === cachedKey) return pixels;
      cachedKey = key;
      const requiredLength = columns * rows * 16;
      if (!pixels || pixels.length !== requiredLength)
        pixels = new Uint8Array(requiredLength);
      else pixels.fill(0);
      const [centerX, centerY, scale] = placement;
      const [sourceX, sourceY, sourceScale] = data.placement;
      const width = columns * 2,
        height = rows * 2;
      const sampleWidth = motion?.width || data.width;
      const sampleHeight = motion?.height || data.height;
      const pose = motion ? progress * (motion.frames.length - 1) : 0;
      const first = motion ? motion.frames[Math.floor(pose)] : source;
      const second = motion ? motion.frames[Math.ceil(pose)] : source;
      const blend = pose % 1;
      // Both buffers use WebGL's bottom-up row order; placement uses CSS pixels.
      for (let y = 0; y < height; y++) {
        const canvasY = viewportHeight * (1 - (y + 0.5) / height);
        const sampleY = Math.floor(
          (1 -
            (((canvasY - centerY) * sourceScale) / scale + sourceY) /
              data.viewport[1]) *
            sampleHeight,
        );
        if (sampleY < 0 || sampleY >= sampleHeight) continue;
        for (let x = 0; x < width; x++) {
          const canvasX = (viewportWidth * (x + 0.5)) / width;
          const sampleX = Math.floor(
            ((((canvasX - centerX) * sourceScale) / scale + sourceX) /
              data.viewport[0]) *
              sampleWidth,
          );
          if (sampleX < 0 || sampleX >= sampleWidth) continue;
          const from = (sampleY * sampleWidth + sampleX) * 4;
          const to = (y * width + x) * 4;
          const alphaA = first[from + 3] * (1 - blend),
            alphaB = second[from + 3] * blend;
          const alpha = alphaA + alphaB;
          if (!alpha) continue;
          pixels[to] = Math.round(
            (first[from] * alphaA + second[from] * alphaB) / alpha,
          );
          const material = alphaA >= alphaB ? first : second;
          pixels[to + 1] = material[from + 1];
          pixels[to + 2] = material[from + 2];
          pixels[to + 3] = Math.round(alpha);
        }
      }
      return pixels;
    },
  };
}
