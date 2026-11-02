import http from "node:http";

const BOT = { id: 42, is_bot: true, first_name: "Заявки", username: "test_bot" };
const WAIT_MS = 8000;
const HTML_TAGS = new Set(["b", "strong", "i", "em", "u", "ins", "s", "strike", "del", "a", "code", "pre", "blockquote"]);
const HTML_ENTITIES = { lt: "<", gt: ">", amp: "&", quot: '"' };

class ApiError extends Error {
  constructor(code, description, parameters) {
    super(description);
    this.code = code;
    this.parameters = parameters;
  }
}

const bad = (description) => new ApiError(400, `Bad Request: ${description}`);

function parseHtml(source) {
  const open = [];
  let plain = "";
  let index = 0;
  while (index < source.length) {
    const char = source[index];
    if (char === "<") {
      const end = source.indexOf(">", index);
      if (end < 0) throw bad("can't parse entities: unclosed tag");
      const inner = source.slice(index + 1, end);
      const closing = inner.startsWith("/");
      const name = (closing ? inner.slice(1) : inner).trim().split(/\s+/)[0].toLowerCase();
      if (!HTML_TAGS.has(name)) throw bad(`can't parse entities: unsupported tag "${name}"`);
      if (closing) {
        if (open.pop() !== name) throw bad(`can't parse entities: unmatched end tag "${name}"`);
      } else {
        if (name === "a" && !/^a\s+href="[^"<>]+"$/.test(inner)) throw bad("can't parse entities: wrong href");
        open.push(name);
      }
      index = end + 1;
    } else if (char === "&") {
      const match = /^&(lt|gt|amp|quot);/.exec(source.slice(index, index + 6));
      if (!match) throw bad("can't parse entities: bare ampersand");
      plain += HTML_ENTITIES[match[1]];
      index += match[0].length;
    } else if (char === ">") {
      throw bad("can't parse entities: bare >");
    } else {
      plain += char;
      index += 1;
    }
  }
  if (open.length) throw bad(`can't parse entities: can't find end tag for "${open.at(-1)}"`);
  return plain;
}

function readText(params) {
  if (typeof params.text !== "string") throw bad("message text is empty");
  if (params.parse_mode && params.parse_mode !== "HTML") throw bad("unsupported parse_mode");
  if (!params.text.isWellFormed()) throw bad("strings must be encoded in UTF-8");
  const plain = params.parse_mode ? parseHtml(params.text) : params.text;
  if (!plain.trim()) throw bad("message text is empty");
  if (plain.length > 4096) throw bad("message is too long");
  return plain;
}

function checkMarkup(markup, { inlineOnly = false } = {}) {
  if (markup === undefined) return;
  if (markup.inline_keyboard) {
    for (const row of markup.inline_keyboard) {
      for (const button of row) {
        if (!button.text) throw bad("inline keyboard button text is empty");
        const size = Buffer.byteLength(button.callback_data ?? "");
        if (size < 1 || size > 64) throw bad("BUTTON_DATA_INVALID");
      }
    }
    return;
  }
  if (inlineOnly) throw bad("inline keyboard expected");
  if (markup.keyboard) {
    if (!markup.keyboard.length) throw bad("keyboard must not be empty");
    for (const row of markup.keyboard) {
      for (const button of row) if (!button.text) throw bad("keyboard button text is empty");
    }
    return;
  }
  if (markup.remove_keyboard !== true) throw bad("can't parse reply keyboard markup JSON object");
}

export async function startFakeTelegram({ token = "123456:TEST-TOKEN" } = {}) {
  const calls = [];
  const chats = new Map();
  const failures = [];
  const hooks = [];
  const blocked = new Set();
  const replyKeyboards = new Map();
  const pendingCallbacks = new Set();
  const callbackAnswers = new Map();
  let queue = [];
  let held = null;
  let idleWaiters = [];
  let nextUpdateId = 5000;
  let nextMessageId = 100;
  let nextCallbackId = 1;

  const messagesOf = (chatId) => {
    if (!chats.has(chatId)) throw bad("chat not found");
    return chats.get(chatId);
  };
  const findMessage = (chatId, id) => messagesOf(chatId).find((message) => message.message_id === id);

  const reply = (res, result) => {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: true, result }));
  };
  const replyError = (res, error) => {
    res.writeHead(error.code, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: false, error_code: error.code, description: error.message, parameters: error.parameters }));
  };

  function checkTarget(chatId) {
    if (blocked.has(chatId)) throw new ApiError(403, "Forbidden: bot was blocked by the user");
    messagesOf(chatId);
  }

  function checkReply(params) {
    const target = params.reply_parameters;
    if (!target || target.allow_sending_without_reply || findMessage(params.chat_id, target.message_id)) return;
    throw bad("message to be replied not found");
  }

  function deliver(chatId, fields) {
    const message = { message_id: nextMessageId, from: BOT, chat: { id: chatId, type: chatId < 0 ? "supergroup" : "private" }, date: 0, ...fields };
    nextMessageId += 1;
    messagesOf(chatId).push(message);
    return message;
  }

  function editedMessage(params) {
    const message = findMessage(params.chat_id, params.message_id);
    if (!message) throw bad("message to edit not found");
    return message;
  }

  const METHODS = {
    getMe: () => BOT,
    deleteWebhook: () => true,
    setMyCommands({ commands }) {
      for (const { command, description } of commands) {
        if (!/^[a-z0-9_]{1,32}$/.test(command)) throw bad("BOT_COMMAND_INVALID");
        if (!description || description.length > 256) throw bad("BOT_COMMAND_DESCRIPTION_INVALID");
      }
      return true;
    },
    setMyDescription({ description }) {
      if (description.length > 512) throw bad("description is too long");
      return true;
    },
    setMyShortDescription({ short_description: description }) {
      if (description.length > 120) throw bad("short description is too long");
      return true;
    },
    getChat({ chat_id: chatId }) {
      messagesOf(chatId);
      return { id: chatId, type: chatId < 0 ? "supergroup" : "private" };
    },
    sendMessage(params) {
      checkTarget(params.chat_id);
      const text = readText(params);
      checkMarkup(params.reply_markup);
      checkReply(params);
      const markup = params.reply_markup;
      if (markup?.keyboard) replyKeyboards.set(params.chat_id, markup.keyboard);
      if (markup?.remove_keyboard) replyKeyboards.delete(params.chat_id);
      return deliver(params.chat_id, {
        text,
        html: params.text,
        reply_markup: markup?.inline_keyboard ? markup : undefined,
        reply_parameters: params.reply_parameters,
      });
    },
    editMessageText(params) {
      const message = editedMessage(params);
      const text = readText(params);
      checkMarkup(params.reply_markup, { inlineOnly: true });
      if (message.text === text && JSON.stringify(message.reply_markup) === JSON.stringify(params.reply_markup)) {
        throw bad("message is not modified");
      }
      Object.assign(message, { text, html: params.text, reply_markup: params.reply_markup });
      return message;
    },
    editMessageReplyMarkup(params) {
      const message = editedMessage(params);
      checkMarkup(params.reply_markup, { inlineOnly: true });
      if (JSON.stringify(message.reply_markup) === JSON.stringify(params.reply_markup)) {
        throw bad("message is not modified");
      }
      message.reply_markup = params.reply_markup;
      return message;
    },
    answerCallbackQuery({ callback_query_id: id, text }) {
      if (!pendingCallbacks.delete(id)) throw bad("query is too old and response timeout expired or query ID is invalid");
      if (text && text.length > 200) throw bad("MESSAGE_TOO_LONG");
      callbackAnswers.set(id, text);
      return true;
    },
    copyMessage(params) {
      checkTarget(params.chat_id);
      const source = findMessage(params.from_chat_id, params.message_id);
      if (!source) throw bad("message to copy not found");
      checkReply(params);
      const { message_id: id, from, chat, date, reply_to_message: replied, reply_markup: markup, reply_parameters: threaded, ...content } = source;
      const copy = deliver(params.chat_id, { ...content, copied_from: id, reply_parameters: params.reply_parameters });
      return { message_id: copy.message_id };
    },
    setMessageReaction(params) {
      const message = findMessage(params.chat_id, params.message_id);
      if (!message) throw bad("message to react not found");
      const [reaction] = params.reaction;
      if (reaction.type !== "emoji" || !reaction.emoji) throw bad("REACTION_INVALID");
      message.reaction = reaction.emoji;
      return true;
    },
  };

  const confirm = (offset) => {
    queue = queue.filter((update) => update.update_id >= offset);
  };

  function releaseIdle() {
    const waiters = idleWaiters;
    idleWaiters = [];
    for (const waiter of waiters) waiter();
  }

  function releaseHeld(updates) {
    const { res, timer } = held;
    clearTimeout(timer);
    held = null;
    reply(res, updates);
  }

  function getUpdates(params, res) {
    if (held) {
      const { res: previous, timer } = held;
      clearTimeout(timer);
      held = null;
      replyError(previous, new ApiError(409, "Conflict: terminated by other getUpdates request"));
    }
    if (params.offset !== undefined) confirm(params.offset);
    if (queue.length) {
      reply(res, queue);
      return;
    }
    const timer = setTimeout(() => releaseHeld([]), (params.timeout ?? 0) * 1000);
    timer.unref();
    held = { res, timer, offset: params.offset };
    res.on("close", () => {
      if (held?.res === res) {
        clearTimeout(timer);
        held = null;
      }
    });
    releaseIdle();
  }

  function handle(req, res, raw) {
    const match = /^\/bot([^/]+)\/(\w+)$/.exec(req.url);
    if (!match) {
      replyError(res, new ApiError(404, "Not Found"));
      return;
    }
    if (match[1] !== token) {
      replyError(res, new ApiError(401, "Unauthorized"));
      return;
    }
    const method = match[2];
    const params = raw ? JSON.parse(raw) : {};
    calls.push({ method, params });
    for (const hook of [...hooks]) {
      if (hook(method, params)) hooks.splice(hooks.indexOf(hook), 1);
    }
    const rule = failures.find((item) => item.method === method && item.times > 0 && (!item.when || item.when(params)));
    if (rule) {
      rule.times -= 1;
      if (rule.network) {
        req.socket.destroy();
        return;
      }
      const parameters = rule.retryAfter ? { retry_after: rule.retryAfter } : undefined;
      replyError(res, new ApiError(rule.code, rule.description ?? "Injected failure", parameters));
      return;
    }
    if (method === "getUpdates") {
      getUpdates(params, res);
      return;
    }
    const handler = METHODS[method];
    if (!handler) {
      replyError(res, new ApiError(404, "Not Found: method not found"));
      return;
    }
    try {
      reply(res, handler(params));
    } catch (error) {
      if (!(error instanceof ApiError)) throw error;
      replyError(res, error);
    }
  }

  const server = http.createServer((req, res) => {
    let raw = "";
    req.setEncoding("utf8");
    req.on("data", (chunk) => {
      raw += chunk;
    });
    req.on("end", () => handle(req, res, raw));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));

  function idle() {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("Бот не вернулся к опросу за отведённое время")), WAIT_MS);
      idleWaiters.push(() => {
        clearTimeout(timer);
        resolve();
      });
    });
  }

  function push(update, updateId) {
    queue.push({ update_id: updateId ?? nextUpdateId, ...update });
    nextUpdateId += 1;
    if (!held) return;
    if (held.offset !== undefined) confirm(held.offset);
    if (queue.length) releaseHeld(queue);
  }

  async function tick() {
    const waiter = idle();
    if (held) releaseHeld([]);
    await waiter;
  }

  function user(profile, { chatId = profile.id, chatType = "private" } = {}) {
    const chat = { id: chatId, type: chatType };
    const from = { is_bot: false, ...profile };
    if (!chats.has(chatId)) chats.set(chatId, []);

    function post(fields, updateId) {
      const message = { message_id: nextMessageId, from, chat, date: 0, ...fields };
      nextMessageId += 1;
      chats.get(chatId).push(message);
      push({ message }, updateId);
      return message;
    }

    const command = (text) => {
      const match = /^\/[A-Za-z0-9_]+(@\w+)?/.exec(text);
      return match ? { entities: [{ type: "bot_command", offset: 0, length: match[0].length }] } : {};
    };

    function postTap(message, data) {
      const id = String(nextCallbackId);
      nextCallbackId += 1;
      pendingCallbacks.add(id);
      push({ callback_query: { id, from, message, data, chat_instance: "fake" } });
      return id;
    }

    const findButton = (label) => {
      for (const message of [...chats.get(chatId)].reverse()) {
        const button = message.reply_markup?.inline_keyboard?.flat().find((item) => item.text === label);
        if (button) return { message, button };
      }
      return null;
    };

    const api = {
      from,
      chatId,
      post,
      postTap,
      findButton,
      async send(fields) {
        const waiter = idle();
        const message = post(fields);
        await waiter;
        return message;
      },
      say(text, extra = {}) {
        return api.send({ text, ...command(text), ...extra });
      },
      reply(target, text) {
        return api.say(text, { reply_to_message: target });
      },
      async tapData(message, data) {
        const waiter = idle();
        const id = postTap(message, data);
        await waiter;
        if (pendingCallbacks.has(id)) throw new Error(`Бот не ответил на нажатие ${data}`);
        return callbackAnswers.get(id);
      },
      tap(label) {
        const found = findButton(label);
        if (!found) throw new Error(`В чате ${chatId} нет кнопки «${label}». Последнее сообщение: ${api.lastText()}`);
        return api.tapData(found.message, found.button.callback_data);
      },
      messages: () => chats.get(chatId),
      botMessages: () => chats.get(chatId).filter((message) => message.from === BOT),
      lastText: () => chats.get(chatId).filter((message) => message.from === BOT).at(-1)?.text,
    };
    return api;
  }

  return {
    token,
    url: `http://127.0.0.1:${server.address().port}`,
    calls,
    idle,
    tick,
    user,
    push,
    failNext: (method, rule) => failures.push({ method, times: 1, ...rule }),
    onCall: (hook) => hooks.push(hook),
    block: (chatId) => blocked.add(chatId),
    unblock: (chatId) => blocked.delete(chatId),
    forgetMessage(chatId, messageId) {
      chats.set(chatId, messagesOf(chatId).filter((message) => message.message_id !== messageId));
    },
    replyKeyboard: (chatId) => replyKeyboards.get(chatId) ?? null,
    async close() {
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
    },
  };
}
