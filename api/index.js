// Vercel serverless entry — wraps the compiled NestJS app (dist/) in one function.
require('reflect-metadata');
const express = require('express');
const fs = require('fs');
const { NestFactory } = require('@nestjs/core');
const { ExpressAdapter } = require('@nestjs/platform-express');
const { DataSource } = require('typeorm');
const { AppModule } = require('../dist/app.module');
const { seed } = require('../dist/seed');
const { UPLOAD_DIR } = require('../dist/api');

let cached;

async function getServer() {
  if (cached) return cached;
  const expressApp = express();
  if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });
  expressApp.use('/uploads', express.static(UPLOAD_DIR));
  const app = await NestFactory.create(AppModule, new ExpressAdapter(expressApp));
  app.enableCors();
  app.setGlobalPrefix('api');
  await app.init();
  seed(app.get(DataSource)).catch((e) => console.error('Seed skipped:', e.message));
  cached = expressApp;
  return cached;
}

module.exports = async (req, res) => {
  const server = await getServer();
  return server(req, res);
};
