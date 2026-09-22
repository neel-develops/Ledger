import type { IncomingMessage, ServerResponse } from 'node:http';
import { createApp } from './app';

/**
 * The serverless entry point.
 *
 * Built once on the first request rather than at module scope. A construction
 * failure at module scope kills the whole function, and the platform can then
 * only report FUNCTION_INVOCATION_FAILED — the same opaque message for a bad
 * connection string, a broken bundle and a missing variable. Built here, the
 * failure becomes a 500 that says what actually went wrong.
 */

type NodeHandler = (req: IncomingMessage, res: ServerResponse) => void;

let app: NodeHandler | null = null;
let startupError: Error | null = null;

export default function handler(req: IncomingMessage, res: ServerResponse): void {
  if (!app && !startupError) {
    try {
      app = createApp() as unknown as NodeHandler;
    } catch (error) {
      startupError = error instanceof Error ? error : new Error(String(error));
      console.error('[api] the server could not start', startupError);
    }
  }

  if (startupError) {
    res.statusCode = 500;
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Cache-Control', 'no-store');
    res.end(
      JSON.stringify({
        error: {
          code: 'startup_failed',
          message: `The server could not start: ${startupError.message}`,
        },
      }),
    );
    return;
  }

  app?.(req, res);
}
