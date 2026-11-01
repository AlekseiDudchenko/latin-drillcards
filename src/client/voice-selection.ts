function normalizeLang(lang: string): string {
    return lang.toLowerCase().replace(/_/g, "-");
}

export function pickGermanVoice<T extends { lang: string; name: string; default?: boolean }>(voices: T[]): T | null {
    const de = voices.filter(v => /^de(?:-|$)/.test(normalizeLang(v.lang)));
    const exact = de.filter(v => normalizeLang(v.lang) === "de-de");
    return exact.find(v => v.default) ?? exact[0] ?? de[0]
        ?? voices.find(v => /deutsch|german/i.test(v.name)) ?? null;
}
