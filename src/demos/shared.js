export const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

export const BOLT = `<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><path d="M9.2 1 3 9h4l-1.2 6L13 6.6H8.8L9.2 1Z" fill="currentColor"/></svg>`;

export const nowLabel = () =>
  new Date().toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit", second: "2-digit" });

export function seeded(seed) {
  let s = seed;
  return () => {
    s = (s * 16807) % 2147483647;
    return (s - 1) / 2147483646;
  };
}

export function whenVisible(element, onChange) {
  const observer = new IntersectionObserver(([entry]) => onChange(entry.isIntersecting), { rootMargin: "160px" });
  observer.observe(element);
}

export function createLoop(step) {
  let raf = 0;
  let last = 0;
  const frame = (now) => {
    raf = requestAnimationFrame(frame);
    const dt = Math.min((now - last) / 1000, 0.1);
    last = now;
    step(dt, now);
  };
  return {
    start() {
      if (raf) return;
      last = performance.now();
      raf = requestAnimationFrame(frame);
    },
    stop() {
      cancelAnimationFrame(raf);
      raf = 0;
    },
  };
}

export function demoBar({ hint, buttons }) {
  return `
    <div class="demo-bar">
      <p class="demo-hint"><b>Попробуйте.</b> ${hint}</p>
      <div class="demo-actions">${buttons}</div>
    </div>`;
}
