import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import en from '@/locales/en/common.json';

if (!i18n.isInitialized) {
  i18n.use(initReactI18next);

  i18n.init({
    resources: {
      en: { common: en },
    },
    fallbackLng: 'en',
    defaultNS: 'common',
    interpolation: {
      escapeValue: false,
    },
  });
}

export default i18n;
