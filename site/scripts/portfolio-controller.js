import { createWorkGallery } from "./work-gallery.js?v=34242333640d";
import { translations } from "./translations.js?v=34242333640d";
import { createPortfolioRouter } from "./portfolio-routes.js?v=34242333640d";
import {
  createSectionTransition,
  getBloomProgress,
} from "./motion/section-transition.js?v=34242333640d";
import { createNavigationHover } from "./motion/navigation-hover.js?v=34242333640d";
import { createLotusPainter } from "./scene/lotus-ascii-painter.js?v=34242333640d";
import {
  bloomSettings,
  lotusSceneSettings,
  sectionTransitionSettings,
} from "./motion/settings.js?v=34242333640d";

/**
 * Connect the portfolio navigation, translations, and animated canvas renderers.
 * Routing, the section transition, navigation hover cues, and ASCII painting
 * each live in their own module; this controller owns the DOM and the frame loop.
 * @param {HTMLElement} portfolioRoot - Root containing the portfolio controls and sections.
 * @param {Object|null} lotusRenderer - Loaded lotus renderer, or null when graphics are unavailable.
 * @param {Object} dragonflyRenderer - Dragonfly controller with draw, resize, launch, and returnHome methods.
 * @param {Object} portfolioData - Content supplied to the work gallery.
 * @param {Object} [mediaManifest={}] - Size variants of the project images, keyed by original path.
 * @returns {void}
 */
export function initializePortfolio(
  portfolioRoot,
  lotusRenderer,
  dragonflyRenderer,
  portfolioData,
  mediaManifest = {},
) {
  const flowerCanvas = portfolioRoot.querySelector(".lotus-interaction canvas");
  const flowerSurface = portfolioRoot.querySelector(".lotus-interaction");
  const sectionPanel = portfolioRoot.querySelector(".content-panel");
  const panelContent = sectionPanel.querySelector(".panel-content");
  const replayButton = portfolioRoot.querySelector(".restart-bloom-button");
  const reducedMotionPreference = window.matchMedia(
    "(prefers-reduced-motion: reduce)",
  );
  /** The idle bloom loop, shared with the transition so a return home resumes cleanly. */
  const bloomClock = {
    isPlaying: !reducedMotionPreference.matches,
    loopSeconds: bloomSettings.initialLoopSeconds,
    pausedProgress: reducedMotionPreference.matches ? 1 : 0,
  };
  const dragonflyPointer = { clientX: 0, clientY: 0, isActive: false };
  let isVisible = true;
  let previousFrameMilliseconds = null;
  let motionSeconds = 0;
  let currentLanguage = "en";
  let selectedSection = null;
  let panelEnterAnimation = null;

  const painter = createLotusPainter({
    flowerCanvas,
    flowerSurface,
    portfolioRoot,
    reducedMotionPreference,
  });
  const transition = createSectionTransition({
    reducedMotionPreference,
    bloomClock,
    onReturnHome: () => painter.resetPointer(),
  });
  const navigationHover = createNavigationHover({
    portfolioRoot,
    reducedMotionPreference,
  });
  const router = createPortfolioRouter({
    getRoute: () => ({
      section: selectedSection,
      project:
        selectedSection === "work" ? workGallery.currentProject() || null : null,
    }),
    applyRoute,
  });
  const workGallery = createWorkGallery(
    portfolioRoot,
    sectionPanel,
    portfolioData,
    {
      mediaManifest,
      language: () => currentLanguage,
      shouldAnimate: () => !router.isRestoring(),
      onChange: (hasProjectDetail) => {
        if (selectedSection !== "work") return;
        panelEnterAnimation?.cancel();
        panelEnterAnimation = null;
        dragonflyRenderer.launch(
          "work",
          reducedMotionPreference.matches ||
            router.isRestoring() ||
            !hasProjectDetail,
        );
        router.synchronize();
        updateDocumentTitle();
      },
    },
  );
  if (typeof IntersectionObserver !== "undefined") {
    new IntersectionObserver((visibilityEntries) => {
      isVisible = visibilityEntries[0].isIntersecting;
      previousFrameMilliseconds = null;
    }).observe(portfolioRoot);
  }

  /**
   * Show a restored route: a section, a project inside Work, or home for null.
   * @param {{section: string, project: string|null}|null} route - Parsed route.
   * @returns {void}
   */
  function applyRoute(route) {
    if (!route) {
      closeSection();
    } else {
      const { section, project } = route;
      if (
        selectedSection !== section ||
        transition.state.targetAmount === 0
      ) {
        openSection(section);
      }
      if (section === "work") {
        if (project) {
          if (workGallery.currentProject() !== project) {
            workGallery.open(project);
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
          section === "work" &&
          project &&
          workGallery.currentProject() === project &&
          readingReturn?.projectId === project
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
    settleTransition();
    updateSectionTransition(0);
  }

  /**
   * Settle restored or reduced-motion navigation and match the panel to the settled state.
   * @returns {void}
   */
  function settleTransition() {
    transition.settle();
    const isHome = transition.state.targetAmount === 0;
    sectionPanel.hidden = isHome;
    sectionPanel.inert = isHome;
  }

  /**
   * Open a section and coordinate its content, flower movement, and dragonfly flight.
   * @param {'work'|'about'|'contact'} nextSection - Section to present.
   * @returns {void}
   */
  function openSection(nextSection) {
    if (
      selectedSection === nextSection &&
      transition.state.targetAmount === 1
    ) {
      if (nextSection === "work" && workGallery.hasDetail()) {
        workGallery.back();
      }
      return;
    }
    const isEnteringFromHome = transition.state.targetAmount === 0;
    resetDragonflyPointer();
    workGallery.reset();
    panelEnterAnimation?.cancel();
    panelEnterAnimation = null;
    navigationHover.cancel();
    painter.resetPointer();
    transition.beginOpen(nextSection);
    selectedSection = nextSection;
    painter.releasePointer();
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
    transition.state.revealProgress = 1;
    updateSectionTransition(0);
    if (!reducedMotionPreference.matches && !router.isRestoring()) {
      const { panelEnter } = sectionTransitionSettings;
      panelEnterAnimation = panelContent.animate?.(
        isEnteringFromHome
          ? [
              {
                opacity: 0.3,
                transform: `translateY(${panelEnter.fromHomeOffsetPixels}px)`,
              },
              { opacity: 1, transform: "translateY(0)" },
            ]
          : [{ opacity: 0.4 }, { opacity: 1 }],
        {
          duration: isEnteringFromHome
            ? panelEnter.fromHomeMilliseconds
            : panelEnter.betweenSectionsMilliseconds,
          easing: panelEnter.easing,
        },
      );
    }
    dragonflyRenderer.launch(
      nextSection,
      reducedMotionPreference.matches || router.isRestoring(),
    );
    updateNavigationHover(0);
    portfolioRoot.querySelector(".panel-close-button").focus({
      preventScroll: true,
    });
    if (reducedMotionPreference.matches) {
      settleTransition();
      updateSectionTransition(0);
    }
    router.synchronize();
    updateDocumentTitle();
  }

  /**
   * Close the content panel and restore navigation focus for keyboard activation.
   * @param {Event|undefined} event - Activation event used to decide whether focus returns.
   * @returns {void}
   */
  function closeSection(event) {
    resetDragonflyPointer();
    panelEnterAnimation?.cancel();
    panelEnterAnimation = null;
    if (transition.state.targetAmount === 0) {
      return;
    }
    workGallery.pauseMedia();
    navigationHover.cancel();
    painter.resetPointer();
    transition.beginClose();
    dragonflyRenderer.returnHome(
      reducedMotionPreference.matches || router.isRestoring(),
      0,
    );
    const wasFocusInsidePanel = sectionPanel.contains(document.activeElement);
    sectionPanel.inert = true;
    const previousSection = selectedSection;
    selectedSection = null;
    delete portfolioRoot.dataset.activeSection;
    router.synchronize();
    updateDocumentTitle();
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
      settleTransition();
      updateSectionTransition(0);
    }
    updateNavigationHover(0);
  }

  /**
   * Advance the transition, then apply its panel reveal, flower displacement, and flight.
   * @param {number} sceneDeltaSeconds - Capped step for continuous spring and input motion.
   * @param {number} [transitionDeltaSeconds=sceneDeltaSeconds] - Visible elapsed time for panel and flight durations.
   * @returns {void}
   */
  function updateSectionTransition(
    sceneDeltaSeconds,
    transitionDeltaSeconds = sceneDeltaSeconds,
  ) {
    transition.update(sceneDeltaSeconds, transitionDeltaSeconds);
    const { state } = transition;
    if (state.targetAmount === 0 && state.revealProgress < 0.001) {
      sectionPanel.hidden = true;
    }
    panelContent.style.opacity = String(state.revealProgress);
    panelContent.style.transform = `translateY(${(1 - state.revealProgress) * sectionTransitionSettings.panelRevealOffsetPixels}px)`;
    portfolioRoot.style.setProperty(
      "--section-transition-progress",
      String(state.asideAmount),
    );
    updateNavigationHover(sceneDeltaSeconds);
    dragonflyRenderer.draw(
      motionSeconds,
      sceneDeltaSeconds,
      reducedMotionPreference.matches,
      navigationHover.state.work,
      transitionDeltaSeconds,
      dragonflyPointer,
    );
  }

  /**
   * Advance the navigation cues and keep the flower controls unavailable while it moves.
   * @param {number} deltaSeconds - Time since the previous frame.
   * @returns {void}
   */
  function updateNavigationHover(deltaSeconds) {
    navigationHover.update(deltaSeconds, {
      isTransitioning: transition.isTransitioning(),
      selectedSection,
    });
    const isFlowerBusy = transition.isFlowerBusy();
    if (flowerSurface.disabled !== isFlowerBusy) {
      flowerSurface.disabled = isFlowerBusy;
      flowerSurface.inert = isFlowerBusy;
      replayButton.disabled = isFlowerBusy;
      portfolioRoot.toggleAttribute("data-lotus-busy", isFlowerBusy);
    }
  }

  /**
   * Name the browser tab after the visible section or project.
   * @returns {void}
   */
  function updateDocumentTitle() {
    const copy = translations[currentLanguage];
    let pageTitle = copy.siteTitle;
    if (selectedSection === "work" && workGallery.currentProject()) {
      pageTitle = `${workGallery.currentTitle?.() || copy.work} · Luke Wang`;
    } else if (selectedSection) {
      pageTitle = `${copy[selectedSection]} · Luke Wang`;
    }
    if (document.title !== pageTitle) {
      document.title = pageTitle;
    }
  }

  /**
   * Update visible copy and accessible labels without disturbing the current section.
   * @param {'en'|'zh'} languageCode - Language to display.
   * @returns {void}
   */
  function setPortfolioLanguage(languageCode) {
    resetDragonflyPointer();
    currentLanguage = languageCode;
    const copy = translations[languageCode];
    try {
      sessionStorage.setItem("portfolio-language", languageCode);
    } catch {
      /** Language switching remains available when browser storage is disabled. */
    }
    portfolioRoot.lang = languageCode === "zh" ? "zh-CN" : "en";
    portfolioRoot
      .querySelector(".site-home-link")
      ?.setAttribute("aria-label", copy.homeLabel);
    portfolioRoot
      .querySelector(".main-navigation")
      .setAttribute("aria-label", copy.navigationLabel);
    portfolioRoot
      .querySelector(".language-switcher")
      .setAttribute("aria-label", copy.languageLabel);
    sectionPanel.setAttribute("aria-label", copy.contentLabel);
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
        sectionButton.textContent = copy[sectionButton.dataset.navigationSection];
      });
    portfolioRoot.querySelector(".site-message").textContent =
      painter.hasDrawingContext() ? copy.hint : copy.flowerUnavailable;
    replayButton.textContent = copy.replay;
    const returnButton = portfolioRoot.querySelector(".panel-close-button");
    returnButton.textContent = copy.close;
    returnButton.setAttribute("aria-label", copy.close);
    flowerSurface.setAttribute(
      "aria-label",
      copy[bloomClock.isPlaying ? "pause" : "play"],
    );
    flowerSurface.setAttribute("aria-pressed", String(!bloomClock.isPlaying));
    flowerCanvas.setAttribute("aria-label", copy.image);
    flowerCanvas.textContent = copy.image;
    if (selectedSection) {
      const panelHeading = sectionPanel.querySelector("h2");
      panelHeading.lang = portfolioRoot.lang;
      panelHeading.textContent =
        selectedSection === "work" ? copy.selectedWork : copy[selectedSection];
      const isAboutSection = selectedSection === "about";
      const isWorkSection = selectedSection === "work";
      const isContactSection = selectedSection === "contact";
      sectionPanel.querySelector(".about-section").hidden = !isAboutSection;
      sectionPanel.querySelector(".work-section").hidden = !isWorkSection;
      sectionPanel.querySelector(".contact-details").hidden = !isContactSection;
      const contactNote = sectionPanel.querySelector(".contact-note");
      contactNote.hidden = !isContactSection;
      contactNote.textContent = copy.contactNote;
      sectionPanel.querySelector(
        '[data-contact-label="emailLabel"]',
      ).textContent = copy.emailLabel;
      sectionPanel
        .querySelector(".contact-profile")
        .setAttribute("aria-label", copy.linkedinLabel);
      sectionPanel
        .querySelector(".work-grid")
        .setAttribute("aria-label", copy.projectsLabel);
      if (isAboutSection) {
        /** Each slot shows one block; unused slots stay hidden for languages with fewer blocks. */
        sectionPanel
          .querySelectorAll("[data-about-copy]")
          .forEach((aboutParagraph) => {
            const aboutBlock = copy.aboutBlocks[Number(aboutParagraph.dataset.aboutCopy)];
            aboutParagraph.textContent = aboutBlock?.text ?? "";
            aboutParagraph.setAttribute("data-kind", aboutBlock?.kind ?? "body");
            aboutParagraph.hidden = !aboutBlock;
          });
        sectionPanel.querySelector(".self-portrait img").alt = copy.portraitAlt;
      }
    }
    workGallery.render(languageCode, selectedSection === "work");
    document.documentElement.lang = languageCode === "zh" ? "zh-CN" : "en";
    updateDocumentTitle();
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
  portfolioRoot
    .querySelector(".site-home-link")
    ?.addEventListener("click", (event) => {
      if (
        event.metaKey ||
        event.ctrlKey ||
        event.shiftKey ||
        event.altKey ||
        event.button > 0
      )
        return;
      event.preventDefault();
      closeSection(event);
    });
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

  function resetDragonflyPointer() {
    dragonflyPointer.isActive = false;
    dragonflyRenderer.resetAttention?.();
  }
  /** Only a mouse on the resting home scene can approach the dragonfly. */
  function updateDragonflyPointer(event) {
    if (
      event.pointerType !== "mouse" ||
      selectedSection ||
      transition.state.isClosing ||
      reducedMotionPreference.matches
    ) {
      resetDragonflyPointer();
      return;
    }
    dragonflyPointer.clientX = event.clientX;
    dragonflyPointer.clientY = event.clientY;
    dragonflyPointer.isActive = true;
  }
  /**
   * Follow the pointer while the flower rests at home and the pointer is not over a control.
   * @param {PointerEvent} event - Pointer movement or touch event.
   * @returns {void}
   */
  function updateLotusPointer(event) {
    const { state } = transition;
    if (
      state.targetAmount === 1 ||
      state.isClosing ||
      state.slideProgress > 0.001 ||
      event.target.closest("button:not(.lotus-interaction)")
    ) {
      painter.releasePointer();
      return;
    }
    painter.trackPointer(event);
  }
  /** Pointer position sets yaw and pitch around one fixed flower pivot. */
  portfolioRoot.addEventListener("pointerenter", (event) => {
    painter.forgetKeyboardPointer();
    updateDragonflyPointer(event);
    updateLotusPointer(event);
  });
  portfolioRoot.addEventListener("pointermove", (event) => {
    painter.forgetKeyboardPointer();
    updateDragonflyPointer(event);
    updateLotusPointer(event);
  });
  portfolioRoot.addEventListener("pointerleave", () => {
    painter.releasePointer();
    dragonflyPointer.isActive = false;
  });
  portfolioRoot.addEventListener(
    "pointerdown",
    (event) => {
      if (event.pointerType === "touch") {
        resetDragonflyPointer();
        updateLotusPointer(event);
      }
    },
    {
      passive: true,
    },
  );
  portfolioRoot.addEventListener("pointerup", (event) => {
    if (event.pointerType === "touch") {
      window.setTimeout(
        () => painter.releasePointer(),
        lotusSceneSettings.pointer.touchReleaseMilliseconds,
      );
    }
  });
  portfolioRoot.addEventListener("pointercancel", () => {
    painter.releasePointer();
    dragonflyPointer.isActive = false;
  });
  window.addEventListener("blur", resetDragonflyPointer);
  flowerSurface.addEventListener("blur", () => {
    painter.releasePointer();
    painter.forgetKeyboardPointer();
  });
  flowerSurface.addEventListener("keydown", (event) => {
    if (painter.nudgePointer(event)) {
      event.preventDefault();
    }
  });
  flowerSurface.addEventListener("click", () => {
    bloomClock.pausedProgress = bloomClock.isPlaying
      ? getBloomProgress(bloomClock.loopSeconds)
      : bloomClock.pausedProgress;
    bloomClock.isPlaying = !bloomClock.isPlaying;
    setPortfolioLanguage(currentLanguage);
  });
  replayButton.addEventListener("click", () => {
    bloomClock.loopSeconds = 0;
    bloomClock.pausedProgress = 0;
    bloomClock.isPlaying = true;
    setPortfolioLanguage(currentLanguage);
  });
  reducedMotionPreference.addEventListener("change", () => {
    panelEnterAnimation?.cancel();
    panelEnterAnimation = null;
    bloomClock.isPlaying = !reducedMotionPreference.matches;
    bloomClock.pausedProgress = 1;
    if (reducedMotionPreference.matches) {
      painter.resetPointer();
      resetDragonflyPointer();
      settleTransition();
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
   * Render one frame and schedule the next, preserving pauses and visibility state.
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
    const sceneDeltaSeconds = Math.min(
      lotusSceneSettings.maximumSceneStepSeconds,
      elapsedFrameSeconds,
    );
    previousFrameMilliseconds = frameMilliseconds;
    if (!isVisible || document.hidden) {
      return;
    }
    painter.resizeIfPending();
    const { state } = transition;
    if (bloomClock.isPlaying && state.targetAmount === 0 && !state.isClosing) {
      bloomClock.loopSeconds += sceneDeltaSeconds;
    }
    if (!reducedMotionPreference.matches) {
      motionSeconds += sceneDeltaSeconds;
    }
    updateSectionTransition(sceneDeltaSeconds, elapsedFrameSeconds);
    painter.slide(state.slideProgress);
    if (!painter.hasDrawingContext()) return;
    if (!lotusRenderer) {
      painter.paintUnavailable(translations[currentLanguage].flowerUnavailable);
      return;
    }
    const hasHoverCue = Boolean(navigationHover.state.activeSection);
    const wasRendered = painter.paint({
      lotusRenderer,
      bloomProgress: state.bloomProgress,
      travelMotion: {
        fold:
          state.petalFold *
          (state.slideProgress > 0 && state.slideProgress < 1
            ? Math.sin(Math.PI * state.slideProgress)
            : 0),
        sway: state.petalSway,
        turn: state.petalTurn,
        attention: navigationHover.state.about,
        phase: motionSeconds,
      },
      isPointerFollowing:
        sectionPanel.hidden &&
        !hasHoverCue &&
        !state.isClosing &&
        state.slideProgress < 0.001,
      isFlowerResting:
        state.targetAmount !== 1 && state.slideProgress <= 0.001 && !hasHoverCue,
      sceneDeltaSeconds,
      motionSeconds,
    });
    if (!wasRendered) {
      /** A broken renderer is retired rather than retried every frame. */
      lotusRenderer = null;
    }
  }
  painter.resize();
  let savedLanguageCode = "en";
  try {
    if (sessionStorage.getItem("portfolio-language") === "zh")
      savedLanguageCode = "zh";
  } catch {
    /** A direct visit defaults to English when browser storage is unavailable. */
  }
  setPortfolioLanguage(savedLanguageCode);
  router.restore();
  window.addEventListener("hashchange", router.restore);
  window.addEventListener("popstate", router.restore);
  /**
   * Pause media and discard stale input when the document leaves the foreground.
   * @returns {void}
   */
  function suspendPage() {
    panelEnterAnimation?.cancel();
    panelEnterAnimation = null;
    previousFrameMilliseconds = null;
    workGallery.pauseMedia();
    painter.resetPointer();
    resetDragonflyPointer();
    navigationHover.cancel();
    navigationHover.clearPointer();
  }
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
      suspendPage();
    } else {
      previousFrameMilliseconds = null;
      painter.requestResize();
    }
  });
  window.addEventListener("pagehide", suspendPage);
  window.addEventListener("pageshow", (event) => {
    previousFrameMilliseconds = null;
    painter.requestResize();
    dragonflyRenderer.resize();
    if (!event.persisted) return;
    try {
      sessionStorage.removeItem("portfolio-reading-return");
    } catch {
      /** Browser-restored pages already preserve their current reading position. */
    }
    router.restore();
  });
  requestAnimationFrame(drawFrame);
}
