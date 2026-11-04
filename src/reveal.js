// Появление блоков при прокрутке. Заголовки с data-split выезжают по словам.
export function initReveal() {
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
}
