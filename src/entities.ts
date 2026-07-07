import {
  Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, Index,
} from 'typeorm';

@Entity('users')
export class User {
  @PrimaryGeneratedColumn() id: number;
  @Column({ unique: true }) email: string;
  @Column() passwordHash: string;
  @Column() name: string;
  @Column({ default: '' }) university: string;
  @Column({ default: '' }) major: string;
  @CreateDateColumn() createdAt: Date;
}

@Entity('subjects')
export class Subject {
  @PrimaryGeneratedColumn() id: number;
  @Index() @Column() userId: number;
  @Column() name: string;
  @Column({ default: '' }) code: string;
  @Column({ default: '#6366f1' }) color: string;
  @Column({ default: '' }) teacher: string;
  @Column({ default: '' }) room: string;
  @Column({ type: 'int', default: 3 }) credits: number;
  @Column({ default: '' }) grade: string; // A, A-, B+ ... for GPA calc
  @CreateDateColumn() createdAt: Date;
}

@Entity('schedule_slots')
export class ScheduleSlot {
  @PrimaryGeneratedColumn() id: number;
  @Index() @Column() userId: number;
  @Column({ type: 'int' }) day: number; // 0=Mon ... 6=Sun
  @Column() startTime: string; // "09:00"
  @Column() endTime: string;   // "10:30"
  @Column({ nullable: true }) subjectId: number;
  @Column({ default: '' }) title: string; // used if no subject linked
  @Column({ default: '' }) room: string;
  @Column({ default: 'lecture' }) type: string; // lecture | lab | tutorial | other
}

@Entity('assignments')
export class Assignment {
  @PrimaryGeneratedColumn() id: number;
  @Index() @Column() userId: number;
  @Column() title: string;
  @Column({ default: '' }) description: string;
  @Column({ nullable: true }) subjectId: number;
  @Column({ type: 'timestamptz', nullable: true }) dueDate: Date;
  @Column({ default: 'medium' }) priority: string; // low | medium | high
  @Column({ default: 'todo' }) status: string; // todo | in_progress | done
  @CreateDateColumn() createdAt: Date;
}

@Entity('exams')
export class Exam {
  @PrimaryGeneratedColumn() id: number;
  @Index() @Column() userId: number;
  @Column() title: string;
  @Column({ nullable: true }) subjectId: number;
  @Column({ type: 'timestamptz', nullable: true }) date: Date;
  @Column({ default: '' }) location: string;
  @Column({ default: '' }) notes: string;
}

@Entity('notes')
export class Note {
  @PrimaryGeneratedColumn() id: number;
  @Index() @Column() userId: number;
  @Column() title: string;
  @Column({ type: 'text', default: '' }) content: string;
  @Column({ nullable: true }) subjectId: number;
  @Column({ default: false }) pinned: boolean;
  @UpdateDateColumn() updatedAt: Date;
}

@Entity('files')
export class FileItem {
  @PrimaryGeneratedColumn() id: number;
  @Index() @Column() userId: number;
  @Column() filename: string;     // stored name on disk
  @Column() originalName: string;
  @Column({ default: '' }) mimetype: string;
  @Column({ type: 'int', default: 0 }) size: number;
  @Column({ nullable: true }) subjectId: number;
  @Column({ default: 'slide' }) kind: string; // slide | timetable
  @CreateDateColumn() uploadedAt: Date;
}
