import "./App.css";

const notes = [
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

function App() {
  const today = new Intl.DateTimeFormat("ru-RU", {
    weekday: "long",
    day: "numeric",
    month: "long",
  }).format(new Date());

  return (
    <div className="app-shell">
      <header className="topbar">
        <a className="brand" href="/">
          <span className="brand-mark">П</span>
          <span className="brand-name">пересменка</span>
        </a>

        <p className="topbar-caption">Журнал команды кафе</p>

        <button className="primary-button" type="button">
          + Новая запись
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
              <span className="record-count">{notes.length} записи</span>
            </div>

            <div className="records-list">
              {notes.map((note) => (
                <article
                  className={`record-card ${note.done ? "record-card--done" : ""}`}
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
                    <span>{note.time}</span>
                    <span>Дневная смена</span>
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
              <strong>02</strong>
              <span>
                записи
                <br />
                ещё открыты
              </span>
            </div>

            <div className="handover-divider" />

            <p className="handover-list-title">Не забыть</p>
            <ul className="handover-list">
              <li>
                <span className="list-marker" />
                Перепроверить кофемашину
              </li>
              <li>
                <span className="list-marker" />
                Добавить молоко в заявку
              </li>
            </ul>

            <p className="handover-footnote">
              Выполненную запись можно будет закрыть.
            </p>
          </aside>
        </div>

        <p className="page-footnote">
          Учебная версия · записи пока демонстрационные
        </p>
      </main>
    </div>
  );
}

export default App;
