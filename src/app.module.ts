import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { TypeOrmModule } from '@nestjs/typeorm';
import { JwtModule } from '@nestjs/jwt';
import 'dotenv/config';
import { User, Subject, ScheduleSlot, Assignment, Exam, Note, FileItem } from './entities';
import { AuthController, AuthGuard } from './auth';
import {
  SubjectsController, ScheduleController, AssignmentsController,
  ExamsController, NotesController, FilesController, DashboardController,
} from './api';

const entities = [User, Subject, ScheduleSlot, Assignment, Exam, Note, FileItem];

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
    JwtModule.register({
      global: true,
      secret: process.env.JWT_SECRET || 'studyflow-secret',
      signOptions: { expiresIn: '7d' },
    }),
  ],
  controllers: [
    AuthController, SubjectsController, ScheduleController, AssignmentsController,
    ExamsController, NotesController, FilesController, DashboardController,
  ],
  providers: [{ provide: APP_GUARD, useClass: AuthGuard }],
})
export class AppModule {}
