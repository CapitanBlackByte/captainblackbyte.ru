import { initOrderForm } from "./order-form.js";
import { initReveal } from "./reveal.js";

document.getElementById("currentYear").textContent = new Date().getFullYear();

const header = document.getElementById("siteHeader");
const syncHeader = () => header.classList.toggle("is-scrolled", window.scrollY > 40);
syncHeader();
window.addEventListener("scroll", syncHeader, { passive: true });

initReveal();
initOrderForm(document.getElementById("contactForm"), document.getElementById("formStatus"));
