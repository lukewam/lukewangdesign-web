import { createLotusRenderer } from "./scene/lotus-renderer.js";
import { createDragonflyRenderer } from "./scene/dragonfly-renderer.js";
import { initializePortfolio } from "./portfolio-controller.js";

/**
 * Load a local resource relative to this module, including on a repository subpath.
 * @param {string} relativePath Resource path relative to the scripts directory.
 * @returns {Promise<Response>} Successful response ready for decoding.
 */
async function loadResource(relativePath) {
  const response = await fetch(new URL(relativePath, import.meta.url));
  if (!response.ok) {
    throw new Error(`Unable to load ${relativePath}: ${response.status}`);
  }
  return response;
}

/** Load scene assets, then connect the portfolio navigation and animation loop. */
async function startPortfolio() {
  const portfolioRoot = document.querySelector("#portfolio-site");
  const [
    lotusModel,
    dragonflyModel,
    vertexShader,
    fragmentShader,
    portfolioData,
  ] = await Promise.all([
    loadResource("../assets/models/lotus.json").then((response) =>
      response.json(),
    ),
    loadResource("../assets/models/dragonfly.bin").then((response) =>
      response.arrayBuffer(),
    ),
    loadResource("../assets/shaders/lotus.vert").then((response) =>
      response.text(),
    ),
    loadResource("../assets/shaders/lotus.frag").then((response) =>
      response.text(),
    ),
    loadResource("../data/projects.json").then((response) => response.json()),
  ]);

  let lotusRenderer = null;
  try {
    lotusRenderer = createLotusRenderer(
      lotusModel,
      vertexShader,
      fragmentShader,
    );
  } catch (error) {
    portfolioRoot.querySelector(
      ".lotus-interaction canvas",
    ).dataset.graphicsError = error.message;
  }
  const dragonflyRenderer = createDragonflyRenderer(
    portfolioRoot,
    new Uint8Array(dragonflyModel),
  );
  initializePortfolio(
    portfolioRoot,
    lotusRenderer,
    dragonflyRenderer,
    portfolioData,
  );
}

startPortfolio().catch((error) => {
  console.error("Portfolio could not start.", error);
  document.querySelector(".site-message").textContent =
    "The portfolio could not load. Please refresh to try again.";
});
