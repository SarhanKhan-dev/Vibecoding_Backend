import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { DataSource } from 'typeorm';
import { join } from 'path';
import * as fs from 'fs';
import { AppModule } from './app.module';
import { seed } from './seed';
import { UPLOAD_DIR } from './api';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  app.enableCors({
    origin: '*',
    methods: 'GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS',
    allowedHeaders: 'Content-Type, Authorization',
  });
  app.setGlobalPrefix('api', { exclude: ['uploads/(.*)'] });

  const uploadsDir = UPLOAD_DIR.startsWith('/') ? UPLOAD_DIR : join(process.cwd(), UPLOAD_DIR);
  if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });
  app.useStaticAssets(uploadsDir, { prefix: '/uploads/' });

  const port = process.env.PORT || 3000;
  await app.listen(port);
  console.log(`🚀 StudyFlow API running on http://localhost:${port}/api`);

  try {
    await seed(app.get(DataSource));
  } catch (e) {
    console.error('Seed skipped:', (e as Error).message);
  }
}
bootstrap();
