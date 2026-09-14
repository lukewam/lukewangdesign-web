/**
 * Text may be shared across languages or supplied as English and Chinese copy.
 * @typedef {string | {en?: string, zh?: string}} LocalizedText
 */

/**
 * @typedef {Object} GalleryImage
 * @property {string} src Image URL, also used for the full-size link.
 * @property {number} width Original image width.
 * @property {number} height Original image height.
 * @property {LocalizedText} caption Caption and alternative text.
 * @property {boolean} [small] Whether to use the detail-image layout.
 */

/**
 * Connects the work index to its project details and painting gallery.
 * Returning to the index restores its scroll position and selected button.
 *
 * @param {HTMLElement} portfolioRoot Root element carrying portfolio state.
 * @param {HTMLElement} contentPanel Scrollable panel containing the work index.
 * @param {Object} portfolioData Portfolio content, including projects and oil_paintings.
 * @param {Object} options Callbacks supplied by the portfolio controller.
 * @param {() => string} options.language Returns the currently selected language.
 * @param {(hasDetail: boolean) => void} options.onChange Reports detail navigation.
 * @returns {{render: (language: string, isWork: boolean) => void, reset: () => void, back: () => void, hasDetail: () => boolean}}
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
  contentHeading.tabIndex = -1;

  const projectDetail = document.createElement("article");
  projectDetail.className = "work-detail";
  projectDetail.hidden = true;
  workArea.append(projectDetail);

  const backToIndexButton = document.createElement("button");
  backToIndexButton.type = "button";
  backToIndexButton.className = "work-back";
  backToIndexButton.hidden = true;
  contentPanel.querySelector(".panel-toolbar").prepend(backToIndexButton);

  const projectIdsByWorkIcon = {
    eye: "machinary",
    rock: "sisyphus",
    bear: "polar-bear",
    controller: "disaster-defender",
    car: "autonomous-vehicle",
    robot: "zoo-navigator",
    brush: "oil-paintings",
  };

  let currentProjectId = null;
  let workIndexScrollPosition = 0;
  let lastSelectedProjectButton = null;
  let activeLanguage = "en";
  let renderedProjectLanguageKey = null;

  /** Falls back to English when the selected translation is unavailable. */
  const localizeText = (localizedContent) =>
    typeof localizedContent === "string"
      ? localizedContent
      : localizedContent?.[activeLanguage] || localizedContent?.en || "";

  const createElement = (tagName, className, textContent) => {
    const createdElement = document.createElement(tagName);
    if (className) createdElement.className = className;
    if (textContent) createdElement.textContent = textContent;
    return createdElement;
  };

  const appendParagraph = (parentElement, localizedContent, className = "") =>
    parentElement.append(
      createElement("p", className, localizeText(localizedContent)),
    );

  /**
   * Keeps every image linked to its original file using native browser navigation.
   * @param {HTMLElement} parentElement Element receiving the gallery.
   * @param {GalleryImage[]} galleryImages Images in their portfolio order.
   * @param {string} [className] Additional gallery layout class.
   */
  const appendImageGallery = (parentElement, galleryImages, className = "") => {
    if (!galleryImages?.length) return;

    const imageGallery = createElement("div", "work-gallery " + className);
    galleryImages.forEach((galleryImage) => {
      const imageFigure = createElement(
        "figure",
        "work-figure" +
          (galleryImage.height > galleryImage.width * 1.25
            ? " is-portrait"
            : "") +
          (galleryImage.small ? " is-detail" : ""),
      );
      const fullSizeImageLink = createElement("a", "work-image-link");
      fullSizeImageLink.href = galleryImage.src;
      fullSizeImageLink.target = "_blank";
      fullSizeImageLink.rel = "noopener";
      fullSizeImageLink.setAttribute(
        "aria-label",
        localizeText(galleryImage.caption) +
          (activeLanguage === "zh"
            ? "，查看原尺寸图片（新标签页）"
            : ", view full-size image (new tab)"),
      );

      const imageElement = document.createElement("img");
      imageElement.src = galleryImage.src;
      imageElement.width = galleryImage.width;
      imageElement.height = galleryImage.height;
      imageElement.alt = localizeText(galleryImage.caption);
      imageElement.loading = "lazy";
      imageElement.decoding = "async";

      fullSizeImageLink.append(imageElement);
      imageFigure.append(fullSizeImageLink);
      imageFigure.append(
        createElement("figcaption", "", localizeText(galleryImage.caption)),
      );
      imageGallery.append(imageFigure);
    });
    parentElement.append(imageGallery);
  };

  /** Rebuilds translated detail content, with paintings using their artwork order. */
  function renderProjectDetail(projectData) {
    projectDetail.replaceChildren();
    if (currentProjectId === "machinary") {
      appendParagraph(
        projectDetail,
        { en: "Documentation coming soon.", zh: "项目资料待补充。" },
        "work-intro",
      );
      return;
    }

    if (projectData.subtitle) {
      appendParagraph(projectDetail, projectData.subtitle, "work-subtitle");
    }
    if (currentProjectId !== "oil-paintings") {
      appendImageGallery(
        projectDetail,
        projectData.cover_images,
        "work-cover-gallery",
      );
    }

    const projectMetadata = createElement("dl", "work-meta");
    const metadataFields = [
      [
        activeLanguage === "zh" ? "时间" : "When",
        localizeText(projectData.date_range.label),
      ],
      [
        activeLanguage === "zh" ? "我的角色" : "My role",
        localizeText(projectData.role),
      ],
    ];
    if (projectData.collaborators?.length) {
      metadataFields.push([
        activeLanguage === "zh" ? "合作伙伴" : "Collaborators",
        projectData.collaborators.join(", "),
      ]);
    }
    metadataFields.forEach(([metadataLabel, metadataValue]) => {
      const metadataRow = createElement("div");
      metadataRow.append(
        createElement("dt", "", metadataLabel),
        createElement("dd", "", metadataValue),
      );
      projectMetadata.append(metadataRow);
    });
    projectDetail.append(projectMetadata);

    appendParagraph(projectDetail, projectData.overview, "work-intro");
    if (projectData.design_question) {
      appendParagraph(
        projectDetail,
        projectData.design_question,
        "work-question",
      );
    }
    const projectSkills = projectData.skills || projectData.tools;
    if (projectSkills?.length) {
      appendParagraph(
        projectDetail,
        projectSkills.map(localizeText).join(" · "),
        "work-skills",
      );
    }
    (projectData.links || []).forEach((projectLinkData) => {
      const projectLink = createElement(
        "a",
        "work-project-link",
        localizeText(projectLinkData.label) + " ↗",
      );
      projectLink.href = projectLinkData.url;
      projectLink.target = "_blank";
      projectLink.rel = "noopener noreferrer";
      projectDetail.append(projectLink);
    });

    if (currentProjectId === "oil-paintings") {
      appendImageGallery(
        projectDetail,
        projectData.artworks.map((artworkData) => ({
          ...artworkData.image,
          caption: artworkData.caption,
        })),
        "work-art-gallery",
      );
    } else {
      (projectData.cover_captions || []).forEach((coverCaption) =>
        appendParagraph(projectDetail, coverCaption.text, "work-caption-note"),
      );
      projectData.sections.forEach((projectSection, sectionIndex) => {
        const chapterSection = createElement("section", "work-chapter");
        chapterSection.append(
          createElement(
            "span",
            "work-chapter-number",
            String(sectionIndex + 1).padStart(2, "0"),
          ),
        );
        chapterSection.append(
          createElement("h3", "", localizeText(projectSection.title)),
        );
        projectSection.paragraphs.forEach((paragraphContent) =>
          appendParagraph(chapterSection, paragraphContent),
        );
        (projectSection.steps || []).forEach((projectStep) => {
          chapterSection.append(
            createElement("h4", "", localizeText(projectStep.title)),
          );
          projectStep.paragraphs.forEach((paragraphContent) =>
            appendParagraph(chapterSection, paragraphContent),
          );
        });
        appendImageGallery(chapterSection, projectSection.images);
        (projectSection.captions || []).forEach((sectionCaption) =>
          appendParagraph(
            chapterSection,
            sectionCaption.text,
            "work-caption-note",
          ),
        );
        projectDetail.append(chapterSection);
      });
    }

    const endOfProjectBackButton = createElement(
      "button",
      "work-end-back",
      activeLanguage === "zh" ? "← 返回作品" : "← Back to work",
    );
    endOfProjectBackButton.type = "button";
    endOfProjectBackButton.addEventListener("click", returnToWorkIndex);
    projectDetail.append(endOfProjectBackButton);
  }

  /**
   * Synchronizes the index or detail view with the selected panel and language.
   * Detail content is rebuilt only when the project or language changes.
   * @param {string} selectedLanguage Language used for visible copy.
   * @param {boolean} isWorkPanelActive Whether the work panel is selected.
   */
  function renderGallery(selectedLanguage, isWorkPanelActive) {
    activeLanguage = selectedLanguage;
    backToIndexButton.textContent =
      activeLanguage === "zh" ? "← 所有作品" : "← All work";
    backToIndexButton.hidden = !isWorkPanelActive || !currentProjectId;
    if (!isWorkPanelActive) return;

    projectGrid.hidden = Boolean(currentProjectId);
    paintingsSection.hidden = Boolean(currentProjectId);
    projectDetail.hidden = !currentProjectId;
    portfolioRoot.toggleAttribute(
      "data-work-detail",
      Boolean(currentProjectId),
    );
    if (currentProjectId) {
      const selectedProject =
        currentProjectId === "oil-paintings"
          ? portfolioData.oil_paintings
          : portfolioData.projects.find(
              (projectData) => projectData.id === currentProjectId,
            );
      contentHeading.textContent =
        currentProjectId === "machinary"
          ? "Machinary Structuralism"
          : localizeText(selectedProject.title);
      if (renderedProjectLanguageKey !== currentProjectId + activeLanguage) {
        renderProjectDetail(selectedProject);
        renderedProjectLanguageKey = currentProjectId + activeLanguage;
      }
    } else {
      contentHeading.textContent =
        activeLanguage === "zh" ? "精选作品" : "Selected work";
    }
  }

  /** Clears detail state so the controller can close or switch panels. */
  function resetGallery() {
    currentProjectId = null;
    renderedProjectLanguageKey = null;
    backToIndexButton.hidden = true;
    portfolioRoot.removeAttribute("data-work-detail");
  }

  /** Restores the work index, including its scroll position and keyboard focus. */
  function returnToWorkIndex() {
    resetGallery();
    renderGallery(activeLanguage, true);
    contentPanel.scrollTop = workIndexScrollPosition;
    lastSelectedProjectButton?.focus({ preventScroll: true });
    options.onChange(false);
  }

  backToIndexButton.addEventListener("click", returnToWorkIndex);
  workArea.querySelectorAll("[data-project-icon]").forEach((projectButton) =>
    projectButton.addEventListener("click", () => {
      workIndexScrollPosition = contentPanel.scrollTop;
      lastSelectedProjectButton = projectButton;
      currentProjectId =
        projectIdsByWorkIcon[projectButton.dataset.projectIcon];
      renderGallery(options.language(), true);
      contentPanel.scrollTop = 0;
      contentHeading.focus({ preventScroll: true });
      options.onChange(true);
    }),
  );

  return {
    render: renderGallery,
    reset: resetGallery,
    back: returnToWorkIndex,
    hasDetail: () => Boolean(currentProjectId),
  };
}
