const express = require("express");
const pool = require("./db");

const app = express();
const PORT = 3000;

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

app.listen(PORT, () => {
  console.log(`Сервер запущен: http://localhost:${PORT}`);
});
