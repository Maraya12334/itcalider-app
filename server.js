const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const cookieParser = require('cookie-parser');
const path = require('path');

const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'itcalider-dev-secret';
const DB_PATH = path.join(__dirname, 'database.sqlite');

const app = express();

app.use(express.json());
app.use(cookieParser());
app.get('/', (_req, res) => {
  res.sendFile(path.join(__dirname, 'login.html'));
});
app.use(express.static(__dirname));

const db = new sqlite3.Database(DB_PATH, (error) => {
  if (error) {
    console.error('Error opening DB:', error.message);
    process.exit(1);
  }
  console.log('Connected to SQLite database.');
  initDatabase();
});

function initDatabase() {
  db.serialize(() => {
    db.run(`
      CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        givenName TEXT NOT NULL,
        surname TEXT NOT NULL,
        email TEXT NOT NULL UNIQUE,
        passwordHash TEXT NOT NULL,
        role TEXT NOT NULL DEFAULT 'student',
        className TEXT,
        subject TEXT,
        createdAt TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `);

    db.run(`
      CREATE TABLE IF NOT EXISTS notices (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        title TEXT NOT NULL,
        body TEXT NOT NULL,
        author TEXT NOT NULL,
        date TEXT NOT NULL,
        createdAt TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `);

    db.run(`
      CREATE TABLE IF NOT EXISTS grades (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        userId INTEGER NOT NULL,
        subject TEXT NOT NULL,
        item TEXT NOT NULL,
        date TEXT NOT NULL,
        grade TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'Publicada',
        createdAt TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(userId) REFERENCES users(id)
      )
    `);

    db.run(`
      CREATE TABLE IF NOT EXISTS posts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        userId INTEGER NOT NULL,
        title TEXT NOT NULL,
        text TEXT NOT NULL,
        author TEXT NOT NULL,
        createdAt TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(userId) REFERENCES users(id)
      )
    `);

    db.run(`
      CREATE TABLE IF NOT EXISTS academical_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        title TEXT NOT NULL,
        body TEXT NOT NULL,
        date TEXT NOT NULL,
        createdAt TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `);

    const seedNotices = [
      {
        title: 'Matemática Aplicada — sala 204',
        body: 'La clase de hoy se realizará en la sala 204. El horario se mantiene sin cambios.',
        author: 'Equipo docente',
        date: 'Hoy · 08:05'
      },
      {
        title: 'Semana de actividades técnicas',
        body: 'Ya está disponible el calendario de actividades y charlas de la próxima semana.',
        author: 'Equipo docente',
        date: 'Ayer · 16:30'
      },
      {
        title: 'Prueba de Sistemas y Redes',
        body: 'La evaluación práctica está programada para el jueves 15 de octubre. Revisen los contenidos con su docente.',
        author: 'Equipo docente',
        date: '10 oct · 12:15'
      }
    ];

    db.get('SELECT COUNT(*) as count FROM notices', (error, row) => {
      if (error) {
        console.error('Error checking notices:', error.message);
        return;
      }
      if (row.count === 0) {
        const insertNotice = db.prepare('INSERT INTO notices (title, body, author, date) VALUES (?, ?, ?, ?)');
        seedNotices.forEach((notice) => insertNotice.run(notice.title, notice.body, notice.author, notice.date));
        insertNotice.finalize();
      }
    });

    const seedGrades = [
      { subject: 'Matemática Aplicada', item: 'Control 1 · Funciones', date: '08 oct 2026', grade: '6,2', status: 'Publicada' },
      { subject: 'Fundamentos de Programación', item: 'Proyecto · Etapa 1', date: '06 oct 2026', grade: '5,8', status: 'Publicada' },
      { subject: 'Comunicación Efectiva', item: 'Presentación oral', date: '02 oct 2026', grade: '6,5', status: 'Publicada' },
      { subject: 'Sistemas y Redes', item: 'Evaluación práctica', date: 'Por publicar', grade: '—', status: 'Pendiente' }
    ];

    db.get('SELECT COUNT(*) as count FROM grades', (error, row) => {
      if (error) {
        console.error('Error checking grades:', error.message);
        return;
      }
      if (row.count === 0) {
        const insertGrade = db.prepare('INSERT INTO grades (userId, subject, item, date, grade, status) VALUES (?, ?, ?, ?, ?, ?)');
        insertGrade.run(1, seedGrades[0].subject, seedGrades[0].item, seedGrades[0].date, seedGrades[0].grade, seedGrades[0].status);
        insertGrade.run(1, seedGrades[1].subject, seedGrades[1].item, seedGrades[1].date, seedGrades[1].grade, seedGrades[1].status);
        insertGrade.run(1, seedGrades[2].subject, seedGrades[2].item, seedGrades[2].date, seedGrades[2].grade, seedGrades[2].status);
        insertGrade.run(1, seedGrades[3].subject, seedGrades[3].item, seedGrades[3].date, seedGrades[3].grade, seedGrades[3].status);
        insertGrade.finalize();
      }
    });

    db.get('SELECT COUNT(*) as count FROM users', (error, row) => {
      if (error) {
        console.error('Error checking users:', error.message);
        return;
      }
      if (row.count === 0) {
        const defaultPassword = 'itcalider123';
        bcrypt.hash(defaultPassword, 10).then((hash) => {
          db.run(
            'INSERT INTO users (givenName, surname, email, passwordHash, role, className, subject) VALUES (?, ?, ?, ?, ?, ?, ?)',
            'Camila', 'Mendoza', 'camila@instituto.cl', hash, 'student', '3° B', 'Matemática'
          );
          db.run(
            'INSERT INTO users (givenName, surname, email, passwordHash, role, className, subject) VALUES (?, ?, ?, ?, ?, ?, ?)',
            'Mateo', 'Pérez', 'mateo@instituto.cl', hash, 'teacher', '3° B', 'Matemática'
          );
        });
      }
    });
  });
}

function signToken(user) {
  return jwt.sign({ id: user.id, email: user.email, role: user.role }, JWT_SECRET, { expiresIn: '7d' });
}

function authenticate(req, res, next) {
  const token = req.cookies?.token || req.headers.authorization?.replace('Bearer ', '');
  if (!token) {
    return res.status(401).json({ ok: false, message: 'No autenticado' });
  }

  try {
    const payload = jwt.verify(token, JWT_SECRET);
    req.user = payload;
    next();
  } catch (error) {
    return res.status(401).json({ ok: false, message: 'Token inválido' });
  }
}

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, message: 'ITCalider API funcionando' });
});

app.post('/api/register', async (req, res) => {
  const { givenName, surname, email, password, role, className, subject } = req.body || {};

  if (!givenName || !surname || !email || !password || !role) {
    return res.status(400).json({ ok: false, message: 'Faltan datos requeridos' });
  }

  const normalizedEmail = String(email).trim().toLowerCase();
  if (password.length < 6) {
    return res.status(400).json({ ok: false, message: 'La contraseña debe tener al menos 6 caracteres' });
  }

  const passwordHash = await bcrypt.hash(password, 10);
  db.run(
    'INSERT INTO users (givenName, surname, email, passwordHash, role, className, subject) VALUES (?, ?, ?, ?, ?, ?, ?)',
    [givenName.trim(), surname.trim(), normalizedEmail, passwordHash, role, role === 'teacher' ? className || 'Matemática' : className || '3° B', role === 'teacher' ? subject || 'Matemática' : subject || 'Matemática'],
    function (error) {
      if (error) {
        if (error.message.includes('UNIQUE')) {
          return res.status(409).json({ ok: false, message: 'El correo ya está registrado' });
        }
        return res.status(500).json({ ok: false, message: 'No se pudo crear la cuenta' });
      }

      const newUser = { id: this.lastID, givenName, surname, email: normalizedEmail, role };
      const token = signToken(newUser);
      res.cookie('token', token, { httpOnly: true, sameSite: 'lax' });
      res.status(201).json({ ok: true, token, user: { ...newUser, className: role === 'teacher' ? className || 'Matemática' : className || '3° B', subject: subject || 'Matemática' } });
    }
  );
});

app.post('/api/login', (req, res) => {
  const { email, password } = req.body || {};

  if (!email || !password) {
    return res.status(400).json({ ok: false, message: 'Correo y contraseña obligatorios' });
  }

  db.get('SELECT * FROM users WHERE email = ?', [String(email).trim().toLowerCase()], async (error, user) => {
    if (error) {
      return res.status(500).json({ ok: false, message: 'Error al consultar usuario' });
    }

    if (!user) {
      return res.status(401).json({ ok: false, message: 'Credenciales inválidas' });
    }

    const validPassword = await bcrypt.compare(String(password), user.passwordHash);
    if (!validPassword) {
      return res.status(401).json({ ok: false, message: 'Credenciales inválidas' });
    }

    const publicUser = {
      id: user.id,
      givenName: user.givenName,
      surname: user.surname,
      email: user.email,
      role: user.role,
      className: user.className,
      subject: user.subject
    };

    const token = signToken(publicUser);
    res.cookie('token', token, { httpOnly: true, sameSite: 'lax' });
    res.json({ ok: true, token, user: publicUser });
  });
});

app.get('/api/me', authenticate, (req, res) => {
  db.get('SELECT * FROM users WHERE id = ?', [req.user.id], (error, user) => {
    if (error || !user) {
      return res.status(404).json({ ok: false, message: 'Usuario no encontrado' });
    }

    res.json({ ok: true, user: {
      id: user.id,
      givenName: user.givenName,
      surname: user.surname,
      email: user.email,
      role: user.role,
      className: user.className,
      subject: user.subject
    }});
  });
});

app.post('/api/logout', (_req, res) => {
  res.clearCookie('token');
  res.json({ ok: true, message: 'Sesión cerrada' });
});

app.get('/api/notices', authenticate, (_req, res) => {
  db.all('SELECT * FROM notices ORDER BY id DESC', (error, rows) => {
    if (error) {
      return res.status(500).json({ ok: false, message: 'No se pudieron cargar los avisos' });
    }
    res.json({ ok: true, notices: rows });
  });
});

app.get('/api/grades', authenticate, (req, res) => {
  db.all('SELECT * FROM grades WHERE userId = ? ORDER BY id DESC', [req.user.id], (error, rows) => {
    if (error) {
      return res.status(500).json({ ok: false, message: 'No se pudieron cargar las calificaciones' });
    }
    res.json({ ok: true, grades: rows });
  });
});

app.get('/api/classes', authenticate, (req, res) => {
  const defaultClasses = [
    { time: '08:30 — 10:00', name: 'Matemática Aplicada', teacher: 'Prof. Sebastián Rojas', room: 'Sala 204' },
    { time: '10:15 — 11:45', name: 'Fundamentos de Programación', teacher: 'Prof. Daniela Soto', room: 'Lab. 3' },
    { time: '12:00 — 13:30', name: 'Comunicación Efectiva', teacher: 'Prof. Andrés Molina', room: 'Sala 108' },
    { time: '14:15 — 15:45', name: 'Sistemas y Redes', teacher: 'Prof. Paula Reyes', room: 'Lab. 1' }
  ];

  if (req.user.role === 'teacher') {
    return res.json({ ok: true, classes: defaultClasses });
  }

  res.json({ ok: true, classes: defaultClasses });
});

app.get('/api/posts', authenticate, (_req, res) => {
  db.all('SELECT * FROM posts ORDER BY id DESC LIMIT 20', (error, rows) => {
    if (error) {
      return res.status(500).json({ ok: false, message: 'No se pudieron cargar los posts' });
    }
    res.json({ ok: true, posts: rows });
  });
});

app.post('/api/posts', authenticate, (req, res) => {
  const { title, text } = req.body || {};
  if (!title || !text) {
    return res.status(400).json({ ok: false, message: 'Título y contenido son obligatorios' });
  }

  db.get('SELECT givenName, surname FROM users WHERE id = ?', [req.user.id], (error, user) => {
    if (error || !user) {
      return res.status(404).json({ ok: false, message: 'Usuario no encontrado' });
    }

    const author = `${user.givenName} ${user.surname}`;
    db.run('INSERT INTO posts (userId, title, text, author) VALUES (?, ?, ?, ?)', [req.user.id, title, text, author], function (insertError) {
      if (insertError) {
        return res.status(500).json({ ok: false, message: 'No se pudo publicar el mensaje' });
      }
      res.status(201).json({ ok: true, message: 'Mensaje publicado', post: { id: this.lastID, title, text, author } });
    });
  });
});

app.post('/api/notices', authenticate, (req, res) => {
  const { title, body, author } = req.body || {};
  if (!title || !body) {
    return res.status(400).json({ ok: false, message: 'Título y cuerpo obligatorios' });
  }

  db.run('INSERT INTO notices (title, body, author, date) VALUES (?, ?, ?, ?)', [title, body, author || 'Equipo docente', new Date().toLocaleString('es-ES', { dateStyle: 'short', timeStyle: 'short' })], function (error) {
    if (error) {
      return res.status(500).json({ ok: false, message: 'No se pudo guardar el aviso' });
    }
    res.status(201).json({ ok: true, message: 'Aviso guardado', notice: { id: this.lastID, title, body, author: author || 'Equipo docente', date: 'Ahora' } });
  });
});

app.post('/api/grades', authenticate, (req, res) => {
  const { subject, item, date, grade, status } = req.body || {};
  if (!subject || !item || !grade) {
    return res.status(400).json({ ok: false, message: 'Faltan datos de la nota' });
  }

  db.run('INSERT INTO grades (userId, subject, item, date, grade, status) VALUES (?, ?, ?, ?, ?, ?)', [req.user.id, subject, item, date || 'Hoy', grade, status || 'Publicada'], function (error) {
    if (error) {
      return res.status(500).json({ ok: false, message: 'No se pudo registrar la nota' });
    }
    res.status(201).json({ ok: true, message: 'Nota registrada', grade: { id: this.lastID, subject, item, date: date || 'Hoy', grade, status: status || 'Publicada' } });
  });
});

app.use((req, res) => {
  res.status(404).json({ ok: false, message: 'Endpoint no encontrado' });
});

app.listen(PORT, () => {
  console.log(`ITCalider backend running on http://localhost:${PORT}`);
});
