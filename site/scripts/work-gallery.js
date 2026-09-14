/**
 * @typedef {string | {en?: string, zh?: string}} LocalizedText
 */

/**
 * @typedef {Object} GalleryImage
 * @property {string} src Original image URL.
 * @property {number} width Original image width in pixels.
 * @property {number} height Original image height in pixels.
 * @property {LocalizedText} caption Figure caption and alternative text.
 * @property {{x: number, y: number, width: number, height: number}} [crop] Visible area in original pixels.
 * @property {{corners: number[][], width: number, height: number}} [perspective] Original pixel corners in top-left, top-right, bottom-right, bottom-left order and the rectified dimensions.
 * @property {boolean} [small] Whether the image is supporting detail.
 */

/**
 * Map four photographed corners onto a rectangle without altering the source.
 * @param {{corners: number[][], width: number, height: number}} perspective Rectified image geometry.
 * @returns {number[]|null} Eight homography coefficients, or null for invalid geometry.
 */
function createPerspectiveMatrix(perspective) {
  const { corners, width, height } = perspective;
  if (
    !Number.isFinite(width) ||
    width <= 0 ||
    !Number.isFinite(height) ||
    height <= 0 ||
    corners?.length !== 4 ||
    !corners.every(
      (corner) => corner?.length === 2 && corner.every(Number.isFinite),
    )
  )
    return null;
  const rectangleCorners = [
    [0, 0],
    [width, 0],
    [width, height],
    [0, height],
  ];
  const equations = corners.flatMap(([sourceX, sourceY], cornerIndex) => {
    const [targetX, targetY] = rectangleCorners[cornerIndex];
    return [
      [
        sourceX,
        sourceY,
        1,
        0,
        0,
        0,
        -targetX * sourceX,
        -targetX * sourceY,
        targetX,
      ],
      [
        0,
        0,
        0,
        sourceX,
        sourceY,
        1,
        -targetY * sourceX,
        -targetY * sourceY,
        targetY,
      ],
    ];
  });
  for (let columnIndex = 0; columnIndex < 8; columnIndex++) {
    let pivotIndex = columnIndex;
    for (let rowIndex = columnIndex + 1; rowIndex < 8; rowIndex++) {
      if (
        Math.abs(equations[rowIndex][columnIndex]) >
        Math.abs(equations[pivotIndex][columnIndex])
      ) {
        pivotIndex = rowIndex;
      }
    }
    if (Math.abs(equations[pivotIndex][columnIndex]) < 1e-10) return null;
    [equations[columnIndex], equations[pivotIndex]] = [
      equations[pivotIndex],
      equations[columnIndex],
    ];
    const pivotValue = equations[columnIndex][columnIndex];
    equations[columnIndex] = equations[columnIndex].map(
      (value) => value / pivotValue,
    );
    for (let rowIndex = 0; rowIndex < 8; rowIndex++) {
      if (rowIndex === columnIndex) continue;
      const factor = equations[rowIndex][columnIndex];
      equations[rowIndex] = equations[rowIndex].map(
        (value, entryIndex) =>
          value - factor * equations[columnIndex][entryIndex],
      );
    }
  }
  const coefficients = equations.map((equation) => equation[8]);
  return coefficients.every(Number.isFinite) ? coefficients : null;
}

/**
 * Connects the illustrated work index to case studies and the painting gallery.
 *
 * @param {HTMLElement} portfolioRoot Root element carrying portfolio state.
 * @param {HTMLElement} contentPanel Scrollable portfolio panel.
 * @param {Object} portfolioData Project copy, media, and artwork metadata.
 * @param {Object} options Callbacks supplied by the portfolio controller.
 * @param {() => string} options.language Returns the selected language.
 * @param {(hasDetail: boolean) => void} options.onChange Reports detail navigation.
 * @returns {{render: (language: string, isWork: boolean) => void, reset: () => void, pauseMedia: () => void, back: () => void, open: (projectId: string) => void, currentProject: () => string|null, hasDetail: () => boolean}}
 */
export function createWorkGallery(
  portfolioRoot,
  contentPanel,
  portfolioData,
  options,
) {
  const workArea = contentPanel.querySelector(".work-section");
  const projectGrid = workArea.querySelector(".work-grid");
  const paintingsSection = workArea.querySelector(".work-paintings");
  const contentHeading = contentPanel.querySelector("h2");
  const panelToolbar = contentPanel.querySelector(".panel-toolbar");
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  contentHeading.tabIndex = -1;

  const projectDetail = createElement("article", "work-detail");
  projectDetail.hidden = true;
  workArea.append(projectDetail);

  const backToIndexButton = createElement("button", "work-back");
  backToIndexButton.type = "button";
  backToIndexButton.hidden = true;
  const chapterNavigation = createElement("div", "work-chapter-navigation");
  chapterNavigation.hidden = true;
  const chapterTrigger = createElement("button", "work-chapter-trigger");
  chapterTrigger.type = "button";
  chapterTrigger.setAttribute("aria-expanded", "false");
  chapterTrigger.setAttribute("aria-controls", "work-chapter-popover");
  const chapterTriggerLabel = createElement("span");
  const chapterChevron = createElement("span", "work-chapter-chevron");
  chapterChevron.setAttribute("aria-hidden", "true");
  chapterTrigger.append(chapterTriggerLabel, chapterChevron);
  const chapterPopover = createElement("nav", "work-chapter-popover");
  chapterPopover.id = "work-chapter-popover";
  chapterPopover.hidden = true;
  const chapterProjectLabel = createElement("p", "work-chapter-project-label");
  const chapterList = createElement("ol", "work-chapter-list");
  chapterPopover.append(chapterProjectLabel, chapterList);
  chapterNavigation.append(chapterTrigger, chapterPopover);
  panelToolbar.prepend(backToIndexButton, chapterNavigation);

  const imageDialog = createElement("dialog", "work-lightbox");
  const imageDialogToolbar = createElement("div", "work-lightbox-toolbar");
  const closeImageButton = createElement("button", "work-lightbox-close");
  closeImageButton.type = "button";
  const originalImageLink = createElement("a", "work-original-link");
  originalImageLink.target = "_blank";
  originalImageLink.rel = "noopener noreferrer";
  const enlargedImageFigure = createElement("figure", "work-lightbox-figure");
  imageDialogToolbar.append(closeImageButton, originalImageLink);
  imageDialog.append(imageDialogToolbar, enlargedImageFigure);
  portfolioRoot.append(imageDialog);

  const projectIdsByWorkIcon = {
    eye: "machinery-structuralism",
    rock: "sisyphus",
    bear: "polar-bear",
    controller: "disaster-defender",
    car: "autonomous-vehicle",
    robot: "zoo-navigator",
    multiverse: "ai-multiverse",
    brush: "oil-paintings",
  };
  const completeProjectOrder = [
    ...workArea.querySelectorAll("[data-project-icon]"),
  ].map(
    (projectButton) => projectIdsByWorkIcon[projectButton.dataset.projectIcon],
  );
  const chapterHeadings = new Map();
  const perspectiveWindows = new Map();
  const perspectiveResizeObserver = new ResizeObserver((entries) => {
    entries.forEach((entry) => {
      const perspectiveImage = perspectiveWindows.get(entry.target);
      if (!perspectiveImage || entry.contentRect.width <= 0) return;
      const { imageElement, coefficients, width } = perspectiveImage;
      const frameScale = entry.contentRect.width / width;
      const [
        horizontalX,
        horizontalY,
        horizontalOffset,
        verticalX,
        verticalY,
        verticalOffset,
        depthX,
        depthY,
      ] = coefficients;
      imageElement.style.transform = `matrix3d(${[
        horizontalX * frameScale,
        verticalX * frameScale,
        0,
        depthX,
        horizontalY * frameScale,
        verticalY * frameScale,
        0,
        depthY,
        0,
        0,
        1,
        0,
        horizontalOffset * frameScale,
        verticalOffset * frameScale,
        0,
        1,
      ].join(",")})`;
      imageElement.style.visibility = "visible";
    });
  });

  let currentProjectId = null;
  let workIndexScrollPosition = 0;
  let lastSelectedProjectButton = null;
  let lastImageButton = null;
  let activeLanguage = "en";
  let renderedProjectLanguageKey = null;

  /** Creates a plain element without interpreting project content as HTML. */
  function createElement(tagName, className = "", textContent = "") {
    const element = document.createElement(tagName);
    if (className) element.className = className;
    if (textContent) element.textContent = textContent;
    return element;
  }

  /** Falls back to English when a translation is unavailable. */
  function localizeText(content) {
    return typeof content === "string"
      ? content
      : content?.[activeLanguage] || content?.en || "";
  }

  function appendParagraph(parentElement, content, className = "") {
    const paragraph = createElement("p", className, localizeText(content));
    parentElement.append(paragraph);
    return paragraph;
  }

  /** Resolves both complete projects and the two separate index entries. */
  function findProject(projectId) {
    if (projectId === "machinery-structuralism") return portfolioData.machinery;
    if (projectId === "oil-paintings") return portfolioData.oil_paintings;
    return portfolioData.projects.find((project) => project.id === projectId);
  }

  /** Stops playback before content is replaced or the visitor leaves a case study. */
  function pauseVideos(exceptVideo = null) {
    projectDetail.querySelectorAll("video").forEach((video) => {
      if (video !== exceptVideo) video.pause();
    });
  }

  /** Closes the local contents disclosure without moving focus after an outside click. */
  function closeChapterNavigation(restoreFocus = false) {
    chapterPopover.hidden = true;
    chapterTrigger.setAttribute("aria-expanded", "false");
    if (restoreFocus) chapterTrigger.focus({ preventScroll: true });
  }

  /** Keeps the contents sheet inside the reading panel, including narrow screens. */
  function openChapterNavigation() {
    updateCurrentChapter();
    const panelBounds = contentPanel.getBoundingClientRect();
    const navigationBounds = chapterNavigation.getBoundingClientRect();
    const panelPadding = parseFloat(
      getComputedStyle(contentPanel).paddingRight,
    );
    const availableWidth = contentPanel.clientWidth - panelPadding - 8;
    const popoverWidth = Math.min(332, availableWidth);
    const minimumLeft = panelBounds.left + 4;
    const maximumLeft = minimumLeft + availableWidth - popoverWidth;
    const centeredLeft =
      navigationBounds.left + navigationBounds.width / 2 - popoverWidth / 2;
    const popoverLeft = Math.max(
      minimumLeft,
      Math.min(centeredLeft, maximumLeft),
    );
    chapterPopover.style.width = `${popoverWidth}px`;
    chapterPopover.style.left = `${popoverLeft - navigationBounds.left}px`;
    chapterPopover.style.maxHeight = `${Math.max(96, panelBounds.bottom - navigationBounds.bottom - 19)}px`;
    chapterPopover.hidden = false;
    chapterTrigger.setAttribute("aria-expanded", "true");
  }

  /** Highlights the chapter occupying the upper part of the reading panel. */
  function updateCurrentChapter() {
    const readingEdge = panelToolbar.getBoundingClientRect().bottom + 44;
    let currentChapterId = "";
    chapterHeadings.forEach((heading, chapterId) => {
      if (
        heading.closest(".work-chapter-copy").getBoundingClientRect().top <=
        readingEdge
      ) {
        currentChapterId = chapterId;
      }
    });
    chapterList.querySelectorAll("button").forEach((button) => {
      if (button.dataset.chapterId === currentChapterId)
        button.setAttribute("aria-current", "location");
      else button.removeAttribute("aria-current");
    });
  }

  /** Adds an ordinary navigation button; Tab follows the document's normal focus order. */
  function appendChapterLink(chapterId, number, label) {
    const item = createElement("li");
    const button = createElement("button", "work-chapter-link");
    button.type = "button";
    button.dataset.chapterId = chapterId;
    const chapterNumber = createElement(
      "span",
      "work-chapter-link-number",
      number,
    );
    chapterNumber.setAttribute("aria-hidden", "true");
    const chapterMarker = createElement("span", "work-chapter-marker");
    chapterMarker.setAttribute("aria-hidden", "true");
    button.append(
      chapterNumber,
      createElement("span", "work-chapter-link-label", label),
      chapterMarker,
    );
    button.addEventListener("click", () => navigateToChapter(chapterId));
    item.append(button);
    chapterList.append(item);
  }

  /** Moves to the whole copy group so neither its number nor first line is hidden by the toolbar. */
  function navigateToChapter(chapterId) {
    const chapterHeading = chapterHeadings.get(chapterId);
    closeChapterNavigation();
    const targetPosition = chapterHeading
      ? contentPanel.scrollTop +
        chapterHeading.closest(".work-chapter-copy").getBoundingClientRect()
          .top -
        contentPanel.getBoundingClientRect().top -
        panelToolbar.getBoundingClientRect().height -
        22
      : 0;
    (chapterHeading || contentHeading).focus({ preventScroll: true });
    contentPanel.scrollTo({
      top: Math.max(0, targetPosition),
      behavior: reducedMotion.matches ? "auto" : "smooth",
    });
  }

  /** Closes the image view; the native dialog returns focus to its opening control. */
  function closeImageDialog() {
    if (imageDialog.open) imageDialog.close();
  }

  /**
   * Stop observing image windows before their project or preview is replaced.
   * @param {HTMLElement} container Removed or hidden media container.
   * @returns {void}
   */
  function releasePerspectiveWindows(container) {
    container
      .querySelectorAll("[data-perspective-image]")
      .forEach((imageWindow) => {
        perspectiveResizeObserver.unobserve(imageWindow);
        perspectiveWindows.delete(imageWindow);
      });
  }

  /**
   * Shows a crop or rectified photograph while keeping the source untouched.
   * The same geometry is used for thumbnails and the large image view.
   * @param {GalleryImage} galleryImage Image metadata and optional crop.
   * @param {boolean} [eager] Whether to load the image immediately.
   * @returns {HTMLSpanElement} Aspect-ratio window containing the image.
   */
  function createImageWindow(galleryImage, eager = false) {
    const imageWindow = createElement("span", "work-image-window");
    const imageElement = document.createElement("img");
    const perspectiveMatrix = galleryImage.perspective
      ? createPerspectiveMatrix(galleryImage.perspective)
      : null;
    const visibleArea = (perspectiveMatrix && {
      x: 0,
      y: 0,
      width: galleryImage.perspective.width,
      height: galleryImage.perspective.height,
    }) ||
      galleryImage.crop || {
        x: 0,
        y: 0,
        width: galleryImage.width,
        height: galleryImage.height,
      };
    imageWindow.style.aspectRatio = `${visibleArea.width} / ${visibleArea.height}`;
    imageWindow.style.setProperty(
      "--media-ratio",
      `${visibleArea.width} / ${visibleArea.height}`,
    );
    imageWindow.style.position = "relative";
    imageWindow.style.overflow = "hidden";
    imageWindow.style.display = "block";
    imageElement.src = galleryImage.src;
    imageElement.width = galleryImage.width;
    imageElement.height = galleryImage.height;
    imageElement.alt = localizeText(galleryImage.caption);
    imageElement.loading = eager ? "eager" : "lazy";
    imageElement.decoding = "async";
    imageElement.style.position = "absolute";
    imageElement.style.maxWidth = "none";
    imageElement.style.width = `${(galleryImage.width / visibleArea.width) * 100}%`;
    imageElement.style.height = `${(galleryImage.height / visibleArea.height) * 100}%`;
    imageElement.style.left = `${(-visibleArea.x / visibleArea.width) * 100}%`;
    imageElement.style.top = `${(-visibleArea.y / visibleArea.height) * 100}%`;
    if (perspectiveMatrix) {
      imageWindow.dataset.perspectiveImage = "";
      imageElement.style.width = `${galleryImage.width}px`;
      imageElement.style.height = `${galleryImage.height}px`;
      imageElement.style.transformOrigin = "0 0";
      imageElement.style.visibility = "hidden";
      perspectiveWindows.set(imageWindow, {
        imageElement,
        coefficients: perspectiveMatrix,
        width: visibleArea.width,
      });
      perspectiveResizeObserver.observe(imageWindow);
    }
    imageWindow.append(imageElement);
    return imageWindow;
  }

  /** Opens the chosen image without navigating away from the case study. */
  function showImage(galleryImage, openingButton) {
    pauseVideos();
    closeChapterNavigation();
    lastImageButton = openingButton;
    const caption = localizeText(galleryImage.caption);
    const visibleWidth =
      galleryImage.perspective?.width ||
      galleryImage.crop?.width ||
      galleryImage.width;
    const visibleHeight =
      galleryImage.perspective?.height ||
      galleryImage.crop?.height ||
      galleryImage.height;
    enlargedImageFigure.style.width = `min(100%, ${(visibleWidth / visibleHeight) * 70}svh)`;
    releasePerspectiveWindows(enlargedImageFigure);
    enlargedImageFigure.replaceChildren(
      createImageWindow(galleryImage, true),
      createElement("figcaption", "", caption),
    );
    originalImageLink.href = galleryImage.src;
    originalImageLink.textContent =
      activeLanguage === "zh" ? "查看原图 ↗" : "Original image ↗";
    originalImageLink.setAttribute(
      "aria-label",
      activeLanguage === "zh"
        ? "在新标签页查看未经裁剪的原图"
        : "Open the uncropped original in a new tab",
    );
    closeImageButton.textContent = activeLanguage === "zh" ? "关闭" : "Close";
    imageDialog.setAttribute(
      "aria-label",
      caption || (activeLanguage === "zh" ? "图片预览" : "Image preview"),
    );
    imageDialog.showModal();
    closeImageButton.focus();
  }

  /**
   * Adds media with a layout role independent of each source image's dimensions.
   * @param {HTMLElement} parentElement Element receiving the gallery.
   * @param {GalleryImage[]} galleryImages Ordered selected images.
   * @param {string} [galleryLayout] Layout role handled by the stylesheet.
   */
  function appendImageGallery(
    parentElement,
    galleryImages,
    galleryLayout = "default",
  ) {
    if (!galleryImages?.length) return;
    const imageGallery = createElement("div", "work-gallery");
    imageGallery.dataset.galleryLayout =
      galleryLayout === "default"
        ? galleryImages.length === 1
          ? "single"
          : "pair"
        : galleryLayout;
    galleryImages.forEach((galleryImage) => {
      const visibleWidth =
        galleryImage.perspective?.width ||
        galleryImage.crop?.width ||
        galleryImage.width;
      const visibleHeight =
        galleryImage.perspective?.height ||
        galleryImage.crop?.height ||
        galleryImage.height;
      const imageFigure = createElement("figure", "work-figure");
      imageFigure.classList.toggle(
        "is-portrait",
        visibleHeight > visibleWidth * 1.25,
      );
      imageFigure.classList.toggle("is-detail", Boolean(galleryImage.small));
      const imageButton = createElement("button", "work-image-button");
      imageButton.type = "button";
      imageButton.setAttribute("aria-haspopup", "dialog");
      imageButton.setAttribute(
        "aria-label",
        `${localizeText(galleryImage.caption)}${activeLanguage === "zh" ? "，放大查看" : ", enlarge image"}`,
      );
      imageButton.append(
        createImageWindow(galleryImage, galleryLayout === "hero"),
      );
      imageButton.addEventListener("click", () =>
        showImage(galleryImage, imageButton),
      );
      imageFigure.append(
        imageButton,
        createElement("figcaption", "", localizeText(galleryImage.caption)),
      );
      imageGallery.append(imageFigure);
    });
    parentElement.append(imageGallery);
  }

  /** Adds user-controlled clips; starting one pauses any other playing clip. */
  function appendVideoGallery(parentElement, videos) {
    if (!videos?.length) return;
    const videoGallery = createElement("div", "work-video-gallery");
    videoGallery.dataset.galleryLayout =
      videos.length === 1 ? "single" : "pair";
    videos.forEach((videoData) => {
      const videoFigure = createElement("figure", "work-video-figure");
      const videoElement = document.createElement("video");
      videoElement.src = videoData.src;
      if (videoData.poster) videoElement.poster = videoData.poster;
      if (videoData.width) videoElement.width = videoData.width;
      if (videoData.height) videoElement.height = videoData.height;
      if (videoData.width && videoData.height)
        videoElement.style.aspectRatio = `${videoData.width} / ${videoData.height}`;
      videoElement.controls = true;
      videoElement.loop = Boolean(videoData.loop);
      videoElement.playsInline = true;
      videoElement.muted = Boolean(videoData.autoplay);
      videoElement.autoplay =
        Boolean(videoData.autoplay) && !reducedMotion.matches;
      videoElement.preload = videoData.autoplay ? "metadata" : "none";
      videoElement.setAttribute(
        "aria-label",
        localizeText(videoData.title || videoData.caption),
      );
      videoElement.addEventListener("play", () => {
        pauseVideos(videoElement);
      });
      const videoCaption = createElement("figcaption");
      if (videoData.title)
        videoCaption.append(
          createElement(
            "strong",
            "work-video-title",
            localizeText(videoData.title),
          ),
        );
      if (videoData.caption)
        videoCaption.append(
          createElement(
            "span",
            "work-video-caption",
            localizeText(videoData.caption),
          ),
        );
      if (videoData.duration) {
        const durationSeconds = Math.round(Number(videoData.duration));
        const durationLabel =
          typeof videoData.duration === "number"
            ? `${Math.floor(durationSeconds / 60)}:${String(durationSeconds % 60).padStart(2, "0")}`
            : localizeText(videoData.duration);
        videoCaption.append(
          createElement("span", "work-video-duration", durationLabel),
        );
      }
      videoFigure.append(videoElement, videoCaption);
      videoGallery.append(videoFigure);
    });
    parentElement.append(videoGallery);
  }

  /** Keeps role, date, and tools together without putting long team credits first. */
  function appendProjectMetadata(parentElement, projectData) {
    const metadata = createElement("dl", "work-meta");
    const metadataFields = [
      [
        activeLanguage === "zh" ? "时间" : "When",
        localizeText(projectData.date_range?.label),
      ],
      [
        activeLanguage === "zh" ? "角色" : "My role",
        localizeText(projectData.role),
      ],
    ];
    metadataFields.forEach(([label, value]) => {
      if (!value) return;
      const metadataRow = createElement("div");
      metadataRow.append(
        createElement("dt", "", label),
        createElement("dd", "", value),
      );
      metadata.append(metadataRow);
    });
    if (metadata.childElementCount) parentElement.append(metadata);
    const projectTools = projectData.tools?.length
      ? projectData.tools
      : projectData.skills;
    if (projectTools?.length)
      appendParagraph(
        parentElement,
        projectTools.map(localizeText).join(" · "),
        "work-tools",
      );
    (projectData.links || []).forEach((linkData) => {
      const projectLink = createElement(
        "a",
        "work-project-link",
        `${localizeText(linkData.label)} ↗`,
      );
      projectLink.href = linkData.url;
      projectLink.target = "_blank";
      projectLink.rel = "noopener noreferrer";
      parentElement.append(projectLink);
    });
  }

  /**
   * Adds readable project materials beside their original downloads.
   * @param {object} projectData Project with an optional materials collection.
   * @param {HTMLElement} parentElement Introduction containing the material links.
   */
  function appendProjectMaterials(projectData, parentElement) {
    if (!projectData.materials?.length) return;
    const materialsSection = createElement("section", "work-materials");
    const materialsHeading = createElement(
      "h3",
      "",
      activeLanguage === "zh" ? "游戏材料" : "Game materials",
    );
    materialsHeading.id = `work-${currentProjectId}-materials`;
    materialsSection.setAttribute("aria-labelledby", materialsHeading.id);
    materialsSection.append(materialsHeading);
    const materialsList = createElement("ul", "work-materials-list");
    projectData.materials.forEach((material) => {
      const materialItem = createElement("li", "work-material");
      const materialHeading = createElement("h4");
      const materialActions = createElement("div", "work-material-actions");
      material.links.forEach((linkData) => {
        const materialLink = createElement(
          "a",
          linkData.download ? "" : "work-material-reader",
          linkData.download
            ? localizeText(linkData.label)
            : `${localizeText(material.title)} →`,
        );
        materialLink.href = linkData.url;
        if (linkData.download) {
          materialLink.download = linkData.download;
          materialLink.setAttribute(
            "aria-label",
            `${activeLanguage === "zh" ? "下载" : "Download"} ${localizeText(material.title)} — ${localizeText(linkData.label)}`,
          );
          materialActions.append(materialLink);
        } else {
          materialLink.addEventListener("click", () => {
            try {
              sessionStorage.setItem(
                "portfolio-reading-return",
                JSON.stringify({
                  projectId: currentProjectId,
                  scrollTop: contentPanel.scrollTop,
                }),
              );
            } catch {
              /** The project route remains usable when storage is unavailable. */
            }
          });
          materialHeading.append(materialLink);
        }
      });
      materialItem.append(materialHeading, materialActions);
      materialsList.append(materialItem);
    });
    materialsSection.append(materialsList);
    parentElement.append(materialsSection);
  }

  /** Adds supporting documentation behind a native disclosure control. */
  function appendProcessImages(projectData) {
    if (!projectData.process_images?.length && !projectData.process_note)
      return;
    const processDetails = createElement("details", "work-process");
    const imageCount = projectData.process_images?.length || 0;
    const summaryLabel =
      activeLanguage === "zh"
        ? `过程记录 · ${imageCount} 张`
        : `Process notes · ${imageCount} ${imageCount === 1 ? "image" : "images"}`;
    processDetails.append(createElement("summary", "", summaryLabel));
    if (projectData.process_note)
      appendParagraph(
        processDetails,
        projectData.process_note,
        "work-process-note",
      );
    appendImageGallery(processDetails, projectData.process_images, "archive");
    projectDetail.append(processDetails);
  }

  /** Appends index navigation and the next complete project. */
  function appendDetailFooter(projectData) {
    if (projectData.collaborators?.length) {
      const credits = createElement("div", "work-credits");
      credits.append(
        createElement(
          "span",
          "",
          activeLanguage === "zh" ? "合作者" : "Collaborators",
        ),
      );
      appendParagraph(credits, projectData.collaborators.join(", "));
      projectDetail.append(credits);
    }
    const detailFooter = createElement("footer", "work-detail-footer");
    const allWorkButton = createElement(
      "button",
      "work-end-back",
      activeLanguage === "zh" ? "← 所有作品" : "← All work",
    );
    allWorkButton.type = "button";
    allWorkButton.addEventListener("click", returnToWorkIndex);
    detailFooter.append(allWorkButton);
    const currentIndex = completeProjectOrder.indexOf(currentProjectId);
    const nextProjectId =
      completeProjectOrder[(currentIndex + 1) % completeProjectOrder.length];
    const nextProject = findProject(nextProjectId);
    if (nextProject && nextProjectId !== currentProjectId) {
      const nextProjectButton = createElement(
        "button",
        "work-next",
        `${activeLanguage === "zh" ? "下一件作品：" : "Next: "}${localizeText(nextProject.title)} →`,
      );
      nextProjectButton.type = "button";
      nextProjectButton.addEventListener("click", () =>
        openProject(nextProjectId),
      );
      detailFooter.append(nextProjectButton);
    }
    projectDetail.append(detailFooter);
  }

  /** Rebuilds the current case study in the selected language. */
  function renderProjectDetail(projectData) {
    pauseVideos();
    releasePerspectiveWindows(projectDetail);
    closeImageDialog();
    projectDetail.dataset.projectId = currentProjectId;
    projectDetail.replaceChildren();
    chapterHeadings.clear();
    closeChapterNavigation();
    chapterList.replaceChildren();
    chapterProjectLabel.textContent = localizeText(projectData.title);
    appendChapterLink(
      "",
      "00",
      activeLanguage === "zh" ? "项目概览" : "Overview",
    );
    if (
      currentProjectId === "machinery-structuralism" &&
      !projectData.sections?.length
    ) {
      appendParagraph(projectDetail, projectData.overview, "work-lead");
      appendDetailFooter(projectData);
      return;
    }
    if (currentProjectId === "oil-paintings") {
      const artIntroduction = createElement("div", "work-introduction");
      appendParagraph(artIntroduction, projectData.overview, "work-lead");
      appendParagraph(
        artIntroduction,
        projectData.date_range.label,
        "work-tools",
      );
      projectDetail.append(artIntroduction);
      appendImageGallery(
        projectDetail,
        projectData.artworks.map((artwork) => ({
          ...artwork.image,
          caption: artwork.caption,
        })),
        "artworks",
      );
      appendDetailFooter(projectData);
      return;
    }

    const opening = createElement("div", "work-opening");
    opening.dataset.heroLayout = projectData.hero_layout || "object";
    const introduction = createElement("div", "work-introduction");
    if (projectData.subtitle)
      appendParagraph(introduction, projectData.subtitle, "work-subtitle");
    appendParagraph(introduction, projectData.overview, "work-lead");
    appendProjectMetadata(introduction, projectData);
    appendProjectMaterials(projectData, introduction);
    opening.append(introduction);
    if (projectData.cover_videos?.length) {
      appendVideoGallery(opening, projectData.cover_videos);
    } else {
      appendImageGallery(opening, projectData.cover_images, "hero");
    }
    projectDetail.append(opening);

    (projectData.sections || []).forEach((projectSection, sectionIndex) => {
      const chapterSection = createElement("section", "work-chapter");
      chapterSection.dataset.chapterLayout = projectSection.layout || "paired";
      const chapterCopy = createElement("div", "work-chapter-copy");
      const chapterNumber = String(sectionIndex + 1).padStart(2, "0");
      const chapterHeading = createElement(
        "h3",
        "",
        localizeText(projectSection.title),
      );
      chapterHeading.id = `work-${currentProjectId}-${projectSection.id}`;
      chapterHeading.tabIndex = -1;
      chapterSection.setAttribute("aria-labelledby", chapterHeading.id);
      chapterCopy.append(
        createElement("span", "work-chapter-number", chapterNumber),
        chapterHeading,
      );
      projectSection.paragraphs.forEach((paragraph) =>
        appendParagraph(chapterCopy, paragraph),
      );
      chapterSection.append(chapterCopy);
      if (projectSection.images?.length || projectSection.videos?.length) {
        const chapterEvidence = createElement("div", "work-chapter-evidence");
        appendImageGallery(
          chapterEvidence,
          projectSection.images,
          projectSection.gallery_layout || "default",
        );
        appendVideoGallery(chapterEvidence, projectSection.videos);
        chapterSection.append(chapterEvidence);
      }
      appendChapterLink(
        projectSection.id,
        chapterNumber,
        localizeText(projectSection.title),
      );
      chapterHeadings.set(projectSection.id, chapterHeading);
      projectDetail.append(chapterSection);
    });
    appendProcessImages(projectData);
    appendDetailFooter(projectData);
  }

  /**
   * Synchronizes index/detail visibility without rebuilding unchanged content.
   * @param {string} selectedLanguage Language used for visible copy.
   * @param {boolean} isWorkPanelActive Whether Work is the selected panel.
   */
  function renderGallery(selectedLanguage, isWorkPanelActive) {
    if (activeLanguage !== selectedLanguage || !isWorkPanelActive) {
      pauseVideos();
      closeImageDialog();
      closeChapterNavigation();
    }
    activeLanguage = selectedLanguage;
    workArea
      .querySelectorAll("[data-project-icon]")
      .forEach((projectButton) => {
        const project = findProject(
          projectIdsByWorkIcon[projectButton.dataset.projectIcon],
        );
        projectButton.querySelector(".work-title").textContent = localizeText(
          project.title,
        );
        const projectStatus = projectButton.querySelector(".work-status");
        if (projectStatus) {
          projectStatus.textContent = localizeText(project.status);
          projectStatus.hidden = !project.status;
        }
      });
    paintingsSection.setAttribute(
      "aria-label",
      localizeText(portfolioData.oil_paintings.title),
    );
    backToIndexButton.textContent =
      activeLanguage === "zh" ? "← 所有作品" : "← All work";
    backToIndexButton.hidden = !isWorkPanelActive || !currentProjectId;
    const selectedProject = currentProjectId
      ? findProject(currentProjectId)
      : null;
    chapterNavigation.hidden =
      !isWorkPanelActive || !selectedProject?.sections?.length;
    chapterTriggerLabel.textContent =
      activeLanguage === "zh" ? "本页目录" : "On this page";
    chapterPopover.setAttribute(
      "aria-label",
      activeLanguage === "zh" ? "跳转到章节" : "Jump to a section",
    );
    if (!isWorkPanelActive) return;
    projectGrid.hidden = Boolean(currentProjectId);
    paintingsSection.hidden = Boolean(currentProjectId);
    projectDetail.hidden = !currentProjectId;
    portfolioRoot.toggleAttribute(
      "data-work-detail",
      Boolean(currentProjectId),
    );
    if (currentProjectId && selectedProject) {
      contentHeading.textContent = localizeText(selectedProject.title);
      const requestedRenderKey = `${currentProjectId}:${activeLanguage}`;
      if (renderedProjectLanguageKey !== requestedRenderKey) {
        renderProjectDetail(selectedProject);
        renderedProjectLanguageKey = requestedRenderKey;
      }
    } else {
      contentHeading.textContent =
        activeLanguage === "zh" ? "精选作品" : "Selected work";
    }
  }

  /** Opens a case study while preserving the index position for the return trip. */
  function openProject(projectId) {
    if (!findProject(projectId)) return;
    pauseVideos();
    closeImageDialog();
    currentProjectId = projectId;
    renderGallery(options.language(), true);
    contentPanel.scrollTop = 0;
    contentHeading.focus({ preventScroll: true });
    options.onChange(true);
  }

  /** Clears media and detail state before the controller closes or changes panels. */
  function resetGallery() {
    pauseVideos();
    releasePerspectiveWindows(projectDetail);
    closeImageDialog();
    currentProjectId = null;
    renderedProjectLanguageKey = null;
    chapterHeadings.clear();
    backToIndexButton.hidden = true;
    closeChapterNavigation();
    chapterNavigation.hidden = true;
    projectDetail.removeAttribute("data-project-id");
    portfolioRoot.removeAttribute("data-work-detail");
  }

  /** Restores the work index, its scroll position, and the selected sketch button. */
  function returnToWorkIndex() {
    resetGallery();
    renderGallery(activeLanguage, true);
    contentPanel.scrollTop = workIndexScrollPosition;
    lastSelectedProjectButton?.focus({ preventScroll: true });
    options.onChange(false);
  }

  chapterTrigger.addEventListener("click", () => {
    if (!chapterPopover.hidden) return closeChapterNavigation();
    openChapterNavigation();
  });
  chapterNavigation.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !chapterPopover.hidden) {
      event.preventDefault();
      event.stopPropagation();
      closeChapterNavigation(true);
      return;
    }
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
    if (chapterPopover.hidden && event.target !== chapterTrigger) return;
    event.preventDefault();
    if (chapterPopover.hidden) {
      openChapterNavigation();
    }
    const buttons = [...chapterList.querySelectorAll("button")];
    const focusedIndex = buttons.indexOf(document.activeElement);
    const nextIndex =
      event.key === "Home"
        ? 0
        : event.key === "End"
          ? buttons.length - 1
          : event.key === "ArrowDown"
            ? Math.min(focusedIndex + 1, buttons.length - 1)
            : focusedIndex <= 0
              ? buttons.length - 1
              : focusedIndex - 1;
    const focusedButton = buttons[nextIndex];
    if (!focusedButton) return;
    focusedButton.focus({ preventScroll: true });
    const buttonBounds = focusedButton.getBoundingClientRect();
    const popoverBounds = chapterPopover.getBoundingClientRect();
    if (buttonBounds.bottom > popoverBounds.bottom - 12) {
      chapterPopover.scrollTop +=
        buttonBounds.bottom - popoverBounds.bottom + 12;
    } else if (buttonBounds.top < popoverBounds.top + 12) {
      chapterPopover.scrollTop -= popoverBounds.top - buttonBounds.top + 12;
    }
  });
  chapterNavigation.addEventListener("focusout", (event) => {
    if (!chapterNavigation.contains(event.relatedTarget))
      closeChapterNavigation();
  });
  document.addEventListener("pointerdown", (event) => {
    if (!chapterPopover.hidden && !chapterNavigation.contains(event.target))
      closeChapterNavigation();
  });
  contentPanel.addEventListener(
    "scroll",
    () => {
      if (!chapterPopover.hidden)
        closeChapterNavigation(chapterPopover.contains(document.activeElement));
    },
    { passive: true },
  );
  window.addEventListener("resize", () =>
    closeChapterNavigation(chapterPopover.contains(document.activeElement)),
  );

  closeImageButton.addEventListener("click", closeImageDialog);
  imageDialog.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    event.preventDefault();
    event.stopPropagation();
    closeImageDialog();
  });
  imageDialog.addEventListener("cancel", (event) => {
    event.preventDefault();
    closeImageDialog();
  });
  imageDialog.addEventListener("click", (event) => {
    if (event.target === imageDialog) closeImageDialog();
  });
  imageDialog.addEventListener("close", () => {
    releasePerspectiveWindows(enlargedImageFigure);
    if (
      lastImageButton?.isConnected &&
      !projectDetail.hidden &&
      currentProjectId
    )
      lastImageButton.focus({ preventScroll: true });
    lastImageButton = null;
  });
  backToIndexButton.addEventListener("click", returnToWorkIndex);
  workArea.querySelectorAll("[data-project-icon]").forEach((projectButton) => {
    projectButton.addEventListener("click", () => {
      workIndexScrollPosition = contentPanel.scrollTop;
      lastSelectedProjectButton = projectButton;
      openProject(projectIdsByWorkIcon[projectButton.dataset.projectIcon]);
    });
  });

  return {
    render: renderGallery,
    reset: resetGallery,
    pauseMedia: () => {
      pauseVideos();
      closeChapterNavigation();
    },
    back: returnToWorkIndex,
    open: openProject,
    currentProject: () => currentProjectId,
    hasDetail: () => Boolean(currentProjectId),
  };
}
