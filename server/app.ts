import express, { type Express } from 'express';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import { toNodeHandler } from 'better-auth/node';
import { getAuth } from './auth';
import { createApiRouter } from './routes';
import { errorHandler, authLimiter, toHeaders } from './http/middleware';
import { env, isProduction, hasDatabase, isConfigured, missingEnv, invalidEnv } from './env';

export function createApp(): Express {
  const app = express();

  app.set('trust proxy', 1);
  app.disable('x-powered-by');

  /* -------------------------------- security ------------------------------- */

  app.use(
    helmet({
      contentSecurityPolicy: {
        useDefaults: false,
        directives: {
          defaultSrc: ["'self'"],
          // Vite injects styles at runtime; scripts stay strictly same-origin.
          scriptSrc: ["'self'"],
          styleSrc: ["'self'", "'unsafe-inline'"],
          imgSrc: ["'self'", 'data:', 'blob:', 'https:'],
          fontSrc: ["'self'", 'data:'],
          connectSrc: ["'self'", ...(env.SUPABASE_URL ? [env.SUPABASE_URL] : [])],
          objectSrc: ["'none'"],
          frameAncestors: ["'none'"],
          baseUri: ["'self'"],
          formAction: ["'self'"],
          ...(isProduction ? { upgradeInsecureRequests: [] } : {}),
        },
      },
      crossOriginEmbedderPolicy: false,
      referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
      hsts: isProduction ? { maxAge: 31536000, includeSubDomains: true, preload: true } : false,
    }),
  );

  app.use(cookieParser());

  /**
   * The app is same-origin in every environment (Vite proxies /api in dev,
   * Vercel routes /api in production), so there is no CORS allowance to grant
   * and no cross-site request can carry the session cookie.
   */
  /*
   * Compare ORIGINS, not strings.
   *
   * An Origin header is always scheme + host with no path and no trailing
   * slash, while APP_URL is typed by a person into a dashboard — and
   * "https://example.com/" is the overwhelmingly natural thing to type. That
   * one character used to reject every write with "That request did not come
   * from this app", which is a maddening thing to debug.
   */
  const allowedOrigin = (() => {
    try {
      return new URL(env.APP_URL).origin;
    } catch {
      return env.APP_URL;
    }
  })();

  app.use((req, res, next) => {
    const origin = req.headers.origin;
    if (origin && origin !== allowedOrigin && req.method !== 'GET' && req.method !== 'HEAD') {
      res.status(403).json({
        error: { code: 'forbidden_origin', message: 'That request did not come from this app.' },
      });
      return;
    }
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
    next();
  });

  /* ------------------------------ authentication --------------------------- */

  if (hasDatabase && isConfigured) {
    // Better Auth owns its own body parsing, so it is mounted before express.json.
    app.all('/api/auth/sign-in/*', authLimiter);
    app.all('/api/auth/sign-up/*', authLimiter);
    app.all('/api/auth/forget-password', authLimiter);
    app.all('/api/auth/reset-password', authLimiter);
    app.all('/api/auth/*', toNodeHandler(getAuth()));
  } else {
    // Say precisely what is missing. A deployment that cannot sign anyone in
    // should not make you guess which environment variable it wants.
    app.all('/api/auth/*', (_req, res) => {
      res.status(503).json({
        error: {
          code: 'not_configured',
          message: missingEnv.length
            ? `This deployment is missing ${missingEnv.join(' and ')}. Set it and redeploy.`
            : 'Accounts are unavailable until the ledger is configured.',
          details: { missing: missingEnv, invalid: invalidEnv },
        },
      });
    });
  }

  /* ---------------------------------- api ---------------------------------- */

  app.use(express.json({ limit: '25mb' }));
  app.use('/api', createApiRouter());

  app.use(errorHandler);

  return app;
}

export { toHeaders };
