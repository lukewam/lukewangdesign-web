import { clampRange, relaxSpring, smoothStep, smootherStep } from "./easing.js?v=5321f604b4ae";
import { bloomSettings, sectionTransitionSettings } from "./settings.js?v=5321f604b4ae";

/**
 * Evaluate the bloom loop, including its closed and open holds.
 * @param {number} loopSeconds - Elapsed time in the repeating bloom cycle.
 * @returns {number} Bloom progress between zero and one.
 */
export function getBloomProgress(loopSeconds) {
  const { loopSeconds: loopLength, closedHoldSeconds, openingSeconds, openHoldEndSeconds, closingEndSeconds } =
    bloomSettings;
  loopSeconds %= loopLength;
  if (loopSeconds < closedHoldSeconds) {
    return 0;
  }
  if (loopSeconds < closedHoldSeconds + openingSeconds) {
    return smoothStep((loopSeconds - closedHoldSeconds) / openingSeconds);
  }
  if (loopSeconds < openHoldEndSeconds) {
    return 1;
  }
  if (loopSeconds < closingEndSeconds) {
    return 1 - smoothStep((loopSeconds - openHoldEndSeconds) / openingSeconds);
  }
  return 0;
}

/**
 * @typedef {Object} BloomClock
 * @property {boolean} isPlaying - Whether the idle bloom loop advances.
 * @property {number} loopSeconds - Position in the bloom loop.
 * @property {number} pausedProgress - Bloom progress held while paused.
 */

/**
 * Track the flower's movement aside, the panel reveal, and the petal springs
 * while a section opens or closes. The controller owns the DOM; this state
 * machine only advances numbers.
 * @param {Object} options - Dependencies.
 * @param {MediaQueryList} options.reducedMotionPreference - Reduced-motion preference.
 * @param {BloomClock} options.bloomClock - Shared idle bloom clock.
 * @param {() => void} [options.onReturnHome] - Called when a return home completes.
 * @returns {Object} The transition state and its operations.
 */
export function createSectionTransition({
  reducedMotionPreference,
  bloomClock,
  onReturnHome,
}) {
  const { closing, opening, cueDelaySeconds, anticipation, petal, settledSeconds } =
    sectionTransitionSettings;
  const state = {
    asideAmount: 0,
    slideProgress: 0,
    startAsideAmount: 0,
    startSlideProgress: 0,
    targetAmount: 0,
    elapsedSeconds: settledSeconds,
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

  /** Bloom progress of the flower while it rests at home. */
  function getIdleBloomProgress() {
    return bloomClock.isPlaying
      ? getBloomProgress(bloomClock.loopSeconds)
      : bloomClock.pausedProgress;
  }

  /**
   * Finish the return at the full-open hold while preserving pause or play.
   * @returns {void}
   */
  function finishReturn() {
    onReturnHome?.();
    state.asideAmount = 0;
    state.slideProgress = 0;
    state.revealProgress = 0;
    state.bloomProgress = 1;
    state.startBloomProgress = 1;
    state.isClosing = false;
    /** Resume from the beginning of the full-open hold, respecting pause/play. */
    bloomClock.loopSeconds = bloomSettings.openHoldStartSeconds;
    bloomClock.pausedProgress = 1;
  }

  /**
   * Settle restored or reduced-motion navigation so later preference changes
   * cannot resume an old entrance.
   * @returns {void}
   */
  function settle() {
    const targetAmount = state.targetAmount;
    if (targetAmount === 0 && state.isClosing) {
      finishReturn();
    }
    state.startAsideAmount = state.asideAmount = targetAmount;
    state.startSlideProgress = state.slideProgress = targetAmount;
    state.startRevealProgress = state.revealProgress = targetAmount;
    state.startBloomProgress = state.bloomProgress =
      targetAmount === 1 ? 1 : getIdleBloomProgress();
    state.elapsedSeconds = settledSeconds;
    state.isClosing = false;
    state.petalFold = state.petalFoldVelocity = 0;
    state.petalSway = state.petalSwayVelocity = 0;
    state.petalTurn = state.petalTurnVelocity = 0;
  }

  /**
   * Start moving the flower aside for a section; a section switch keeps the current pose.
   * @param {'work'|'about'|'contact'} nextSection - Section to present.
   * @returns {void}
   */
  function beginOpen(nextSection) {
    if (state.targetAmount !== 0) return;
    state.startAsideAmount = state.asideAmount;
    state.startSlideProgress = state.slideProgress;
    state.startBloomProgress = state.bloomProgress;
    state.targetAmount = 1;
    state.elapsedSeconds = 0;
    state.isClosing = false;
    state.startRevealProgress = state.revealProgress;
    state.cueDelaySeconds = cueDelaySeconds[nextSection] ?? 0;
  }

  /**
   * Start the return home from the current pose.
   * @returns {void}
   */
  function beginClose() {
    state.startAsideAmount = state.asideAmount;
    state.startSlideProgress = state.slideProgress;
    state.startBloomProgress = state.bloomProgress;
    state.targetAmount = 0;
    state.elapsedSeconds = 0;
    state.isClosing = true;
    state.startRevealProgress = state.revealProgress;
  }

  /**
   * Advance flower displacement, panel reveal, and the petal spring responses.
   * @param {number} sceneDeltaSeconds - Capped step for continuous spring motion.
   * @param {number} [transitionDeltaSeconds=sceneDeltaSeconds] - Visible elapsed time for finite durations.
   * @returns {void}
   */
  function update(sceneDeltaSeconds, transitionDeltaSeconds = sceneDeltaSeconds) {
    const previousSlideProgress = state.slideProgress;
    state.elapsedSeconds += transitionDeltaSeconds;
    const transitionSeconds = state.elapsedSeconds;
    if (!reducedMotionPreference.matches) {
      if (state.isClosing) {
        state.asideAmount =
          state.startAsideAmount * (1 - smoothStep(transitionSeconds / closing.asideSeconds));
        state.slideProgress =
          state.startSlideProgress *
          (1 - smootherStep(transitionSeconds / closing.slideSeconds));
        state.bloomProgress =
          state.startBloomProgress +
          (1 - state.startBloomProgress) *
            smootherStep(transitionSeconds / closing.slideSeconds);
        state.revealProgress =
          state.startRevealProgress *
          (1 - smoothStep(transitionSeconds / closing.revealSeconds));
        if (transitionSeconds >= closing.slideSeconds) {
          finishReturn();
        }
      } else if (state.targetAmount === 1) {
        const cueSeconds = transitionSeconds - state.cueDelaySeconds;
        state.asideAmount =
          state.startAsideAmount +
          (1 - state.startAsideAmount) *
            smoothStep((cueSeconds - opening.asideDelaySeconds) / opening.asideSeconds);
        state.slideProgress =
          state.startSlideProgress +
          (1 - state.startSlideProgress) *
            smootherStep(
              (transitionSeconds - opening.slideDelaySeconds) / opening.slideSeconds,
            );
        state.bloomProgress =
          state.startBloomProgress +
          (1 - state.startBloomProgress) *
            smootherStep(transitionSeconds / opening.bloomSeconds);
        state.revealProgress = 1;
      } else {
        state.bloomProgress = getIdleBloomProgress();
      }
    } else {
      state.asideAmount = state.targetAmount;
      state.slideProgress = state.targetAmount;
      state.revealProgress = state.targetAmount;
      if (state.isClosing) {
        finishReturn();
      }
      state.bloomProgress = state.targetAmount === 1 ? 1 : getIdleBloomProgress();
    }
    if (reducedMotionPreference.matches) {
      state.petalFold = state.petalFoldVelocity = state.petalSway = state.petalSwayVelocity = 0;
      state.petalTurn = state.petalTurnVelocity = 0;
      return;
    }
    /**
     * Petals respond to the acceleration and settling of the intact flower.
     * Continuous spring state keeps interrupted moves free of pose jumps.
     */
    const slideVelocity =
      (state.slideProgress - previousSlideProgress) / Math.max(0.001, transitionDeltaSeconds);
    const movementDirection = state.isClosing ? -1 : state.targetAmount === 1 ? 1 : 0;
    const isPreparing =
      movementDirection && Math.abs(state.targetAmount - state.slideProgress) > 0.001;
    const anticipationAmount = isPreparing
      ? smoothStep(transitionSeconds / anticipation.riseSeconds) *
        (1 -
          smoothStep(
            (transitionSeconds - anticipation.fallDelaySeconds) / anticipation.fallSeconds,
          ))
      : 0;
    relaxSpring(
      state,
      "petalFold",
      "petalFoldVelocity",
      clampRange(
        Math.abs(slideVelocity) * petal.foldVelocityGain +
          anticipationAmount * petal.foldAnticipationGain,
      ),
      petal.foldRate,
      sceneDeltaSeconds,
    );
    relaxSpring(
      state,
      "petalSway",
      "petalSwayVelocity",
      clampRange(
        -slideVelocity * petal.swayVelocityGain -
          movementDirection * anticipationAmount * petal.swayAnticipationGain,
        -1,
        1,
      ),
      petal.swayRate,
      sceneDeltaSeconds,
    );
    /** A slower axial turn trails the petal response, then settles to neutral. */
    relaxSpring(
      state,
      "petalTurn",
      "petalTurnVelocity",
      clampRange(
        slideVelocity * petal.turnVelocityGain +
          movementDirection * anticipationAmount * petal.turnAnticipationGain,
        -1,
        1,
      ),
      petal.turnRate,
      sceneDeltaSeconds,
    );
  }

  return {
    state,
    getIdleBloomProgress,
    settle,
    beginOpen,
    beginClose,
    update,
    /** True while a section is arriving or the flower is returning home. */
    isTransitioning: () =>
      state.isClosing ||
      (state.targetAmount === 1 &&
        state.elapsedSeconds < sectionTransitionSettings.hoverLockSeconds),
    /** True while the flower controls should be unavailable. */
    isFlowerBusy: () =>
      state.targetAmount === 1 || state.isClosing || state.slideProgress > 0.001,
    /** True while the flower rests at home with no movement under way. */
    isResting: () =>
      state.targetAmount === 0 && !state.isClosing && state.slideProgress < 0.001,
  };
}
