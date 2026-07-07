import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { TypeOrmModule } from '@nestjs/typeorm';
import 'dotenv/config';
import {
  User, Session, Subject, ScheduleSlot, Assignment, Exam, Note, FileItem,
  Enrollment, LeaveApplication, AttendanceRecord, Quiz, QuizGrade, RetakeRequest,
  QuizQuestion, QuizAttempt, ClassAssignment, AssignmentSubmission, TeacherChangeRequest,
} from './entities';
import { AuthController, AuthGuard } from './auth';
import {
  SubjectsController, ScheduleController, AssignmentsController,
  ExamsController, NotesController, FilesController, DashboardController,
} from './api';
import {
  TeacherController, MyController, LeavesController, AttendanceController,
  QuizzesController, RetakesController, AdminController,
} from './rbac';
import { OnlineController, ClassworkController, TeacherChangeController } from './extra';

const entities = [
  User, Session, Subject, ScheduleSlot, Assignment, Exam, Note, FileItem,
  Enrollment, LeaveApplication, AttendanceRecord, Quiz, QuizGrade, RetakeRequest,
  QuizQuestion, QuizAttempt, ClassAssignment, AssignmentSubmission, TeacherChangeRequest,
];

@Module({
  imports: [
    TypeOrmModule.forRoot({
      type: 'postgres',
      url: process.env.DATABASE_URL,
      ssl: { rejectUnauthorized: false },
      entities,
      synchronize: true,
    }),
    TypeOrmModule.forFeature(entities),
  ],
  controllers: [
    AuthController, SubjectsController, ScheduleController, AssignmentsController,
    ExamsController, NotesController, FilesController, DashboardController,
    TeacherController, MyController, LeavesController, AttendanceController,
    QuizzesController, RetakesController, AdminController,
    OnlineController, ClassworkController, TeacherChangeController,
  ],
  providers: [{ provide: APP_GUARD, useClass: AuthGuard }],
})
export class AppModule {}
