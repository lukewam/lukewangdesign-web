import { getPulse, relaxSpring } from "./easing.js?v=2ea68460b0f0";
import { navigationHoverSettings } from "./settings.js?v=2ea68460b0f0";

/**
 * Dwell timing and restrained spring responses for the three home navigation
 * words. Pointer, keyboard focus and navigation share one active candidate.
 * @param {Object} options - Dependencies.
 * @param {HTMLElement} options.portfolioRoot - Root containing the navigation buttons.
 * @param {MediaQueryList} options.reducedMotionPreference - Reduced-motion preference.
 * @returns {Object} Hover state, input hooks, and the per-frame update.
 */
export function createNavigationHover({ portfolioRoot, reducedMotionPreference }) {
  const { dwellSeconds, workPulse, aboutPulse, springRates } = navigationHoverSettings;
  const state = {
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

  /**
   * Record the current pointer or keyboard focus candidate.
   * @param {'pointerSection'|'focusedSection'} inputProperty - Input source to update.
   * @param {'work'|'about'|'contact'|null} candidateSection - Candidate section, or null when leaving.
   * @returns {void}
   */
  function setCandidate(inputProperty, candidateSection) {
    state[inputProperty] = candidateSection;
    if (candidateSection !== state.blockedSection) {
      state.blockedSection = null;
    }
  }

  /**
   * Suppress the active navigation cue until the user chooses another target.
   * @returns {void}
   */
  function cancel() {
    state.blockedSection =
      state.pointerSection || state.focusedSection || state.activeSection;
    state.focusedSection = null;
    state.activeSection = null;
    state.elapsedSeconds = 0;
    state.isFocusSuppressed = true;
    delete portfolioRoot.dataset.hoveredSection;
  }

  portfolioRoot
    .querySelectorAll("[data-navigation-section]")
    .forEach((sectionButton) => {
      const buttonSection = sectionButton.dataset.navigationSection;
      sectionButton.addEventListener("pointerenter", (event) => {
        if (event.pointerType !== "touch") {
          state.isKeyboardNavigation = false;
          state.focusedSection = null;
          setCandidate("pointerSection", buttonSection);
        }
      });
      sectionButton.addEventListener("pointermove", (event) => {
        if (event.pointerType !== "touch" && (event.movementX || event.movementY)) {
          state.isKeyboardNavigation = false;
          state.focusedSection = null;
          setCandidate("pointerSection", buttonSection);
        }
      });
      sectionButton.addEventListener("pointerleave", () => {
        if (state.pointerSection === buttonSection) {
          setCandidate("pointerSection", null);
        }
      });
      sectionButton.addEventListener("pointercancel", () =>
        setCandidate("pointerSection", null),
      );
      sectionButton.addEventListener("focus", () => {
        if (
          !state.isFocusSuppressed &&
          (state.isKeyboardNavigation || sectionButton.matches(":focus-visible"))
        ) {
          setCandidate("focusedSection", buttonSection);
        }
      });
      sectionButton.addEventListener("blur", () => {
        if (state.focusedSection === buttonSection) {
          setCandidate("focusedSection", null);
        }
      });
    });
  portfolioRoot.addEventListener("keydown", (event) => {
    if (event.key === "Tab") {
      state.pointerSection = null;
      state.blockedSection = null;
      state.isFocusSuppressed = false;
      state.isKeyboardNavigation = true;
    }
  });

  /**
   * Apply dwell timing and the restrained hover responses.
   * @param {number} deltaSeconds - Time since the previous frame.
   * @param {Object} context - Current navigation context.
   * @param {boolean} context.isTransitioning - Whether a section transition is under way.
   * @param {string|null} context.selectedSection - The open section, if any.
   * @returns {void}
   */
  function update(deltaSeconds, { isTransitioning, selectedSection }) {
    let candidateSection = state.pointerSection || state.focusedSection;
    if (
      isTransitioning ||
      candidateSection === state.blockedSection ||
      candidateSection === selectedSection
    ) {
      candidateSection = null;
    }
    if (candidateSection !== state.activeSection) {
      state.activeSection = candidateSection;
      state.elapsedSeconds = 0;
      if (candidateSection) {
        portfolioRoot.dataset.hoveredSection = candidateSection;
      } else {
        delete portfolioRoot.dataset.hoveredSection;
      }
    }
    if (candidateSection) {
      state.elapsedSeconds += deltaSeconds;
    }
    const dwell =
      state.elapsedSeconds -
      (candidateSection === "contact" ? dwellSeconds.contact : dwellSeconds.default);
    const isDwellReady = Boolean(candidateSection) && dwell >= 0;
    const workAttention =
      isDwellReady && candidateSection === "work"
        ? getPulse(dwell, workPulse.rise, workPulse.hold, workPulse.fall)
        : 0;
    const aboutAttention =
      isDwellReady && candidateSection === "about"
        ? getPulse(dwell, aboutPulse.rise, aboutPulse.hold, aboutPulse.fall)
        : 0;
    const contactAttention = isDwellReady && candidateSection === "contact" ? 1 : 0;
    if (reducedMotionPreference.matches) {
      state.work = state.workVelocity = state.about = state.aboutVelocity = 0;
      state.contact = contactAttention;
      state.contactVelocity = 0;
    } else {
      relaxSpring(
        state,
        "work",
        "workVelocity",
        workAttention,
        workAttention ? springRates.work.attend : springRates.work.release,
        deltaSeconds,
      );
      relaxSpring(
        state,
        "about",
        "aboutVelocity",
        aboutAttention,
        aboutAttention ? springRates.about.attend : springRates.about.release,
        deltaSeconds,
      );
      relaxSpring(
        state,
        "contact",
        "contactVelocity",
        contactAttention,
        contactAttention ? springRates.contact.attend : springRates.contact.release,
        deltaSeconds,
      );
    }
    const contactOpacityValue = state.contact.toFixed(4);
    if (contactOpacityValue !== state.contactOpacityValue) {
      portfolioRoot.style.setProperty("--hover-contact", contactOpacityValue);
      state.contactOpacityValue = contactOpacityValue;
    }
  }

  return {
    state,
    cancel,
    update,
    /** Forget a pointer candidate after the page loses the pointer entirely. */
    clearPointer: () => {
      state.pointerSection = null;
    },
  };
}
