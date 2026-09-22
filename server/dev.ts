import { createApp } from './app';
import { env, isConfigured, missingEnv } from './env';

const app = createApp();

// Bound to loopback on purpose: a development server holding real financial
// data has no business being reachable from the rest of the network.
app.listen(env.PORT, '127.0.0.1', () => {
  console.info(`[api] listening on http://127.0.0.1:${env.PORT}`);
  if (!isConfigured) {
    console.warn(
      `[api] not fully configured (missing: ${missingEnv.join(', ') || 'none'}). ` +
        'The API answers 503 and the UI shows its unavailable state — no placeholder data is served.',
    );
  }
});
