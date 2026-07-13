import "./styles.css";

const projectData = {
  analytics: {
    type: "Web-платформа",
    title: "Аналитическая система для бизнеса",
    description:
      "Интерфейс для анализа продаж, контроля ключевых показателей и подготовки отчётности. Основной акцент — скорость работы, понятная визуализация и удобство для экипажа без технической подготовки",
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
      "Android-приложение для работы с задачами, документами и уведомлениями. Поддерживает офлайн-режим и синхронизацию с береговыми сервисами компании",
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

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") closeProjectModal();
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

contactForm.addEventListener("submit", (event) => {
  event.preventDefault();

  const data = new FormData(contactForm);
  const name = data.get("name");
  const contact = data.get("contact");
  const message = data.get("message");

  const subject = encodeURIComponent(`Новый рейд — сигнал от ${name}`);
  const bodyText = encodeURIComponent(
    `Имя: ${name}\nКонтакт: ${contact}\n\nОписание рейда:\n${message}`
  );

  window.location.href = `mailto:nik2shar@yahoo.com?subject=${subject}&body=${bodyText}`;
});
