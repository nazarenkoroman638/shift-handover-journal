const crypto = require("crypto");
const { promisify } = require("util");
const express = require("express");
const pool = require("./db");

const app = express();
const PORT = process.env.PORT || 3000;
const scrypt = promisify(crypto.scrypt);

const APP_USERNAME = (process.env.APP_USERNAME || "").trim().toLowerCase();
const APP_PASSWORD = process.env.APP_PASSWORD || "";
const SESSION_SECRET = process.env.SESSION_SECRET || "";
const SESSION_COOKIE = "shift_session";
const SESSION_DURATION_SECONDS = 60 * 60 * 12;
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const MAX_LOGIN_ATTEMPTS = 10;
const loginAttempts = new Map();
const isProduction =
  process.env.RENDER === "true" || process.env.NODE_ENV === "production";
const authIsConfigured = Boolean(
  APP_USERNAME && APP_PASSWORD && SESSION_SECRET.length >= 32,
);

const NOTE_SELECT = [
  "SELECT note.id, note.category, note.title,",
  "note.description AS text, note.status, note.created_at,",
  "shift.shift_date, shift.shift_type,",
  "COALESCE(author.display_name, 'Старая запись') AS created_by_name",
  "FROM handover_notes AS note",
  "JOIN shifts AS shift ON shift.id = note.shift_id",
  "LEFT JOIN team_users AS author ON author.id = note.created_by",
].join(" ");

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

async function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString("hex");
  const derivedKey = await scrypt(password, salt, 64);
  return salt + ":" + derivedKey.toString("hex");
}

async function verifyPassword(password, storedHash) {
  if (typeof password !== "string" || typeof storedHash !== "string") {
    return false;
  }

  const separatorIndex = storedHash.indexOf(":");
  if (separatorIndex < 1) return false;

  const salt = storedHash.slice(0, separatorIndex);
  const expectedHex = storedHash.slice(separatorIndex + 1);
  const expected = Buffer.from(expectedHex, "hex");
  if (expected.length !== 64) return false;

  const actual = await scrypt(password, salt, 64);
  return crypto.timingSafeEqual(actual, expected);
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

function createSessionToken(user) {
  const payload = Buffer.from(
    JSON.stringify({
      userId: user.id,
      username: user.username,
      displayName: user.display_name,
      role: user.role,
      expiresAt: Date.now() + SESSION_DURATION_SECONDS * 1000,
    }),
  ).toString("base64url");

  return payload + "." + signPayload(payload);
}

function getSession(req) {
  if (!authIsConfigured) return null;

  const token = getCookie(req, SESSION_COOKIE);
  const parts = token.split(".");
  if (parts.length !== 2 || !parts[0] || !parts[1]) return null;

  const encodedPayload = parts[0];
  const suppliedSignature = parts[1];
  const expectedSignature = signPayload(encodedPayload);
  if (!safeCompare(suppliedSignature, expectedSignature)) return null;

  try {
    const payload = JSON.parse(
      Buffer.from(encodedPayload, "base64url").toString("utf8"),
    );

    if (
      !Number.isInteger(payload.userId) ||
      payload.userId < 1 ||
      typeof payload.username !== "string" ||
      !["admin", "employee"].includes(payload.role) ||
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
    SESSION_COOKIE +
      "=" +
      token +
      "; Max-Age=" +
      SESSION_DURATION_SECONDS +
      "; Path=/; HttpOnly; SameSite=Lax" +
      secure,
  );
}

function clearSessionCookie(res) {
  const secure = isProduction ? "; Secure" : "";
  res.setHeader(
    "Set-Cookie",
    SESSION_COOKIE +
      "=; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT; Path=/; HttpOnly; SameSite=Lax" +
      secure,
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
  return next();
}

async function requireAuth(req, res, next) {
  if (!authIsConfigured) {
    return res.status(503).json({
      message: "Вход не настроен на сервере.",
    });
  }

  const session = getSession(req);
  if (!session) {
    return res.status(401).json({
      message: "Сначала войди в журнал смены.",
    });
  }

  let result;
  try {
    result = await pool.query(
      "SELECT id, username, display_name, role, is_active FROM team_users WHERE id = $1",
      [session.userId],
    );
  } catch (error) {
    console.error("Ошибка проверки пользователя:", error.message);
    return res.status(500).json({
      message: "Не удалось проверить пользователя.",
    });
  }

  const user = result.rows[0];
  if (!user || !user.is_active) {
    clearSessionCookie(res);
    return res.status(401).json({
      message: "Аккаунт отключён или удалён. Войди снова.",
    });
  }

  req.user = user;
  return next();
}

function requireAdmin(req, res, next) {
  if (!req.user || req.user.role !== "admin") {
    return res.status(403).json({
      message: "Управлять аккаунтами может только администратор.",
    });
  }

  return next();
}

async function ensureAdminAccount() {
  if (!authIsConfigured) return;

  const passwordHash = await hashPassword(APP_PASSWORD);
  await pool.query(
    "INSERT INTO team_users (username, display_name, password_hash, role, is_active) " +
      "VALUES ($1, $2, $3, 'admin', TRUE) ON CONFLICT (username) DO NOTHING",
    [APP_USERNAME, "Администратор", passwordHash],
  );
}

app.get("/api/health", (req, res) => {
  res.json({
    status: "ok",
    message: "Сервер журнала смены работает",
  });
});

app.get("/api/auth/status", async (req, res) => {
  const session = getSession(req);
  if (!session) return res.json({ authenticated: false });

  try {
    const result = await pool.query(
      "SELECT id, username, display_name, role, is_active FROM team_users WHERE id = $1",
      [session.userId],
    );
    const user = result.rows[0];

    if (!user || !user.is_active) {
      clearSessionCookie(res);
      return res.json({ authenticated: false });
    }

    return res.json({
      authenticated: true,
      user: {
        id: user.id,
        username: user.username,
        displayName: user.display_name,
        role: user.role,
      },
    });
  } catch (error) {
    console.error("Ошибка проверки входа:", error.message);
    return res.status(500).json({
      message: "Не удалось проверить вход.",
    });
  }
});

app.post("/api/auth/login", limitLoginAttempts, async (req, res) => {
  if (!authIsConfigured) {
    return res.status(503).json({
      message:
        "Вход не настроен. Проверь APP_USERNAME, APP_PASSWORD и SESSION_SECRET на сервере.",
    });
  }

  const body = req.body || {};
  const username =
    typeof body.username === "string" ? body.username.trim().toLowerCase() : "";
  const password = typeof body.password === "string" ? body.password : "";

  try {
    const result = await pool.query(
      "SELECT id, username, display_name, password_hash, role, is_active " +
        "FROM team_users WHERE username = $1",
      [username],
    );
    const user = result.rows[0];
    const passwordMatches =
      user && user.is_active
        ? await verifyPassword(password, user.password_hash)
        : false;

    if (!passwordMatches) {
      const record = getAttemptRecord(req.loginAttemptKey);
      record.count += 1;
      return res.status(401).json({
        message: "Неверный логин или пароль.",
      });
    }

    loginAttempts.delete(req.loginAttemptKey);
    setSessionCookie(res, createSessionToken(user));

    return res.json({
      authenticated: true,
      user: {
        id: user.id,
        username: user.username,
        displayName: user.display_name,
        role: user.role,
      },
    });
  } catch (error) {
    console.error("Ошибка входа:", error.message);
    return res.status(500).json({
      message: "Не удалось выполнить вход.",
    });
  }
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

    return res.json({
      status: "ok",
      database: result.rows[0].database_name,
    });
  } catch (error) {
    console.error("Ошибка подключения к PostgreSQL:", error.message);
    return res.status(500).json({
      status: "error",
      message: "Не удалось подключиться к базе данных",
    });
  }
});

app.get("/api/team/users", requireAuth, requireAdmin, async (req, res) => {
  try {
    const result = await pool.query(
      "SELECT id, username, display_name, role, is_active, created_at " +
        "FROM team_users ORDER BY CASE WHEN role = 'admin' THEN 0 ELSE 1 END, lower(username)",
    );
    return res.json(result.rows);
  } catch (error) {
    console.error("Ошибка загрузки аккаунтов:", error.message);
    return res.status(500).json({
      message: "Не удалось загрузить список сотрудников.",
    });
  }
});

app.post("/api/team/users", requireAuth, requireAdmin, async (req, res) => {
  const body = req.body || {};
  const displayName =
    typeof body.displayName === "string" ? body.displayName.trim() : "";
  const username =
    typeof body.username === "string" ? body.username.trim().toLowerCase() : "";
  const password = typeof body.password === "string" ? body.password : "";

  if (
    !/^[a-z0-9._-]{3,30}$/.test(username) ||
    displayName.length < 2 ||
    displayName.length > 60 ||
    password.length < 10 ||
    password.length > 200
  ) {
    return res.status(400).json({
      message:
        "Укажи логин 3–30 символов (латиница, цифры, точка, дефис или _), имя 2–60 символов и пароль не короче 10 символов.",
    });
  }

  try {
    const passwordHash = await hashPassword(password);
    const result = await pool.query(
      "INSERT INTO team_users (username, display_name, password_hash, role, is_active) " +
        "VALUES ($1, $2, $3, 'employee', TRUE) " +
        "RETURNING id, username, display_name, role, is_active, created_at",
      [username, displayName, passwordHash],
    );
    return res.status(201).json(result.rows[0]);
  } catch (error) {
    if (error.code === "23505") {
      return res.status(409).json({
        message: "Такой логин уже занят.",
      });
    }

    console.error("Ошибка создания аккаунта:", error.message);
    return res.status(500).json({
      message: "Не удалось создать аккаунт сотрудника.",
    });
  }
});

app.patch(
  "/api/team/users/:id/active",
  requireAuth,
  requireAdmin,
  async (req, res) => {
    const userId = Number(req.params.id);
    const { isActive } = req.body || {};

    if (!Number.isInteger(userId) || userId < 1 || typeof isActive !== "boolean") {
      return res.status(400).json({
        message: "Проверь номер аккаунта и новое состояние.",
      });
    }

    try {
      const result = await pool.query(
        "UPDATE team_users SET is_active = $1 " +
          "WHERE id = $2 AND role = 'employee' " +
          "RETURNING id, username, display_name, role, is_active, created_at",
        [isActive, userId],
      );

      if (result.rowCount === 0) {
        return res.status(404).json({
          message: "Аккаунт сотрудника не найден.",
        });
      }

      return res.json(result.rows[0]);
    } catch (error) {
      console.error("Ошибка изменения аккаунта:", error.message);
      return res.status(500).json({
        message: "Не удалось изменить аккаунт.",
      });
    }
  },
);

app.use("/api/notes", requireAuth);

app.get("/api/notes", async (req, res) => {
  const selectedDate = req.query.date || null;

  if (selectedDate && !/^\d{4}-\d{2}-\d{2}$/.test(selectedDate)) {
    return res.status(400).json({
      message: "Дата должна быть в формате ГГГГ-ММ-ДД.",
    });
  }

  try {
    const result = await pool.query(
      NOTE_SELECT +
        " WHERE shift.shift_date = COALESCE($1::date, CURRENT_DATE) " +
        "ORDER BY note.created_at DESC",
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

app.post("/api/notes", async (req, res) => {
  const body = req.body || {};
  const { category, title, text, shiftType = "day" } = body;

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
      "INSERT INTO shifts (shift_date, shift_type) " +
        "VALUES (CURRENT_DATE, $1) " +
        "ON CONFLICT (shift_date, shift_type) " +
        "DO UPDATE SET shift_type = EXCLUDED.shift_type " +
        "RETURNING id",
      [shiftType],
    );

    const noteResult = await pool.query(
      "INSERT INTO handover_notes " +
        "(shift_id, category, title, description, created_by) " +
        "VALUES ($1, $2, $3, $4, $5) RETURNING id",
      [
        shiftResult.rows[0].id,
        category.trim(),
        title.trim(),
        text.trim(),
        req.user.id,
      ],
    );

    const createdNote = await pool.query(
      NOTE_SELECT + " WHERE note.id = $1",
      [noteResult.rows[0].id],
    );
    return res.status(201).json(createdNote.rows[0]);
  } catch (error) {
    console.error("Ошибка создания записи:", error.message);
    return res.status(500).json({
      message: "Не удалось сохранить запись.",
    });
  }
});

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
      "UPDATE handover_notes SET status = $1, " +
        "closed_at = CASE WHEN $1 = 'closed' THEN NOW() ELSE NULL END " +
        "WHERE id = $2 RETURNING id, category, title, status, closed_at",
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
      "UPDATE handover_notes SET category = $1, title = $2, description = $3 " +
        "WHERE id = $4 RETURNING id",
      [category.trim(), title.trim(), text.trim(), noteId],
    );

    if (updateResult.rowCount === 0) {
      return res.status(404).json({ message: "Запись не найдена." });
    }

    const noteResult = await pool.query(
      NOTE_SELECT + " WHERE note.id = $1",
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

async function startServer() {
  try {
    await pool.query("SELECT 1");
    await ensureAdminAccount();
    app.listen(PORT, () => {
      console.log("Сервер журнала смены запущен на порту " + PORT);
    });
  } catch (error) {
    console.error(
      "Не удалось запустить сервер. Проверь подключение к базе и SQL-изменения:",
      error.message,
    );
    process.exit(1);
  }
}

startServer();
