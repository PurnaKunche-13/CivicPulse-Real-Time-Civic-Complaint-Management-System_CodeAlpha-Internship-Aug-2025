# CivicPulse

Node.js / Express / EJS civic issue tracker with Supabase, Google login, optional AI image descriptions and Telegram notifications.

## Run on Windows

Install Node.js 20 or later. Open a terminal in this folder (the folder containing package.json).

    npm ci
    npm start

Visit http://localhost:3000. Existing .env settings are retained. For a fresh setup, copy .env.example to .env and fill in your values. Never expose the Supabase service role key in browser code.

## Supabase setup

Run supabase-schema.sql in your Supabase SQL editor if the tables do not exist. Enable the Google provider in Supabase Authentication and configure its Google client credentials. Set Google's authorized callback to the callback URL shown by Supabase. Add http://localhost:3000/auth/callback to the Supabase redirect URL allowlist. For another host, change APP_URL and allowlist that host's /auth/callback too. Restart the application after changing .env.

The supplied schema seeds admin / admin123. Change that password in your database before hosting the application. The existing schema stores admin passwords as plain text; password hashing, login rate limiting, CSRF protection and a persistent session store remain production hardening work.

AI generation is optional. Set OPENAI_API_KEY to an OpenRouter key with the default base URL and model. For direct OpenAI use, set OPENAI_BASE_URL=https://api.openai.com/v1 and OPENAI_MODEL=gpt-4o-mini. Missing AI configuration no longer prevents startup; enter issue details manually.

## Corrections

- Google OAuth now uses PKCE with its verifier stored in the Express session and saved before redirecting.
- Async route failures reach Express error middleware instead of becoming unhandled rejections.
- Login regenerates sessions; admin login saves before redirect; logout waits for session destruction.
- Optional AI credentials no longer crash startup; the OpenRouter model ID is configurable and uses its provider prefix by default.
- Uploads accept JPEG, PNG and WebP extensions/MIME types, have a 5 MB limit and generated filenames. This validates metadata, not image contents.
- Temporary AI uploads are removed on both success and failure; failed problem inserts remove their uploads.
- Invalid admin dates and status values return HTTP 400. Missing problem records return 404. Resetting statuses clears stale timestamps.
- Added executable runtime tests and an environment example.

## Validation

    npm test

Five local tests pass: public pages/404, authentication guards, mocked admin session/validation/logout, rejected async handler recovery, and EJS template compilation. Database responses in admin tests are mocked. No live Supabase writes, Google sign-ins, AI requests or Telegram messages were executed. Verify these integrations with your own configured services.

The returned ZIP excludes node_modules and Git history; install dependencies with npm ci. Original uploads and .env are retained.
