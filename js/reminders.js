// Reminder engine: checks due reminders, shows system notifications + in-app alerts,
// plays a sound, and exports tasks as .ics calendar events (which remind even when the app is closed).
(function (App) {
    "use strict";

    var CHECK_EVERY_MS = 15000;
    var MAX_LATE_MS = 24 * 3600 * 1000; // don't fire reminders that are more than a day old
    var SNOOZE_MS = 10 * 60000;

    var Store, dates, t;
    var onReminder = function () {};
    var audioCtx = null;

    function supported() { return "Notification" in window; }

    function permission() { return supported() ? Notification.permission : "unsupported"; }

    function requestPermission() {
        if (!supported()) return Promise.resolve("unsupported");
        // Old Safari uses a callback instead of a promise.
        return new Promise(function (resolve) {
            var p = Notification.requestPermission(resolve);
            if (p && p.then) p.then(resolve);
        });
    }

    function beep() {
        if (!Store.state.settings.sound) return;
        try {
            audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
            [0, 0.25].forEach(function (offset) {
                var osc = audioCtx.createOscillator();
                var gain = audioCtx.createGain();
                osc.type = "sine";
                osc.frequency.value = 880;
                var start = audioCtx.currentTime + offset;
                gain.gain.setValueAtTime(0.0001, start);
                gain.gain.exponentialRampToValueAtTime(0.25, start + 0.02);
                gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.2);
                osc.connect(gain).connect(audioCtx.destination);
                osc.start(start);
                osc.stop(start + 0.22);
            });
        } catch (e) { /* audio not available */ }
    }

    // Browsers only allow audio after a user gesture; unlock it on the first interaction.
    function unlockAudio() {
        try {
            audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
            if (audioCtx.state === "suspended") audioCtx.resume();
        } catch (e) { /* ignore */ }
        document.removeEventListener("pointerdown", unlockAudio);
        document.removeEventListener("keydown", unlockAudio);
    }

    function systemNotify(task, body) {
        if (permission() !== "granted") return;
        var title = t("reminderTitle") + ": " + task.title;
        var opts = { body: body, tag: "task-" + task.id, icon: "icon.svg", badge: "icon.svg", data: { id: task.id } };
        // Prefer the service worker (required on Android Chrome), fall back to the page API.
        if (navigator.serviceWorker && navigator.serviceWorker.controller) {
            navigator.serviceWorker.ready.then(function (reg) {
                return reg.showNotification(title, opts);
            }).catch(function () { pageNotify(title, opts); });
        } else {
            pageNotify(title, opts);
        }
    }

    function pageNotify(title, opts) {
        try {
            var n = new Notification(title, opts);
            n.onclick = function () { window.focus(); App.ui.openEditor(opts.data.id); n.close(); };
        } catch (e) { /* some mobile browsers only allow SW notifications */ }
    }

    function check() {
        var now = Date.now();
        Store.state.tasks.forEach(function (task) {
            var at = dates.reminderAt(task);
            if (at === null || at > now || now - at > MAX_LATE_MS) return;
            if (task.remindedAt === at) return; // already fired for this time

            task.remindedAt = at;
            task.snoozeUntil = null;
            Store.save();

            var due = dates.dueTimestamp(task);
            var body = App.ui.formatDue(task, due);
            systemNotify(task, body);
            beep();
            onReminder(task, body);
        });
    }

    function snooze(id) {
        var task = Store.getTask(id);
        if (!task) return;
        task.snoozeUntil = Date.now() + SNOOZE_MS;
        Store.save();
    }

    // ---- Calendar export (.ics) ----

    function icsEscape(s) {
        return String(s).replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
    }

    function icsDate(ts) {
        var d = new Date(ts);
        return d.getUTCFullYear() + pad(d.getUTCMonth() + 1) + pad(d.getUTCDate()) + "T" +
            pad(d.getUTCHours()) + pad(d.getUTCMinutes()) + "00Z";
    }

    function pad(n) { return (n < 10 ? "0" : "") + n; }

    var RRULE = {
        daily: "FREQ=DAILY",
        weekdays: "FREQ=WEEKLY;BYDAY=SU,MO,TU,WE,TH",
        weekly: "FREQ=WEEKLY",
        monthly: "FREQ=MONTHLY",
        yearly: "FREQ=YEARLY"
    };

    function toICS(task) {
        var lines = [
            "BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//ToDo-List//Task Manager//EN", "CALSCALE:GREGORIAN",
            "BEGIN:VEVENT",
            "UID:" + task.id + "@todo-list",
            "DTSTAMP:" + icsDate(Date.now()),
            "SUMMARY:" + icsEscape(task.title)
        ];
        if (task.time) {
            var start = dates.dueTimestamp(task);
            lines.push("DTSTART:" + icsDate(start), "DTEND:" + icsDate(start + 30 * 60000));
        } else {
            var day = task.due.replace(/-/g, "");
            lines.push("DTSTART;VALUE=DATE:" + day, "DTEND;VALUE=DATE:" + dates.addDays(task.due, 1).replace(/-/g, ""));
        }
        if (task.notes) lines.push("DESCRIPTION:" + icsEscape(task.notes));
        if (RRULE[task.repeat]) lines.push("RRULE:" + RRULE[task.repeat]);
        if (task.remind >= 0) {
            // All-day events are anchored at midnight; aim for 09:00 like the in-app reminder.
            var offset = task.time ? task.remind : task.remind - 9 * 60;
            lines.push("BEGIN:VALARM", "ACTION:DISPLAY", "DESCRIPTION:" + icsEscape(task.title),
                "TRIGGER:" + (offset >= 0 ? "-" : "") + "PT" + Math.abs(offset) + "M", "END:VALARM");
        }
        lines.push("END:VEVENT", "END:VCALENDAR");
        return lines.join("\r\n");
    }

    function downloadICS(task) {
        var name = task.title.replace(/[\\/:*?"<>|]+/g, "").slice(0, 40) || "task";
        App.ui.download(name + ".ics", toICS(task), "text/calendar");
    }

    App.Reminders = {
        init: function (handler) {
            Store = App.Store;
            dates = App.dates;
            t = App.i18n.t;
            onReminder = handler;
            document.addEventListener("pointerdown", unlockAudio);
            document.addEventListener("keydown", unlockAudio);
            document.addEventListener("visibilitychange", function () {
                if (!document.hidden) check();
            });
            setInterval(check, CHECK_EVERY_MS);
            check();
        },
        check: check,
        snooze: snooze,
        supported: supported,
        permission: permission,
        requestPermission: requestPermission,
        toICS: toICS,
        downloadICS: downloadICS
    };
})(window.App = window.App || {});
