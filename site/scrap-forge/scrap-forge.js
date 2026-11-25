// Scrap Forge page: language, slow reveals, one moving picture at a time, a trailer started by a click on its picture.
const root = document.documentElement;
root.classList.remove("no-js");

// ---- language: the same choice the portfolio keeps for the tab session
const titles = {
  en: "Scrap Forge — a Steam page rehearsal · Luke Wang",
  zh: "锻造之王：一次 Steam 页面预演 · Luke Wang",
};
function setLanguage(code, remember) {
  const zh = code === "zh";
  root.lang = zh ? "zh-CN" : "en";
  document.title = zh ? titles.zh : titles.en;
  for (const button of document.querySelectorAll(".lang button")) {
    button.setAttribute("aria-pressed", String(button.dataset.lang === code));
  }
  for (const control of document.querySelectorAll(".play")) labelPlay(control);
  if (remember) {
    try { sessionStorage.setItem("portfolio-language", code); } catch (error) { /* private mode: the page still switches */ }
  }
}
let stored = "en";
try { stored = sessionStorage.getItem("portfolio-language") === "zh" ? "zh" : "en"; } catch (error) { stored = "en"; }
for (const button of document.querySelectorAll(".lang button")) {
  button.addEventListener("click", () => setLanguage(button.dataset.lang, true));
}

// ---- the trailer: nothing plays until asked; the whole picture is the button, then the browser's own controls take over
function clock(seconds) {
  const whole = Math.round(seconds);
  return Math.floor(whole / 60) + ":" + String(whole % 60).padStart(2, "0");
}
function labelPlay(control) {
  const video = document.getElementById(control.dataset.for);
  if (!video) return;
  const zh = root.lang === "zh-CN";
  const length = Number(video.dataset.seconds || video.duration || 0);
  const words = (zh ? (video.dataset.zh || "播放预告片") : (video.dataset.en || "Play the trailer")) + (length ? " · " + clock(length) : "");
  const label = control.querySelector(".play-words");
  if (label) label.textContent = words; else control.textContent = words;
  control.setAttribute("aria-label", words);
}
for (const control of document.querySelectorAll(".play")) {
  const video = document.getElementById(control.dataset.for);
  if (!video) continue;
  const film = control.closest(".film");
  control.addEventListener("click", () => {
    stopLoops();
    for (const other of document.querySelectorAll(".film video")) if (other !== video && !other.paused) other.pause();
    video.controls = true;
    film.classList.add("is-playing");
    video.play().catch(() => { film.classList.remove("is-playing"); video.controls = false; });
  });
  video.addEventListener("ended", () => { film.classList.remove("is-playing"); video.controls = false; video.load(); });
  video.addEventListener("loadedmetadata", () => labelPlay(control));
}

// ---- loops: silent, and only the one nearest the middle of the window runs
const loops = Array.from(document.querySelectorAll("video[data-loop]"));
const still = window.matchMedia("(prefers-reduced-motion: reduce)");
function stopLoops() { for (const video of loops) video.pause(); }
function chooseLoop() {
  const filmPlaying = Array.from(document.querySelectorAll(".film video")).some((film) => !film.paused && !film.ended);
  if (still.matches || filmPlaying) { stopLoops(); return; }
  const middle = window.innerHeight / 2;
  let best = null;
  let bestDistance = Infinity;
  for (const video of loops) {
    const box = video.getBoundingClientRect();
    const visible = Math.min(box.bottom, window.innerHeight) - Math.max(box.top, 0);
    if (visible < box.height * 0.6) continue;
    const distance = Math.abs((box.top + box.bottom) / 2 - middle);
    if (distance < bestDistance) { bestDistance = distance; best = video; }
  }
  for (const video of loops) {
    if (video === best) { if (video.paused) video.play().catch(() => {}); } else if (!video.paused) video.pause();
  }
}
let waiting = false;
function later() { if (waiting) return; waiting = true; requestAnimationFrame(() => { waiting = false; chooseLoop(); }); }
window.addEventListener("scroll", later, { passive: true });
window.addEventListener("resize", later);
document.addEventListener("visibilitychange", () => { if (document.hidden) stopLoops(); else later(); });

// ---- reveals: each thing comes in once
if ("IntersectionObserver" in window && !still.matches) {
  const seen = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      entry.target.classList.add("is-in");
      seen.unobserve(entry.target);
    }
  }, { rootMargin: "0px 0px -8% 0px", threshold: 0.08 });
  for (const element of document.querySelectorAll(".reveal")) seen.observe(element);
} else {
  for (const element of document.querySelectorAll(".reveal")) element.classList.add("is-in");
}

// ---- a still opened to look at, with its caption; screenshots step with the arrows; closed by a click or Escape
const viewer = document.querySelector(".viewer");
if (viewer) {
  const picture = viewer.querySelector("img");
  const caption = viewer.querySelector("figcaption");
  const count = viewer.querySelector(".viewer-count");
  let opener = null;
  let set = [];
  let at = 0;
  function show(index) {
    at = (index + set.length) % set.length;
    const image = set[at];
    picture.src = image.dataset.full; picture.alt = image.alt;
    const words = image.closest("figure")?.querySelector("figcaption");
    caption.innerHTML = words ? words.innerHTML : "";
    if (count) count.textContent = set.length > 1 ? (at + 1) + " / " + set.length : "";
  }
  function close() { viewer.classList.remove("open"); picture.removeAttribute("src"); if (opener) opener.focus(); opener = null; }
  for (const image of document.querySelectorAll("img[data-full]")) {
    image.tabIndex = 0;
    image.setAttribute("role", "button");
    const open = () => {
      opener = image;
      const tray = image.closest(".shots");
      set = tray ? Array.from(tray.querySelectorAll("img[data-full]")) : [image];
      viewer.classList.toggle("many", set.length > 1);
      show(set.indexOf(image));
      viewer.classList.add("open"); viewer.focus();
    };
    image.addEventListener("click", open);
    image.addEventListener("keydown", (event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); open(); } });
  }
  viewer.querySelector(".prev")?.addEventListener("click", (event) => { event.stopPropagation(); show(at - 1); });
  viewer.querySelector(".next")?.addEventListener("click", (event) => { event.stopPropagation(); show(at + 1); });
  picture.addEventListener("click", (event) => { if (set.length > 1) { event.stopPropagation(); show(at + 1); } });
  viewer.addEventListener("click", close);
  viewer.addEventListener("keydown", (event) => {
    if (event.key === "Escape") close();
    else if (event.key === "ArrowLeft" && set.length > 1) show(at - 1);
    else if (event.key === "ArrowRight" && set.length > 1) show(at + 1);
  });
}

setLanguage(stored, false);
later();
