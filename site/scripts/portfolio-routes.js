/** Section and project routes live in the URL hash: #work, #work/sisyphus, #about, #contact. */
const routePattern = /^#(work|about|contact)(?:\/([a-z0-9-]+))?$/;

/**
 * Keep the URL hash and browser history in step with the visible section.
 * @param {Object} options - Route callbacks supplied by the controller.
 * @param {() => {section: string|null, project: string|null}} options.getRoute - Current section and project.
 * @param {(route: {section: string, project: string|null}|null) => void} options.applyRoute - Show a route, or home for null.
 * @returns {{synchronize: (replaceCurrentEntry?: boolean) => void, restore: () => void, isRestoring: () => boolean}} Router operations.
 */
export function createPortfolioRouter({ getRoute, applyRoute }) {
  let isRestoring = false;
  let lastHandledUrl = null;

  /**
   * Add intentional navigation to browser history, or normalize a restored route.
   * @param {boolean} [replaceCurrentEntry=false] - Replace malformed or noncanonical routes without adding a visit.
   * @returns {void}
   */
  function synchronize(replaceCurrentEntry = false) {
    if (isRestoring) return;
    const locationUrl = new URL(window.location.href);
    const { section, project } = getRoute();
    locationUrl.hash = section ? `${section}${project ? `/${project}` : ""}` : "";
    if (locationUrl.href !== window.location.href) {
      if (replaceCurrentEntry) {
        history.replaceState(history.state, "", locationUrl);
      } else {
        history.pushState(history.state, "", locationUrl);
      }
    }
    lastHandledUrl = locationUrl.href;
  }

  /**
   * Restore a linked section after loading or returning from a reading page.
   * @returns {void}
   */
  function restore() {
    /** Back/Forward may emit both popstate and hashchange for the same visit. */
    if (lastHandledUrl === window.location.href) return;
    const matchedRoute = window.location.hash.match(routePattern);
    isRestoring = true;
    try {
      applyRoute(
        matchedRoute
          ? { section: matchedRoute[1], project: matchedRoute[2] || null }
          : null,
      );
    } finally {
      isRestoring = false;
    }
    synchronize(true);
  }

  return {
    synchronize,
    restore,
    isRestoring: () => isRestoring,
  };
}
