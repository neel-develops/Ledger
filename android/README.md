# The Android app

A Capacitor shell around the same web app, plus two things the web genuinely
cannot do: a **native home-screen widget** and a **daily reminder**.

---

## Why it points at the deployed site

`capacitor.config.ts` sets `server.url` when `CAPACITOR_SERVER_URL` is present,
so the WebView loads the app from its real origin rather than from bundled
assets.

That is not laziness. The session is an httpOnly, SameSite cookie. A WebView
serving the app from `capacitor://localhost` is a different origin from the
API, so the browser would refuse to send that cookie and sign-in could never
work. Loading from the real origin keeps everything same-origin, the service
worker still provides the offline shell, and the Capacitor bridge is injected
either way — so the widget and reminders work regardless.

---

## Building

You need **Android Studio** (or the SDK + JDK 17) on your machine. Everything
below runs on your side; the SDK is not available in CI.

```bash
# Point the shell at your deployment, then build the web app
CAPACITOR_SERVER_URL=https://your-app.vercel.app npm run android:sync

# Debug APK, straight onto a plugged-in phone
npm run android:run

# Or open it in Android Studio
npm run android:open
```

The debug APK lands at:

```
android/app/build/outputs/apk/debug/app-debug.apk
```

### A release build

1. Create a keystore (once):
   ```bash
   keytool -genkey -v -keystore ledger.keystore -alias ledger \
     -keyalg RSA -keysize 2048 -validity 10000
   ```
2. Keep it **out of the repo** — `*.keystore` is gitignored.
3. In Android Studio: *Build → Generate Signed Bundle / APK*, pick that
   keystore, and choose **release**.

---

## The widget

Long-press the home screen → Widgets → Ledger. It resizes from a single tile
to a full-width panel; the provider picks its layout from the height it is
actually given.

| Size | Shows |
|---|---|
| Small | Total money, and how fresh that figure is |
| Medium | Total money, cash / digital, owed to me / I owe, and three quick actions |

**It does no arithmetic.** `LedgerPlugin.updateWidget` receives figures the app
has already computed, as strings of integer paise, and stores them in the same
`SharedPreferences` file Capacitor's Preferences plugin uses. The widget reads
those. Two consequences worth keeping:

- The widget can never disagree with the app, because there is only one
  implementation of the accounting.
- It holds no session and makes no network calls, so nothing sensitive leaves
  the app process.

The cost is that it shows the **last synced** position, so it says how old that
is. Before the first sync it shows `—` and "Open Ledger to sync" — never a
zero, which would be a lie about your money.

Quick actions open the app at `ledger://open/?add=expense` (or `income`,
`transfer`), which `AppShell` turns into the add sheet on that kind and then
strips from the URL so a refresh does not reopen it.

Signing out calls `clearWidget`, so the widget stops showing a signed-out
person's balances.

---

## The reminder

One notification a day, at a time you pick, via `@capacitor/local-notifications`.
Off until you turn it on in **More → Daily reminder**. It is the only
notification the app ever sends.

Rescheduling always cancels first, so changing the time cannot leave two
reminders running. On the web the setting explains it needs the Android app
rather than scheduling something that might not fire.

---

## Security

`MainActivity` sets `FLAG_SECURE`, which keeps balances out of screenshots and
out of the app-switcher thumbnail. A phone gets handed around; a ledger should
not be readable from the recents screen.

---

## Regenerating

`android/` is committed so the native code is reviewable. After changing web
code or Capacitor plugins:

```bash
npm run android:sync
```

Never delete and re-add the platform — `LedgerWidget.kt`, `LedgerPlugin.kt`,
`MainActivity.java`, the widget layouts and the manifest edits all live here and
would be lost.

`android/local.properties` points Gradle at your SDK and is gitignored; it is
created for you by Android Studio, or by hand:

```
sdk.dir=C:\\Users\\you\\AppData\\Local\\Android\\Sdk
```
