/**
 * Clamp a scalar to the requested interval.
 * @param {number} value - Value to constrain.
 * @param {number} [minimumValue=0] - Lower bound.
 * @param {number} [maximumValue=1] - Upper bound.
 * @returns {number} The constrained value.
 */
export const clampRange = (value, minimumValue = 0, maximumValue = 1) =>
  Math.max(minimumValue, Math.min(maximumValue, value));

/**
 * Ease a normalized transition with zero endpoint velocity.
 * @param {number} value - Transition progress.
 * @returns {number} Eased progress between zero and one.
 */
export const smoothStep = (value) => {
  value = clampRange(value);
  return value * value * (3 - 2 * value);
};

/**
 * Ease a normalized transition with zero endpoint velocity and acceleration.
 * @param {number} value - Transition progress.
 * @returns {number} Eased progress between zero and one.
 */
export const smootherStep = (value) => {
  value = clampRange(value);
  return value * value * value * (value * (value * 6 - 15) + 10);
};

/**
 * Produce a stable pseudo-random fraction for a character or tile.
 * @param {number} seed - Sample seed.
 * @returns {number} A repeatable fraction between zero and one.
 */
export const deterministicNoise = (seed) => {
  const sampleValue = Math.sin(seed * 12.9898 + 7.177) * 43758.5453;
  return sampleValue - Math.floor(sampleValue);
};

/**
 * Advance one critically damped spring stored on a state object, preserving
 * interrupted motion. Positions and velocities that settle at zero snap to zero.
 * @param {Object} springState - Object holding the position and velocity.
 * @param {string} positionProperty - Position property to update.
 * @param {string} velocityProperty - Corresponding velocity property.
 * @param {number} targetValue - Desired spring position.
 * @param {number} springRate - Response rate per second.
 * @param {number} deltaSeconds - Time since the previous frame.
 * @returns {void}
 */
export function relaxSpring(
  springState,
  positionProperty,
  velocityProperty,
  targetValue,
  springRate,
  deltaSeconds,
) {
  const displacement = springState[positionProperty] - targetValue;
  const decayFactor = Math.exp(-springRate * deltaSeconds);
  const velocityStep =
    (springState[velocityProperty] + springRate * displacement) * deltaSeconds;
  springState[positionProperty] =
    targetValue + (displacement + velocityStep) * decayFactor;
  springState[velocityProperty] =
    (springState[velocityProperty] - springRate * velocityStep) * decayFactor;
  if (
    targetValue === 0 &&
    Math.abs(springState[positionProperty]) +
      Math.abs(springState[velocityProperty]) <
      0.0001
  ) {
    springState[positionProperty] = 0;
    springState[velocityProperty] = 0;
  }
}

/**
 * Build a single gesture from its rise, hold, and fall durations.
 * @param {number} elapsedSeconds - Time since the gesture started.
 * @param {number} riseDuration - Time to reach the peak.
 * @param {number} holdDuration - Time at the peak.
 * @param {number} fallDuration - Time to return to rest.
 * @returns {number} Gesture strength between zero and one.
 */
export function getPulse(elapsedSeconds, riseDuration, holdDuration, fallDuration) {
  return (
    smoothStep(elapsedSeconds / riseDuration) *
    (1 - smoothStep((elapsedSeconds - riseDuration - holdDuration) / fallDuration))
  );
}
