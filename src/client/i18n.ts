export type Lang = "en" | "ru" | "de";
export type SourceLang = "en" | "ru";

export interface CardUiTranslations {
    introductionTitle: string; continue: string; readyToContinue: string; insufficientOptions: string; exerciseUnavailable: string;
    wordTypeTitle: string; wordArticleTypeTitle: string; articleTitle: string; articleUnavailable: string;
    recallComponent: string; spellingComponent: string; articleComponent: string; unobserved: string; expectedAnswer: string;
    choiceTitle: string; textTitle: string; revealTitle: string;
    choose: string; yourAnswer: string; submit: string; next: string; reveal: string;
    remembered: string; forgotten: string; showDetails: string; hideDetails: string;
    wordDetails: string; examples: string; missingTranslation: string; listen: string; autoReadWords: string; autoReadAloud: string;
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


export interface Translations {
    sessionUi: SessionUiTranslations;
    homeUi: HomeUiTranslations;
    cardUi: CardUiTranslations;
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
        tokensTitle: "Build the answer", sentenceAssemblyTitle: "Build the sentence", konjunktivTokenTitle: "Complete the sentence",
        tokenAnswer: "Your answer", tokenPool: "Words", tokenEmpty: "Tap or drag words here", tokenReset: "Reset",
        tokenHint: "Enter adds or returns a word, Shift+arrows move it, Backspace returns it.",
        wordTypeTitle: "Type the Latin word", wordArticleTypeTitle: "Type the Latin word", articleTitle: "Choose the article", articleUnavailable: "Article exercises require a noun with a known article.", recallComponent: "Word recall", spellingComponent: "Spelling", articleComponent: "Article", unobserved: "Not assessed", expectedAnswer: "Expected answer",
        introductionTitle: "Meet the word", continue: "Continue", readyToContinue: "Ready to continue", insufficientOptions: "Not enough distinct answer options. Choose another exercise.", exerciseUnavailable: "This exercise is unavailable for this word.",
        choiceTitle: "Choose the answer", textTitle: "Type the answer", revealTitle: "Recall and check",
        choose: "Choose one option", yourAnswer: "Your answer", submit: "Check", next: "Next", reveal: "Show answer",
        remembered: "Remembered", forgotten: "Didn't remember", showDetails: "Word details", hideDetails: "Hide details",
        wordDetails: "Word details", examples: "Examples", missingTranslation: "No confirmed translation", listen: "Listen in Latin", autoReadWords: "Read words automatically", autoReadAloud: "Read aloud automatically",
        ttsUnavailable: "Speech is not available on this device.", ttsNoVoice: "No Latin or Italian voice found. Install one in your device settings.",
        ttsFailed: "Could not play the audio. Try again.", saving: "Please wait…", submitted: "Answer accepted",
        error: "Could not complete the action. Try again.", correct: "Correct", incorrect: "Not quite", info: "Answer accepted",
        clozeTitle: "Fill in the gaps", clozeSlot: "Gap {n} of {total}", clozeEmpty: "empty", clozeReset: "Clear answers", clozeResults: "Results by gap", clozeSlotCorrect: "correct", clozeSlotIncorrect: "not quite",
    },
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
        tokensTitle: "Соберите ответ", sentenceAssemblyTitle: "Соберите предложение", konjunktivTokenTitle: "Завершите предложение",
        tokenAnswer: "Ваш ответ", tokenPool: "Слова", tokenEmpty: "Нажмите на слова или перетащите их сюда", tokenReset: "Сбросить",
        tokenHint: "Enter добавляет или возвращает слово, Shift+стрелки двигают его, Backspace возвращает.",
        wordTypeTitle: "Введите латинское слово", wordArticleTypeTitle: "Введите латинское слово", articleTitle: "Выберите артикль", articleUnavailable: "Для упражнения нужно существительное с известным артиклем.", recallComponent: "Знание слова", spellingComponent: "Написание", articleComponent: "Артикль", unobserved: "Не оценено", expectedAnswer: "Правильный ответ",
        introductionTitle: "Знакомство со словом", continue: "Продолжить", readyToContinue: "Можно продолжать", insufficientOptions: "Недостаточно однозначных вариантов. Выберите другое упражнение.", exerciseUnavailable: "Это упражнение недоступно для данного слова.",
        choiceTitle: "Выберите ответ", textTitle: "Введите ответ", revealTitle: "Вспомните и проверьте",
        choose: "Выберите один вариант", yourAnswer: "Ваш ответ", submit: "Проверить", next: "Дальше", reveal: "Показать ответ",
        remembered: "Помню", forgotten: "Не помню", showDetails: "О слове", hideDetails: "Скрыть подробности",
        wordDetails: "О слове", examples: "Примеры", missingTranslation: "Нет подтверждённого перевода", listen: "Прослушать по-латыни", autoReadWords: "Озвучивать слова автоматически", autoReadAloud: "Озвучивать автоматически",
        ttsUnavailable: "Озвучивание недоступно на этом устройстве.", ttsNoVoice: "Не найден латинский или итальянский голос. Установите его в настройках устройства.",
        ttsFailed: "Не удалось воспроизвести звук. Попробуйте ещё раз.", saving: "Подождите…", submitted: "Ответ принят",
        error: "Не удалось выполнить действие. Попробуйте ещё раз.", correct: "Правильно", incorrect: "Не совсем", info: "Ответ принят",
        clozeTitle: "Заполните пропуски", clozeSlot: "Пропуск {n} из {total}", clozeEmpty: "пусто", clozeReset: "Очистить ответы", clozeResults: "Результат по пропускам", clozeSlotCorrect: "верно", clozeSlotIncorrect: "неверно",
    },
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
        tokensTitle: "Antwort zusammensetzen", sentenceAssemblyTitle: "Bilde den Satz", konjunktivTokenTitle: "Vervollständige den Satz",
        tokenAnswer: "Deine Antwort", tokenPool: "Wörter", tokenEmpty: "Tippe auf Wörter oder ziehe sie hierher", tokenReset: "Zurücksetzen",
        tokenHint: "Enter fügt ein Wort hinzu oder nimmt es zurück, Umschalt+Pfeile verschieben es, Rücktaste nimmt es zurück.",
        wordTypeTitle: "Gib das lateinische Wort ein", wordArticleTypeTitle: "Gib das lateinische Wort ein", articleTitle: "Wähle den Artikel", articleUnavailable: "Artikelübungen benötigen ein Nomen mit bekanntem Artikel.", recallComponent: "Wortabruf", spellingComponent: "Schreibweise", articleComponent: "Artikel", unobserved: "Nicht bewertet", expectedAnswer: "Erwartete Antwort",
        introductionTitle: "Lerne das Wort kennen", continue: "Weiter", readyToContinue: "Bereit zum Fortfahren", insufficientOptions: "Nicht genug eindeutige Antwortmöglichkeiten. Wähle eine andere Übung.", exerciseUnavailable: "Diese Übung ist für dieses Wort nicht verfügbar.",
        choiceTitle: "Wähle die Antwort", textTitle: "Gib die Antwort ein", revealTitle: "Erinnere dich und prüfe",
        choose: "Wähle eine Option", yourAnswer: "Deine Antwort", submit: "Prüfen", next: "Weiter", reveal: "Antwort zeigen",
        remembered: "Gewusst", forgotten: "Nicht gewusst", showDetails: "Wortdetails", hideDetails: "Details ausblenden",
        wordDetails: "Wortdetails", examples: "Beispiele", missingTranslation: "Keine bestätigte Übersetzung", listen: "Auf Latein anhören", autoReadWords: "Wörter automatisch vorlesen", autoReadAloud: "Automatisch vorlesen",
        ttsUnavailable: "Die Sprachausgabe ist auf diesem Gerät nicht verfügbar.", ttsNoVoice: "Keine lateinische oder italienische Stimme gefunden. Installiere eine in den Geräteeinstellungen.",
        ttsFailed: "Die Wiedergabe ist fehlgeschlagen. Versuche es erneut.", saving: "Bitte warten…", submitted: "Antwort angenommen",
        error: "Die Aktion konnte nicht ausgeführt werden. Versuche es erneut.", correct: "Richtig", incorrect: "Nicht ganz", info: "Antwort angenommen",
        clozeTitle: "Fülle die Lücken aus", clozeSlot: "Lücke {n} von {total}", clozeEmpty: "leer", clozeReset: "Antworten löschen", clozeResults: "Ergebnis pro Lücke", clozeSlotCorrect: "richtig", clozeSlotIncorrect: "nicht ganz",
    },
};

const TRANSLATIONS: Record<Lang, Translations> = { en: EN, ru: RU, de: DE };

export function cardUiTranslations(lang: Lang): CardUiTranslations {
    return TRANSLATIONS[lang].cardUi;
}

export function sessionUiTranslations(lang: Lang): SessionUiTranslations {
    return TRANSLATIONS[lang].sessionUi;
}

export function homeUiTranslations(lang: Lang): HomeUiTranslations {
    return TRANSLATIONS[lang].homeUi;
}
