import { describeError, isFatal, isTransient, sleep } from "./telegram.js";
import {
  CLIENT_COMMANDS,
  FIELD_LABELS,
  MANAGER_COMMANDS,
  PROFILE,
  QUESTIONS,
  STATUS,
  TEXT,
  consentText,
  helpText,
  privacyText,
} from "./texts.js";

const FLOW = ["task", "consent", "name", "contact", "review"];
const EDITABLE = ["task", "name", "contact"];
const OPEN_STATUSES = ["new", "work"];
const ATTACHMENT_KINDS = ["document", "photo", "video", "voice", "audio", "video_note", "animation"];
const RELAYED_KINDS = [...ATTACHMENT_KINDS, "text", "sticker", "contact", "location", "venue"];
const TRANSITIONS = {
  take: { from: ["new"], to: "work" },
  done: { from: ["work"], to: "done" },
  reject: { from: ["new", "work"], to: "rejected" },
};
const CONFIRM_LABELS = { done: TEXT.confirmDone, reject: TEXT.confirmReject };
const LIMITS = {
  short: 200,
  name: 100,
  task: 8000,
  preview: 1500,
  cardTask: 3000,
  chunk: 4000,
  attachments: 10,
  ordersPerDay: 5,
  dayMs: 24 * 60 * 60 * 1000,
  relayCount: 30,
  relayWindowMs: 10 * 60 * 1000,
  draftMs: 7 * 24 * 60 * 60 * 1000,
  orderMs: 3 * 365 * 24 * 60 * 60 * 1000,
  seenUpdates: 200,
  seenSiteOrders: 500,
  sitePollMs: 5 * 1000,
  siteRetryMs: 30 * 1000,
  maxBackoffMs: 60 * 1000,
  flushRetryMs: 30 * 1000,
};

const esc = (text) => String(text).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

function cut(text, limit) {
  if (text.length <= limit) return text;
  const code = text.charCodeAt(limit - 1);
  return text.slice(0, code >= 0xd800 && code <= 0xdbff ? limit - 1 : limit);
}

function chunks(text, size) {
  const parts = [];
  for (let rest = text; rest; ) {
    const part = cut(rest, size);
    parts.push(part);
    rest = rest.slice(part.length);
  }
  return parts;
}

const btn = (text, data) => ({ text, callback_data: data });
const inline = (rows) => ({ inline_keyboard: rows });
const withMarkup = (markup) => (markup.inline_keyboard.length ? { reply_markup: markup } : {});
const field = (name, value) => `<b>${FIELD_LABELS[name]}:</b> ${esc(value)}`;
const brief = (text, limit) => esc(cut(text.replace(/\s+/g, " "), limit));
const looksLikeContact = (text) => /@|\.\w{2,}/.test(text) || text.replace(/\D/g, "").length >= 6;

const reviewKeyboard = () => inline([[btn(TEXT.submit, "r:send")], [btn(TEXT.edit, "r:edit"), btn(TEXT.cancel, "r:cancel")]]);

function editKeyboard() {
  const rows = [];
  for (let index = 0; index < EDITABLE.length; index += 2) {
    rows.push(EDITABLE.slice(index, index + 2).map((name) => btn(FIELD_LABELS[name], `e:${name}`)));
  }
  return inline([...rows, [btn(TEXT.back, "r:back")]]);
}

function renderReview(draft) {
  const { answers, attachments } = draft;
  const task = answers.task.length > LIMITS.preview ? `${cut(answers.task, LIMITS.preview)}…` : answers.task;
  return [
    TEXT.reviewTitle,
    "",
    field("name", answers.name),
    field("contact", answers.contact),
    ...(attachments.length ? [`<b>${TEXT.attachments}:</b> ${attachments.length}`] : []),
    "",
    `<b>${FIELD_LABELS.task}:</b>`,
    esc(task),
  ].join("\n");
}

function renderCard(order) {
  const { answers, client, status, manager, attachmentCount, id } = order;
  const head = cut(answers.task, LIMITS.cardTask);
  const continues = head.length < answers.task.length;
  const who = client.username
    ? `@${esc(client.username)}`
    : `<a href="tg://user?id=${client.chatId}">${esc(client.name)}</a>`;
  return [
    `<b>${TEXT.cardTitle(id)}</b> · ${STATUS[status]}${manager ? ` (${esc(manager)})` : ""}`,
    "",
    field("name", answers.name),
    field("contact", answers.contact),
    client.chatId ? `<b>Telegram:</b> ${who}` : `<b>${TEXT.source}:</b> ${TEXT.sourceSite}`,
    ...(attachmentCount ? [`<b>${TEXT.attachments}:</b> ${attachmentCount}`] : []),
    "",
    `<b>${FIELD_LABELS.task}:</b>`,
    continues ? `${esc(head)}…` : esc(head),
    ...(continues ? ["", `<i>${TEXT.cardContinues}</i>`] : []),
    "",
    `<i>${client.chatId ? TEXT.cardHint : TEXT.cardHintSite}</i>`,
  ].join("\n");
}

function renderPlainCard({ answers, client, id }) {
  const who = client.username ? `@${client.username}` : client.chatId;
  return [
    TEXT.cardTitle(id),
    `${FIELD_LABELS.name}: ${answers.name}`,
    `${FIELD_LABELS.contact}: ${answers.contact}`,
    client.chatId ? `Telegram: ${who}` : `${TEXT.source}: ${TEXT.sourceSite}`,
    `${FIELD_LABELS.task}:`,
    cut(answers.task, LIMITS.cardTask),
  ].join("\n");
}

function cardKeyboard(order, confirming = null) {
  const action = (label, name) => btn(label, `o:${order.id}:${name}`);
  if (confirming) return inline([[action(CONFIRM_LABELS[confirming], confirming), action(TEXT.back, "back")]]);
  if (order.status === "new") return inline([[action(TEXT.take, "take"), action(TEXT.reject, "ask-reject")]]);
  if (order.status === "work") return inline([[action(TEXT.finish, "ask-done"), action(TEXT.reject, "ask-reject")]]);
  return inline([]);
}

export function createBot({
  telegram,
  store,
  managerChatId: configuredManager = null,
  managerUsername = "",
  privacyUrl = "",
  inbox = null,
  log = console,
  pollTimeout = 30,
  backoffMs = 1000,
  now = Date.now,
}) {
  const { state } = store;
  const policyUrl = esc(privacyUrl).replace(/"/g, "&quot;");
  const managerLogin = managerUsername.replace(/^@/, "").toLowerCase();
  const relayTimes = new Map();
  let managerChatId = configuredManager ?? state.managerChatId ?? null;
  let me = null;
  let flushNotBefore = 0;
  let siteNotBefore = 0;

  const isoNow = () => new Date(now()).toISOString();
  const findOrder = (id) => state.orders.find((order) => order.id === id);
  const isOpen = (order) => OPEN_STATUSES.includes(order.status);
  const latestOpenOrder = (chatId) => state.orders.findLast((order) => order.client.chatId === chatId && isOpen(order));
  const replyTo = (msg) => ({ reply_parameters: { message_id: msg.message_id, allow_sending_without_reply: true } });
  const like = (msg) => quietly("setMessageReaction", {
    chat_id: msg.chat.id,
    message_id: msg.message_id,
    reaction: [{ type: "emoji", emoji: "👍" }],
  });

  const send = (chatId, text, extra = {}) =>
    telegram.call("sendMessage", {
      chat_id: chatId,
      text,
      parse_mode: "HTML",
      link_preview_options: { is_disabled: true },
      ...extra,
    });

  function quietly(method, params) {
    return telegram.call(method, params, { attempts: 1 }).catch((error) => {
      if (!/not modified/.test(error.message)) log.warn(describeError(error));
      return null;
    });
  }

  const editText = (message, text, extra = {}) =>
    quietly("editMessageText", {
      chat_id: message.chat.id,
      message_id: message.message_id,
      text,
      parse_mode: "HTML",
      link_preview_options: { is_disabled: true },
      ...extra,
    });

  const editButtons = (message, markup) =>
    quietly("editMessageReplyMarkup", {
      chat_id: message.chat.id,
      message_id: message.message_id,
      ...(markup ? { reply_markup: markup } : {}),
    });

  const markAnswered = (message, question, answer) => editText(message, `${question}\n\n<b>${esc(answer)}</b>`);
  const editCard = (message, order) => editText(message, renderCard(order), withMarkup(cardKeyboard(order)));

  function parseCommand(msg) {
    const entity = msg.entities?.[0];
    if (entity?.type !== "bot_command" || entity.offset !== 0) return null;
    const [name, target] = msg.text.slice(1, entity.length).split("@");
    return { name: name.toLowerCase(), foreign: Boolean(target) && target.toLowerCase() !== me.username.toLowerCase() };
  }

  function nextStep(chatId, draft) {
    if (draft.backToReview) return "review";
    const next = FLOW[FLOW.indexOf(draft.step) + 1];
    return next === "consent" && state.consents[chatId] ? "name" : next;
  }

  async function ask(chatId, draft) {
    const { step } = draft;
    if (step === "review") {
      await send(chatId, renderReview(draft), { reply_markup: reviewKeyboard() });
    } else if (step === "consent") {
      await send(chatId, consentText(policyUrl), {
        reply_markup: inline([[btn(TEXT.consentYes, "c:yes")], [btn(TEXT.consentNo, "c:no")]]),
      });
    } else if (step === "contact") {
      await send(chatId, QUESTIONS.contact, {
        reply_markup: {
          keyboard: [[{ text: TEXT.sharePhone, request_contact: true }], [{ text: TEXT.contactHere }]],
          resize_keyboard: true,
          one_time_keyboard: true,
        },
      });
    } else if (step === "name") {
      await send(chatId, QUESTIONS.name, { reply_markup: inline([[btn(draft.client.firstName, "n:tg")]]) });
    } else {
      await send(chatId, QUESTIONS.task);
    }
  }

  async function goNext(chatId, draft) {
    draft.step = nextStep(chatId, draft);
    await ask(chatId, draft);
  }

  async function beginOrder(msg) {
    const chatId = msg.chat.id;
    const dayAgo = now() - LIMITS.dayMs;
    const recent = state.orders.filter((order) => order.client.chatId === chatId && Date.parse(order.createdAt) > dayAgo);
    if (recent.length >= LIMITS.ordersPerDay) {
      await send(chatId, TEXT.tooManyOrders);
      return;
    }
    const { from } = msg;
    const draft = {
      step: "task",
      answers: {},
      attachments: [],
      album: null,
      backToReview: false,
      updatedAt: isoNow(),
      client: {
        chatId,
        name: [from.first_name, from.last_name].filter(Boolean).join(" "),
        firstName: from.first_name,
        username: from.username ?? null,
      },
    };
    state.drafts[chatId] = draft;
    await send(chatId, TEXT.greeting, { reply_markup: { remove_keyboard: true } });
    await ask(chatId, draft);
  }

  function addOrder({ client, answers, consentAt, attachments = [] }) {
    const rest = answers.task.slice(cut(answers.task, LIMITS.cardTask).length);
    const order = {
      id: state.nextOrderId,
      status: "new",
      createdAt: isoNow(),
      updatedAt: isoNow(),
      consentAt,
      client,
      answers,
      attachmentCount: attachments.length,
      manager: null,
      cardMessageId: null,
      outbox: [...chunks(rest, LIMITS.chunk).map((text) => ({ text })), ...attachments.map((copy) => ({ copy }))],
    };
    state.nextOrderId += 1;
    state.orders.push(order);
    return order;
  }

  function createOrder(chatId, draft) {
    const { answers, attachments, client } = draft;
    delete state.drafts[chatId];
    return addOrder({ client, answers, attachments, consentAt: state.consents[chatId] });
  }

  async function inboxCall(route, body) {
    const response = await fetch(`${inbox.url}${route}`, {
      method: body ? "POST" : "GET",
      headers: { authorization: `Bearer ${inbox.token}`, "content-type": "application/json" },
      body: body && JSON.stringify(body),
      signal: AbortSignal.timeout(15000),
    });
    if (!response.ok) throw new Error(`приём заявок ответил ${response.status}`);
    return response.json();
  }

  function addSiteOrder(item) {
    if (state.seenSiteOrders.includes(item.id)) return;
    state.seenSiteOrders.push(item.id);
    state.seenSiteOrders.splice(0, state.seenSiteOrders.length - LIMITS.seenSiteOrders);
    addOrder({
      client: { chatId: null, name: item.name, firstName: item.name, username: null },
      answers: { task: item.message, name: item.name, contact: item.contact },
      consentAt: item.consentAt,
    });
  }

  async function pullSiteOrders() {
    if (!inbox || now() < siteNotBefore) return;
    siteNotBefore = now() + LIMITS.sitePollMs;
    try {
      const { orders } = await inboxCall("/pending");
      if (!orders.length) return;
      for (const item of orders) addSiteOrder(item);
      await store.save();
      await inboxCall("/ack", { ids: orders.map((item) => item.id) });
    } catch (error) {
      log.error(`Не удалось забрать заявки с сайта: ${error.cause?.code ?? error.message}`);
      siteNotBefore = now() + LIMITS.siteRetryMs;
    }
  }

  function appendTask(draft, text) {
    const { task } = draft.answers;
    const joined = task && task !== TEXT.taskInAttachment ? `${task}\n\n${text}` : text;
    draft.answers.task = cut(joined, LIMITS.task);
    return joined.length <= LIMITS.task;
  }

  async function finishContact(chatId, draft, value) {
    draft.answers.contact = value;
    await send(chatId, TEXT.contactSaved, { reply_markup: { remove_keyboard: true } });
    await goNext(chatId, draft);
  }

  async function onDraftAttachment(msg, draft) {
    const chatId = msg.chat.id;
    const sameAlbum = Boolean(msg.media_group_id) && msg.media_group_id === draft.album;
    const caption = msg.caption?.trim();
    const hasRoom = draft.attachments.length < LIMITS.attachments;
    draft.album = msg.media_group_id ?? null;
    if (hasRoom) draft.attachments.push(msg.message_id);
    if (draft.step === "task" && !sameAlbum) {
      draft.answers.task = caption ? cut(caption, LIMITS.task) : (draft.answers.task ?? TEXT.taskInAttachment);
      await goNext(chatId, draft);
      return;
    }
    if (caption) appendTask(draft, caption);
    if (sameAlbum) return;
    await send(chatId, hasRoom ? TEXT.attachmentAdded : TEXT.attachmentLimit);
    await ask(chatId, draft);
  }

  async function onDraftMessage(msg, draft) {
    const chatId = msg.chat.id;
    const { step, answers } = draft;
    draft.updatedAt = isoNow();
    if (ATTACHMENT_KINDS.some((kind) => msg[kind])) {
      await onDraftAttachment(msg, draft);
      return;
    }
    if (step === "contact" && msg.contact) {
      const phone = msg.contact.phone_number;
      await finishContact(chatId, draft, phone.startsWith("+") ? phone : `+${phone}`);
      return;
    }
    const text = msg.text?.trim();
    if (!text) {
      await send(chatId, TEXT.unsupported);
      await ask(chatId, draft);
    } else if (step === "task") {
      answers.task = cut(text, LIMITS.task);
      await goNext(chatId, draft);
    } else if (text.length > LIMITS.short) {
      const fits = appendTask(draft, text);
      await send(chatId, fits ? TEXT.addedToTask : TEXT.taskTooLong);
      await ask(chatId, draft);
    } else if (step === "name") {
      answers.name = cut(text, LIMITS.name);
      await goNext(chatId, draft);
    } else if (step === "contact") {
      if (text === TEXT.contactHere) await finishContact(chatId, draft, TEXT.contactInChat);
      else if (looksLikeContact(text)) await finishContact(chatId, draft, text);
      else await send(chatId, TEXT.contactInvalid);
    } else {
      await send(chatId, TEXT.useButtons);
      await ask(chatId, draft);
    }
  }

  async function relayFromClient(msg, order) {
    const chatId = msg.chat.id;
    const since = now() - LIMITS.relayWindowMs;
    const times = (relayTimes.get(chatId) ?? []).filter((time) => time > since);
    times.push(now());
    relayTimes.set(chatId, times);
    if (times.length > LIMITS.relayCount) {
      if (times.length === LIMITS.relayCount + 1) await send(chatId, TEXT.relayLimit);
      return;
    }
    order.outbox.push({ copy: msg.message_id });
    order.updatedAt = isoNow();
    await like(msg);
  }

  async function relayToClient(msg, order) {
    if (!order.client.chatId) {
      await send(msg.chat.id, TEXT.siteOrderReply, replyTo(msg));
      return;
    }
    try {
      await telegram.call("copyMessage", {
        chat_id: order.client.chatId,
        from_chat_id: msg.chat.id,
        message_id: msg.message_id,
      });
      order.updatedAt = isoNow();
      await like(msg);
    } catch (error) {
      log.warn(`Ответ по заявке №${order.id} не доставлен: ${describeError(error)}`);
      await send(msg.chat.id, error.code === 403 ? TEXT.clientBlocked : TEXT.replyFailed, replyTo(msg));
    }
  }

  async function sendClientOrders(chatId) {
    const lines = state.orders
      .filter((order) => order.client.chatId === chatId)
      .slice(-10)
      .map((order) => `№${order.id} · ${STATUS[order.status]} · ${brief(order.answers.task, 60)}`);
    await send(chatId, lines.length ? [TEXT.myOrders, ...lines].join("\n") : TEXT.noOrders);
  }

  async function sendOpenOrders(chatId) {
    const lines = state.orders
      .filter(isOpen)
      .slice(-30)
      .map((order) => {
        const { name, task } = order.answers;
        return `/order_${order.id} · ${STATUS[order.status]} · ${brief(name, 40)} · ${brief(task, 40)}`;
      });
    await send(chatId, lines.length ? [TEXT.openOrders, ...lines].join("\n") : TEXT.noOpenOrders);
  }

  async function resendCard(chatId, id) {
    const order = findOrder(id);
    if (!order) {
      await send(chatId, TEXT.orderMissing);
      return;
    }
    const sent = await send(chatId, renderCard(order), withMarkup(cardKeyboard(order)));
    order.cardMessageId = sent.message_id;
    state.links[sent.message_id] = order.id;
  }

  function forgetOrder(id) {
    const order = findOrder(id);
    if (!order) return false;
    state.orders = state.orders.filter((item) => item !== order);
    for (const [messageId, linked] of Object.entries(state.links)) {
      if (linked === id) delete state.links[messageId];
    }
    const { chatId } = order.client;
    if (!state.orders.some((item) => item.client.chatId === chatId)) delete state.consents[chatId];
    return true;
  }

  async function onManagerMessage(msg, command) {
    const chatId = msg.chat.id;
    if (command?.name === "orders") {
      await sendOpenOrders(chatId);
      return true;
    }
    const wanted = command?.name.match(/^order_(\d+)$/);
    if (wanted) {
      await resendCard(chatId, Number(wanted[1]));
      return true;
    }
    const doomed = command?.name.match(/^delete_(\d+)$/);
    if (doomed) {
      await send(chatId, forgetOrder(Number(doomed[1])) ? TEXT.orderDeleted : TEXT.orderMissing);
      return true;
    }
    const replied = msg.reply_to_message;
    const order = replied && findOrder(state.links[replied.message_id]);
    if (order) {
      await relayToClient(msg, order);
      return true;
    }
    if (replied?.from?.id === me.id && msg.chat.type !== "private") {
      await send(chatId, TEXT.replyNotLinked, replyTo(msg));
      return true;
    }
    return false;
  }

  async function onClientCommand(msg, command, draft) {
    const chatId = msg.chat.id;
    const removeKeyboard = { reply_markup: { remove_keyboard: true } };
    switch (command.name) {
      case "start":
        if (draft) {
          await send(chatId, TEXT.resume);
          await ask(chatId, draft);
        } else if (latestOpenOrder(chatId)) {
          await send(chatId, TEXT.hasOpenOrder(latestOpenOrder(chatId)));
        } else {
          await beginOrder(msg);
        }
        break;
      case "new":
        await beginOrder(msg);
        break;
      case "cancel":
        delete state.drafts[chatId];
        await send(chatId, draft ? TEXT.cancelled : TEXT.nothingToCancel, removeKeyboard);
        break;
      case "orders":
        await sendClientOrders(chatId);
        break;
      case "help":
        await send(chatId, helpText());
        break;
      case "privacy":
        await send(chatId, privacyText(policyUrl));
        break;
      default:
        await send(chatId, TEXT.unknownCommand);
    }
  }

  async function onClientMessage(msg, command) {
    const chatId = msg.chat.id;
    const draft = state.drafts[chatId];
    if (command) {
      await onClientCommand(msg, command, draft);
    } else if (RELAYED_KINDS.some((kind) => msg[kind])) {
      const order = latestOpenOrder(chatId);
      if (draft) await onDraftMessage(msg, draft);
      else if (order) await relayFromClient(msg, order);
      else await send(chatId, TEXT.idle);
    }
  }

  const showManagerCommands = () =>
    quietly("setMyCommands", { commands: MANAGER_COMMANDS, scope: { type: "chat", chat_id: managerChatId } });

  async function claimManager(msg) {
    if (managerChatId !== null || !managerLogin || msg.chat.type !== "private") return;
    if (msg.from?.username?.toLowerCase() !== managerLogin) return;
    managerChatId = msg.chat.id;
    state.managerChatId = managerChatId;
    await store.save();
    log.info(`Чат менеджера назначен: ${managerChatId}.`);
    await showManagerCommands();
    await send(managerChatId, TEXT.managerAssigned);
  }

  async function onMessage(msg) {
    const command = parseCommand(msg);
    if (command?.foreign) return;
    await claimManager(msg);
    if (command?.name === "id") {
      await send(msg.chat.id, TEXT.chatId(msg.chat.id, managerChatId === null));
      return;
    }
    if (msg.chat.id === managerChatId && (await onManagerMessage(msg, command))) return;
    if (msg.chat.type === "private") await onClientMessage(msg, command);
  }

  async function onConsentTap(message, draft, answer) {
    if (draft.step !== "consent") return TEXT.staleButton;
    const chatId = message.chat.id;
    if (answer === "yes") {
      state.consents[chatId] = isoNow();
      await markAnswered(message, consentText(policyUrl), TEXT.consentYes);
      await goNext(chatId, draft);
    } else {
      delete state.drafts[chatId];
      await markAnswered(message, consentText(policyUrl), TEXT.consentNo);
      await send(chatId, TEXT.consentDeclined);
    }
    return undefined;
  }

  async function onNameTap(message, draft) {
    if (draft.step !== "name") return TEXT.staleButton;
    draft.answers.name = cut(draft.client.firstName, LIMITS.name);
    await markAnswered(message, QUESTIONS.name, draft.answers.name);
    await goNext(message.chat.id, draft);
    return undefined;
  }

  async function onReviewTap(message, draft, action) {
    if (draft.step !== "review") return TEXT.staleButton;
    const chatId = message.chat.id;
    if (action === "send") {
      const order = createOrder(chatId, draft);
      await store.save();
      await editButtons(message);
      await send(chatId, TEXT.accepted(order.id));
    } else if (action === "cancel") {
      delete state.drafts[chatId];
      await editButtons(message);
      await send(chatId, TEXT.cancelled);
    } else {
      await editButtons(message, action === "edit" ? editKeyboard() : reviewKeyboard());
    }
    return undefined;
  }

  async function onEditTap(message, draft, name) {
    if (draft.step !== "review" || !EDITABLE.includes(name)) return TEXT.staleButton;
    draft.step = name;
    draft.backToReview = true;
    await editButtons(message);
    await ask(message.chat.id, draft);
    return undefined;
  }

  async function onManagerAction(cb, id, action) {
    const { message } = cb;
    if (message.chat.id !== managerChatId) return TEXT.notAllowed;
    const order = findOrder(id);
    if (!order) return TEXT.orderMissing;
    if (action === "back") {
      await editButtons(message, cardKeyboard(order));
      return undefined;
    }
    const asked = action.startsWith("ask-") ? action.slice(4) : null;
    const move = TRANSITIONS[asked ?? action];
    if (!move?.from.includes(order.status)) {
      await editCard(message, order);
      return TEXT.alreadyChanged;
    }
    if (asked) {
      await editButtons(message, cardKeyboard(order, asked));
      return undefined;
    }
    order.status = move.to;
    order.manager = cb.from.first_name;
    order.updatedAt = isoNow();
    await store.save();
    await editCard(message, order);
    if (!order.client.chatId) return STATUS[order.status];
    try {
      await telegram.call("sendMessage", { chat_id: order.client.chatId, text: TEXT.statusNotice[order.status](order.id) });
      return STATUS[order.status];
    } catch (error) {
      log.warn(`Клиент по заявке №${order.id} не получил уведомление: ${describeError(error)}`);
      return TEXT.clientNotNotified;
    }
  }

  async function routeCallback(cb) {
    const { message } = cb;
    if (!message) return undefined;
    const [scope, first, second] = (cb.data ?? "").split(":");
    if (scope === "o") return onManagerAction(cb, Number(first), second ?? "");
    const draft = state.drafts[message.chat.id];
    if (!draft) return TEXT.staleButton;
    draft.updatedAt = isoNow();
    if (scope === "c") return onConsentTap(message, draft, first);
    if (scope === "n") return onNameTap(message, draft);
    if (scope === "r") return onReviewTap(message, draft, first);
    if (scope === "e") return onEditTap(message, draft, first);
    return TEXT.staleButton;
  }

  async function onCallback(cb) {
    let notice;
    try {
      notice = await routeCallback(cb);
    } finally {
      await quietly("answerCallbackQuery", { callback_query_id: cb.id, ...(notice ? { text: notice } : {}) });
    }
  }

  async function processUpdate(update) {
    if (state.seenUpdates.includes(update.update_id)) return;
    try {
      if (update.message) await onMessage(update.message);
      else if (update.callback_query) await onCallback(update.callback_query);
    } catch (error) {
      log.error(`Ошибка при обработке обновления ${update.update_id}: ${describeError(error)}`);
    }
    state.seenUpdates.push(update.update_id);
    state.seenUpdates.splice(0, state.seenUpdates.length - LIMITS.seenUpdates);
    await store.save();
  }

  async function deliverCard(order) {
    const once = { attempts: 1 };
    const card = {
      chat_id: managerChatId,
      text: renderCard(order),
      parse_mode: "HTML",
      link_preview_options: { is_disabled: true },
      ...withMarkup(cardKeyboard(order)),
    };
    const sent = await telegram.call("sendMessage", card, once).catch((error) => {
      if (error.code !== 400) throw error;
      log.error(`Карточку заявки №${order.id} Telegram не принял, отправляем простым текстом: ${describeError(error)}`);
      return telegram.call("sendMessage", { chat_id: managerChatId, text: renderPlainCard(order) }, once);
    });
    order.cardMessageId = sent.message_id;
    state.links[sent.message_id] = order.id;
    await store.save();
  }

  async function deliverNext(order) {
    const [item] = order.outbox;
    const target = {
      chat_id: managerChatId,
      reply_parameters: { message_id: order.cardMessageId, allow_sending_without_reply: true },
    };
    const once = { attempts: 1 };
    try {
      const sent = item.copy
        ? await telegram.call("copyMessage", { ...target, from_chat_id: order.client.chatId, message_id: item.copy }, once)
        : await telegram.call("sendMessage", { ...target, text: item.text, link_preview_options: { is_disabled: true } }, once);
      state.links[sent.message_id] = order.id;
    } catch (error) {
      if (isTransient(error) || !item.copy) throw error;
      await telegram.call("sendMessage", { ...target, text: TEXT.copyFailed(order.id) }, once);
    }
    order.outbox.shift();
    await store.save();
  }

  async function flushOutbox() {
    if (managerChatId === null || now() < flushNotBefore) return;
    for (const order of state.orders) {
      if (order.cardMessageId && !order.outbox.length) continue;
      try {
        if (!order.cardMessageId) await deliverCard(order);
        while (order.outbox.length) await deliverNext(order);
      } catch (error) {
        log.error(`Заявка №${order.id} не доставлена менеджеру, повторим позже: ${describeError(error)}`);
        flushNotBefore = now() + (error.retryAfter ? error.retryAfter * 1000 : LIMITS.flushRetryMs);
        if (isTransient(error)) return;
      }
    }
  }

  function purgeExpired() {
    const drafts = Object.keys(state.drafts).filter((chatId) => Date.parse(state.drafts[chatId].updatedAt) < now() - LIMITS.draftMs);
    const orders = state.orders.filter((order) => Date.parse(order.updatedAt) < now() - LIMITS.orderMs);
    for (const chatId of drafts) delete state.drafts[chatId];
    for (const order of orders) forgetOrder(order.id);
    return drafts.length + orders.length > 0;
  }

  const backoff = (failures) => Math.min(backoffMs * 2 ** failures, LIMITS.maxBackoffMs);

  async function connect(signal) {
    for (let failures = 0; !signal.aborted; failures += 1) {
      try {
        return await telegram.call("getMe", {}, { attempts: 1, signal });
      } catch (error) {
        if (isFatal(error)) throw error;
        if (signal.aborted) break;
        log.error(`Telegram недоступен, повторим: ${describeError(error)}. Если сервер не достаёт до api.telegram.org, нужен TELEGRAM_API_ROOT.`);
        await sleep(backoff(failures), signal);
      }
    }
    return null;
  }

  async function configure() {
    await quietly("deleteWebhook", {});
    await quietly("setMyCommands", { commands: CLIENT_COMMANDS });
    await quietly("setMyDescription", { description: PROFILE.description });
    await quietly("setMyShortDescription", { short_description: PROFILE.shortDescription });
    if (managerChatId === null) {
      log.warn(
        managerLogin
          ? `Чат менеджера назначится сам после первого сообщения боту от @${managerLogin}. Заявки пока копятся.`
          : "MANAGER_CHAT_ID не задан: заявки копятся и уйдут менеджеру после настройки. Узнать ID: команда /id в чате с ботом.",
      );
      return;
    }
    await showManagerCommands();
    const chat = await quietly("getChat", { chat_id: managerChatId });
    if (!chat) log.warn(`Чат менеджера ${managerChatId} недоступен: напишите боту /start с этого аккаунта или добавьте бота в группу.`);
  }

  async function run({ signal }) {
    me = await connect(signal);
    if (!me) return;
    await configure();
    log.info(`Бот @${me.username} запущен.`);

    let offset;
    let failures = 0;
    while (!signal.aborted) {
      let updates;
      try {
        updates = await telegram.call(
          "getUpdates",
          { offset, timeout: pollTimeout, allowed_updates: ["message", "callback_query"] },
          { attempts: 1, timeoutMs: (pollTimeout + 15) * 1000, signal },
        );
        failures = 0;
      } catch (error) {
        if (isFatal(error)) throw error;
        if (signal.aborted) break;
        const reason = error.code === 409 ? "этим токеном пользуется ещё одна копия бота" : describeError(error);
        log.error(`Не удалось получить обновления: ${reason}`);
        await sleep(error.retryAfter ? error.retryAfter * 1000 : backoff(failures), signal);
        failures += 1;
        continue;
      }
      // Смещение нужно только для подтверждения последней пачки. После недели тишины Telegram
      // выдаёт новым обновлениям случайные номера, и старое смещение могло бы отбросить заявку.
      offset = updates.length ? updates.at(-1).update_id + 1 : undefined;
      for (const update of updates) await processUpdate(update);
      await pullSiteOrders();
      await flushOutbox();
      if (purgeExpired()) await store.save();
    }
    await store.save();
  }

  return { run };
}
