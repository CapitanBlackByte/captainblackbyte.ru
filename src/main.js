import "./styles.css";

document.documentElement.classList.add("ready");

const projectData = {
  analytics: {
    type: "Web-платформа",
    title: "Аналитическая система для бизнеса",
    description:
      "Интерфейс для анализа продаж, контроля ключевых показателей и подготовки отчётности. Основной акцент — скорость работы, понятная визуализация и удобство для людей без технической подготовки",
    details: [
      ["Команда", "Full-stack"],
      ["Срок", "4 месяца"],
      ["Результат", "–38% рутины"],
    ],
    tags: ["Next.js", "TypeScript", "PostgreSQL", "Docker"],
  },
  mobile: {
    type: "Мобильное приложение",
    title: "Рабочее пространство сотрудника",
    description:
      "Android-приложение для работы с задачами, документами и уведомлениями. Поддерживает офлайн-режим и синхронизацию с сервисами компании",
    details: [
      ["Команда", "Android"],
      ["Срок", "3 месяца"],
      ["Платформа", "Android"],
    ],
    tags: ["Kotlin", "Jetpack Compose", "Room", "REST API"],
  },
  integration: {
    type: "Автоматизация",
    title: "Интеграция 1С, CRM и внешних сервисов",
    description:
      "Сервис обмена данными между учётной системой, CRM и внутренней инфраструктурой. Реализованы очереди, журналирование, повторная отправка и контроль ошибок",
    details: [
      ["Команда", "Backend"],
      ["Срок", "2 месяца"],
      ["Объём", "50k+ операций"],
    ],
    tags: ["1C", "Java", "RabbitMQ", "PostgreSQL"],
  },
  api: {
    type: "Backend",
    title: "Высоконагруженный API-сервис",
    description:
      "Сервис обработки заказов с кешированием, мониторингом и горизонтальным масштабированием. Архитектура рассчитана на рост нагрузки без полного переписывания продукта",
    details: [
      ["Команда", "Backend"],
      ["Срок", "10 недель"],
      ["Нагрузка", "1.5k RPS"],
    ],
    tags: ["Java", "Spring Boot", "Redis", "Docker"],
  },
};

const body = document.body;
const menuButton = document.getElementById("menuButton");
const mobileMenu = document.getElementById("mobileMenu");
const filterButtons = document.querySelectorAll(".filter-button");
const projectCards = document.querySelectorAll(".loot-item");
const projectModal = document.getElementById("projectModal");
const modalType = document.getElementById("modalType");
const modalTitle = document.getElementById("modalTitle");
const modalDescription = document.getElementById("modalDescription");
const modalDetails = document.getElementById("modalDetails");
const modalTags = document.getElementById("modalTags");
const contactForm = document.getElementById("contactForm");

document.getElementById("currentYear").textContent = new Date().getFullYear();

menuButton.addEventListener("click", () => {
  const isOpen = mobileMenu.classList.toggle("open");
  menuButton.classList.toggle("active", isOpen);
  menuButton.setAttribute("aria-expanded", String(isOpen));
  body.classList.toggle("menu-open", isOpen);
});

mobileMenu.querySelectorAll("a").forEach((link) => {
  link.addEventListener("click", () => {
    mobileMenu.classList.remove("open");
    menuButton.classList.remove("active");
    menuButton.setAttribute("aria-expanded", "false");
    body.classList.remove("menu-open");
  });
});

const cleanAddress = () => {
  const next = window.location.pathname + window.location.search;
  if (window.location.hash) history.replaceState(null, "", next);
};

document.querySelectorAll('a[href^="#"]').forEach((link) => {
  link.addEventListener("click", (event) => {
    const id = link.getAttribute("href").slice(1);
    const target = document.getElementById(id);
    if (!target) return;
    event.preventDefault();
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    target.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "start" });
    cleanAddress();
  });
});

if (window.location.hash) {
  const target = document.getElementById(window.location.hash.slice(1));
  if (target) target.scrollIntoView({ block: "start" });
  cleanAddress();
}

window.addEventListener("resize", () => {
  if (window.innerWidth > 760 && mobileMenu.classList.contains("open")) {
    mobileMenu.classList.remove("open");
    menuButton.classList.remove("active");
    menuButton.setAttribute("aria-expanded", "false");
    body.classList.remove("menu-open");
  }
});

filterButtons.forEach((button) => {
  button.addEventListener("click", () => {
    filterButtons.forEach((item) => item.classList.remove("active"));
    button.classList.add("active");

    const filter = button.dataset.filter;
    projectCards.forEach((card) => {
      const shouldShow = filter === "all" || card.dataset.category === filter;
      card.classList.toggle("hidden", !shouldShow);
    });
  });
});

function openProjectModal(projectKey) {
  const project = projectData[projectKey];
  if (!project) return;

  modalType.textContent = project.type;
  modalTitle.textContent = project.title;
  modalDescription.textContent = project.description;
  modalDetails.innerHTML = project.details
    .map(([label, value]) => `<div><span>${label}</span><strong>${value}</strong></div>`)
    .join("");
  modalTags.innerHTML = project.tags.map((tag) => `<span>${tag}</span>`).join("");

  projectModal.classList.add("open");
  projectModal.setAttribute("aria-hidden", "false");
  body.classList.add("modal-open");
}

function closeProjectModal() {
  projectModal.classList.remove("open");
  projectModal.setAttribute("aria-hidden", "true");
  body.classList.remove("modal-open");
}

document.querySelectorAll(".open-project").forEach((button) => {
  button.addEventListener("click", () => openProjectModal(button.dataset.project));
});

document.querySelectorAll("[data-close-modal]").forEach((element) => {
  element.addEventListener("click", closeProjectModal);
});

const articleReader = document.getElementById("articleReader");
const readerStatus = document.getElementById("readerStatus");
const readerTitle = document.getElementById("readerTitle");
const readerLead = document.getElementById("readerLead");
const readerBody = document.getElementById("readerBody");
const readerMeta = document.getElementById("readerMeta");

function openArticle(card) {
  readerStatus.textContent = card.querySelector(".article-status").textContent;
  readerTitle.textContent = card.querySelector("h3").textContent;
  readerLead.textContent = card.querySelector(".article-lead").textContent;
  readerBody.innerHTML = card.querySelector(".article-source").innerHTML;
  readerMeta.innerHTML = card.querySelector(".article-meta").innerHTML;
  articleReader.querySelector(".reader-screen").scrollTop = 0;
  articleReader.classList.add("open");
  articleReader.setAttribute("aria-hidden", "false");
  body.classList.add("modal-open");
}

function closeArticle() {
  articleReader.classList.remove("open");
  articleReader.setAttribute("aria-hidden", "true");
  if (!projectModal.classList.contains("open")) body.classList.remove("modal-open");
}

document.querySelectorAll(".open-article").forEach((button) => {
  button.addEventListener("click", () => openArticle(button.closest(".article-card")));
});

document.querySelectorAll("[data-close-reader]").forEach((element) => {
  element.addEventListener("click", closeArticle);
});

document.addEventListener("keydown", (event) => {
  if (event.key !== "Escape") return;
  if (articleReader.classList.contains("open")) closeArticle();
  else closeProjectModal();
});

const observer = new IntersectionObserver(
  (entries) => {
    entries.forEach((entry) => {
      if (entry.isIntersecting) {
        entry.target.classList.add("visible");
        observer.unobserve(entry.target);
      }
    });
  },
  { threshold: 0.14 }
);

document.querySelectorAll(".reveal").forEach((element) => observer.observe(element));

const compass = document.querySelector(".compass-rose");
const compassPermit = document.querySelector(".compass-permit");

function compassHeading(event) {
  if (Number.isFinite(event.webkitCompassHeading)) return event.webkitCompassHeading;
  if (event.absolute === true && Number.isFinite(event.alpha)) return (360 - event.alpha) % 360;
  return null;
}

function pointCompass(heading) {
  const screenAngle = window.screen.orientation
    ? window.screen.orientation.angle
    : Number(window.orientation) || 0;
  compass.style.transform = `rotate(${-(heading - screenAngle)}deg)`;
  compass.classList.add("is-live");
}

function onCompassOrientation(event) {
  const heading = compassHeading(event);
  if (heading == null) return;
  pointCompass(heading);
}

function watchCompass() {
  if ("ondeviceorientationabsolute" in window) {
    window.addEventListener("deviceorientationabsolute", onCompassOrientation);
    return;
  }
  window.addEventListener("deviceorientation", onCompassOrientation);
}

async function enableCompass() {
  const Orientation = window.DeviceOrientationEvent;
  if (!Orientation) return;
  if (typeof Orientation.requestPermission === "function") {
    let state = "denied";
    try {
      state = await Orientation.requestPermission();
    } catch {
      return;
    }
    if (state !== "granted") return;
    compassPermit.hidden = true;
  }
  watchCompass();
}

if (compass && compassPermit && window.DeviceOrientationEvent) {
  if (typeof DeviceOrientationEvent.requestPermission === "function") {
    compassPermit.hidden = false;
    compassPermit.addEventListener("click", enableCompass);
  } else {
    enableCompass();
  }
}

const shootingStars = document.querySelector(".shooting-stars");
if (shootingStars && !window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
  const spawnShootingStar = () => {
    const star = document.createElement("span");
    star.className = "shooting-star";
    const startLeft = 8 + Math.random() * 70;
    const startTop = 4 + Math.random() * 42;
    const distance = 160 + Math.random() * 160;
    const angle = 22 + Math.random() * 18;
    const duration = 0.65 + Math.random() * 0.45;
    const rad = (angle * Math.PI) / 180;

    star.style.left = `${startLeft}%`;
    star.style.top = `${startTop}%`;
    star.style.setProperty("--fall-angle", `${angle}deg`);
    star.style.setProperty("--fall-x", `${Math.cos(rad) * distance}px`);
    star.style.setProperty("--fall-y", `${Math.sin(rad) * distance}px`);
    star.style.setProperty("--fall-duration", `${duration}s`);

    shootingStars.appendChild(star);
    star.addEventListener("animationend", () => star.remove(), { once: true });
  };

  const scheduleNext = () => {
    const delay = 3500 + Math.random() * 9000;
    window.setTimeout(() => {
      spawnShootingStar();
      if (Math.random() < 0.22) {
        window.setTimeout(spawnShootingStar, 280 + Math.random() * 520);
      }
      scheduleNext();
    }, delay);
  };

  window.setTimeout(spawnShootingStar, 1800 + Math.random() * 2200);
  scheduleNext();
}

contactForm.addEventListener("submit", (event) => {
  event.preventDefault();

  const data = new FormData(contactForm);
  const name = data.get("name");
  const contact = data.get("contact");
  const message = data.get("message");

  const subject = encodeURIComponent(`Заявка от ${name}`);
  const bodyText = encodeURIComponent(
    `Имя: ${name}\nКонтакт: ${contact}\n\nЗадача:\n${message}`
  );

  window.location.href = `mailto:nik2shar@yahoo.com?subject=${subject}&body=${bodyText}`;
});
