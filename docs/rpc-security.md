# Защита RPC прогресса (#292)

> **Current policy — 2026-10-30:** V1 is retired. Any requirement below to keep
> its client/API working, defer retirement to R3 or verify v1 before releasing v2
> is superseded by [v1-retirement.md](v1-retirement.md) and [AGENTS.md](../AGENTS.md).
> Auth/accounts and historical rows stay; v1 compatibility and parallel operation
> are not release requirements. Run `disable-v1.sql` on the existing project.

Миграция `supabase/migrations/007_rpc_authorization.sql` закрывает запись в
чужой прогресс через `upsert_progress`, `sync_progress`, `increment_daily`
и `sync_daily`. Она также ограничивает права `sync_srs_card`.

Все пять функций выполняются с правами вызывающего (`SECURITY INVOKER`),
поэтому политики RLS применяются и внутри RPC. Владелец определяется через
`auth.uid()`. Старый аргумент `p_user_id` сохранён для совместимости; если
он пуст или отличается от пользователя сессии, вызов возвращает `42501`.
Клиентский код и сигнатуры RPC менять для этого исправления не требуется.

У функций пустой `search_path`, таблицы и `auth.uid()` указаны со схемой.
`EXECUTE` отозван у `PUBLIC` и `anon`, выдан `authenticated`. Роль
`authenticated` получает SELECT/INSERT/UPDATE для трёх таблиц; доступ
к конкретным строкам по-прежнему ограничивают существующие политики RLS.

## Применение

Публикация сайта на GitHub Pages SQL не применяет. Миграцию нужно отдельно
выполнить в нужном проекте Supabase через SQL Editor или существующий процесс
миграций. Требуются права владельца функций и таблиц.

1. Проверить, что в проекте применены миграции 001–006, существуют роли
   `anon`/`authenticated`, `auth.uid()` и три таблицы с включённым RLS.
2. Сохранить определения функций и текущие права проекта для диагностики.
3. Выполнить весь файл 007 как один скрипт. Он содержит BEGIN/COMMIT;
   ошибка должна привести к откату транзакции.
4. Проверить каталог функций и таблиц запросами ниже. Если в production
   обнаружены дополнительные перегрузки старых RPC, проверить их отдельно:
   тесты покрывают все сигнатуры, создаваемые миграциями репозитория.
5. Войти тестовым пользователем, дать один ответ и проверить сохранение
   статистики и SRS. Проверки с двумя пользователями проводить на тестовых
   аккаунтах в staging; автоматические тесты не обращаются к production.

```sql
SELECT p.oid::regprocedure AS signature,
       p.prosecdef AS security_definer,
       p.proconfig,
       has_function_privilege('anon', p.oid, 'EXECUTE') AS anon_execute,
       has_function_privilege('authenticated', p.oid, 'EXECUTE') AS authenticated_execute,
       EXISTS (
         SELECT 1 FROM aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) acl
         WHERE acl.grantee = 0 AND acl.privilege_type = 'EXECUTE'
       ) AS public_execute
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname IN ('upsert_progress', 'sync_progress', 'increment_daily',
                    'sync_daily', 'sync_srs_card')
ORDER BY signature;

SELECT relname, relrowsecurity,
       has_table_privilege('authenticated', oid, 'SELECT') AS can_select,
       has_table_privilege('authenticated', oid, 'INSERT') AS can_insert,
       has_table_privilege('authenticated', oid, 'UPDATE') AS can_update
FROM pg_class
WHERE oid IN ('public.progress'::regclass, 'public.daily_stats'::regclass,
              'public.srs_cards'::regclass);
```

Ожидаются пять сигнатур: у всех `security_definer=false`,
`search_path=""`, `anon_execute=false`, `public_execute=false`,
`authenticated_execute=true`. У всех трёх таблиц RLS и указанные права
должны быть включены. Не выдавать роль `authenticated` пользователям
вручную и не отключать RLS для устранения ошибок доступа.

## Регрессионные проверки

```bash
npm ci
node --test test/rpc-authorization.test.mjs
```

Тесты создают отдельную временную PostgreSQL-базу в памяти через PGlite,
применяют реальные миграции 001–007 и вызывают функции как `authenticated`
и `anon`. Проверяются чужой/пустой владелец, отсутствие сессии, сохранность
данных при отказе, права PUBLIC, RLS и прежняя семантика счётчиков/SRS.
Требования Docker, Supabase CLI и production-ключей нет. Схема auth и JWT
subject в этих тестах являются фикстурами; HTTP/PostgREST и реальный OAuth
они не проверяют.

Повторное выполнение 007 сохраняет данные. Возвращать определения из
002–006 в качестве rollback нельзя: это снова откроет прежний путь записи.
При проблемах с окружением исправлять права/конфигурацию отдельной
миграцией, сохраняя авторизацию.
