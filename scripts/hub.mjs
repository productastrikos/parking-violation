/**
 * `npm run hub` — run this checkout as the offline laptop ("Hub"): one process
 * on http://localhost:4357 serving the dashboard, the guard app and the API,
 * opening the browser when ready. Same as the packaged laptop app, from source.
 * (Run `npm run build:lan` first — `npm run hub` does.)
 */
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
process.env.WEB_DIR ||= path.join(root, 'dist');
process.env.OPEN_BROWSER ||= '1';
process.env.HOST ||= '127.0.0.1';
await import('../server/index.js');
