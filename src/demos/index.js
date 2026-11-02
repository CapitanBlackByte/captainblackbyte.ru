import "./demos.css";
import { initDashboard } from "./dashboard.js";
import { initPhone } from "./phone.js";
import { initPipeline } from "./pipeline.js";
import { initLoad } from "./load.js";

const DEMOS = {
  dashboard: initDashboard,
  phone: initPhone,
  pipeline: initPipeline,
  load: initLoad,
};

// Модель запускается, когда до неё остался примерно экран прокрутки.
export function initDemos() {
  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        observer.unobserve(entry.target);
        const mount = entry.target.querySelector("[data-demo]");
        DEMOS[mount.dataset.demo]?.(mount);
      });
    },
    { rootMargin: "100% 0px" }
  );
  document.querySelectorAll("[data-demo]").forEach((mount) => observer.observe(mount.closest(".case")));
}
