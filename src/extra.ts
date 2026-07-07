import {
  Body, Controller, Delete, Get, Param, ParseIntPipe, Patch, Post,
  UploadedFile, UseInterceptors, BadRequestException, NotFoundException, ForbiddenException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In } from 'typeorm';
import { diskStorage } from 'multer';
import { extname } from 'path';
import * as fs from 'fs';
import { CurrentUser, Roles } from './auth';
import {
  User, Subject, Enrollment, Quiz, QuizQuestion, QuizAttempt, QuizGrade,
  ClassAssignment, AssignmentSubmission, TeacherChangeRequest,
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

const shuffle = <T>(arr: T[]) => {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};

const safeUser = (u: User) => ({ id: u.id, name: u.name, email: u.email });
const normalize = (s: string) => (s || '').trim().toLowerCase().replace(/\s+/g, ' ');

// ================= Online quizzes & exams =================
@Controller('online')
export class OnlineController {
  constructor(
    @InjectRepository(Quiz) private quizzes: Repository<Quiz>,
    @InjectRepository(QuizQuestion) private questions: Repository<QuizQuestion>,
    @InjectRepository(QuizAttempt) private attempts: Repository<QuizAttempt>,
    @InjectRepository(QuizGrade) private grades: Repository<QuizGrade>,
    @InjectRepository(Enrollment) private enrollments: Repository<Enrollment>,
    @InjectRepository(Subject) private subjects: Repository<Subject>,
    @InjectRepository(User) private users: Repository<User>,
  ) {}

  // ---- teacher: create online quiz or exam with structured MCQs ----
  @Roles('teacher', 'superadmin')
  @Post()
  async create(@CurrentUser() u: any, @Body() body: any) {
    const { subjectId, title, kind = 'online', questions, description = '' } = body || {};
    if (!subjectId || !title) throw new BadRequestException('subjectId and title are required');
    if (!Array.isArray(questions) || questions.length === 0) throw new BadRequestException('At least one question is required');
    for (const q of questions) {
      if (!q.text || !Array.isArray(q.options) || q.options.length < 2 || q.correct === undefined) {
        throw new BadRequestException('Each question needs text, options and the correct option');
      }
    }
    const subject = await this.subjects.findOneBy({ id: +subjectId, teacherId: u.sub });
    if (!subject) throw new NotFoundException('Subject not found');

    const perStudent = Math.min(+body.questionsPerStudent || questions.length, questions.length);
    const quiz = await this.quizzes.save(this.quizzes.create({
      subjectId: +subjectId, teacherId: u.sub, title, description,
      kind: kind === 'exam' ? 'exam' : 'online',
      totalMarks: perStudent,
      questionsPerStudent: perStudent,
      secondsPerQuestion: +body.secondsPerQuestion || 60,
      // teachers schedule online quizzes; exam windows are set by the superadmin
      startAt: kind === 'exam' ? null : (body.startAt ? new Date(body.startAt) : null),
      endAt: kind === 'exam' ? null : (body.endAt ? new Date(body.endAt) : null),
      date: body.startAt ? new Date(body.startAt) : new Date(),
    }));
    await this.questions.save(questions.map((q: any) => this.questions.create({
      quizId: quiz.id, text: q.text, options: q.options.map(String), correct: +q.correct,
    })));
    return quiz;
  }

  // ---- teacher: attach reference PDF (visible only to the teacher) ----
  @Roles('teacher', 'superadmin')
  @Post(':id/reference')
  @UseInterceptors(FileInterceptor('file', { storage, limits: { fileSize: 30 * 1024 * 1024 } }))
  async attachRef(@CurrentUser() u: any, @Param('id', ParseIntPipe) id: number, @UploadedFile() file: Express.Multer.File) {
    if (!file) throw new BadRequestException('file is required');
    const quiz = await this.quizzes.findOneBy({ id, teacherId: u.sub });
    if (!quiz) throw new NotFoundException();
    quiz.refFilename = file.filename;
    quiz.refOriginalName = file.originalname;
    return this.quizzes.save(quiz);
  }

  @Roles('teacher', 'superadmin')
  @Get('mine')
  async mine(@CurrentUser() u: any) {
    const items = await this.quizzes.find({ where: { teacherId: u.sub, kind: In(['online', 'exam']) }, order: { createdAt: 'DESC' } });
    const subs = await this.subjects.findBy({ teacherId: u.sub });
    const result = [];
    for (const q of items) {
      const questionCount = await this.questions.countBy({ quizId: q.id });
      const attemptCount = await this.attempts.countBy({ quizId: q.id, status: 'finished' });
      result.push({ ...q, subject: subs.find((s) => s.id === q.subjectId) || null, questionCount, attemptCount });
    }
    return result;
  }

  @Roles('teacher', 'superadmin')
  @Get(':id/results')
  async results(@CurrentUser() u: any, @Param('id', ParseIntPipe) id: number) {
    const quiz = await this.quizzes.findOneBy({ id });
    if (!quiz || (quiz.teacherId !== u.sub && u.role !== 'superadmin')) throw new NotFoundException();
    const atts = await this.attempts.find({ where: { quizId: id }, order: { score: 'DESC' } });
    if (!atts.length) return { quiz, results: [] };
    const students = await this.users.findBy({ id: In(atts.map((a) => a.studentId)) });
    return {
      quiz,
      results: atts.map((a) => ({
        student: safeUser(students.find((s) => s.id === a.studentId) || ({} as User)),
        score: a.score, total: a.questionIds.length, status: a.status,
        startedAt: a.startedAt, finishedAt: a.finishedAt,
      })),
    };
  }

  // ---- superadmin: schedule exams ----
  @Roles('superadmin')
  @Get('exams')
  async allExams() {
    const items = await this.quizzes.find({ where: { kind: 'exam' }, order: { createdAt: 'DESC' } });
    if (!items.length) return [];
    const subs = await this.subjects.findBy({ id: In(items.map((q) => q.subjectId)) });
    const teachers = await this.users.findBy({ id: In(items.map((q) => q.teacherId)) });
    const result = [];
    for (const q of items) {
      const questionCount = await this.questions.countBy({ quizId: q.id });
      result.push({
        ...q, questionCount,
        subject: subs.find((s) => s.id === q.subjectId) || null,
        teacher: safeUser(teachers.find((t) => t.id === q.teacherId) || ({} as User)),
      });
    }
    return result;
  }

  @Roles('superadmin')
  @Patch(':id/schedule')
  async schedule(@Param('id', ParseIntPipe) id: number, @Body() body: any) {
    const quiz = await this.quizzes.findOneBy({ id });
    if (!quiz) throw new NotFoundException();
    if (!body?.startAt) throw new BadRequestException('startAt is required');
    const questionCount = await this.questions.countBy({ quizId: id });
    const perStudent = quiz.questionsPerStudent || questionCount;
    quiz.startAt = new Date(body.startAt);
    // window = exactly 1 minute per question unless endAt given
    quiz.endAt = body.endAt ? new Date(body.endAt)
      : new Date(new Date(body.startAt).getTime() + perStudent * quiz.secondsPerQuestion * 1000 + 10 * 60000);
    quiz.date = quiz.startAt;
    return this.quizzes.save(quiz);
  }

  // ---- student: list available online quizzes/exams ----
  @Get('available')
  async available(@CurrentUser() u: any) {
    const enr = await this.enrollments.findBy({ studentId: u.sub });
    if (!enr.length) return [];
    const items = await this.quizzes.find({
      where: { subjectId: In(enr.map((e) => e.subjectId)), kind: In(['online', 'exam']) },
      order: { startAt: 'ASC' },
    });
    if (!items.length) return [];
    const subs = await this.subjects.findBy({ id: In(items.map((q) => q.subjectId)) });
    const myAttempts = await this.attempts.findBy({ studentId: u.sub, quizId: In(items.map((q) => q.id)) });
    return items.map((q) => {
      const { refFilename, refOriginalName, ...pub } = q as any;
      return {
        ...pub,
        subject: subs.find((s) => s.id === q.subjectId) || null,
        attempt: myAttempts.find((a) => a.quizId === q.id) || null,
      };
    });
  }

  // ---- student: start (or resume) an attempt ----
  @Post(':id/start')
  async start(@CurrentUser() u: any, @Param('id', ParseIntPipe) id: number) {
    const quiz = await this.quizzes.findOneBy({ id });
    if (!quiz || quiz.kind === 'manual') throw new NotFoundException();
    const enrolled = await this.enrollments.findOneBy({ subjectId: quiz.subjectId, studentId: u.sub });
    if (!enrolled) throw new ForbiddenException('You are not enrolled in this class');
    const now = new Date();
    if (!quiz.startAt) throw new BadRequestException('This exam has not been scheduled yet');
    if (now < new Date(quiz.startAt)) throw new BadRequestException('This quiz has not started yet');
    if (quiz.endAt && now > new Date(quiz.endAt)) throw new BadRequestException('This quiz window has ended');

    let attempt = await this.attempts.findOneBy({ quizId: id, studentId: u.sub });
    if (attempt?.status === 'finished') throw new BadRequestException('You have already completed this quiz');
    if (!attempt) {
      const pool = await this.questions.findBy({ quizId: id });
      if (!pool.length) throw new BadRequestException('No questions in this quiz yet');
      const count = Math.min(quiz.questionsPerStudent || pool.length, pool.length);
      // every student gets their own randomized set + order
      const picked = shuffle(pool).slice(0, count);
      attempt = await this.attempts.save(this.attempts.create({
        quizId: id, studentId: u.sub, questionIds: picked.map((q) => q.id), answers: {},
      }));
    }
    const qs = await this.questions.findBy({ id: In(attempt.questionIds) });
    const ordered = attempt.questionIds.map((qid) => qs.find((q) => q.id === qid)).filter(Boolean);
    return {
      attemptId: attempt.id,
      secondsPerQuestion: quiz.secondsPerQuestion,
      title: quiz.title,
      answered: attempt.answers,
      questions: ordered.map((q) => ({ id: q.id, text: q.text, options: q.options })), // no correct answer leaked
    };
  }

  @Post('attempt/:id/answer')
  async answer(@CurrentUser() u: any, @Param('id', ParseIntPipe) id: number, @Body() body: any) {
    const attempt = await this.attempts.findOneBy({ id, studentId: u.sub });
    if (!attempt) throw new NotFoundException();
    if (attempt.status === 'finished') throw new BadRequestException('Attempt already finished');
    const qid = +body?.questionId;
    if (!attempt.questionIds.includes(qid)) throw new BadRequestException('Question not in your set');
    attempt.answers = { ...attempt.answers, [qid]: +body.answer };
    await this.attempts.save(attempt);
    return { ok: true };
  }

  @Post('attempt/:id/finish')
  async finish(@CurrentUser() u: any, @Param('id', ParseIntPipe) id: number) {
    const attempt = await this.attempts.findOneBy({ id, studentId: u.sub });
    if (!attempt) throw new NotFoundException();
    if (attempt.status === 'finished') return { score: attempt.score, total: attempt.questionIds.length };
    const qs = await this.questions.findBy({ id: In(attempt.questionIds) });
    let score = 0;
    for (const q of qs) if (attempt.answers[q.id] === q.correct) score++;
    attempt.score = score;
    attempt.status = 'finished';
    attempt.finishedAt = new Date();
    await this.attempts.save(attempt);
    // sync into the gradebook
    let grade = await this.grades.findOneBy({ quizId: attempt.quizId, studentId: u.sub });
    if (!grade) grade = this.grades.create({ quizId: attempt.quizId, studentId: u.sub });
    grade.marks = score;
    grade.status = 'graded';
    await this.grades.save(grade);
    return { score, total: attempt.questionIds.length };
  }
}

// ================= Digital classwork (auto-graded against answer key) =================
@Controller('classwork')
export class ClassworkController {
  constructor(
    @InjectRepository(ClassAssignment) private assignments: Repository<ClassAssignment>,
    @InjectRepository(AssignmentSubmission) private submissions: Repository<AssignmentSubmission>,
    @InjectRepository(Enrollment) private enrollments: Repository<Enrollment>,
    @InjectRepository(Subject) private subjects: Repository<Subject>,
    @InjectRepository(User) private users: Repository<User>,
  ) {}

  @Roles('teacher', 'superadmin')
  @Post()
  async create(@CurrentUser() u: any, @Body() body: any) {
    const { subjectId, title, description = '', dueDate, questions } = body || {};
    if (!subjectId || !title) throw new BadRequestException('subjectId and title are required');
    if (!Array.isArray(questions) || !questions.length) throw new BadRequestException('Add at least one question with its correct answer');
    const subject = await this.subjects.findOneBy({ id: +subjectId, teacherId: u.sub });
    if (!subject) throw new NotFoundException('Subject not found');
    return this.assignments.save(this.assignments.create({
      subjectId: +subjectId, teacherId: u.sub, title, description,
      dueDate: dueDate ? new Date(dueDate) : null,
      questions: questions.map((q: any) => ({ q: q.q, answer: q.answer, marks: +q.marks || 1 })),
    }));
  }

  @Get()
  async list(@CurrentUser() u: any) {
    if (u.role === 'teacher' || u.role === 'superadmin') {
      const items = await this.assignments.find({ where: { teacherId: u.sub }, order: { createdAt: 'DESC' } });
      const subs = await this.subjects.findBy({ teacherId: u.sub });
      const result = [];
      for (const a of items) {
        const count = await this.submissions.countBy({ assignmentId: a.id });
        result.push({ ...a, subject: subs.find((s) => s.id === a.subjectId) || null, submissionCount: count });
      }
      return result;
    }
    const enr = await this.enrollments.findBy({ studentId: u.sub });
    if (!enr.length) return [];
    const items = await this.assignments.find({ where: { subjectId: In(enr.map((e) => e.subjectId)) }, order: { createdAt: 'DESC' } });
    if (!items.length) return [];
    const subs = await this.subjects.findBy({ id: In(items.map((a) => a.subjectId)) });
    const mySubs = await this.submissions.findBy({ studentId: u.sub, assignmentId: In(items.map((a) => a.id)) });
    return items.map((a) => ({
      ...a,
      questions: a.questions.map((q) => ({ q: q.q, marks: q.marks })), // hide answer key from students
      subject: subs.find((s) => s.id === a.subjectId) || null,
      submission: mySubs.find((s) => s.assignmentId === a.id) || null,
    }));
  }

  @Post(':id/submit')
  @UseInterceptors(FileInterceptor('file', { storage, limits: { fileSize: 30 * 1024 * 1024 } }))
  async submit(@CurrentUser() u: any, @Param('id', ParseIntPipe) id: number, @Body() body: any, @UploadedFile() file?: Express.Multer.File) {
    const assignment = await this.assignments.findOneBy({ id });
    if (!assignment) throw new NotFoundException();
    const enrolled = await this.enrollments.findOneBy({ subjectId: assignment.subjectId, studentId: u.sub });
    if (!enrolled) throw new ForbiddenException('You are not enrolled in this class');
    const dup = await this.submissions.findOneBy({ assignmentId: id, studentId: u.sub });
    if (dup) throw new BadRequestException('You already submitted this assignment');
    let answers: string[] = [];
    try { answers = JSON.parse(body?.answers || '[]'); } catch { throw new BadRequestException('Invalid answers'); }
    // auto-grade against the teacher's answer key
    let score = 0, maxScore = 0;
    assignment.questions.forEach((q, i) => {
      maxScore += q.marks;
      if (normalize(answers[i]) && normalize(answers[i]) === normalize(q.answer)) score += q.marks;
    });
    return this.submissions.save(this.submissions.create({
      assignmentId: id, studentId: u.sub, answers, score, maxScore,
      filename: file?.filename || null, originalName: file?.originalname || '',
    }));
  }

  @Roles('teacher', 'superadmin')
  @Get(':id/submissions')
  async subsFor(@CurrentUser() u: any, @Param('id', ParseIntPipe) id: number) {
    const assignment = await this.assignments.findOneBy({ id, teacherId: u.sub });
    if (!assignment) throw new NotFoundException();
    const subs = await this.submissions.find({ where: { assignmentId: id }, order: { score: 'DESC' } });
    const students = subs.length ? await this.users.findBy({ id: In(subs.map((s) => s.studentId)) }) : [];
    return {
      assignment,
      submissions: subs.map((s) => ({ ...s, student: safeUser(students.find((x) => x.id === s.studentId) || ({} as User)) })),
    };
  }

  @Roles('teacher', 'superadmin')
  @Patch('submissions/:id')
  async override(@CurrentUser() u: any, @Param('id', ParseIntPipe) id: number, @Body() body: any) {
    const sub = await this.submissions.findOneBy({ id });
    if (!sub) throw new NotFoundException();
    const assignment = await this.assignments.findOneBy({ id: sub.assignmentId, teacherId: u.sub });
    if (!assignment) throw new ForbiddenException();
    sub.score = +body?.score || 0;
    sub.status = 'overridden';
    return this.submissions.save(sub);
  }

  @Roles('teacher', 'superadmin')
  @Delete(':id')
  async remove(@CurrentUser() u: any, @Param('id', ParseIntPipe) id: number) {
    await this.assignments.delete({ id, teacherId: u.sub });
    await this.submissions.delete({ assignmentId: id });
    return { ok: true };
  }
}

// ================= Teacher-change requests (student -> superadmin) =================
@Controller('teacher-change')
export class TeacherChangeController {
  constructor(
    @InjectRepository(TeacherChangeRequest) private requests: Repository<TeacherChangeRequest>,
    @InjectRepository(Subject) private subjects: Repository<Subject>,
    @InjectRepository(User) private users: Repository<User>,
  ) {}

  @Roles('student')
  @Post()
  @UseInterceptors(FileInterceptor('file', { storage, limits: { fileSize: 20 * 1024 * 1024 } }))
  async create(@CurrentUser() u: any, @Body() body: any, @UploadedFile() file?: Express.Multer.File) {
    if (!body?.reason) throw new BadRequestException('A clear reason is required');
    return this.requests.save(this.requests.create({
      studentId: u.sub, subjectId: body.subjectId ? +body.subjectId : null,
      reason: body.reason, desiredTeacher: body.desiredTeacher || '',
      filename: file?.filename || null, originalName: file?.originalname || '',
    }));
  }

  @Get()
  async list(@CurrentUser() u: any) {
    const items = u.role === 'superadmin'
      ? await this.requests.find({ order: { createdAt: 'DESC' } })
      : await this.requests.find({ where: { studentId: u.sub }, order: { createdAt: 'DESC' } });
    if (!items.length) return [];
    const students = await this.users.findBy({ id: In(items.map((i) => i.studentId)) });
    const subIds = items.map((i) => i.subjectId).filter(Boolean) as number[];
    const subs = subIds.length ? await this.subjects.findBy({ id: In(subIds) }) : [];
    return items.map((i) => ({
      ...i,
      student: safeUser(students.find((s) => s.id === i.studentId) || ({} as User)),
      subject: subs.find((s) => s.id === i.subjectId) || null,
    }));
  }

  @Roles('superadmin')
  @Patch(':id')
  async decide(@Param('id', ParseIntPipe) id: number, @Body() body: any) {
    const item = await this.requests.findOneBy({ id });
    if (!item) throw new NotFoundException();
    item.status = body?.status === 'approved' ? 'approved' : 'rejected';
    item.adminComment = body?.adminComment || '';
    return this.requests.save(item);
  }
}
