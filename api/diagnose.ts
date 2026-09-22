import type { IncomingMessage, ServerResponse } from 'node:http';

/**
 * TEMPORARY. Loads the server's modules one at a time and reports which one
 * fails and why.
 *
 * A module that throws while loading takes the whole serverless function with
 * it, and the platform can only report FUNCTION_INVOCATION_FAILED — the same
 * opaque message for a missing variable, a bad import and a broken bundle.
 * This narrows it to a single module and a single stack.
 *
 * It reveals no secrets: it reports which environment variables are SET, never
 * their values. Delete once the deployment is healthy.
 */

const STEPS: { name: string; load: () => Promise<unknown> }[] = [
  { name: 'server/env', load: () => import('../server/env') },
  { name: 'server/db/schema', load: () => import('../server/db/schema') },
  { name: 'server/db/client', load: () => import('../server/db/client') },
  { name: 'server/services/bootstrap', load: () => import('../server/services/bootstrap') },
  { name: 'server/auth', load: () => import('../server/auth') },
  { name: 'server/services/transactions', load: () => import('../server/services/transactions') },
  { name: 'server/routes', load: () => import('../server/routes') },
  { name: 'server/app', load: () => import('../server/app') },
];

export default async function handler(_req: IncomingMessage, res: ServerResponse): Promise<void> {
  const modules: Record<string, string> = {};
  let failure: { module: string; error: string; stack: string } | null = null;

  for (const step of STEPS) {
    try {
      await step.load();
      modules[step.name] = 'loaded';
    } catch (error) {
      modules[step.name] = 'FAILED';
      failure = {
        module: step.name,
        error: error instanceof Error ? `${error.name}: ${error.message}` : String(error),
        stack: error instanceof Error ? (error.stack ?? '').slice(0, 2000) : '',
      };
      break;
    }
  }

  // Constructing the app is a separate failure mode from importing it.
  let construct = 'not attempted';
  if (!failure) {
    try {
      const { createApp } = await import('../server/app');
      createApp();
      construct = 'ok';
    } catch (error) {
      construct = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
      failure = {
        module: 'createApp()',
        error: construct,
        stack: error instanceof Error ? (error.stack ?? '').slice(0, 2000) : '',
      };
    }
  }

  res.statusCode = failure ? 500 : 200;
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'no-store');
  res.end(
    JSON.stringify(
      {
        node: process.version,
        // Presence only. Never the values.
        envPresent: {
          DATABASE_URL: Boolean(process.env.DATABASE_URL),
          BETTER_AUTH_SECRET: Boolean(process.env.BETTER_AUTH_SECRET),
          BETTER_AUTH_URL: Boolean(process.env.BETTER_AUTH_URL),
          APP_URL: Boolean(process.env.APP_URL),
          NODE_ENV: process.env.NODE_ENV ?? null,
        },
        modules,
        construct,
        failure,
      },
      null,
      2,
    ),
  );
}
