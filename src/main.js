import "@fontsource/cormorant/cyrillic-500.css";
import "@fontsource/cormorant/latin-500.css";
import "@fontsource/cormorant/cyrillic-500-italic.css";
import "@fontsource/cormorant/latin-500-italic.css";
import "@fontsource/cormorant/cyrillic-600.css";
import "@fontsource/cormorant/latin-600.css";
import "@fontsource-variable/onest/wght.css";
import "@fontsource-variable/jetbrains-mono/wght.css";
import "./styles.css";
import { initShip } from "./ship.js";
import { drawChart } from "./chart.js";

const root = document.documentElement;
const body = document.body;
const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

document.getElementById("currentYear").textContent = new Date().getFullYear();

const menuButton = document.getElementById("menuButton");
const mobileMenu = document.getElementById("mobileMenu");

function setMenu(open) {
  mobileMenu.classList.toggle("open", open);
  menuButton.classList.toggle("active", open);
  menuButton.setAttribute("aria-expanded", String(open));
  menuButton.setAttribute("aria-label", open ? "Закрыть меню" : "Открыть меню");
  body.classList.toggle("menu-open", open);
}

menuButton.addEventListener("click", () => setMenu(!mobileMenu.classList.contains("open")));
mobileMenu.querySelectorAll("a").forEach((link) => link.addEventListener("click", () => setMenu(false)));

window.addEventListener("resize", () => {
  if (window.innerWidth > 1180 && mobileMenu.classList.contains("open")) setMenu(false);
});

const cleanAddress = () => {
  const next = window.location.pathname + window.location.search;
  if (window.location.hash) history.replaceState(null, "", next);
};

// Переходы внутри страницы. Соседний блок проезжаем мягкой прокруткой, а на дальний уходим
// через затемнение: проматывать десятки экранов за секунду неприятно для глаз.
const veil = document.getElementById("pageVeil");
const VEIL_IN = 220;
const GLIDE_SCREENS = 1.6;
let glideFrame = 0;
let trip = 0;

const land = (target) => target.scrollIntoView({ behavior: "instant", block: "start" });

const landingY = (target) => {
  const padding = parseFloat(getComputedStyle(root).scrollPaddingTop) || 0;
  const margin = parseFloat(getComputedStyle(target).scrollMarginTop) || 0;
  return Math.max(0, target.getBoundingClientRect().top + window.scrollY - padding - margin);
};

const stopGlide = () => {
  cancelAnimationFrame(glideFrame);
  glideFrame = 0;
};

function glideTo(y) {
  const from = window.scrollY;
  const distance = y - from;
  const duration = 620 + (Math.abs(distance) / window.innerHeight / GLIDE_SCREENS) * 480;
  const start = performance.now();
  const frame = (now) => {
    const t = Math.min(1, Math.max(0, (now - start) / duration));
    const eased = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(2 - 2 * t, 3) / 2;
    window.scrollTo(0, from + distance * eased);
    glideFrame = t < 1 ? requestAnimationFrame(frame) : 0;
  };
  glideFrame = requestAnimationFrame(frame);
}

function crossTo(target, covered) {
  trip += 1;
  const current = trip;
  veil.classList.toggle("is-instant", covered);
  veil.classList.add("is-on");
  window.setTimeout(() => {
    if (current !== trip) return;
    land(target);
    // Секции вокруг цели дорисовываются после прыжка и могут её сдвинуть: уточняем место перед показом.
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        if (current !== trip) return;
        land(target);
        veil.classList.remove("is-on", "is-instant");
      });
    });
  }, covered ? 0 : VEIL_IN);
}

function travel(target, fromMenu) {
  stopGlide();
  if (reduced) {
    land(target);
    return;
  }
  const y = landingY(target);
  if (fromMenu || Math.abs(y - window.scrollY) > window.innerHeight * GLIDE_SCREENS) crossTo(target, fromMenu);
  else glideTo(y);
}

["wheel", "pointerdown", "keydown"].forEach((name) => {
  window.addEventListener(name, stopGlide, { passive: true });
});

document.querySelectorAll('a[href^="#"]').forEach((link) => {
  link.addEventListener("click", (event) => {
    const target = document.getElementById(link.getAttribute("href").slice(1));
    if (!target) return;
    event.preventDefault();
    travel(target, !!link.closest("#mobileMenu"));
    cleanAddress();
  });
});

if (window.location.hash) {
  const target = document.getElementById(window.location.hash.slice(1));
  if (target) land(target);
  cleanAddress();
}

const header = document.getElementById("siteHeader");
const syncHeader = () => header.classList.toggle("is-scrolled", window.scrollY > 40);
syncHeader();
window.addEventListener("scroll", syncHeader, { passive: true });

document.querySelectorAll("[data-split]").forEach((heading) => {
  let index = 0;
  const wrap = (node) => {
    [...node.childNodes].forEach((child) => {
      if (child.nodeType === Node.TEXT_NODE) {
        const fragment = document.createDocumentFragment();
        child.textContent.split(/(\s+)/).forEach((part) => {
          if (!part) return;
          if (/^\s+$/.test(part)) {
            fragment.append(" ");
            return;
          }
          const word = document.createElement("span");
          word.className = "word";
          const inner = document.createElement("span");
          inner.textContent = part;
          inner.style.setProperty("--i", String(index));
          index += 1;
          word.append(inner);
          fragment.append(word);
        });
        child.replaceWith(fragment);
      } else {
        wrap(child);
      }
    });
  };
  wrap(heading);
  heading.classList.add("is-split", "reveal-split");
});

const revealObserver = new IntersectionObserver(
  (entries) => {
    entries.forEach((entry) => {
      if (!entry.isIntersecting) return;
      entry.target.classList.add("visible");
      revealObserver.unobserve(entry.target);
    });
  },
  { threshold: 0.14 }
);

document.querySelectorAll(".reveal, .reveal-split").forEach((element) => revealObserver.observe(element));

const rail = document.querySelector(".rail");
const railLinks = [...rail.querySelectorAll("a")];
const railObserver = new IntersectionObserver(
  (entries) => {
    entries.forEach((entry) => {
      if (!entry.isIntersecting) return;
      railLinks.forEach((link) => {
        const on = link.getAttribute("href") === `#${entry.target.id}`;
        if (on) link.setAttribute("aria-current", "true");
        else link.removeAttribute("aria-current");
      });
    });
  },
  { rootMargin: "-50% 0px -50% 0px" }
);
document.querySelectorAll(".stop").forEach((stop) => railObserver.observe(stop));

new IntersectionObserver(([entry]) => rail.classList.toggle("is-on", entry.isIntersecting), {
  rootMargin: "-40% 0px -40% 0px",
}).observe(document.getElementById("stops"));

const articleReader = document.getElementById("articleReader");
const readerScreen = articleReader.querySelector(".reader-screen");
const readerStatus = document.getElementById("readerStatus");
const readerTitle = document.getElementById("readerTitle");
const readerLead = document.getElementById("readerLead");
const readerBody = document.getElementById("readerBody");
const readerMeta = document.getElementById("readerMeta");
let readerOrigin = null;

function openArticle(card, origin) {
  readerStatus.textContent = card.querySelector(".article-status").textContent;
  readerTitle.textContent = card.querySelector(".article-title").textContent;
  readerLead.textContent = card.querySelector(".article-lead").textContent;
  readerBody.innerHTML = card.querySelector(".article-source").innerHTML;
  readerMeta.textContent = card.querySelector(".article-meta").textContent;
  readerScreen.scrollTop = 0;
  readerOrigin = origin;
  articleReader.classList.add("open");
  articleReader.setAttribute("aria-hidden", "false");
  body.classList.add("modal-open");
  readerScreen.focus();
}

function closeArticle() {
  if (!articleReader.classList.contains("open")) return;
  articleReader.classList.remove("open");
  articleReader.setAttribute("aria-hidden", "true");
  body.classList.remove("modal-open");
  readerOrigin?.focus();
}

document.querySelectorAll(".open-article").forEach((button) => {
  button.addEventListener("click", () => openArticle(button.closest(".article-card"), button));
});

document.querySelectorAll("[data-close-reader]").forEach((element) => {
  element.addEventListener("click", closeArticle);
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    closeArticle();
    if (mobileMenu.classList.contains("open")) setMenu(false);
  }
  if (event.key === "Tab" && articleReader.classList.contains("open")) {
    const focusable = [...readerScreen.querySelectorAll("button, a[href]")];
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (!first) return;
    if (event.shiftKey && (document.activeElement === first || document.activeElement === readerScreen)) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }
});

const contactForm = document.getElementById("contactForm");
const formStatus = document.getElementById("formStatus");
const messageField = contactForm.elements.message;

const fitMessage = () => {
  const caretAtEdge = messageField.scrollTop > 0;
  messageField.parentElement.dataset.value = messageField.value;
  if (!caretAtEdge) return;
  const view = window.visualViewport;
  const edge = view ? view.offsetTop + view.height : window.innerHeight;
  const hidden = messageField.getBoundingClientRect().bottom - edge;
  if (hidden > 0) window.scrollBy({ top: hidden, behavior: "instant" });
};

messageField.addEventListener("input", fitMessage);
window.addEventListener("pageshow", fitMessage);

const submitButton = contactForm.querySelector('button[type="submit"]');
const FORM_ERRORS = {
  contact: "Не похоже на контакт. Укажите телефон, email или @username.",
  "too-long": "Описание слишком длинное. Сократите его или напишите на CaptainBlackByte@yandex.ru.",
  "too-many": "Слишком много заявок подряд. Попробуйте позже или напишите на CaptainBlackByte@yandex.ru.",
};

async function sendOrder(order) {
  const response = await fetch("/api/orders", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(order),
    signal: AbortSignal.timeout(15000),
  });
  return response.json();
}

function openMailDraft({ name, contact, message }) {
  const subject = encodeURIComponent(`Заявка от ${name}`);
  const bodyText = encodeURIComponent(`Имя: ${name}\nКонтакт: ${contact}\n\nЗадача:\n${message}`);

  formStatus.textContent = "Не получилось отправить заявку напрямую. Открываю почтовую программу с готовым письмом. Если окно не появилось, напишите на CaptainBlackByte@yandex.ru.";
  window.location.href = `mailto:CaptainBlackByte@yandex.ru?subject=${subject}&body=${bodyText}`;
}

contactForm.addEventListener("submit", async (event) => {
  event.preventDefault();

  const data = new FormData(contactForm);
  if (String(data.get("company") || "").trim()) {
    formStatus.textContent = "Не удалось отправить. Напишите на CaptainBlackByte@yandex.ru.";
    return;
  }

  const name = String(data.get("name") || "").trim();
  const contact = String(data.get("contact") || "").trim();
  const message = String(data.get("message") || "").trim();
  if (!name || !contact || !message) {
    formStatus.textContent = "Заполните имя, контакт и описание задачи.";
    return;
  }

  const order = { name, contact, message, consent: data.get("consent") === "on" };
  submitButton.disabled = true;
  formStatus.textContent = "Отправляю заявку…";
  try {
    const result = await sendOrder(order);
    if (result.ok) {
      contactForm.reset();
      fitMessage();
      formStatus.textContent = "Заявка отправлена. Мы свяжемся с Вами по указанному контакту.";
    } else if (FORM_ERRORS[result.error]) {
      formStatus.textContent = FORM_ERRORS[result.error];
    } else {
      openMailDraft(order);
    }
  } catch {
    openMailDraft(order);
  } finally {
    submitButton.disabled = false;
  }
});

const formatInt = new Intl.NumberFormat("ru-RU");
const hud = {
  points: document.querySelectorAll('[data-hud="points"], [data-hood="points"]'),
  fps: document.querySelectorAll('[data-hud="fps"], [data-hood="fps"]'),
};

const updateStats = ({ fps, points }) => {
  if (fps) hud.fps.forEach((node) => { node.textContent = fps; });
  hud.points.forEach((node) => { node.textContent = formatInt.format(points); });
};

function failScene() {
  root.classList.add("no-webgl");
  document.querySelector(".hud")?.remove();
}

function startScene() {
  let scene = null;
  try {
    scene = initShip(document.getElementById("scene"), {
      zone: document.querySelector(".voyage"),
      onStats: updateStats,
      onError: failScene,
    });
  } catch (error) {
    console.error(error);
  }
  if (!scene) {
    failScene();
    return;
  }

  const stormWord = document.querySelector(".hero h1 em");
  if (!stormWord) return;
  let calmTimer = 0;
  stormWord.addEventListener("click", () => {
    window.clearTimeout(calmTimer);
    scene.setStorm(1);
    calmTimer = window.setTimeout(() => scene.setStorm(0), 6000);
  });
}

// Сначала браузер показывает текст, и только потом поднимается сцена.
requestAnimationFrame(() => window.setTimeout(startScene));

const route = document.getElementById("route");
let chartDrawn = false;
const waypointsWrap = route.querySelector(".waypoints-wrap");
const waypoints = [...route.querySelectorAll(".waypoint")];
const syncRoute = () => {
  const rect = waypointsWrap.getBoundingClientRect();
  const vh = window.innerHeight;
  const progress = Math.min(1, Math.max(0, (vh * 0.82 - rect.top) / (rect.height * 0.95)));
  waypointsWrap.style.setProperty("--route", window.innerWidth > 1100 ? progress.toFixed(3) : "1");
  waypoints.forEach((item, index) => {
    const at = window.innerWidth > 1100 ? (index + 0.5) / waypoints.length : 0;
    item.classList.toggle("is-passed", progress > at);
  });
};
new IntersectionObserver(
  ([entry]) => {
    if (entry.isIntersecting) {
      if (!chartDrawn) drawChart(document.getElementById("chartArt"));
      chartDrawn = true;
      window.addEventListener("scroll", syncRoute, { passive: true });
    } else {
      window.removeEventListener("scroll", syncRoute);
    }
    syncRoute();
  },
  { rootMargin: "100% 0px" }
).observe(route);

const updateHood = () => {
  const navigation = performance.getEntriesByType("navigation")[0];
  const loadNode = document.querySelector('[data-hood="load"]');
  const weightNode = document.querySelector('[data-hood="weight"]');
  if (navigation && loadNode) {
    const end = navigation.loadEventEnd || performance.now();
    loadNode.textContent = `${(end / 1000).toFixed(2).replace(".", ",")} с`;
  }
  if (weightNode) {
    const bytes = performance
      .getEntriesByType("resource")
      .filter((entry) => /\.(js|css)(\?|$)/.test(entry.name))
      .reduce((sum, entry) => sum + (entry.encodedBodySize || 0), 0);
    if (bytes) weightNode.textContent = `${formatInt.format(Math.round(bytes / 1024))} КБ`;
  }
};

window.addEventListener("load", () => window.setTimeout(updateHood, 50));
new IntersectionObserver(([entry]) => {
  if (entry.isIntersecting) updateHood();
}).observe(document.getElementById("hood"));

const whenIdle = (task) => {
  if ("requestIdleCallback" in window) requestIdleCallback(task, { timeout: 1500 });
  else window.setTimeout(task, 300);
};
whenIdle(() => import("./demos/index.js").then(({ initDemos }) => initDemos()));
