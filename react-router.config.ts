import type { Config } from '@react-router/dev/config';

export default {
  ssr: false,
  appDirectory: 'app',
  // Pre-render the public marketing routes to static HTML at build time so
  // crawlers (Google, Seznam, social previews) receive fully-rendered content
  // and meta tags instead of an empty SPA shell. The authenticated app routes
  // stay client-only.
  async prerender() {
    return ['/', '/podminky', '/login', '/register'];
  },
} satisfies Config;
