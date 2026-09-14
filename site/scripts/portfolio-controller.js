import { createWorkGallery } from "./work-gallery.js?v=d424d1e041da";
import { translations } from "./translations.js?v=d424d1e041da";
/**
 * Connect the portfolio navigation, translations, and animated canvas renderers.
 * @param {HTMLElement} portfolioRoot - Root containing the portfolio controls and sections.
 * @param {Object|null} lotusRenderer - Loaded lotus renderer, or null when graphics are unavailable.
 * @param {Object} dragonflyRenderer - Dragonfly controller with draw, resize, launch, and returnHome methods.
 * @param {Object} portfolioData - Content supplied to the work gallery.
 * @returns {void}
 */
export function initializePortfolio(
  portfolioRoot,
  lotusRenderer,
  dragonflyRenderer,
  portfolioData,
) {
  const flowerCanvas = portfolioRoot.querySelector(".lotus-interaction canvas");
  const flowerSurface = portfolioRoot.querySelector(".lotus-interaction");
  const drawingContext = flowerCanvas.getContext("2d", {
    alpha: false,
  });
  const reducedMotionPreference = window.matchMedia(
    "(prefers-reduced-motion: reduce)",
  );
  /**
   * Clamp a scalar to the requested interval.
   * @param {number} value - Value to constrain.
   * @param {number} [minimumValue=0] - Lower bound.
   * @param {number} [maximumValue=1] - Upper bound.
   * @returns {number} The constrained value.
   */
  const clampRange = (value, minimumValue = 0, maximumValue = 1) =>
    Math.max(minimumValue, Math.min(maximumValue, value));
  /**
   * Ease a normalized transition with zero endpoint velocity.
   * @param {number} value - Transition progress.
   * @returns {number} Eased progress between zero and one.
   */
  const smoothStep = (value) => {
    value = clampRange(value);
    return value * value * (3 - 2 * value);
  };
  /**
   * Produce a stable pseudo-random fraction for a character or tile.
   * @param {number} seed - Sample seed.
   * @returns {number} A repeatable fraction between zero and one.
   */
  const deterministicNoise = (seed) => {
    const sampleValue = Math.sin(seed * 12.9898 + 7.177) * 43758.5453;
    return sampleValue - Math.floor(sampleValue);
  };
  const renderSettings = {
    highlight: 1.6,
    contrast: 1.05,
    glyphSize: 9.3,
  };
  const paperColor = "#f5f3ee";
  const characterRamp = ".:;i!ltfxzcO08%#MW@";
  const accentCharacters = "01=+<>XYPQZ@#";
  const accentPalette = [
    "#8cce73",
    "#e39edc",
    "#b09be2",
    "#81c4b4",
    "#d7d88a",
    "#a3cd70",
  ];
  let canvasWidth = 1;
  let canvasHeight = 1;
  let isFlowerResizePending = true;
  let columnCount = 1;
  let rowCount = 1;
  let characterCellWidth = 5.6;
  let characterCellHeight = 8.3;
  let tileColumnCount = 1;
  let tileHeat = new Float32Array(1);
  let characterHeat = new Float32Array(1);
  let pointerState = {
    x: 0,
    y: 0,
    isActive: false,
    normalizedX: 0,
    normalizedY: 0,
  };
  let isKeyboardPointer = false;
  let isVisible = true;
  let pitchRadians = 0;
  let yawRadians = 0;
  let rollRadians = 0;
  let previousFrameMilliseconds = null;
  let bloomLoopSeconds = 6.7;
  let motionSeconds = 0;
  let currentLanguage = "en";
  let selectedSection = null;
  let isRestoringPortfolioLocation = false;
  let lastHandledPortfolioUrl = null;
  let isPlaying = !reducedMotionPreference.matches;
  let pausedBloomProgress = reducedMotionPreference.matches ? 1 : 0;
  const sectionPanel = portfolioRoot.querySelector(".content-panel");
  const workGallery = createWorkGallery(
    portfolioRoot,
    sectionPanel,
    portfolioData,
    {
      language: () => currentLanguage,
      onChange: (hasProjectDetail) => {
        if (selectedSection !== "work") return;
        dragonflyRenderer.launch(
          "work",
          reducedMotionPreference.matches ||
            isRestoringPortfolioLocation ||
            !hasProjectDetail,
        );
        synchronizePortfolioLocation();
      },
    },
  );
  /**
   * Add intentional navigation to browser history, or normalize a restored route.
   * @param {boolean} [replaceCurrentEntry=false] - Replace malformed or noncanonical routes without adding a visit.
   * @returns {void}
   */
  function synchronizePortfolioLocation(replaceCurrentEntry = false) {
    if (isRestoringPortfolioLocation) return;
    const locationUrl = new URL(window.location.href);
    const currentProjectId =
      selectedSection === "work" && workGallery.currentProject();
    locationUrl.hash = selectedSection
      ? `${selectedSection}${currentProjectId ? `/${currentProjectId}` : ""}`
      : "";
    if (locationUrl.href !== window.location.href) {
      if (replaceCurrentEntry) {
        history.replaceState(history.state, "", locationUrl);
      } else {
        history.pushState(history.state, "", locationUrl);
      }
    }
    lastHandledPortfolioUrl = locationUrl.href;
  }
  /**
   * Restore a linked section after loading or returning from a reading page.
   * @returns {void}
   */
  function restorePortfolioLocation() {
    /** Back/Forward may emit both popstate and hashchange for the same visit. */
    if (lastHandledPortfolioUrl === window.location.href) return;
    const matchedSectionRoute = window.location.hash.match(
      /^#(work|about|contact)(?:\/([a-z0-9-]+))?$/,
    );
    isRestoringPortfolioLocation = true;
    try {
      if (!matchedSectionRoute) {
        closeSection();
      } else {
        const [, requestedSection, requestedProject] = matchedSectionRoute;
        if (
          selectedSection !== requestedSection ||
          sectionTransition.targetAmount === 0
        ) {
          openSection(requestedSection);
        }
        if (requestedSection === "work") {
          if (requestedProject) {
            if (workGallery.currentProject() !== requestedProject) {
              workGallery.open(requestedProject);
            }
          } else if (workGallery.hasDetail()) {
            workGallery.back();
          }
        }
        try {
          const readingReturn = JSON.parse(
            sessionStorage.getItem("portfolio-reading-return") || "null",
          );
          if (
            requestedSection === "work" &&
            requestedProject &&
            workGallery.currentProject() === requestedProject &&
            readingReturn?.projectId === requestedProject
          ) {
            const savedScrollTop = Number(readingReturn.scrollTop);
            sectionPanel.scrollTop = Number.isFinite(savedScrollTop)
              ? Math.max(0, savedScrollTop)
              : 0;
            sessionStorage.removeItem("portfolio-reading-return");
          }
        } catch {
          /** Direct project links still open when browser storage is unavailable. */
        }
      }
      settleSectionTransition();
      updateSectionTransition(0);
    } finally {
      isRestoringPortfolioLocation = false;
    }
    synchronizePortfolioLocation(true);
  }
  /**
   * Resize the flower bitmap and restore its paper background before painting.
   * @returns {void}
   */
  function resizeFlowerCanvas() {
    const surfaceBounds = flowerSurface.getBoundingClientRect();
    canvasWidth = Math.max(1, surfaceBounds.width);
    canvasHeight = Math.max(1, surfaceBounds.height);
    if (!drawingContext) return;
    const pixelRatio = Math.min(
      window.devicePixelRatio || 1,
      2,
      Math.sqrt(8000000 / (canvasWidth * canvasHeight)),
    );
    const bitmapWidth = Math.round(canvasWidth * pixelRatio);
    const bitmapHeight = Math.round(canvasHeight * pixelRatio);
    const hasBitmapChanged =
      flowerCanvas.width !== bitmapWidth ||
      flowerCanvas.height !== bitmapHeight;
    if (flowerCanvas.width !== bitmapWidth) flowerCanvas.width = bitmapWidth;
    if (flowerCanvas.height !== bitmapHeight)
      flowerCanvas.height = bitmapHeight;
    if (hasBitmapChanged) {
      drawingContext.setTransform(1, 0, 0, 1, 0, 0);
      drawingContext.globalAlpha = 1;
      drawingContext.fillStyle = paperColor;
      drawingContext.fillRect(0, 0, bitmapWidth, bitmapHeight);
    }
    drawingContext.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
    const responsiveScale =
      canvasWidth < 350 ? 0.77 : canvasWidth < 500 ? 0.89 : 1;
    const compositionScale = Math.max(
      1,
      Math.min(
        portfolioRoot.clientWidth / 1440,
        portfolioRoot.clientHeight / 800,
        2,
      ),
    );
    characterCellWidth =
      renderSettings.glyphSize * 0.6 * responsiveScale * compositionScale;
    characterCellHeight =
      renderSettings.glyphSize * 0.89 * responsiveScale * compositionScale;
    columnCount = Math.ceil(canvasWidth / characterCellWidth);
    rowCount = Math.ceil(canvasHeight / characterCellHeight);
    characterHeat = new Float32Array(columnCount * rowCount);
    tileColumnCount = Math.ceil(columnCount / 2);
    tileHeat = new Float32Array(tileColumnCount * Math.ceil(rowCount / 2));
  }
  /** Defer bitmap resets until the animation frame that redraws the flower. */
  function requestFlowerResize() {
    isFlowerResizePending = true;
  }
  new ResizeObserver(requestFlowerResize).observe(flowerSurface);
  window.addEventListener("resize", requestFlowerResize, { passive: true });
  if (typeof IntersectionObserver !== "undefined") {
    new IntersectionObserver((visibilityEntries) => {
      isVisible = visibilityEntries[0].isIntersecting;
      previousFrameMilliseconds = null;
    }).observe(portfolioRoot);
  }
  /**
   * Evaluate the 18-second bloom loop, including its closed and open holds.
   * @param {number} loopSeconds - Elapsed time in the repeating bloom cycle.
   * @returns {number} Bloom progress between zero and one.
   */
  function getBloomProgress(loopSeconds) {
    loopSeconds %= 18;
    if (loopSeconds < 0.5) {
      return 0;
    }
    if (loopSeconds < 5) {
      return smoothStep((loopSeconds - 0.5) / 4.5);
    }
    if (loopSeconds < 13) {
      return 1;
    }
    if (loopSeconds < 17.5) {
      return 1 - smoothStep((loopSeconds - 13) / 4.5);
    }
    return 0;
  }
  const sectionTransition = {
    asideAmount: 0,
    slideProgress: 0,
    startAsideAmount: 0,
    startSlideProgress: 0,
    targetAmount: 0,
    elapsedSeconds: 10,
    revealProgress: 0,
    startRevealProgress: 0,
    isClosing: false,
    cueDelaySeconds: 0,
    bloomProgress: 1,
    startBloomProgress: 1,
    petalFold: 0,
    petalFoldVelocity: 0,
    petalSway: 0,
    petalSwayVelocity: 0,
    petalTurn: 0,
    petalTurnVelocity: 0,
  };
  /**
   * Ease a normalized transition with zero endpoint velocity and acceleration.
   * @param {number} value - Transition progress.
   * @returns {number} Eased progress between zero and one.
   */
  const smootherStep = (value) => {
    value = clampRange(value);
    return value * value * value * (value * (value * 6 - 15) + 10);
  };
  /**
   * Advance one critically damped petal response without losing interrupted motion.
   * @param {string} positionProperty - Petal state property to update.
   * @param {string} velocityProperty - Corresponding velocity property.
   * @param {number} targetValue - Desired spring position.
   * @param {number} springRate - Response rate per second.
   * @param {number} deltaSeconds - Time since the previous frame.
   * @returns {void}
   */
  function relaxPetalSpring(
    positionProperty,
    velocityProperty,
    targetValue,
    springRate,
    deltaSeconds,
  ) {
    const displacement = sectionTransition[positionProperty] - targetValue;
    const decayFactor = Math.exp(-springRate * deltaSeconds);
    const velocityStep =
      (sectionTransition[velocityProperty] + springRate * displacement) *
      deltaSeconds;
    sectionTransition[positionProperty] =
      targetValue + (displacement + velocityStep) * decayFactor;
    sectionTransition[velocityProperty] =
      (sectionTransition[velocityProperty] - springRate * velocityStep) *
      decayFactor;
    if (
      targetValue === 0 &&
      Math.abs(sectionTransition[positionProperty]) +
        Math.abs(sectionTransition[velocityProperty]) <
        0.0001
    ) {
      sectionTransition[positionProperty] = 0;
      sectionTransition[velocityProperty] = 0;
    }
  }
  /**
   * Finish the return at the full-open hold while preserving pause or play.
   * @returns {void}
   */
  function finishLotusReturn() {
    resetLotusPointer();
    sectionTransition.asideAmount = 0;
    sectionTransition.slideProgress = 0;
    sectionTransition.revealProgress = 0;
    sectionTransition.bloomProgress = 1;
    sectionTransition.startBloomProgress = 1;
    sectionTransition.isClosing = false;
    /** Resume from the beginning of the full-open hold, respecting pause/play. */
    bloomLoopSeconds = 5;
    pausedBloomProgress = 1;
  }
  /**
   * Settle restored or reduced-motion navigation so later preference changes cannot resume an old entrance.
   * @returns {void}
   */
  function settleSectionTransition() {
    const targetAmount = sectionTransition.targetAmount;
    if (targetAmount === 0 && sectionTransition.isClosing) {
      finishLotusReturn();
    }
    sectionTransition.startAsideAmount = sectionTransition.asideAmount =
      targetAmount;
    sectionTransition.startSlideProgress = sectionTransition.slideProgress =
      targetAmount;
    sectionTransition.startRevealProgress = sectionTransition.revealProgress =
      targetAmount;
    sectionTransition.startBloomProgress = sectionTransition.bloomProgress =
      targetAmount === 1
        ? 1
        : isPlaying
          ? getBloomProgress(bloomLoopSeconds)
          : pausedBloomProgress;
    sectionTransition.elapsedSeconds = 10;
    sectionTransition.isClosing = false;
    sectionTransition.petalFold = sectionTransition.petalFoldVelocity = 0;
    sectionTransition.petalSway = sectionTransition.petalSwayVelocity = 0;
    sectionTransition.petalTurn = sectionTransition.petalTurnVelocity = 0;
    sectionPanel.hidden = targetAmount === 0;
    sectionPanel.inert = targetAmount === 0;
  }
  /**
   * Open a section and coordinate its content, flower movement, and dragonfly flight.
   * @param {'work'|'about'|'contact'} nextSection - Section to present.
   * @returns {void}
   */
  function openSection(nextSection) {
    if (
      selectedSection === nextSection &&
      sectionTransition.targetAmount === 1
    ) {
      if (nextSection === "work" && workGallery.hasDetail()) {
        workGallery.back();
      }
      return;
    }
    workGallery.reset();
    cancelNavigationHover();
    resetLotusPointer();
    if (sectionTransition.targetAmount === 0) {
      sectionTransition.startAsideAmount = sectionTransition.asideAmount;
      sectionTransition.startSlideProgress = sectionTransition.slideProgress;
      sectionTransition.startBloomProgress = sectionTransition.bloomProgress;
      sectionTransition.targetAmount = 1;
      sectionTransition.elapsedSeconds = 0;
      sectionTransition.isClosing = false;
      sectionTransition.startRevealProgress = sectionTransition.revealProgress;
      sectionTransition.cueDelaySeconds =
        nextSection === "about" ? 0.22 : nextSection === "contact" ? 0.28 : 0;
    }
    selectedSection = nextSection;
    pointerState.isActive = false;
    sectionPanel.hidden = false;
    sectionPanel.inert = false;
    sectionPanel.scrollTop = 0;
    portfolioRoot
      .querySelectorAll("[data-navigation-section]")
      .forEach((sectionButton) =>
        sectionButton.setAttribute(
          "aria-pressed",
          String(sectionButton.dataset.navigationSection === nextSection),
        ),
      );
    portfolioRoot.dataset.activeSection = nextSection;
    setPortfolioLanguage(currentLanguage);
    dragonflyRenderer.launch(
      nextSection,
      reducedMotionPreference.matches || isRestoringPortfolioLocation,
    );
    updateNavigationHover(0);
    portfolioRoot.querySelector(".panel-close-button").focus({
      preventScroll: true,
    });
    if (reducedMotionPreference.matches) {
      settleSectionTransition();
      updateSectionTransition(0);
    }
    synchronizePortfolioLocation();
  }
  /**
   * Close the content panel and restore navigation focus for keyboard activation.
   * @param {Event|undefined} event - Activation event used to decide whether focus returns.
   * @returns {void}
   */
  function closeSection(event) {
    if (sectionTransition.targetAmount === 0) {
      return;
    }
    workGallery.pauseMedia();
    cancelNavigationHover();
    resetLotusPointer();
    sectionTransition.startAsideAmount = sectionTransition.asideAmount;
    sectionTransition.startSlideProgress = sectionTransition.slideProgress;
    sectionTransition.startBloomProgress = sectionTransition.bloomProgress;
    sectionTransition.targetAmount = 0;
    sectionTransition.elapsedSeconds = 0;
    sectionTransition.isClosing = true;
    sectionTransition.startRevealProgress = sectionTransition.revealProgress;
    dragonflyRenderer.returnHome(
      reducedMotionPreference.matches || isRestoringPortfolioLocation,
      0,
    );
    const wasFocusInsidePanel = sectionPanel.contains(document.activeElement);
    sectionPanel.inert = true;
    const previousSection = selectedSection;
    selectedSection = null;
    delete portfolioRoot.dataset.activeSection;
    synchronizePortfolioLocation();
    /** Never leave focus inside the newly inert panel, including after a pointer close. */
    const shouldRestoreFocus =
      wasFocusInsidePanel ||
      !event ||
      event.type === "keydown" ||
      event.detail === 0;
    if (previousSection && shouldRestoreFocus) {
      portfolioRoot
        .querySelector('[data-navigation-section="' + previousSection + '"]')
        .focus({
          preventScroll: true,
        });
    }
    portfolioRoot
      .querySelectorAll("[data-navigation-section]")
      .forEach((sectionButton) =>
        sectionButton.setAttribute("aria-pressed", "false"),
      );
    if (reducedMotionPreference.matches) {
      settleSectionTransition();
      updateSectionTransition(0);
    }
    updateNavigationHover(0);
  }
  /**
   * Advance panel reveal, flower displacement, and the petal spring responses.
   * @param {number} sceneDeltaSeconds - Capped step for continuous spring and input motion.
   * @param {number} [transitionDeltaSeconds=sceneDeltaSeconds] - Visible elapsed time for panel and flight durations.
   * @returns {void}
   */
  function updateSectionTransition(
    sceneDeltaSeconds,
    transitionDeltaSeconds = sceneDeltaSeconds,
  ) {
    const previousSlideProgress = sectionTransition.slideProgress;
    sectionTransition.elapsedSeconds += transitionDeltaSeconds;
    const transitionSeconds = sectionTransition.elapsedSeconds;
    if (!reducedMotionPreference.matches) {
      if (sectionTransition.isClosing) {
        sectionTransition.asideAmount =
          sectionTransition.startAsideAmount *
          (1 - smoothStep(transitionSeconds / 0.5));
        sectionTransition.slideProgress =
          sectionTransition.startSlideProgress *
          (1 - smootherStep(transitionSeconds / 1.1));
        sectionTransition.bloomProgress =
          sectionTransition.startBloomProgress +
          (1 - sectionTransition.startBloomProgress) *
            smootherStep(transitionSeconds / 1.1);
        sectionTransition.revealProgress =
          sectionTransition.startRevealProgress *
          (1 - smoothStep(transitionSeconds / 0.24));
        if (transitionSeconds >= 1.1) {
          finishLotusReturn();
        }
      } else if (sectionTransition.targetAmount === 1) {
        const cueSeconds =
          transitionSeconds - sectionTransition.cueDelaySeconds;
        sectionTransition.asideAmount =
          sectionTransition.startAsideAmount +
          (1 - sectionTransition.startAsideAmount) *
            smoothStep((cueSeconds - 0.64) / 0.94);
        sectionTransition.slideProgress =
          sectionTransition.startSlideProgress +
          (1 - sectionTransition.startSlideProgress) *
            smootherStep((transitionSeconds - 0.18) / 2.6);
        sectionTransition.bloomProgress =
          sectionTransition.startBloomProgress +
          (1 - sectionTransition.startBloomProgress) *
            smootherStep(transitionSeconds / 2.78);
        sectionTransition.revealProgress =
          sectionTransition.startRevealProgress +
          (1 - sectionTransition.startRevealProgress) *
            smoothStep((cueSeconds - 1.03) / 0.6);
      } else {
        sectionTransition.bloomProgress = isPlaying
          ? getBloomProgress(bloomLoopSeconds)
          : pausedBloomProgress;
      }
    } else {
      sectionTransition.asideAmount = sectionTransition.targetAmount;
      sectionTransition.slideProgress = sectionTransition.targetAmount;
      sectionTransition.revealProgress = sectionTransition.targetAmount;
      if (sectionTransition.isClosing) {
        finishLotusReturn();
      }
      sectionTransition.bloomProgress =
        sectionTransition.targetAmount === 1
          ? 1
          : isPlaying
            ? getBloomProgress(bloomLoopSeconds)
            : pausedBloomProgress;
    }
    if (reducedMotionPreference.matches) {
      sectionTransition.petalFold =
        sectionTransition.petalFoldVelocity =
        sectionTransition.petalSway =
        sectionTransition.petalSwayVelocity =
          0;
      sectionTransition.petalTurn = sectionTransition.petalTurnVelocity = 0;
    } else {
      /**
       * Petals respond to the acceleration and settling of the intact flower.
       * Continuous spring state keeps interrupted moves free of pose jumps.
       */
      const slideVelocity =
        (sectionTransition.slideProgress - previousSlideProgress) /
        Math.max(0.001, transitionDeltaSeconds);
      const movementDirection = sectionTransition.isClosing
        ? -1
        : sectionTransition.targetAmount === 1
          ? 1
          : 0;
      const isPreparing =
        movementDirection &&
        Math.abs(
          sectionTransition.targetAmount - sectionTransition.slideProgress,
        ) > 0.001;
      const anticipationAmount = isPreparing
        ? smoothStep(transitionSeconds / 0.18) *
          (1 - smoothStep((transitionSeconds - 0.22) / 0.34))
        : 0;
      relaxPetalSpring(
        "petalFold",
        "petalFoldVelocity",
        clampRange(Math.abs(slideVelocity) * 0.9 + anticipationAmount * 0.55),
        9.5,
        sceneDeltaSeconds,
      );
      relaxPetalSpring(
        "petalSway",
        "petalSwayVelocity",
        clampRange(
          -slideVelocity * 0.85 - movementDirection * anticipationAmount * 0.28,
          -1,
          1,
        ),
        7,
        sceneDeltaSeconds,
      );
      /** A slower axial turn trails the petal response, then settles to neutral. */
      relaxPetalSpring(
        "petalTurn",
        "petalTurnVelocity",
        clampRange(
          slideVelocity * 1.22 + movementDirection * anticipationAmount * 0.12,
          -1,
          1,
        ),
        4.6,
        sceneDeltaSeconds,
      );
    }
    if (
      sectionTransition.targetAmount === 0 &&
      sectionTransition.revealProgress < 0.001
    ) {
      sectionPanel.hidden = true;
    }
    const panelContent = sectionPanel.querySelector(".panel-content");
    panelContent.style.opacity = String(sectionTransition.revealProgress);
    panelContent.style.transform = `translateY(${(1 - sectionTransition.revealProgress) * 8}px)`;
    portfolioRoot.style.setProperty(
      "--section-transition-progress",
      String(sectionTransition.asideAmount),
    );
    updateNavigationHover(sceneDeltaSeconds);
    dragonflyRenderer.draw(
      motionSeconds,
      sceneDeltaSeconds,
      reducedMotionPreference.matches,
      navigationHoverState.work,
      transitionDeltaSeconds,
    );
  }
  const navigationHoverState = {
    pointerSection: null,
    focusedSection: null,
    activeSection: null,
    blockedSection: null,
    isFocusSuppressed: false,
    isKeyboardNavigation: false,
    elapsedSeconds: 0,
    contactOpacityValue: "",
    work: 0,
    workVelocity: 0,
    about: 0,
    aboutVelocity: 0,
    contact: 0,
    contactVelocity: 0,
  };
  const replayButton = portfolioRoot.querySelector(".restart-bloom-button");
  /**
   * Record the current pointer or keyboard focus candidate.
   * @param {'pointerSection'|'focusedSection'} inputProperty - Input source to update.
   * @param {'work'|'about'|'contact'|null} candidateSection - Candidate section, or null when leaving.
   * @returns {void}
   */
  function setHoverCandidate(inputProperty, candidateSection) {
    navigationHoverState[inputProperty] = candidateSection;
    if (candidateSection !== navigationHoverState.blockedSection) {
      navigationHoverState.blockedSection = null;
    }
  }
  /**
   * Suppress the active navigation cue until the user chooses another target.
   * @returns {void}
   */
  function cancelNavigationHover() {
    navigationHoverState.blockedSection =
      navigationHoverState.pointerSection ||
      navigationHoverState.focusedSection ||
      navigationHoverState.activeSection;
    navigationHoverState.focusedSection = null;
    navigationHoverState.activeSection = null;
    navigationHoverState.elapsedSeconds = 0;
    navigationHoverState.isFocusSuppressed = true;
    delete portfolioRoot.dataset.hoveredSection;
  }
  portfolioRoot
    .querySelectorAll("[data-navigation-section]")
    .forEach((sectionButton) => {
      const buttonSection = sectionButton.dataset.navigationSection;
      sectionButton.addEventListener("pointerenter", (event) => {
        if (event.pointerType !== "touch") {
          navigationHoverState.isKeyboardNavigation = false;
          navigationHoverState.focusedSection = null;
          setHoverCandidate("pointerSection", buttonSection);
        }
      });
      sectionButton.addEventListener("pointermove", (event) => {
        if (
          event.pointerType !== "touch" &&
          (event.movementX || event.movementY)
        ) {
          navigationHoverState.isKeyboardNavigation = false;
          navigationHoverState.focusedSection = null;
          setHoverCandidate("pointerSection", buttonSection);
        }
      });
      sectionButton.addEventListener("pointerleave", () => {
        if (navigationHoverState.pointerSection === buttonSection) {
          setHoverCandidate("pointerSection", null);
        }
      });
      sectionButton.addEventListener("pointercancel", () =>
        setHoverCandidate("pointerSection", null),
      );
      sectionButton.addEventListener("focus", () => {
        if (
          !navigationHoverState.isFocusSuppressed &&
          (navigationHoverState.isKeyboardNavigation ||
            sectionButton.matches(":focus-visible"))
        ) {
          setHoverCandidate("focusedSection", buttonSection);
        }
      });
      sectionButton.addEventListener("blur", () => {
        if (navigationHoverState.focusedSection === buttonSection) {
          setHoverCandidate("focusedSection", null);
        }
      });
    });
  portfolioRoot.addEventListener("keydown", (event) => {
    if (event.key === "Tab") {
      navigationHoverState.pointerSection = null;
      navigationHoverState.blockedSection = null;
      navigationHoverState.isFocusSuppressed = false;
      navigationHoverState.isKeyboardNavigation = true;
    }
  });
  /**
   * Ease a section's hover response and its stored velocity toward a target.
   * @param {'work'|'about'|'contact'} sectionKey - Navigation response to update.
   * @param {number} targetValue - Desired hover amount.
   * @param {number} springRate - Response rate per second.
   * @param {number} deltaSeconds - Time since the previous frame.
   * @returns {void}
   */
  function relaxNavigationSpring(
    sectionKey,
    targetValue,
    springRate,
    deltaSeconds,
  ) {
    const velocityProperty = sectionKey + "Velocity";
    const displacement = navigationHoverState[sectionKey] - targetValue;
    const decayFactor = Math.exp(-springRate * deltaSeconds);
    const velocityStep =
      (navigationHoverState[velocityProperty] + springRate * displacement) *
      deltaSeconds;
    navigationHoverState[sectionKey] =
      targetValue + (displacement + velocityStep) * decayFactor;
    navigationHoverState[velocityProperty] =
      (navigationHoverState[velocityProperty] - springRate * velocityStep) *
      decayFactor;
    if (
      targetValue === 0 &&
      Math.abs(navigationHoverState[sectionKey]) +
        Math.abs(navigationHoverState[velocityProperty]) <
        0.0001
    ) {
      navigationHoverState[sectionKey] = 0;
      navigationHoverState[velocityProperty] = 0;
    }
  }
  /**
   * Build a single hover gesture from its rise, hold, and fall durations.
   * @param {number} elapsedSeconds - Time since the gesture started.
   * @param {number} riseDuration - Time to reach the peak.
   * @param {number} holdDuration - Time at the peak.
   * @param {number} fallDuration - Time to return to rest.
   * @returns {number} Gesture strength between zero and one.
   */
  function getHoverPulse(
    elapsedSeconds,
    riseDuration,
    holdDuration,
    fallDuration,
  ) {
    return (
      smoothStep(elapsedSeconds / riseDuration) *
      (1 -
        smoothStep(
          (elapsedSeconds - riseDuration - holdDuration) / fallDuration,
        ))
    );
  }
  /**
   * Apply dwell timing, restrained hover responses, and flower-control availability.
   * @param {number} deltaSeconds - Time since the previous frame.
   * @returns {void}
   */
  function updateNavigationHover(deltaSeconds) {
    const isTransitioning =
      sectionTransition.isClosing ||
      (sectionTransition.targetAmount === 1 &&
        sectionTransition.elapsedSeconds < 3.1);
    let candidateSection =
      navigationHoverState.pointerSection ||
      navigationHoverState.focusedSection;
    if (
      isTransitioning ||
      candidateSection === navigationHoverState.blockedSection ||
      candidateSection === selectedSection
    ) {
      candidateSection = null;
    }
    if (candidateSection !== navigationHoverState.activeSection) {
      navigationHoverState.activeSection = candidateSection;
      navigationHoverState.elapsedSeconds = 0;
      if (candidateSection) {
        portfolioRoot.dataset.hoveredSection = candidateSection;
      } else {
        delete portfolioRoot.dataset.hoveredSection;
      }
    }
    if (candidateSection) {
      navigationHoverState.elapsedSeconds += deltaSeconds;
    }
    const dwellSeconds =
      navigationHoverState.elapsedSeconds -
      (candidateSection === "contact" ? 0.25 : 0.18);
    const isDwellReady = Boolean(candidateSection) && dwellSeconds >= 0;
    const workAttention =
      isDwellReady && candidateSection === "work"
        ? getHoverPulse(dwellSeconds, 0.3, 0.34, 0.6)
        : 0;
    const aboutAttention =
      isDwellReady && candidateSection === "about"
        ? getHoverPulse(dwellSeconds, 0.48, 0.3, 0.9)
        : 0;
    const contactAttention =
      isDwellReady && candidateSection === "contact" ? 1 : 0;
    if (reducedMotionPreference.matches) {
      navigationHoverState.work =
        navigationHoverState.workVelocity =
        navigationHoverState.about =
        navigationHoverState.aboutVelocity =
          0;
      navigationHoverState.contact = contactAttention;
      navigationHoverState.contactVelocity = 0;
    } else {
      relaxNavigationSpring(
        "work",
        workAttention,
        workAttention ? 14 : 7,
        deltaSeconds,
      );
      relaxNavigationSpring(
        "about",
        aboutAttention,
        aboutAttention ? 12 : 6,
        deltaSeconds,
      );
      relaxNavigationSpring(
        "contact",
        contactAttention,
        contactAttention ? 9 : 6,
        deltaSeconds,
      );
    }
    const contactOpacityValue = navigationHoverState.contact.toFixed(4);
    if (contactOpacityValue !== navigationHoverState.contactOpacityValue) {
      portfolioRoot.style.setProperty("--hover-contact", contactOpacityValue);
      navigationHoverState.contactOpacityValue = contactOpacityValue;
    }
    const isFlowerBusy =
      sectionTransition.targetAmount === 1 ||
      sectionTransition.isClosing ||
      sectionTransition.slideProgress > 0.001;
    if (flowerSurface.disabled !== isFlowerBusy) {
      flowerSurface.disabled = isFlowerBusy;
      flowerSurface.inert = isFlowerBusy;
      replayButton.disabled = isFlowerBusy;
      portfolioRoot.toggleAttribute("data-lotus-busy", isFlowerBusy);
    }
  }
  /**
   * Update visible copy and accessible labels without disturbing the current section.
   * @param {'en'|'zh'} languageCode - Language to display.
   * @returns {void}
   */
  function setPortfolioLanguage(languageCode) {
    currentLanguage = languageCode;
    try {
      sessionStorage.setItem("portfolio-language", languageCode);
    } catch {
      /** Language switching remains available when browser storage is disabled. */
    }
    portfolioRoot.lang = languageCode === "zh" ? "zh-CN" : "en";
    portfolioRoot
      .querySelector(".main-navigation")
      .setAttribute("aria-label", translations[languageCode].navigationLabel);
    portfolioRoot
      .querySelector(".language-switcher")
      .setAttribute("aria-label", translations[languageCode].languageLabel);
    sectionPanel.setAttribute(
      "aria-label",
      translations[languageCode].contentLabel,
    );
    portfolioRoot
      .querySelectorAll("[data-language-option]")
      .forEach((languageButton) =>
        languageButton.setAttribute(
          "aria-pressed",
          String(languageButton.dataset.languageOption === languageCode),
        ),
      );
    portfolioRoot
      .querySelectorAll("[data-navigation-section]")
      .forEach((sectionButton) => {
        sectionButton.textContent =
          translations[languageCode][sectionButton.dataset.navigationSection];
      });
    portfolioRoot.querySelector(".site-message").textContent = drawingContext
      ? translations[languageCode].hint
      : languageCode === "zh"
        ? "暂时无法显示花朵动画。"
        : "The flower animation is unavailable.";
    portfolioRoot.querySelector(".restart-bloom-button").textContent =
      translations[languageCode].replay;
    const returnButton = portfolioRoot.querySelector(".panel-close-button");
    returnButton.textContent = translations[languageCode].close;
    returnButton.setAttribute("aria-label", translations[languageCode].close);
    flowerSurface.setAttribute(
      "aria-label",
      translations[languageCode][isPlaying ? "pause" : "play"],
    );
    flowerSurface.setAttribute("aria-pressed", String(!isPlaying));
    flowerCanvas.setAttribute("aria-label", translations[languageCode].image);
    flowerCanvas.textContent = translations[languageCode].image;
    if (selectedSection) {
      sectionPanel.querySelector("h2").textContent =
        selectedSection === "work"
          ? languageCode === "en"
            ? "Selected work"
            : "精选作品"
          : translations[languageCode][selectedSection];
      const isAboutSection = selectedSection === "about";
      const isWorkSection = selectedSection === "work";
      sectionPanel.querySelector(".about-section").hidden = !isAboutSection;
      sectionPanel.querySelector(".work-section").hidden = !isWorkSection;
      sectionPanel.querySelector(".contact-details").hidden =
        selectedSection !== "contact";
      sectionPanel.querySelector(
        '[data-contact-label="emailLabel"]',
      ).textContent = translations[languageCode].emailLabel;
      sectionPanel
        .querySelector(".contact-profile")
        .setAttribute("aria-label", translations[languageCode].linkedinLabel);
      sectionPanel
        .querySelector(".work-grid")
        .setAttribute(
          "aria-label",
          languageCode === "en" ? "Selected projects" : "作品列表",
        );
      if (isAboutSection) {
        sectionPanel
          .querySelectorAll("[data-about-copy]")
          .forEach((aboutParagraph) => {
            aboutParagraph.textContent =
              translations[languageCode][aboutParagraph.dataset.aboutCopy];
          });
        sectionPanel.querySelector(".self-portrait img").alt =
          translations[languageCode].portraitAlt;
      }
    }
    workGallery.render(languageCode, selectedSection === "work");
    document.documentElement.lang = languageCode === "zh" ? "zh-CN" : "en";
    dragonflyRenderer.resize();
  }
  portfolioRoot
    .querySelectorAll("[data-language-option]")
    .forEach((languageButton) =>
      languageButton.addEventListener("click", () =>
        setPortfolioLanguage(languageButton.dataset.languageOption),
      ),
    );
  portfolioRoot
    .querySelectorAll("[data-navigation-section]")
    .forEach((sectionButton) =>
      sectionButton.addEventListener("click", () =>
        openSection(sectionButton.dataset.navigationSection),
      ),
    );
  portfolioRoot
    .querySelector(".panel-close-button")
    .addEventListener("click", closeSection);
  portfolioRoot.addEventListener("keydown", (event) => {
    if (
      event.key === "Escape" &&
      !event.defaultPrevented &&
      !event.repeat &&
      !document.fullscreenElement &&
      !sectionPanel.hidden &&
      !sectionPanel.inert
    ) {
      event.preventDefault();
      if (selectedSection === "work" && workGallery.hasDetail()) {
        workGallery.back();
      } else {
        closeSection(event);
      }
    }
  });

  /**
   * Tapping a drawing plays the same two-frame gesture as hovering it.
   * Keyboard focus also animates; reduced-motion users see one still frame.
   */
  portfolioRoot.querySelectorAll("[data-project-icon]").forEach((workIcon) => {
    let iconAnimationTimeout;
    workIcon.addEventListener("click", () => {
      if (reducedMotionPreference.matches) {
        return;
      }
      clearTimeout(iconAnimationTimeout);
      workIcon.classList.remove("is-playing");
      void workIcon.offsetWidth;
      workIcon.classList.add("is-playing");
      const animationDurationSeconds =
        parseFloat(
          getComputedStyle(workIcon).getPropertyValue("--ink-duration"),
        ) || 1.7;
      iconAnimationTimeout = setTimeout(
        () => workIcon.classList.remove("is-playing"),
        animationDurationSeconds * 1000,
      );
    });
    workIcon.addEventListener("blur", () => {
      clearTimeout(iconAnimationTimeout);
      workIcon.classList.remove("is-playing");
    });
  });
  /**
   * Clear pointer rotation input and the remaining colored character trail.
   * @returns {void}
   */
  function resetLotusPointer() {
    pointerState.isActive = false;
    isKeyboardPointer = false;
    characterHeat.fill(0);
    tileHeat.fill(0);
  }
  /**
   * Map pointer coordinates to the flower canvas and normalized portfolio bounds.
   * @param {PointerEvent} event - Pointer movement or touch event.
   * @returns {void}
   */
  function updateLotusPointer(event) {
    if (
      sectionTransition.targetAmount === 1 ||
      sectionTransition.isClosing ||
      sectionTransition.slideProgress > 0.001 ||
      event.target.closest("button:not(.lotus-interaction)")
    ) {
      pointerState.isActive = false;
      return;
    }
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
  /** Pointer position sets yaw and pitch around one fixed flower pivot. */
  portfolioRoot.addEventListener("pointerenter", (event) => {
    isKeyboardPointer = false;
    updateLotusPointer(event);
  });
  portfolioRoot.addEventListener("pointermove", (event) => {
    isKeyboardPointer = false;
    updateLotusPointer(event);
  });
  portfolioRoot.addEventListener("pointerleave", () => {
    pointerState.isActive = false;
  });
  portfolioRoot.addEventListener(
    "pointerdown",
    (event) => {
      if (event.pointerType === "touch") {
        updateLotusPointer(event);
      }
    },
    {
      passive: true,
    },
  );
  portfolioRoot.addEventListener("pointerup", (event) => {
    if (event.pointerType === "touch") {
      window.setTimeout(() => {
        pointerState.isActive = false;
      }, 700);
    }
  });
  portfolioRoot.addEventListener("pointercancel", () => {
    pointerState.isActive = false;
  });
  flowerSurface.addEventListener("blur", () => {
    pointerState.isActive = false;
    isKeyboardPointer = false;
  });
  flowerSurface.addEventListener("keydown", (event) => {
    if (
      !["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)
    ) {
      return;
    }
    event.preventDefault();
    isKeyboardPointer = true;
    pointerState.isActive = true;
    pointerState.normalizedX = clampRange(
      pointerState.normalizedX +
        (event.key === "ArrowLeft"
          ? -0.18
          : event.key === "ArrowRight"
            ? 0.18
            : 0),
      -1,
      1,
    );
    pointerState.normalizedY = clampRange(
      pointerState.normalizedY +
        (event.key === "ArrowUp"
          ? -0.18
          : event.key === "ArrowDown"
            ? 0.18
            : 0),
      -1,
      1,
    );
    pointerState.x = canvasWidth * (0.5 + pointerState.normalizedX * 0.28);
    pointerState.y = canvasHeight * (0.35 + pointerState.normalizedY * 0.25);
  });
  flowerSurface.addEventListener("click", (event) => {
    pausedBloomProgress = isPlaying
      ? getBloomProgress(bloomLoopSeconds)
      : pausedBloomProgress;
    isPlaying = !isPlaying;
    setPortfolioLanguage(currentLanguage);
  });
  portfolioRoot
    .querySelector(".restart-bloom-button")
    .addEventListener("click", () => {
      bloomLoopSeconds = 0;
      pausedBloomProgress = 0;
      isPlaying = true;
      setPortfolioLanguage(currentLanguage);
    });
  reducedMotionPreference.addEventListener("change", () => {
    isPlaying = !reducedMotionPreference.matches;
    pausedBloomProgress = 1;
    if (reducedMotionPreference.matches) {
      resetLotusPointer();
      settleSectionTransition();
      if (selectedSection) {
        dragonflyRenderer.launch(selectedSection, true);
      } else {
        dragonflyRenderer.returnHome(true);
      }
      updateSectionTransition(0);
    }
    setPortfolioLanguage(currentLanguage);
  });
  /**
   * Render one ASCII frame and schedule the next, preserving pauses and visibility state.
   * @param {number} frameMilliseconds - Timestamp supplied by requestAnimationFrame.
   * @returns {void}
   */
  function drawFrame(frameMilliseconds) {
    requestAnimationFrame(drawFrame);
    const elapsedFrameSeconds =
      previousFrameMilliseconds === null
        ? 0
        : Math.max(0, (frameMilliseconds - previousFrameMilliseconds) / 1000);
    /** Keep interaction motion bounded without stretching finite transitions at low frame rates. */
    const sceneDeltaSeconds = Math.min(0.05, elapsedFrameSeconds);
    previousFrameMilliseconds = frameMilliseconds;
    if (!isVisible || document.hidden) {
      return;
    }
    if (isFlowerResizePending) {
      resizeFlowerCanvas();
      isFlowerResizePending = false;
    }
    if (
      isPlaying &&
      sectionTransition.targetAmount === 0 &&
      !sectionTransition.isClosing
    ) {
      bloomLoopSeconds += sceneDeltaSeconds;
    }
    if (!reducedMotionPreference.matches) {
      motionSeconds += sceneDeltaSeconds;
    }
    updateSectionTransition(sceneDeltaSeconds, elapsedFrameSeconds);
    flowerCanvas.style.transform = `translate3d(${canvasWidth * sectionTransition.slideProgress * (portfolioRoot.clientWidth <= 600 ? 0.9 : 0.52)}px,0,0)`;
    if (!drawingContext) return;
    drawingContext.globalAlpha = 1;
    drawingContext.fillStyle = paperColor;
    drawingContext.fillRect(0, 0, canvasWidth, canvasHeight);
    if (!lotusRenderer) {
      drawingContext.fillStyle = "#464840";
      drawingContext.font = "15px Arial";
      drawingContext.textAlign = "center";
      drawingContext.fillText(
        currentLanguage === "zh"
          ? "暂时无法显示花朵动画。"
          : "The flower animation is unavailable.",
        canvasWidth / 2,
        canvasHeight / 2,
      );
      return;
    }
    const isPointerActive =
      pointerState.isActive &&
      sectionPanel.hidden &&
      !navigationHoverState.activeSection &&
      !sectionTransition.isClosing &&
      sectionTransition.slideProgress < 0.001;
    const followAmount =
      sectionTransition.targetAmount === 1 ||
      sectionTransition.slideProgress > 0.001 ||
      navigationHoverState.activeSection
        ? 0
        : 1 - Math.exp(-sceneDeltaSeconds * 3.6);
    pitchRadians +=
      ((isPointerActive ? -pointerState.normalizedY * 0.24 : 0) -
        pitchRadians) *
      followAmount;
    yawRadians +=
      ((isPointerActive ? pointerState.normalizedX * 0.9 : 0) - yawRadians) *
      followAmount;
    rollRadians = 0;
    const bloomProgress = sectionTransition.bloomProgress;
    const modelScale = Math.min(canvasWidth / 3.48, canvasHeight / 4.4);
    let renderedPixels;
    try {
      renderedPixels = lotusRenderer.render(
        columnCount,
        rowCount,
        columnCount * characterCellWidth,
        rowCount * characterCellHeight,
        bloomProgress,
        [pitchRadians, yawRadians, rollRadians],
        [canvasWidth * 0.51, canvasHeight * 0.44, modelScale],
        renderSettings.highlight,
        {
          fold:
            sectionTransition.petalFold *
            (sectionTransition.slideProgress > 0 &&
            sectionTransition.slideProgress < 1
              ? Math.sin(Math.PI * sectionTransition.slideProgress)
              : 0),
          sway: sectionTransition.petalSway,
          turn: sectionTransition.petalTurn,
          attention: navigationHoverState.about,
          phase: motionSeconds,
        },
      );
    } catch (renderError) {
      /** A failed graphics frame must not interrupt navigation or retry a broken renderer forever. */
      flowerCanvas.dataset.graphicsError = String(
        renderError?.message || renderError,
      );
      lotusRenderer = null;
      return;
    }
    const heatDecayFactor = Math.exp(-sceneDeltaSeconds * 3.0);
    const brushRadius = Math.min(66, canvasWidth * 0.19);
    const accentTick = reducedMotionPreference.matches
      ? 0
      : Math.floor(motionSeconds * 6);
    const sampleRowStride = columnCount * 2;
    tileHeat.fill(0);
    drawingContext.font = `${characterCellHeight * 1.12}px "Courier New", monospace`;
    drawingContext.textAlign = "center";
    drawingContext.textBaseline = "middle";
    const lightGlyphFont = `400 ${characterCellHeight * 1.14}px "Courier New", monospace`;
    const darkGlyphFont = `700 ${characterCellHeight * 1.14}px "Courier New", monospace`;
    let currentGlyphFont = "";
    for (let characterRow = 0; characterRow < rowCount; characterRow++) {
      for (
        let characterColumn = 0;
        characterColumn < columnCount;
        characterColumn++
      ) {
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
              ((rowCount * 2 - 1 - (characterRow * 2 + sampleRow)) *
                sampleRowStride +
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
            const materialIndex = Math.round(
              (renderedPixels[sampleByteOffset + 1] / 255) * 8,
            );
            if (materialIndex === 2 || materialIndex === 6) {
              antherSampleCount++;
            }
            sampleCoverage += sampleWeight;
          }
        }
        if (sampleCoverage > 0) {
          lightIntensity = lightIntensity / sampleCoverage;
          const contrastOdds = Math.pow(
            Math.max(0.001, lightIntensity) /
              Math.max(0.001, 1 - lightIntensity),
            renderSettings.contrast,
          );
          lightIntensity = contrastOdds / (1 + contrastOdds);
          const inkAmount = 1 - lightIntensity;
          const grainOffset =
            deterministicNoise(characterIndex * 3.1) * 0.012 - 0.006;
          let character =
            characterRamp[
              Math.min(
                characterRamp.length - 1,
                Math.floor(
                  clampRange(inkAmount + grainOffset) * characterRamp.length,
                ),
              )
            ];
          const edgeOpacity =
            (0.35 + (0.65 * sampleCoverage) / 4) * Math.min(1, sampleCoverage);
          const nextGlyphFont =
            lightIntensity < 0.32 ? darkGlyphFont : lightGlyphFont;
          if (nextGlyphFont !== currentGlyphFont) {
            drawingContext.font = nextGlyphFont;
            currentGlyphFont = nextGlyphFont;
          }
          /** Stroke value and glyph density both follow continuous surface illumination. */
          const grayValue = Math.round(17 + 137 * lightIntensity);
          drawingContext.fillStyle = `rgb(${grayValue},${grayValue + 1},${grayValue})`;
          drawingContext.globalAlpha =
            (0.2 + 0.78 * Math.pow(inkAmount, 0.8)) * edgeOpacity;
          if (
            highlightIntensity > 0.45 &&
            lightIntensity > 0.91 &&
            antherSampleCount === 0
          ) {
            drawingContext.fillStyle = "#ffffff";
            drawingContext.globalAlpha = edgeOpacity * 0.94;
            character = "1";
          }
          drawingContext.fillText(character, canvasX, canvasY);
          if (isPointerActive && !isKeyboardPointer) {
            const pointerDistance = Math.hypot(
              canvasX - pointerState.x,
              canvasY - pointerState.y,
            );
            if (pointerDistance < brushRadius) {
              characterHeat[characterIndex] = Math.max(
                characterHeat[characterIndex],
                Math.pow(1 - pointerDistance / brushRadius, 0.48),
              );
            }
          }
        }
        const tileIndex =
          Math.floor(characterColumn / 2) +
          Math.floor(characterRow / 2) * tileColumnCount;
        tileHeat[tileIndex] = Math.max(
          tileHeat[tileIndex],
          characterHeat[characterIndex],
        );
      }
    }
    const tileWidth = characterCellWidth * 2;
    const tileHeight = characterCellHeight * 2;
    drawingContext.font = `${tileHeight * 0.82}px "Courier New", monospace`;
    for (let tileIndex = 0; tileIndex < tileHeat.length; tileIndex++) {
      const tileHeatAmount = tileHeat[tileIndex];
      if (
        tileHeatAmount < 0.16 ||
        deterministicNoise(tileIndex * 5.9 + accentTick * 3.7) >
          0.32 + tileHeatAmount * 0.64
      ) {
        continue;
      }
      const tileX = (tileIndex % tileColumnCount) * tileWidth;
      const tileY = Math.floor(tileIndex / tileColumnCount) * tileHeight;
      drawingContext.globalAlpha = Math.min(0.92, tileHeatAmount);
      drawingContext.fillStyle =
        accentPalette[
          Math.floor(
            deterministicNoise(tileIndex + accentTick * 9.7) *
              accentPalette.length,
          )
        ];
      drawingContext.fillRect(
        tileX + 0.6,
        tileY + 0.6,
        tileWidth - 1.2,
        tileHeight - 1.2,
      );
      drawingContext.globalAlpha = Math.min(0.88, tileHeatAmount * 0.92);
      drawingContext.fillStyle = "#293627";
      drawingContext.fillText(
        accentCharacters[
          Math.floor(
            deterministicNoise(tileIndex * 17 + accentTick * 4.1) *
              accentCharacters.length,
          )
        ],
        tileX + tileWidth / 2,
        tileY + tileHeight / 2,
      );
    }
    drawingContext.globalAlpha = 1;
  }
  resizeFlowerCanvas();
  let savedLanguageCode = "en";
  try {
    if (sessionStorage.getItem("portfolio-language") === "zh")
      savedLanguageCode = "zh";
  } catch {
    /** A direct visit defaults to English when browser storage is unavailable. */
  }
  setPortfolioLanguage(savedLanguageCode);
  restorePortfolioLocation();
  window.addEventListener("hashchange", restorePortfolioLocation);
  window.addEventListener("popstate", restorePortfolioLocation);
  /**
   * Pause media and discard stale input when the document leaves the foreground.
   * @returns {void}
   */
  function suspendPage() {
    previousFrameMilliseconds = null;
    workGallery.pauseMedia();
    resetLotusPointer();
    cancelNavigationHover();
    navigationHoverState.pointerSection = null;
  }
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
      suspendPage();
    } else {
      previousFrameMilliseconds = null;
      requestFlowerResize();
    }
  });
  window.addEventListener("pagehide", suspendPage);
  window.addEventListener("pageshow", (event) => {
    previousFrameMilliseconds = null;
    requestFlowerResize();
    dragonflyRenderer.resize();
    if (!event.persisted) return;
    try {
      sessionStorage.removeItem("portfolio-reading-return");
    } catch {
      /** Browser-restored pages already preserve their current reading position. */
    }
    restorePortfolioLocation();
  });
  requestAnimationFrame(drawFrame);
}
