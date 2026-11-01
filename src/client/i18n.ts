export type Lang = "en" | "ru" | "de";
export type SourceLang = "en" | "ru";

export interface CardUiTranslations {
    introductionTitle: string; continue: string; readyToContinue: string; insufficientOptions: string; exerciseUnavailable: string;
    wordTypeTitle: string; wordArticleTypeTitle: string; articleTitle: string; articleUnavailable: string;
    recallComponent: string; spellingComponent: string; articleComponent: string; unobserved: string; expectedAnswer: string;
    choiceTitle: string; textTitle: string; revealTitle: string;
    choose: string; yourAnswer: string; submit: string; next: string; reveal: string;
    remembered: string; forgotten: string; showDetails: string; hideDetails: string;
    wordDetails: string; examples: string; missingTranslation: string; listen: string; autoReadWords: string;
    ttsUnavailable: string; ttsNoVoice: string; ttsFailed: string;
    saving: string; submitted: string; error: string; correct: string; incorrect: string; info: string;
    clozeTitle: string; clozeSlot: string; clozeEmpty: string; clozeReset: string; clozeResults: string; clozeSlotCorrect: string; clozeSlotIncorrect: string;
    tokensTitle: string; sentenceAssemblyTitle: string; konjunktivTokenTitle: string;
    tokenAnswer: string; tokenPool: string; tokenEmpty: string; tokenReset: string; tokenHint: string;
}

export interface SessionUiTranslations {
    title: string; exercise: string; intent: string; learnNew: string; reviewDue: string; translation: string; interfaceLanguage: string;
    start: string; next: string; pause: string; resume: string; finish: string; retry: string;
    progress: string; paused: string; completed: string; abandoned: string; saveError: string; conflict: string;
    noNewWords: string; noDueWords: string; noApplicableTasks: string; loadError: string;
    format: string; single: string; circuit: string; scope: string; allExercises: string; dueComponents: string;
    correctionRound: string; summaryTitle: string; summaryTotals: string; recognitionComponent: string;
    resultCorrect: string; resultIncorrect: string; resultCorrected: string; resultUnobserved: string;
    mistakes: string; noMistakes: string; mistakeLine: string; corrected: string; notCorrected: string;
}

export interface HomeUiTranslations {
    homeTitle: string;
    searchDecks: string;
    deckCounts: string;
    noDecks: string;
    loading: string;
    catalogError: string;
    deckNotFound: string;
    wordNotFound: string;
    allDecks: string;
    backToDeck: string;
    toDeck: string;
    continueTitle: string;
    continueLine: string;
    continueAction: string;
    openSessionBlocks: string;
    deckStats: string;
    learnNewCount: string;
    reviewDueCount: string;
    emptyAllStarted: string;
    emptyNoTranslation: string;
    emptyNewNotForExercise: string;
    emptyNothingStarted: string;
    emptyDueNotForExercise: string;
    emptyNotDueYet: string;
    nextDue: string;
    wordsHeading: string;
    searchWords: string;
    noWords: string;
    stateNew: string;
    stateLearning: string;
    stateScheduled: string;
    stateDue: string;
    stageUnintroduced: string;
    stageLearning: string;
    stageReview: string;
    stageRelearning: string;
    progressHeading: string;
    notStarted: string;
    dueNow: string;
    dueOn: string;
    sharedProgress: string;
    inDecks: string;
    stateUnsettled: string;
    stateLearned: string;
    statusDetails: string;
    wordFilters: string[]; wordSorts: string[]; wordParts: string[]; wordSortLabel: string; wordPartLabel: string; wordResults: string; openWord: string;
    statusRule: string;
    statusStability: string;
    statusAssesses: string;
    statusDone: string;
    statusNoArticle: string;
    statusNoTranslation: string;
}

export interface LangOption {
    code: Lang;
    flag: string;
    label: string;
}

export const LANGUAGES: LangOption[] = [
    { code: "en", flag: "🇬🇧", label: "EN" },
    { code: "ru", flag: "🇷🇺", label: "RU" },
    { code: "de", flag: "🇩🇪", label: "DE" },
];

export interface Translations {
    cardUi: CardUiTranslations;
    sessionUi: SessionUiTranslations;
    homeUi: HomeUiTranslations;
    // Common
    check: string;
    next: string;
    previous: string;
    reset: string;
    noData: string;
    comingSoon: string;
    comingSoonBody: string;
    backHome: string;
    pageNotFound: string;
    homeLabel: string;

    // Words
    showTranslation: string;

    // Gaps
    gapTitle: string;
    gapPlaceholder: string;
    gapCorrect: string;
    gapWrong(answer: string): string;
    hintReveal(answer: string): string;

    // Sentences
    sentenceTitle: string;

    sentenceCorrect: string;
    sentenceWrong(target: string): string;
    sentenceVariation: string;

    // Lang select
    chooseLanguagePair: string;
    tagline: string;
    ruToDeDesc: string;

    // Home
    homeTitle: string;
    homeSubtitle: string;
    a1LevelTitle: string;
    a1LevelHint: string;
    a2LevelTitle: string;
    a2LevelHint: string;
    b1LevelTitle: string;
    b1LevelHint: string;
    b2LevelTitle: string;
    b2LevelHint: string;
    c1c2LevelTitle: string;
    c1c2LevelHint: string;
    videoLevelTitle: string;
    videoLevelHint: string;
    videoShortsLabel: string;
    videoSentencesLabel: string;
    archLevelTitle: string;
    archLevelHint: string;
    archVocabDesc: string;
    archSentencesDesc: string;
    archSentencesHint: string;
    archSourceNote: string;
    dailyPhrasesLabel: string;
    dailyPhrasesDesc: string;
    dailyPhrasesHint: string;
    kollokationenLabel: string;
    kollokationenHint: string;
    kollokationenDesc: string;
    vocabLabel: string;
    buildSentencesLabel: string;
    articlesLabel: string;
    allVocabLabel: string;
    soonText: string;
    wordsSubLabel: string;
    wordsSoonHint: string;
    sentencesSubLabel: string;
    sentencesByTagHint: string;
    grammarSubLabel: string;
    grammarSubHint: string;
    relativsatzTitle: string;
    relativsatzDesc: string;
    mixedLabel(level: string): string;
    passivLabel: string;
    prepLabel: string;
    tagDesc(tag: string): string;
    levelLabel: string;

    // Hören
    hoerenTitle: string;
    hoerenLabel: string;
    hoerenPlayAgain: string;
    hoerenModeDrag: string;
    hoerenModeType: string;
    hoerenNoTTS: string;
    hoerenPlaceholder: string;
    hoerenCorrect: string;
    hoerenWrong(target: string): string;
    hoerenDesc: string;
    titleHoeren: string;
    noGermanVoiceWarn: string;

    // Konjunktiv II
    k2TransformTitle: string;
    k2TransformHint: string;
    k2Placeholder: string;
    k2Correct: string;
    k2Wrong(answer: string): string;
    k2Desc: string;
    k2ModeDrag: string;
    k2ModeType: string;
    titleKonjunktiv2: string;
    k2HubTitle: string;
    k2HubDesc: string;
    k2ConditionalTitle: string;
    k2ConditionalHint: string;
    k2ConditionalDesc: string;
    k2PoliteTitle: string;
    k2PoliteHint: string;
    k2PoliteDesc: string;
    k2PastTitle: string;
    k2PastHint: string;
    k2PastDesc: string;

    // Artikel
    artikelTitle: string;
    artikelNoData: string;
    artikelCorrect: string;
    artikelWrong(correct: string): string;

    // Page titles
    titleLangSelect: string;
    titleHome: string;
    titleVocab: string;
    titleSentences: string;
    titleGaps: string;
    titleArticles: string;

    // Topic label
    topicLabel: string;

    // Home card descriptions
    a1VocabDesc: string;
    a1SentencesDesc: string;
    artikelLevelDesc(level: string): string;
    a2VocabDesc: string;
    a2SentencesDesc: string;
    b1AllVocabDesc: string;
    b2VocabDesc: string;
    b1MixedDesc: string;
    b2SentencesDesc: string;
    c1SentencesDesc: string;
    c2SentencesDesc: string;
    c1c2VocabDesc: string;
    c1c2PrepDesc: string;

    // Privacy
    speechHelpTitle: string;
    privacyLink: string;
    privacyTitle: string;
    privacyLastUpdated: string;
    privacyIntro: string;
    privacyGoogleTitle: string;
    privacyGoogleBody: string;
    privacyStorageTitle: string;
    privacyStorageBody: string;
    privacySyncTitle: string;
    privacySyncBody: string;
    privacyAnalyticsTitle: string;
    privacyAnalyticsBody: string;
    privacyNoCookiesTitle: string;
    privacyNoCookiesBody: string;
    privacyDeletionTitle: string;
    privacyDeletionBody: string;
    privacyContactTitle: string;
    privacyContactBody: string;

    // Video dictation
    videoDictTitle: string;
    videoDictHint: string;
    videoDictCorrect: string;
    videoDictWrong(answer: string): string;
    videoDictBack: string;
    videoDictReplay: string;
    videoDictResume: string;
    videoDictFinished: string;
    videoDictRestart: string;
    videoDictLoading: string;
    videoDictError: string;
    videoDictLabel: string;
    titleVideoDict: string;

    // Passiv gap
    passivGapTitle: string;
    passivGapHint: string;
    passivGapCorrect: string;
    passivGapWrong(answers: string[]): string;
    titlePassivGap: string;
    passivGapDesc: string;
    passivGapModeSelect: string;
    passivGapModeType: string;
    passivGapShowHint: string;
    passivGapAnswer(answers: string[]): string;

    // Kasus (Akkusativ / Dativ)
    kasusLabel: string;
    kasusTitle: string;
    kasusDesc: string;
    titleKasus: string;
    kasusCorrect: string;
    kasusWrong(answer: string): string;
    kasusTaskArticle: string;
    kasusTaskCase: string;
    kasusTaskQuestion: string;
    kasusTypeAll: string;
    kasusTypeArticle: string;
    kasusTypeCase: string;
    kasusTypeQuestion: string;
    kasusRuleOpen: string;
    kasusRuleClose: string;

    // Daily progress & streak
    dailyToday: string;
    streakDay: string;
    streakDays: string;

    // SRS flip cards
    srsDone: string;
    srsDoneBody(count: number): string;
    srsPracticeMore: string;
    srsNewMore: string;
    srsPracticeLabel: string;
    srsRemaining: string;
    srsDueLabel(n: number): string;
    srsLearnedLabel(n: number, total: number): string;
    vocabSrsHint(level: string): string;

    // Production vocab cards (translation → type the German word)
    prodVocabLabel: string;
    prodVocabDesc: string;
    revVocabLabel: string;
    revVocabDesc: string;
    learnVocabLabel: string;
    srsMarkLearned: string;
    srsMarkDifficult: string;
    srsMore: string;
    collocationsLabel: string;
    conjugationLink: string;
    srsFamily: string;
    srsSynonyms: string;
    srsAntonyms: string;
    srsWendungen: string;
    posNounLabel: string;
    posVerbLabel: string;
    posAdjLabel: string;
    posLearnDesc: string;
    prodWrong: string;

    // Standalone word card (shareable link)
    titleWordCard(word: string, level: string): string;
    cardLearnCta(level: string): string;
    cardDeckCta(level: string): string;
    shareWord: string;
    linkCopied: string;

    // Vocabulary level test
    titleLevelTest: string;
    levelTestLabel: string;
    levelTestHint: string;
    levelTestPick: string;
    levelTestResultTitle: string;
    levelTestStartWith(level: string): string;
    levelTestRetake: string;
    levelTestBannerKnown(level: string): string;

    // Telegram channel
    telegramTitle: string;
    telegramDesc: string;
    telegramQrAlt: string;

    // Install (PWA) prompt
    installText: string;
    installButton: string;
    installDismiss: string;
    installIosHint: string;

    // "Other" section — themed interview / IT deck
    otherLevelBadge: string;
    otherLevelTitle: string;
    otherLevelHint: string;
    berufVocabLabel: string;
    berufVocabDesc: string;
    berufVocabHint: string;
    berufSentencesLabel: string;
    berufSentencesDesc: string;
    berufSentencesHint: string;
    berufPhrasesLabel: string;
    berufPhrasesDesc: string;
    berufPhrasesHint: string;
    phrasesReveal: string;
    phraseKnew: string;
    phraseUnknown: string;
}

const EN: Translations = {
    sessionUi: {
        title: "Practice session", exercise: "Exercise", intent: "Words", learnNew: "Learn new", reviewDue: "Review due", translation: "Translation language", interfaceLanguage: "Interface language",
        start: "Start", next: "Next", pause: "Pause", resume: "Resume", finish: "Finish", retry: "Try saving again",
        progress: "Task {n} of {total}", paused: "Session paused. Your answers are saved.", completed: "Session complete. All answers are saved.", abandoned: "Session finished early. Your answers are saved.",
        saveError: "Could not save. Nothing was lost: try again.", conflict: "This session changed in another tab. Showing the saved state.",
        noNewWords: "No new words left in this deck.", noDueWords: "No words are due for review yet.", noApplicableTasks: "This exercise is unavailable for the selected words.", loadError: "Could not open local storage.",
        format: "Format", single: "One exercise", circuit: "Full set", scope: "Review", allExercises: "All exercises", dueComponents: "Only what is due",
        correctionRound: "Mistake review", summaryTitle: "Session summary", summaryTotals: "Tasks: {tasks} · answers: {answered} · mistakes: {mistakes}", recognitionComponent: "Recognition",
        resultCorrect: "correct", resultIncorrect: "mistake", resultCorrected: "corrected", resultUnobserved: "not assessed",
        mistakes: "Mistakes", noMistakes: "No mistakes", mistakeLine: "Your answer: {given} · correct: {expected}", corrected: "corrected", notCorrected: "not corrected yet",
    },
    homeUi: {
        homeTitle: "Words",
        searchDecks: "Find a deck",
        deckCounts: "{total} words · started {started}",
        noDecks: "No decks found.",
        loading: "Loading…",
        catalogError: "Could not load the word catalog.",
        deckNotFound: "Deck not found.",
        wordNotFound: "Word not found in the catalog.",
        allDecks: "← All decks",
        backToDeck: "← Back to deck",
        toDeck: "Back to deck",
        continueTitle: "Unfinished session",
        continueLine: "{deck} · task {n} of {total}",
        continueAction: "Continue session",
        openSessionBlocks: "Continue or finish the unfinished session first.",
        deckStats: "Words: {total} · started: {started} · new: {fresh} · due: {due}",
        learnNewCount: "Learn new ({n})",
        reviewDueCount: "Review due ({n})",
        emptyAllStarted: "Every word in this deck has been started, so there are no new ones. Review due words or pick another deck.",
        emptyNoTranslation: "The remaining new words have no translation into the selected language yet.",
        emptyNewNotForExercise: "No new words suit this exercise. Choose another exercise or the full set.",
        emptyNothingStarted: "Nothing to review yet: learn some new words first.",
        emptyDueNotForExercise: "Some words are due, but not for this exercise. Choose another exercise or the full set.",
        emptyNotDueYet: "Nothing is due for review right now.",
        nextDue: "Next review: {date}.",
        wordsHeading: "Words in this deck",
        searchWords: "Find a word",
        noWords: "No words found.",
        stateNew: "new",
        stateLearning: "learning",
        stateScheduled: "scheduled",
        stateDue: "due",
        stageUnintroduced: "not started",
        stageLearning: "learning",
        stageReview: "in review",
        stageRelearning: "relearning",
        progressHeading: "Progress",
        notStarted: "This word has not been started yet.",
        dueNow: "due now",
        dueOn: "review {date}",
        sharedProgress: "A word's progress is shared by every deck it is in. Familiar words still come back for review: memory fades over time.",
        inDecks: "In decks:",
        stateUnsettled: "not settled",
        stateLearned: "learned",
        statusDetails: "Exercise progress",
        wordFilters: ["All", "Due now", "New", "Learning", "Not settled", "Learned"], wordSorts: ["Deck order", "Alphabetical A–Z", "Weakest first", "Learned first"], wordParts: ["All parts of speech", "Nouns", "Verbs", "Adjectives", "Adverbs", "Other"], wordSortLabel: "Sort", wordPartLabel: "Part of speech", wordResults: "Showing {shown} of {total} words", openWord: "Open word card →",
        statusRule: "A word is learned when every component has at least {reviews} reviews and memory stability of {days} days or more.",
        statusStability: "stability {days} d of {need} d",
        statusAssesses: "Trains: {components}",
        statusDone: "done",
        statusNoArticle: "unavailable: no article",
        statusNoTranslation: "unavailable: no translation",
    },
    cardUi: {
        tokensTitle: "Build the answer", sentenceAssemblyTitle: "Build the sentence", konjunktivTokenTitle: "Fill the gap with Konjunktiv II",
        tokenAnswer: "Your answer", tokenPool: "Words", tokenEmpty: "Tap or drag words here", tokenReset: "Reset",
        tokenHint: "Enter adds or returns a word, Shift+arrows move it, Backspace returns it.",
        wordTypeTitle: "Type the German word (without article)", wordArticleTypeTitle: "Type the German word with its article", articleTitle: "Choose the article", articleUnavailable: "Article exercises require a noun with a known article.", recallComponent: "Word recall", spellingComponent: "Spelling", articleComponent: "Article", unobserved: "Not assessed", expectedAnswer: "Expected answer",
        introductionTitle: "Meet the word", continue: "Continue", readyToContinue: "Ready to continue", insufficientOptions: "Not enough distinct answer options. Choose another exercise.", exerciseUnavailable: "This exercise is unavailable for this word.",
        choiceTitle: "Choose the answer", textTitle: "Type the answer", revealTitle: "Recall and check",
        choose: "Choose one option", yourAnswer: "Your answer", submit: "Check", next: "Next", reveal: "Show answer",
        remembered: "Remembered", forgotten: "Didn't remember", showDetails: "Word details", hideDetails: "Hide details",
        wordDetails: "Word details", examples: "Examples", missingTranslation: "No confirmed translation", listen: "Listen in German", autoReadWords: "Read words automatically",
        ttsUnavailable: "Speech is not available on this device.", ttsNoVoice: "Install a German voice in your device settings.",
        ttsFailed: "Could not play the audio. Try again.", saving: "Please wait…", submitted: "Answer accepted",
        error: "Could not complete the action. Try again.", correct: "Correct", incorrect: "Not quite", info: "Answer accepted",
        clozeTitle: "Fill in the gaps", clozeSlot: "Gap {n} of {total}", clozeEmpty: "empty", clozeReset: "Clear answers", clozeResults: "Results by gap", clozeSlotCorrect: "correct", clozeSlotIncorrect: "not quite",
    },
    check: "Check",
    next: "Next",
    previous: "Previous",
    reset: "Reset",
    noData: "No data.",
    comingSoon: "Coming soon",
    comingSoonBody: "This section will be added soon.",
    backHome: "Back to home",
    pageNotFound: "Page not found",
    homeLabel: "Home",

    showTranslation: "Show translation",

    gapTitle: "Type missing word",
    gapPlaceholder: "Type the word",
    gapCorrect: "Correct!",
    gapWrong: (_a) => "Wrong. Try again.",
    hintReveal: (a) => `Answer: ${a}`,

    sentenceTitle: "Build the sentence",
    sentenceCorrect: "Correct!",
    sentenceWrong: (_t) => "Not quite. Try again.",
    sentenceVariation: "Variation",

    hoerenTitle: "Listen & build",
    hoerenLabel: "Listening",
    hoerenPlayAgain: "Play again",
    hoerenModeDrag: "Drag",
    hoerenModeType: "Type",
    hoerenNoTTS: "Your browser does not support speech synthesis.",
    hoerenPlaceholder: "Type what you heard",
    hoerenCorrect: "Correct!",
    hoerenWrong: (t) => `Not quite. Correct: ${t}`,
    hoerenDesc: "Listen and reconstruct the sentence.",
    titleHoeren: "Listening — DrillCards",
    noGermanVoiceWarn: "No German voice found on this device — playback may sound wrong. Install a German text-to-speech voice in your system settings (Android: Google TTS voice data · iOS: Settings → Accessibility → Spoken Content → Voices · Windows: German language pack).",

    k2TransformTitle: "Konjunktiv II: Transform",
    k2TransformHint: "Put the verb in Konjunktiv II form.",
    k2Placeholder: "Type the Konjunktiv II form",
    k2Correct: "Correct!",
    k2Wrong: (a) => `Wrong. Correct: ${a}`,
    k2Desc: "Transform verbs into Konjunktiv II.",
    k2ModeDrag: "Drag",
    k2ModeType: "Type",
    titleKonjunktiv2: "Konjunktiv II — DrillCards",
    k2HubTitle: "Konjunktiv II",
    k2HubDesc: "Practice all Konjunktiv II forms.",
    k2ConditionalTitle: "K2: Conditional Sentences",
    k2ConditionalHint: "Fill in both Konjunktiv II forms (comma-separated).",
    k2ConditionalDesc: "If-then sentences with Konjunktiv II.",
    k2PoliteTitle: "K2: Polite Forms",
    k2PoliteHint: "Put the verb into the polite Konjunktiv II form.",
    k2PoliteDesc: "Polite requests and suggestions.",
    k2PastTitle: "K2: Unreal Past",
    k2PastHint: "Form the Konjunktiv II Perfekt (e.g. gewusst hätte).",
    k2PastDesc: "Hypothetical past with Konjunktiv II.",

    chooseLanguagePair: "Choose your language pair",
    tagline: "Repeat German cards until it becomes automatic",
    ruToDeDesc: "Russian → German · A1–B2",

    homeTitle: "Deutsch-Trainer",
    homeSubtitle: "Choose your level and exercise.",
    a1LevelTitle: "First Steps",
    a1LevelHint: "Basic vocabulary & simple sentences",
    a2LevelTitle: "Building Foundations",
    a2LevelHint: "More vocabulary, simple subordinate clauses",
    b1LevelTitle: "Independent Use",
    b1LevelHint: "More complex sentences & grammar",
    b2LevelTitle: "Advanced",
    b2LevelHint: "Longer sentences & demanding texts",
    c1c2LevelTitle: "Proficient",
    c1c2LevelHint: "Abstract & academic language",
    videoLevelTitle: "Video dictation",
    videoLevelHint: "Watch real videos and reconstruct what's said",
    videoShortsLabel: "Shorts",
    videoSentencesLabel: "Sentences",
    archLevelTitle: "Software architecture",
    archLevelHint: "Professional B2–C1 vocabulary and sentences for IT and engineering",
    archVocabDesc: "130 terms: design, quality attributes, evaluation, tooling.",
    archSentencesDesc: "52 sentences on architecture work — grammar practised on technical vocabulary.",
    archSentencesHint: "Technical German, B2–C1 grammar",
    archSourceNote: "Vocabulary collected from the openbook \"Basiswissen für Softwarearchitekten\" (dpunkt.verlag). Example sentences are our own.",
    dailyPhrasesLabel: "Daily stand-up phrases",
    dailyPhrasesDesc: "40 phrases for the daily: status, blockers, code review, handover.",
    dailyPhrasesHint: "Recall & self-check",
    kollokationenLabel: "Collocations",
    kollokationenHint: "Word combinations Germans really use — B2",
    kollokationenDesc: "130 collocations: noun–verb combinations, adjective + noun, set phrases.",
    vocabLabel: "Vocabulary",
    buildSentencesLabel: "Build sentences",
    articlesLabel: "Articles",
    allVocabLabel: "All vocabulary",
    soonText: "Coming soon",
    wordsSubLabel: "Words",
    wordsSoonHint: "Coming soon by topic (tags)",
    sentencesSubLabel: "Build sentences",
    sentencesByTagHint: "By grammar topic (tags)",
    grammarSubLabel: "Grammar",
    grammarSubHint: "Structures & articles",
    relativsatzTitle: "Article in relative clause",
    relativsatzDesc: "Fill in der/die/das/den/dem/dessen …",
    mixedLabel: (lvl) => `${lvl} Mixed`,
    passivLabel: "Passive voice",
    prepLabel: "Prepositions",
    tagDesc: (tag) => ({
        "als": "Past events with als (single occasion).",
        "bedingung": "Conditional clauses: wenn, falls.",
        "bevor": "Temporal clauses with bevor (before).",
        "bis": "Temporal clauses with bis (until).",
        "damit": "Purpose clauses with damit.",
        "dass": "Subordinate clauses with dass.",
        "dass-satz": "Subordinate clauses with dass.",
        "dativ": "Sentences with dative objects.",
        "finalsatz": "Purpose clauses: damit, um … zu.",
        "indirekte_frage": "Indirect questions with ob, wann, wo.",
        "indirekte_rede": "Reported speech with Konjunktiv I.",
        "inversion": "Inverted word order after adverbs.",
        "irrealis": "Unreal conditions: Konjunktiv II.",
        "kausalsatz": "Reason clauses: weil, da.",
        "komparativ": "Comparisons: als, wie, je … desto.",
        "konditionalsatz": "Complex conditionals: falls, sofern.",
        "konjunktiv_ii": "Konjunktiv II for wishes & politeness.",
        "konjunktiv_ii_perfekt": "Konjunktiv II in the past tense.",
        "konnektoren": "Connectors: trotzdem, deshalb, außerdem.",
        "konzession": "Concessive clauses: obwohl, trotzdem.",
        "konzessivsatz": "Concessive subordinates: obgleich, auch wenn.",
        "modal": "Modal verbs: können, müssen, sollen.",
        "modalverben": "Sentences with modal verbs: können, müssen, wollen.",
        "modalsatz": "Modal clauses: indem, ohne … zu.",
        "nachdem": "Temporal sequence with nachdem.",
        "nebensatz": "General subordinate clause word order.",
        "nomen_verb": "Noun-verb collocations (Funktionsverben).",
        "nominalisierung": "Nominalization of verbs and adjectives.",
        "wortschatz": "Simple sentences built around B2 vocabulary.",
        "frage": "Typical job-interview questions.",
        "antwort": "Model answers for the interview.",
        "ob": "Indirect yes/no questions with ob.",
        "obwohl": "Concessive clauses with obwohl (although).",
        "partizip": "Participle constructions (Partizip I/II).",
        "passiv": "Passive voice: werden + Partizip II.",
        "perfekt": "Present perfect with haben/sein.",
        "plural": "Plural nouns in context.",
        "praepositionen": "Prepositions with correct case.",
        "praeteritum": "Simple past (Präteritum) forms.",
        "reflexiv": "Reflexive verbs: sich + Akkusativ/Dativ.",
        "relativsatz": "Relative clauses with der/die/das.",
        "sein-aux": "Perfect tense with sein as auxiliary.",
        "seit": "Ongoing situations with seit (since).",
        "solange": "Duration clauses with solange (as long as).",
        "temporalsatz": "Temporal clauses: als, nachdem, bevor, seit, während.",
        "waehrend": "Simultaneous actions with während.",
        "wann": "Indirect questions with wann (when).",
        "weil": "Causal clauses with weil (because).",
        "umfahren": "Trennbar: knock over (fährt … um). Untrennbar: drive around (umfährt).",
        "umfliegen": "Trennbar: topple over (fliegt … um). Untrennbar: fly around (umfliegt).",
        "umgehen": "Trennbar: deal with (geht … um). Untrennbar: bypass/avoid (umgeht).",
        "umschreiben": "Trennbar: rewrite (schreibt … um). Untrennbar: paraphrase (umschreibt).",
        "umstellen": "Trennbar: rearrange (stellt … um). Untrennbar: surround (umstellt).",
        "wenn": "Conditional/temporal clauses with wenn (if/when).",
    }[tag] || "Sentences filtered by grammar topic."),
    levelLabel: "Level",

    artikelTitle: "Which article?",
    artikelNoData: "No data.",
    artikelCorrect: "Correct!",
    artikelWrong: (c) => `Wrong. Correct: ${c}`,

    titleLangSelect: "DrillCards — Train German until it clicks",
    titleHome: "Deutsch-Trainer — DrillCards",
    titleVocab: "Vocabulary — DrillCards",
    titleSentences: "Build sentences — DrillCards",
    titleGaps: "Type missing word — DrillCards",
    titleArticles: "Articles — DrillCards",
    topicLabel: "Topic",
    a1VocabDesc: "Everyday nouns, verbs, adjectives.",
    a1SentencesDesc: "Drag words into correct order.",
    artikelLevelDesc: (lvl) => `der / die / das — choose the correct article for ${lvl} nouns.`,
    a2VocabDesc: "Everyday A2 vocabulary as flashcards.",
    a2SentencesDesc: "Sentences with weil, dass, wenn clauses.",
    b1AllVocabDesc: "B1 vocabulary. Topic filter coming soon.",
    b2VocabDesc: "Abstract & academic B2 vocabulary as flashcards.",
    b1MixedDesc: "All grammar topics mixed together.",
    b2SentencesDesc: "Konjunktiv II, Passiv, Konnektoren.",
    c1SentencesDesc: "Subjunctive, participle clauses.",
    c2SentencesDesc: "Academic style, nominalization.",
    c1c2VocabDesc: "Advanced vocabulary: abstract nouns, precise verbs, nuanced adjectives.",
    c1c2PrepDesc: "Prepositions with Dative / Accusative (coming soon).",

    speechHelpTitle: "Speech help (Russian)",
    privacyLink: "Privacy Policy",
    privacyTitle: "Privacy Policy",
    privacyLastUpdated: "Last updated: June 2026",
    privacyIntro: "DrillCards is a free German language trainer. We respect your privacy and collect as little data as possible.",
    privacyGoogleTitle: "Google Sign-in",
    privacyGoogleBody: "When you sign in with Google, we receive your name, email address, and profile picture. This data is used solely to display your account in the app and to associate your exercise progress with your account. We do not share this data with third parties. Our use of information received from Google APIs adheres to the <a href=\"https://developers.google.com/terms/api-services-user-data-policy\" target=\"_blank\" rel=\"noopener\">Google API Services User Data Policy</a>, including the Limited Use requirements.",
    privacyStorageTitle: "Local Data Storage",
    privacyStorageBody: "Your exercise progress, interface language, and theme preference are stored in your browser's localStorage. This data never leaves your device unless you sign in.",
    privacySyncTitle: "Progress Sync",
    privacySyncBody: "When signed in, your exercise progress (exercise type, level, item ID, correct/wrong counts) is synced to our database (Supabase) and linked to your Google account. This allows you to continue your progress on other devices.",
    privacyAnalyticsTitle: "Analytics",
    privacyAnalyticsBody: "We use GoatCounter, a privacy-friendly analytics tool that does not use cookies, does not track users across sites, and does not collect personal data. It only counts page views.",
    privacyNoCookiesTitle: "No Cookies",
    privacyNoCookiesBody: "This app does not use cookies. All client-side data is stored in localStorage.",
    privacyDeletionTitle: "Data Deletion",
    privacyDeletionBody: "You can sign out at any time to stop syncing progress. To delete local data, clear your browser's site data. To request deletion of synced data, email <a href=\"mailto:alexey.dudchenko@gmail.com\">alexey.dudchenko@gmail.com</a>.",
    privacyContactTitle: "Contact",
    privacyContactBody: "If you have questions about this policy, contact us at <a href=\"mailto:alexey.dudchenko@gmail.com\">alexey.dudchenko@gmail.com</a>.",
    videoDictTitle: "Video Dictation",
    videoDictHint: "Watch the video and type or assemble the phrase.",
    videoDictCorrect: "Correct!",
    videoDictWrong: (a) => `Wrong. Correct: ${a}`,
    videoDictBack: "Back",
    videoDictReplay: "Replay",
    videoDictResume: "Continue",
    videoDictFinished: "All segments done!",
    videoDictRestart: "Start over",
    videoDictLoading: "Loading video…",
    videoDictError: "Failed to load the video.",
    videoDictLabel: "Video dictation",
    titleVideoDict: "Video Dictation — DrillCards",

    passivGapTitle: "Passiv: Hilfsverben",
    passivGapHint: "Choose the auxiliary verb(s) that form the passive.",
    passivGapCorrect: "Correct!",
    passivGapWrong: (_answers) => "Wrong. Try again.",
    titlePassivGap: "Passiv: Hilfsverben — DrillCards",
    passivGapDesc: "Select or type the auxiliary verbs for Vorgangspassiv.",
    passivGapModeSelect: "Select",
    passivGapModeType: "Type",
    passivGapShowHint: "Hint",
    passivGapAnswer: (answers) => `Answer: ${answers.join(" + ")}`,

    kasusLabel: "Accusative & dative",
    kasusTitle: "Accusative or dative?",
    kasusDesc: "Fill in the missing article, name the case, pick the right question word.",
    titleKasus: "Accusative & dative — DrillCards",
    kasusCorrect: "Correct!",
    kasusWrong: (answer) => `Wrong. Correct: ${answer}`,
    kasusTaskArticle: "Which article fits in the gap?",
    kasusTaskCase: "Which case is the highlighted phrase in?",
    kasusTaskQuestion: "Which question does the highlighted phrase answer?",
    kasusTypeAll: "All",
    kasusTypeArticle: "Article",
    kasusTypeCase: "Case",
    kasusTypeQuestion: "Question",
    kasusRuleOpen: "Rule",
    kasusRuleClose: "Close",

    dailyToday: "Today",
    streakDay: "day",
    streakDays: "days",

    srsDone: "All done!",
    srsDoneBody: (n) => `${n} card${n === 1 ? "" : "s"} reviewed today.`,
    srsPracticeMore: "Practice more",
    srsNewMore: "Learn new words",
    srsPracticeLabel: "extra practice",
    srsRemaining: "left",
    srsDueLabel: (n) => `${n} due`,
    srsLearnedLabel: (n, total) => `${n}/${total} learned`,
    vocabSrsHint: (lvl) => `Spaced repetition · ${lvl} vocabulary`,

    prodVocabLabel: "Writing",
    prodVocabDesc: "See the translation, type the German word — nouns with their article.",
    revVocabLabel: "Reverse",
    revVocabDesc: "See the translation, pick the German word out of four options.",
    learnVocabLabel: "Learning session",
    srsMarkLearned: "✓ Learned",
    srsMarkDifficult: "★ Difficult",
    srsMore: "More: examples & word family",
    collocationsLabel: "In real texts:",
    conjugationLink: "Conjugation",
    srsFamily: "Word family",
    srsSynonyms: "Synonyms",
    srsAntonyms: "Antonyms",
    srsWendungen: "Set phrases",
    posNounLabel: "Nouns",
    posVerbLabel: "Verbs",
    posAdjLabel: "Adjectives",
    posLearnDesc: "Learn session by part of speech — German→translation, then reverse.",
    prodWrong: "Wrong. The correct answer:",

    titleWordCard: (word, level) => `${word} — ${level} vocabulary · DrillCards`,
    cardLearnCta: (level) => `Learn ${level} words`,
    cardDeckCta: (level) => `Browse the ${level} deck`,
    shareWord: "Share this word",
    linkCopied: "Link copied",

    titleLevelTest: "Vocabulary level test — DrillCards",
    levelTestLabel: "Level test",
    levelTestHint: "Not sure where to start? Find your level in ~3 minutes.",
    levelTestPick: "Pick the correct translation",
    levelTestResultTitle: "Your level",
    levelTestStartWith: (lvl) => `Start with ${lvl}`,
    levelTestRetake: "Take the test again",
    levelTestBannerKnown: (lvl) => `Your level ≈ ${lvl} · take the test again`,

    telegramTitle: "WunderWords on Telegram",
    telegramDesc: "Scan the QR code or tap to open the channel.",
    telegramQrAlt: "QR code for the WunderWords Telegram channel",

    installText: "Install DrillCards for quick access and offline practice.",
    installButton: "Install",
    installDismiss: "Not now",
    installIosHint: "To install: tap the Share button, then “Add to Home Screen”.",

    otherLevelBadge: "★",
    otherLevelTitle: "Other",
    otherLevelHint: "Job-interview vocabulary — IT & consulting",
    berufVocabLabel: "Interview vocabulary",
    berufVocabDesc: "Learn up to 20 words per session — first German→translation, then reverse.",
    berufVocabHint: "Spaced repetition · interview words",
    berufSentencesLabel: "Interview phrases",
    berufSentencesDesc: "Common interview questions and model answers.",
    berufSentencesHint: "Questions & answers",
    berufPhrasesLabel: "Speaking gambits",
    berufPhrasesDesc: "Ready-made phrases to buy time and structure answers.",
    berufPhrasesHint: "Recall & self-check",
    phrasesReveal: "Show phrase",
    phraseKnew: "✓ Knew it",
    phraseUnknown: "✗ Didn't know",
};

const RU: Translations = {
    sessionUi: {
        title: "Занятие", exercise: "Упражнение", intent: "Слова", learnNew: "Учить новые", reviewDue: "Повторить созревшие", translation: "Язык перевода", interfaceLanguage: "Язык интерфейса",
        start: "Начать", next: "Дальше", pause: "Пауза", resume: "Продолжить", finish: "Завершить", retry: "Сохранить ещё раз",
        progress: "Задание {n} из {total}", paused: "Занятие на паузе. Ответы сохранены.", completed: "Занятие завершено. Все ответы сохранены.", abandoned: "Занятие завершено досрочно. Ответы сохранены.",
        saveError: "Не удалось сохранить. Ничего не потеряно: попробуйте ещё раз.", conflict: "Занятие изменилось в другой вкладке. Показано сохранённое состояние.",
        noNewWords: "В этой колоде не осталось новых слов.", noDueWords: "Пока нет слов для повторения.", noApplicableTasks: "Это упражнение недоступно для выбранных слов.", loadError: "Не удалось открыть локальное хранилище.",
        format: "Формат", single: "Одно упражнение", circuit: "Комплекс", scope: "Повторение", allExercises: "Все упражнения", dueComponents: "Только созревшее",
        correctionRound: "Разбор ошибок", summaryTitle: "Итоги занятия", summaryTotals: "Заданий: {tasks} · ответов: {answered} · ошибок: {mistakes}", recognitionComponent: "Узнавание",
        resultCorrect: "верно", resultIncorrect: "ошибка", resultCorrected: "исправлено", resultUnobserved: "не проверялось",
        mistakes: "Ошибки", noMistakes: "Без ошибок", mistakeLine: "Ваш ответ: {given} · правильно: {expected}", corrected: "исправлено", notCorrected: "пока не исправлено",
    },
    homeUi: {
        homeTitle: "Слова",
        searchDecks: "Найти колоду",
        deckCounts: "{total} слов · начато {started}",
        noDecks: "Колоды не найдены.",
        loading: "Загрузка…",
        catalogError: "Не удалось загрузить каталог слов.",
        deckNotFound: "Колода не найдена.",
        wordNotFound: "Слово не найдено в каталоге.",
        allDecks: "← Все колоды",
        backToDeck: "← К колоде",
        toDeck: "К колоде",
        continueTitle: "Незаконченное занятие",
        continueLine: "{deck} · задание {n} из {total}",
        continueAction: "Продолжить занятие",
        openSessionBlocks: "Сначала продолжите или завершите незаконченное занятие.",
        deckStats: "Слов: {total} · начато: {started} · новых: {fresh} · к повторению: {due}",
        learnNewCount: "Учить новые ({n})",
        reviewDueCount: "Повторить созревшие ({n})",
        emptyAllStarted: "Все слова колоды уже начаты — новых нет. Повторяйте созревшие или выберите другую колоду.",
        emptyNoTranslation: "У оставшихся новых слов пока нет перевода на выбранный язык.",
        emptyNewNotForExercise: "Для этого упражнения новых слов нет. Выберите другое упражнение или комплекс.",
        emptyNothingStarted: "Повторять пока нечего: сначала выучите новые слова.",
        emptyDueNotForExercise: "Созревшие слова есть, но не для этого упражнения. Выберите другое упражнение или комплекс.",
        emptyNotDueYet: "Сейчас нечего повторять.",
        nextDue: "Ближайшее повторение: {date}.",
        wordsHeading: "Слова колоды",
        searchWords: "Найти слово",
        noWords: "Ничего не найдено.",
        stateNew: "новое",
        stateLearning: "изучается",
        stateScheduled: "запланировано",
        stateDue: "пора повторить",
        stageUnintroduced: "не начато",
        stageLearning: "изучается",
        stageReview: "на повторении",
        stageRelearning: "заново изучается",
        progressHeading: "Прогресс",
        notStarted: "Слово ещё не начато.",
        dueNow: "пора повторить",
        dueOn: "повторение {date}",
        sharedProgress: "Прогресс слова общий для всех колод, где оно есть. Знакомые слова тоже возвращаются на повторение: память со временем слабеет.",
        inDecks: "В колодах:",
        stateUnsettled: "не закреплено",
        stateLearned: "выучено",
        statusDetails: "Прогресс по упражнениям",
        wordFilters: ["Все", "Пора повторить", "Новые", "Изучаются", "Не закреплены", "Выучены"], wordSorts: ["Порядок в колоде", "По алфавиту · А–Я", "Сначала слабые", "Сначала выученные"], wordParts: ["Все части речи", "Существительные", "Глаголы", "Прилагательные", "Наречия", "Другие"], wordSortLabel: "Сортировка", wordPartLabel: "Часть речи", wordResults: "Показано {shown} из {total} слов", openWord: "Открыть карточку слова →",
        statusRule: "Слово выучено, когда в каждом компоненте не меньше {reviews} повторений и стабильность памяти от {days} дней.",
        statusStability: "стабильность {days} дн. из {need} дн.",
        statusAssesses: "Тренирует: {components}",
        statusDone: "готово",
        statusNoArticle: "недоступно: нет артикля",
        statusNoTranslation: "недоступно: нет перевода",
    },
    cardUi: {
        tokensTitle: "Соберите ответ", sentenceAssemblyTitle: "Соберите предложение", konjunktivTokenTitle: "Заполните пропуск в Konjunktiv II",
        tokenAnswer: "Ваш ответ", tokenPool: "Слова", tokenEmpty: "Нажмите на слова или перетащите их сюда", tokenReset: "Сбросить",
        tokenHint: "Enter добавляет или возвращает слово, Shift+стрелки двигают его, Backspace возвращает.",
        wordTypeTitle: "Введите немецкое слово без артикля", wordArticleTypeTitle: "Введите немецкое слово с артиклем", articleTitle: "Выберите артикль", articleUnavailable: "Для упражнения нужно существительное с известным артиклем.", recallComponent: "Знание слова", spellingComponent: "Написание", articleComponent: "Артикль", unobserved: "Не оценено", expectedAnswer: "Правильный ответ",
        introductionTitle: "Знакомство со словом", continue: "Продолжить", readyToContinue: "Можно продолжать", insufficientOptions: "Недостаточно однозначных вариантов. Выберите другое упражнение.", exerciseUnavailable: "Это упражнение недоступно для данного слова.",
        choiceTitle: "Выберите ответ", textTitle: "Введите ответ", revealTitle: "Вспомните и проверьте",
        choose: "Выберите один вариант", yourAnswer: "Ваш ответ", submit: "Проверить", next: "Дальше", reveal: "Показать ответ",
        remembered: "Помню", forgotten: "Не помню", showDetails: "О слове", hideDetails: "Скрыть подробности",
        wordDetails: "О слове", examples: "Примеры", missingTranslation: "Нет подтверждённого перевода", listen: "Прослушать по-немецки", autoReadWords: "Озвучивать слова автоматически",
        ttsUnavailable: "Озвучивание недоступно на этом устройстве.", ttsNoVoice: "Установите немецкий голос в настройках устройства.",
        ttsFailed: "Не удалось воспроизвести звук. Попробуйте ещё раз.", saving: "Подождите…", submitted: "Ответ принят",
        error: "Не удалось выполнить действие. Попробуйте ещё раз.", correct: "Правильно", incorrect: "Не совсем", info: "Ответ принят",
        clozeTitle: "Заполните пропуски", clozeSlot: "Пропуск {n} из {total}", clozeEmpty: "пусто", clozeReset: "Очистить ответы", clozeResults: "Результат по пропускам", clozeSlotCorrect: "верно", clozeSlotIncorrect: "неверно",
    },
    check: "Проверить",
    next: "Дальше",
    previous: "Назад",
    reset: "Сбросить",
    noData: "Нет данных.",
    comingSoon: "Скоро",
    comingSoonBody: "Этот раздел появится позже.",
    backHome: "На главную",
    pageNotFound: "Страница не найдена",
    homeLabel: "Главная",

    showTranslation: "Показать перевод",

    gapTitle: "Вставь пропущенное слово",
    gapPlaceholder: "Введи слово",
    gapCorrect: "Правильно!",
    gapWrong: (_a) => "Неверно. Попробуй ещё.",
    hintReveal: (a) => `Ответ: ${a}`,

    sentenceTitle: "Составь предложение",
    sentenceCorrect: "Правильно!",
    sentenceWrong: (_t) => "Не совсем. Попробуй ещё.",
    sentenceVariation: "Вариация",

    hoerenTitle: "Слушай и составь",
    hoerenLabel: "Аудирование",
    hoerenPlayAgain: "Повторить",
    hoerenModeDrag: "Перетаскивание",
    hoerenModeType: "Печать",
    hoerenNoTTS: "Ваш браузер не поддерживает синтез речи.",
    hoerenPlaceholder: "Введите услышанное",
    hoerenCorrect: "Правильно!",
    hoerenWrong: (t) => `Не совсем. Правильно: ${t}`,
    hoerenDesc: "Слушай и восстанови предложение.",
    titleHoeren: "Аудирование — DrillCards",
    noGermanVoiceWarn: "Немецкий голос не найден на этом устройстве — озвучка может звучать неправильно. Установите немецкий голос в системных настройках синтеза речи (Android: голосовые данные Google TTS · iOS: Настройки → Универсальный доступ → Устный контент → Голоса · Windows: немецкий языковой пакет).",

    k2TransformTitle: "Konjunktiv II: Трансформация",
    k2TransformHint: "Поставь глагол в Konjunktiv II.",
    k2Placeholder: "Введи форму Konjunktiv II",
    k2Correct: "Правильно!",
    k2Wrong: (a) => `Неверно. Правильно: ${a}`,
    k2Desc: "Преобразуй глаголы в Konjunktiv II.",
    k2ModeDrag: "Перетаскивание",
    k2ModeType: "Ввод",
    titleKonjunktiv2: "Konjunktiv II — DrillCards",
    k2HubTitle: "Konjunktiv II",
    k2HubDesc: "Тренируй все формы Konjunktiv II.",
    k2ConditionalTitle: "K2: Условные предложения",
    k2ConditionalHint: "Заполни обе формы Konjunktiv II (через запятую).",
    k2ConditionalDesc: "Условные предложения с Konjunktiv II.",
    k2PoliteTitle: "K2: Вежливые формы",
    k2PoliteHint: "Поставь глагол в вежливую форму Konjunktiv II.",
    k2PoliteDesc: "Вежливые просьбы и предложения.",
    k2PastTitle: "K2: Нереальное прошлое",
    k2PastHint: "Образуй Konjunktiv II Perfekt (напр. gewusst hätte).",
    k2PastDesc: "Гипотетическое прошлое с Konjunktiv II.",

    chooseLanguagePair: "Выберите языковую пару",
    tagline: "Повторяй карточки, пока не запомнишь",
    ruToDeDesc: "Русский → Немецкий · A1–B2",

    homeTitle: "Дойч-Тренер",
    homeSubtitle: "Выбери уровень и упражнение.",
    a1LevelTitle: "Первые шаги",
    a1LevelHint: "Базовый словарь и простые предложения",
    a2LevelTitle: "Основы",
    a2LevelHint: "Больше слов, простые придаточные",
    b1LevelTitle: "Самостоятельное использование",
    b1LevelHint: "Сложные предложения и грамматика",
    b2LevelTitle: "Продвинутый",
    b2LevelHint: "Длинные предложения и сложные тексты",
    c1c2LevelTitle: "Высший уровень",
    c1c2LevelHint: "Абстрактный и научный язык",
    videoLevelTitle: "Видео-диктанты",
    videoLevelHint: "Смотри настоящие видео и восстанавливай сказанное",
    videoShortsLabel: "Shorts",
    videoSentencesLabel: "Предложения",
    archLevelTitle: "Архитектура ПО",
    archLevelHint: "Профессиональная лексика и предложения B2–C1 для IT и инженерии",
    archVocabDesc: "130 терминов: проектирование, качество, оценка, инструменты.",
    archSentencesDesc: "52 предложения об архитектуре — грамматика на профессиональной лексике.",
    archSentencesHint: "Технический немецкий, грамматика B2–C1",
    archSourceNote: "Словарь собран по открытой книге «Basiswissen für Softwarearchitekten» (dpunkt.verlag). Примеры предложений — наши собственные.",
    dailyPhrasesLabel: "Фразы для дейли",
    dailyPhrasesDesc: "40 фраз для дейли: статус, блокеры, ревью, передача задач.",
    dailyPhrasesHint: "Вспомни и проверь себя",
    kollokationenLabel: "Коллокации",
    kollokationenHint: "Устойчивые сочетания слов — уровень B2",
    kollokationenDesc: "130 сочетаний: глагольно-именные обороты, прилагательное + существительное, устойчивые выражения.",
    vocabLabel: "Словарь",
    buildSentencesLabel: "Составь предложения",
    articlesLabel: "Артикли",
    allVocabLabel: "Весь словарь",
    soonText: "Скоро",
    wordsSubLabel: "Слова",
    wordsSoonHint: "Скоро по темам (тегам)",
    sentencesSubLabel: "Составь предложения",
    sentencesByTagHint: "По грамматическим темам (тегам)",
    grammarSubLabel: "Грамматика",
    grammarSubHint: "Структуры и артикли",
    relativsatzTitle: "Артикль в придаточном",
    relativsatzDesc: "Вставь der/die/das/den/dem/dessen …",
    mixedLabel: (lvl) => `${lvl} Смешанный`,
    passivLabel: "Пассивный залог",
    prepLabel: "Предлоги",
    tagDesc: (tag) => ({
        "als": "Прошлые события с als (однократные).",
        "bedingung": "Условные предложения: wenn, falls.",
        "bevor": "Временные придаточные с bevor (до того как).",
        "bis": "Временные придаточные с bis (пока не).",
        "damit": "Целевые придаточные с damit.",
        "dass": "Придаточные с dass.",
        "dass-satz": "Придаточные с dass.",
        "dativ": "Предложения с дативом.",
        "finalsatz": "Цель: damit, um … zu.",
        "indirekte_frage": "Косвенные вопросы с ob, wann, wo.",
        "indirekte_rede": "Косвенная речь с Konjunktiv I.",
        "inversion": "Обратный порядок слов после наречий.",
        "irrealis": "Нереальные условия: Konjunktiv II.",
        "kausalsatz": "Причина: weil, da.",
        "komparativ": "Сравнения: als, wie, je … desto.",
        "konditionalsatz": "Сложные условия: falls, sofern.",
        "konjunktiv_ii": "Konjunktiv II: желания и вежливость.",
        "konjunktiv_ii_perfekt": "Konjunktiv II в прошедшем времени.",
        "konnektoren": "Коннекторы: trotzdem, deshalb, außerdem.",
        "konzession": "Уступка: obwohl, trotzdem.",
        "konzessivsatz": "Уступительные придаточные: obgleich, auch wenn.",
        "modal": "Модальные глаголы: können, müssen, sollen.",
        "modalverben": "Предложения с модальными глаголами: können, müssen, wollen.",
        "modalsatz": "Модальные придаточные: indem, ohne … zu.",
        "nachdem": "Последовательность с nachdem (после того как).",
        "nebensatz": "Порядок слов в придаточных предложениях.",
        "nomen_verb": "Устойчивые сочетания (Funktionsverben).",
        "nominalisierung": "Номинализация глаголов и прилагательных.",
        "wortschatz": "Простые предложения с лексикой уровня B2.",
        "frage": "Типичные вопросы собеседования.",
        "antwort": "Образцовые ответы для собеседования.",
        "ob": "Косвенные вопросы с ob (ли).",
        "obwohl": "Уступительные придаточные с obwohl (хотя).",
        "partizip": "Причастные конструкции (Partizip I/II).",
        "passiv": "Пассив: werden + Partizip II.",
        "perfekt": "Перфект с haben/sein.",
        "plural": "Множественное число в контексте.",
        "praepositionen": "Предлоги с правильным падежом.",
        "praeteritum": "Претеритум (простое прошедшее).",
        "reflexiv": "Возвратные глаголы: sich + Akk./Dat.",
        "relativsatz": "Придаточные определительные с der/die/das.",
        "sein-aux": "Перфект с sein в роли вспомогательного.",
        "seit": "Продолжающиеся ситуации с seit (с тех пор как).",
        "solange": "Длительность с solange (пока).",
        "temporalsatz": "Временные придаточные: als, nachdem, bevor, seit, während.",
        "waehrend": "Одновременные действия с während.",
        "wann": "Косвенные вопросы с wann (когда).",
        "weil": "Причинные придаточные с weil (потому что).",
        "umfahren": "Отделяемый: сбить (fährt … um). Неотделяемый: объехать (umfährt).",
        "umfliegen": "Отделяемый: упасть (fliegt … um). Неотделяемый: облетать (umfliegt).",
        "umgehen": "Отделяемый: справляться с (geht … um). Неотделяемый: обходить (umgeht).",
        "umschreiben": "Отделяемый: переписать (schreibt … um). Неотделяемый: перефразировать (umschreibt).",
        "umstellen": "Отделяемый: переставить (stellt … um). Неотделяемый: окружить (umstellt).",
        "wenn": "Условные/временные придаточные с wenn (если/когда).",
    }[tag] || "Предложения по грамматической теме."),
    levelLabel: "Уровень",

    artikelTitle: "Какой артикль?",
    artikelNoData: "Нет данных.",
    artikelCorrect: "Правильно!",
    artikelWrong: (c) => `Неверно. Правильно: ${c}`,

    titleLangSelect: "DrillCards — Тренируй немецкий до автоматизма",
    titleHome: "Дойч-Тренер — DrillCards",
    titleVocab: "Словарь — DrillCards",
    titleSentences: "Составь предложения — DrillCards",
    titleGaps: "Вставь слово — DrillCards",
    titleArticles: "Артикли — DrillCards",
    topicLabel: "Тема",
    a1VocabDesc: "Существительные, глаголы, прилагательные.",
    a1SentencesDesc: "Расставь слова в правильном порядке.",
    artikelLevelDesc: (lvl) => `der / die / das — выбери артикль для существительных ${lvl}.`,
    a2VocabDesc: "Бытовой словарь A2 в виде карточек.",
    a2SentencesDesc: "Предложения с weil, dass, wenn.",
    b1AllVocabDesc: "Словарь B1. Скоро фильтр по темам.",
    b2VocabDesc: "Абстрактный и академический словарь B2 в виде карточек.",
    b1MixedDesc: "Все грамматические темы вперемешку.",
    b2SentencesDesc: "Konjunktiv II, Passiv, Konnektoren.",
    c1SentencesDesc: "Конъюнктив, причастные обороты.",
    c2SentencesDesc: "Научный стиль, номинализация.",
    c1c2VocabDesc: "Продвинутая лексика: абстрактные существительные, точные глаголы, оттенки прилагательных.",
    c1c2PrepDesc: "Предлоги с Dativ / Akkusativ (скоро).",

    speechHelpTitle: "Помощь с озвучиванием",
    privacyLink: "Политика конфиденциальности",
    privacyTitle: "Политика конфиденциальности",
    privacyLastUpdated: "Последнее обновление: июнь 2026",
    privacyIntro: "DrillCards — бесплатный тренажёр немецкого языка. Мы уважаем вашу конфиденциальность и собираем минимум данных.",
    privacyGoogleTitle: "Вход через Google",
    privacyGoogleBody: "При входе через Google мы получаем ваше имя, адрес электронной почты и фото профиля. Эти данные используются только для отображения аккаунта в приложении и привязки прогресса упражнений к вашей учётной записи. Мы не передаём эти данные третьим лицам. Использование данных, полученных через Google API, соответствует <a href=\"https://developers.google.com/terms/api-services-user-data-policy\" target=\"_blank\" rel=\"noopener\">Политике использования данных Google API</a>, включая требования ограниченного использования.",
    privacyStorageTitle: "Локальное хранение данных",
    privacyStorageBody: "Прогресс упражнений, язык интерфейса и тема оформления хранятся в localStorage вашего браузера. Эти данные не покидают ваше устройство, пока вы не авторизуетесь.",
    privacySyncTitle: "Синхронизация прогресса",
    privacySyncBody: "При входе в аккаунт ваш прогресс (тип упражнения, уровень, ID задания, количество правильных/неправильных ответов) синхронизируется с нашей базой данных (Supabase) и привязывается к вашему Google-аккаунту. Это позволяет продолжить занятия на другом устройстве.",
    privacyAnalyticsTitle: "Аналитика",
    privacyAnalyticsBody: "Мы используем GoatCounter — инструмент аналитики, который не использует куки, не отслеживает пользователей между сайтами и не собирает персональные данные. Он только считает просмотры страниц.",
    privacyNoCookiesTitle: "Без куки",
    privacyNoCookiesBody: "Это приложение не использует куки (cookies). Все данные на стороне клиента хранятся в localStorage.",
    privacyDeletionTitle: "Удаление данных",
    privacyDeletionBody: "Вы можете выйти из аккаунта в любое время, чтобы прекратить синхронизацию. Для удаления локальных данных очистите данные сайта в браузере. Для удаления синхронизированных данных напишите на <a href=\"mailto:alexey.dudchenko@gmail.com\">alexey.dudchenko@gmail.com</a>.",
    privacyContactTitle: "Контакты",
    privacyContactBody: "Если у вас есть вопросы по этой политике, свяжитесь с нами: <a href=\"mailto:alexey.dudchenko@gmail.com\">alexey.dudchenko@gmail.com</a>.",
    videoDictTitle: "Видео-диктант",
    videoDictHint: "Смотри видео и собери или напечатай фразу.",
    videoDictCorrect: "Правильно!",
    videoDictWrong: (a) => `Неверно. Правильно: ${a}`,
    videoDictBack: "Назад",
    videoDictReplay: "Повтор",
    videoDictResume: "Продолжить",
    videoDictFinished: "Все фрагменты пройдены!",
    videoDictRestart: "Начать сначала",
    videoDictLoading: "Загрузка видео…",
    videoDictError: "Не удалось загрузить видео.",
    videoDictLabel: "Видео-диктант",
    titleVideoDict: "Видео-диктант — DrillCards",

    passivGapTitle: "Пассив: вспомогательные глаголы",
    passivGapHint: "Выбери вспомогательные глаголы пассива.",
    passivGapCorrect: "Правильно!",
    passivGapWrong: (_answers) => "Неверно. Попробуй ещё.",
    titlePassivGap: "Пассив: вспомогательные глаголы — DrillCards",
    passivGapDesc: "Выбери вспомогательные глаголы для Vorgangspassiv.",
    passivGapModeSelect: "Выбрать",
    passivGapModeType: "Напечатать",
    passivGapShowHint: "Подсказка",
    passivGapAnswer: (answers) => `Ответ: ${answers.join(" + ")}`,

    kasusLabel: "Аккузатив и датив",
    kasusTitle: "Аккузатив или датив?",
    kasusDesc: "Вставь пропущенный артикль, определи падеж, подбери нужный вопрос.",
    titleKasus: "Аккузатив и датив — DrillCards",
    kasusCorrect: "Правильно!",
    kasusWrong: (answer) => `Неверно. Правильно: ${answer}`,
    kasusTaskArticle: "Какой артикль подходит в пропуск?",
    kasusTaskCase: "В каком падеже выделенная группа слов?",
    kasusTaskQuestion: "На какой вопрос отвечает выделенная группа слов?",
    kasusTypeAll: "Все",
    kasusTypeArticle: "Артикль",
    kasusTypeCase: "Падеж",
    kasusTypeQuestion: "Вопрос",
    kasusRuleOpen: "Правило",
    kasusRuleClose: "Закрыть",

    dailyToday: "Сегодня",
    streakDay: "день",
    streakDays: "дн.",

    srsDone: "Готово!",
    srsDoneBody: (n) => `Повторено карточек: ${n}.`,
    srsPracticeMore: "Ещё потренироваться",
    srsNewMore: "Учить новые слова",
    srsPracticeLabel: "доп. практика",
    srsRemaining: "осталось",
    srsDueLabel: (n) => `${n} к повтор.`,
    srsLearnedLabel: (n, total) => `${n}/${total} выучено`,
    vocabSrsHint: (lvl) => `Интервальные повторения · словарь ${lvl}`,

    prodVocabLabel: "Письмо",
    prodVocabDesc: "Видишь перевод — напиши немецкое слово, существительные с артиклем.",
    revVocabLabel: "Наоборот",
    revVocabDesc: "Видишь перевод — выбери немецкое слово из четырёх вариантов.",
    learnVocabLabel: "Сессия изучения",
    srsMarkLearned: "✓ Выучил",
    srsMarkDifficult: "★ Сложное",
    srsMore: "Подробнее: примеры и однокоренные",
    collocationsLabel: "В реальных текстах:",
    conjugationLink: "Спряжение",
    srsFamily: "Однокоренные слова",
    srsSynonyms: "Синонимы",
    srsAntonyms: "Антонимы",
    srsWendungen: "Устойчивые выражения",
    posNounLabel: "Существительные",
    posVerbLabel: "Глаголы",
    posAdjLabel: "Прилагательные",
    posLearnDesc: "Сессия изучения по части речи — DE→перевод, потом наоборот.",
    prodWrong: "Неверно. Правильный ответ:",

    titleWordCard: (word, level) => `${word} — словарь ${level} · DrillCards`,
    cardLearnCta: (level) => `Учить слова ${level}`,
    cardDeckCta: (level) => `Открыть словарь ${level}`,
    shareWord: "Поделиться словом",
    linkCopied: "Ссылка скопирована",

    titleLevelTest: "Словарный тест уровня — DrillCards",
    levelTestLabel: "Тест уровня",
    levelTestHint: "Не знаете, с чего начать? Определите уровень за ~3 минуты.",
    levelTestPick: "Выберите правильный перевод",
    levelTestResultTitle: "Ваш уровень",
    levelTestStartWith: (lvl) => `Начать с ${lvl}`,
    levelTestRetake: "Пройти ещё раз",
    levelTestBannerKnown: (lvl) => `Ваш уровень ≈ ${lvl} · пройти ещё раз`,

    telegramTitle: "WunderWords в Telegram",
    telegramDesc: "Отсканируйте QR-код или нажмите, чтобы открыть канал.",
    telegramQrAlt: "QR-код на Telegram-канал WunderWords",

    installText: "Установите DrillCards — быстрый доступ и занятия офлайн.",
    installButton: "Установить",
    installDismiss: "Позже",
    installIosHint: "Чтобы установить: нажмите «Поделиться», затем «На экран „Домой“».",

    otherLevelBadge: "★",
    otherLevelTitle: "Другое",
    otherLevelHint: "Лексика для собеседования — IT и консалтинг",
    berufVocabLabel: "Слова для интервью",
    berufVocabDesc: "До 20 слов за сессию — сначала DE→перевод, потом наоборот.",
    berufVocabHint: "Интервальные повторения · слова интервью",
    berufSentencesLabel: "Фразы интервью",
    berufSentencesDesc: "Типовые вопросы и образцовые ответы на собеседовании.",
    berufSentencesHint: "Вопросы и ответы",
    berufPhrasesLabel: "Речевые клише",
    berufPhrasesDesc: "Готовые фразы, чтобы выиграть время и структурировать ответ.",
    berufPhrasesHint: "Вспомни и проверь себя",
    phrasesReveal: "Показать фразу",
    phraseKnew: "✓ Знал",
    phraseUnknown: "✗ Не знал",
};

const DE: Translations = {
    sessionUi: {
        title: "Übungseinheit", exercise: "Übung", intent: "Wörter", learnNew: "Neue lernen", reviewDue: "Fällige wiederholen", translation: "Übersetzungssprache", interfaceLanguage: "Sprache der Oberfläche",
        start: "Starten", next: "Weiter", pause: "Pause", resume: "Fortsetzen", finish: "Beenden", retry: "Erneut speichern",
        progress: "Aufgabe {n} von {total}", paused: "Einheit pausiert. Deine Antworten sind gespeichert.", completed: "Einheit abgeschlossen. Alle Antworten sind gespeichert.", abandoned: "Einheit vorzeitig beendet. Deine Antworten sind gespeichert.",
        saveError: "Speichern fehlgeschlagen. Nichts ist verloren: versuche es erneut.", conflict: "Die Einheit wurde in einem anderen Tab geändert. Der gespeicherte Stand wird angezeigt.",
        noNewWords: "In diesem Deck gibt es keine neuen Wörter mehr.", noDueWords: "Noch keine Wörter zur Wiederholung fällig.", noApplicableTasks: "Diese Übung ist für die gewählten Wörter nicht verfügbar.", loadError: "Lokaler Speicher konnte nicht geöffnet werden.",
        format: "Format", single: "Eine Übung", circuit: "Komplett", scope: "Wiederholung", allExercises: "Alle Übungen", dueComponents: "Nur Fälliges",
        correctionRound: "Fehler wiederholen", summaryTitle: "Zusammenfassung", summaryTotals: "Aufgaben: {tasks} · Antworten: {answered} · Fehler: {mistakes}", recognitionComponent: "Wiedererkennen",
        resultCorrect: "richtig", resultIncorrect: "Fehler", resultCorrected: "korrigiert", resultUnobserved: "nicht geprüft",
        mistakes: "Fehler", noMistakes: "Keine Fehler", mistakeLine: "Deine Antwort: {given} · richtig: {expected}", corrected: "korrigiert", notCorrected: "noch nicht korrigiert",
    },
    homeUi: {
        homeTitle: "Wörter",
        searchDecks: "Deck suchen",
        deckCounts: "{total} Wörter · begonnen {started}",
        noDecks: "Keine Decks gefunden.",
        loading: "Wird geladen…",
        catalogError: "Der Wortkatalog konnte nicht geladen werden.",
        deckNotFound: "Deck nicht gefunden.",
        wordNotFound: "Wort nicht im Katalog gefunden.",
        allDecks: "← Alle Decks",
        backToDeck: "← Zum Deck",
        toDeck: "Zum Deck",
        continueTitle: "Unbeendete Einheit",
        continueLine: "{deck} · Aufgabe {n} von {total}",
        continueAction: "Einheit fortsetzen",
        openSessionBlocks: "Setze zuerst die unbeendete Einheit fort oder beende sie.",
        deckStats: "Wörter: {total} · begonnen: {started} · neu: {fresh} · fällig: {due}",
        learnNewCount: "Neue lernen ({n})",
        reviewDueCount: "Fällige wiederholen ({n})",
        emptyAllStarted: "Alle Wörter dieses Decks sind begonnen, neue gibt es nicht. Wiederhole fällige Wörter oder wähle ein anderes Deck.",
        emptyNoTranslation: "Die übrigen neuen Wörter haben noch keine Übersetzung in die gewählte Sprache.",
        emptyNewNotForExercise: "Für diese Übung gibt es keine neuen Wörter. Wähle eine andere Übung oder das Komplettpaket.",
        emptyNothingStarted: "Noch nichts zu wiederholen: lerne zuerst neue Wörter.",
        emptyDueNotForExercise: "Es sind Wörter fällig, aber nicht für diese Übung. Wähle eine andere Übung oder das Komplettpaket.",
        emptyNotDueYet: "Gerade ist nichts fällig.",
        nextDue: "Nächste Wiederholung: {date}.",
        wordsHeading: "Wörter im Deck",
        searchWords: "Wort suchen",
        noWords: "Keine Wörter gefunden.",
        stateNew: "neu",
        stateLearning: "im Lernen",
        stateScheduled: "geplant",
        stateDue: "fällig",
        stageUnintroduced: "nicht begonnen",
        stageLearning: "im Lernen",
        stageReview: "in Wiederholung",
        stageRelearning: "neu im Lernen",
        progressHeading: "Fortschritt",
        notStarted: "Dieses Wort ist noch nicht begonnen.",
        dueNow: "jetzt fällig",
        dueOn: "Wiederholung {date}",
        sharedProgress: "Der Fortschritt eines Wortes gilt in allen Decks, die es enthalten. Auch bekannte Wörter kommen zur Wiederholung zurück: das Gedächtnis lässt mit der Zeit nach.",
        inDecks: "In Decks:",
        stateUnsettled: "nicht gefestigt",
        stateLearned: "gelernt",
        statusDetails: "Fortschritt je Übung",
        wordFilters: ["Alle", "Jetzt fällig", "Neu", "Im Lernen", "Nicht gefestigt", "Gelernt"], wordSorts: ["Reihenfolge im Deck", "Alphabetisch A–Z", "Schwächste zuerst", "Gelernte zuerst"], wordParts: ["Alle Wortarten", "Nomen", "Verben", "Adjektive", "Adverbien", "Andere"], wordSortLabel: "Sortierung", wordPartLabel: "Wortart", wordResults: "{shown} von {total} Wörtern", openWord: "Wortkarte öffnen →",
        statusRule: "Ein Wort gilt als gelernt, wenn jede Komponente mindestens {reviews} Wiederholungen und eine Gedächtnisstabilität von {days} Tagen hat.",
        statusStability: "Stabilität {days} T. von {need} T.",
        statusAssesses: "Trainiert: {components}",
        statusDone: "fertig",
        statusNoArticle: "nicht verfügbar: kein Artikel",
        statusNoTranslation: "nicht verfügbar: keine Übersetzung",
    },
    cardUi: {
        tokensTitle: "Antwort zusammensetzen", sentenceAssemblyTitle: "Bilde den Satz", konjunktivTokenTitle: "Ergänze die Lücke im Konjunktiv II",
        tokenAnswer: "Deine Antwort", tokenPool: "Wörter", tokenEmpty: "Tippe auf Wörter oder ziehe sie hierher", tokenReset: "Zurücksetzen",
        tokenHint: "Enter fügt ein Wort hinzu oder nimmt es zurück, Umschalt+Pfeile verschieben es, Rücktaste nimmt es zurück.",
        wordTypeTitle: "Gib das deutsche Wort ohne Artikel ein", wordArticleTypeTitle: "Gib das deutsche Wort mit Artikel ein", articleTitle: "Wähle den Artikel", articleUnavailable: "Artikelübungen benötigen ein Nomen mit bekanntem Artikel.", recallComponent: "Wortabruf", spellingComponent: "Schreibweise", articleComponent: "Artikel", unobserved: "Nicht bewertet", expectedAnswer: "Erwartete Antwort",
        introductionTitle: "Lerne das Wort kennen", continue: "Weiter", readyToContinue: "Bereit zum Fortfahren", insufficientOptions: "Nicht genug eindeutige Antwortmöglichkeiten. Wähle eine andere Übung.", exerciseUnavailable: "Diese Übung ist für dieses Wort nicht verfügbar.",
        choiceTitle: "Wähle die Antwort", textTitle: "Gib die Antwort ein", revealTitle: "Erinnere dich und prüfe",
        choose: "Wähle eine Option", yourAnswer: "Deine Antwort", submit: "Prüfen", next: "Weiter", reveal: "Antwort zeigen",
        remembered: "Gewusst", forgotten: "Nicht gewusst", showDetails: "Wortdetails", hideDetails: "Details ausblenden",
        wordDetails: "Wortdetails", examples: "Beispiele", missingTranslation: "Keine bestätigte Übersetzung", listen: "Auf Deutsch anhören", autoReadWords: "Wörter automatisch vorlesen",
        ttsUnavailable: "Die Sprachausgabe ist auf diesem Gerät nicht verfügbar.", ttsNoVoice: "Installiere eine deutsche Stimme in den Geräteeinstellungen.",
        ttsFailed: "Die Wiedergabe ist fehlgeschlagen. Versuche es erneut.", saving: "Bitte warten…", submitted: "Antwort angenommen",
        error: "Die Aktion konnte nicht ausgeführt werden. Versuche es erneut.", correct: "Richtig", incorrect: "Nicht ganz", info: "Antwort angenommen",
        clozeTitle: "Fülle die Lücken aus", clozeSlot: "Lücke {n} von {total}", clozeEmpty: "leer", clozeReset: "Antworten löschen", clozeResults: "Ergebnis pro Lücke", clozeSlotCorrect: "richtig", clozeSlotIncorrect: "nicht ganz",
    },
    check: "Prüfen",
    next: "Weiter",
    previous: "Zurück",
    reset: "Zurücksetzen",
    noData: "Keine Daten.",
    comingSoon: "Bald verfügbar",
    comingSoonBody: "Dieser Bereich wird bald hinzugefügt.",
    backHome: "Zur Startseite",
    pageNotFound: "Seite nicht gefunden",
    homeLabel: "Start",

    showTranslation: "Übersetzung anzeigen",

    gapTitle: "Fehlendes Wort eingeben",
    gapPlaceholder: "Wort eingeben",
    gapCorrect: "Richtig!",
    gapWrong: (_a) => "Falsch. Versuch es nochmal.",
    hintReveal: (a) => `Antwort: ${a}`,

    sentenceTitle: "Satz bilden",
    sentenceCorrect: "Richtig!",
    sentenceWrong: (_t) => "Nicht ganz. Versuch es nochmal.",
    sentenceVariation: "Variante",

    hoerenTitle: "Hören & bauen",
    hoerenLabel: "Hören",
    hoerenPlayAgain: "Nochmal",
    hoerenModeDrag: "Ziehen",
    hoerenModeType: "Tippen",
    hoerenNoTTS: "Ihr Browser unterstützt keine Sprachsynthese.",
    hoerenPlaceholder: "Tippe, was du gehört hast",
    hoerenCorrect: "Richtig!",
    hoerenWrong: (t) => `Nicht ganz. Richtig: ${t}`,
    hoerenDesc: "Hör zu und baue den Satz.",
    titleHoeren: "Hören — DrillCards",
    noGermanVoiceWarn: "Auf diesem Gerät wurde keine deutsche Stimme gefunden — die Wiedergabe kann falsch klingen. Installiere eine deutsche Vorlesestimme in den Systemeinstellungen (Android: Google-TTS-Sprachdaten · iOS: Einstellungen → Bedienungshilfen → Gesprochene Inhalte → Stimmen · Windows: deutsches Sprachpaket).",

    k2TransformTitle: "Konjunktiv II: Umformung",
    k2TransformHint: "Setze das Verb in den Konjunktiv II.",
    k2Placeholder: "Konjunktiv-II-Form eingeben",
    k2Correct: "Richtig!",
    k2Wrong: (a) => `Falsch. Richtig: ${a}`,
    k2Desc: "Verben in den Konjunktiv II umformen.",
    k2ModeDrag: "Ziehen",
    k2ModeType: "Tippen",
    titleKonjunktiv2: "Konjunktiv II — DrillCards",
    k2HubTitle: "Konjunktiv II",
    k2HubDesc: "Alle Konjunktiv-II-Formen üben.",
    k2ConditionalTitle: "K2: Bedingungssätze",
    k2ConditionalHint: "Fülle beide Konjunktiv-II-Formen aus (kommagetrennt).",
    k2ConditionalDesc: "Wenn-dann-Sätze mit Konjunktiv II.",
    k2PoliteTitle: "K2: Höflichkeitsformen",
    k2PoliteHint: "Setze das Verb in die höfliche Konjunktiv-II-Form.",
    k2PoliteDesc: "Höfliche Bitten und Vorschläge.",
    k2PastTitle: "K2: Irreale Vergangenheit",
    k2PastHint: "Bilde den Konjunktiv II Perfekt (z.B. gewusst hätte).",
    k2PastDesc: "Hypothetische Vergangenheit mit Konjunktiv II.",

    chooseLanguagePair: "Sprachpaar wählen",
    tagline: "Lerne deutsche Karten, bis es automatisch geht",
    ruToDeDesc: "Russisch → Deutsch · A1–B2",

    homeTitle: "Deutsch-Trainer",
    homeSubtitle: "Wähle dein Niveau und eine Übung.",
    a1LevelTitle: "Erste Schritte",
    a1LevelHint: "Grundwortschatz & einfache Sätze",
    a2LevelTitle: "Grundlagen vertiefen",
    a2LevelHint: "Mehr Wortschatz, einfache Nebensätze",
    b1LevelTitle: "Selbstständige Sprachverwendung",
    b1LevelHint: "Komplexere Sätze & Grammatik",
    b2LevelTitle: "Fortgeschritten",
    b2LevelHint: "Längere Sätze & anspruchsvollere Texte",
    c1c2LevelTitle: "Sehr fortgeschritten",
    c1c2LevelHint: "Abstrakte & wissenschaftliche Sprache",
    videoLevelTitle: "Video-Diktat",
    videoLevelHint: "Schau echte Videos und rekonstruiere das Gesagte",
    videoShortsLabel: "Shorts",
    videoSentencesLabel: "Sätze",
    archLevelTitle: "Softwarearchitektur",
    archLevelHint: "Fachwortschatz und Sätze B2–C1 für IT und Technik",
    archVocabDesc: "130 Fachbegriffe: Entwurf, Qualität, Bewertung, Werkzeuge.",
    archSentencesDesc: "52 Sätze aus der Architekturarbeit — Grammatik am Fachwortschatz geübt.",
    archSentencesHint: "Fachsprache, Grammatik B2–C1",
    archSourceNote: "Wortschatz gesammelt aus dem Openbook „Basiswissen für Softwarearchitekten“ (dpunkt.verlag). Die Beispielsätze stammen von uns.",
    dailyPhrasesLabel: "Redemittel fürs Daily",
    dailyPhrasesDesc: "40 Redemittel fürs Daily: Stand, Blocker, Code-Review, Übergabe.",
    dailyPhrasesHint: "Erinnern & selbst prüfen",
    kollokationenLabel: "Kollokationen",
    kollokationenHint: "Wortverbindungen, die wirklich zusammengehören — B2",
    kollokationenDesc: "130 Wortverbindungen: Nomen-Verb-Verbindungen, Adjektiv + Nomen, feste Wendungen.",
    vocabLabel: "Wortschatz",
    buildSentencesLabel: "Sätze bauen",
    articlesLabel: "Artikel",
    allVocabLabel: "Gesamter Wortschatz",
    soonText: "Bald verfügbar",
    wordsSubLabel: "Wörter",
    wordsSoonHint: "Bald nach Themen (Tags)",
    sentencesSubLabel: "Sätze bauen",
    sentencesByTagHint: "nach Grammatik-Themen (Tags)",
    grammarSubLabel: "Grammatik",
    grammarSubHint: "Strukturen & Artikel",
    relativsatzTitle: "Artikel im Relativsatz",
    relativsatzDesc: "der/die/das/den/dem/dessen … einsetzen",
    mixedLabel: (lvl) => `${lvl} Gemischt`,
    passivLabel: "Passiv",
    prepLabel: "Präpositionen",
    tagDesc: (tag) => ({
        "als": "Vergangene Ereignisse mit als (einmalig).",
        "bedingung": "Bedingungssätze: wenn, falls.",
        "bevor": "Temporalsätze mit bevor.",
        "bis": "Temporalsätze mit bis.",
        "damit": "Finalsätze mit damit.",
        "dass": "Nebensätze mit dass.",
        "dass-satz": "Nebensätze mit dass.",
        "dativ": "Sätze mit Dativobjekten.",
        "finalsatz": "Finalsätze: damit, um … zu.",
        "indirekte_frage": "Indirekte Fragen mit ob, wann, wo.",
        "indirekte_rede": "Indirekte Rede mit Konjunktiv I.",
        "inversion": "Umgekehrte Wortstellung nach Adverbien.",
        "irrealis": "Irreale Bedingungen: Konjunktiv II.",
        "kausalsatz": "Kausalsätze: weil, da.",
        "komparativ": "Vergleiche: als, wie, je … desto.",
        "konditionalsatz": "Komplexe Bedingungen: falls, sofern.",
        "konjunktiv_ii": "Konjunktiv II: Wünsche & Höflichkeit.",
        "konjunktiv_ii_perfekt": "Konjunktiv II in der Vergangenheit.",
        "konnektoren": "Konnektoren: trotzdem, deshalb, außerdem.",
        "konzession": "Konzessivsätze: obwohl, trotzdem.",
        "konzessivsatz": "Konzessive Nebensätze: obgleich, auch wenn.",
        "modal": "Modalverben: können, müssen, sollen.",
        "modalverben": "Sätze mit Modalverben: können, müssen, wollen.",
        "modalsatz": "Modalsätze: indem, ohne … zu.",
        "nachdem": "Zeitliche Abfolge mit nachdem.",
        "nebensatz": "Allgemeine Nebensatz-Wortstellung.",
        "nomen_verb": "Nomen-Verb-Verbindungen (Funktionsverben).",
        "nominalisierung": "Nominalisierung von Verben und Adjektiven.",
        "wortschatz": "Einfache Sätze mit B2-Wortschatz.",
        "frage": "Typische Fragen im Vorstellungsgespräch.",
        "antwort": "Musterantworten fürs Vorstellungsgespräch.",
        "ob": "Indirekte Ja/Nein-Fragen mit ob.",
        "obwohl": "Konzessivsätze mit obwohl.",
        "partizip": "Partizipialkonstruktionen (Partizip I/II).",
        "passiv": "Passiv: werden + Partizip II.",
        "perfekt": "Perfekt mit haben/sein.",
        "plural": "Pluralformen im Kontext.",
        "praepositionen": "Präpositionen mit dem richtigen Kasus.",
        "praeteritum": "Präteritum-Formen.",
        "reflexiv": "Reflexive Verben: sich + Akk./Dat.",
        "relativsatz": "Relativsätze mit der/die/das.",
        "sein-aux": "Perfekt mit sein als Hilfsverb.",
        "seit": "Andauernde Situationen mit seit.",
        "solange": "Dauer mit solange.",
        "temporalsatz": "Temporalsätze: als, nachdem, bevor, seit, während.",
        "waehrend": "Gleichzeitige Handlungen mit während.",
        "wann": "Indirekte Fragen mit wann.",
        "weil": "Kausalsätze mit weil.",
        "umfahren": "Trennbar: umstoßen (fährt … um). Untrennbar: herumfahren (umfährt).",
        "umfliegen": "Trennbar: umkippen (fliegt … um). Untrennbar: herumfliegen (umfliegt).",
        "umgehen": "Trennbar: mit etw. umgehen (geht … um). Untrennbar: etw. vermeiden (umgeht).",
        "umschreiben": "Trennbar: neu schreiben (schreibt … um). Untrennbar: paraphrasieren (umschreibt).",
        "umstellen": "Trennbar: umräumen (stellt … um). Untrennbar: umzingeln (umstellt).",
        "wenn": "Konditionale/temporale Sätze mit wenn.",
    }[tag] || "Sätze nach Grammatikthema gefiltert."),
    levelLabel: "Niveau",

    artikelTitle: "Welcher Artikel?",
    artikelNoData: "Keine Daten.",
    artikelCorrect: "Richtig!",
    artikelWrong: (c) => `Falsch. Richtig: ${c}`,

    titleLangSelect: "DrillCards — Deutsche Karten bis es sitzt",
    titleHome: "Deutsch-Trainer — DrillCards",
    titleVocab: "Wortschatz — DrillCards",
    titleSentences: "Sätze bauen — DrillCards",
    titleGaps: "Fehlendes Wort — DrillCards",
    titleArticles: "Artikel — DrillCards",
    topicLabel: "Thema",
    a1VocabDesc: "Nomen, Verben, Adjektive.",
    a1SentencesDesc: "Wörter in die richtige Reihenfolge ziehen.",
    artikelLevelDesc: (lvl) => `der / die / das — den richtigen Artikel für ${lvl}-Nomen wählen.`,
    a2VocabDesc: "Alltagswortschatz A2 als Karteikarten.",
    a2SentencesDesc: "Sätze mit weil-, dass-, wenn-Nebensätzen.",
    b1AllVocabDesc: "B1-Wortschatz. Themenfilter kommt bald.",
    b2VocabDesc: "Abstrakter & akademischer B2-Wortschatz als Karteikarten.",
    b1MixedDesc: "Alle Grammatikthemen gemischt.",
    b2SentencesDesc: "Konjunktiv II, Passiv, Konnektoren.",
    c1SentencesDesc: "Konjunktiv, Partizipialkonstruktionen.",
    c2SentencesDesc: "Wissenschaftsstil, Nominalisierung.",
    c1c2VocabDesc: "Fortgeschrittener Wortschatz: abstrakte Nomen, präzise Verben, feine Adjektive.",
    c1c2PrepDesc: "Präpositionen mit Dativ / Akkusativ (bald verfügbar).",

    speechHelpTitle: "Hilfe zum Vorlesen (Russisch)",
    privacyLink: "Datenschutz",
    privacyTitle: "Datenschutzerklärung",
    privacyLastUpdated: "Letzte Aktualisierung: Juni 2026",
    privacyIntro: "DrillCards ist ein kostenloser Deutsch-Trainer. Wir respektieren Ihre Privatsphäre und erheben so wenig Daten wie möglich.",
    privacyGoogleTitle: "Google-Anmeldung",
    privacyGoogleBody: "Wenn Sie sich mit Google anmelden, erhalten wir Ihren Namen, Ihre E-Mail-Adresse und Ihr Profilbild. Diese Daten werden ausschließlich zur Anzeige Ihres Kontos in der App und zur Zuordnung Ihres Übungsfortschritts verwendet. Wir geben diese Daten nicht an Dritte weiter. Unsere Nutzung von Daten aus Google APIs entspricht der <a href=\"https://developers.google.com/terms/api-services-user-data-policy\" target=\"_blank\" rel=\"noopener\">Google API Services User Data Policy</a>, einschließlich der Anforderungen zur eingeschränkten Nutzung.",
    privacyStorageTitle: "Lokale Datenspeicherung",
    privacyStorageBody: "Ihr Übungsfortschritt, die Sprache der Benutzeroberfläche und das Design werden im localStorage Ihres Browsers gespeichert. Diese Daten verlassen Ihr Gerät nicht, solange Sie sich nicht anmelden.",
    privacySyncTitle: "Fortschrittssynchronisierung",
    privacySyncBody: "Wenn Sie angemeldet sind, wird Ihr Fortschritt (Übungstyp, Niveau, Aufgaben-ID, Anzahl richtiger/falscher Antworten) mit unserer Datenbank (Supabase) synchronisiert und mit Ihrem Google-Konto verknüpft. So können Sie Ihre Übungen auf anderen Geräten fortsetzen.",
    privacyAnalyticsTitle: "Webanalyse",
    privacyAnalyticsBody: "Wir verwenden GoatCounter, ein datenschutzfreundliches Analysetool, das keine Cookies verwendet, keine Nutzer über Websites hinweg verfolgt und keine personenbezogenen Daten erhebt. Es zählt nur Seitenaufrufe.",
    privacyNoCookiesTitle: "Keine Cookies",
    privacyNoCookiesBody: "Diese App verwendet keine Cookies. Alle clientseitigen Daten werden im localStorage gespeichert.",
    privacyDeletionTitle: "Datenlöschung",
    privacyDeletionBody: "Sie können sich jederzeit abmelden, um die Synchronisierung zu beenden. Um lokale Daten zu löschen, löschen Sie die Website-Daten in Ihrem Browser. Um die Löschung synchronisierter Daten zu beantragen, schreiben Sie an <a href=\"mailto:alexey.dudchenko@gmail.com\">alexey.dudchenko@gmail.com</a>.",
    privacyContactTitle: "Kontakt",
    privacyContactBody: "Bei Fragen zu dieser Datenschutzerklärung kontaktieren Sie uns unter <a href=\"mailto:alexey.dudchenko@gmail.com\">alexey.dudchenko@gmail.com</a>.",
    videoDictTitle: "Video-Diktat",
    videoDictHint: "Schau das Video und bilde oder tippe den Satz.",
    videoDictCorrect: "Richtig!",
    videoDictWrong: (a) => `Falsch. Richtig: ${a}`,
    videoDictBack: "Zurück",
    videoDictReplay: "Nochmal",
    videoDictResume: "Weiter",
    videoDictFinished: "Alle Abschnitte geschafft!",
    videoDictRestart: "Von vorne",
    videoDictLoading: "Video wird geladen…",
    videoDictError: "Video konnte nicht geladen werden.",
    videoDictLabel: "Video-Diktat",
    titleVideoDict: "Video-Diktat — DrillCards",

    passivGapTitle: "Passiv: Hilfsverben",
    passivGapHint: "Wähle die Hilfsverben für den Vorgangspassiv.",
    passivGapCorrect: "Richtig!",
    passivGapWrong: (_answers) => "Falsch. Versuch es nochmal.",
    titlePassivGap: "Passiv: Hilfsverben — DrillCards",
    passivGapDesc: "Wähle die Hilfsverben für den Vorgangspassiv.",
    passivGapModeSelect: "Auswählen",
    passivGapModeType: "Tippen",
    passivGapShowHint: "Tipp",
    passivGapAnswer: (answers) => `Antwort: ${answers.join(" + ")}`,

    kasusLabel: "Akkusativ & Dativ",
    kasusTitle: "Akkusativ oder Dativ?",
    kasusDesc: "Artikel einsetzen, Kasus bestimmen, die passende Frage wählen.",
    titleKasus: "Akkusativ & Dativ — DrillCards",
    kasusCorrect: "Richtig!",
    kasusWrong: (answer) => `Falsch. Richtig: ${answer}`,
    kasusTaskArticle: "Welcher Artikel passt in die Lücke?",
    kasusTaskCase: "In welchem Kasus steht die markierte Wortgruppe?",
    kasusTaskQuestion: "Auf welche Frage antwortet die markierte Wortgruppe?",
    kasusTypeAll: "Alle",
    kasusTypeArticle: "Artikel",
    kasusTypeCase: "Kasus",
    kasusTypeQuestion: "Frage",
    kasusRuleOpen: "Regel",
    kasusRuleClose: "Schließen",

    dailyToday: "Heute",
    streakDay: "Tag",
    streakDays: "Tage",

    srsDone: "Fertig!",
    srsDoneBody: (n) => `${n} Karte${n === 1 ? "" : "n"} wiederholt.`,
    srsPracticeMore: "Weiter üben",
    srsNewMore: "Neue Wörter lernen",
    srsPracticeLabel: "Extra-Übung",
    srsRemaining: "übrig",
    srsDueLabel: (n) => `${n} fällig`,
    srsLearnedLabel: (n, total) => `${n}/${total} gelernt`,
    vocabSrsHint: (lvl) => `Wiederholungssystem · ${lvl}-Wortschatz`,

    prodVocabLabel: "Schreiben",
    prodVocabDesc: "Übersetzung sehen, deutsches Wort schreiben — Nomen mit Artikel.",
    revVocabLabel: "Rückwärts",
    revVocabDesc: "Übersetzung sehen, das deutsche Wort aus vier Optionen wählen.",
    learnVocabLabel: "Lernsession",
    srsMarkLearned: "✓ Gelernt",
    srsMarkDifficult: "★ Schwer",
    srsMore: "Mehr: Beispiele & Wortfamilie",
    collocationsLabel: "In echten Texten:",
    conjugationLink: "Konjugation",
    srsFamily: "Wortfamilie",
    srsSynonyms: "Synonyme",
    srsAntonyms: "Antonyme",
    srsWendungen: "Wendungen",
    posNounLabel: "Substantive",
    posVerbLabel: "Verben",
    posAdjLabel: "Adjektive",
    posLearnDesc: "Lernsession nach Wortart — DE→Übersetzung, dann rückwärts.",
    prodWrong: "Falsch. Die richtige Antwort:",

    titleWordCard: (word, level) => `${word} — ${level}-Wortschatz · DrillCards`,
    cardLearnCta: (level) => `${level}-Wörter lernen`,
    cardDeckCta: (level) => `${level}-Wortschatz ansehen`,
    shareWord: "Wort teilen",
    linkCopied: "Link kopiert",

    titleLevelTest: "Wortschatz-Einstufungstest — DrillCards",
    levelTestLabel: "Einstufungstest",
    levelTestHint: "Unsicher, wo du anfangen sollst? Finde dein Niveau in ~3 Minuten.",
    levelTestPick: "Wähle die richtige Übersetzung",
    levelTestResultTitle: "Dein Niveau",
    levelTestStartWith: (lvl) => `Mit ${lvl} starten`,
    levelTestRetake: "Test wiederholen",
    levelTestBannerKnown: (lvl) => `Dein Niveau ≈ ${lvl} · erneut testen`,

    telegramTitle: "WunderWords auf Telegram",
    telegramDesc: "QR-Code scannen oder tippen, um den Kanal zu öffnen.",
    telegramQrAlt: "QR-Code zum Telegram-Kanal WunderWords",

    installText: "Installiere DrillCards für schnellen Zugriff und Üben offline.",
    installButton: "Installieren",
    installDismiss: "Später",
    installIosHint: "Zum Installieren: auf „Teilen“ tippen, dann „Zum Home-Bildschirm“.",

    otherLevelBadge: "★",
    otherLevelTitle: "Sonstiges",
    otherLevelHint: "Wortschatz fürs Vorstellungsgespräch — IT & Beratung",
    berufVocabLabel: "Interview-Wortschatz",
    berufVocabDesc: "Bis zu 20 Wörter pro Session — erst DE→Übersetzung, dann rückwärts.",
    berufVocabHint: "Wiederholungssystem · Interview-Wortschatz",
    berufSentencesLabel: "Interview-Sätze",
    berufSentencesDesc: "Typische Interview-Fragen und Musterantworten.",
    berufSentencesHint: "Fragen & Antworten",
    berufPhrasesLabel: "Redemittel",
    berufPhrasesDesc: "Fertige Redewendungen, um Zeit zu gewinnen und Antworten zu strukturieren.",
    berufPhrasesHint: "Erinnern & selbst prüfen",
    phrasesReveal: "Redewendung zeigen",
    phraseKnew: "✓ Gewusst",
    phraseUnknown: "✗ Nicht gewusst",
};

const TRANSLATIONS: Record<Lang, Translations> = { en: EN, ru: RU, de: DE };

let currentLang: Lang = "en";

export function initLang(): void {
    const stored = localStorage.getItem("ui_lang") as Lang | null;
    if (stored && stored in TRANSLATIONS) {
        currentLang = stored;
    }
}

export function setLang(lang: Lang): void {
    currentLang = lang;
    localStorage.setItem("ui_lang", lang);
}

export function getLang(): Lang {
    return currentLang;
}

export function t(): Translations {
    return TRANSLATIONS[currentLang];
}

export function cardUiTranslations(lang: Lang): CardUiTranslations {
    return TRANSLATIONS[lang].cardUi;
}

export function sessionUiTranslations(lang: Lang): SessionUiTranslations {
    return TRANSLATIONS[lang].sessionUi;
}

export function homeUiTranslations(lang: Lang): HomeUiTranslations {
    return TRANSLATIONS[lang].homeUi;
}

let currentSourceLang: SourceLang = "ru";

export function initSourceLang(): void {
    const stored = localStorage.getItem("source_lang") as SourceLang | null;
    if (stored === "en" || stored === "ru") {
        currentSourceLang = stored;
    }
}

export function setSourceLang(lang: SourceLang): void {
    currentSourceLang = lang;
    localStorage.setItem("source_lang", lang);
}

export function getSourceLang(): SourceLang {
    return currentSourceLang;
}
