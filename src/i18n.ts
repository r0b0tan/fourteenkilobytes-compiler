/**
 * Texts the compiler writes into pages itself (post lists, author block).
 * Everything else on a page is content written by the user.
 */

export type SiteLanguage = 'en' | 'de';

export const SITE_LANGUAGES: readonly SiteLanguage[] = ['en', 'de'];

export const DEFAULT_SITE_LANGUAGE: SiteLanguage = 'en';

export interface SiteTexts {
  /** BCP 47 locale for date formatting */
  dateLocale: string;
  noPosts: string;
  endOfList: string;
  published: string;
  modified: string;
  /** Prefix before the author name, e.g. "By Jane" */
  by: string;
  tags: string;
}

const TEXTS: Record<SiteLanguage, SiteTexts> = {
  en: {
    dateLocale: 'en-US',
    noPosts: 'No posts yet.',
    endOfList: '— End of list —',
    published: 'Published',
    modified: 'Updated',
    by: 'By',
    tags: 'Tags',
  },
  de: {
    dateLocale: 'de-DE',
    noPosts: 'Noch keine Posts.',
    endOfList: '— Ende der Liste —',
    published: 'Veröffentlicht',
    modified: 'Aktualisiert',
    by: 'Von',
    tags: 'Tags',
  },
};

export function isSiteLanguage(value: unknown): value is SiteLanguage {
  return typeof value === 'string' && (SITE_LANGUAGES as readonly string[]).includes(value);
}

export function resolveSiteLanguage(value: unknown): SiteLanguage {
  return isSiteLanguage(value) ? value : DEFAULT_SITE_LANGUAGE;
}

export function getSiteTexts(language: SiteLanguage): SiteTexts {
  return TEXTS[language];
}
