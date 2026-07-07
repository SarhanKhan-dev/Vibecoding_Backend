import { DataSource } from 'typeorm';
import * as bcrypt from 'bcryptjs';
import * as fs from 'fs';
import { join } from 'path';
import { User, Subject, ScheduleSlot, Assignment, Exam, Note, FileItem } from './entities';
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
  if (existing >= 8) { await regenFiles(); return; }

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

  console.log('Seeded rich demo data: demo@student.com / demo123');
}
