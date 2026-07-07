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
  // CORS for all origins (including preflight), on every route
  expressApp.use((req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    if (req.method === 'OPTIONS') return res.status(204).end();
    next();
  });
  if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });
  expressApp.use('/uploads', express.static(UPLOAD_DIR));
  const app = await NestFactory.create(AppModule, new ExpressAdapter(expressApp));
  app.enableCors({
    origin: '*',
    methods: 'GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS',
    allowedHeaders: 'Content-Type, Authorization',
  });
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
