import { type RouteConfig, index, layout, route } from '@react-router/dev/routes';

export default [
  // Public marketing landing
  index('routes/landing.tsx'),
  route('podminky', 'routes/terms.tsx'),
  route('login', 'routes/login.tsx'),
  route('register', 'routes/register.tsx'),
  // Authenticated app
  layout('routes/app-layout.tsx', [
    route('dashboard', 'routes/dashboard.tsx'),
    route('documents', 'routes/documents.tsx'),
    route('settings/:section?', 'routes/settings.tsx'),
  ]),
] satisfies RouteConfig;
