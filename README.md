<p align="center">
  <img src="assets/iconClient.png" alt="SAMOT" width="280">
</p>

<h1 align="center">SAMOT Launcher</h1>

<p align="center"><b>Твой мир. Твоя игра. Твой лаунчер.</b></p>

<p align="center">
  <img alt="Version" src="https://img.shields.io/badge/version-1.0.0-ff6b1a">
  <img alt="Platform" src="https://img.shields.io/badge/platform-Windows-2ea3f2">
  <img alt="License" src="https://img.shields.io/badge/license-MIT-39d98a">
  <img alt="Stack" src="https://img.shields.io/badge/stack-Electron%20%2B%20Supabase-7c5cff">
</p>

---

## Что это

**SAMOT Launcher** — десктопный лаунчер, который превращает твою игру в доступный продукт: один установщик, автоматическое получение игры и её обновлений, новости и баннеры в одном окне, вход через Google или email.

Для игроков — только «Нажми «Скачать» и играй».

## Возможности

### Для игрока
- 🚀 **Одно окно — несколько игр**: переключение между проектами в сайдбаре
- 📰 **Новости и баннеры** прямо в лаунчере, карусель на главной
- 📦 **Дельта-обновления**: докачиваются только изменённые файлы, игра скачивается не целиком
- ⏸ **Пауза/продолжение** и **докачка с места обрыва**: перезапуски не обнуляют прогресс
- 🔍 **Проверка целостности**: SHA-256 каждого файла, битое перекачивается автоматически
- 🔐 Вход через Google или email, «Запомнить устройство», офлайн-режим
- 🌙 Тёмная тема.

## Скачать

| Что | Файл |
|---|---|
| **SAMOT Launcher** (игрок) | [SAMOT Launcher Setup 1.0.0.exe](https://github.com/RevacholFrend/samot-launcher/releases/download/v1.0.0/SAMOT.Launcher.Setup.1.0.0.exe) |

> ℹ Самоподписанный сертификат: при первом запуске Windows SmartScreen может предупредить.
> Исходный код открыт — проверяйте спокойно.

## Скриншоты

<p align="center">
  <img src="docs/screenshots/launcher-main.png" alt="Главная и новости" width="49%">
  <img src="docs/screenshots/launcher-auth.png" alt="Вход" width="49%">
</p>
<p align="center">
  <img src="docs/screenshots/admin-panel.png" alt="SAMOT Admin: новости и баннеры" width="49%">
  <img src="docs/screenshots/packager.png" alt="SAMOT Packager" width="49%">
</p>

Требования: Windows 10+, Node.js LTS. Бэкенд — Supabase (см. `supabase/schema.sql`).

## Лицензия

MIT — см. [LICENSE](LICENSE).
