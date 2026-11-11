const crypto = require("crypto");
const express = require("express");
const pool = require("./db");

const app = express();
const PORT = process.env.PORT || 3000;

const APP_USERNAME = process.env.APP_USERNAME || "";
const APP_PASSWORD = process.env.APP_PASSWORD || "";
const SESSION_SECRET = process.env.SESSION_SECRET || "";
const SESSION_COOKIE = "shift_session";
const SESSION_DURATION_SECONDS = 60 * 60 * 12;
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const MAX_LOGIN_ATTEMPTS = 10;
const loginAttempts = new Map();
const isProduction = process.env.RENDER === "true" || process.env.NODE_ENV === "production";
const authIsConfigured = Boolean(
  APP_USERNAME && APP_PASSWORD && SESSION_SECRET.length >= 32,
);

app.set("trust proxy", 1);
app.use(express.json({ limit: "20kb" }));
app.use("/api", (req, res, next) => {
  res.setHeader("Cache-Control", "no-store");
  next();
});

function safeCompare(value, expected) {
  if (typeof value !== "string" || typeof expected !== "string") {
    return false;
  }

  const valueBuffer = Buffer.from(value);
  const expectedBuffer = Buffer.from(expected);

  return (
    valueBuffer.length === expectedBuffer.length &&
    crypto.timingSafeEqual(valueBuffer, expectedBuffer)
  );
}

function getCookie(req, name) {
  const cookieHeader = req.headers.cookie || "";

  for (const cookie of cookieHeader.split(";")) {
    const separatorIndex = cookie.indexOf("=");
    if (separatorIndex === -1) continue;

    const cookieName = cookie.slice(0, separatorIndex).trim();
    if (cookieName === name) {
      return cookie.slice(separatorIndex + 1).trim();
    }
  }

  return "";
}

function signPayload(encodedPayload) {
  return crypto
    .createHmac("sha256", SESSION_SECRET)
    .update(encodedPayload)
    .digest("base64url");
}

function createSessionToken() {
  const payload = Buffer.from(
    JSON.stringify({
      username: APP_USERNAME,
      expiresAt: Date.now() + SESSION_DURATION_SECONDS * 1000,
    }),
  ).toString("base64url");

  return `${payload}.${signPayload(payload)}`;
}

function getSession(req) {
  if (!authIsConfigured) return null;

  const token = getCookie(req, SESSION_COOKIE);
  const parts = token.split(".");
  if (parts.length !== 2 || !parts[0] || !parts[1]) return null;

  const [encodedPayload, suppliedSignature] = parts;
  const expectedSignature = signPayload(encodedPayload);
  if (!safeCompare(suppliedSignature, expectedSignature)) return null;

  try {
    const payload = JSON.parse(
      Buffer.from(encodedPayload, "base64url").toString("utf8"),
    );

    if (
      payload.username !== APP_USERNAME ||
      !Number.isFinite(payload.expiresAt) ||
      payload.expiresAt <= Date.now()
    ) {
      return null;
    }

    return payload;
  } catch {
    return null;
  }
}

function setSessionCookie(res, token) {
  const secure = isProduction ? "; Secure" : "";
  res.setHeader(
    "Set-Cookie",
    `${SESSION_COOKIE}=${token}; Max-Age=${SESSION_DURATION_SECONDS}; Path=/; HttpOnly; SameSite=Lax${secure}`,
  );
}

function clearSessionCookie(res) {
  const secure = isProduction ? "; Secure" : "";
  res.setHeader(
    "Set-Cookie",
    `${SESSION_COOKIE}=; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT; Path=/; HttpOnly; SameSite=Lax${secure}`,
  );
}

function getAttemptRecord(key) {
  const now = Date.now();
  let record = loginAttempts.get(key);

  if (!record || record.resetAt <= now) {
    record = { count: 0, resetAt: now + LOGIN_WINDOW_MS };
    loginAttempts.set(key, record);
  }

  return record;
}

function limitLoginAttempts(req, res, next) {
  const key = req.ip || req.socket.remoteAddress || "unknown";
  const record = getAttemptRecord(key);

  if (record.count >= MAX_LOGIN_ATTEMPTS) {
    return res.status(429).json({
      message: "Слишком много попыток входа. Попробуй позже.",
    });
  }

  req.loginAttemptKey = key;
  next();
}

function requireAuth(req, res, next) {
  if (!authIsConfigured) {
    return res.status(503).json({
      message: "Вход не настроен на сервере.",
    });
  }

  if (!getSession(req)) {
    return res.status(401).json({
      message: "Сначала войди в журнал смены.",
    });
  }

  next();
}

app.get("/api/health", (req, res) => {
  res.json({
    status: "ok",
    message: "Сервер журнала смены работает",
  });
});

app.get("/api/auth/status", (req, res) => {
  res.json({ authenticated: Boolean(getSession(req)) });
});

app.post("/api/auth/login", limitLoginAttempts, (req, res) => {
  if (!authIsConfigured) {
    return res.status(503).json({
      message:
        "Вход ещё не настроен. Добавь APP_USERNAME, APP_PASSWORD и SESSION_SECRET в переменные окружения сервера.",
    });
  }

  const { username, password } = req.body || {};
  const usernameMatches = safeCompare(username, APP_USERNAME);
  const passwordMatches = safeCompare(password, APP_PASSWORD);

  if (!usernameMatches || !passwordMatches) {
    const record = getAttemptRecord(req.loginAttemptKey);
    record.count += 1;

    return res.status(401).json({
      message: "Неверный логин или пароль.",
    });
  }

  loginAttempts.delete(req.loginAttemptKey);
  setSessionCookie(res, createSessionToken());

  return res.json({ authenticated: true });
});

app.post("/api/auth/logout", (req, res) => {
  clearSessionCookie(res);
  return res.json({ authenticated: false });
});

app.get("/api/db-check", requireAuth, async (req, res) => {
  try {
    const result = await pool.query(
      "SELECT current_database() AS database_name",
    );

    res.json({
      status: "ok",
      database: result.rows[0].database_name,
    });
  } catch (error) {
    console.error("Ошибка подключения к PostgreSQL:", error.message);
    res.status(500).json({
      status: "error",
      message: "Не удалось подключиться к базе данных",
    });
  }
});

app.use("/api/notes", requireAuth);

// Получить записи за выбранный день
app.get("/api/notes", async (req, res) => {
  const selectedDate = req.query.date || null;

  if (selectedDate && !/^\d{4}-\d{2}-\d{2}$/.test(selectedDate)) {
    return res.status(400).json({
      message: "Дата должна быть в формате ГГГГ-ММ-ДД.",
    });
  }

  try {
    const result = await pool.query(
      `
        SELECT
          note.id,
          note.category,
          note.title,
          note.description AS text,
          note.status,
          note.created_at,
          shift.shift_date,
          shift.shift_type
        FROM handover_notes AS note
        JOIN shifts AS shift ON shift.id = note.shift_id
        WHERE shift.shift_date = COALESCE($1::date, CURRENT_DATE)
        ORDER BY note.created_at DESC
      `,
      [selectedDate],
    );

    return res.json(result.rows);
  } catch (error) {
    console.error("Ошибка загрузки записей:", error.message);
    return res.status(500).json({
      message: "Не удалось загрузить записи.",
    });
  }
});

// Создать запись
app.post("/api/notes", async (req, res) => {
  const { category, title, text, shiftType = "day" } = req.body || {};

  if (
    typeof category !== "string" ||
    typeof title !== "string" ||
    typeof text !== "string" ||
    !category.trim() ||
    !title.trim() ||
    !text.trim()
  ) {
    return res.status(400).json({
      message: "Укажи категорию, заголовок и подробности.",
    });
  }

  if (!["day", "evening"].includes(shiftType)) {
    return res.status(400).json({
      message: "Выбери дневную или вечернюю смену.",
    });
  }

  try {
    const shiftResult = await pool.query(
      `
        INSERT INTO shifts (shift_date, shift_type)
        VALUES (CURRENT_DATE, $1)
        ON CONFLICT (shift_date, shift_type)
        DO UPDATE SET shift_type = EXCLUDED.shift_type
        RETURNING id
      `,
      [shiftType],
    );

    const noteResult = await pool.query(
      `
        INSERT INTO handover_notes
          (shift_id, category, title, description)
        VALUES ($1, $2, $3, $4)
        RETURNING
          id,
          category,
          title,
          description AS text,
          status,
          created_at
      `,
      [shiftResult.rows[0].id, category.trim(), title.trim(), text.trim()],
    );

    return res.status(201).json({
      ...noteResult.rows[0],
      shift_type: shiftType,
    });
  } catch (error) {
    console.error("Ошибка создания записи:", error.message);
    return res.status(500).json({
      message: "Не удалось сохранить запись.",
    });
  }
});

// Открыть или закрыть запись
app.patch("/api/notes/:id/status", async (req, res) => {
  const noteId = Number(req.params.id);
  const { status } = req.body || {};

  if (!Number.isInteger(noteId) || noteId < 1) {
    return res.status(400).json({
      message: "Неверный номер записи.",
    });
  }

  if (status !== "open" && status !== "closed") {
    return res.status(400).json({
      message: "Статус должен быть open или closed.",
    });
  }

  try {
    const result = await pool.query(
      `
        UPDATE handover_notes
        SET
          status = $1,
          closed_at = CASE
            WHEN $1 = 'closed' THEN NOW()
            ELSE NULL
          END
        WHERE id = $2
        RETURNING id, category, title, status, closed_at
      `,
      [status, noteId],
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        message: "Запись не найдена.",
      });
    }

    return res.json(result.rows[0]);
  } catch (error) {
    console.error("Ошибка обновления записи:", error.message);
    return res.status(500).json({
      message: "Не удалось обновить запись.",
    });
  }
});

// Изменить запись
app.patch("/api/notes/:id", async (req, res) => {
  const noteId = Number(req.params.id);
  const { category, title, text } = req.body || {};

  if (!Number.isInteger(noteId) || noteId < 1) {
    return res.status(400).json({ message: "Некорректный номер записи." });
  }

  if (
    typeof category !== "string" ||
    typeof title !== "string" ||
    typeof text !== "string" ||
    !category.trim() ||
    !title.trim() ||
    !text.trim()
  ) {
    return res.status(400).json({
      message: "Укажи категорию, заголовок и подробности.",
    });
  }

  try {
    const updateResult = await pool.query(
      `
        UPDATE handover_notes
        SET category = $1,
            title = $2,
            description = $3
        WHERE id = $4
        RETURNING id
      `,
      [category.trim(), title.trim(), text.trim(), noteId],
    );

    if (updateResult.rowCount === 0) {
      return res.status(404).json({ message: "Запись не найдена." });
    }

    const noteResult = await pool.query(
      `
        SELECT
          note.id,
          note.category,
          note.title,
          note.description AS text,
          note.status,
          note.created_at,
          shift.shift_date,
          shift.shift_type
        FROM handover_notes AS note
        JOIN shifts AS shift ON shift.id = note.shift_id
        WHERE note.id = $1
      `,
      [noteId],
    );

    return res.json(noteResult.rows[0]);
  } catch (error) {
    console.error("Ошибка редактирования записи:", error.message);
    return res.status(500).json({
      message: "Не удалось изменить запись.",
    });
  }
});

// Удалить запись
app.delete("/api/notes/:id", async (req, res) => {
  const noteId = Number(req.params.id);

  if (!Number.isInteger(noteId) || noteId < 1) {
    return res.status(400).json({ message: "Некорректный номер записи." });
  }

  try {
    const result = await pool.query(
      "DELETE FROM handover_notes WHERE id = $1 RETURNING id",
      [noteId],
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ message: "Запись не найдена." });
    }

    return res.json({ id: result.rows[0].id });
  } catch (error) {
    console.error("Ошибка удаления записи:", error.message);
    return res.status(500).json({ message: "Не удалось удалить запись." });
  }
});

app.listen(PORT, () => {
  console.log(`Сервер журнала смены запущен на порту ${PORT}`);
});
