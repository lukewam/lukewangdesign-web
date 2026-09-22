import { clampRange, deterministicNoise } from "../motion/easing.js?v=4af34b094e64";
import { lotusSceneSettings } from "../motion/settings.js?v=4af34b094e64";

/**
 * Paint the rendered lotus as ASCII characters on the paper canvas and keep
 * the pointer rotation and colored character heat that respond to the visitor.
 * @param {Object} options - Dependencies.
 * @param {HTMLCanvasElement} options.flowerCanvas - Visible flower canvas.
 * @param {HTMLElement} options.flowerSurface - Button surrounding the canvas.
 * @param {HTMLElement} options.portfolioRoot - Root used for composition scale and pointer bounds.
 * @param {MediaQueryList} options.reducedMotionPreference - Reduced-motion preference.
 * @returns {Object} Resize, pointer, and paint operations.
 */
export function createLotusPainter({
  flowerCanvas,
  flowerSurface,
  portfolioRoot,
  reducedMotionPreference,
}) {
  const settings = lotusSceneSettings;
  const drawingContext = flowerCanvas.getContext("2d", { alpha: false });
  let canvasWidth = 1;
  let canvasHeight = 1;
  let isResizePending = true;
  let columnCount = 1;
  let rowCount = 1;
  let characterCellWidth = 5.6;
  let characterCellHeight = 8.3;
  let tileColumnCount = 1;
  let tileHeat = new Float32Array(1);
  let characterHeat = new Float32Array(1);
  const pointerState = {
    x: 0,
    y: 0,
    isActive: false,
    normalizedX: 0,
    normalizedY: 0,
  };
  let isKeyboardPointer = false;
  let pitchRadians = 0;
  let yawRadians = 0;
  const rollRadians = 0;

  /**
   * Resize the flower bitmap and restore its paper background before painting.
   * @returns {void}
   */
  function resize() {
    const surfaceBounds = flowerSurface.getBoundingClientRect();
    canvasWidth = Math.max(1, surfaceBounds.width);
    canvasHeight = Math.max(1, surfaceBounds.height);
    if (!drawingContext) return;
    const pixelRatio = Math.min(
      window.devicePixelRatio || 1,
      settings.maximumPixelRatio,
      Math.sqrt(settings.maximumBitmapPixels / (canvasWidth * canvasHeight)),
    );
    const bitmapWidth = Math.round(canvasWidth * pixelRatio);
    const bitmapHeight = Math.round(canvasHeight * pixelRatio);
    const hasBitmapChanged =
      flowerCanvas.width !== bitmapWidth || flowerCanvas.height !== bitmapHeight;
    if (flowerCanvas.width !== bitmapWidth) flowerCanvas.width = bitmapWidth;
    if (flowerCanvas.height !== bitmapHeight) flowerCanvas.height = bitmapHeight;
    if (hasBitmapChanged) {
      drawingContext.setTransform(1, 0, 0, 1, 0, 0);
      drawingContext.globalAlpha = 1;
      drawingContext.fillStyle = settings.paperColor;
      drawingContext.fillRect(0, 0, bitmapWidth, bitmapHeight);
    }
    drawingContext.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
    const responsiveScale =
      canvasWidth < 350
        ? settings.narrowCanvasScale.under350
        : canvasWidth < 500
          ? settings.narrowCanvasScale.under500
          : 1;
    const { width: referenceWidth, height: referenceHeight, maximumScale } =
      settings.compositionReference;
    const compositionScale = Math.max(
      1,
      Math.min(
        portfolioRoot.clientWidth / referenceWidth,
        portfolioRoot.clientHeight / referenceHeight,
        maximumScale,
      ),
    );
    characterCellWidth =
      settings.glyphSize * settings.cellWidthFactor * responsiveScale * compositionScale;
    characterCellHeight =
      settings.glyphSize * settings.cellHeightFactor * responsiveScale * compositionScale;
    columnCount = Math.ceil(canvasWidth / characterCellWidth);
    rowCount = Math.ceil(canvasHeight / characterCellHeight);
    characterHeat = new Float32Array(columnCount * rowCount);
    tileColumnCount = Math.ceil(columnCount / 2);
    tileHeat = new Float32Array(tileColumnCount * Math.ceil(rowCount / 2));
  }

  /** Defer bitmap resets until the animation frame that redraws the flower. */
  function requestResize() {
    isResizePending = true;
  }
  new ResizeObserver(requestResize).observe(flowerSurface);
  window.addEventListener("resize", requestResize, { passive: true });

  /** Apply a pending resize before the frame that paints. */
  function resizeIfPending() {
    if (isResizePending) {
      resize();
      isResizePending = false;
    }
  }

  /**
   * Clear pointer rotation input and the remaining colored character trail.
   * @returns {void}
   */
  function resetPointer() {
    pointerState.isActive = false;
    isKeyboardPointer = false;
    characterHeat.fill(0);
    tileHeat.fill(0);
  }

  /** Stop following the pointer without discarding the trail. */
  function releasePointer() {
    pointerState.isActive = false;
  }

  /** A real pointer replaces arrow-key rotation. */
  function forgetKeyboardPointer() {
    isKeyboardPointer = false;
  }

  /**
   * Map pointer coordinates to the flower canvas and normalized portfolio bounds.
   * @param {PointerEvent} event - Pointer movement or touch event.
   * @returns {void}
   */
  function trackPointer(event) {
    isKeyboardPointer = false;
    const surfaceBounds = flowerSurface.getBoundingClientRect();
    pointerState.x = event.clientX - surfaceBounds.left;
    pointerState.y = event.clientY - surfaceBounds.top;
    const portfolioBounds = portfolioRoot.getBoundingClientRect();
    pointerState.normalizedX = clampRange(
      ((event.clientX - portfolioBounds.left) / portfolioBounds.width) * 2 - 1,
      -1,
      1,
    );
    pointerState.normalizedY = clampRange(
      ((event.clientY - portfolioBounds.top) / portfolioBounds.height) * 2 - 1,
      -1,
      1,
    );
    pointerState.isActive = true;
  }

  /**
   * Rotate the flower with the arrow keys while the surface is focused.
   * @param {KeyboardEvent} event - Keydown event.
   * @returns {boolean} Whether the key was an arrow key.
   */
  function nudgePointer(event) {
    if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) {
      return false;
    }
    const { keyboardStep, keyboardCenter } = settings.pointer;
    isKeyboardPointer = true;
    pointerState.isActive = true;
    pointerState.normalizedX = clampRange(
      pointerState.normalizedX +
        (event.key === "ArrowLeft" ? -keyboardStep : event.key === "ArrowRight" ? keyboardStep : 0),
      -1,
      1,
    );
    pointerState.normalizedY = clampRange(
      pointerState.normalizedY +
        (event.key === "ArrowUp" ? -keyboardStep : event.key === "ArrowDown" ? keyboardStep : 0),
      -1,
      1,
    );
    pointerState.x = canvasWidth * (keyboardCenter.x + pointerState.normalizedX * keyboardCenter.xSpread);
    pointerState.y = canvasHeight * (keyboardCenter.y + pointerState.normalizedY * keyboardCenter.ySpread);
    return true;
  }

  /**
   * Slide the canvas aside as a section opens.
   * @param {number} slideProgress - Displacement between zero and one.
   * @returns {void}
   */
  function slide(slideProgress) {
    const fraction =
      portfolioRoot.clientWidth <= settings.slide.mobileMaxWidth
        ? settings.slide.mobileFraction
        : settings.slide.desktopFraction;
    flowerCanvas.style.transform = `translate3d(${canvasWidth * slideProgress * fraction}px,0,0)`;
  }

  /**
   * Paint the paper and a notice when the flower graphics are unavailable.
   * @param {string} noticeText - Localized notice.
   * @returns {void}
   */
  function paintUnavailable(noticeText) {
    if (!drawingContext) return;
    drawingContext.globalAlpha = 1;
    drawingContext.fillStyle = settings.paperColor;
    drawingContext.fillRect(0, 0, canvasWidth, canvasHeight);
    drawingContext.fillStyle = settings.fallbackTextColor;
    drawingContext.font = "15px Arial";
    drawingContext.textAlign = "center";
    drawingContext.fillText(noticeText, canvasWidth / 2, canvasHeight / 2);
  }

  /**
   * Render one ASCII frame of the flower.
   * @param {Object} frame - Frame inputs.
   * @param {{render: Function}} frame.lotusRenderer - Loaded lotus renderer.
   * @param {number} frame.bloomProgress - Bloom progress between zero and one.
   * @param {Object} frame.travelMotion - Fold, sway, turn, attention, and phase.
   * @param {boolean} frame.isPointerFollowing - Whether pointer rotation applies this frame.
   * @param {boolean} frame.isFlowerResting - Whether the flower rests at home without hover cues.
   * @param {number} frame.sceneDeltaSeconds - Capped frame step.
   * @param {number} frame.motionSeconds - Animation clock.
   * @returns {boolean} False when the renderer failed and must be retired.
   */
  function paint({
    lotusRenderer,
    bloomProgress,
    travelMotion,
    isPointerFollowing,
    isFlowerResting,
    sceneDeltaSeconds,
    motionSeconds,
  }) {
    if (!drawingContext) return true;
    drawingContext.globalAlpha = 1;
    drawingContext.fillStyle = settings.paperColor;
    drawingContext.fillRect(0, 0, canvasWidth, canvasHeight);
    const isPointerActive = pointerState.isActive && isPointerFollowing;
    const followAmount = isFlowerResting
      ? 1 - Math.exp(-sceneDeltaSeconds * settings.pointer.followRate)
      : 0;
    pitchRadians +=
      ((isPointerActive ? -pointerState.normalizedY * settings.pointer.pitchGain : 0) -
        pitchRadians) *
      followAmount;
    yawRadians +=
      ((isPointerActive ? pointerState.normalizedX * settings.pointer.yawGain : 0) - yawRadians) *
      followAmount;
    const { placement } = settings;
    const modelScale = Math.min(
      canvasWidth / placement.widthDivisor,
      canvasHeight / placement.heightDivisor,
    );
    const centerY =
      portfolioRoot.clientWidth <= settings.slide.mobileMaxWidth
        ? placement.narrowCenterY
        : placement.centerY;
    let renderedPixels;
    try {
      renderedPixels = lotusRenderer.render(
        columnCount,
        rowCount,
        columnCount * characterCellWidth,
        rowCount * characterCellHeight,
        bloomProgress,
        [pitchRadians, yawRadians, rollRadians],
        [canvasWidth * placement.centerX, canvasHeight * centerY, modelScale],
        settings.highlight,
        travelMotion,
      );
    } catch (renderError) {
      /** A failed graphics frame must not interrupt navigation or retry a broken renderer forever. */
      flowerCanvas.dataset.graphicsError = String(renderError?.message || renderError);
      return false;
    }
    const { heat } = settings;
    const heatDecayFactor = Math.exp(-sceneDeltaSeconds * heat.decayRate);
    const brushRadius = Math.min(heat.brushRadiusMaximum, canvasWidth * heat.brushRadiusFraction);
    const accentTick = reducedMotionPreference.matches
      ? 0
      : Math.floor(motionSeconds * heat.accentTicksPerSecond);
    const sampleRowStride = columnCount * 2;
    tileHeat.fill(0);
    drawingContext.font = `${characterCellHeight * 1.12}px "Courier New", monospace`;
    drawingContext.textAlign = "center";
    drawingContext.textBaseline = "middle";
    const lightGlyphFont = `400 ${characterCellHeight * 1.14}px "Courier New", monospace`;
    const darkGlyphFont = `700 ${characterCellHeight * 1.14}px "Courier New", monospace`;
    let currentGlyphFont = "";
    const { characterRamp } = settings;
    for (let characterRow = 0; characterRow < rowCount; characterRow++) {
      for (let characterColumn = 0; characterColumn < columnCount; characterColumn++) {
        const characterIndex = characterColumn + characterRow * columnCount;
        characterHeat[characterIndex] *= heatDecayFactor;
        const canvasX = (characterColumn + 0.5) * characterCellWidth;
        const canvasY = (characterRow + 0.5) * characterCellHeight;
        let lightIntensity = 0;
        let sampleCoverage = 0;
        let highlightIntensity = 0;
        let antherSampleCount = 0;
        for (let sampleRow = 0; sampleRow < 2; sampleRow++) {
          for (let sampleColumn = 0; sampleColumn < 2; sampleColumn++) {
            const sampleByteOffset =
              ((rowCount * 2 - 1 - (characterRow * 2 + sampleRow)) * sampleRowStride +
                characterColumn * 2 +
                sampleColumn) *
              4;
            if (renderedPixels[sampleByteOffset + 3] === 0) {
              continue;
            }
            const luminance = renderedPixels[sampleByteOffset] / 255;
            const sampleWeight = renderedPixels[sampleByteOffset + 3] / 255;
            lightIntensity += luminance * sampleWeight;
            highlightIntensity = Math.max(
              highlightIntensity,
              renderedPixels[sampleByteOffset + 2] / 255,
            );
            const materialIndex = Math.round((renderedPixels[sampleByteOffset + 1] / 255) * 8);
            if (materialIndex === 2 || materialIndex === 6) {
              antherSampleCount++;
            }
            sampleCoverage += sampleWeight;
          }
        }
        if (sampleCoverage > 0) {
          lightIntensity = lightIntensity / sampleCoverage;
          const contrastOdds = Math.pow(
            Math.max(0.001, lightIntensity) / Math.max(0.001, 1 - lightIntensity),
            settings.contrast,
          );
          lightIntensity = contrastOdds / (1 + contrastOdds);
          const inkAmount = 1 - lightIntensity;
          const grainOffset = deterministicNoise(characterIndex * 3.1) * 0.012 - 0.006;
          let character =
            characterRamp[
              Math.min(
                characterRamp.length - 1,
                Math.floor(clampRange(inkAmount + grainOffset) * characterRamp.length),
              )
            ];
          const edgeOpacity =
            (0.35 + (0.65 * sampleCoverage) / 4) * Math.min(1, sampleCoverage);
          const nextGlyphFont = lightIntensity < 0.32 ? darkGlyphFont : lightGlyphFont;
          if (nextGlyphFont !== currentGlyphFont) {
            drawingContext.font = nextGlyphFont;
            currentGlyphFont = nextGlyphFont;
          }
          /** Stroke value and glyph density both follow continuous surface illumination. */
          const grayValue = Math.round(17 + 137 * lightIntensity);
          drawingContext.fillStyle = `rgb(${grayValue},${grayValue + 1},${grayValue})`;
          drawingContext.globalAlpha = (0.2 + 0.78 * Math.pow(inkAmount, 0.8)) * edgeOpacity;
          if (highlightIntensity > 0.45 && lightIntensity > 0.91 && antherSampleCount === 0) {
            drawingContext.fillStyle = "#ffffff";
            drawingContext.globalAlpha = edgeOpacity * 0.94;
            character = "1";
          }
          drawingContext.fillText(character, canvasX, canvasY);
          if (isPointerActive && !isKeyboardPointer) {
            const pointerDistance = Math.hypot(canvasX - pointerState.x, canvasY - pointerState.y);
            if (pointerDistance < brushRadius) {
              characterHeat[characterIndex] = Math.max(
                characterHeat[characterIndex],
                Math.pow(1 - pointerDistance / brushRadius, heat.brushFalloff),
              );
            }
          }
        }
        const tileIndex =
          Math.floor(characterColumn / 2) + Math.floor(characterRow / 2) * tileColumnCount;
        tileHeat[tileIndex] = Math.max(tileHeat[tileIndex], characterHeat[characterIndex]);
      }
    }
    const tileWidth = characterCellWidth * 2;
    const tileHeight = characterCellHeight * 2;
    drawingContext.font = `${tileHeight * 0.82}px "Courier New", monospace`;
    const { accentPalette, accentCharacters } = settings;
    for (let tileIndex = 0; tileIndex < tileHeat.length; tileIndex++) {
      const tileHeatAmount = tileHeat[tileIndex];
      if (
        tileHeatAmount < heat.tileThreshold ||
        deterministicNoise(tileIndex * 5.9 + accentTick * 3.7) > 0.32 + tileHeatAmount * 0.64
      ) {
        continue;
      }
      const tileX = (tileIndex % tileColumnCount) * tileWidth;
      const tileY = Math.floor(tileIndex / tileColumnCount) * tileHeight;
      drawingContext.globalAlpha = Math.min(0.92, tileHeatAmount);
      drawingContext.fillStyle =
        accentPalette[
          Math.floor(deterministicNoise(tileIndex + accentTick * 9.7) * accentPalette.length)
        ];
      drawingContext.fillRect(tileX + 0.6, tileY + 0.6, tileWidth - 1.2, tileHeight - 1.2);
      drawingContext.globalAlpha = Math.min(0.88, tileHeatAmount * 0.92);
      drawingContext.fillStyle = settings.accentInkColor;
      drawingContext.fillText(
        accentCharacters[
          Math.floor(deterministicNoise(tileIndex * 17 + accentTick * 4.1) * accentCharacters.length)
        ],
        tileX + tileWidth / 2,
        tileY + tileHeight / 2,
      );
    }
    drawingContext.globalAlpha = 1;
    return true;
  }

  return {
    hasDrawingContext: () => Boolean(drawingContext),
    resize,
    requestResize,
    resizeIfPending,
    resetPointer,
    releasePointer,
    forgetKeyboardPointer,
    trackPointer,
    nudgePointer,
    isPointerActive: () => pointerState.isActive,
    slide,
    paintUnavailable,
    paint,
  };
}
