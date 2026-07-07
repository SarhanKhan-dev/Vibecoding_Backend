import { DataSource } from 'typeorm';
import * as bcrypt from 'bcryptjs';
import { User, Subject, ScheduleSlot, Assignment, Exam, Note } from './entities';

export async function seed(ds: DataSource) {
  const users = ds.getRepository(User);
  if (await users.findOneBy({ email: 'demo@student.com' })) return;

  const demo = await users.save(users.create({
    email: 'demo@student.com',
    passwordHash: await bcrypt.hash('demo123', 10),
    name: 'Demo Student',
    university: 'Tech University',
    major: 'Computer Science',
  }));
  const uid = demo.id;

  const subjRepo = ds.getRepository(Subject);
  const subs = await subjRepo.save([
    { userId: uid, name: 'Data Structures', code: 'CS-201', color: '#6366f1', teacher: 'Dr. Ahmed', room: 'B-104', credits: 4, grade: 'A-' },
    { userId: uid, name: 'Linear Algebra', code: 'MATH-210', color: '#10b981', teacher: 'Prof. Khan', room: 'A-201', credits: 3, grade: 'B+' },
    { userId: uid, name: 'Operating Systems', code: 'CS-305', color: '#f59e0b', teacher: 'Dr. Fatima', room: 'Lab-2', credits: 4, grade: '' },
    { userId: uid, name: 'Technical Writing', code: 'ENG-102', color: '#ec4899', teacher: 'Ms. Sara', room: 'C-110', credits: 2, grade: 'A' },
    { userId: uid, name: 'Database Systems', code: 'CS-310', color: '#06b6d4', teacher: 'Dr. Ali', room: 'Lab-1', credits: 3, grade: '' },
  ].map((s) => subjRepo.create(s)));

  const [ds201, math, os, eng, db] = subs;
  const slotRepo = ds.getRepository(ScheduleSlot);
  await slotRepo.save([
    { userId: uid, day: 0, startTime: '09:00', endTime: '10:30', subjectId: ds201.id, room: 'B-104', type: 'lecture' },
    { userId: uid, day: 0, startTime: '11:00', endTime: '12:30', subjectId: math.id, room: 'A-201', type: 'lecture' },
    { userId: uid, day: 1, startTime: '09:00', endTime: '11:00', subjectId: os.id, room: 'Lab-2', type: 'lab' },
    { userId: uid, day: 1, startTime: '13:00', endTime: '14:00', subjectId: eng.id, room: 'C-110', type: 'tutorial' },
    { userId: uid, day: 2, startTime: '10:00', endTime: '11:30', subjectId: ds201.id, room: 'B-104', type: 'lecture' },
    { userId: uid, day: 2, startTime: '14:00', endTime: '16:00', subjectId: db.id, room: 'Lab-1', type: 'lab' },
    { userId: uid, day: 3, startTime: '09:00', endTime: '10:30', subjectId: math.id, room: 'A-201', type: 'lecture' },
    { userId: uid, day: 3, startTime: '11:00', endTime: '12:30', subjectId: os.id, room: 'B-201', type: 'lecture' },
    { userId: uid, day: 4, startTime: '10:00', endTime: '11:30', subjectId: db.id, room: 'A-105', type: 'lecture' },
  ].map((s) => slotRepo.create(s)));

  const day = (n: number, h = 23) => { const d = new Date(); d.setDate(d.getDate() + n); d.setHours(h, 59, 0, 0); return d; };
  const aRepo = ds.getRepository(Assignment);
  await aRepo.save([
    { userId: uid, title: 'Binary Tree Implementation', description: 'Implement AVL tree with rotations', subjectId: ds201.id, dueDate: day(2), priority: 'high', status: 'in_progress' },
    { userId: uid, title: 'Problem Set 4', description: 'Eigenvalues & eigenvectors', subjectId: math.id, dueDate: day(4), priority: 'medium', status: 'todo' },
    { userId: uid, title: 'Process Scheduler Report', description: 'Compare RR vs SJF', subjectId: os.id, dueDate: day(6), priority: 'medium', status: 'todo' },
    { userId: uid, title: 'Essay Draft', description: 'Tech ethics essay, 1500 words', subjectId: eng.id, dueDate: day(-1), priority: 'low', status: 'todo' },
    { userId: uid, title: 'ER Diagram Project', description: 'Design schema for e-commerce', subjectId: db.id, dueDate: day(9), priority: 'high', status: 'todo' },
    { userId: uid, title: 'Sorting Quiz Prep', description: '', subjectId: ds201.id, dueDate: day(-3), priority: 'medium', status: 'done' },
  ].map((a) => aRepo.create(a)));

  const eRepo = ds.getRepository(Exam);
  await eRepo.save([
    { userId: uid, title: 'Midterm — Data Structures', subjectId: ds201.id, date: day(10, 9), location: 'Main Hall', notes: 'Chapters 1-6, trees & graphs' },
    { userId: uid, title: 'Quiz 3 — Linear Algebra', subjectId: math.id, date: day(5, 11), location: 'A-201', notes: 'Determinants' },
    { userId: uid, title: 'OS Lab Viva', subjectId: os.id, date: day(15, 14), location: 'Lab-2', notes: '' },
  ].map((e) => eRepo.create(e)));

  const nRepo = ds.getRepository(Note);
  await nRepo.save([
    { userId: uid, title: 'AVL Rotation Cheatsheet', content: 'LL -> right rotate\nRR -> left rotate\nLR -> left then right\nRL -> right then left\n\nBalance factor = height(L) - height(R), must stay in [-1, 1].', subjectId: ds201.id, pinned: true },
    { userId: uid, title: 'Normalization Quick Notes', content: '1NF: atomic values\n2NF: no partial dependency\n3NF: no transitive dependency\nBCNF: every determinant is a candidate key', subjectId: db.id, pinned: false },
    { userId: uid, title: 'Semester Goals', content: '- GPA above 3.5\n- Finish side project\n- Join programming society', subjectId: null, pinned: true },
  ].map((n) => nRepo.create(n)));

  console.log('✅ Seeded demo account: demo@student.com / demo123');
}
