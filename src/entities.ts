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
  @Column({ default: 'student' }) role: string; // student | teacher | superadmin
  @CreateDateColumn() createdAt: Date;
}

@Entity('sessions')
export class Session {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Index() @Column() userId: number;
  @Column({ type: 'timestamptz' }) expiresAt: Date;
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
  @Column({ nullable: true }) teacherId: number; // set when owned by a teacher account
  @Column({ default: '' }) section: string; // e.g. CS-3A
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

@Entity('enrollments')
export class Enrollment {
  @PrimaryGeneratedColumn() id: number;
  @Index() @Column() subjectId: number; // teacher-owned subject
  @Index() @Column() studentId: number;
  @CreateDateColumn() createdAt: Date;
}

@Entity('leave_applications')
export class LeaveApplication {
  @PrimaryGeneratedColumn() id: number;
  @Index() @Column() studentId: number;
  @Index() @Column() subjectId: number;
  @Column({ type: 'text' }) reason: string;
  @Column({ default: '' }) fromDate: string;
  @Column({ default: '' }) toDate: string;
  @Column({ nullable: true }) filename: string;
  @Column({ default: '' }) originalName: string;
  @Column({ default: 'pending' }) status: string; // pending | approved | rejected
  @Column({ default: '' }) teacherComment: string;
  @CreateDateColumn() createdAt: Date;
}

@Entity('attendance_records')
export class AttendanceRecord {
  @PrimaryGeneratedColumn() id: number;
  @Index() @Column() subjectId: number;
  @Column() teacherId: number;
  @Index() @Column() studentId: number;
  @Column() date: string; // YYYY-MM-DD
  @Column({ default: 'present' }) status: string; // present | absent | late
}

@Entity('quizzes')
export class Quiz {
  @PrimaryGeneratedColumn() id: number;
  @Index() @Column() subjectId: number;
  @Index() @Column() teacherId: number;
  @Column() title: string;
  @Column({ default: '' }) description: string;
  @Column({ type: 'int', default: 10 }) totalMarks: number;
  @Column({ type: 'timestamptz', nullable: true }) date: Date;
  @Column({ default: 'manual' }) kind: string; // manual | online | exam
  @Column({ default: 'quiz' }) category: string; // quiz | assignment | mid | final | presentation
  @Column({ type: 'timestamptz', nullable: true }) startAt: Date; // exam window (exam: set by superadmin)
  @Column({ type: 'timestamptz', nullable: true }) endAt: Date;
  @Column({ type: 'int', default: 60 }) secondsPerQuestion: number;
  @Column({ type: 'int', default: 0 }) questionsPerStudent: number; // 0 = all
  @Column({ nullable: true }) refFilename: string; // teacher-only reference PDF
  @Column({ default: '' }) refOriginalName: string;
  @CreateDateColumn() createdAt: Date;
}

@Entity('quiz_questions')
export class QuizQuestion {
  @PrimaryGeneratedColumn() id: number;
  @Index() @Column() quizId: number;
  @Column({ type: 'text' }) text: string;
  @Column({ type: 'simple-json' }) options: string[];
  @Column({ type: 'int' }) correct: number; // index into options
}

@Entity('quiz_attempts')
export class QuizAttempt {
  @PrimaryGeneratedColumn() id: number;
  @Index() @Column() quizId: number;
  @Index() @Column() studentId: number;
  @Column({ type: 'simple-json' }) questionIds: number[]; // this student's randomized set
  @Column({ type: 'simple-json' }) answers: Record<string, number>; // questionId -> chosen index
  @Column({ type: 'float', default: 0 }) score: number;
  @Column({ default: 'in_progress' }) status: string; // in_progress | finished
  @CreateDateColumn() startedAt: Date;
  @Column({ type: 'timestamptz', nullable: true }) finishedAt: Date;
}

@Entity('class_assignments')
export class ClassAssignment {
  @PrimaryGeneratedColumn() id: number;
  @Index() @Column() subjectId: number;
  @Index() @Column() teacherId: number;
  @Column() title: string;
  @Column({ default: '' }) description: string;
  @Column({ type: 'timestamptz', nullable: true }) dueDate: Date;
  @Column({ type: 'simple-json' }) questions: { q: string; answer: string; marks: number }[];
  @CreateDateColumn() createdAt: Date;
}

@Entity('assignment_submissions')
export class AssignmentSubmission {
  @PrimaryGeneratedColumn() id: number;
  @Index() @Column() assignmentId: number;
  @Index() @Column() studentId: number;
  @Column({ type: 'simple-json' }) answers: string[];
  @Column({ nullable: true }) filename: string;
  @Column({ default: '' }) originalName: string;
  @Column({ type: 'float', default: 0 }) score: number;
  @Column({ type: 'float', default: 0 }) maxScore: number;
  @Column({ default: 'graded' }) status: string; // graded (auto) | overridden
  @CreateDateColumn() submittedAt: Date;
}

@Entity('teacher_change_requests')
export class TeacherChangeRequest {
  @PrimaryGeneratedColumn() id: number;
  @Index() @Column() studentId: number;
  @Column({ nullable: true }) subjectId: number;
  @Column({ type: 'text' }) reason: string;
  @Column({ default: '' }) desiredTeacher: string;
  @Column({ nullable: true }) filename: string;
  @Column({ default: '' }) originalName: string;
  @Column({ default: 'pending' }) status: string; // pending | approved | rejected
  @Column({ default: '' }) adminComment: string;
  @CreateDateColumn() createdAt: Date;
}

@Entity('quiz_grades')
export class QuizGrade {
  @PrimaryGeneratedColumn() id: number;
  @Index() @Column() quizId: number;
  @Index() @Column() studentId: number;
  @Column({ type: 'float', nullable: true }) marks: number;
  @Column({ default: 'pending' }) status: string; // pending | graded | missed
}

@Entity('retake_requests')
export class RetakeRequest {
  @PrimaryGeneratedColumn() id: number;
  @Index() @Column() quizId: number;
  @Index() @Column() studentId: number;
  @Column({ type: 'text' }) reason: string;
  @Column({ nullable: true }) filename: string;
  @Column({ default: '' }) originalName: string;
  @Column({ default: 'pending' }) status: string; // pending | approved | rejected
  @CreateDateColumn() createdAt: Date;
}
