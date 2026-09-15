/**
 * Named timing, easing and placement constants for the home scene. Renderers
 * keep their own geometry; everything the controller tunes by hand lives here.
 */

/** The 18-second bloom loop with its closed and open holds. */
export const bloomSettings = Object.freeze({
  loopSeconds: 18,
  closedHoldSeconds: 0.5,
  openingSeconds: 4.5,
  openHoldEndSeconds: 13,
  closingEndSeconds: 17.5,
  /** Loop position of the full-open hold, used when returning home. */
  openHoldStartSeconds: 5,
  /** Loop position on first paint, part way through the first opening. */
  initialLoopSeconds: 6.7,
});

/** Opening and closing the reading panel, and the petal responses that follow. */
export const sectionTransitionSettings = Object.freeze({
  closing: Object.freeze({
    asideSeconds: 0.5,
    slideSeconds: 1.1,
    revealSeconds: 0.24,
  }),
  opening: Object.freeze({
    asideDelaySeconds: 0.64,
    asideSeconds: 0.94,
    slideDelaySeconds: 0.18,
    slideSeconds: 2.6,
    bloomSeconds: 2.78,
  }),
  /** Delay before the flower moves aside, giving each section its own cue. */
  cueDelaySeconds: Object.freeze({ work: 0, about: 0.22, contact: 0.28 }),
  anticipation: Object.freeze({
    riseSeconds: 0.18,
    fallDelaySeconds: 0.22,
    fallSeconds: 0.34,
  }),
  petal: Object.freeze({
    foldVelocityGain: 0.9,
    foldAnticipationGain: 0.55,
    foldRate: 9.5,
    swayVelocityGain: 0.85,
    swayAnticipationGain: 0.28,
    swayRate: 7,
    turnVelocityGain: 1.22,
    turnAnticipationGain: 0.12,
    turnRate: 4.6,
  }),
  /** Navigation hover cues stay quiet this long after a section opens. */
  hoverLockSeconds: 3.1,
  /** Elapsed value that marks a settled transition. */
  settledSeconds: 10,
  panelEnter: Object.freeze({
    fromHomeMilliseconds: 280,
    fromHomeOffsetPixels: 6,
    betweenSectionsMilliseconds: 180,
    easing: "cubic-bezier(.2,.65,.3,1)",
  }),
  panelRevealOffsetPixels: 8,
});

/** Dwell timing and spring rates of the navigation hover responses. */
export const navigationHoverSettings = Object.freeze({
  dwellSeconds: Object.freeze({ default: 0.18, contact: 0.25 }),
  workPulse: Object.freeze({ rise: 0.3, hold: 0.34, fall: 0.6 }),
  aboutPulse: Object.freeze({ rise: 0.48, hold: 0.3, fall: 0.9 }),
  /** Spring rates while attending and while releasing. */
  springRates: Object.freeze({
    work: Object.freeze({ attend: 14, release: 7 }),
    about: Object.freeze({ attend: 12, release: 6 }),
    contact: Object.freeze({ attend: 9, release: 6 }),
  }),
});

/** Pointer rotation, glyph heat and the paper drawing of the ASCII lotus. */
export const lotusSceneSettings = Object.freeze({
  paperColor: "#f5f3ee",
  fallbackTextColor: "#464840",
  characterRamp: ".:;i!ltfxzcO08%#MW@",
  accentCharacters: "01=+<>XYPQZ@#",
  accentPalette: Object.freeze([
    "#8cce73",
    "#e39edc",
    "#b09be2",
    "#81c4b4",
    "#d7d88a",
    "#a3cd70",
  ]),
  accentInkColor: "#293627",
  highlight: 1.6,
  contrast: 1.05,
  glyphSize: 9.3,
  cellWidthFactor: 0.6,
  cellHeightFactor: 0.89,
  maximumPixelRatio: 2,
  maximumBitmapPixels: 8000000,
  narrowCanvasScale: Object.freeze({ under350: 0.77, under500: 0.89 }),
  compositionReference: Object.freeze({ width: 1440, height: 800, maximumScale: 2 }),
  placement: Object.freeze({
    centerX: 0.51,
    centerY: 0.44,
    /**
     * On narrow screens the navigation words sit above the canvas, so the flower
     * rests lower. Petal tips reach about 1.54 model scales above the centre and
     * the stem about 1.70 below; 0.56 clears the third word on 568px to 932px tall phones.
     */
    narrowCenterY: 0.56,
    widthDivisor: 3.48,
    heightDivisor: 4.4,
  }),
  slide: Object.freeze({ mobileFraction: 0.9, desktopFraction: 0.52, mobileMaxWidth: 600 }),
  pointer: Object.freeze({
    followRate: 3.6,
    pitchGain: 0.24,
    yawGain: 0.9,
    keyboardStep: 0.18,
    keyboardCenter: Object.freeze({ x: 0.5, xSpread: 0.28, y: 0.35, ySpread: 0.25 }),
    touchReleaseMilliseconds: 700,
  }),
  heat: Object.freeze({
    decayRate: 3.0,
    brushRadiusMaximum: 66,
    brushRadiusFraction: 0.19,
    brushFalloff: 0.48,
    accentTicksPerSecond: 6,
    tileThreshold: 0.16,
  }),
  /** Frame step cap that keeps springs stable at low frame rates. */
  maximumSceneStepSeconds: 0.05,
});
