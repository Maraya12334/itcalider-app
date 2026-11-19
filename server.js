const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const cookieParser = require('cookie-parser');
const path = require('path');

const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'itcalider-dev-secret';
const DB_PATH = path.join(__dirname, 'database.sqlite');
const ACADEMIC_MONTHS = new Set([3, 4, 5, 6, 8, 9, 10, 11, 12]);
const ACADEMIC_TIME_ZONE = 'America/Santiago';

const app = express();

function chileDateParts(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: ACADEMIC_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(date);
  return Object.fromEntries(parts.filter(part => part.type !== 'literal').map(part => [part.type, part.value]));
}

function chileDateISO(date = new Date()) {
  const parts = chileDateParts(date);
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function isAcademicDate(value) {
  if (!isValidDate(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
  return ACADEMIC_MONTHS.has(month) && weekday !== 0 && weekday !== 6;
}

function formatNoticeDate(value) {
  const date = new Date(`${String(value).replace(' ', 'T')}Z`);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('es-CL', {
    timeZone: ACADEMIC_TIME_ZONE,
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23'
  }).format(date);
}

app.use(express.json());
app.use(cookieParser());
app.get('/', (_req, res) => {
  res.sendFile(path.join(__dirname, 'login.html'));
});

app.get('/login.html', (_req, res) => {
  res.sendFile(path.join(__dirname, 'login.html'));
});

app.get('/index.html', (_req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

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
      CREATE TABLE IF NOT EXISTS attendance (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        teacherId INTEGER NOT NULL,
        studentId INTEGER NOT NULL,
        subject TEXT NOT NULL,
        attendanceDate TEXT NOT NULL,
        status TEXT NOT NULL,
        updatedAt TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE (teacherId, studentId, subject, attendanceDate),
        FOREIGN KEY(teacherId) REFERENCES users(id),
        FOREIGN KEY(studentId) REFERENCES users(id)
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
        date: formatNoticeDate(new Date().toISOString().slice(0, 19).replace('T', ' '))
      },
      {
        title: 'Semana de actividades técnicas',
        body: 'Ya está disponible el calendario de actividades y charlas de la próxima semana.',
        author: 'Equipo docente',
        date: formatNoticeDate(new Date().toISOString().slice(0, 19).replace('T', ' '))
      },
      {
        title: 'Prueba de Sistemas y Redes',
        body: 'Consulta con tu docente la fecha y los contenidos de la próxima evaluación práctica.',
        author: 'Equipo docente',
        date: formatNoticeDate(new Date().toISOString().slice(0, 19).replace('T', ' '))
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
    db.run(
      "UPDATE notices SET body = ? WHERE title = ? AND body LIKE '%15 de octubre%'",
      ['Consulta con tu docente la fecha y los contenidos de la próxima evaluación práctica.', 'Prueba de Sistemas y Redes'],
      (error) => {
        if (error) console.error('Error updating demo notice:', error.message);
      }
    );

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

      const demoUsers = [
        { givenName: 'Camila', surname: 'Mendoza', email: 'camila@instituto.cl', password: 'itcalider123', role: 'student', className: '3° B', subject: 'Matemática' },
        { givenName: 'Mateo', surname: 'Pérez', email: 'mateo@instituto.cl', password: 'itcalider123', role: 'teacher', className: '3° B', subject: 'Matemática' },
        { givenName: 'Valentina Ignacia', surname: 'Pérez Soto', email: 'valentina.perez@instituto.cl', password: 'Itcalider2026!', role: 'student', className: '3° B', subject: 'Matemática' },
        { givenName: 'Sebastián Andrés', surname: 'González Díaz', email: 'sebastian.gonzalez@instituto.cl', password: 'Itcalider2026!', role: 'student', className: '3° B', subject: 'Matemática' },
        { givenName: 'Fernanda Belén', surname: 'Muñoz Castro', email: 'fernanda.munoz@instituto.cl', password: 'Itcalider2026!', role: 'student', className: '3° A', subject: 'Matemática' },
        { givenName: 'Diego Alejandro', surname: 'Contreras Rojas', email: 'diego.contreras@instituto.cl', password: 'Itcalider2026!', role: 'student', className: '4° A', subject: 'Matemática' },
        { givenName: 'Javiera Antonia', surname: 'Morales Silva', email: 'javiera.morales@instituto.cl', password: 'Itcalider2026!', role: 'student', className: '4° B', subject: 'Matemática' },
        { givenName: 'Carolina Andrea', surname: 'Silva Torres', email: 'carolina.silva@instituto.cl', password: 'Itcalider2026!', role: 'teacher', className: '3° B', subject: 'Matemática Aplicada' },
        { givenName: 'Andrés Felipe', surname: 'Fernández Soto', email: 'andres.fernandez@instituto.cl', password: 'Itcalider2026!', role: 'teacher', className: '3° B', subject: 'Fundamentos de Programación' },
        { givenName: 'Daniela Paz', surname: 'Castillo Morales', email: 'daniela.castillo@instituto.cl', password: 'Itcalider2026!', role: 'teacher', className: '3° B', subject: 'Comunicación Efectiva' },
        { givenName: 'Felipe Ignacio', surname: 'Ramírez Pérez', email: 'felipe.ramirez@instituto.cl', password: 'Itcalider2026!', role: 'teacher', className: '3° B', subject: 'Sistemas y Redes' },
        { givenName: 'Patricia Elena', surname: 'Soto González', email: 'patricia.soto@instituto.cl', password: 'Itcalider2026!', role: 'teacher', className: '3° B', subject: 'Gestión de Proyectos' }
      ];

      if (row.count === 0 || row.count < demoUsers.length) {
        Promise.all(demoUsers.map(async (user) => {
          const hash = await bcrypt.hash(user.password, 10);
          return new Promise((resolve) => {
            db.run(
              'INSERT OR IGNORE INTO users (givenName, surname, email, passwordHash, role, className, subject) VALUES (?, ?, ?, ?, ?, ?, ?)',
              [user.givenName, user.surname, user.email, hash, user.role, user.className, user.subject],
              function (insertError) {
                if (insertError) {
                  console.error('Error seeding demo user:', user.email, insertError.message);
                }
                resolve();
              }
            );
          });
        })).catch((seedError) => {
          console.error('Error seeding demo users:', seedError.message);
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

function findTeacherCourse(teacherId, callback) {
  db.get('SELECT className, subject FROM users WHERE id = ? AND role = ?', [teacherId, 'teacher'], (error, course) => {
    callback(error, course);
  });
}

function isValidDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function currentChileDate() {
  return chileDateISO();
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
    res.json({ ok: true, notices: rows.map(row => ({ ...row, date: formatNoticeDate(row.createdAt) })) });
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

  res.json({ ok: true, classes: isAcademicDate(currentChileDate()) ? defaultClasses : [] });
});

app.get('/api/teacher/roster', authenticate, (req, res) => {
  if (req.user.role !== 'teacher') {
    return res.status(403).json({ ok: false, message: 'Solo docentes pueden consultar este curso' });
  }

  const attendanceDate = req.query.date || new Date().toISOString().slice(0, 10);
  if (!isValidDate(attendanceDate)) {
    return res.status(400).json({ ok: false, message: 'La fecha debe tener el formato AAAA-MM-DD' });
  }

  findTeacherCourse(req.user.id, (courseError, course) => {
    if (courseError) {
      return res.status(500).json({ ok: false, message: 'No se pudo consultar la asignatura' });
    }
    if (!course) {
      return res.status(404).json({ ok: false, message: 'No se encontró la asignatura del docente' });
    }

    db.all(`
      SELECT u.id, u.givenName, u.surname, a.status AS attendanceStatus
      FROM users u
      LEFT JOIN attendance a
        ON a.studentId = u.id
        AND a.teacherId = ?
        AND a.subject = ?
        AND a.attendanceDate = ?
      WHERE u.role = 'student' AND u.className = ?
      ORDER BY u.surname, u.givenName
    `, [req.user.id, course.subject, attendanceDate, course.className], (error, students) => {
      if (error) {
        return res.status(500).json({ ok: false, message: 'No se pudo cargar la lista de alumnos' });
      }
      res.json({
        ok: true,
        course,
        date: attendanceDate,
        students
      });
    });
  });
});

app.post('/api/teacher/attendance', authenticate, (req, res) => {
  if (req.user.role !== 'teacher') {
    return res.status(403).json({ ok: false, message: 'Solo docentes pueden registrar asistencia' });
  }

  const { date, records } = req.body || {};
  const allowedStatuses = new Set(['present', 'absent', 'late', 'justified']);
  if (!isValidDate(date) || !Array.isArray(records) || records.length === 0 || records.length > 100) {
    return res.status(400).json({ ok: false, message: 'Indica una fecha válida y la asistencia de 1 a 100 alumnos' });
  }
  if (records.some(record => !record || typeof record !== 'object' || Array.isArray(record))) {
    return res.status(400).json({ ok: false, message: 'La lista de asistencia contiene un registro inválido' });
  }

  const studentIds = records.map(record => Number(record.studentId));
  if (studentIds.some(id => !Number.isSafeInteger(id) || id < 1)
    || new Set(studentIds).size !== studentIds.length
    || records.some(record => !allowedStatuses.has(record.status))) {
    return res.status(400).json({ ok: false, message: 'La lista contiene alumnos o estados de asistencia inválidos' });
  }

  findTeacherCourse(req.user.id, (courseError, course) => {
    if (courseError) {
      return res.status(500).json({ ok: false, message: 'No se pudo consultar la asignatura' });
    }
    if (!course) {
      return res.status(404).json({ ok: false, message: 'No se encontró la asignatura del docente' });
    }

    db.all(
      "SELECT id FROM users WHERE role = 'student' AND className = ?",
      [course.className],
      (studentsError, students) => {
        if (studentsError) {
          return res.status(500).json({ ok: false, message: 'No se pudo validar la lista de alumnos' });
        }
        const courseStudentIds = new Set(students.map(student => student.id));
        if (studentIds.some(id => !courseStudentIds.has(id))) {
          return res.status(403).json({ ok: false, message: 'La lista incluye alumnos fuera de tu curso' });
        }
        if (students.length !== studentIds.length) {
          return res.status(400).json({ ok: false, message: 'Registra la asistencia de todos los alumnos del curso' });
        }

        const values = records.map(() => '(?, ?, ?, ?, ?)').join(', ');
        const params = records.flatMap((record, index) => [
          req.user.id,
          studentIds[index],
          course.subject,
          date,
          record.status
        ]);
        db.run(`
          INSERT INTO attendance (teacherId, studentId, subject, attendanceDate, status)
          VALUES ${values}
          ON CONFLICT (teacherId, studentId, subject, attendanceDate)
          DO UPDATE SET status = excluded.status, updatedAt = CURRENT_TIMESTAMP
        `, params, function (insertError) {
          if (insertError) {
            return res.status(500).json({ ok: false, message: 'No se pudo guardar la asistencia' });
          }
          res.json({ ok: true, message: 'Asistencia guardada', count: this.changes });
        });
      }
    );
  });
});

app.post('/api/teacher/grades', authenticate, (req, res) => {
  if (req.user.role !== 'teacher') {
    return res.status(403).json({ ok: false, message: 'Solo docentes pueden registrar calificaciones' });
  }

  const { studentId, item, date, grade } = req.body || {};
  const numericGrade = Number(String(grade || '').replace(',', '.'));
  const normalizedItem = typeof item === 'string' ? item.trim() : '';
  const normalizedDate = typeof date === 'string' ? date.trim() : '';
  const parsedStudentId = Number(studentId);
  if (!Number.isSafeInteger(parsedStudentId) || parsedStudentId < 1
    || !normalizedItem || normalizedItem.length > 90
    || !normalizedDate || normalizedDate.length > 40
    || !Number.isFinite(numericGrade) || numericGrade < 1 || numericGrade > 7) {
    return res.status(400).json({ ok: false, message: 'Revisa el alumno, la evaluación, la fecha y la nota (1,0 a 7,0)' });
  }

  findTeacherCourse(req.user.id, (courseError, course) => {
    if (courseError) {
      return res.status(500).json({ ok: false, message: 'No se pudo consultar la asignatura' });
    }
    if (!course) {
      return res.status(404).json({ ok: false, message: 'No se encontró la asignatura del docente' });
    }

    db.get(
      "SELECT id FROM users WHERE id = ? AND role = 'student' AND className = ?",
      [parsedStudentId, course.className],
      (studentError, student) => {
        if (studentError) {
          return res.status(500).json({ ok: false, message: 'No se pudo validar al alumno' });
        }
        if (!student) {
          return res.status(403).json({ ok: false, message: 'El alumno no pertenece a tu curso' });
        }

        const normalizedGrade = numericGrade.toFixed(1).replace('.', ',');
        db.run(
          'INSERT INTO grades (userId, subject, item, date, grade, status) VALUES (?, ?, ?, ?, ?, ?)',
          [parsedStudentId, course.subject, normalizedItem, normalizedDate, normalizedGrade, 'Publicada'],
          function (insertError) {
            if (insertError) {
              return res.status(500).json({ ok: false, message: 'No se pudo registrar la calificación' });
            }
            res.status(201).json({
              ok: true,
              message: 'Calificación registrada',
              grade: {
                id: this.lastID,
                subject: course.subject,
                item: normalizedItem,
                date: normalizedDate,
                grade: normalizedGrade,
                status: 'Publicada'
              }
            });
          }
        );
      }
    );
  });
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
  const today = currentChileDate();
  if (!isAcademicDate(today)) {
    return res.status(403).json({ ok: false, message: 'No se pueden publicar avisos durante vacaciones ni fines de semana.' });
  }

  const { title, body, author } = req.body || {};
  if (!title || !body) {
    return res.status(400).json({ ok: false, message: 'Título y cuerpo obligatorios' });
  }

  const noticeDate = formatNoticeDate(new Date().toISOString().slice(0, 19).replace('T', ' '));
  db.run('INSERT INTO notices (title, body, author, date) VALUES (?, ?, ?, ?)', [title, body, author || 'Equipo docente', noticeDate], function (error) {
    if (error) {
      return res.status(500).json({ ok: false, message: 'No se pudo guardar el aviso' });
    }
    res.status(201).json({ ok: true, message: 'Aviso guardado', notice: { id: this.lastID, title, body, author: author || 'Equipo docente', date: noticeDate } });
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
