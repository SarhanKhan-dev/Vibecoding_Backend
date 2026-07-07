import {
  Body, Controller, Post, Get, Injectable, CanActivate, ExecutionContext,
  UnauthorizedException, BadRequestException, SetMetadata, createParamDecorator,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as bcrypt from 'bcryptjs';
import { User } from './entities';

export const IS_PUBLIC = 'isPublic';
export const Public = () => SetMetadata(IS_PUBLIC, true);

export const CurrentUser = createParamDecorator(
  (_: unknown, ctx: ExecutionContext) => ctx.switchToHttp().getRequest().user,
);

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(private jwt: JwtService, private reflector: Reflector) {}
  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [
      ctx.getHandler(), ctx.getClass(),
    ]);
    if (isPublic) return true;
    const req = ctx.switchToHttp().getRequest();
    const token = (req.headers.authorization || '').replace('Bearer ', '');
    if (!token) throw new UnauthorizedException('Missing token');
    try {
      req.user = await this.jwt.verifyAsync(token);
      return true;
    } catch {
      throw new UnauthorizedException('Invalid token');
    }
  }
}

@Controller('auth')
export class AuthController {
  constructor(
    @InjectRepository(User) private users: Repository<User>,
    private jwt: JwtService,
  ) {}

  private async issue(user: User) {
    const token = await this.jwt.signAsync({ sub: user.id, email: user.email, name: user.name });
    const { passwordHash, ...safe } = user;
    return { token, user: safe };
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

  @Get('me')
  async me(@CurrentUser() u: any) {
    const user = await this.users.findOneBy({ id: u.sub });
    if (!user) throw new UnauthorizedException();
    const { passwordHash, ...safe } = user;
    return safe;
  }
}
