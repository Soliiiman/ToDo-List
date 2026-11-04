// Data model, persistence (localStorage) and date / recurrence helpers.
(function (App) {
    "use strict";

    var KEY = "taskmanager.v2";
    var LEGACY_KEY = "todo-list.items";
    var DEFAULT_REMINDER_TIME = "09:00"; // used when a task has a date but no time

    var listeners = [];
    var state = null;

    // ---- Helpers ----

    function uid() {
        return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
    }

    function pad(n) { return (n < 10 ? "0" : "") + n; }

    // Local date as YYYY-MM-DD (not toISOString, which is UTC).
    function dateKey(d) {
        return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
    }

    function parseDate(key) {
        var p = key.split("-");
        return new Date(+p[0], +p[1] - 1, +p[2]);
    }

    function addDays(key, n) {
        var d = parseDate(key);
        d.setDate(d.getDate() + n);
        return dateKey(d);
    }

    function today() { return dateKey(new Date()); }

    function daysBetween(fromKey, toKey) {
        return Math.round((parseDate(toKey) - parseDate(fromKey)) / 86400000);
    }

    function dueTimestamp(task) {
        if (!task.due) return null;
        var d = parseDate(task.due);
        var hm = (task.time || DEFAULT_REMINDER_TIME).split(":");
        d.setHours(+hm[0], +hm[1], 0, 0);
        return d.getTime();
    }

    // When the reminder for a task should fire, or null.
    function reminderAt(task) {
        if (task.done) return null;
        if (task.snoozeUntil) return task.snoozeUntil;
        if (task.remind < 0) return null;
        var due = dueTimestamp(task);
        return due === null ? null : due - task.remind * 60000;
    }

    function isOverdue(task) {
        if (task.done || !task.due) return false;
        if (task.due < today()) return true;
        return task.due === today() && !!task.time && dueTimestamp(task) < Date.now();
    }

    // One step of a recurrence rule from a YYYY-MM-DD date.
    function stepDate(key, repeat) {
        var d = parseDate(key);
        switch (repeat) {
            case "daily":
                d.setDate(d.getDate() + 1);
                break;
            case "weekdays": // Sunday - Thursday working week
                do { d.setDate(d.getDate() + 1); } while (d.getDay() === 5 || d.getDay() === 6);
                break;
            case "weekly":
                d.setDate(d.getDate() + 7);
                break;
            case "monthly":
                var day = d.getDate();
                d.setDate(1);
                d.setMonth(d.getMonth() + 1);
                var last = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
                d.setDate(Math.min(day, last));
                break;
            case "yearly":
                d.setFullYear(d.getFullYear() + 1);
                break;
            default:
                return null;
        }
        return dateKey(d);
    }

    // Next due date for a repeating task, never in the past.
    function nextDue(task) {
        var next = stepDate(task.due || today(), task.repeat);
        if (!next) return null;
        while (next < today()) next = stepDate(next, task.repeat);
        return next;
    }

    // ---- State ----

    function defaultState() {
        var t = App.i18n.t;
        return {
            version: 2,
            lists: [
                { id: "inbox", key: "inbox", name: t("inbox"), color: "#6366f1" },
                { id: uid(), key: "personal", name: t("personal"), color: "#10b981" },
                { id: uid(), key: "work", name: t("work"), color: "#f59e0b" }
            ],
            tasks: [],
            settings: { lang: "ar", theme: "auto", sound: true, sort: "due" }
        };
    }

    function normalizeTask(t) {
        return {
            id: t.id || uid(),
            title: String(t.title || t.text || "").slice(0, 300),
            notes: String(t.notes || ""),
            list: t.list || "inbox",
            priority: [0, 1, 2, 3].indexOf(t.priority) >= 0 ? t.priority : 0,
            due: /^\d{4}-\d{2}-\d{2}$/.test(t.due) ? t.due : "",
            time: /^\d{2}:\d{2}$/.test(t.time) ? t.time : "",
            remind: typeof t.remind === "number" ? t.remind : -1,
            repeat: t.repeat || "none",
            tags: Array.isArray(t.tags) ? t.tags : [],
            subtasks: Array.isArray(t.subtasks) ? t.subtasks : [],
            done: !!t.done,
            createdAt: t.createdAt || Date.now(),
            completedAt: t.completedAt || (t.done ? Date.now() : null),
            remindedAt: t.remindedAt || null,
            snoozeUntil: t.snoozeUntil || null
        };
    }

    function load() {
        var raw = null;
        try { raw = JSON.parse(localStorage.getItem(KEY)); } catch (e) { /* ignore */ }

        if (raw && Array.isArray(raw.tasks)) {
            var def = defaultState();
            raw.settings = Object.assign(def.settings, raw.settings || {});
            if (!Array.isArray(raw.lists) || !raw.lists.length) raw.lists = def.lists;
            raw.tasks = raw.tasks.map(normalizeTask);
            return raw;
        }

        var s = defaultState();
        // Migrate tasks from the previous simple to-do list.
        try {
            var legacy = JSON.parse(localStorage.getItem(LEGACY_KEY));
            if (Array.isArray(legacy)) s.tasks = legacy.map(normalizeTask);
        } catch (e) { /* ignore */ }
        return s;
    }

    function save() {
        try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) { /* storage full or blocked */ }
        listeners.forEach(function (fn) { fn(); });
    }

    // ---- Public API ----

    var Store = {
        init: function () { state = load(); return state; },
        get state() { return state; },
        onChange: function (fn) { listeners.push(fn); },
        save: save,

        getTask: function (id) {
            return state.tasks.find(function (t) { return t.id === id; }) || null;
        },
        getList: function (id) {
            return state.lists.find(function (l) { return l.id === id; }) || state.lists[0];
        },

        addTask: function (data) {
            var task = normalizeTask(Object.assign({ createdAt: Date.now() }, data));
            state.tasks.push(task);
            save();
            return task;
        },

        updateTask: function (id, changes) {
            var task = Store.getTask(id);
            if (!task) return null;
            var timingChanged = ["due", "time", "remind"].some(function (k) {
                return k in changes && changes[k] !== task[k];
            });
            Object.assign(task, changes);
            if (timingChanged) { task.remindedAt = null; task.snoozeUntil = null; }
            save();
            return task;
        },

        deleteTask: function (id) {
            var idx = state.tasks.findIndex(function (t) { return t.id === id; });
            if (idx < 0) return null;
            var removed = state.tasks.splice(idx, 1)[0];
            save();
            return { task: removed, index: idx };
        },

        restoreTask: function (entry) {
            state.tasks.splice(Math.min(entry.index, state.tasks.length), 0, entry.task);
            save();
        },

        // Toggle done. A repeating task moves to its next date and leaves a completed copy behind.
        // Returns { task, next } where next is the new due date for repeating tasks.
        toggleTask: function (id) {
            var task = Store.getTask(id);
            if (!task) return null;

            if (!task.done && task.repeat !== "none") {
                var copy = normalizeTask(JSON.parse(JSON.stringify(task)));
                copy.id = uid();
                copy.done = true;
                copy.repeat = "none";
                copy.completedAt = Date.now();
                state.tasks.push(copy);

                var next = nextDue(task);
                task.due = next;
                task.remindedAt = null;
                task.snoozeUntil = null;
                task.subtasks.forEach(function (s) { s.done = false; });
                save();
                return { task: task, next: next };
            }

            task.done = !task.done;
            task.completedAt = task.done ? Date.now() : null;
            task.snoozeUntil = null;
            save();
            return { task: task, next: null };
        },

        addList: function (name, color) {
            var list = { id: uid(), name: name, color: color };
            state.lists.push(list);
            save();
            return list;
        },
        renameList: function (id, name) {
            var list = Store.getList(id);
            list.name = name;
            delete list.key; // a renamed default list no longer follows the UI language
            save();
        },
        deleteList: function (id) {
            if (id === "inbox") return;
            state.lists = state.lists.filter(function (l) { return l.id !== id; });
            state.tasks.forEach(function (t) { if (t.list === id) t.list = "inbox"; });
            save();
        },

        clearCompleted: function () {
            state.tasks = state.tasks.filter(function (t) { return !t.done; });
            save();
        },

        setSetting: function (k, v) {
            state.settings[k] = v;
            save();
        },

        exportJSON: function () {
            return JSON.stringify(state, null, 2);
        },

        // Merge a backup into the current data. Returns the number of tasks imported.
        importJSON: function (text) {
            var data = JSON.parse(text);
            var tasks = Array.isArray(data) ? data : data.tasks;
            if (!Array.isArray(tasks)) throw new Error("invalid");
            (data.lists || []).forEach(function (l) {
                if (l && l.id && !state.lists.some(function (x) { return x.id === l.id; })) {
                    state.lists.push({ id: l.id, name: String(l.name || "?"), color: l.color || "#6366f1" });
                }
            });
            var known = {};
            state.tasks.forEach(function (t) { known[t.id] = true; });
            var count = 0;
            tasks.forEach(function (t) {
                var task = normalizeTask(t);
                if (!task.title) return;
                if (known[task.id]) task.id = uid();
                if (!state.lists.some(function (l) { return l.id === task.list; })) task.list = "inbox";
                state.tasks.push(task);
                count++;
            });
            save();
            return count;
        }
    };

    App.Store = Store;
    App.dates = {
        uid: uid,
        dateKey: dateKey,
        parseDate: parseDate,
        addDays: addDays,
        today: today,
        daysBetween: daysBetween,
        dueTimestamp: dueTimestamp,
        reminderAt: reminderAt,
        isOverdue: isOverdue,
        nextDue: nextDue
    };
})(window.App = window.App || {});
