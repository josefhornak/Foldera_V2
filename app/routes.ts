import { type RouteConfig, index, layout, route } from '@react-router/dev/routes';

export default [
  // Public marketing landing
  index('routes/landing.tsx'),
  route('podminky', 'routes/terms.tsx'),
  route('ochrana-udaju', 'routes/privacy.tsx'),
  route('zpracovani-udaju', 'routes/dpa.tsx'),
  route('pozvanka/:token', 'routes/invite-accept.tsx'),
  route('login', 'routes/login.tsx'),
  route('register', 'routes/register.tsx'),
  route('vitejte', 'routes/onboarding.tsx'),
  // Authenticated app
  layout('routes/app-layout.tsx', [
    route('dashboard', 'routes/dashboard.tsx'),
    route('documents', 'routes/documents.tsx'),
    route('settings/:section?', 'routes/settings.tsx'),
    route('faktury', 'routes/admin-invoices.tsx'),
    route('admin', 'routes/admin.tsx'),
  ]),
] satisfies RouteConfig;
