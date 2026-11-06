import { useState } from "react";
import "./App.css";

const initialNotes = [
  {
    id: 1,
    category: "Оборудование",
    categoryClass: "equipment",
    title: "Подтекает правая группа кофемашины",
    text: "После промывки вода скапливается у основания. Пока готовим на левой группе.",
    time: "15:42",
    state: "Открыта",
    done: false,
  },
  {
    id: 2,
    category: "Запасы",
    categoryClass: "stock",
    title: "Овсяного молока осталось две упаковки",
    text: "Добавить молоко в заявку поставщику до закрытия.",
    time: "14:18",
    state: "Открыта",
    done: false,
  },
  {
    id: 3,
    category: "Гости",
    categoryClass: "guest",
    title: "Детский стул подготовлен к брони на 19:30",
    text: "Столик у окна. Стул поставили заранее.",
    time: "12:06",
    state: "Закрыта",
    done: true,
  },
];

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
};

function App() {
  const [notes, setNotes] = useState(initialNotes);
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [formData, setFormData] = useState(emptyForm);

  const openNotes = notes.filter((note) => !note.done);

  const today = new Intl.DateTimeFormat("ru-RU", {
    weekday: "long",
    day: "numeric",
    month: "long",
  }).format(new Date());

  function handleFormChange(event) {
    const { name, value } = event.target;

    setFormData((currentForm) => ({
      ...currentForm,
      [name]: value,
    }));
  }

  function handleSubmit(event) {
    event.preventDefault();

    const title = formData.title.trim();
    const text = formData.text.trim();

    if (!title || !text) {
      return;
    }

    const selectedCategory = categories.find(
      (category) => category.name === formData.category,
    );

    const newNote = {
      id: Date.now(),
      category: selectedCategory.name,
      categoryClass: selectedCategory.className,
      title,
      text,
      time: new Intl.DateTimeFormat("ru-RU", {
        hour: "2-digit",
        minute: "2-digit",
      }).format(new Date()),
      state: "Открыта",
      done: false,
    };

    setNotes((currentNotes) => [newNote, ...currentNotes]);
    setFormData(emptyForm);
    setIsFormOpen(false);
  }

  function toggleNote(noteId) {
    setNotes((currentNotes) =>
      currentNotes.map((note) => {
        if (note.id !== noteId) {
          return note;
        }

        const done = !note.done;

        return {
          ...note,
          done,
          state: done ? "Закрыта" : "Открыта",
        };
      }),
    );
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
          onClick={() => setIsFormOpen((isOpen) => !isOpen)}
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
              <span className="record-count">{notes.length} всего</span>
            </div>

            {isFormOpen && (
              <form
                className="record-form"
                id="new-record-form"
                onSubmit={handleSubmit}
              >
                <div className="form-heading">
                  <div>
                    <h3>Новая запись</h3>
                    <p>Добавь то, что следующей смене нужно знать.</p>
                  </div>
                  <button
                    className="form-close"
                    type="button"
                    aria-label="Закрыть форму"
                    onClick={() => setIsFormOpen(false)}
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
                    onClick={() => setIsFormOpen(false)}
                  >
                    Отмена
                  </button>
                  <button className="primary-button" type="submit">
                    Сохранить запись
                  </button>
                </div>
              </form>
            )}

            <div className="records-list">
              {notes.map((note) => (
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
                    <span>{note.time} · Дневная смена</span>
                    <button
                      className="record-action"
                      type="button"
                      onClick={() => toggleNote(note.id)}
                    >
                      {note.done ? "Открыть снова" : "Закрыть запись"}
                    </button>
                  </div>
                </article>
              ))}
            </div>
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
          Пока записи сохраняются только до обновления страницы.
        </p>
      </main>
    </div>
  );
}

export default App;
