const express = require("express");
const pool = require("./db");

const app = express();
const PORT = process.env.PORT || 3000;

// Позволяет серверу читать JSON из запросов
app.use(express.json());

app.get("/api/health", (req, res) => {
  res.json({
    status: "ok",
    message: "Сервер журнала смены работает",
  });
});

app.get("/api/db-check", async (req, res) => {
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

// Получить все записи
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

    res.json(result.rows[0]);
  } catch (error) {
    console.error("Ошибка обновления записи:", error.message);
    res.status(500).json({
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
  console.log(`Сервер запущен: http://localhost:${PORT}`);
});
