import type { IncomingMessage, ServerResponse } from 'node:http';

/**
 * Vercel serverless entry. The same Express app runs locally and in
 * production, so there is no second code path for the API to drift into.
 *
 * The app is built on the first request rather than at module scope. If
 * construction throws — a bad connection string, a plugin that will not
 * initialise — a module-scope failure gives the platform nothing to report but
 * FUNCTION_INVOCATION_FAILED, and you are left guessing at every route at once.
 * Built here, the same failure becomes a readable 500 that names itself.
 */

type Handler = (req: IncomingMessage, res: ServerResponse) => void;

let app: Handler | null = null;
let startupError: unknown = null;

export default async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (!app && !startupError) {
    try {
      const { createApp } = await import('../server/app');
      app = createApp() as unknown as Handler;
    } catch (error) {
      startupError = error;
      console.error('[api] the server could not start', error);
    }
  }

  if (startupError) {
    const detail = startupError instanceof Error ? startupError.message : String(startupError);
    res.statusCode = 500;
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Cache-Control', 'no-store');
    res.end(
      JSON.stringify({
        error: {
          code: 'startup_failed',
          message: `The server could not start: ${detail}`,
        },
      }),
    );
    return;
  }

  app?.(req, res);
}
