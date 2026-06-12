import i18n from 'i18next';
import LanguageDetector from 'i18next-browser-languagedetector';
import HttpBackend from 'i18next-http-backend';
import { initReactI18next } from 'react-i18next';

const detector = new LanguageDetector();
// Czech is the primary locale — used when the user has no stored preference.
detector.addDetector({
  name: 'defaultCs',
  lookup: () => 'cs',
});

i18n
  .use(HttpBackend)
  .use(detector)
  .use(initReactI18next)
  .init({
    fallbackLng: 'en',
    supportedLngs: ['cs', 'en'],
    ns: ['common'],
    defaultNS: 'common',
    detection: {
      order: ['localStorage', 'defaultCs'],
      caches: ['localStorage'],
      lookupLocalStorage: 'foldera.lang',
    },
    backend: {
      loadPath: '/locales/{{lng}}/{{ns}}.json',
    },
    interpolation: { escapeValue: false },
    react: { useSuspense: true },
  });

export default i18n;
