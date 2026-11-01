# План реализации словарного тренажёра v2

> **Current policy — 2026-10-30:** V1 is retired. Any requirement below to keep
> its client/API working, defer retirement to R3 or verify v1 before releasing v2
> is superseded by [v1-retirement.md](v1-retirement.md) and [AGENTS.md](../AGENTS.md).
> Auth/accounts and historical rows stay; v1 compatibility and parallel operation
> are not release requirements. Run `disable-v1.sql` on the existing project.

Статус: запланировано, реализация этим документом не начата.
Общий трекер: [#298](https://github.com/AlekseiDudchenko/de-trainer/issues/298). Архитектура: PR [#297](https://github.com/AlekseiDudchenko/de-trainer/pull/297).

Основание: [архитектура](vocabulary-architecture.ru.md) и
[контракт общего каталога](shared-vocabulary-catalog.ru.md).
Полная замена в текущем репозитории и существующем Supabase-проекте. Аккаунты
и история v1 сохраняются; прогресс v2 начинается отдельно. Переход добавляет
схему рядом с v1, а старые записи отключаются после приёмки. Актуальный runbook:
[v2-existing-project-transition.md](v2-existing-project-transition.md).

## 1. Объём

- Общий каталог слов с постоянными ID; общий прогресс пользователя по слову.
- Независимые компоненты recognition/recall/spelling/article с SRS.
- Новые слова и созревшие повторения — отдельные режимы.
- До 20 разных слов в одном упражнении; до 5 слов последовательно всеми
  применимыми упражнениями; полный и адаптивный круг.
- Атомарное локальное сохранение, продолжение занятия, гостевой режим,
  изоляция аккаунтов и синхронизация двух устройств.
- Пользовательские добавления в общий пул, первичная загрузка из
  Wiktionary/Tatoeba, отдельная проверка каждого принимаемого элемента.
- Все текущие семейства упражнений переносятся на общие механики и сохранение.
- Проверенная новая версия полностью заменяет прежний клиент после проверки функциональной полноты.

За пределами обязательного первого выпуска: перенос старой истории,
совместимость URL/API v1, совместное сопровождение двух версий, нейросетевой TTS,
AI-объяснения, социальные функции и продолжение одного занятия на другом устройстве.
Состав выпуска не расширяется автоматически из старого backlog.

## 2. Эпики

| Эпик | Результат | Задач |
| --- | --- | --- |
| [#299](https://github.com/AlekseiDudchenko/de-trainer/issues/299) E1: Основа приложения и общий каталог | Сборка v2, добавление каталога в существующий Supabase, канонические слова и seed. | 4 |
| [#300](https://github.com/AlekseiDudchenko/de-trainer/issues/300) E2: Общий прогресс слова и SRS компонентов | У слова один прогресс с независимыми компонентами и воспроизводимой обработкой ответов. | 3 |
| [#301](https://github.com/AlekseiDudchenko/de-trainer/issues/301) E3: Переиспользуемые карточки и упражнения | Набор определений упражнений поверх общих UI-компонентов, без собственного SRS на каждой странице. | 3 |
| [#302](https://github.com/AlekseiDudchenko/de-trainer/issues/302) E4: Занятия 20/5 слов и новая главная | Пользователь явно выбирает новые/созревшие и одно упражнение/полный комплекс, используя один Runner. | 4 |
| [#303](https://github.com/AlekseiDudchenko/de-trainer/issues/303) E5: Локальное хранение и надёжная синхронизация | Гость и аккаунты изолированы, ответы долговечны, серверный прогресс строится из уникальных событий. | 4 |
| [#304](https://github.com/AlekseiDudchenko/de-trainer/issues/304) E6: Добавление слов в публичный пул и проверка | Первое добавление получает данные публичных источников, каждый принятый элемент явно проверяется и публикуется по ревизии. | 5 |
| [#328](https://github.com/AlekseiDudchenko/de-trainer/issues/328) E8: Общие механики всех упражнений и учебная статистика | Один SessionRunner, общие вводы и журнал ответов обслуживают словарь, предложения, грамматику, аудио и видео. | 3 |
| [#329](https://github.com/AlekseiDudchenko/de-trainer/issues/329) E9: Перенос всех существующих семейств упражнений | Сохранить существующие пользовательские возможности на общем ядре до полной замены сайта; старые URL/API и прогресс переносить не нужно. | 8 |
| [#305](https://github.com/AlekseiDudchenko/de-trainer/issues/305) E7: Приёмка и полная замена старой версии | Проверенный новый продукт публикуется вместо старого с сохранением Auth, отдельным прогрессом v2 и отключением legacy runtime. | 3 |

Итого: **9 эпиков, 37 задач**. Четыре задачи переиспользуют текущие тикеты;
остальные созданы для новой реализации. Иерархия связана parent-ссылками
и чек-листами эпиков. Точные зависимости заданы на уровне задач.

## 3. Задачи и зависимости

| Код | Тикет и результат | Зависит от |
| --- | --- | --- |
| F1 | [#306](https://github.com/AlekseiDudchenko/de-trainer/issues/306) Каркас общего ядра, сборка и проверяемые контракты | — |
| F2 | [#307](https://github.com/AlekseiDudchenko/de-trainer/issues/307) Базовая схема общего каталога и политики доступа | [#306](https://github.com/AlekseiDudchenko/de-trainer/issues/306) (F1) |
| F3 | [#280](https://github.com/AlekseiDudchenko/de-trainer/issues/280) Канонические ID, дедупликация и начальное наполнение словаря | [#306](https://github.com/AlekseiDudchenko/de-trainer/issues/306) (F1), [#307](https://github.com/AlekseiDudchenko/de-trainer/issues/307) (F2) |
| F4 | [#308](https://github.com/AlekseiDudchenko/de-trainer/issues/308) Существующий Supabase-проект, Google-вход и конфигурация окружений | [#306](https://github.com/AlekseiDudchenko/de-trainer/issues/306) (F1), [#307](https://github.com/AlekseiDudchenko/de-trainer/issues/307) (F2) |
| P1 | [#309](https://github.com/AlekseiDudchenko/de-trainer/issues/309) Модель компонентов памяти и адаптер SRS | [#306](https://github.com/AlekseiDudchenko/de-trainer/issues/306) (F1) |
| P2 | [#310](https://github.com/AlekseiDudchenko/de-trainer/issues/310) Политика оценки знаний, подсказок и повторов в одном дне | [#309](https://github.com/AlekseiDudchenko/de-trainer/issues/309) (P1) |
| P3 | [#311](https://github.com/AlekseiDudchenko/de-trainer/issues/311) Проектор событий, выбор новых/созревших и сводка слова | [#309](https://github.com/AlekseiDudchenko/de-trainer/issues/309) (P1), [#310](https://github.com/AlekseiDudchenko/de-trainer/issues/310) (P2) |
| X1 | [#312](https://github.com/AlekseiDudchenko/de-trainer/issues/312) Общая оболочка карточки, вводы, локализация и озвучивание | [#306](https://github.com/AlekseiDudchenko/de-trainer/issues/306) (F1) |
| X2 | [#313](https://github.com/AlekseiDudchenko/de-trainer/issues/313) Упражнения выбора перевода и обратного выбора, раскрытие ответа | [#312](https://github.com/AlekseiDudchenko/de-trainer/issues/312) (X1), [#310](https://github.com/AlekseiDudchenko/de-trainer/issues/310) (P2) |
| X3 | [#314](https://github.com/AlekseiDudchenko/de-trainer/issues/314) Ввод немецкого слова, артикли и раздельная оценка компонентов | [#312](https://github.com/AlekseiDudchenko/de-trainer/issues/312) (X1), [#310](https://github.com/AlekseiDudchenko/de-trainer/issues/310) (P2), [#313](https://github.com/AlekseiDudchenko/de-trainer/issues/313) (X2) |
| L1 | [#315](https://github.com/AlekseiDudchenko/de-trainer/issues/315) Планировщик: новые/созревшие, 20 слов и набор из 5 | [#311](https://github.com/AlekseiDudchenko/de-trainer/issues/311) (P3), [#313](https://github.com/AlekseiDudchenko/de-trainer/issues/313) (X2) |
| L2 | [#316](https://github.com/AlekseiDudchenko/de-trainer/issues/316) SessionRunner: команды, сохранение каждого ответа и продолжение | [#315](https://github.com/AlekseiDudchenko/de-trainer/issues/315) (L1), [#293](https://github.com/AlekseiDudchenko/de-trainer/issues/293) (S0) |
| L3 | [#317](https://github.com/AlekseiDudchenko/de-trainer/issues/317) Комплекс из 5 слов: все упражнения, диагностика и разбор ошибок | [#316](https://github.com/AlekseiDudchenko/de-trainer/issues/316) (L2), [#310](https://github.com/AlekseiDudchenko/de-trainer/issues/310) (P2), [#314](https://github.com/AlekseiDudchenko/de-trainer/issues/314) (X3) |
| L4 | [#318](https://github.com/AlekseiDudchenko/de-trainer/issues/318) Главная, выбор колоды, карточка слова и итоги занятия | [#316](https://github.com/AlekseiDudchenko/de-trainer/issues/316) (L2), [#317](https://github.com/AlekseiDudchenko/de-trainer/issues/317) (L3), [#280](https://github.com/AlekseiDudchenko/de-trainer/issues/280) (F3) |
| S0 | [#293](https://github.com/AlekseiDudchenko/de-trainer/issues/293) V2: IndexedDB, изоляция владельцев и атомарное сохранение занятия | [#306](https://github.com/AlekseiDudchenko/de-trainer/issues/306) (F1), [#311](https://github.com/AlekseiDudchenko/de-trainer/issues/311) (P3) |
| S1 | [#319](https://github.com/AlekseiDudchenko/de-trainer/issues/319) Серверный приём событий и транзакционная проекция с RLS | [#307](https://github.com/AlekseiDudchenko/de-trainer/issues/307) (F2), [#308](https://github.com/AlekseiDudchenko/de-trainer/issues/308) (F4), [#311](https://github.com/AlekseiDudchenko/de-trainer/issues/311) (P3) |
| S2 | [#294](https://github.com/AlekseiDudchenko/de-trainer/issues/294) V2: сохраняемая очередь, повторная отправка и два устройства | [#293](https://github.com/AlekseiDudchenko/de-trainer/issues/293) (S0), [#319](https://github.com/AlekseiDudchenko/de-trainer/issues/319) (S1) |
| S3 | [#295](https://github.com/AlekseiDudchenko/de-trainer/issues/295) V2: регрессии гонок подтверждения и потери новых ответов | [#294](https://github.com/AlekseiDudchenko/de-trainer/issues/294) (S2), [#316](https://github.com/AlekseiDudchenko/de-trainer/issues/316) (L2) |
| C1 | [#320](https://github.com/AlekseiDudchenko/de-trainer/issues/320) Первичное добавление: поиск дублей, enrichment jobs и кеш | [#307](https://github.com/AlekseiDudchenko/de-trainer/issues/307) (F2), [#308](https://github.com/AlekseiDudchenko/de-trainer/issues/308) (F4) |
| C2 | [#321](https://github.com/AlekseiDudchenko/de-trainer/issues/321) Wiktionary: грамматика, смыслы, переводы и provenance | [#320](https://github.com/AlekseiDudchenko/de-trainer/issues/320) (C1) |
| C3 | [#322](https://github.com/AlekseiDudchenko/de-trainer/issues/322) Tatoeba: примеры и прямые пары переводов с provenance | [#320](https://github.com/AlekseiDudchenko/de-trainer/issues/320) (C1) |
| C4 | [#323](https://github.com/AlekseiDudchenko/de-trainer/issues/323) Проверка и атомарная публикация отдельных ревизий контента | [#307](https://github.com/AlekseiDudchenko/de-trainer/issues/307) (F2), [#320](https://github.com/AlekseiDudchenko/de-trainer/issues/320) (C1) |
| C5 | [#324](https://github.com/AlekseiDudchenko/de-trainer/issues/324) UI добавления, проверки каждого текста и публикации в общий каталог | [#312](https://github.com/AlekseiDudchenko/de-trainer/issues/312) (X1), [#321](https://github.com/AlekseiDudchenko/de-trainer/issues/321) (C2), [#322](https://github.com/AlekseiDudchenko/de-trainer/issues/322) (C3), [#323](https://github.com/AlekseiDudchenko/de-trainer/issues/323) (C4), [#318](https://github.com/AlekseiDudchenko/de-trainer/issues/318) (L4) |
| G1 | [#330](https://github.com/AlekseiDudchenko/de-trainer/issues/330) Общий TokenInput: сборка предложений и обратимые действия | [#306](https://github.com/AlekseiDudchenko/de-trainer/issues/306), [#312](https://github.com/AlekseiDudchenko/de-trainer/issues/312) |
| G2 | [#331](https://github.com/AlekseiDudchenko/de-trainer/issues/331) Общий ClozeInput: один/несколько пропусков, выбор и ввод | [#306](https://github.com/AlekseiDudchenko/de-trainer/issues/306), [#312](https://github.com/AlekseiDudchenko/de-trainer/issues/312) |
| G3 | [#332](https://github.com/AlekseiDudchenko/de-trainer/issues/332) Общий журнал ответов и прогресс остальных типов упражнений | [#306](https://github.com/AlekseiDudchenko/de-trainer/issues/306), [#311](https://github.com/AlekseiDudchenko/de-trainer/issues/311), [#293](https://github.com/AlekseiDudchenko/de-trainer/issues/293), [#319](https://github.com/AlekseiDudchenko/de-trainer/issues/319), [#294](https://github.com/AlekseiDudchenko/de-trainer/issues/294), [#316](https://github.com/AlekseiDudchenko/de-trainer/issues/316) |
| M1 | [#333](https://github.com/AlekseiDudchenko/de-trainer/issues/333) Предложения: сборка, альтернативы, варианты времени и теги | [#330](https://github.com/AlekseiDudchenko/de-trainer/issues/330), [#332](https://github.com/AlekseiDudchenko/de-trainer/issues/332) |
| M2 | [#334](https://github.com/AlekseiDudchenko/de-trainer/issues/334) Аудирование: озвучивание, ввод и сборка услышанного | [#333](https://github.com/AlekseiDudchenko/de-trainer/issues/333), [#312](https://github.com/AlekseiDudchenko/de-trainer/issues/312) |
| M3 | [#335](https://github.com/AlekseiDudchenko/de-trainer/issues/335) Пропуски: относительные местоимения и Passiv | [#331](https://github.com/AlekseiDudchenko/de-trainer/issues/331), [#332](https://github.com/AlekseiDudchenko/de-trainer/issues/332) |
| M4 | [#336](https://github.com/AlekseiDudchenko/de-trainer/issues/336) Kasus: артикль, падеж, вопрос и окно правила | [#331](https://github.com/AlekseiDudchenko/de-trainer/issues/331), [#332](https://github.com/AlekseiDudchenko/de-trainer/issues/332), [#313](https://github.com/AlekseiDudchenko/de-trainer/issues/313) |
| M5 | [#337](https://github.com/AlekseiDudchenko/de-trainer/issues/337) Konjunktiv II: четыре тренажёра на общих определениях | [#330](https://github.com/AlekseiDudchenko/de-trainer/issues/330), [#332](https://github.com/AlekseiDudchenko/de-trainer/issues/332), [#312](https://github.com/AlekseiDudchenko/de-trainer/issues/312) |
| M6 | [#338](https://github.com/AlekseiDudchenko/de-trainer/issues/338) Видео: диктант и сборка предложений из сегментов | [#330](https://github.com/AlekseiDudchenko/de-trainer/issues/330), [#332](https://github.com/AlekseiDudchenko/de-trainer/issues/332), [#334](https://github.com/AlekseiDudchenko/de-trainer/issues/334) |
| M7 | [#339](https://github.com/AlekseiDudchenko/de-trainer/issues/339) Redemittel: раскрытие фразы и самооценка | [#332](https://github.com/AlekseiDudchenko/de-trainer/issues/332), [#312](https://github.com/AlekseiDudchenko/de-trainer/issues/312) |
| M8 | [#340](https://github.com/AlekseiDudchenko/de-trainer/issues/340) Тест уровня: проведение, результат и рекомендации | [#332](https://github.com/AlekseiDudchenko/de-trainer/issues/332), [#313](https://github.com/AlekseiDudchenko/de-trainer/issues/313) |
| R1 | [#325](https://github.com/AlekseiDudchenko/de-trainer/issues/325) Сквозная приёмка v2: обучение, повторение, офлайн и общий пул | [#318](https://github.com/AlekseiDudchenko/de-trainer/issues/318) (L4), [#295](https://github.com/AlekseiDudchenko/de-trainer/issues/295) (S3), [#324](https://github.com/AlekseiDudchenko/de-trainer/issues/324) (C5) , [#333](https://github.com/AlekseiDudchenko/de-trainer/issues/333), [#334](https://github.com/AlekseiDudchenko/de-trainer/issues/334), [#335](https://github.com/AlekseiDudchenko/de-trainer/issues/335), [#336](https://github.com/AlekseiDudchenko/de-trainer/issues/336), [#337](https://github.com/AlekseiDudchenko/de-trainer/issues/337), [#338](https://github.com/AlekseiDudchenko/de-trainer/issues/338), [#339](https://github.com/AlekseiDudchenko/de-trainer/issues/339), [#340](https://github.com/AlekseiDudchenko/de-trainer/issues/340) |
| R2 | [#326](https://github.com/AlekseiDudchenko/de-trainer/issues/326) Удалить старый runtime, маршруты и вызовы старых RPC | [#325](https://github.com/AlekseiDudchenko/de-trainer/issues/325) (R1) |
| R3 | [#327](https://github.com/AlekseiDudchenko/de-trainer/issues/327) Развернуть v2 в существующем проекте, переключить сайт и отключить записи v1 | [#308](https://github.com/AlekseiDudchenko/de-trainer/issues/308) (F4), [#326](https://github.com/AlekseiDudchenko/de-trainer/issues/326) (R2) |

Граф зависимостей проверен на отсутствие циклов. Порядок строк — удобная
группировка, а не запрет работы над независимыми задачами.
В частности, S0 выполняется до L2, несмотря на расположение эпика E5 ниже E4.

## 4. Контрольные точки

| Точка | Проверяемое поведение | Ключевые задачи |
| --- | --- | --- |
| A. Основа | Чистая сборка ядра, схема/RLS, seed-каталог и вход в preview | F1–F4 |
| B. Первая сквозная сессия | На тестовой колоде выбрать одно упражнение, ответить, перезагрузить страницу и продолжить без потери | P1–P3, X1–X2, S0, L1–L2 |
| C. Учебный сценарий целиком | Все упражнения, новые/созревшие, комплекс 5, главная и синхронизация другого устройства | X3, L3–L4, S1–S3 |
| D. Общий вклад | Первое добавление → источники → отдельные проверки → публикация → доступ другому пользователю | C1–C5 |
| E. Существующие упражнения | Общие tokens/cloze, статистика и перенос предложений, аудирования, грамматики, видео, фраз и теста | G1–G3, M1–M8 |
| F. Замена | Приёмка точного commit, замена runtime и переключение без сброса Auth/БД | R1–R3 |

Это внутренние точки проверки единой новой версии, а не обязательные
промежуточные публичные релизы. C1–C4 и подготовка серверной инфраструктуры
могут выполняться независимо от UI после готовности своих зависимостей.

Первая работа: F1 [#306](https://github.com/AlekseiDudchenko/de-trainer/issues/306) — контракты и сборка. Затем F2/P1/X1
по готовым контрактам. Не начинать с удаления рабочего кода или сброса базы:
конкретные операции замены находятся в R2/R3 после проверяемой реализации.

## 5. Размер задачи и готовность PR

Каждая задача имеет конкретную границу и 3 проверяемых критерия в GitHub.
Ориентир — один обозримый PR на задачу. Если реализация заметно разрастается,
задачу делим по самостоятельным результатам с обновлением зависимостей.

Общие условия:
- Поведение доступно через общий контракт; нет скрытой копии логики в странице.
- Есть проверки значимых ошибок и инвариантов, соответствующие изменению.
- Для UI — ручная/браузерная проверка состояния, клавиатуры и мобильного вида.
- Для схемы/сервисов — реальные проверки прав/транзакций и конкурентных сценариев.
- Документация контрактов и конфигурации обновлена; секретов в клиенте нет.
- Результат проверок привязан к точному commit; отсутствие Actions не выдаётся
  за зелёный CI, используется воспроизводимый локальный запуск.
- Epic закрывается после интеграции задач; созданные файлы/интерфейсы сами
  по себе не означают готовую функцию.

Календарные сроки пока не обещаются: оценка уточняется после первой
сквозной сессии B, когда проверены фактические контракты ядра и хранения.

## 6. Обязательное сохранение возможностей

[Матрица функциональной полноты](exercise-capability-matrix.ru.md) связывает
каждое текущее семейство с новой механикой, задачей и сценарием проверки.
> **Решение владельца от 28.10.2026 (заменяет текст ниже и прежнее «полная замена»).**
> v2 публикуется, как только готова одна законченная функция: изучение и
> повторение слов (L1–L4, S0–S2) вместе с условиями выпуска из
> [v2-existing-project-transition.md](v2-existing-project-transition.md#политика-выпуска-от-28102026).
> Остальные семейства упражнений (M1–M8) добавляются после выпуска. Старую версию
> не поддерживаем; все прежние пользователи были тестировщиками, поэтому данные v1
> можно сбросить (аккаунты и вход Google сохраняются). Эпик E6 по-прежнему вне гейта.

Прежняя редакция: приёмка R1 ждала все M1–M8; только затем R2 удалял старый
runtime и R3 переключал сайт. Работающий словарь не считался готовой полной
заменой. Это условие снято решением выше.

Старые URL и код не являются контрактом v2. Аккаунты и история v1 сохраняются. Пользовательские возможности,
учебные наборы и существенное поведение сохраняются через новую реализацию.
Нереализованные предложения новых фич из backlog автоматически не включаются.

## 7. Существующий backlog

| Существующая работа | Решение |
| --- | --- |
| #280 | Переиспользован как F3: дедупликация и seed; история проблемы сохранена |
| #293 | Переиспользован как S0: изоляция и атомарное хранение v2 |
| #294 | Переиспользован как S2: новая сохраняемая очередь |
| #295 | Переиспользован как S3: отдельная приёмка гонок/ACK |
| #290 | Это PR главной v1; источник идей, не обязательная зависимость нового L4 |
| #292 / PR #296 | Защита текущей версии до замены; не часть совместимости v2 |
| #230 / #107 | Прежние задачи рефакторинга слов; объём новой работы покрывают E2–E4 |
| #274 / #278 | Старые ссылки/SEO не блокируют выпуск без требования совместимости |
| #244–#247 | Нейросетевой TTS не включён; переиспользуется доступное озвучивание |
| Существующие семейства упражнений | Обязательный перенос в E9; их тикеты истории не закрываются автоматически |
| Ещё не реализованные предложения новых фич | Не включаются в выпуск и не закрываются автоматически |

Старые PR и несвязанные задачи этим планированием не закрываются.
Переключение сайта и отключение старых RPC/прямых записей — только работа
релизного тикета R3, с применимыми подтверждениями на момент действия.
Сброс/удаление существующей базы и Auth исключены; старую историю не импортируем
в компонентный SRS v2. Главная L4 подключается к окружению/Auth/серверному каталогу
при R3, как описано в docs/v2-environments.md.
