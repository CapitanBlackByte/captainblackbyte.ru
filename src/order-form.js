// Форма заявки. Заявка уходит на сервер сайта, оттуда её забирает бот.
// Если сервер не ответил, открываем почтовую программу с готовым письмом.
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

export function initOrderForm(form, status) {
  const messageField = form.elements.message;
  const submitButton = form.querySelector('button[type="submit"]');

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

  // Кнопки с data-order подставляют в поле «Задача» готовый текст, например выбранный тариф.
  // Текст, который человек написал сам, не трогаем.
  let filled = "";
  document.querySelectorAll("[data-order]").forEach((link) => {
    link.addEventListener("click", () => {
      if (messageField.value.trim() && messageField.value !== filled) return;
      filled = link.dataset.order;
      messageField.value = filled;
      fitMessage();
    });
  });

  const openMailDraft = ({ name, contact, message }) => {
    const subject = encodeURIComponent(`Заявка от ${name}`);
    const bodyText = encodeURIComponent(`Имя: ${name}\nКонтакт: ${contact}\n\nЗадача:\n${message}`);

    status.textContent = "Не получилось отправить заявку напрямую. Открываю почтовую программу с готовым письмом. Если окно не появилось, напишите на CaptainBlackByte@yandex.ru.";
    window.location.href = `mailto:CaptainBlackByte@yandex.ru?subject=${subject}&body=${bodyText}`;
  };

  form.addEventListener("submit", async (event) => {
    event.preventDefault();

    const data = new FormData(form);
    if (String(data.get("company") || "").trim()) {
      status.textContent = "Не удалось отправить. Напишите на CaptainBlackByte@yandex.ru.";
      return;
    }

    const name = String(data.get("name") || "").trim();
    const contact = String(data.get("contact") || "").trim();
    const message = String(data.get("message") || "").trim();
    if (!name || !contact || !message) {
      status.textContent = "Заполните имя, контакт и описание задачи.";
      return;
    }

    const order = { name, contact, message, consent: data.get("consent") === "on" };
    submitButton.disabled = true;
    status.textContent = "Отправляю заявку…";
    try {
      const result = await sendOrder(order);
      if (result.ok) {
        form.reset();
        filled = "";
        fitMessage();
        status.textContent = "Заявка отправлена. Мы свяжемся с Вами по указанному контакту.";
      } else if (FORM_ERRORS[result.error]) {
        status.textContent = FORM_ERRORS[result.error];
      } else {
        openMailDraft(order);
      }
    } catch {
      openMailDraft(order);
    } finally {
      submitButton.disabled = false;
    }
  });
}
