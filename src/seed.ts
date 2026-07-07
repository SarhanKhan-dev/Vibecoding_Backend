import { DataSource } from 'typeorm';
import * as bcrypt from 'bcryptjs';
import * as fs from 'fs';
import { join } from 'path';
import {
  User, Subject, ScheduleSlot, Assignment, Exam, Note, FileItem,
  Enrollment, LeaveApplication, AttendanceRecord, Quiz, QuizGrade, RetakeRequest,
  QuizQuestion, ClassAssignment, TeacherChangeRequest,
} from './entities';
import { UPLOAD_DIR } from './api';

// ---------- tiny PDF generator (valid single-page PDF with text lines) ----------
function makePdf(lines: string[]): Buffer {
  const esc = (s: string) => s.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
  let text = 'BT /F1 20 Tf 60 760 Td 28 TL\n';
  lines.forEach((l, i) => {
    if (i === 1) text += '/F1 12 Tf\n';
    text += `(${esc(l)}) Tj T*\n`;
  });
  text += 'ET';
  const objs = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${text.length} >>\nstream\n${text}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  let pdf = '%PDF-1.4\n';
  const offsets: number[] = [];
  objs.forEach((o, i) => {
    offsets.push(pdf.length);
    pdf += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = pdf.length;
  pdf += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`;
  offsets.forEach((off) => { pdf += `${String(off).padStart(10, '0')} 00000 n \n`; });
  pdf += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(pdf, 'latin1');
}

function writeSeedPdf(filename: string, lines: string[]) {
  const dir = UPLOAD_DIR.startsWith('/') ? UPLOAD_DIR : join(process.cwd(), UPLOAD_DIR);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(join(dir, filename), makePdf(lines));
}

const day = (n: number, h = 23, m = 59) => {
  const d = new Date(); d.setDate(d.getDate() + n); d.setHours(h, m, 0, 0); return d;
};

export async function seed(ds: DataSource) {
  const users = ds.getRepository(User);
  const subjRepo = ds.getRepository(Subject);
  const slotRepo = ds.getRepository(ScheduleSlot);
  const aRepo = ds.getRepository(Assignment);
  const eRepo = ds.getRepository(Exam);
  const nRepo = ds.getRepository(Note);
  const fRepo = ds.getRepository(FileItem);

  let demo = await users.findOneBy({ email: 'demo@student.com' });
  if (!demo) {
    demo = await users.save(users.create({
      email: 'demo@student.com',
      passwordHash: await bcrypt.hash('demo123', 10),
      name: 'Demo Student',
      university: 'Tech University',
      major: 'Computer Science',
    }));
  }
  const uid = demo.id;

  // Regenerate seed PDFs on disk if missing (Vercel /tmp is wiped on cold starts)
  const regenFiles = async () => {
    const rows = await fRepo.findBy({ userId: uid });
    for (const r of rows) {
      if (!r.filename.startsWith('seed-')) continue;
      const dir = UPLOAD_DIR.startsWith('/') ? UPLOAD_DIR : join(process.cwd(), UPLOAD_DIR);
      if (!fs.existsSync(join(dir, r.filename))) {
        writeSeedPdf(r.filename, [r.originalName.replace('.pdf', ''), 'StudyFlow demo material', 'Generated for the demo account']);
      }
    }
  };

  // Seed version check: rich seed has 8 subjects. If already there, just regen files.
  const existing = await subjRepo.countBy({ userId: uid });
  if (existing >= 8) { await regenFiles(); await seedRbac(ds, demo); await seedOnline(ds, demo); return; }

  // Wipe old (smaller) demo data and reseed rich
  for (const repo of [subjRepo, slotRepo, aRepo, eRepo, nRepo, fRepo] as any[]) {
    await repo.delete({ userId: uid });
  }

  const subs = await subjRepo.save([
    { name: 'Data Structures', code: 'CS-201', color: '#6366f1', teacher: 'Dr. Ahmed Raza', room: 'B-104', credits: 4, grade: 'A-' },
    { name: 'Linear Algebra', code: 'MATH-210', color: '#10b981', teacher: 'Prof. Sana Khan', room: 'A-201', credits: 3, grade: 'B+' },
    { name: 'Operating Systems', code: 'CS-305', color: '#f59e0b', teacher: 'Dr. Fatima Noor', room: 'Lab-2', credits: 4, grade: 'A' },
    { name: 'Technical Writing', code: 'ENG-102', color: '#ec4899', teacher: 'Ms. Sara Malik', room: 'C-110', credits: 2, grade: 'A' },
    { name: 'Database Systems', code: 'CS-310', color: '#06b6d4', teacher: 'Dr. Ali Hassan', room: 'Lab-1', credits: 3, grade: 'B+' },
    { name: 'Computer Networks', code: 'CS-330', color: '#8b5cf6', teacher: 'Dr. Usman Tariq', room: 'B-201', credits: 3, grade: '' },
    { name: 'Probability & Stats', code: 'MATH-301', color: '#ef4444', teacher: 'Prof. Hina Shah', room: 'A-105', credits: 3, grade: '' },
    { name: 'Software Engineering', code: 'CS-350', color: '#14b8a6', teacher: 'Dr. Bilal Aslam', room: 'C-204', credits: 3, grade: '' },
  ].map((s) => subjRepo.create({ ...s, userId: uid })));

  const [dsx, math, os, eng, db, net, stats, se] = subs;

  await slotRepo.save([
    // Monday
    { day: 0, startTime: '08:30', endTime: '10:00', subjectId: dsx.id, room: 'B-104', type: 'lecture' },
    { day: 0, startTime: '10:15', endTime: '11:45', subjectId: math.id, room: 'A-201', type: 'lecture' },
    { day: 0, startTime: '13:00', endTime: '14:30', subjectId: net.id, room: 'B-201', type: 'lecture' },
    { day: 0, startTime: '15:00', endTime: '17:00', subjectId: db.id, room: 'Lab-1', type: 'lab' },
    // Tuesday
    { day: 1, startTime: '09:00', endTime: '11:00', subjectId: os.id, room: 'Lab-2', type: 'lab' },
    { day: 1, startTime: '11:15', endTime: '12:15', subjectId: eng.id, room: 'C-110', type: 'tutorial' },
    { day: 1, startTime: '13:00', endTime: '14:30', subjectId: stats.id, room: 'A-105', type: 'lecture' },
    { day: 1, startTime: '15:00', endTime: '16:30', subjectId: se.id, room: 'C-204', type: 'lecture' },
    // Wednesday
    { day: 2, startTime: '08:30', endTime: '10:00', subjectId: dsx.id, room: 'B-104', type: 'lecture' },
    { day: 2, startTime: '10:15', endTime: '11:45', subjectId: net.id, room: 'B-201', type: 'lecture' },
    { day: 2, startTime: '13:00', endTime: '15:00', subjectId: dsx.id, room: 'Lab-3', type: 'lab' },
    { day: 2, startTime: '15:15', endTime: '16:15', subjectId: math.id, room: 'A-201', type: 'tutorial' },
    // Thursday
    { day: 3, startTime: '09:00', endTime: '10:30', subjectId: os.id, room: 'B-201', type: 'lecture' },
    { day: 3, startTime: '10:45', endTime: '12:15', subjectId: math.id, room: 'A-201', type: 'lecture' },
    { day: 3, startTime: '13:00', endTime: '14:30', subjectId: db.id, room: 'A-105', type: 'lecture' },
    { day: 3, startTime: '15:00', endTime: '16:30', subjectId: se.id, room: 'C-204', type: 'lecture' },
    // Friday
    { day: 4, startTime: '09:00', endTime: '10:30', subjectId: stats.id, room: 'A-105', type: 'lecture' },
    { day: 4, startTime: '10:45', endTime: '12:15', subjectId: db.id, room: 'A-105', type: 'lecture' },
    { day: 4, startTime: '14:00', endTime: '16:00', subjectId: net.id, room: 'Lab-4', type: 'lab' },
    // Saturday
    { day: 5, startTime: '10:00', endTime: '12:00', subjectId: se.id, room: 'Lab-1', type: 'lab' },
    { day: 5, startTime: '12:15', endTime: '13:15', subjectId: eng.id, room: 'C-110', type: 'lecture' },
  ].map((s) => slotRepo.create({ ...s, userId: uid })));

  await aRepo.save([
    { title: 'AVL Tree Implementation', description: 'Implement insert/delete with rotations, include complexity analysis', subjectId: dsx.id, dueDate: day(1, 23), priority: 'high', status: 'in_progress' },
    { title: 'Graph Traversal Quiz Prep', description: 'BFS, DFS, Dijkstra practice problems', subjectId: dsx.id, dueDate: day(3, 9), priority: 'medium', status: 'todo' },
    { title: 'Problem Set 4 - Eigenvalues', description: 'Q1-Q12 from chapter 6', subjectId: math.id, dueDate: day(2, 17), priority: 'high', status: 'todo' },
    { title: 'Matrix Decomposition Worksheet', description: 'LU and QR decomposition exercises', subjectId: math.id, dueDate: day(8, 23), priority: 'low', status: 'todo' },
    { title: 'Process Scheduler Report', description: 'Compare Round Robin vs SJF vs MLFQ with benchmarks', subjectId: os.id, dueDate: day(5, 23), priority: 'high', status: 'in_progress' },
    { title: 'Deadlock Lab Exercise', description: 'Bankers algorithm implementation', subjectId: os.id, dueDate: day(-2, 23), priority: 'medium', status: 'done' },
    { title: 'Tech Ethics Essay', description: '1500 words on AI and privacy, APA format', subjectId: eng.id, dueDate: day(-1, 23), priority: 'medium', status: 'todo' },
    { title: 'ER Diagram - E-commerce Schema', description: 'Full schema with normalization to 3NF', subjectId: db.id, dueDate: day(4, 23), priority: 'high', status: 'in_progress' },
    { title: 'SQL Joins Practice Set', description: '20 queries on the university sample DB', subjectId: db.id, dueDate: day(-4, 23), priority: 'low', status: 'done' },
    { title: 'Subnetting Worksheet', description: 'CIDR and VLSM problems', subjectId: net.id, dueDate: day(6, 23), priority: 'medium', status: 'todo' },
    { title: 'Wireshark Packet Analysis', description: 'Capture and annotate a TCP handshake', subjectId: net.id, dueDate: day(9, 23), priority: 'low', status: 'todo' },
    { title: 'Bayes Theorem Problem Set', description: 'Chapter 4, all odd questions', subjectId: stats.id, dueDate: day(7, 23), priority: 'medium', status: 'todo' },
    { title: 'SRS Document Draft', description: 'Requirements spec for group project', subjectId: se.id, dueDate: day(10, 23), priority: 'high', status: 'todo' },
    { title: 'Git Workflow Exercise', description: 'Branching, PRs and code review practice', subjectId: se.id, dueDate: day(-6, 23), priority: 'low', status: 'done' },
  ].map((a) => aRepo.create({ ...a, userId: uid })));

  await eRepo.save([
    { title: 'Midterm - Data Structures', subjectId: dsx.id, date: day(6, 9, 0), location: 'Main Hall A', notes: 'Chapters 1-6: arrays, lists, trees, graphs. Closed book.' },
    { title: 'Quiz 3 - Linear Algebra', subjectId: math.id, date: day(3, 11, 0), location: 'A-201', notes: 'Determinants and eigenvalues' },
    { title: 'OS Lab Viva', subjectId: os.id, date: day(9, 14, 0), location: 'Lab-2', notes: 'Scheduling + memory management code walkthrough' },
    { title: 'Midterm - Database Systems', subjectId: db.id, date: day(12, 10, 0), location: 'Main Hall B', notes: 'ERD, normalization, SQL. One A4 cheat sheet allowed.' },
    { title: 'Networks Quiz - OSI & TCP/IP', subjectId: net.id, date: day(5, 13, 0), location: 'B-201', notes: 'Layers, encapsulation, addressing' },
    { title: 'Stats Midterm', subjectId: stats.id, date: day(15, 9, 30), location: 'A-105', notes: 'Probability, distributions, Bayes. Calculator allowed.' },
  ].map((e) => eRepo.create({ ...e, userId: uid })));

  await nRepo.save([
    { title: 'AVL Rotation Cheatsheet', content: 'LL -> right rotate\nRR -> left rotate\nLR -> left then right\nRL -> right then left\n\nBalance factor = height(L) - height(R), must stay in [-1, 1].\nRebalance bottom-up after insert/delete.', subjectId: dsx.id, pinned: true },
    { title: 'Big-O Quick Reference', content: 'Array access O(1)\nBinary search O(log n)\nHashmap avg O(1), worst O(n)\nHeap push/pop O(log n)\nQuicksort avg O(n log n), worst O(n^2)\nBFS/DFS O(V+E)', subjectId: dsx.id, pinned: false },
    { title: 'Normalization Quick Notes', content: '1NF: atomic values\n2NF: no partial dependency\n3NF: no transitive dependency\nBCNF: every determinant is a candidate key\n\nDenormalize only for measured read performance wins.', subjectId: db.id, pinned: true },
    { title: 'TCP vs UDP', content: 'TCP: connection-oriented, reliable, ordered, flow control. Use: web, email, files.\nUDP: connectionless, fast, no guarantees. Use: DNS, streaming, gaming.\n\n3-way handshake: SYN -> SYN/ACK -> ACK', subjectId: net.id, pinned: false },
    { title: 'Deadlock Conditions (Coffman)', content: '1. Mutual exclusion\n2. Hold and wait\n3. No preemption\n4. Circular wait\n\nAll four must hold. Prevent by breaking any one.', subjectId: os.id, pinned: false },
    { title: 'Essay Structure Template', content: 'Hook -> context -> thesis\nBody: one claim per paragraph, evidence, analysis\nCounter-argument + rebuttal\nConclusion: restate thesis, broader implication\n\nAlways write the intro last.', subjectId: eng.id, pinned: false },
    { title: 'Bayes Theorem Intuition', content: 'P(A|B) = P(B|A) * P(A) / P(B)\n\nPosterior = Likelihood x Prior / Evidence\nUpdate beliefs as new evidence arrives.', subjectId: stats.id, pinned: false },
    { title: 'Semester Goals', content: '- GPA above 3.5\n- Finish StudyFlow side project\n- Join the programming society\n- 4 pomodoros minimum per day\n- Sleep before 1am (be realistic)', subjectId: null, pinned: true },
  ].map((n) => nRepo.create({ ...n, userId: uid })));

  // ---------- seeded files: lecture slides per subject + uploaded timetable ----------
  const slideDefs = [
    { subj: dsx, name: 'Week 5 - Balanced Trees.pdf', file: 'seed-ds-w5.pdf' },
    { subj: dsx, name: 'Week 6 - Graphs Intro.pdf', file: 'seed-ds-w6.pdf' },
    { subj: math, name: 'Lecture 12 - Eigenvalues.pdf', file: 'seed-math-l12.pdf' },
    { subj: math, name: 'Lecture 13 - Diagonalization.pdf', file: 'seed-math-l13.pdf' },
    { subj: os, name: 'CPU Scheduling Slides.pdf', file: 'seed-os-sched.pdf' },
    { subj: os, name: 'Memory Management Slides.pdf', file: 'seed-os-mem.pdf' },
    { subj: db, name: 'Normalization Deep Dive.pdf', file: 'seed-db-norm.pdf' },
    { subj: db, name: 'SQL Joins Masterclass.pdf', file: 'seed-db-joins.pdf' },
    { subj: net, name: 'OSI Model Explained.pdf', file: 'seed-net-osi.pdf' },
    { subj: eng, name: 'Academic Writing Guide.pdf', file: 'seed-eng-guide.pdf' },
    { subj: stats, name: 'Probability Distributions.pdf', file: 'seed-stats-dist.pdf' },
    { subj: se, name: 'Agile & Scrum Overview.pdf', file: 'seed-se-agile.pdf' },
  ];
  for (const s of slideDefs) {
    writeSeedPdf(s.file, [s.name.replace('.pdf', ''), `${s.subj.name} (${s.subj.code}) - ${s.subj.teacher}`, 'StudyFlow demo lecture material']);
  }
  writeSeedPdf('seed-timetable.pdf', ['Fall Semester Timetable', 'Demo Student - Computer Science', 'Original uploaded timetable (reference copy)']);

  await fRepo.save([
    ...slideDefs.map((s) => fRepo.create({
      userId: uid, filename: s.file, originalName: s.name,
      mimetype: 'application/pdf', size: 1200, subjectId: s.subj.id, kind: 'slide',
    })),
    fRepo.create({
      userId: uid, filename: 'seed-timetable.pdf', originalName: 'fall-timetable.pdf',
      mimetype: 'application/pdf', size: 1200, kind: 'timetable',
    }),
  ]);

  await seedRbac(ds, demo);
  await seedOnline(ds, demo);
  console.log('Seeded rich demo data: demo@student.com / demo123');
}

// ---------- RBAC seed: superadmin, teacher, enrolled students, leaves, attendance, quizzes ----------
async function seedRbac(ds: DataSource, demo: User) {
  const users = ds.getRepository(User);
  const subjRepo = ds.getRepository(Subject);
  const enrRepo = ds.getRepository(Enrollment);
  const leaveRepo = ds.getRepository(LeaveApplication);
  const attRepo = ds.getRepository(AttendanceRecord);
  const quizRepo = ds.getRepository(Quiz);
  const gradeRepo = ds.getRepository(QuizGrade);
  const retakeRepo = ds.getRepository(RetakeRequest);

  if (await users.findOneBy({ email: 'teacher@studyflow.com' })) {
    // regenerate document PDFs (Vercel /tmp is wiped on cold starts)
    writeSeedPdf('seed-medical-cert.pdf', ['Medical Certificate', 'Patient: Demo Student', 'Advised rest for 2 days - City Hospital']);
    writeSeedPdf('seed-event-letter.pdf', ['Event Participation Letter', 'Student: Ali Hamza', 'National Hackathon 2026 - Invitation']);
    writeSeedPdf('seed-retake-doc.pdf', ['Supporting Document', 'Student: Demo Student', 'Hospital admission slip for quiz day']);
    return;
  }

  const mk = async (email: string, name: string, role: string, pass: string) =>
    users.save(users.create({
      email, name, role, passwordHash: await bcrypt.hash(pass, 10),
      university: 'Tech University', major: role === 'student' ? 'Computer Science' : '',
    }));

  const admin = await users.findOneBy({ email: 'admin@studyflow.com' })
    || await mk('admin@studyflow.com', 'Super Admin', 'superadmin', 'admin123');
  const teacher = await mk('teacher@studyflow.com', 'Dr. Ahmed Raza', 'teacher', 'teacher123');
  const s1 = await mk('ali@student.com', 'Ali Hamza', 'student', 'demo123');
  const s2 = await mk('zara@student.com', 'Zara Sheikh', 'student', 'demo123');
  const s3 = await mk('omar@student.com', 'Omar Farooq', 'student', 'demo123');
  const s4 = await mk('ayesha@student.com', 'Ayesha Iqbal', 'student', 'demo123');
  const studentIds = [demo.id, s1.id, s2.id, s3.id, s4.id];

  const tSub1 = await subjRepo.save(subjRepo.create({
    userId: teacher.id, teacherId: teacher.id, name: 'Data Structures', code: 'CS-201',
    color: '#6366f1', teacher: teacher.name, room: 'B-104', credits: 4,
  }));
  const tSub2 = await subjRepo.save(subjRepo.create({
    userId: teacher.id, teacherId: teacher.id, name: 'Database Systems', code: 'CS-310',
    color: '#06b6d4', teacher: teacher.name, room: 'Lab-1', credits: 3,
  }));

  for (const sub of [tSub1, tSub2]) {
    await enrRepo.save(studentIds.map((sid) => enrRepo.create({ subjectId: sub.id, studentId: sid })));
  }

  // Attendance: last 3 class days for CS-201
  const dstr = (n: number) => { const d = new Date(); d.setDate(d.getDate() - n); return d.toISOString().slice(0, 10); };
  const statuses = [
    ['present', 'present', 'absent', 'present', 'late'],
    ['present', 'late', 'present', 'absent', 'present'],
    ['present', 'present', 'present', 'present', 'absent'],
  ];
  for (let day = 0; day < 3; day++) {
    await attRepo.save(studentIds.map((sid, i) => attRepo.create({
      subjectId: tSub1.id, teacherId: teacher.id, studentId: sid, date: dstr(day * 2 + 1), status: statuses[day][i],
    })));
  }

  // Quizzes: one fully graded, one with demo student marked missed
  const q1 = await quizRepo.save(quizRepo.create({
    subjectId: tSub1.id, teacherId: teacher.id, title: 'Quiz 1 - Trees & Recursion',
    description: 'AVL rotations, tree traversals', totalMarks: 10, date: day(-7, 9),
  }));
  const q1marks = [8.5, 7, 9, 6.5, 8];
  await gradeRepo.save(studentIds.map((sid, i) => gradeRepo.create({
    quizId: q1.id, studentId: sid, marks: q1marks[i], status: 'graded',
  })));

  const q2 = await quizRepo.save(quizRepo.create({
    subjectId: tSub1.id, teacherId: teacher.id, title: 'Quiz 2 - Graph Algorithms',
    description: 'BFS, DFS, shortest paths', totalMarks: 15, date: day(-2, 9),
  }));
  await gradeRepo.save(studentIds.map((sid, i) => gradeRepo.create({
    quizId: q2.id, studentId: sid,
    marks: sid === demo.id ? null : [null, 12, 13.5, 10, 11][i],
    status: sid === demo.id ? 'missed' : 'graded',
  })));

  const q3 = await quizRepo.save(quizRepo.create({
    subjectId: tSub2.id, teacherId: teacher.id, title: 'Quiz 1 - SQL & Normalization',
    description: 'Joins, 3NF, BCNF', totalMarks: 20, date: day(3, 10),
  }));

  // Leave applications (with supporting PDF documents)
  writeSeedPdf('seed-medical-cert.pdf', ['Medical Certificate', 'Patient: Demo Student', 'Advised rest for 2 days - City Hospital']);
  writeSeedPdf('seed-event-letter.pdf', ['Event Participation Letter', 'Student: Ali Hamza', 'National Hackathon 2026 - Invitation']);
  await leaveRepo.save([
    leaveRepo.create({
      studentId: demo.id, subjectId: tSub1.id,
      reason: 'I was ill with a high fever and could not attend classes. Medical certificate attached.',
      fromDate: dstr(3), toDate: dstr(2), filename: 'seed-medical-cert.pdf', originalName: 'medical-certificate.pdf',
    }),
    leaveRepo.create({
      studentId: s1.id, subjectId: tSub1.id,
      reason: 'Representing the university at the National Hackathon. Invitation letter attached.',
      fromDate: dstr(1), toDate: dstr(0), filename: 'seed-event-letter.pdf', originalName: 'hackathon-invitation.pdf',
      status: 'approved', teacherComment: 'Approved - good luck at the hackathon!',
    }),
  ]);

  // Retake request from demo student for the missed quiz (with document)
  writeSeedPdf('seed-retake-doc.pdf', ['Supporting Document', 'Student: Demo Student', 'Hospital admission slip for quiz day']);
  await retakeRepo.save(retakeRepo.create({
    quizId: q2.id, studentId: demo.id,
    reason: 'I missed Quiz 2 because I was admitted to the hospital that morning. Admission slip attached. Requesting a retake.',
    filename: 'seed-retake-doc.pdf', originalName: 'hospital-slip.pdf',
  }));

  console.log('Seeded RBAC: admin@studyflow.com/admin123, teacher@studyflow.com/teacher123');
}

// ---------- Online quiz / exam / classwork seed (idempotent) ----------
async function seedOnline(ds: DataSource, demo: User) {
  const users = ds.getRepository(User);
  const subjRepo = ds.getRepository(Subject);
  const quizRepo = ds.getRepository(Quiz);
  const qRepo = ds.getRepository(QuizQuestion);
  const caRepo = ds.getRepository(ClassAssignment);
  const tcRepo = ds.getRepository(TeacherChangeRequest);

  if (await qRepo.count() > 0) return; // already seeded

  const teacher = await users.findOneBy({ email: 'teacher@studyflow.com' });
  if (!teacher) return;
  const tSubs = await subjRepo.findBy({ teacherId: teacher.id });
  const cs201 = tSubs.find((s) => s.code === 'CS-201') || tSubs[0];
  const cs310 = tSubs.find((s) => s.code === 'CS-310') || tSubs[0];
  if (!cs201) return;

  const mcq = (text: string, options: string[], correct: number) => ({ text, options, correct });

  // Live online quiz (open for the next 24h so the demo always works)
  const live = await quizRepo.save(quizRepo.create({
    subjectId: cs201.id, teacherId: teacher.id, kind: 'online',
    title: 'Online Quiz - Big-O & Trees', description: 'Timed MCQ quiz: 60 seconds per question',
    totalMarks: 5, questionsPerStudent: 5, secondsPerQuestion: 60,
    startAt: new Date(Date.now() - 3600000), endAt: new Date(Date.now() + 24 * 3600000),
    date: new Date(),
  }));
  await qRepo.save([
    mcq('What is the time complexity of binary search?', ['O(n)', 'O(log n)', 'O(n log n)', 'O(1)'], 1),
    mcq('Which data structure uses LIFO ordering?', ['Queue', 'Stack', 'Heap', 'Deque'], 1),
    mcq('The height of a balanced BST with n nodes is:', ['O(n)', 'O(n^2)', 'O(log n)', 'O(1)'], 2),
    mcq('Which traversal of a BST yields sorted order?', ['Preorder', 'Postorder', 'Inorder', 'Level-order'], 2),
    mcq('Worst case of quicksort is:', ['O(n log n)', 'O(n)', 'O(n^2)', 'O(log n)'], 2),
    mcq('A complete binary tree with n nodes has height:', ['n', 'log2(n)', 'sqrt(n)', 'n/2'], 1),
    mcq('Which structure backs a priority queue efficiently?', ['Linked list', 'Heap', 'Stack', 'Hash map'], 1),
  ].map((q) => qRepo.create({ ...q, quizId: live.id })));

  // Exam draft: teacher uploaded questions, superadmin still has to schedule it
  const exam = await quizRepo.save(quizRepo.create({
    subjectId: cs310.id, teacherId: teacher.id, kind: 'exam',
    title: 'Final Exam - Database Systems', description: 'Each student receives a randomized MCQ set, 1 minute per question.',
    totalMarks: 8, questionsPerStudent: 8, secondsPerQuestion: 60,
    startAt: null, endAt: null, date: new Date(),
  }));
  await qRepo.save([
    mcq('Which normal form removes partial dependencies?', ['1NF', '2NF', '3NF', 'BCNF'], 1),
    mcq('A primary key must be:', ['Unique and not null', 'Only unique', 'Only not null', 'Indexed'], 0),
    mcq('Which JOIN returns all rows from both tables?', ['INNER', 'LEFT', 'RIGHT', 'FULL OUTER'], 3),
    mcq('ACID stands for Atomicity, Consistency, Isolation and:', ['Distribution', 'Durability', 'Dependency', 'Delegation'], 1),
    mcq('An index primarily speeds up:', ['INSERT', 'SELECT', 'DELETE', 'GRANT'], 1),
    mcq('Which SQL clause filters grouped rows?', ['WHERE', 'HAVING', 'GROUP BY', 'ORDER BY'], 1),
    mcq('A foreign key enforces:', ['Uniqueness', 'Referential integrity', 'Atomicity', 'Normalization'], 1),
    mcq('Which isolation level allows dirty reads?', ['SERIALIZABLE', 'REPEATABLE READ', 'READ COMMITTED', 'READ UNCOMMITTED'], 3),
    mcq('BCNF requires every determinant to be a:', ['Foreign key', 'Candidate key', 'Super key', 'Composite key'], 1),
    mcq('Denormalization is done mainly to improve:', ['Write safety', 'Read performance', 'Integrity', 'Security'], 1),
  ].map((q) => qRepo.create({ ...q, quizId: exam.id })));
  writeSeedPdf('seed-exam-ref.pdf', ['Final Exam Question Bank', 'Database Systems (CS-310)', 'CONFIDENTIAL - teacher reference copy']);
  exam.refFilename = 'seed-exam-ref.pdf';
  exam.refOriginalName = 'final-exam-question-bank.pdf';
  await quizRepo.save(exam);

  // Digital classwork with answer key (auto-graded)
  await caRepo.save(caRepo.create({
    subjectId: cs201.id, teacherId: teacher.id,
    title: 'Worksheet 3 - Complexity Basics',
    description: 'Answer briefly. Answers are auto-checked, so keep them exact.',
    dueDate: day(4, 23),
    questions: [
      { q: 'What is the Big-O of linear search? (format: O(...))', answer: 'O(n)', marks: 2 },
      { q: 'Name the tree rotation used for a Left-Left imbalance (two words).', answer: 'right rotate', marks: 2 },
      { q: 'What does FIFO stand for? (four words)', answer: 'first in first out', marks: 1 },
    ],
  }));

  // A pending teacher-change request for the superadmin demo
  const ali = await users.findOneBy({ email: 'ali@student.com' });
  if (ali) {
    writeSeedPdf('seed-change-req.pdf', ['Teacher Change Request', 'Student: Ali Hamza', 'Supporting summary of scheduling conflicts']);
    await tcRepo.save(tcRepo.create({
      studentId: ali.id, subjectId: cs201.id,
      reason: 'My section timing clashes with my part-time work permit hours. Requesting transfer to the evening section.',
      desiredTeacher: 'Dr. Fatima Noor (evening section)',
      filename: 'seed-change-req.pdf', originalName: 'schedule-conflict-summary.pdf',
    }));
  }

  console.log('Seeded online quiz, exam draft, classwork and change request');
}
