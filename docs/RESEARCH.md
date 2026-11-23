# Дослідження: інструменти, скіли, стек, робота двох агентів

_Листопад 2026. Джерела — внизу. Рейтинги скілів беруться зі сторонніх каталогів, а їхні цифри розходяться між собою. Тож це орієнтири: перед встановленням перевір репозиторій сам (зірки, дата оновлення, вміст SKILL.md)._

## 1. Скіли для Claude Code: що варто взяти

| Що | Навіщо нам | Оцінка |
|---|---|---|
| **Donchitos/Claude-Code-Game-Studios** | Набір «студії»: скіли для архітектури, код-рев'ю, ролі гейм-розробки | Подивитися структуру й запозичити ідеї ролей. Цілком не ставити, бо це зайвий контекст |
| **davila7/claude-code-templates → game-development** | Оркестратор, що спрямовує до платформних скілів | Корисний як шаблон |
| **sickn33/antigravity-awesome-skills → game-development** | Загальний гейм-дев скіл, популярний | Прочитати, взяти потрібне |
| Рушієві скіли (Godot / Unity / Unreal) | Лідери за встановленнями | **Нам не потрібні**, бо гра браузерна |
| **anthropic skill-creator** (вже доступний) | Створення й тестування власних скілів | **Так**: власні вузькі скіли кращі за чужі загальні |

**Головний висновок.** Найбільший виграш дають не чужі «мега-скіли», а **власні вузькі скіли під наш код**. Приклад уже є в репозиторії: `.claude/skills/add-spell`. Загальні скіли з'їдають контекст і часто суперечать архітектурі проєкту. План власних скілів:
- `add-spell` ✅
- `add-game-mode`
- `balance-pass`: прогін симуляцій і звіт по win-rate спелів
- `playtest-report`: Playwright-скріншоти + лог матчу
- `netcode-check`: заміри трафіку й тіків

## 2. Як не втрачати контекст

1. **`AGENTS.md` — єдині правила** для всіх агентів. `CLAUDE.md` імпортує його рядком `@AGENTS.md`. Файл має бути коротким, бо читається в кожній сесії.
2. **Memory bank** у `docs/`:
   - `STATUS.md` — що зараз;
   - `DECISIONS.md` — чому так;
   - `specs/` — що будуємо.

   Агент читає ці файли на старті й оновлює в кінці, тож нова сесія не починає з нуля.
3. **Spec-driven development.** Спершу специфікація фічі (`docs/specs/NNN-назва.md`: мета → поведінка → критерії приймання), потім план, потім код. Специфікація живе поза контекстним вікном, тому її можна передавати між агентами. Інструмент: GitHub **Spec Kit** (за бажанням, бо вистачає й простих markdown-шаблонів).
4. **Субагенти для дослідження.** Пошук по коду й вебу роби в окремому контексті, щоб основний залишався чистим.
5. **Малі задачі.** Одна фіча — одна гілка — одна сесія. Краще `/clear` між задачами, ніж нескінченна сесія з `/compact`.
6. **Data-driven код.** Баланс у `shared/config.js`, тож агентові не треба читати всю логіку, щоб змінити цифри.

## 3. Як організувати роботу двох агентів (Claude + ChatGPT/Codex)

Найпоширеніша практика 2026 року — **не вибирати один, а розподілити ролі**.

### Рекомендована схема

```
          ┌───────────── docs/specs/*.md (специфікації) ─────────────┐
          │                                                          │
   ChatGPT / Codex                                             Claude Code
   (дизайн, специфікації, рев'ю, баланс)               (реалізація, тести, рефактор)
          │                                                          │
          └──── git: гілки codex/* і claude/* → Pull Request → рев'ю ─┘
                        AGENTS.md — спільні правила
                        docs/STATUS.md — спільна пам'ять
```

### Три способи зв'язати агентів (від простого до складного)

1. **Через git і файли (рекомендую почати з цього).** Обидва агенти працюють з одним репозиторієм. Codex читає `AGENTS.md` нативно, Claude — через `CLAUDE.md`. Передача задач іде через `docs/STATUS.md` і специфікації, результат — через Pull Request. Рев'ю робить інший агент: Codex має вбудоване рев'ю PR на GitHub, а Claude Code має `/code-review`. Плюси: прозоро, є історія, жоден агент не залежить від іншого.
2. **Codex як MCP-сервер усередині Claude Code.** Codex CLI вміє працювати як MCP-сервер (інструменти `codex` / `codex-reply`). Є також офіційний плагін OpenAI для Claude Code (`openai/codex-plugin-cc`). Мені не вдалося звірити його деталі з оголошенням OpenAI, тож перевір сам. Типовий сценарій: Claude пише код і перед комітом відправляє дифф у Codex на незалежне рев'ю. Плюс: автоматично. Мінус: подвійні витрати токенів.
3. **Паралельні сесії в окремих worktree.** Агенти працюють одночасно над різними фічами, кожен у своєму `git worktree`. Мерж іде через PR. Підходить для пізніших етапів, коли задач багато.

### Розподіл ролей, що добре працює
- **ChatGPT (чат):** брейншторм механік, лор, назви, баланс-таблиці, чернетки GDD. Результат зберігай у `docs/specs/`.
- **Codex:** незалежне рев'ю PR, пошук багів, друга думка щодо архітектури.
- **Claude Code:** реалізація за специфікацією, тести, Playwright-перевірки, рефакторинг, оновлення `STATUS.md`.
- **Людина:** приймає рішення в `DECISIONS.md`, грає плейтести, мержить PR.

## 4. Стек для повноцінної гри

Висновок з огляду (деталі в `ROADMAP.md`):
- **Мова:** TypeScript скрізь, монорепозиторій (`packages/shared`, `server`, `client`).
- **Сервер:** **Colyseus**. Open-source (MIT), Node.js, авторитетні кімнати, матчмейкінг і синхронізація стану вже вбудовані. Альтернатива — власний сервер, як у прототипі, якщо потрібен повний контроль.
- **Клієнт 2D:** **Phaser 4** (вийшов у 2026) або PixiJS (лише рендер, більше свободи). Пара Phaser + Colyseus — найпоширеніша для браузерних PvP.
- **Клієнт 3D (якщо захочеться):** PlayCanvas або Babylon.js. Colyseus має з ними офіційні приклади.
- **Дані гравця й прокачка:** PostgreSQL + авторизація (наприклад, через Supabase або власний сервіс).
- **Хостинг:** Fly.io / Hetzner / Colyseus Cloud. Регіон — Європа.

Версії й ціни з оглядових статей не звірені з офіційними сайтами. Перевір перед фінальним вибором.

## Джерела
- [Best Game Development Skills for Claude Code (2026)](https://claudeskills.info/best/gaming-skills/)
- [Claude Code Game Studios — Tessl registry](https://tessl.io/registry/skills/github/Donchitos/Claude-Code-Game-Studios)
- [Most-installed game dev skills (Nov 2026)](https://claudemarketplaces.com/best/skills/game-dev)
- [davila7/claude-code-templates — game-development](https://claudemarketplaces.com/skills/davila7/claude-code-templates/game-development)
- [sickn33/antigravity-awesome-skills — game-development](https://claudemarketplaces.com/skills/sickn33/antigravity-awesome-skills/game-development)
- [Peers, Not Rivals: Claude Code and Codex](https://levelup.gitconnected.com/peers-not-rivals-a-two-way-street-between-claude-code-and-codex-9efcd04e13e4)
- [Running Claude Code and Codex together](https://dev.to/prithvi_bharadwaj_d1c875e/running-claude-code-and-codex-together-instead-of-choosing-one-3pa8)
- [Codex plugin for Claude Code — cross-provider review](https://www.mindstudio.ai/blog/openai-codex-plugin-claude-code-cross-provider-review-3)
- [Claude Code vs Codex — same project setup](https://www.mindstudio.ai/blog/claude-code-vs-codex-same-project-setup)
- [Multi-Model Orchestration playbook](https://ao92265.github.io/claude-code-playbook/docs/multi-model-orchestration/)
- [Why Not Both?](https://eric-tramel.github.io/blog/2026-02-09-why-not-both)
- [Colyseus docs](https://docs.colyseus.io/learn)
- [Phaser: Rivalis — multiplayer Phaser games](https://phaser.io/news/2026/05/rivalis-multiplayer-phaser-games)
- [Grapplenauts: Phaser + Colyseus brawler](https://editor.phaser.io/news/2026/03/grapplenauts-phaser-multiplayer-browser-game)
- [Phaser vs PlayCanvas vs Babylon.js 2026](https://tech-insider.org/phaser-vs-playcanvas-vs-babylonjs-2026/)
- [Claude Code memory bank pattern](https://nsclass.github.io/2026/03/15/claude-memory-bank)
- [Context management for large codebases](https://script-kit.github.io/claude-research/docs/core/context-management/patterns/large-codebases)
- [Context management and project setup (SDD)](https://www.educative.io/courses/claude-code/context-management-and-project-setup)
