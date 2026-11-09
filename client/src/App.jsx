import { useEffect, useState } from "react";
import "./App.css";

const categories = [
  { name: "Оборудование", className: "equipment" },
  { name: "Запасы", className: "stock" },
  { name: "Гости", className: "guest" },
  { name: "Задача", className: "task" },
  { name: "Другое", className: "other" },
];

const emptyForm = {
  category: "Оборудование",
  title: "",
  text: "",
  shiftType: "day",
};

function formatNote(note) {
  const category = categories.find((item) => item.name === note.category);
  const createdAt = new Date(note.created_at);
  const done = note.status === "closed";

  return {
    ...note,
    categoryClass: category?.className || "other",
    time: Number.isNaN(createdAt.getTime())
      ? ""
      : new Intl.DateTimeFormat("ru-RU", {
          hour: "2-digit",
          minute: "2-digit",
        }).format(createdAt),
    state: done ? "Закрыта" : "Открыта",
    done,
    shiftLabel:
      note.shift_type === "evening" ? "Вечерняя смена" : "Дневная смена",
  };
}

function App() {
  const [notes, setNotes] = useState([]);
  const [shiftFilter, setShiftFilter] = useState("all");
  const [isLoading, setIsLoading] = useState(true);
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editingNote, setEditingNote] = useState(null);
  const [formData, setFormData] = useState(emptyForm);
  const [isSaving, setIsSaving] = useState(false);
  const [updatingId, setUpdatingId] = useState(null);
  const [error, setError] = useState("");

  const openNotes = notes.filter(
    (note) => note.shift_type === "evening" && !note.done,
  );

  const visibleNotes = notes.filter(
    (note) => shiftFilter === "all" || note.shift_type === shiftFilter,
  );

  const today = new Intl.DateTimeFormat("ru-RU", {
    weekday: "long",
    day: "numeric",
    month: "long",
  }).format(new Date());

  useEffect(() => {
    async function loadNotes() {
      try {
        const response = await fetch("/api/notes");
        const data = await response.json();

        if (!response.ok) {
          throw new Error(data.message || "Не удалось загрузить записи.");
        }

        setNotes(data.map(formatNote));
      } catch (loadError) {
        console.error(loadError);
        setError(
          "Не удалось загрузить записи. Проверь, что Express и PostgreSQL запущены.",
        );
      } finally {
        setIsLoading(false);
      }
    }

    loadNotes();
  }, []);

  function handleFormChange(event) {
    const { name, value } = event.target;

    setFormData((currentForm) => ({
      ...currentForm,
      [name]: value,
    }));
  }

  function startEditing(note) {
    setError("");
    setEditingNote(note);
    setFormData({
      category: note.category,
      title: note.title,
      text: note.text,
      shiftType: note.shift_type,
    });
    setIsFormOpen(true);
  }

  async function handleSubmit(event) {
    event.preventDefault();
    setError("");
    setIsSaving(true);

    const isEditing = editingNote !== null;
    const endpoint = isEditing ? `/api/notes/${editingNote.id}` : "/api/notes";

    try {
      const response = await fetch(endpoint, {
        method: isEditing ? "PATCH" : "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          category: formData.category,
          title: formData.title.trim(),
          text: formData.text.trim(),
          shiftType: formData.shiftType,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.message || "Не удалось сохранить запись.");
      }

      const savedNote = formatNote(data);

      if (isEditing) {
        setNotes((currentNotes) =>
          currentNotes.map((note) =>
            note.id === editingNote.id ? savedNote : note,
          ),
        );
      } else {
        setNotes((currentNotes) => [savedNote, ...currentNotes]);
      }

      setFormData(emptyForm);
      setEditingNote(null);
      setIsFormOpen(false);
    } catch (saveError) {
      setError(saveError.message || "Не удалось сохранить запись.");
    } finally {
      setIsSaving(false);
    }
  }

  async function toggleNote(note) {
    const nextStatus = note.done ? "open" : "closed";
    setError("");
    setUpdatingId(note.id);

    try {
      const response = await fetch(`/api/notes/${note.id}/status`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ status: nextStatus }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.message || "Не удалось обновить запись.");
      }

      const done = data.status === "closed";

      setNotes((currentNotes) =>
        currentNotes.map((currentNote) =>
          currentNote.id === note.id
            ? {
                ...currentNote,
                status: data.status,
                done,
                state: done ? "Закрыта" : "Открыта",
              }
            : currentNote,
        ),
      );
    } catch (updateError) {
      setError(updateError.message || "Не удалось обновить запись.");
    } finally {
      setUpdatingId(null);
    }
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <a className="brand" href="/">
          <span className="brand-mark">П</span>
          <span className="brand-name">пересменка</span>
        </a>

        <p className="topbar-caption">Журнал команды кафе</p>

        <button
          className="primary-button"
          type="button"
          aria-expanded={isFormOpen}
          onClick={() => {
            setError("");
            setEditingNote(null);
            setFormData(emptyForm);
            setIsFormOpen((isOpen) => !isOpen);
          }}
        >
          {isFormOpen ? "Закрыть форму" : "+ Новая запись"}
        </button>
      </header>

      <main className="main-content">
        <section className="page-heading">
          <div>
            <p className="date-label">{today}</p>
            <h1>Журнал смены</h1>
            <p className="page-description">
              Всё, что важно передать коллегам, — в одном месте.
            </p>
          </div>

          <div className="current-shift">
            <span className="shift-dot" aria-hidden="true" />
            <div>
              <span>Сейчас</span>
              <strong>Дневная смена</strong>
            </div>
          </div>
        </section>

        <div className="content-grid">
          <section className="records-section">
            <div className="section-heading">
              <div>
                <h2>Записи за сегодня</h2>
                <p>Что уже закрыто, а что ещё ждёт внимания.</p>
              </div>
              <span className="record-count">{visibleNotes.length} всего</span>
            </div>

            <div className="shift-filters">
              <button
                className={
                  shiftFilter === "all" ? "primary-button" : "secondary-button"
                }
                type="button"
                onClick={() => setShiftFilter("all")}
              >
                Все
              </button>

              <button
                className={
                  shiftFilter === "day" ? "primary-button" : "secondary-button"
                }
                type="button"
                onClick={() => setShiftFilter("day")}
              >
                Дневная
              </button>

              <button
                className={
                  shiftFilter === "evening"
                    ? "primary-button"
                    : "secondary-button"
                }
                type="button"
                onClick={() => setShiftFilter("evening")}
              >
                Вечерняя
              </button>
            </div>

            {error && (
              <p className="error-message" role="alert">
                {error}
              </p>
            )}

            {isFormOpen && (
              <form className="record-form" onSubmit={handleSubmit}>
                <div className="form-heading">
                  <div>
                    <h3>
                      {editingNote ? "Редактировать запись" : "Новая запись"}
                    </h3>
                    <p>
                      {editingNote
                        ? "Измени категорию, заголовок или подробности."
                        : "Добавь то, что следующей смене нужно знать."}
                    </p>
                  </div>
                  <button
                    className="form-close"
                    type="button"
                    aria-label="Закрыть форму"
                    onClick={() => {
                      setIsFormOpen(false);
                      setEditingNote(null);
                      setFormData(emptyForm);
                    }}
                  >
                    ×
                  </button>
                </div>

                <label className="form-field">
                  <span>Категория</span>
                  <select
                    name="category"
                    value={formData.category}
                    onChange={handleFormChange}
                  >
                    {categories.map((category) => (
                      <option key={category.name} value={category.name}>
                        {category.name}
                      </option>
                    ))}
                  </select>
                </label>

                {!editingNote && (
                  <label className="form-field">
                    <span>Смена</span>
                    <select
                      name="shiftType"
                      value={formData.shiftType}
                      onChange={handleFormChange}
                    >
                      <option value="day">Дневная смена</option>
                      <option value="evening">Вечерняя смена</option>
                    </select>
                  </label>
                )}

                <label className="form-field">
                  <span>Короткий заголовок</span>
                  <input
                    name="title"
                    value={formData.title}
                    onChange={handleFormChange}
                    placeholder="Например, закончились стаканы"
                    maxLength={80}
                    required
                  />
                </label>

                <label className="form-field">
                  <span>Подробности</span>
                  <textarea
                    name="text"
                    value={formData.text}
                    onChange={handleFormChange}
                    placeholder="Что произошло и что нужно сделать?"
                    rows={3}
                    maxLength={240}
                    required
                  />
                </label>

                <div className="form-actions">
                  <button
                    className="secondary-button"
                    type="button"
                    onClick={() => {
                      setIsFormOpen(false);
                      setEditingNote(null);
                      setFormData(emptyForm);
                    }}
                  >
                    Отмена
                  </button>
                  <button
                    className="primary-button"
                    type="submit"
                    disabled={isSaving}
                  >
                    {isSaving
                      ? "Сохраняю…"
                      : editingNote
                        ? "Сохранить изменения"
                        : "Сохранить запись"}
                  </button>
                </div>
              </form>
            )}

            {isLoading ? (
              <p className="empty-state">Загружаю записи…</p>
            ) : visibleNotes.length === 0 ? (
              <p className="empty-state">
                {notes.length === 0
                  ? "Записей пока нет. Добавь первую для следующей смены."
                  : "Для этой смены пока нет записей."}
              </p>
            ) : (
              <div className="records-list">
                {visibleNotes.map((note) => (
                  <article
                    className={`record-card ${
                      note.done ? "record-card--done" : ""
                    }`}
                    key={note.id}
                  >
                    <div className="record-topline">
                      <span
                        className={`category-badge category-badge--${note.categoryClass}`}
                      >
                        {note.category}
                      </span>

                      <span
                        className={`record-status ${
                          note.done ? "record-status--done" : ""
                        }`}
                      >
                        <span className="status-dot" />
                        {note.state}
                      </span>
                    </div>

                    <h3>{note.title}</h3>
                    <p className="record-text">{note.text}</p>

                    <div className="record-meta">
                      <span>
                        {note.time} · {note.shiftLabel}
                      </span>

                      <div className="record-actions">
                        <button
                          className="record-action"
                          type="button"
                          onClick={() => startEditing(note)}
                        >
                          Изменить
                        </button>

                        <button
                          className="record-action"
                          type="button"
                          disabled={updatingId === note.id}
                          onClick={() => toggleNote(note)}
                        >
                          {updatingId === note.id
                            ? "Сохраняю…"
                            : note.done
                              ? "Открыть снова"
                              : "Закрыть запись"}
                        </button>
                      </div>
                    </div>
                  </article>
                ))}
              </div>
            )}
          </section>

          <aside className="handover-card">
            <div className="handover-topline">
              <span className="handover-kicker">ПЕРЕДАЧА</span>
              <span className="handover-date">сегодня</span>
            </div>

            <h2>Для вечерней смены</h2>
            <p className="handover-description">
              Коротко о том, что стоит проверить перед началом.
            </p>

            <div className="handover-total">
              <strong>{String(openNotes.length).padStart(2, "0")}</strong>
              <span>
                открытых
                <br />
                записей
              </span>
            </div>

            <div className="handover-divider" />

            <p className="handover-list-title">Не забыть</p>
            <ul className="handover-list">
              {openNotes.length === 0 ? (
                <li>
                  <span className="list-marker" />
                  Открытых записей нет
                </li>
              ) : (
                openNotes.slice(0, 2).map((note) => (
                  <li key={note.id}>
                    <span className="list-marker" />
                    {note.title}
                  </li>
                ))
              )}
            </ul>

            <p className="handover-footnote">
              Закрой запись, когда вопрос решён.
            </p>
          </aside>
        </div>

        <p className="page-footnote">
          Данные загружаются и сохраняются в PostgreSQL.
        </p>
      </main>
    </div>
  );
}

export default App;
