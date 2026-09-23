import { createLotusRenderer } from "./scene/lotus-renderer.js?v=afdccfffcfb1";
import { createDragonflyRenderer } from "./scene/dragonfly-renderer.js?v=afdccfffcfb1";
import { initializePortfolio } from "./portfolio-controller.js?v=afdccfffcfb1";

/**
 * Load a local resource relative to this module, including on a repository subpath.
 * @param {string} relativePath Resource path relative to the scripts directory.
 * @param {'json'|'text'|'arrayBuffer'} [responseFormat='text'] Resource decoder.
 * @returns {Promise<unknown>} Decoded content, with a timeout covering its body.
 */
async function loadResource(relativePath, responseFormat = "text") {
  const requestController = new AbortController();
  const requestTimeout = setTimeout(() => requestController.abort(), 15000);
  try {
    const response = await fetch(new URL(relativePath, import.meta.url), {
      signal: requestController.signal,
    });
    if (!response.ok) {
      throw new Error(`Unable to load ${relativePath}: ${response.status}`);
    }
    return await response[responseFormat]();
  } finally {
    clearTimeout(requestTimeout);
  }
}

/** Load the flower independently so its graphics cannot prevent navigation. */
async function loadLotusRenderer() {
  try {
    const [lotusModel, vertexShader, fragmentShader] = await Promise.all([
      loadResource("../assets/models/lotus.json?v=afdccfffcfb1", "json"),
      loadResource("../assets/shaders/lotus.vert?v=afdccfffcfb1"),
      loadResource("../assets/shaders/lotus.frag?v=afdccfffcfb1"),
    ]);
    return createLotusRenderer(lotusModel, vertexShader, fragmentShader);
  } catch (error) {
    console.warn("The flower could not load.", error);
    return null;
  }
}

/**
 * Keep section controls available when the dragonfly model or canvas fails.
 * @param {HTMLElement} portfolioRoot Root containing the dragonfly canvas.
 * @returns {Promise<object>} The flight controller, or an inactive equivalent.
 */
async function loadDragonflyRenderer(portfolioRoot) {
  try {
    const modelBuffer = await loadResource(
      "../assets/models/dragonfly.bin?v=afdccfffcfb1",
      "arrayBuffer",
    );
    const modelBytes = new Uint8Array(modelBuffer);
    return createDragonflyRenderer(portfolioRoot, modelBytes);
  } catch (error) {
    console.warn("The dragonfly could not load.", error);
    return {
      draw() {},
      resize() {},
      launch() {},
      returnHome() {},
    };
  }
}

/** Load project content and optional scene assets, then connect the controls. */
async function startPortfolio() {
  const portfolioRoot = document.querySelector("#portfolio-site");
  const [portfolioData, mediaManifest, lotusRenderer, dragonflyRenderer] =
    await Promise.all([
      loadResource("../data/projects.json?v=afdccfffcfb1", "json"),
      /** Size variants are an enhancement; the original images remain available. */
      loadResource("../data/media-manifest.json?v=afdccfffcfb1", "json").catch((error) => {
        console.warn("Image size variants could not load.", error);
        return {};
      }),
      loadLotusRenderer(),
      loadDragonflyRenderer(portfolioRoot),
    ]);
  initializePortfolio(
    portfolioRoot,
    lotusRenderer,
    dragonflyRenderer,
    portfolioData,
    mediaManifest,
  );
}

/** Replace unavailable controls with a retry action and a direct contact link. */
function showLoadingError(error) {
  console.error("Portfolio could not start.", error);
  let useChineseCopy = false;
  try {
    useChineseCopy = sessionStorage.getItem("portfolio-language") === "zh";
  } catch {
    /** English remains available when browser storage is blocked. */
  }
  const portfolioRoot = document.querySelector("#portfolio-site");
  const portfolioStage = portfolioRoot.querySelector(".portfolio-stage");
  portfolioStage.hidden = true;
  portfolioRoot.querySelectorAll("canvas").forEach((canvas) => {
    canvas.hidden = true;
  });
  portfolioRoot
    .querySelectorAll("[data-language-option], .restart-bloom-button")
    .forEach((button) => {
      button.disabled = true;
    });
  portfolioRoot.querySelector(".site-message").textContent = "";
  const errorPanel = document.createElement("section");
  errorPanel.className = "load-error";
  errorPanel.lang = useChineseCopy ? "zh-CN" : "en";
  errorPanel.setAttribute("role", "alert");
  errorPanel.setAttribute("aria-labelledby", "portfolio-load-error-title");
  const errorHeading = document.createElement("h2");
  errorHeading.id = "portfolio-load-error-title";
  errorHeading.tabIndex = -1;
  errorHeading.textContent = useChineseCopy
    ? "暂时无法加载作品集。"
    : "The portfolio couldn't load.";
  const errorExplanation = document.createElement("p");
  errorExplanation.textContent = useChineseCopy
    ? "请重试，或通过邮件联系。"
    : "Please try again, or get in touch by email.";
  const errorActions = document.createElement("div");
  errorActions.className = "load-error-actions";
  const retryButton = document.createElement("button");
  retryButton.type = "button";
  retryButton.textContent = useChineseCopy ? "重试" : "Try again";
  retryButton.addEventListener("click", () => window.location.reload());
  const emailLink = document.createElement("a");
  emailLink.href = "mailto:lukewang2333@gmail.com";
  emailLink.textContent = useChineseCopy ? "邮件联系" : "Email Luke";
  errorActions.append(retryButton, emailLink);
  errorPanel.append(errorHeading, errorExplanation, errorActions);
  portfolioStage.before(errorPanel);
  errorHeading.focus();
}

startPortfolio().catch(showLoadingError);
