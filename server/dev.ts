import { createApp } from './app';
import { env, hasDatabase } from './env';

const app = createApp();

// Bound to loopback on purpose: a development server holding real financial
// data has no business being reachable from the rest of the network.
app.listen(env.PORT, '127.0.0.1', () => {
  console.info(`[api] listening on http://127.0.0.1:${env.PORT}`);
  if (!hasDatabase) {
    console.warn(
      '[api] DATABASE_URL is not set. The API will answer honestly with 503 and the UI will show its ' +
        'unavailable state — no placeholder data is served.',
    );
  }
});
