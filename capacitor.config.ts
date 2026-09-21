import type { CapacitorConfig } from '@capacitor/cli';

/**
 * The Android shell.
 *
 * `server.url` points the WebView at the deployed site rather than at bundled
 * assets. That is deliberate: the session is a same-origin httpOnly cookie, so
 * loading the app from its real origin is what makes sign-in work at all — a
 * bundled `capacitor://` origin could never send that cookie to the API.
 * The service worker still provides the offline shell, and the Capacitor
 * bridge is injected either way, so the native widget and the reminders keep
 * working.
 *
 * Set CAPACITOR_SERVER_URL at build time to point at your deployment.
 */
const SERVER_URL = process.env.CAPACITOR_SERVER_URL;

const config: CapacitorConfig = {
  appId: 'in.neel.ledger',
  appName: 'Ledger',
  webDir: 'dist',

  ...(SERVER_URL
    ? {
        server: {
          url: SERVER_URL,
          cleartext: SERVER_URL.startsWith('http://'),
          androidScheme: 'https',
        },
      }
    : {}),

  android: {
    // A money app has no business allowing screenshots in the recents list on
    // a shared phone; this is re-asserted natively in MainActivity.
    backgroundColor: '#F6F6F8',
  },

  plugins: {
    LocalNotifications: {
      smallIcon: 'ic_stat_ledger',
      iconColor: '#5856D6',
    },
  },
};

export default config;
