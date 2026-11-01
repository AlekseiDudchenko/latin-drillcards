/** Web Speech BCP-47 code of the language being learned. */
export const SPEECH_LANG = 'la';
/** Few devices ship a Latin voice; Italian reads Latin (ecclesiastical pronunciation) acceptably. */
const FALLBACK_LANGS = ['it'];

function normalizeLang(lang: string): string {
    return lang.toLowerCase().replace(/_/g, "-");
}

function inLanguage<T extends { lang: string; default?: boolean }>(voices: T[], base: string): T | null {
    const matches = voices.filter(v => new RegExp(`^${base}(?:-|$)`).test(normalizeLang(v.lang)));
    return matches.find(v => v.default) ?? matches[0] ?? null;
}

export function pickVoice<T extends { lang: string; name: string; default?: boolean }>(voices: T[]): T | null {
    for (const base of [SPEECH_LANG, ...FALLBACK_LANGS]) {
        const voice = inLanguage(voices, base);
        if (voice) return voice;
    }
    return voices.find(v => /latin|latina/i.test(v.name)) ?? null;
}
