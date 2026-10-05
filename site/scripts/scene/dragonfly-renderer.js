/**
 * @typedef {object} DragonflyRenderer
 * @property {function(number, number, boolean, number=, number=, object=): void} draw - Advance and render one frame.
 * @property {function(): void} resetAttention - Discard proximity input after navigation or suspension.
 * @property {function(): void} resize - Recompute the canvas and perch geometry.
 * @property {function((string|boolean)=, boolean=): void} launch - Fly to a section heading.
 * @property {function(boolean=, number=): void} returnHome - Return to the Work navigation perch.
 */

/**
 * Create the ASCII dragonfly and its navigation-driven flight controller.
 * Model records contain coordinates, a tone, a wing group, and a surface normal.
 *
 * @param {HTMLElement} portfolioRoot - Root containing the canvas and section panels.
 * @param {Uint8Array} modelBytes - Packed model records of 11 bytes each.
 * @returns {DragonflyRenderer} Methods sharing flight state and automatic resize handling.
 */
export function createDragonflyRenderer(portfolioRoot, modelBytes) {
  const dragonflyCanvas = portfolioRoot.querySelector(".dragonfly-canvas");
  const drawingContext = dragonflyCanvas.getContext("2d");
  if (!drawingContext) {
    throw new Error("A 2D canvas is unavailable for the dragonfly.");
  }
  if (!modelBytes.byteLength || modelBytes.byteLength % 11 !== 0) {
    throw new Error(
      "The dragonfly model contains an incomplete vertex record.",
    );
  }
  const stageElement = portfolioRoot;
  const workNavigationButton = portfolioRoot.querySelector(
    '[data-navigation-section="work"]',
  );
  const modelDataView = new DataView(
    modelBytes.buffer,
    modelBytes.byteOffset,
    modelBytes.byteLength,
  );
  const modelPoints = [];
  for (let pointIndex = 0; pointIndex < modelBytes.length / 11; pointIndex++) {
    const byteOffset = pointIndex * 11;
    const modelX = modelDataView.getInt16(byteOffset, true) / 14000;
    const modelY = modelDataView.getInt16(byteOffset + 2, true) / 14000;
    const modelZ = modelDataView.getInt16(byteOffset + 4, true) / 14000;
    const wingGroup = modelBytes[byteOffset + 7];
    /** Replace the scanned splayed legs with an articulated perch contact. */
    if (!wingGroup && modelY < -0.066) {
      continue;
    }
    modelPoints.push([
      modelX,
      modelY,
      modelZ,
      modelBytes[byteOffset + 6] / 255,
      wingGroup,
      modelDataView.getInt8(byteOffset + 8) / 127,
      modelDataView.getInt8(byteOffset + 9) / 127,
      modelDataView.getInt8(byteOffset + 10) / 127,
    ]);
  }
  /**
   * Clamp a value to the animation's normalized range.
   * @param {number} value - Unbounded value.
   * @returns {number} Value between zero and one.
   */
  const clampUnitInterval = (value) => Math.max(0, Math.min(1, value));
  /**
   * Ease a normalized transition with zero slope at both endpoints.
   * @param {number} value - Unbounded transition progress.
   * @returns {number} Eased progress between zero and one.
   */
  const smoothStep = (value) => {
    value = clampUnitInterval(value);
    return value * value * (3 - 2 * value);
  };
  /**
   * Interpolate a scalar without clamping its progress.
   * @param {number} startValue - Starting value.
   * @param {number} endValue - Ending value.
   * @param {number} progress - Interpolation fraction.
   * @returns {number} Interpolated value.
   */
  const interpolate = (startValue, endValue, progress) =>
    startValue + (endValue - startValue) * progress;
  let stageWidth = 1;
  let stageHeight = 1;
  let designScale = 1;
  let isResizePending = false;
  let homePerch = [0, 0];
  let launchPosition = [0, 0];
  let flightMode = "rest";
  let flightElapsedSeconds = 0;
  let wingPhaseRadians = 0;
  let lastFootPosition = null;
  let previousPose = {
    rollRadians: -0.66,
    yawRadians: 1.3,
    wingFoldAmount: 1,
  };
  let takeoffPose = {
    rollRadians: -0.66,
    yawRadians: 1.3,
    wingFoldAmount: 1,
  };
  let previousAttention = 0;
  let takeoffAttention = 0;
  /** A section change only moves the perched insect; other flights rescale from takeoff. */
  let isSectionHop = false;
  let flightSeconds = 0.95;
  let takeoffScale = 1;
  let previousSectionScale = 1;
  /** A cue hidden by a narrow stage, a case study or scrolling reappears perched. */
  let isCueHidden = false;
  let proximityAmount = 0;
  let proximityDwellSeconds = 0;
  let isPointerNear = false;
  function resetAttention() {
    proximityAmount = 0;
    proximityDwellSeconds = 0;
    isPointerNear = false;
  }
  const rasterSize = 152;
  const characterCellSize = 1.45;
  const toneLayers = Array.from(
    { length: 3 },
    () => new Float32Array(rasterSize * rasterSize),
  );
  const depthLayers = Array.from(
    { length: 3 },
    () => new Float32Array(rasterSize * rasterSize),
  );
  const textMeasurementCanvas = document.createElement?.("canvas");
  const textMeasurementContext = textMeasurementCanvas?.getContext("2d", {
    willReadFrequently: true,
  });
  const textPerchMetrics = new Map();
  document.fonts?.addEventListener("loadingdone", () => textPerchMetrics.clear());

  /** Measure a shoulder in the first glyph, including its actual ink contour. */
  function getTextPerch(element) {
    const stageBounds = stageElement.getBoundingClientRect();
    const style = getComputedStyle(element);
    const fontSize = parseFloat(style.fontSize);
    const text = (element.textContent || "W").trim() || "W";
    let bounds = element.getBoundingClientRect();
    const range = document.createRange();
    range.selectNodeContents(element);
    const textBounds = range.getClientRects?.()[0] || range.getBoundingClientRect();
    if (textBounds.width) bounds = textBounds;
    let x = fontSize * 0.82;
    let y = fontSize * 0.17;
    if (textMeasurementContext) {
      try {
        const font = `${style.fontWeight || 400} ${fontSize}px ${style.fontFamily}`;
        const cacheKey = `${font}|${text}`;
        let metrics = textPerchMetrics.get(cacheKey);
        if (!metrics) {
          const context = textMeasurementContext;
          textMeasurementCanvas.width = Math.ceil(fontSize * 3);
          textMeasurementCanvas.height = Math.ceil(fontSize * 3);
          context.font = font;
          context.textBaseline = "alphabetic";
          const fullMetrics = context.measureText(text);
          const glyph = Array.from(text)[0];
          const glyphMetrics = context.measureText(glyph);
          const ascent = fullMetrics.fontBoundingBoxAscent || fontSize * 0.85;
          const descent = fullMetrics.fontBoundingBoxDescent || fontSize * 0.25;
          const padding = Math.ceil(fontSize / 2);
          const baseline = padding + ascent;
          context.fillText(glyph, padding, baseline);
          const pixels = context.getImageData(0, 0, textMeasurementCanvas.width, textMeasurementCanvas.height);
          const isCjk = /[\u3400-\u9fff]/u.test(glyph);
          const from = Math.round(padding + glyphMetrics.width * (isCjk ? 0.5 : 0.76));
          const to = Math.round(padding + glyphMetrics.width * (isCjk ? 0.78 : 0.94));
          let inkPoint = null;
          for (let row = 0; row < pixels.height && !inkPoint; row++) {
            for (let column = to; column >= from; column--) {
              if (pixels.data[(row * pixels.width + column) * 4 + 3] > 160) {
                inkPoint = [column - padding, row - baseline];
                break;
              }
            }
          }
          metrics = { ascent, descent, x: inkPoint?.[0] ?? x, y: inkPoint?.[1] ?? -(glyphMetrics.actualBoundingBoxAscent || fontSize * 0.7) };
          if (Object.values(metrics).every(Number.isFinite)) {
            if (textPerchMetrics.size >= 128) textPerchMetrics.delete(textPerchMetrics.keys().next().value);
            textPerchMetrics.set(cacheKey, metrics);
          }
        }
        // A Range includes the font box; resolve its baseline before adding ink bounds.
        const inkY = (bounds.height - metrics.ascent - metrics.descent) / 2 + metrics.ascent + metrics.y;
        if (Number.isFinite(metrics.x) && Number.isFinite(inkY)) {
          x = metrics.x;
          y = inkY;
        }
      } catch {
        // Restricted pixel access must never interrupt navigation or the scene.
      }
    }
    return [
      (bounds.left - stageBounds.left + x) / designScale,
      (bounds.top - stageBounds.top + y) / designScale,
    ];
  }
  /**
   * Find the foot contact above the Work navigation label.
   * @returns {[number, number]} Perch coordinates in design units.
   */
  function getNavigationPerch() {
    return getTextPerch(workNavigationButton);
  }
  /**
   * Find a perch over the printed heading text, falling back to navigation.
   * @returns {[number, number]} Perch coordinates in design units.
   */
  function getTitlePerch() {
    const sectionHeading = portfolioRoot.querySelector(".content-panel h2");
    if (!sectionHeading) {
      return getNavigationPerch();
    }
    return getTextPerch(sectionHeading);
  }
  /**
   * Fade the resting dragonfly with the heading's scroll clipping.
   * @returns {number} Visibility between zero and one.
   */
  function getTitleVisibility() {
    const sectionPanel = portfolioRoot.querySelector(".content-panel");
    const sectionHeading = sectionPanel.querySelector("h2");
    if (sectionPanel.hidden || !sectionHeading) {
      return 0;
    }
    const panelBounds = sectionPanel.getBoundingClientRect();
    const headingBounds = sectionHeading.getBoundingClientRect();
    const toolbarBounds = sectionPanel
      .querySelector(".panel-toolbar")
      .getBoundingClientRect();
    const visibleTop = Math.max(panelBounds.top, toolbarBounds.bottom);
    /** The resting insect belongs to the heading, including its scroll clipping. */
    return (
      smoothStep(
        (headingBounds.top - visibleTop) / Math.max(36, headingBounds.height),
      ) * smoothStep((panelBounds.bottom - headingBounds.top) / 36)
    );
  }
  /**
   * Resize the canvas and retain flight positions in consistent design units.
   * @returns {void}
   */
  function resize() {
    const stageBounds = stageElement.getBoundingClientRect();
    if (stageBounds.width <= 0 || stageBounds.height <= 0) return;
    const previousDesignScale = designScale;
    designScale = Math.max(
      1,
      Math.min(stageBounds.width / 1440, stageBounds.height / 800, 2),
    );
    stageWidth = stageBounds.width / designScale;
    stageHeight = stageBounds.height / designScale;
    /** Keep the raster, model, wings and flight distances in the same design units. */
    const scaleRatio = previousDesignScale / designScale;
    homePerch = homePerch.map((coordinate) => coordinate * scaleRatio);
    launchPosition = launchPosition.map(
      (coordinate) => coordinate * scaleRatio,
    );
    if (lastFootPosition) {
      lastFootPosition = lastFootPosition.map(
        (coordinate) => coordinate * scaleRatio,
      );
    }
    const pixelRatio = Math.min(
      window.devicePixelRatio || 1,
      2,
      Math.sqrt(8000000 / (stageBounds.width * stageBounds.height)),
    );
    const bitmapWidth = Math.round(stageBounds.width * pixelRatio);
    const bitmapHeight = Math.round(stageBounds.height * pixelRatio);
    if (dragonflyCanvas.width !== bitmapWidth)
      dragonflyCanvas.width = bitmapWidth;
    if (dragonflyCanvas.height !== bitmapHeight)
      dragonflyCanvas.height = bitmapHeight;
    drawingContext.setTransform(
      pixelRatio * designScale,
      0,
      0,
      pixelRatio * designScale,
      0,
      0,
    );
    // Preserve the measured home geometry while the compact interior navigation is visible.
    if (!portfolioRoot.hasAttribute?.("data-active-section")) {
      homePerch = getNavigationPerch();
    }
  }
  /** Reset a resized bitmap only in the frame that repaints it. */
  function requestResize() {
    isResizePending = true;
    resetAttention();
  }
  new ResizeObserver(requestResize).observe(stageElement);
  window.addEventListener("resize", requestResize, { passive: true });
  dragonflyCanvas.addEventListener("contextrestored", requestResize);
  resize();
  /**
   * Keep a departing perch near the canvas when its heading has scrolled away.
   * @param {[number, number]} fallbackPosition - Perch used before the first rendered frame.
   * @returns {[number, number]} The bounded departure point.
   */
  function getBoundedFlightOrigin(fallbackPosition) {
    const originPosition = (lastFootPosition || fallbackPosition).slice();
    /**
     * A scrolled-away perch returns from just outside the canvas, never from
     * the distant position of a heading in a long case study.
     */
    originPosition[0] = Math.max(
      24,
      Math.min(stageWidth - 24, originPosition[0]),
    );
    originPosition[1] = Math.max(
      -60,
      Math.min(stageHeight + 60, originPosition[1]),
    );
    return originPosition;
  }
  /**
   * Fly to the open section's heading. A flight already in the air turns from
   * where it is, so a fast change of section never jumps to a moved perch.
   * @param {'work'|'about'|'contact'|boolean} [nextSection='work'] - Destination, or a reduced-motion flag for Work.
   * @param {boolean} [prefersReducedMotion=false] - Move directly to the title perch.
   * @returns {void}
   */
  function launch(nextSection = "work", prefersReducedMotion = false) {
    resetAttention();
    if (typeof nextSection === "boolean") {
      prefersReducedMotion = nextSection;
    }
    if (prefersReducedMotion || (flightMode === "section-rest" && isCueHidden)) {
      flightMode = "section-rest";
      flightElapsedSeconds = 0;
      previousAttention = takeoffAttention = 0;
      lastFootPosition = getTitlePerch();
      return;
    }
    // Navigation has moved, but takeoff must retain the insect's visible position.
    launchPosition = getBoundedFlightOrigin(getNavigationPerch());
    // Between sections the perched insect hops to the new heading at its resting size.
    isSectionHop =
      flightMode === "section-rest" || (flightMode === "out" && isSectionHop);
    takeoffScale =
      flightMode === "section-rest"
        ? 0.8
        : flightMode === "rest"
          ? 1
          : previousSectionScale;
    const titlePerch = getTitlePerch();
    flightSeconds = isSectionHop
      ? Math.min(
          0.9,
          0.55 +
            Math.hypot(
              titlePerch[0] - launchPosition[0],
              titlePerch[1] - launchPosition[1],
            ) /
              700,
        )
      : 0.95;
    takeoffPose = {
      ...previousPose,
    };
    takeoffAttention = previousAttention;
    flightMode = "out";
    flightElapsedSeconds = 0;
  }
  /**
   * Return from the current foot position to the navigation perch.
   * @param {boolean} [prefersReducedMotion=false] - Skip the return animation.
   * @param {number} [delaySeconds=0] - Pause at the current pose before returning.
   * @returns {void}
   */
  function returnHome(prefersReducedMotion = false, delaySeconds = 0) {
    resetAttention();
    // Hidden section cues return directly; never fly out of a case study or phone page.
    prefersReducedMotion ||= stageElement.getBoundingClientRect().width <= 600 ||
      Boolean(portfolioRoot.hasAttribute?.("data-work-detail"));
    if (flightMode === "rest") {
      return;
    }
    if (flightMode === "in" && !prefersReducedMotion) {
      return;
    }
    launchPosition = getBoundedFlightOrigin(getTitlePerch());
    takeoffPose = {
      ...previousPose,
    };
    takeoffAttention = prefersReducedMotion ? 0 : previousAttention;
    // An interrupted flight returns from the size it had reached.
    takeoffScale = flightMode === "section-rest" ? 0.8 : previousSectionScale;
    isSectionHop = false;
    flightSeconds = 1.15;
    flightMode = prefersReducedMotion ? "rest" : "in";
    flightElapsedSeconds = prefersReducedMotion
      ? 0
      : -Math.max(0, Number(delaySeconds) || 0);
  }
  /**
   * Rotate a model point or surface normal into the raster's viewing plane.
   * @param {number} modelX - Model-space horizontal coordinate.
   * @param {number} modelY - Model-space vertical coordinate.
   * @param {number} modelZ - Model-space depth coordinate.
   * @param {number} rollRadians - Rotation in the viewing plane.
   * @param {number} yawRadians - Rotation around the model's vertical axis.
   * @returns {[number, number, number]} Projected coordinates and depth.
   */
  function projectPoint(modelX, modelY, modelZ, rollRadians, yawRadians) {
    const rotatedX =
      modelX * Math.cos(yawRadians) - modelZ * Math.sin(yawRadians);
    const rotatedDepth =
      modelX * Math.sin(yawRadians) + modelZ * Math.cos(yawRadians);
    const projectedY = -modelY * 0.993 + rotatedDepth * 0.12;
    return [
      rotatedX * Math.cos(rollRadians) - projectedY * Math.sin(rollRadians),
      rotatedX * Math.sin(rollRadians) + projectedY * Math.cos(rollRadians),
      rotatedDepth * 0.993 + modelY * 0.12,
    ];
  }
  // The lowest visible foot, rather than the centre of six feet, touches the ink.
  const projectedFootContact = [-1, 1]
    .flatMap((side) => [-1, 0, 1].map((index) =>
      projectPoint(side * 0.032, -0.3, -0.03 + index * 0.055, -0.66, 1.3)))
    .reduce((lowest, foot) => foot[1] > lowest[1] ? foot : lowest);
  // The folded, resting insect reaches 1.16 model units left of its foot; the
  // extra margin covers raster rounding. Open wings in flight keep 1.32.
  const restingLeftReach = 1.18;
  /**
   * Advance the flight and draw its opaque body and translucent wing layers.
   * @param {number} elapsedSeconds - Animation clock used for breathing and wing motion.
   * @param {number} deltaSeconds - Bounded integration step for wing motion.
   * @param {boolean} prefersReducedMotion - Disable idle motion and finish active flights.
   * @param {number} [attentionAmount=0] - Navigation dwell response between zero and one.
   * @param {number} [transitionDeltaSeconds=deltaSeconds] - Visible elapsed time for the flight path.
   * @param {{clientX: number, clientY: number, isActive: boolean}|null} [pointer=null] - Hover-capable pointer in viewport coordinates.
   * @returns {void}
   */
  function draw(
    elapsedSeconds,
    deltaSeconds,
    prefersReducedMotion,
    attentionAmount = 0,
    transitionDeltaSeconds = deltaSeconds,
    pointer = null,
  ) {
    if (drawingContext.isContextLost?.()) return;
    if (isResizePending) {
      resize();
      isResizePending = false;
    }
    flightElapsedSeconds += Number.isFinite(transitionDeltaSeconds)
      ? Math.max(0, transitionDeltaSeconds)
      : 0;
    drawingContext.clearRect(0, 0, stageWidth, stageHeight);
    if (prefersReducedMotion && flightMode === "out") {
      flightMode = "section-rest";
    }
    if (prefersReducedMotion && flightMode === "in") {
      flightMode = "rest";
    }
    const isSectionView = Boolean(portfolioRoot.hasAttribute?.("data-active-section"));
    if (isSectionView && (stageElement.getBoundingClientRect().width <= 600 ||
        portfolioRoot.hasAttribute?.("data-work-detail"))) {
      flightMode = "section-rest";
      isCueHidden = true;
      resetAttention();
      return;
    }
    let wingActivity = 0;
    let wingFoldAmount = 1;
    let rollRadians = -0.66;
    let yawRadians = 1.3;
    let footPosition = getNavigationPerch();
    let legTuckAmount = 0;
    let posePitchRadians = 0;
    if (flightMode === "rest" || portfolioRoot.hasAttribute?.("data-active-section") === false) {
      homePerch = footPosition.slice();
    }
    if (flightMode === "section-rest") {
      footPosition = getTitlePerch();
    }
    /**
     * Evaluate a cubic flight path at its current progress.
     * @param {[number, number]} startPoint - Path start.
     * @param {[number, number]} firstControlPoint - Departure control point.
     * @param {[number, number]} secondControlPoint - Approach control point.
     * @param {[number, number]} endPoint - Path end.
     * @param {number} progress - Path progress between zero and one.
     * @returns {[number, number]} Current flight position.
     */
    function getBezierPoint(
      startPoint,
      firstControlPoint,
      secondControlPoint,
      endPoint,
      progress,
    ) {
      const remainingProgress = 1 - progress;
      return [
        startPoint[0] *
          remainingProgress *
          remainingProgress *
          remainingProgress +
          3 *
            firstControlPoint[0] *
            remainingProgress *
            remainingProgress *
            progress +
          3 * secondControlPoint[0] * remainingProgress * progress * progress +
          endPoint[0] * progress * progress * progress,
        startPoint[1] *
          remainingProgress *
          remainingProgress *
          remainingProgress +
          3 *
            firstControlPoint[1] *
            remainingProgress *
            remainingProgress *
            progress +
          3 * secondControlPoint[1] * remainingProgress * progress * progress +
          endPoint[1] * progress * progress * progress,
      ];
    }
    /**
     * Set yaw and restrained banking from the cubic path's tangent.
     * @param {[number, number]} startPoint - Path start.
     * @param {[number, number]} firstControlPoint - Departure control point.
     * @param {[number, number]} secondControlPoint - Approach control point.
     * @param {[number, number]} endPoint - Path end.
     * @param {number} progress - Path progress between zero and one.
     * @returns {void}
     */
    function alignToBezierTangent(
      startPoint,
      firstControlPoint,
      secondControlPoint,
      endPoint,
      progress,
    ) {
      const remainingProgress = 1 - progress;
      const horizontalDerivative =
        3 *
          (firstControlPoint[0] - startPoint[0]) *
          remainingProgress *
          remainingProgress +
        6 *
          (secondControlPoint[0] - firstControlPoint[0]) *
          remainingProgress *
          progress +
        3 * (endPoint[0] - secondControlPoint[0]) * progress * progress;
      const verticalDerivative =
        3 *
          (firstControlPoint[1] - startPoint[1]) *
          remainingProgress *
          remainingProgress +
        6 *
          (secondControlPoint[1] - firstControlPoint[1]) *
          remainingProgress *
          progress +
        3 * (endPoint[1] - secondControlPoint[1]) * progress * progress;
      yawRadians = 1.3 * Math.tanh(horizontalDerivative / 28);
      /**
       * Yaw carries the heading change. Restrained banking lets the insect
       * rise or descend sideways instead of somersaulting in the image plane.
       */
      rollRadians =
        0.43 *
        Math.tanh(verticalDerivative / (Math.abs(horizontalDerivative) + 20)) *
        Math.tanh(horizontalDerivative / 24);
    }
    /** One for folded resting wings, zero for the margin that open wings need. */
    let perchedAmount = flightMode === "section-rest" ? 1 : 0;
    if (flightMode === "out" || flightMode === "in") {
      const isReturningHome = flightMode === "in";
      const flightTime = Math.max(0, flightElapsedSeconds);
      const targetPerch = isReturningHome
        ? getNavigationPerch()
        : getTitlePerch();
      const flightDuration = flightSeconds;
      const approachEndTime =
        flightDuration - (isReturningHome ? 0.46 : isSectionHop ? 0.24 : 0.3);
      const landingProgress = smoothStep((flightTime - approachEndTime) / 0.28);
      const settlingProgress = smoothStep(
        (flightTime - (flightDuration - 0.19)) / 0.19,
      );
      // A hop settles from just above the new heading; longer flights descend onto it.
      const approachPosition = isSectionHop
        ? [targetPerch[0] - 1, targetPerch[1] - 8]
        : [targetPerch[0] - 3, targetPerch[1] - 23];
      const arcTop = Math.max(
        84,
        Math.min(launchPosition[1], targetPerch[1]) - 76,
      );
      const startPosition = launchPosition.slice();
      // A flight that begins in the air keeps its open wings and tucked legs.
      let takeoffProgress = Math.max(
        1 - takeoffPose.wingFoldAmount,
        smoothStep(flightTime / 0.15),
      );
      let legTuckProgress = Math.max(
        1 - takeoffPose.wingFoldAmount,
        smoothStep((flightTime - 0.12) / 0.16),
      );
      if (isReturningHome) {
        /**
         * Return from the actual current foot point, including an interrupted
         * flight. A broad upper arc is independent of every entry gesture.
         */
        const returnProgress = smoothStep(
          (flightTime - 0.16) / (approachEndTime - 0.16),
        );
        const firstControlPoint = [
          startPosition[0] + Math.min(58, stageWidth * 0.08),
          arcTop,
        ];
        const secondControlPoint = [
          Math.max(42, approachPosition[0] - 62),
          arcTop - 8,
        ];
        footPosition = getBezierPoint(
          startPosition,
          firstControlPoint,
          secondControlPoint,
          approachPosition,
          returnProgress,
        );
        alignToBezierTangent(
          startPosition,
          firstControlPoint,
          secondControlPoint,
          approachPosition,
          returnProgress,
        );
        const turningProgress = smoothStep(flightTime / 0.3);
        rollRadians = interpolate(
          takeoffPose.rollRadians,
          rollRadians,
          turningProgress,
        );
        yawRadians = interpolate(
          takeoffPose.yawRadians,
          yawRadians,
          turningProgress,
        );
        if (flightElapsedSeconds < 0) {
          footPosition = startPosition;
          rollRadians = takeoffPose.rollRadians;
          yawRadians = takeoffPose.yawRadians;
          takeoffProgress = 1 - takeoffPose.wingFoldAmount;
          legTuckProgress = 1 - takeoffPose.wingFoldAmount;
        }
      } else if (isSectionHop) {
        // A low hop onto the new heading keeps the resting profile instead of facing the viewer.
        const hopProgress = smoothStep(
          (flightTime - 0.05) / (approachEndTime - 0.05),
        );
        const hopLift = Math.min(
          16,
          6 +
            0.08 *
              Math.hypot(
                approachPosition[0] - startPosition[0],
                approachPosition[1] - startPosition[1],
              ),
        );
        const firstControlPoint = [
          interpolate(startPosition[0], approachPosition[0], 0.3),
          Math.min(startPosition[1], approachPosition[1]) - hopLift,
        ];
        const secondControlPoint = [
          interpolate(startPosition[0], approachPosition[0], 0.75),
          approachPosition[1] - hopLift * 0.5,
        ];
        footPosition = getBezierPoint(
          startPosition, firstControlPoint, secondControlPoint,
          approachPosition, hopProgress,
        );
        rollRadians = takeoffPose.rollRadians;
        yawRadians = takeoffPose.yawRadians;
      } else {
        // One direct arc to the heading, with no orbit or hover.
        const approachProgress = smoothStep(
          (flightTime - 0.08) / (approachEndTime - 0.08),
        );
        const firstControlPoint = [
          interpolate(startPosition[0], approachPosition[0], 0.30),
          Math.max(32, Math.min(startPosition[1], approachPosition[1]) - 22),
        ];
        const secondControlPoint = [
          interpolate(startPosition[0], approachPosition[0], 0.78),
          approachPosition[1] - 20,
        ];
        footPosition = getBezierPoint(
          startPosition, firstControlPoint, secondControlPoint,
          approachPosition, approachProgress,
        );
        alignToBezierTangent(
          startPosition, firstControlPoint, secondControlPoint,
          approachPosition, approachProgress,
        );
        const turningProgress = smoothStep(flightTime / 0.20);
        rollRadians = interpolate(takeoffPose.rollRadians, rollRadians, turningProgress);
        yawRadians = interpolate(takeoffPose.yawRadians, yawRadians, turningProgress);
      }
      wingActivity = takeoffProgress * (1 - settlingProgress);
      wingFoldAmount = 1 - wingActivity;
      legTuckAmount =
        legTuckProgress *
        (1 - smoothStep((flightTime - (approachEndTime - 0.15)) / 0.39));
      perchedAmount = isSectionHop
        ? 1
        : isReturningHome
          ? 1 - takeoffProgress
          : settlingProgress;
      if (flightTime >= approachEndTime) {
        footPosition = [
          interpolate(approachPosition[0], targetPerch[0], landingProgress),
          interpolate(approachPosition[1], targetPerch[1], landingProgress),
        ];
        rollRadians = interpolate(
          rollRadians,
          -0.66,
          smoothStep((flightTime - (approachEndTime - 0.16)) / 0.35),
        );
        yawRadians = interpolate(
          yawRadians,
          1.3,
          smoothStep((flightTime - (approachEndTime - 0.16)) / 0.35),
        );
      } else if (flightTime > approachEndTime - 0.16) {
        const alignmentProgress = smoothStep(
          (flightTime - (approachEndTime - 0.16)) / 0.35,
        );
        rollRadians = interpolate(rollRadians, -0.66, alignmentProgress);
        yawRadians = interpolate(yawRadians, 1.3, alignmentProgress);
      }
      if (flightTime >= flightDuration) {
        flightMode = isReturningHome ? "rest" : "section-rest";
        footPosition = targetPerch;
        wingActivity = 0;
        wingFoldAmount = 1;
        legTuckAmount = 0;
        rollRadians = -0.66;
        yawRadians = 1.3;
        lastFootPosition = footPosition.slice();
        previousPose = {
          rollRadians,
          yawRadians,
          wingFoldAmount,
        };
      }
    }
    lastFootPosition = footPosition.slice();
    previousPose = {
      rollRadians,
      yawRadians,
      wingFoldAmount,
    };
    const scrollVisibility =
      flightMode === "section-rest" ? getTitleVisibility() : 1;
    if (scrollVisibility <= 0) {
      isCueHidden = true;
      return;
    }
    isCueHidden = false;
    const homeModelScale = Math.min(
      stageWidth <= 600 ? 55 : 76,
      Math.max(28, (homePerch[0] - 7) / 1.27),
    );
    // Each flight changes size from the size it actually had at takeoff.
    const sectionScale =
      flightMode === "section-rest"
        ? 0.8
        : flightMode === "out" || flightMode === "in"
          ? interpolate(
              takeoffScale,
              flightMode === "out" ? 0.8 : 1,
              smoothStep(Math.max(0, flightElapsedSeconds) / flightSeconds),
            )
          : 1;
    previousSectionScale = sectionScale;
    // Folded wings reach less far left, so a perched cue can keep its size beside a narrow gutter.
    const leftReach = interpolate(1.32, restingLeftReach, perchedAmount);
    const modelScale = Math.min(
      homeModelScale * sectionScale,
      Math.max(14, (footPosition[0] - 7) / leftReach),
      Math.max(14, (stageWidth - footPosition[0] - 7) / 1.32),
    );
    const breathingOffset =
      prefersReducedMotion ||
      flightMode === "section-rest" ||
      (flightMode === "out" && isSectionHop)
        ? 0
        : Math.sin(elapsedSeconds * 1.35);
    const modelOrigin = [
      footPosition[0] - projectedFootContact[0] * modelScale,
      footPosition[1] - projectedFootContact[1] * modelScale,
    ];
    // A small halo follows the actual insect, including responsive glyph perches.
    // Its wider exit boundary avoids repeated reactions at the edge of the halo.
    if (prefersReducedMotion || flightMode !== "rest" ||
        portfolioRoot.hasAttribute?.("data-active-section")) {
      resetAttention();
    } else {
      const step = Number.isFinite(transitionDeltaSeconds) ? Math.max(0, transitionDeltaSeconds) : 0;
      const stageBounds = stageElement.getBoundingClientRect();
      const radius = Math.max(30 / designScale, modelScale * (isPointerNear ? 1.05 : 0.85));
      isPointerNear = Boolean(pointer?.isActive) && Math.hypot(
        (pointer.clientX - stageBounds.left) / designScale - modelOrigin[0],
        (pointer.clientY - stageBounds.top) / designScale - modelOrigin[1],
      ) <= radius;
      proximityDwellSeconds = isPointerNear ? proximityDwellSeconds + step : 0;
      const target = proximityDwellSeconds >= 0.25 ? 0.8 : 0;
      // Rise once, hold while nearby, and take longer to settle after leaving.
      const rate = target > proximityAmount ? 8 : 4;
      proximityAmount += (target - proximityAmount) * (1 - Math.exp(-rate * step));
      if (Math.abs(target - proximityAmount) < 0.001) proximityAmount = target;
    }
    const idleCycleTime = elapsedSeconds % 4.8;
    const idlePulse =
      !prefersReducedMotion &&
      flightMode === "rest" &&
      idleCycleTime < 1.1
        ? Math.sin((idleCycleTime / 1.1) * Math.PI) *
          Math.exp(-idleCycleTime * 0.7)
        : 0;
    const idleMotionAmount =
      flightMode === "rest" &&
      !prefersReducedMotion
        ? 1
        : 0;
    /**
     * Navigation and proximity share one response rather than adding together.
     * It never displaces the foot contact or changes a flight already underway.
     */
    const carriedAttention =
      !prefersReducedMotion && (flightMode === "out" || flightMode === "in")
        ? takeoffAttention *
          (1 - smoothStep(Math.max(0, flightElapsedSeconds) / 0.22))
        : 0;
    const attentiveAmount =
      idleMotionAmount * Math.max(clampUnitInterval(Number(attentionAmount) || 0), proximityAmount) +
      carriedAttention;
    previousAttention = attentiveAmount;
    const wingbeatFrequency = 18 + 10 * smoothStep(flightElapsedSeconds / 0.42);
    wingPhaseRadians =
      (wingPhaseRadians + Math.PI * 2 * wingbeatFrequency * deltaSeconds) %
      (Math.PI * 2);
    const currentWingPhase = wingPhaseRadians;
    const hindwingPhaseOffset =
      1.92 * smoothStep((flightElapsedSeconds - 0.18) / 0.3);
    drawingContext.textAlign = "center";
    drawingContext.textBaseline = "middle";
    drawingContext.font = '2.8px "Courier New",monospace';
    const motionSampleCount = wingActivity > 0.1 ? 3 : 1;
    for (
      let sampleIndex = motionSampleCount - 1;
      sampleIndex >= 0;
      sampleIndex--
    ) {
      for (let layerIndex = 0; layerIndex < 3; layerIndex++) {
        toneLayers[layerIndex].fill(-1);
        depthLayers[layerIndex].fill(-100);
      }
      const sampleWingPhase = currentWingPhase - sampleIndex * 0.65;
      const wingTransforms = [null];
      for (let wingGroup = 1; wingGroup <= 4; wingGroup++) {
        const wingSide = wingGroup % 2 ? 1 : -1;
        const isHindwing = wingGroup > 2;
        const flapPhase =
          sampleWingPhase + (isHindwing ? hindwingPhaseOffset : 0);
        const idleFlapAngle =
          idleMotionAmount *
          (0.065 * Math.sin(elapsedSeconds * 1.8 + (isHindwing ? 0.6 : 0)) -
            0.18 * idlePulse * (1 - attentiveAmount));
        const wingAttentionAmount = isHindwing ? 0 : attentiveAmount;
        const flapAngle =
          wingSide *
          (wingFoldAmount * (1.36 + idleFlapAngle - 0.3 * wingAttentionAmount) +
            (1 - wingFoldAmount) * (0.1 + 0.77 * Math.sin(flapPhase)));
        const sweepAngle =
          wingFoldAmount *
          (0.58 +
            idleMotionAmount * 0.014 * Math.sin(elapsedSeconds * 1.6) -
            0.035 * wingAttentionAmount);
        const featherAngle =
          wingActivity * 0.34 * Math.cos(flapPhase) +
          idleMotionAmount * 0.035 * Math.sin(elapsedSeconds * 1.8);
        wingTransforms[wingGroup] = {
          wingSide,
          isHindwing,
          flapCosine: Math.cos(flapAngle),
          flapSine: Math.sin(flapAngle),
          sweepCosine: Math.cos(sweepAngle),
          sweepSine: Math.sin(sweepAngle),
          featherCosine: Math.cos(featherAngle),
          featherSine: Math.sin(featherAngle),
        };
      }
      /**
       * Keep the nearest sample in the body or one of the two wing buffers.
       * @param {number} modelX - Animated model-space horizontal coordinate.
       * @param {number} modelY - Animated model-space vertical coordinate.
       * @param {number} modelZ - Animated model-space depth coordinate.
       * @param {number} toneValue - ASCII shading value between zero and one.
       * @param {number} wingGroup - Zero for the body; one through four for wings.
       * @returns {void}
       */
      function plotModelPoint(modelX, modelY, modelZ, toneValue, wingGroup) {
        const projectedPoint = projectPoint(
          modelX,
          modelY,
          modelZ,
          rollRadians,
          yawRadians,
        );
        const rasterColumn = Math.round(
          (projectedPoint[0] * modelScale) / characterCellSize + rasterSize / 2,
        );
        const rasterRow = Math.round(
          (projectedPoint[1] * modelScale) / characterCellSize + rasterSize / 2,
        );
        if (
          rasterColumn < 0 ||
          rasterRow < 0 ||
          rasterColumn >= rasterSize ||
          rasterRow >= rasterSize
        ) {
          return;
        }
        const cellIndex = rasterColumn + rasterRow * rasterSize;
        const layerIndex = wingGroup ? (wingGroup % 2 ? 1 : 2) : 0;
        if (projectedPoint[2] > depthLayers[layerIndex][cellIndex]) {
          depthLayers[layerIndex][cellIndex] = projectedPoint[2];
          toneLayers[layerIndex][cellIndex] = toneValue;
        }
      }
      for (let pointIndex = 0; pointIndex < modelPoints.length; pointIndex++) {
        let [
          modelX,
          modelY,
          modelZ,
          toneValue,
          wingGroup,
          normalX,
          normalY,
          normalZ,
        ] = modelPoints[pointIndex];
        if (sampleIndex && wingGroup === 0) {
          continue;
        }
        if (wingGroup) {
          const wingTransform = wingTransforms[wingGroup];
          const hingeX = wingTransform.wingSide * 0.045;
          const hingeZ = wingTransform.isHindwing ? 0.1 : -0.07;
          const hingeOffsetX = modelX - hingeX;
          const hingeOffsetZ = modelZ - hingeZ;
          const featheredY =
            modelY * wingTransform.featherCosine -
            hingeOffsetZ * wingTransform.featherSine;
          const featheredZ =
            modelY * wingTransform.featherSine +
            hingeOffsetZ * wingTransform.featherCosine;
          const flappedX =
            hingeOffsetX * wingTransform.flapCosine -
            featheredY * wingTransform.flapSine;
          const flappedY =
            hingeOffsetX * wingTransform.flapSine +
            featheredY * wingTransform.flapCosine;
          modelX = hingeX + flappedX;
          modelY =
            flappedY * wingTransform.sweepCosine -
            featheredZ * wingTransform.sweepSine;
          modelZ =
            hingeZ +
            flappedY * wingTransform.sweepSine +
            featheredZ * wingTransform.sweepCosine;
        } else {
          const abdomenWeight = smoothStep((modelZ - 0.07) / 0.9);
          modelX *= 1 + 0.018 * breathingOffset * abdomenWeight;
          modelY += 0.035 * breathingOffset * abdomenWeight;
          modelZ += 0.012 * breathingOffset * abdomenWeight;
          /** Small rigid thorax/head pitch keeps the silhouette dimensional; feet remain fixed. */
          const headWeight = smoothStep((0.065 - modelZ) / 0.2);
          const pitchAngle =
            idleMotionAmount * 0.035 * Math.sin(elapsedSeconds * 1.35) +
            posePitchRadians +
            0.12 * attentiveAmount * headWeight;
          const pitchCosine = Math.cos(pitchAngle);
          const pitchSine = Math.sin(pitchAngle);
          const pitchedY = modelY * pitchCosine - modelZ * pitchSine;
          modelZ = modelY * pitchSine + modelZ * pitchCosine;
          modelY = pitchedY;
          const pitchedNormalY = normalY * pitchCosine - normalZ * pitchSine;
          normalZ = normalY * pitchSine + normalZ * pitchCosine;
          normalY = pitchedNormalY;
          const projectedNormal = projectPoint(
            normalX,
            normalY,
            normalZ,
            rollRadians,
            yawRadians,
          );
          const normalLength = Math.hypot(...projectedNormal) || 1;
          const diffuseLight = Math.max(
            0,
            (-0.42 * projectedNormal[0] -
              0.69 * projectedNormal[1] +
              0.59 * projectedNormal[2]) /
              normalLength,
          );
          const specularLight = Math.pow(
            Math.max(
              0,
              (-0.23 * projectedNormal[0] -
                0.38 * projectedNormal[1] +
                0.896 * projectedNormal[2]) /
                normalLength,
            ),
            18,
          );
          const lightIntensity = Math.min(
            1,
            0.12 + 0.77 * diffuseLight + 0.38 * specularLight,
          );
          toneValue = clampUnitInterval(
            0.85 * (1 - lightIntensity) + 0.15 * toneValue,
          );
        }
        plotModelPoint(modelX, modelY, modelZ, toneValue, wingGroup);
      }
      if (sampleIndex === 0) {
        for (let legSide = -1; legSide <= 1; legSide += 2) {
          for (let legIndex = 0; legIndex < 3; legIndex++) {
            const hipZ = (legIndex - 1) * 0.105;
            const hipPosition = [legSide * 0.065, -0.04, hipZ];
            const kneePosition = [
              legSide * (0.15 - 0.03 * legTuckAmount),
              -0.17 + 0.06 * legTuckAmount,
              hipZ - 0.07,
            ];
            const footPosition = [
              legSide * 0.032,
              -0.3 + 0.22 * legTuckAmount,
              -0.03 + (legIndex - 1) * 0.055 + legTuckAmount * 0.1,
            ];
            for (const [segmentStart, segmentEnd] of [
              [hipPosition, kneePosition],
              [kneePosition, footPosition],
            ]) {
              for (
                let segmentSampleIndex = 0;
                segmentSampleIndex < 13;
                segmentSampleIndex++
              ) {
                plotModelPoint(
                  interpolate(
                    segmentStart[0],
                    segmentEnd[0],
                    segmentSampleIndex / 12,
                  ),
                  interpolate(
                    segmentStart[1],
                    segmentEnd[1],
                    segmentSampleIndex / 12,
                  ),
                  interpolate(
                    segmentStart[2],
                    segmentEnd[2],
                    segmentSampleIndex / 12,
                  ),
                  0.59,
                  0,
                );
              }
            }
          }
        }
      }
      const characterRamp = ".:;+xX#@";
      /** Two translucent wing layers retain the opaque body underneath. */
      for (const layerIndex of [2, 0, 1]) {
        for (
          let cellIndex = 0;
          cellIndex < toneLayers[layerIndex].length;
          cellIndex++
        ) {
          if (toneLayers[layerIndex][cellIndex] >= 0) {
            const toneValue = toneLayers[layerIndex][cellIndex];
            const isWing = layerIndex !== 0;
            if (
              isWing &&
              depthLayers[layerIndex][cellIndex] < depthLayers[0][cellIndex] &&
              toneLayers[0][cellIndex] >= 0
            ) {
              continue;
            }
            if (isWing && toneValue < 0.08 && cellIndex % 2 !== 0) {
              continue;
            }
            drawingContext.fillStyle = isWing
              ? "#697a69"
              : toneValue < 0.13
                ? "#ffffff"
                : "#435442";
            drawingContext.globalAlpha =
              (isWing
                ? (0.12 + 0.53 * Math.pow(toneValue, 0.7)) *
                  (layerIndex === 2 ? 0.68 : 1)
                : toneValue < 0.13
                  ? 0.87
                  : 0.2 + 0.72 * Math.pow(toneValue, 0.8)) *
              (sampleIndex ? 0.21 : 1) *
              scrollVisibility;
            const canvasX =
              modelOrigin[0] +
              ((cellIndex % rasterSize) - rasterSize / 2) * characterCellSize;
            const canvasY =
              modelOrigin[1] +
              (Math.floor(cellIndex / rasterSize) - rasterSize / 2) *
                characterCellSize;
            drawingContext.fillText(
              characterRamp[Math.min(7, Math.floor(toneValue * 7.99))],
              canvasX,
              canvasY,
            );
          }
        }
      }
    }
    drawingContext.globalAlpha = 1;
    /**
     * The model remains in the root canvas throughout the flight. No edge
     * threshold or hidden state can truncate the approach or landing.
     */
  }
  return {
    draw,
    resize: requestResize,
    launch,
    returnHome,
    resetAttention,
  };
}
