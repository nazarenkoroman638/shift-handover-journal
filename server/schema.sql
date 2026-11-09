CREATE TABLE shifts (
  id SERIAL PRIMARY KEY,
  shift_date DATE NOT NULL DEFAULT CURRENT_DATE,
  shift_type VARCHAR(20) NOT NULL
    CHECK (shift_type IN ('day', 'evening')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (shift_date, shift_type)
);

CREATE TABLE handover_notes (
  id SERIAL PRIMARY KEY,
  shift_id INTEGER NOT NULL REFERENCES shifts(id),
  category VARCHAR(40) NOT NULL,
  title VARCHAR(80) NOT NULL,
  description TEXT NOT NULL,
  status VARCHAR(10) NOT NULL DEFAULT 'open'
    CHECK (status IN ('open', 'closed')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  closed_at TIMESTAMPTZ
);