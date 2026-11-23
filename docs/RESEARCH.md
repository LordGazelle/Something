# Дослідження: інструменти, скіли, стек, робота двох агентів

_Листопад 2026. Джерела — внизу. Рейтинги скілів беруться зі сторонніх каталогів, а їхні цифри розходяться між собою. Тож це орієнтири: перед встановленням перевір репозиторій сам (зірки, дата оновлення, вміст SKILL.md)._

## 1. Скіли для Claude Code: що варто взяти

| Що | Навіщо нам | Оцінка |
|---|---|---|
| **Donchitos/Claude-Code-Game-Studios** | Набір «студії»: скіли для архітектури, код-рев'ю, ролі гейм-розробки | Подивитися структуру й запозичити ідеї ролей. Цілком не ставити, бо це зайвий контекст |
| **davila7/claude-code-templates → game-development** | Оркестратор, що спрямовує до платформних скілів | Корисний як шаблон |
| **sickn33/antigravity-awesome-skills → game-development** | Загальний гейм-дев скіл, популярний | Прочитати, взяти потрібне |
| Рушієві скіли: **godot-gdscript-patterns** (лідер за встановленнями), Unity C# | Патерни рушія: сигнали, сцени, стейт-машини | **Так**, під обраний рушій (гра нативна, див. розділ 4) |
| **Godot MCP-сервери** (Coding-Solo/godot-mcp, hybridindie/godot-mcp, godot-ai) | Claude керує живим редактором Godot: сцени, вузли, запуск, логи | **Так** для Godot. Почати з найпростішого (Coding-Solo), безпекову частину перевірити самому |
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

## 4. Стек для повноцінної гри (нативна, ПК / Steam)

Повна гра буде **нативною**, не браузерною. Браузерний прототип лишається полігоном для плейтестів і балансу.

### Порівняння рушіїв для нашого жанру (top-down арена, 2–10 гравців, PvP)

| | **Godot 4 (C#)** | **Unity 6** | Unreal 5 |
|---|---|---|---|
| Ліцензія / ціна | MIT, безкоштовно, без роялті | Безкоштовно до порогу доходу, потім підписка | 5% роялті після $1M |
| Мережа | High-level multiplayer (ENet), RPC, `MultiplayerSynchronizer`. Лобі, матчмейкінг і NAT вирішуєш сам: GodotSteam / Steam Networking або власний relay | Netcode for GameObjects (безкоштовний), FishNet (безкоштовний, сильне передбачення), Photon Fusion (платний, топ для PvP), а також Relay і Dedicated Server у комплекті | Найкраща вбудована реплікація, але важкий для маленької 2.5D гри |
| Робота з AI-агентами | ✅ Сцени `.tscn` — читабельний текст. Є кілька MCP-серверів, через які Claude керує редактором. Є скіли GDScript | ⚠️ Сцени й префаби в YAML з GUID, і агенту важче їх правити | ⚠️ Blueprints бінарні, тож агент їх фактично не бачить |
| Ризики | Мережу для змагальної гри доведеться дописувати (передбачення, лаг-компенсація) | Залежність від політики Unity, важчий редактор | Надмірний для жанру |

### Рекомендація: **Godot 4 + C#**, власна авторитетна симуляція

Чому:
1. **Найкраще підходить для роботи з AI.** Текстові сцени, код без «магії» редактора, MCP-сервери. Claude і Codex зможуть повноцінно правити й запускати проєкт.
2. **Логіка гри нескладна:** кола, імпульси, снаряди. Вбудована фізика не потрібна, симуляцію ми пишемо самі, як у прототипі. Тож головна сильна сторона Unity (готовий нетворк-стек) для нас важить менше.
3. **Безкоштовно і без роялті.** Головний мінус — немає готового лобі й передбачення. Закриваємо так:
   - **Архітектура:** детермінована симуляція в окремій C#-бібліотеці `Warlock.Sim`, без залежності від рушія. Її запускають і сервер, і клієнт для передбачення. Ця ж бібліотека дає швидкі тести й ботів-симуляторів для балансу.
   - **Сервер:** headless-збірка Godot або чистий .NET-процес з `Warlock.Sim`. Матчі на виділених серверах. Транспорт — ENet (UDP), пізніше Steam Networking Sockets для лобі й NAT.
   - **Лобі, друзі, інвайти:** Steamworks через GodotSteam / Steamworks.NET.
   - **Акаунти, прогресія, рейтинг:** окремий бекенд (наприклад, Nakama, open-source, або власний .NET + PostgreSQL).

**Коли краще Unity:** якщо в команді вже є досвід Unity або хочеться готового передбачення без власного коду. Тоді Unity 6 + FishNet (безкоштовно) або Photon Fusion (платно).

### Що перенести з прототипу
- `shared/config.js` → `data/spells.json` (дані спелів і баланс). Обидві версії читають один формат.
- Формули відкидання, звуження арени, кулдаунів, магазину й ботів переписуються на C# 1:1.
- Протокол наміри → знімки лишається, додається передбачення власного руху.

Версії, ціни й ліцензійні пороги звір з офіційними сайтами перед фінальним вибором. Огляди 2026 року розходяться в цифрах.

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
- [Godot vs Unity 2026](https://tech-insider.org/godot-vs-unity-2026/)
- [Godot multiplayer: що є і чого немає](https://ziva.sh/blogs/godot-multiplayer)
- [Godot 4 multiplayer vs Unity (Rivet)](https://rivet.dev/blog/godot-multiplayer-compared-to-unity/)
- [Godot forum: multiplayer architecture for Steam](https://forum.godotengine.org/t/deciding-on-multiplayer-architecture-for-steam/140817)
- [Unity 6 multiplayer manual](https://docs.unity3d.com/Manual/multiplayer-new.html)
- [Unity: how to choose the right netcode](https://unity.com/blog/games/how-to-choose-the-right-netcode-for-your-game)
- [NGO vs Mirror vs FishNet (Unity discussions)](https://discussions.unity.com/t/so-what-is-the-difference-between-netcode-for-gameobjects-mirror-and-fishnet-which-one-is-better-for-fast-co-op/1678432)
- [Coding-Solo/godot-mcp](https://claudemarketplaces.com/mcp/coding-solo/godot-mcp)
- [hybridindie/godot-mcp](https://github.com/hybridindie/godot-mcp)
- [Godot MCP server + addon (forum)](https://forum.godotengine.org/t/godot-free-open-source-mcp-server-addon/133890)
