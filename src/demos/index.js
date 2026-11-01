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

export function initDemos() {
  document.querySelectorAll("[data-demo]").forEach((mount) => {
    DEMOS[mount.dataset.demo]?.(mount);
  });
}
