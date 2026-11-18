import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { readFileSync } from 'fs';
import { join } from 'path';
import { AppModule } from './app.module';

/** Optional direct HTTPS (HTTPS_KEY_FILE + HTTPS_CERT_FILE); otherwise run behind a reverse proxy (see docs/HTTPS_TABLET.md). */
function httpsOptions() {
  const key = process.env.HTTPS_KEY_FILE, cert = process.env.HTTPS_CERT_FILE;
  if (!key && !cert) return undefined;
  if (!key || !cert) throw new Error('HTTPS_KEY_FILE and HTTPS_CERT_FILE must be set together');
  return { key: readFileSync(key), cert: readFileSync(cert) };
}

async function bootstrap() {
  const https = httpsOptions();
  const app = await NestFactory.create<NestExpressApplication>(AppModule, https ? { httpsOptions: https } : {});
  app.setGlobalPrefix('api');
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
  const origins = process.env.CORS_ORIGINS?.split(',').map((s) => s.trim()).filter(Boolean);
  if (origins?.length) app.enableCors({ origin: origins });
  app.enableShutdownHooks();

  // behind a reverse proxy (Caddy / nginx / IIS): trust X-Forwarded-* so req.secure / req.ip are correct. e.g. TRUST_PROXY=1
  if (process.env.TRUST_PROXY) {
    const v = process.env.TRUST_PROXY;
    app.set('trust proxy', /^\d+$/.test(v) ? Number(v) : v === 'true' ? true : v);
  }
  const secureEnv = !!https || !!process.env.TRUST_PROXY;
  app.use((req: any, res: any, next: any) => {
    if (process.env.REDIRECT_HTTP === 'on' && !req.secure && req.method === 'GET') return res.redirect(301, `https://${req.headers.host}${req.originalUrl}`);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'same-origin');
    // HSTS is opt-in: browsers remember it, so turn it on only once HTTPS works for good
    if (process.env.HSTS === 'on' && secureEnv && req.secure) res.setHeader('Strict-Transport-Security', 'max-age=15552000');
    next();
  });

  // web UI (public/index.html) is served from the same origin as the API: http://localhost:3000/
  // the page and the service worker are never cached by the browser, so tablets pick up updates on the next open
  app.useStaticAssets(join(process.cwd(), 'public'), {
    setHeaders: (res, path) => {
      if (/(index\.html|sw\.js|manifest\.webmanifest)$/.test(path)) res.setHeader('Cache-Control', 'no-cache');
    },
  });

  if (process.env.NODE_ENV !== 'production') {
    const config = new DocumentBuilder().setTitle('MAD API').setVersion('1.0').addBearerAuth().addSecurityRequirements('bearer').build();
    SwaggerModule.setup('api/docs', app, SwaggerModule.createDocument(app, config));
  }

  await app.listen(process.env.PORT ?? 3000);
}
bootstrap();
