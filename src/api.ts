import {
  Body, Controller, Delete, Get, NotFoundException, Param, ParseIntPipe,
  Patch, Post, Query, UploadedFile, UseInterceptors, BadRequestException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, MoreThanOrEqual } from 'typeorm';
import { diskStorage } from 'multer';
import { extname } from 'path';
import * as fs from 'fs';
import { CurrentUser } from './auth';
import { Subject, ScheduleSlot, Assignment, Exam, Note, FileItem } from './entities';

const GRADE_POINTS: Record<string, number> = {
  'A+': 4.0, A: 4.0, 'A-': 3.7, 'B+': 3.3, B: 3.0, 'B-': 2.7,
  'C+': 2.3, C: 2.0, 'C-': 1.7, 'D+': 1.3, D: 1.0, F: 0.0,
};

// On Vercel the filesystem is read-only except /tmp (uploads there are ephemeral)
export const UPLOAD_DIR = process.env.VERCEL ? '/tmp/uploads' : 'uploads';
const storage = diskStorage({
  destination: (_req, _file, cb) => {
    if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });
    cb(null, UPLOAD_DIR);
  },
  filename: (_req, file, cb) =>
    cb(null, `${Date.now()}-${Math.round(Math.random() * 1e6)}${extname(file.originalname)}`),
});

// ---------------- Subjects ----------------
@Controller('subjects')
export class SubjectsController {
  constructor(@InjectRepository(Subject) private repo: Repository<Subject>) {}

  @Get()
  list(@CurrentUser() u: any) {
    return this.repo.find({ where: { userId: u.sub }, order: { name: 'ASC' } });
  }

  @Get('gpa')
  async gpa(@CurrentUser() u: any) {
    const subjects = await this.repo.findBy({ userId: u.sub });
    let points = 0, credits = 0;
    for (const s of subjects) {
      const gp = GRADE_POINTS[(s.grade || '').toUpperCase()];
      if (gp !== undefined && s.credits > 0) { points += gp * s.credits; credits += s.credits; }
    }
    return { gpa: credits ? +(points / credits).toFixed(2) : null, gradedCredits: credits, totalSubjects: subjects.length };
  }

  @Post()
  create(@CurrentUser() u: any, @Body() body: any) {
    if (!body?.name) throw new BadRequestException('name is required');
    return this.repo.save(this.repo.create({ ...body, id: undefined, userId: u.sub }));
  }

  @Patch(':id')
  async update(@CurrentUser() u: any, @Param('id', ParseIntPipe) id: number, @Body() body: any) {
    const item = await this.repo.findOneBy({ id, userId: u.sub });
    if (!item) throw new NotFoundException();
    Object.assign(item, body, { id, userId: u.sub });
    return this.repo.save(item);
  }

  @Delete(':id')
  async remove(@CurrentUser() u: any, @Param('id', ParseIntPipe) id: number) {
    await this.repo.delete({ id, userId: u.sub });
    return { ok: true };
  }
}

// ---------------- Schedule ----------------
@Controller('schedule')
export class ScheduleController {
  constructor(
    @InjectRepository(ScheduleSlot) private repo: Repository<ScheduleSlot>,
    @InjectRepository(FileItem) private files: Repository<FileItem>,
  ) {}

  @Get()
  list(@CurrentUser() u: any) {
    return this.repo.find({ where: { userId: u.sub }, order: { day: 'ASC', startTime: 'ASC' } });
  }

  @Get('uploads')
  uploads(@CurrentUser() u: any) {
    return this.files.find({ where: { userId: u.sub, kind: 'timetable' }, order: { uploadedAt: 'DESC' } });
  }

  @Post()
  create(@CurrentUser() u: any, @Body() body: any) {
    if (body?.day === undefined || !body?.startTime || !body?.endTime) {
      throw new BadRequestException('day, startTime and endTime are required');
    }
    return this.repo.save(this.repo.create({ ...body, id: undefined, userId: u.sub }));
  }

  @Patch(':id')
  async update(@CurrentUser() u: any, @Param('id', ParseIntPipe) id: number, @Body() body: any) {
    const item = await this.repo.findOneBy({ id, userId: u.sub });
    if (!item) throw new NotFoundException();
    Object.assign(item, body, { id, userId: u.sub });
    return this.repo.save(item);
  }

  @Delete(':id')
  async remove(@CurrentUser() u: any, @Param('id', ParseIntPipe) id: number) {
    await this.repo.delete({ id, userId: u.sub });
    return { ok: true };
  }

  // Upload the original timetable (image/pdf) kept as a reference
  @Post('upload')
  @UseInterceptors(FileInterceptor('file', { storage, limits: { fileSize: 20 * 1024 * 1024 } }))
  async upload(@CurrentUser() u: any, @UploadedFile() file: Express.Multer.File) {
    if (!file) throw new BadRequestException('file is required');
    return this.files.save(this.files.create({
      userId: u.sub, filename: file.filename, originalName: file.originalname,
      mimetype: file.mimetype, size: file.size, kind: 'timetable',
    }));
  }
}

// ---------------- Assignments ----------------
@Controller('assignments')
export class AssignmentsController {
  constructor(@InjectRepository(Assignment) private repo: Repository<Assignment>) {}

  @Get()
  list(@CurrentUser() u: any, @Query('status') status?: string) {
    const where: any = { userId: u.sub };
    if (status) where.status = status;
    return this.repo.find({ where, order: { dueDate: 'ASC' } });
  }

  @Post()
  create(@CurrentUser() u: any, @Body() body: any) {
    if (!body?.title) throw new BadRequestException('title is required');
    return this.repo.save(this.repo.create({ ...body, id: undefined, userId: u.sub }));
  }

  @Patch(':id')
  async update(@CurrentUser() u: any, @Param('id', ParseIntPipe) id: number, @Body() body: any) {
    const item = await this.repo.findOneBy({ id, userId: u.sub });
    if (!item) throw new NotFoundException();
    Object.assign(item, body, { id, userId: u.sub });
    return this.repo.save(item);
  }

  @Delete(':id')
  async remove(@CurrentUser() u: any, @Param('id', ParseIntPipe) id: number) {
    await this.repo.delete({ id, userId: u.sub });
    return { ok: true };
  }
}

// ---------------- Exams ----------------
@Controller('exams')
export class ExamsController {
  constructor(@InjectRepository(Exam) private repo: Repository<Exam>) {}

  @Get()
  list(@CurrentUser() u: any) {
    return this.repo.find({ where: { userId: u.sub }, order: { date: 'ASC' } });
  }

  @Post()
  create(@CurrentUser() u: any, @Body() body: any) {
    if (!body?.title) throw new BadRequestException('title is required');
    return this.repo.save(this.repo.create({ ...body, id: undefined, userId: u.sub }));
  }

  @Patch(':id')
  async update(@CurrentUser() u: any, @Param('id', ParseIntPipe) id: number, @Body() body: any) {
    const item = await this.repo.findOneBy({ id, userId: u.sub });
    if (!item) throw new NotFoundException();
    Object.assign(item, body, { id, userId: u.sub });
    return this.repo.save(item);
  }

  @Delete(':id')
  async remove(@CurrentUser() u: any, @Param('id', ParseIntPipe) id: number) {
    await this.repo.delete({ id, userId: u.sub });
    return { ok: true };
  }
}

// ---------------- Notes ----------------
@Controller('notes')
export class NotesController {
  constructor(@InjectRepository(Note) private repo: Repository<Note>) {}

  @Get()
  list(@CurrentUser() u: any) {
    return this.repo.find({ where: { userId: u.sub }, order: { pinned: 'DESC', updatedAt: 'DESC' } });
  }

  @Post()
  create(@CurrentUser() u: any, @Body() body: any) {
    if (!body?.title) throw new BadRequestException('title is required');
    return this.repo.save(this.repo.create({ ...body, id: undefined, userId: u.sub }));
  }

  @Patch(':id')
  async update(@CurrentUser() u: any, @Param('id', ParseIntPipe) id: number, @Body() body: any) {
    const item = await this.repo.findOneBy({ id, userId: u.sub });
    if (!item) throw new NotFoundException();
    Object.assign(item, body, { id, userId: u.sub });
    return this.repo.save(item);
  }

  @Delete(':id')
  async remove(@CurrentUser() u: any, @Param('id', ParseIntPipe) id: number) {
    await this.repo.delete({ id, userId: u.sub });
    return { ok: true };
  }
}

// ---------------- Files / Slides ----------------
@Controller('files')
export class FilesController {
  constructor(@InjectRepository(FileItem) private repo: Repository<FileItem>) {}

  @Get()
  list(@CurrentUser() u: any, @Query('subjectId') subjectId?: string) {
    const where: any = { userId: u.sub, kind: 'slide' };
    if (subjectId) where.subjectId = +subjectId;
    return this.repo.find({ where, order: { uploadedAt: 'DESC' } });
  }

  @Post('upload')
  @UseInterceptors(FileInterceptor('file', { storage, limits: { fileSize: 50 * 1024 * 1024 } }))
  async upload(
    @CurrentUser() u: any,
    @UploadedFile() file: Express.Multer.File,
    @Body('subjectId') subjectId?: string,
  ) {
    if (!file) throw new BadRequestException('file is required');
    return this.repo.save(this.repo.create({
      userId: u.sub, filename: file.filename, originalName: file.originalname,
      mimetype: file.mimetype, size: file.size,
      subjectId: subjectId ? +subjectId : null, kind: 'slide',
    }));
  }

  @Delete(':id')
  async remove(@CurrentUser() u: any, @Param('id', ParseIntPipe) id: number) {
    const item = await this.repo.findOneBy({ id, userId: u.sub });
    if (item) {
      try { fs.unlinkSync(`${UPLOAD_DIR}/${item.filename}`); } catch {}
      await this.repo.delete({ id });
    }
    return { ok: true };
  }
}

// ---------------- Dashboard ----------------
@Controller('dashboard')
export class DashboardController {
  constructor(
    @InjectRepository(Subject) private subjects: Repository<Subject>,
    @InjectRepository(ScheduleSlot) private slots: Repository<ScheduleSlot>,
    @InjectRepository(Assignment) private assignments: Repository<Assignment>,
    @InjectRepository(Exam) private exams: Repository<Exam>,
    @InjectRepository(Note) private notes: Repository<Note>,
    @InjectRepository(FileItem) private files: Repository<FileItem>,
  ) {}

  @Get()
  async summary(@CurrentUser() u: any) {
    const userId = u.sub;
    const now = new Date();
    const jsDay = now.getDay(); // 0=Sun
    const today = jsDay === 0 ? 6 : jsDay - 1; // our 0=Mon convention

    const [allSubjects, allSlots, allAssignments, upcomingExams, notesCount, filesCount] =
      await Promise.all([
        this.subjects.findBy({ userId }),
        this.slots.find({ where: { userId }, order: { day: 'ASC', startTime: 'ASC' } }),
        this.assignments.find({ where: { userId }, order: { dueDate: 'ASC' } }),
        this.exams.find({ where: { userId, date: MoreThanOrEqual(now) }, order: { date: 'ASC' }, take: 5 }),
        this.notes.countBy({ userId }),
        this.files.countBy({ userId, kind: 'slide' }),
      ]);

    const todayClasses = allSlots.filter((s) => s.day === today);
    const pending = allAssignments.filter((a) => a.status !== 'done');
    const week = new Date(now.getTime() + 7 * 86400000);
    const dueSoon = pending.filter((a) => a.dueDate && new Date(a.dueDate) <= week);
    const overdue = pending.filter((a) => a.dueDate && new Date(a.dueDate) < now);

    let points = 0, credits = 0;
    for (const s of allSubjects) {
      const gp = GRADE_POINTS[(s.grade || '').toUpperCase()];
      if (gp !== undefined && s.credits > 0) { points += gp * s.credits; credits += s.credits; }
    }

    return {
      today,
      todayClasses,
      upcomingAssignments: dueSoon.slice(0, 8),
      overdueCount: overdue.length,
      upcomingExams,
      stats: {
        subjects: allSubjects.length,
        classesPerWeek: allSlots.length,
        pendingAssignments: pending.length,
        completedAssignments: allAssignments.length - pending.length,
        notes: notesCount,
        slides: filesCount,
        gpa: credits ? +(points / credits).toFixed(2) : null,
      },
    };
  }
}
