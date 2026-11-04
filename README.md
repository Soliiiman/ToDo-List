# مهامي — Task Manager

A complete task manager with reminders, built with plain HTML, CSS and JavaScript (no build step).
Arabic (RTL) by default, with an English option.

📖 **[الدليل الكامل بالعربي: التثبيت والتشغيل والاستخدام](docs/TUTORIAL.md)**

## Features

- **Smart views:** Today (with overdue tasks), Upcoming, All tasks, Important, Completed
- **Lists:** create, rename and delete your own color-coded lists
- **Task details:** notes, priority (low / medium / high), due date and time, tags, subtasks
- **Reminders:** at the due time, or 5 / 15 / 30 / 60 minutes or 1 day before, with a system notification, an in-app alert with sound, and a 10-minute snooze
- **Repeating tasks:** daily, workdays (Sun–Thu), weekly, monthly, yearly
- **Add to calendar:** export any task as an `.ics` event (with its reminder and repeat rule) so your phone or calendar app reminds you even when this app is closed
- **Quick add:** type `#tag` for tags and `!1`–`!3` for priority, e.g. `Call Ahmed #work !3`
- **Search** across titles, notes, tags and subtasks; click a tag to filter by it
- **Sorting** by due date (grouped: overdue, today, tomorrow, this week, later), priority, date added or name
- **Daily progress** bar, undo for deletes and completions
- **Backup:** export / import your data as JSON
- Light / dark / auto theme, mobile layout, keyboard shortcuts (`N` new task, `/` search)
- Installable as an app (PWA) and works offline

All data is stored locally in your browser (`localStorage`).

## Running

Open `index.html` directly, or serve the folder (needed for offline support and the most reliable notifications):

```sh
npx http-server .
```

## About reminders

Browser reminders fire while the app is open, including in a background tab. To be reminded while
the app is closed, open the task and use **Add to calendar**.

## Files

- `index.html` – page structure
- `css/styles.css` – styles (RTL-aware, light/dark)
- `js/i18n.js` – Arabic and English text
- `js/store.js` – data model, storage, dates and repeat rules
- `js/reminders.js` – reminder checks, notifications, sound, `.ics` export
- `js/app.js` – interface and event handling
- `sw.js`, `manifest.webmanifest`, `icon.svg` – offline support and app install
