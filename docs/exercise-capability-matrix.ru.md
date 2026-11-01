# Матрица сохранения существующих возможностей в v2

> **Current policy — 2026-10-30:** V1 is retired. Any requirement below to keep
> its client/API working, defer retirement to R3 or verify v1 before releasing v2
> is superseded by [v1-retirement.md](v1-retirement.md) and [AGENTS.md](../AGENTS.md).
> Auth/accounts and historical rows stay; v1 compatibility and parallel operation
> are not release requirements. Run `disable-v1.sql` on the existing project.

Статус: требования приёмки, перенос ещё не выполнен.
Базовый инвентарь: исходники/данные/тесты main c83173b и docs/site-overview.ru.md.
Общий план: [#298](https://github.com/AlekseiDudchenko/de-trainer/issues/298).
Общие механики: [#328](https://github.com/AlekseiDudchenko/de-trainer/issues/328).
Перенос: [#329](https://github.com/AlekseiDudchenko/de-trainer/issues/329).

Сохраняются пользовательские возможности и полезные учебные материалы.
Реализация, URL/API и прежний пользовательский прогресс могут быть полностью
заменены. Отсутствие совместимости не позволяет убрать существующий тип упражнения.

## 1. Семейства и проверки

| ID | Сейчас | Что должно работать в новой версии | Общие механики | Тикет |
| --- | --- | --- | --- | --- |
| FC01 | Словарь | Выбор перевода/обратный выбор, ввод, раскрытие, примеры/детали, новые/созревшие и комплекс 5 | Choice/Text/Reveal, WordProgress | #313, #314, #317, #318 |
| FC02 | Отдельный тренажёр артиклей | Выбор der/die/das по существительным, фильтры набора, результат и статистика | Choice, словарный компонент article | #314, #315 |
| FC03 | Сборка предложений | Уровни/темы, варианты времени и связанные предложения, alternatives, объяснение, TTS, reset/prev/next | TokenInput, общий Runner; v2: `/v2/sentences.html`, [sentences-v2.md](sentences-v2.md) | #333 |
| FC04 | Аудирование | Скрытый ответ, TTS/повтор аудио, text/tokens, подсказки, фильтры, отдельная статистика | Audio prompt + Text/TokenInput, общий Runner, корпус M1; v2: `/v2/listening.html`, [listening-v2.md](listening-v2.md) | #334 |
| FC05 | Gaps: относительные местоимения | Ввод пропущенной формы, проверка, раскрытие подсказки, следующие/предыдущие задания | ClozeInput с одним слотом | #335: перенесено — `v2/gaps.html`, `gap-type`/`gap-select`, набор `data/items/relative-pronoun-gaps.json` |
| FC06 | Passiv | Несколько пропусков, select/type, варианты времён, переводы, подсказки и TTS | ClozeInput, Choice/Text по слотам | #335: перенесено — `v2/gaps.html`, `gap-select`/`gap-type`, набор `data/items/passiv-gaps.json` |
| FC07 | Kasus | Article/case/question, фильтры, выделение фразы, explanation, окно правила и таблица, клавиши ответа | Choice/Cloze, RulePanel | #336: перенесено — `v2/kasus.html`, `kasus-article` (ClozeInput)/`kasus-case`/`kasus-question` (ChoiceInput), набор `data/items/kasus-a2.json`, правила `data/kasus-rules.json` |
| FC08 | Konjunktiv II | Transformation, conditional, polite, past; text/tokens, варианты ответа, подсказки и статистика | Text/TokenInput, общие определения | #337: перенесено — `v2/konjunktiv2.html`, `konjunktiv2-<trainer>-text`/`-tokens` (8 определений), наборы `data/items/konjunktiv2-*.json` |
| FC09 | Видео-диктант | YouTube, pause points, text/tokens, repeat/seek, shorts/full, переводы сегментов, сохранение позиции | Video prompt (YouTube media adapter) + Text/TokenInput на адаптере аудирования M2, общий Runner; v2: `/v2/video.html`, [video-v2.md](video-v2.md) | #338 |
| FC10 | Предложения из видео | Те же сегменты как самостоятельная сборка, варианты перевода, навигация и статистика | Общий контент сегментов + TokenInput на адаптере сборки M1 (только сегменты с переводом, как в v1); v2: `/v2/video.html#view=sentences`, [video-v2.md](video-v2.md) | #338 |
| FC11 | Redemittel | Значение → вспомнить фразу → reveal → самооценка, TTS, продолжение и итог | RevealInput, subjective evidence | #339: перенесено — `v2/redemittel.html`, `phrase-recall`, набор `data/items/redemittel.json` (beruf + daily) |
| FC12 | Тест уровня | Блоки/порог перехода, раннее завершение, итог и рекомендация, сохранение результата | Choice, AssessmentPlanner/ScoringPolicy | #340: перенесено — `v2/level-test.html`, `level-test-choice`, `planLevelTest`/`scoreLevelTest`, набор `data/items/level-test.json`; итог на главной `v2/session.html` |

Тикеты хранят подробные критерии. Строка считается пройденной после проверки
основного пользовательского пути и существенных ошибок на новой реализации,
а не после появления названия/ссылки в меню. Изменение компоновки экрана допустимо.

## 2. Общие инварианты

- [ ] Все перечисленные семейства доступны из новой навигации/каталога.
- [ ] UI-языки и существующие переводы материалов сохраняются там, где они есть;
  отсутствие конкретного перевода обрабатывается явно.
- [ ] Клавиатура, мобильный экран, тема, доступность и TTS проверены.
- [ ] Rerender/смена UI-языка не теряют ответ, не меняют набор вариантов и не дублируют запись.
- [ ] Все ответы используют один LearningEvent, транзакцию сохранения и outbox.
- [ ] Статистика аудирования/сборки/грамматики/фраз отделена по виду навыка и набору.
- [ ] WordProgress изменяется только явными словарными заданиями; предложение
  с известным словом не считается проверкой всех его компонентов.
- [ ] Daily goal/streak строятся из уникальных событий по явной политике;
  reveal, публикация и повтор отправки не увеличивают счётчик.
- [ ] Самооценка фразы отмечается как субъективная, результат теста уровня хранится отдельно.
- [ ] Гость и разные аккаунты изолированы, offline/reload и синхронизация сохраняют ответы.
- [ ] Аудио/видео, таймеры и клавиатурные обработчики освобождаются при уходе;
  недоступность внешнего видео/голоса не выглядит как успешная загрузка.
- [ ] В новой сборке нет вызовов старых RPC/страниц и второго writer.

## 2a. Общий контракт семейств (G3 / #332)

Готово для M1–M8: один журнал, один outbox, один `SyncService`, общий `SessionRunner`.
Каждое семейство добавляет только данные и адаптер:

1. Набор `ItemDataset` (`id`, `version`, `kind`: `sentence`/`grammar-item`/`phrase`/
   `video-segment`/`assessment`) с элементами `content` в своём формате. Опубликованная
   версия неизменна: `npm run catalog:datasets`.
2. `ItemExerciseDefinition` с детерминированными `build`/`evaluate`, зарегистрированный
   в `ITEM_EXERCISES`. Тогда сервер переоценивает ответы тем же кодом. Готовые образцы:
   `item-choice`, `item-text`, `item-self-check`. Пример набора лежит в
   `test/fixtures/item-datasets.json`.
3. `planItemSession` → `SessionRunner.start`. Статистика по семейству строится через
   `projectExerciseProgress`/`summarizeExercise`/`selectItems`, а для теста уровня через
   `projectAssessments`. Дневная цель и серия строятся через `projectDailyActivity`.

Собственный RPC, очередь или таблица прогресса на страницу не нужны и не допускаются.
Подробности: [learning-sync.md](learning-sync.md#shared-journal-for-every-target-g3--332).

## 3. Условие выпуска

1. G1–G3 обеспечивают общие механики и статистику.
2. M1–M8 переносят семейства; словарные FC01–FC02 обеспечиваются E3/E4.
3. [#325](https://github.com/AlekseiDudchenko/de-trainer/issues/325) фиксирует
   результаты по FC01–FC12 и общим инвариантам на точном commit.
4. Только затем [#326](https://github.com/AlekseiDudchenko/de-trainer/issues/326)
   удаляет прежний runtime, а [#327](https://github.com/AlekseiDudchenko/de-trainer/issues/327)
   выполняет полную замену сайта.

Перенос старых пользователей/ответов/SRS не требуется. Новые фичи, которые
были только предложены в старом backlog и ещё не существовали, не входят
в эту матрицу автоматически. Этот документ не подтверждает завершение переноса.
