import { type RouteConfig, index, layout, route } from '@react-router/dev/routes';

export default [
  route('login', 'routes/login.tsx'),
  layout('routes/app-layout.tsx', [
    index('routes/dashboard.tsx'),
    route('documents', 'routes/documents.tsx'),
    route('settings/:section?', 'routes/settings.tsx'),
  ]),
] satisfies RouteConfig;
