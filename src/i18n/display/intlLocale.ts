import i18n from 'i18next';

/** Maps app language codes to BCP 47 tags for Intl date/number formatting. */
const INTL_LOCALE_BY_LANG: Record<string, string> = {
	en: 'en-US',
	ar: 'ar',
	he: 'he-IL',
	fa: 'fa-IR',
	ur: 'ur-PK',
	zh: 'zh-CN',
};

/** Active UI locale for Intl (follows i18n.language / locale store). */
export function getIntlLocale(language: string = i18n.language ?? 'en'): string {
	const normalized = language.trim().toLowerCase();
	if (INTL_LOCALE_BY_LANG[normalized]) return INTL_LOCALE_BY_LANG[normalized];
	const base = normalized.split('-')[0];
	return INTL_LOCALE_BY_LANG[base] ?? 'en-US';
}

const ARABIC_DIGIT_LANGUAGES = new Set(['ar', 'fa', 'ur']);

function baseLanguage(language: string): string {
	return language.trim().toLowerCase().split('-')[0];
}

/** Whether the active UI language should use Arabic-Indic digits (٠١٢٣…) in Intl output. */
export function usesArabicDigits(language: string = i18n.language ?? 'en'): boolean {
	return ARABIC_DIGIT_LANGUAGES.has(baseLanguage(language));
}

/** Extra Intl options so dates and numbers use localized digit shapes (not Western 0-9). */
export function getIntlDigitOptions(language?: string): Pick<Intl.NumberFormatOptions, 'numberingSystem'> {
	return usesArabicDigits(language) ? { numberingSystem: 'arab' } : {};
}
