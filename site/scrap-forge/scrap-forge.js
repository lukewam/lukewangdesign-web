// Scrap Forge page: language, slow reveals, one moving picture at a time, a trailer started by a line of words.
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

// ---- the trailer: nothing plays until asked; the control is a line of text under the frame
function clock(seconds) {
  const whole = Math.round(seconds);
  return Math.floor(whole / 60) + ":" + String(whole % 60).padStart(2, "0");
}
function labelPlay(control) {
  const video = document.getElementById(control.dataset.for);
  if (!video) return;
  const zh = root.lang === "zh-CN";
  const length = Number(video.dataset.seconds || video.duration || 0);
  const paused = video.paused || video.ended;
  control.textContent = paused
    ? (zh ? "播放预告片" : "Play the trailer") + (length ? " · " + clock(length) : "")
    : (zh ? "暂停" : "Pause");
}
for (const control of document.querySelectorAll(".play")) {
  const video = document.getElementById(control.dataset.for);
  if (!video) continue;
  control.addEventListener("click", () => {
    if (video.paused || video.ended) { stopLoops(); video.controls = true; video.play(); } else video.pause();
  });
  for (const name of ["play", "pause", "ended", "loadedmetadata"]) video.addEventListener(name, () => labelPlay(control));
}

// ---- loops: silent, and only the one nearest the middle of the window runs
const loops = Array.from(document.querySelectorAll("video[data-loop]"));
const still = window.matchMedia("(prefers-reduced-motion: reduce)");
function stopLoops() { for (const video of loops) video.pause(); }
function chooseLoop() {
  const film = document.querySelector(".film video");
  if (still.matches || (film && !film.paused && !film.ended)) { stopLoops(); return; }
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

// ---- a still opened to look at, closed by a click or Escape
const viewer = document.querySelector(".viewer");
if (viewer) {
  const picture = viewer.querySelector("img");
  let opener = null;
  function close() { viewer.classList.remove("open"); picture.removeAttribute("src"); if (opener) opener.focus(); opener = null; }
  for (const image of document.querySelectorAll("img[data-full]")) {
    image.tabIndex = 0;
    image.setAttribute("role", "button");
    const open = () => { opener = image; picture.src = image.dataset.full; picture.alt = image.alt; viewer.classList.add("open"); viewer.focus(); };
    image.addEventListener("click", open);
    image.addEventListener("keydown", (event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); open(); } });
  }
  viewer.addEventListener("click", close);
  viewer.addEventListener("keydown", (event) => { if (event.key === "Escape") close(); });
}

setLanguage(stored, false);
later();
