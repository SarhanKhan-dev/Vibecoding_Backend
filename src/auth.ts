import {
  Body, Controller, Post, Get, Delete, Injectable, CanActivate, ExecutionContext,
  UnauthorizedException, BadRequestException, SetMetadata, createParamDecorator,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as bcrypt from 'bcryptjs';
import { User, Session } from './entities';

export const IS_PUBLIC = 'isPublic';
export const Public = () => SetMetadata(IS_PUBLIC, true);

export const CurrentUser = createParamDecorator(
  (_: unknown, ctx: ExecutionContext) => ctx.switchToHttp().getRequest().user,
);

const SESSION_DAYS = 7;

// Session-based auth: the client holds an opaque session ID (sent as
// "Authorization: Bearer <sessionId>"); the session itself lives in Postgres,
// so it can be revoked server-side at any time (logout deletes it).
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private reflector: Reflector,
    @InjectRepository(Session) private sessions: Repository<Session>,
    @InjectRepository(User) private users: Repository<User>,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [
      ctx.getHandler(), ctx.getClass(),
    ]);
    if (isPublic) return true;

    const req = ctx.switchToHttp().getRequest();
    const sessionId = (req.headers.authorization || '').replace('Bearer ', '').trim();
    if (!sessionId) throw new UnauthorizedException('Not logged in');

    let session: Session | null = null;
    try {
      session = await this.sessions.findOneBy({ id: sessionId });
    } catch {
      throw new UnauthorizedException('Invalid session'); // malformed uuid
    }
    if (!session) throw new UnauthorizedException('Session expired — please log in again');
    if (new Date(session.expiresAt) < new Date()) {
      await this.sessions.delete({ id: session.id });
      throw new UnauthorizedException('Session expired — please log in again');
    }

    const user = await this.users.findOneBy({ id: session.userId });
    if (!user) throw new UnauthorizedException('User no longer exists');
    req.user = { sub: user.id, email: user.email, name: user.name };
    req.sessionId = session.id;
    return true;
  }
}

@Controller('auth')
export class AuthController {
  constructor(
    @InjectRepository(User) private users: Repository<User>,
    @InjectRepository(Session) private sessions: Repository<Session>,
  ) {}

  private async issue(user: User) {
    const session = await this.sessions.save(this.sessions.create({
      userId: user.id,
      expiresAt: new Date(Date.now() + SESSION_DAYS * 86400000),
    }));
    const { passwordHash, ...safe } = user;
    return { token: session.id, user: safe };
  }

  @Public()
  @Post('register')
  async register(@Body() body: any) {
    const { email, password, name, university = '', major = '' } = body || {};
    if (!email || !password || !name) throw new BadRequestException('name, email and password are required');
    if (password.length < 6) throw new BadRequestException('Password must be at least 6 characters');
    const existing = await this.users.findOneBy({ email: email.toLowerCase() });
    if (existing) throw new BadRequestException('An account with this email already exists');
    const user = await this.users.save(this.users.create({
      email: email.toLowerCase(),
      passwordHash: await bcrypt.hash(password, 10),
      name, university, major,
    }));
    return this.issue(user);
  }

  @Public()
  @Post('login')
  async login(@Body() body: any) {
    const { email, password } = body || {};
    const user = await this.users.findOneBy({ email: (email || '').toLowerCase() });
    if (!user || !(await bcrypt.compare(password || '', user.passwordHash))) {
      throw new UnauthorizedException('Invalid email or password');
    }
    return this.issue(user);
  }

  @Delete('logout')
  async logout(@CurrentUser() u: any, @Body() _body: any) {
    await this.sessions.delete({ userId: u.sub });
    return { ok: true };
  }

  @Get('me')
  async me(@CurrentUser() u: any) {
    const user = await this.users.findOneBy({ id: u.sub });
    if (!user) throw new UnauthorizedException();
    const { passwordHash, ...safe } = user;
    return safe;
  }
}
