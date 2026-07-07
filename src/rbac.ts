import {
  Body, Controller, Delete, Get, Param, ParseIntPipe, Patch, Post, Query,
  UploadedFile, UseInterceptors, BadRequestException, NotFoundException, ForbiddenException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In } from 'typeorm';
import { diskStorage } from 'multer';
import { extname } from 'path';
import * as fs from 'fs';
import { CurrentUser, Roles } from './auth';
import * as bcrypt from 'bcryptjs';
import {
  User, Subject, Enrollment, LeaveApplication, AttendanceRecord, Quiz, QuizGrade, RetakeRequest,
} from './entities';
import { UPLOAD_DIR } from './api';

const storage = diskStorage({
  destination: (_req, _file, cb) => {
    if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });
    cb(null, UPLOAD_DIR);
  },
  filename: (_req, file, cb) =>
    cb(null, `${Date.now()}-${Math.round(Math.random() * 1e6)}${extname(file.originalname)}`),
});

const safeUser = (u: User) => ({ id: u.id, name: u.name, email: u.email, university: u.university, major: u.major, role: u.role });

// ---------------- Teacher: subjects & students ----------------
@Controller('teacher')
export class TeacherController {
  constructor(
    @InjectRepository(Subject) private subjects: Repository<Subject>,
    @InjectRepository(Enrollment) private enrollments: Repository<Enrollment>,
    @InjectRepository(User) private users: Repository<User>,
  ) {}

  @Roles('teacher', 'superadmin')
  @Get('subjects')
  async mySubjects(@CurrentUser() u: any) {
    const subs = await this.subjects.find({ where: { teacherId: u.sub }, order: { name: 'ASC' } });
    const result = [];
    for (const s of subs) {
      const count = await this.enrollments.countBy({ subjectId: s.id });
      result.push({ ...s, studentCount: count });
    }
    return result;
  }

  @Roles('teacher', 'superadmin')
  @Post('subjects')
  create(@CurrentUser() u: any, @Body() body: any) {
    if (!body?.name) throw new BadRequestException('name is required');
    return this.subjects.save(this.subjects.create({
      ...body, id: undefined, userId: u.sub, teacherId: u.sub, teacher: u.name, grade: '',
    }));
  }

  @Roles('teacher', 'superadmin')
  @Get('subjects/:id/students')
  async students(@CurrentUser() u: any, @Param('id', ParseIntPipe) id: number) {
    const subject = await this.subjects.findOneBy({ id, teacherId: u.sub });
    if (!subject) throw new NotFoundException('Subject not found');
    const enr = await this.enrollments.findBy({ subjectId: id });
    if (!enr.length) return [];
    const students = await this.users.findBy({ id: In(enr.map((e) => e.studentId)) });
    return students.map(safeUser);
  }

  @Roles('teacher', 'superadmin')
  @Post('subjects/:id/students')
  async enroll(@CurrentUser() u: any, @Param('id', ParseIntPipe) id: number, @Body() body: any) {
    const subject = await this.subjects.findOneBy({ id, teacherId: u.sub });
    if (!subject) throw new NotFoundException('Subject not found');
    const student = await this.users.findOneBy({ email: (body?.email || '').toLowerCase() });
    if (!student) throw new BadRequestException('No user with that email');
    if (student.role !== 'student') throw new BadRequestException('That user is not a student');
    const dup = await this.enrollments.findOneBy({ subjectId: id, studentId: student.id });
    if (dup) throw new BadRequestException('Student already enrolled');
    await this.enrollments.save(this.enrollments.create({ subjectId: id, studentId: student.id }));
    return safeUser(student);
  }

  @Roles('teacher', 'superadmin')
  @Delete('subjects/:id/students/:studentId')
  async unenroll(@CurrentUser() u: any, @Param('id', ParseIntPipe) id: number, @Param('studentId', ParseIntPipe) studentId: number) {
    const subject = await this.subjects.findOneBy({ id, teacherId: u.sub });
    if (!subject) throw new NotFoundException('Subject not found');
    await this.enrollments.delete({ subjectId: id, studentId });
    return { ok: true };
  }
}

// ---------------- Student: my enrollments ----------------
@Controller('my')
export class MyController {
  constructor(
    @InjectRepository(Enrollment) private enrollments: Repository<Enrollment>,
    @InjectRepository(Subject) private subjects: Repository<Subject>,
  ) {}

  @Get('enrollments')
  async list(@CurrentUser() u: any) {
    const enr = await this.enrollments.findBy({ studentId: u.sub });
    if (!enr.length) return [];
    return this.subjects.findBy({ id: In(enr.map((e) => e.subjectId)) });
  }
}

// ---------------- Leaves ----------------
@Controller('leaves')
export class LeavesController {
  constructor(
    @InjectRepository(LeaveApplication) private leaves: Repository<LeaveApplication>,
    @InjectRepository(Subject) private subjects: Repository<Subject>,
    @InjectRepository(User) private users: Repository<User>,
  ) {}

  @Roles('student')
  @Post()
  @UseInterceptors(FileInterceptor('file', { storage, limits: { fileSize: 20 * 1024 * 1024 } }))
  async apply(@CurrentUser() u: any, @Body() body: any, @UploadedFile() file?: Express.Multer.File) {
    if (!body?.subjectId || !body?.reason) throw new BadRequestException('subjectId and reason are required');
    return this.leaves.save(this.leaves.create({
      studentId: u.sub, subjectId: +body.subjectId, reason: body.reason,
      fromDate: body.fromDate || '', toDate: body.toDate || '',
      filename: file?.filename || null, originalName: file?.originalname || '',
    }));
  }

  @Get()
  async list(@CurrentUser() u: any) {
    let items: LeaveApplication[];
    if (u.role === 'teacher' || u.role === 'superadmin') {
      const subs = await this.subjects.findBy({ teacherId: u.sub });
      items = subs.length
        ? await this.leaves.find({ where: { subjectId: In(subs.map((s) => s.id)) }, order: { createdAt: 'DESC' } })
        : [];
    } else {
      items = await this.leaves.find({ where: { studentId: u.sub }, order: { createdAt: 'DESC' } });
    }
    return this.decorate(items);
  }

  private async decorate(items: LeaveApplication[]) {
    if (!items.length) return [];
    const students = await this.users.findBy({ id: In(items.map((i) => i.studentId)) });
    const subs = await this.subjects.findBy({ id: In(items.map((i) => i.subjectId)) });
    return items.map((i) => ({
      ...i,
      student: safeUser(students.find((s) => s.id === i.studentId) || ({} as User)),
      subject: subs.find((s) => s.id === i.subjectId) || null,
    }));
  }

  @Roles('teacher', 'superadmin')
  @Patch(':id')
  async decide(@CurrentUser() u: any, @Param('id', ParseIntPipe) id: number, @Body() body: any) {
    const item = await this.leaves.findOneBy({ id });
    if (!item) throw new NotFoundException();
    const subject = await this.subjects.findOneBy({ id: item.subjectId, teacherId: u.sub });
    if (!subject) throw new ForbiddenException('Not your subject');
    item.status = body?.status === 'approved' ? 'approved' : 'rejected';
    item.teacherComment = body?.teacherComment || '';
    return this.leaves.save(item);
  }
}

// ---------------- Attendance ----------------
@Controller('attendance')
export class AttendanceController {
  constructor(
    @InjectRepository(AttendanceRecord) private records: Repository<AttendanceRecord>,
    @InjectRepository(Enrollment) private enrollments: Repository<Enrollment>,
    @InjectRepository(Subject) private subjects: Repository<Subject>,
    @InjectRepository(User) private users: Repository<User>,
  ) {}

  @Roles('teacher', 'superadmin')
  @Get('sheet')
  async sheet(@CurrentUser() u: any, @Query('subjectId') subjectId: string, @Query('date') date: string) {
    const subject = await this.subjects.findOneBy({ id: +subjectId, teacherId: u.sub });
    if (!subject) throw new NotFoundException('Subject not found');
    const enr = await this.enrollments.findBy({ subjectId: +subjectId });
    const students = enr.length ? await this.users.findBy({ id: In(enr.map((e) => e.studentId)) }) : [];
    const existing = await this.records.findBy({ subjectId: +subjectId, date: date || new Date().toISOString().slice(0, 10) });
    return {
      students: students.map(safeUser),
      records: existing.map((r) => ({ studentId: r.studentId, status: r.status })),
    };
  }

  @Roles('teacher', 'superadmin')
  @Post()
  async save(@CurrentUser() u: any, @Body() body: any) {
    const { subjectId, date, records } = body || {};
    if (!subjectId || !date || !Array.isArray(records)) throw new BadRequestException('subjectId, date and records are required');
    const subject = await this.subjects.findOneBy({ id: +subjectId, teacherId: u.sub });
    if (!subject) throw new NotFoundException('Subject not found');
    await this.records.delete({ subjectId: +subjectId, date });
    await this.records.save(records.map((r: any) => this.records.create({
      subjectId: +subjectId, teacherId: u.sub, studentId: r.studentId, date, status: r.status || 'present',
    })));
    return { ok: true, saved: records.length };
  }

  @Roles('teacher', 'superadmin')
  @Get('stats')
  async stats(@CurrentUser() u: any, @Query('subjectId') subjectId: string) {
    const subject = await this.subjects.findOneBy({ id: +subjectId, teacherId: u.sub });
    if (!subject) throw new NotFoundException('Subject not found');
    const all = await this.records.findBy({ subjectId: +subjectId });
    const enr = await this.enrollments.findBy({ subjectId: +subjectId });
    const students = enr.length ? await this.users.findBy({ id: In(enr.map((e) => e.studentId)) }) : [];
    return students.map((s) => {
      const mine = all.filter((r) => r.studentId === s.id);
      const present = mine.filter((r) => r.status !== 'absent').length;
      return { student: safeUser(s), total: mine.length, present, pct: mine.length ? Math.round((present / mine.length) * 100) : null };
    });
  }

  @Get('my')
  async my(@CurrentUser() u: any) {
    const records = await this.records.find({ where: { studentId: u.sub }, order: { date: 'DESC' } });
    const subIds = [...new Set(records.map((r) => r.subjectId))];
    const subs = subIds.length ? await this.subjects.findBy({ id: In(subIds) }) : [];
    return { records, subjects: subs };
  }
}

// ---------------- Quizzes & grades ----------------
@Controller('quizzes')
export class QuizzesController {
  constructor(
    @InjectRepository(Quiz) private quizzes: Repository<Quiz>,
    @InjectRepository(QuizGrade) private grades: Repository<QuizGrade>,
    @InjectRepository(Enrollment) private enrollments: Repository<Enrollment>,
    @InjectRepository(Subject) private subjects: Repository<Subject>,
    @InjectRepository(User) private users: Repository<User>,
  ) {}

  @Get()
  async list(@CurrentUser() u: any) {
    if (u.role === 'teacher' || u.role === 'superadmin') {
      const items = await this.quizzes.find({ where: { teacherId: u.sub }, order: { date: 'DESC' } });
      const subs = await this.subjects.findBy({ teacherId: u.sub });
      return items.map((q) => ({ ...q, subject: subs.find((s) => s.id === q.subjectId) || null }));
    }
    const enr = await this.enrollments.findBy({ studentId: u.sub });
    if (!enr.length) return [];
    const items = await this.quizzes.find({ where: { subjectId: In(enr.map((e) => e.subjectId)) }, order: { date: 'DESC' } });
    if (!items.length) return [];
    const myGrades = await this.grades.findBy({ studentId: u.sub, quizId: In(items.map((q) => q.id)) });
    const subs = await this.subjects.findBy({ id: In(items.map((q) => q.subjectId)) });
    return items.map((q) => ({
      ...q,
      subject: subs.find((s) => s.id === q.subjectId) || null,
      grade: myGrades.find((g) => g.quizId === q.id) || null,
    }));
  }

  @Roles('teacher', 'superadmin')
  @Post()
  async create(@CurrentUser() u: any, @Body() body: any) {
    if (!body?.title || !body?.subjectId) throw new BadRequestException('title and subjectId are required');
    const subject = await this.subjects.findOneBy({ id: +body.subjectId, teacherId: u.sub });
    if (!subject) throw new NotFoundException('Subject not found');
    return this.quizzes.save(this.quizzes.create({
      subjectId: +body.subjectId, teacherId: u.sub, title: body.title,
      description: body.description || '', totalMarks: +body.totalMarks || 10,
      date: body.date ? new Date(body.date) : new Date(),
    }));
  }

  @Roles('teacher', 'superadmin')
  @Get(':id/grades')
  async gradeSheet(@CurrentUser() u: any, @Param('id', ParseIntPipe) id: number) {
    const quiz = await this.quizzes.findOneBy({ id, teacherId: u.sub });
    if (!quiz) throw new NotFoundException();
    const enr = await this.enrollments.findBy({ subjectId: quiz.subjectId });
    const students = enr.length ? await this.users.findBy({ id: In(enr.map((e) => e.studentId)) }) : [];
    const existing = await this.grades.findBy({ quizId: id });
    return {
      quiz,
      rows: students.map((s) => {
        const g = existing.find((x) => x.studentId === s.id);
        return { student: safeUser(s), marks: g?.marks ?? null, status: g?.status || 'pending' };
      }),
    };
  }

  @Roles('teacher', 'superadmin')
  @Post(':id/grades')
  async saveGrades(@CurrentUser() u: any, @Param('id', ParseIntPipe) id: number, @Body() body: any) {
    const quiz = await this.quizzes.findOneBy({ id, teacherId: u.sub });
    if (!quiz) throw new NotFoundException();
    if (!Array.isArray(body?.grades)) throw new BadRequestException('grades array required');
    await this.grades.delete({ quizId: id });
    await this.grades.save(body.grades.map((g: any) => this.grades.create({
      quizId: id, studentId: g.studentId,
      marks: g.status === 'graded' ? +g.marks : null,
      status: g.status || 'pending',
    })));
    return { ok: true };
  }

  @Roles('teacher', 'superadmin')
  @Delete(':id')
  async remove(@CurrentUser() u: any, @Param('id', ParseIntPipe) id: number) {
    await this.quizzes.delete({ id, teacherId: u.sub });
    await this.grades.delete({ quizId: id });
    return { ok: true };
  }
}

// ---------------- Retake requests ----------------
@Controller('retakes')
export class RetakesController {
  constructor(
    @InjectRepository(RetakeRequest) private retakes: Repository<RetakeRequest>,
    @InjectRepository(Quiz) private quizzes: Repository<Quiz>,
    @InjectRepository(QuizGrade) private grades: Repository<QuizGrade>,
    @InjectRepository(User) private users: Repository<User>,
  ) {}

  @Roles('student')
  @Post()
  @UseInterceptors(FileInterceptor('file', { storage, limits: { fileSize: 20 * 1024 * 1024 } }))
  async request(@CurrentUser() u: any, @Body() body: any, @UploadedFile() file?: Express.Multer.File) {
    if (!body?.quizId || !body?.reason) throw new BadRequestException('quizId and reason are required');
    const dup = await this.retakes.findOneBy({ quizId: +body.quizId, studentId: u.sub, status: 'pending' });
    if (dup) throw new BadRequestException('You already have a pending request for this quiz');
    return this.retakes.save(this.retakes.create({
      quizId: +body.quizId, studentId: u.sub, reason: body.reason,
      filename: file?.filename || null, originalName: file?.originalname || '',
    }));
  }

  @Get()
  async list(@CurrentUser() u: any) {
    let items: RetakeRequest[];
    if (u.role === 'teacher' || u.role === 'superadmin') {
      const qs = await this.quizzes.findBy({ teacherId: u.sub });
      items = qs.length
        ? await this.retakes.find({ where: { quizId: In(qs.map((q) => q.id)) }, order: { createdAt: 'DESC' } })
        : [];
    } else {
      items = await this.retakes.find({ where: { studentId: u.sub }, order: { createdAt: 'DESC' } });
    }
    if (!items.length) return [];
    const students = await this.users.findBy({ id: In(items.map((i) => i.studentId)) });
    const qs = await this.quizzes.findBy({ id: In(items.map((i) => i.quizId)) });
    return items.map((i) => ({
      ...i,
      student: safeUser(students.find((s) => s.id === i.studentId) || ({} as User)),
      quiz: qs.find((q) => q.id === i.quizId) || null,
    }));
  }

  @Roles('teacher', 'superadmin')
  @Patch(':id')
  async decide(@CurrentUser() u: any, @Param('id', ParseIntPipe) id: number, @Body() body: any) {
    const item = await this.retakes.findOneBy({ id });
    if (!item) throw new NotFoundException();
    const quiz = await this.quizzes.findOneBy({ id: item.quizId, teacherId: u.sub });
    if (!quiz) throw new ForbiddenException('Not your quiz');
    item.status = body?.status === 'approved' ? 'approved' : 'rejected';
    await this.retakes.save(item);
    if (item.status === 'approved') {
      // reopen the grade so the teacher can re-grade after the retake
      const g = await this.grades.findOneBy({ quizId: item.quizId, studentId: item.studentId });
      if (g) { g.status = 'pending'; g.marks = null; await this.grades.save(g); }
    }
    return item;
  }
}

// ---------------- Superadmin ----------------
@Controller('admin')
export class AdminController {
  constructor(
    @InjectRepository(User) private users: Repository<User>,
    @InjectRepository(Subject) private subjects: Repository<Subject>,
    @InjectRepository(Quiz) private quizzes: Repository<Quiz>,
    @InjectRepository(LeaveApplication) private leaves: Repository<LeaveApplication>,
    @InjectRepository(Enrollment) private enrollments: Repository<Enrollment>,
  ) {}

  @Roles('superadmin')
  @Post('users')
  async createUser(@Body() body: any) {
    const { name, email, password, role = 'student' } = body || {};
    if (!name || !email || !password) throw new BadRequestException('name, email and password are required');
    if (!['student', 'teacher', 'superadmin'].includes(role)) throw new BadRequestException('Invalid role');
    const dup = await this.users.findOneBy({ email: email.toLowerCase() });
    if (dup) throw new BadRequestException('Email already in use');
    const user = await this.users.save(this.users.create({
      email: email.toLowerCase(), name, role,
      passwordHash: await bcrypt.hash(password, 10),
    }));
    return safeUser(user);
  }

  @Roles('superadmin')
  @Get('users')
  async list() {
    const all = await this.users.find({ order: { createdAt: 'DESC' } });
    return all.map(safeUser);
  }

  @Roles('superadmin')
  @Patch('users/:id')
  async setRole(@Param('id', ParseIntPipe) id: number, @Body() body: any) {
    const user = await this.users.findOneBy({ id });
    if (!user) throw new NotFoundException();
    if (!['student', 'teacher', 'superadmin'].includes(body?.role)) throw new BadRequestException('Invalid role');
    user.role = body.role;
    await this.users.save(user);
    return safeUser(user);
  }

  @Roles('superadmin')
  @Delete('users/:id')
  async remove(@CurrentUser() u: any, @Param('id', ParseIntPipe) id: number) {
    if (id === u.sub) throw new BadRequestException('Cannot delete yourself');
    await this.users.delete({ id });
    return { ok: true };
  }

  @Roles('superadmin')
  @Get('stats')
  async stats() {
    const [total, students, teachers, subjects, quizzes, leaves, enrollments] = await Promise.all([
      this.users.count(),
      this.users.countBy({ role: 'student' }),
      this.users.countBy({ role: 'teacher' }),
      this.subjects.count(),
      this.quizzes.count(),
      this.leaves.count(),
      this.enrollments.count(),
    ]);
    return { total, students, teachers, subjects, quizzes, leaves, enrollments };
  }
}
