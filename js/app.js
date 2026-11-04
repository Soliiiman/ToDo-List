// UI: views, rendering, task editor, settings, toasts.
(function (App) {
    "use strict";

    var Store = App.Store;
    var dates = App.dates;
    var i18n = App.i18n;
    var t = i18n.t;

    var $ = function (id) { return document.getElementById(id); };

    var LIST_COLORS = ["#6366f1", "#10b981", "#f59e0b", "#ef4444", "#3b82f6", "#ec4899", "#14b8a6", "#8b5cf6"];
    var PRIORITY_KEYS = ["pNone", "pLow", "pMedium", "pHigh"];
    var REPEAT_KEYS = { daily: "repDaily", weekdays: "repWeekdays", weekly: "repWeekly", monthly: "repMonthly", yearly: "repYearly" };

    var SMART_VIEWS = [
        { id: "today", icon: "☀", key: "today" },
        { id: "upcoming", icon: "📅", key: "upcoming" },
        { id: "all", icon: "☰", key: "all" },
        { id: "important", icon: "★", key: "important" },
        { id: "completed", icon: "✓", key: "completed" }
    ];

    var ui = {
        view: "today",
        search: "",
        editingId: null,
        draftSubtasks: []
    };

    // ---- Small DOM helper ----

    function el(tag, attrs, children) {
        var node = document.createElement(tag);
        Object.keys(attrs || {}).forEach(function (k) {
            var v = attrs[k];
            if (v === null || v === undefined || v === false) return;
            if (k === "class") node.className = v;
            else if (k === "text") node.textContent = v;
            else if (k === "style") node.style.cssText = v;
            else if (k.indexOf("on") === 0) node.addEventListener(k.slice(2), v);
            else node.setAttribute(k, v === true ? "" : v);
        });
        (children || []).forEach(function (c) {
            if (c === null || c === undefined || c === false) return;
            node.appendChild(typeof c === "string" ? document.createTextNode(c) : c);
        });
        return node;
    }

    // ---- Formatting ----

    function fmtNum(n) {
        return new Intl.NumberFormat(i18n.locale()).format(n);
    }

    function fmtTime(hhmm) {
        var p = hhmm.split(":");
        var d = new Date(2000, 0, 1, +p[0], +p[1]);
        return new Intl.DateTimeFormat(i18n.locale(), { hour: "numeric", minute: "2-digit" }).format(d);
    }

    function fmtDay(key) {
        var diff = dates.daysBetween(dates.today(), key);
        if (diff === 0) return t("today");
        if (diff === 1) return t("tomorrow");
        if (diff === -1) return t("yesterday");
        var d = dates.parseDate(key);
        if (diff > 1 && diff < 7) {
            return new Intl.DateTimeFormat(i18n.locale(), { weekday: "long" }).format(d);
        }
        var opts = { day: "numeric", month: "short" };
        if (d.getFullYear() !== new Date().getFullYear()) opts.year = "numeric";
        return new Intl.DateTimeFormat(i18n.locale(), opts).format(d);
    }

    function formatDue(task) {
        if (!task.due) return "";
        return fmtDay(task.due) + (task.time ? " " + fmtTime(task.time) : "");
    }

    // Built-in lists show in the current language until the user renames them.
    function listName(l) {
        return l.key ? t(l.key) : l.name;
    }

    function download(filename, text, type) {
        var blob = new Blob([text], { type: type });
        var a = el("a", { href: URL.createObjectURL(blob), download: filename });
        document.body.appendChild(a);
        a.click();
        setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 0);
    }

    // ---- i18n / theme ----

    function applyI18n() {
        i18n.setLang(Store.state.settings.lang);
        document.querySelectorAll("[data-i18n]").forEach(function (n) { n.textContent = t(n.dataset.i18n); });
        document.querySelectorAll("[data-i18n-placeholder]").forEach(function (n) { n.placeholder = t(n.dataset.i18nPlaceholder); });
        document.querySelectorAll("[data-i18n-title]").forEach(function (n) {
            n.title = t(n.dataset.i18nTitle);
            n.setAttribute("aria-label", n.title);
        });
        document.title = t("appName");
    }

    function applyTheme() {
        var theme = Store.state.settings.theme;
        if (theme === "auto") document.documentElement.removeAttribute("data-theme");
        else document.documentElement.setAttribute("data-theme", theme);
    }

    // ---- Filtering / sorting ----

    function viewFilter(view) {
        var today = dates.today();
        if (view === "today") return function (x) { return !x.done && x.due && x.due <= today; };
        if (view === "upcoming") return function (x) { return !x.done && x.due > today; };
        if (view === "all") return function (x) { return !x.done; };
        if (view === "important") return function (x) { return !x.done && x.priority === 3; };
        if (view === "completed") return function (x) { return x.done; };
        var listId = view.slice(5); // "list:<id>"
        return function (x) { return !x.done && x.list === listId; };
    }

    function searchFilter(q) {
        q = q.trim().toLowerCase();
        if (!q) return null;
        if (q[0] === "#" && q.length > 1) {
            var tag = q.slice(1);
            return function (x) { return x.tags.some(function (tg) { return tg.toLowerCase() === tag; }); };
        }
        return function (x) {
            return x.title.toLowerCase().indexOf(q) >= 0 ||
                x.notes.toLowerCase().indexOf(q) >= 0 ||
                x.tags.some(function (tg) { return tg.toLowerCase().indexOf(q) >= 0; }) ||
                x.subtasks.some(function (s) { return s.text.toLowerCase().indexOf(q) >= 0; });
        };
    }

    function sorter(mode) {
        var dueKey = function (x) { return x.due ? x.due + (x.time || "99:99") : "9999"; };
        var cmp = {
            due: function (a, b) {
                return dueKey(a) < dueKey(b) ? -1 : dueKey(a) > dueKey(b) ? 1 : b.priority - a.priority;
            },
            priority: function (a, b) {
                return b.priority - a.priority || (dueKey(a) < dueKey(b) ? -1 : dueKey(a) > dueKey(b) ? 1 : 0);
            },
            created: function (a, b) { return b.createdAt - a.createdAt; },
            title: function (a, b) { return a.title.localeCompare(b.title, i18n.locale()); }
        };
        return cmp[mode] || cmp.due;
    }

    function bucketOf(task) {
        if (!task.due) return "noDate";
        if (dates.isOverdue(task) && task.due < dates.today()) return "overdue";
        var diff = dates.daysBetween(dates.today(), task.due);
        if (diff <= 0) return "today";
        if (diff === 1) return "tomorrow";
        if (diff < 7) return "thisWeek";
        return "later";
    }

    var BUCKET_ORDER = ["overdue", "today", "tomorrow", "thisWeek", "later", "noDate"];

    // ---- Rendering ----

    function render() {
        renderSidebar();
        renderTasks();
    }

    function countFor(view) {
        return Store.state.tasks.filter(viewFilter(view)).length;
    }

    function navItem(id, icon, label, count, color, extra) {
        var active = ui.view === id;
        var overdue = id === "today" ? Store.state.tasks.filter(dates.isOverdue).length : 0;
        return el("div", { class: "nav-item" + (active ? " active" : "") }, [
            el("button", { type: "button", class: "nav-link", "data-view": id, "aria-current": active ? "page" : null }, [
                color ? el("span", { class: "dot", style: "background:" + color }) : el("span", { class: "nav-icon", text: icon }),
                el("span", { class: "nav-label", text: label }),
                overdue ? el("span", { class: "badge danger", title: t("overdue"), text: fmtNum(overdue) }) : null,
                count ? el("span", { class: "nav-count", text: fmtNum(count) }) : null
            ]),
            extra || null
        ]);
    }

    function renderSidebar() {
        var smart = $("smartViews");
        smart.innerHTML = "";
        SMART_VIEWS.forEach(function (v) {
            smart.appendChild(navItem(v.id, v.icon, t(v.key), v.id === "completed" ? 0 : countFor(v.id)));
        });

        var lists = $("listViews");
        lists.innerHTML = "";
        Store.state.lists.forEach(function (l) {
            var actions = l.id === "inbox" ? null : el("span", { class: "nav-actions" }, [
                el("button", { type: "button", class: "icon-btn small", "data-rename": l.id, title: t("renameList"), "aria-label": t("renameList"), text: "✎" }),
                el("button", { type: "button", class: "icon-btn small", "data-delete-list": l.id, title: t("deleteList"), "aria-label": t("deleteList"), text: "✕" })
            ]);
            lists.appendChild(navItem("list:" + l.id, "", listName(l), countFor("list:" + l.id), l.color, actions));
        });

        // Today's progress: tasks due today (incl. done today) vs. done.
        var today = dates.today();
        var relevant = Store.state.tasks.filter(function (x) {
            var doneToday = x.done && x.completedAt && dates.dateKey(new Date(x.completedAt)) === today;
            return doneToday || (!x.done && x.due && x.due <= today);
        });
        var done = relevant.filter(function (x) { return x.done; }).length;
        $("progressText").textContent = t("progressOf", { done: fmtNum(done), total: fmtNum(relevant.length) });
        $("progressFill").style.width = (relevant.length ? Math.round(done / relevant.length * 100) : 0) + "%";
    }

    function viewTitle() {
        if (ui.search.trim()) return t("search").replace(/\.+$/, "") + ": " + ui.search.trim();
        var smart = SMART_VIEWS.find(function (v) { return v.id === ui.view; });
        if (smart) return t(smart.key);
        return listName(Store.getList(ui.view.slice(5)));
    }

    function renderTasks() {
        var area = $("taskArea");
        area.innerHTML = "";

        var sf = searchFilter(ui.search);
        var tasks = Store.state.tasks.filter(sf || viewFilter(ui.view));
        var isCompletedView = ui.view === "completed" && !sf;
        var sort = Store.state.settings.sort;

        if (isCompletedView) {
            tasks.sort(function (a, b) { return (b.completedAt || 0) - (a.completedAt || 0); });
        } else {
            tasks.sort(sorter(sort));
        }

        $("viewTitle").textContent = viewTitle();
        $("viewCount").textContent = t("tasksCount", { n: fmtNum(tasks.length) });

        if (!tasks.length) {
            area.appendChild(el("div", { class: "empty" }, [
                el("div", { class: "empty-icon", text: sf ? "🔍" : "✨" }),
                el("p", { class: "empty-title", text: sf ? t("emptySearch") : t("emptyTitle") }),
                sf ? null : el("p", { class: "muted", text: t("emptyHint") })
            ]));
        } else if (sort === "due" && !isCompletedView && !sf) {
            var groups = {};
            tasks.forEach(function (x) { (groups[bucketOf(x)] = groups[bucketOf(x)] || []).push(x); });
            BUCKET_ORDER.forEach(function (b) {
                if (!groups[b]) return;
                area.appendChild(el("h2", { class: "group-title" + (b === "overdue" ? " danger" : "") }, [
                    t(b), el("span", { class: "group-count", text: fmtNum(groups[b].length) })
                ]));
                area.appendChild(taskList(groups[b]));
            });
        } else {
            area.appendChild(taskList(tasks));
        }

        // Completed tasks of this list / of today, tucked away below.
        if (!sf && (ui.view.indexOf("list:") === 0 || ui.view === "today")) {
            var today = dates.today();
            var listId = ui.view.slice(5);
            var doneHere = Store.state.tasks.filter(function (x) {
                if (!x.done) return false;
                if (ui.view === "today") return x.completedAt && dates.dateKey(new Date(x.completedAt)) === today;
                return x.list === listId;
            }).sort(function (a, b) { return (b.completedAt || 0) - (a.completedAt || 0); });
            if (doneHere.length) {
                var details = el("details", { class: "done-section" }, [
                    el("summary", {}, [t("completed") + " ", el("span", { class: "group-count", text: fmtNum(doneHere.length) })]),
                    taskList(doneHere)
                ]);
                if (ui.doneOpen) details.open = true;
                details.addEventListener("toggle", function () { ui.doneOpen = details.open; });
                area.appendChild(details);
            }
        }
    }

    function taskList(tasks) {
        var ul = el("ul", { class: "tasks" });
        tasks.forEach(function (x) { ul.appendChild(taskItem(x)); });
        return ul;
    }

    function taskItem(task) {
        var list = Store.getList(task.list);
        var overdue = dates.isOverdue(task);
        var meta = [];

        if (task.done && task.completedAt) {
            meta.push(el("span", { class: "meta", text: t("doneOn", { date: fmtDay(dates.dateKey(new Date(task.completedAt))) }) }));
        } else if (task.due) {
            meta.push(el("span", { class: "meta due" + (overdue ? " danger" : task.due === dates.today() ? " accent" : "") }, ["📅 " + formatDue(task)]));
        }
        if (task.remind >= 0 && task.due && !task.done) meta.push(el("span", { class: "meta", title: t("reminder"), text: "🔔" }));
        if (task.repeat !== "none") meta.push(el("span", { class: "meta", title: t(REPEAT_KEYS[task.repeat]), text: "🔁 " + t(REPEAT_KEYS[task.repeat]) }));
        if (task.subtasks.length) {
            var sd = task.subtasks.filter(function (s) { return s.done; }).length;
            meta.push(el("span", { class: "meta", text: "☑ " + fmtNum(sd) + "/" + fmtNum(task.subtasks.length) }));
        }
        if (task.notes) meta.push(el("span", { class: "meta", title: t("notes"), text: "📝" }));
        if (ui.view.indexOf("list:") !== 0) {
            meta.push(el("span", { class: "meta list-tag" }, [el("span", { class: "dot", style: "background:" + list.color }), listName(list)]));
        }
        task.tags.forEach(function (tg) {
            meta.push(el("button", { type: "button", class: "tag", "data-tag": tg, text: "#" + tg }));
        });

        return el("li", { class: "task p" + task.priority + (task.done ? " done" : "") + (overdue ? " overdue" : ""), "data-id": task.id }, [
            el("button", {
                type: "button", class: "check", "data-toggle": task.id, role: "checkbox",
                "aria-checked": String(task.done), "aria-label": task.title
            }),
            el("button", { type: "button", class: "task-body", "data-open": task.id }, [
                el("span", { class: "task-title", text: task.title }),
                meta.length ? el("span", { class: "task-meta" }, meta) : null
            ]),
            task.priority ? el("span", { class: "prio-flag", title: t("priority") + ": " + t(PRIORITY_KEYS[task.priority]), text: "⚑" }) : null,
            el("button", { type: "button", class: "icon-btn delete-btn", "data-delete": task.id, title: t("delete"), "aria-label": t("delete"), text: "🗑" })
        ]);
    }

    // ---- Toasts ----

    function toast(message, actions, opts) {
        opts = opts || {};
        var node = el("div", { class: "toast" + (opts.kind ? " " + opts.kind : ""), role: opts.kind === "reminder" ? "alert" : "status" });
        var close = function () {
            node.classList.add("leaving");
            setTimeout(function () { node.remove(); }, 200);
        };
        var body = el("div", { class: "toast-body" }, [
            opts.title ? el("strong", { text: opts.title }) : null,
            el("span", { text: message })
        ]);
        node.appendChild(body);
        if (actions && actions.length) {
            node.appendChild(el("div", { class: "toast-actions" }, actions.map(function (a) {
                return el("button", { type: "button", class: "btn small" + (a.primary ? " primary" : ""), text: a.label, onclick: function () { a.run(); close(); } });
            })));
        }
        $("toasts").appendChild(node);
        if (!opts.sticky) setTimeout(close, opts.duration || 4500);
        return close;
    }

    function showReminder(task, body) {
        toast(task.title + (body ? " — " + body : ""), [
            { label: t("markDone"), primary: true, run: function () { completeTask(task.id); } },
            { label: t("snooze"), run: function () { App.Reminders.snooze(task.id); } },
            { label: t("dismiss"), run: function () {} }
        ], { kind: "reminder", sticky: true, title: t("reminderTitle") });
    }

    // ---- Actions ----

    function completeTask(id) {
        var wasDone = (Store.getTask(id) || {}).done;
        var res = Store.toggleTask(id);
        if (!res) return;
        if (res.next) toast(t("nextOccurrence", { date: fmtDay(res.next) }), null, { kind: "success", title: t("taskCompleted") });
        else if (!wasDone) toast(t("taskCompleted"), [{ label: t("undo"), run: function () { Store.toggleTask(id); } }], { kind: "success" });
    }

    function deleteTask(id) {
        var entry = Store.deleteTask(id);
        if (!entry) return;
        toast(t("taskDeleted"), [{ label: t("undo"), primary: true, run: function () { Store.restoreTask(entry); } }]);
    }

    function quickAdd(text) {
        var tags = [];
        var priority = 0;
        text = text.replace(/(^|\s)#([^\s#]+)/g, function (_, sp, tag) { tags.push(tag); return sp; });
        text = text.replace(/(^|\s)!([1-3])(?=\s|$)/g, function (_, sp, p) { priority = +p; return sp; });
        text = text.replace(/\s+/g, " ").trim();
        if (!text) return false;

        var data = { title: text, tags: tags, priority: priority };
        if (ui.view === "today") data.due = dates.today();
        if (ui.view === "upcoming") data.due = dates.addDays(dates.today(), 1);
        if (ui.view === "important" && !priority) data.priority = 3;
        if (ui.view.indexOf("list:") === 0) data.list = ui.view.slice(5);
        Store.addTask(data);
        return true;
    }

    function setView(view) {
        ui.view = view;
        ui.search = "";
        $("searchInput").value = "";
        closeSidebar();
        render();
    }

    // ---- Editor ----

    function openEditor(id, defaults) {
        var task = id ? Store.getTask(id) : null;
        if (id && !task) return;
        var f = $("editorForm");
        ui.editingId = id || null;

        var listSel = f.elements.list;
        listSel.innerHTML = "";
        Store.state.lists.forEach(function (l) { listSel.appendChild(el("option", { value: l.id, text: listName(l) })); });

        var src = task || Object.assign({ title: "", notes: "", list: "inbox", priority: 0, due: "", time: "", remind: -1, repeat: "none", tags: [], subtasks: [] }, defaults);
        $("editorTitle").textContent = task ? t("editTask") : t("newTask");
        f.elements.title.value = src.title;
        f.elements.notes.value = src.notes;
        f.elements.list.value = src.list;
        f.elements.priority.value = String(src.priority);
        f.elements.due.value = src.due;
        f.elements.time.value = src.time;
        f.elements.remind.value = String(src.remind);
        f.elements.repeat.value = src.repeat;
        f.elements.tags.value = src.tags.join(", ");
        ui.draftSubtasks = JSON.parse(JSON.stringify(src.subtasks));
        renderSubtasks();
        $("remindError").hidden = true;
        $("deleteTaskBtn").hidden = !task;
        $("icsBtn").hidden = !task || !task.due;

        $("editor").showModal();
        if (!task) f.elements.title.focus();
    }

    function renderSubtasks() {
        var ul = $("subtaskList");
        ul.innerHTML = "";
        ui.draftSubtasks.forEach(function (s, i) {
            ul.appendChild(el("li", { class: "subtask" + (s.done ? " done" : "") }, [
                el("input", { type: "checkbox", checked: s.done, "data-sub-toggle": i, "aria-label": s.text }),
                el("input", { type: "text", class: "subtask-text", value: s.text, "data-sub-edit": i, "aria-label": t("subtasks") }),
                el("button", { type: "button", class: "icon-btn small", "data-sub-delete": i, title: t("delete"), "aria-label": t("delete"), text: "✕" })
            ]));
        });
    }

    function saveEditor() {
        var f = $("editorForm");
        var title = f.elements.title.value.trim();
        if (!title) { f.elements.title.focus(); return false; }

        var remind = +f.elements.remind.value;
        var due = f.elements.due.value;
        if (remind >= 0 && !due) {
            $("remindError").hidden = false;
            f.elements.due.focus();
            return false;
        }

        var data = {
            title: title,
            notes: f.elements.notes.value.trim(),
            list: f.elements.list.value,
            priority: +f.elements.priority.value,
            due: due,
            time: f.elements.time.value,
            remind: remind,
            repeat: f.elements.repeat.value,
            tags: f.elements.tags.value.split(/[,،]/).map(function (s) { return s.trim().replace(/^#/, ""); }).filter(Boolean),
            subtasks: ui.draftSubtasks.filter(function (s) { return s.text.trim(); })
        };

        if (ui.editingId) Store.updateTask(ui.editingId, data);
        else Store.addTask(data);

        if (remind >= 0 && App.Reminders.permission() === "default") {
            toast(t("notificationsHint"), [{ label: t("enableNotifications"), primary: true, run: enableNotifications }], { duration: 9000 });
        }
        App.Reminders.check();
        return true;
    }

    // ---- Settings ----

    function enableNotifications() {
        App.Reminders.requestPermission().then(renderSettings);
    }

    function renderSettings() {
        var p = App.Reminders.permission();
        var status = { granted: "notificationsOn", denied: "notificationsBlocked", unsupported: "notificationsUnsupported", "default": "off" }[p];
        $("notifyStatus").textContent = p === "default" ? t("notifications") + ": " + t("off") : t(status);
        $("enableNotifyBtn").hidden = p !== "default";
        $("notifyBtn").classList.toggle("on", p === "granted");
        $("soundToggle").checked = !!Store.state.settings.sound;
        [["langSeg", "lang"], ["themeSeg", "theme"]].forEach(function (pair) {
            $(pair[0]).querySelectorAll("button").forEach(function (b) {
                var on = b.dataset.value === Store.state.settings[pair[1]];
                b.classList.toggle("active", on);
                b.setAttribute("aria-pressed", String(on));
            });
        });
    }

    // ---- Sidebar (mobile) ----

    function openSidebar() { $("sidebar").classList.add("open"); $("backdrop").hidden = false; }
    function closeSidebar() { $("sidebar").classList.remove("open"); $("backdrop").hidden = true; }

    // ---- Wiring ----

    function bind() {
        $("quickAdd").addEventListener("submit", function (ev) {
            ev.preventDefault();
            if (quickAdd($("quickInput").value)) $("quickInput").value = "";
        });

        $("searchInput").addEventListener("input", function (ev) { ui.search = ev.target.value; renderTasks(); });

        $("sortSelect").addEventListener("change", function (ev) { Store.setSetting("sort", ev.target.value); });

        $("taskArea").addEventListener("click", function (ev) {
            var b = ev.target.closest("button");
            if (!b) return;
            if (b.dataset.toggle) completeTask(b.dataset.toggle);
            else if (b.dataset.open) openEditor(b.dataset.open);
            else if (b.dataset.delete) deleteTask(b.dataset.delete);
            else if (b.dataset.tag) {
                ui.search = "#" + b.dataset.tag;
                $("searchInput").value = ui.search;
                renderTasks();
            }
        });

        document.querySelector(".sidebar").addEventListener("click", function (ev) {
            var b = ev.target.closest("button");
            if (!b) return;
            if (b.dataset.view) setView(b.dataset.view);
            else if (b.dataset.rename) {
                var l = Store.getList(b.dataset.rename);
                var name = prompt(t("listNamePrompt"), listName(l));
                if (name && name.trim()) Store.renameList(l.id, name.trim());
            } else if (b.dataset.deleteList) {
                var dl = Store.getList(b.dataset.deleteList);
                if (confirm(t("deleteListConfirm", { name: listName(dl), inbox: listName(Store.getList("inbox")) }))) {
                    if (ui.view === "list:" + dl.id) ui.view = "today";
                    Store.deleteList(dl.id);
                }
            }
        });

        $("addListBtn").addEventListener("click", function () {
            var name = prompt(t("listNamePrompt"));
            if (!name || !name.trim()) return;
            var color = LIST_COLORS[Store.state.lists.length % LIST_COLORS.length];
            var list = Store.addList(name.trim(), color);
            setView("list:" + list.id);
        });

        $("menuBtn").addEventListener("click", openSidebar);
        $("backdrop").addEventListener("click", closeSidebar);

        // Editor
        $("editorForm").addEventListener("submit", function (ev) {
            ev.preventDefault();
            if (saveEditor()) $("editor").close();
        });
        $("editorForm").elements.due.addEventListener("input", function () { $("remindError").hidden = true; });
        $("deleteTaskBtn").addEventListener("click", function () {
            if (ui.editingId) deleteTask(ui.editingId);
            $("editor").close();
        });
        $("icsBtn").addEventListener("click", function () {
            var task = Store.getTask(ui.editingId);
            if (task) App.Reminders.downloadICS(task);
        });
        $("subtaskInput").addEventListener("keydown", function (ev) {
            if (ev.key !== "Enter") return;
            ev.preventDefault();
            var text = ev.target.value.trim();
            if (!text) return;
            ui.draftSubtasks.push({ id: dates.uid(), text: text, done: false });
            ev.target.value = "";
            renderSubtasks();
        });
        $("subtaskList").addEventListener("change", function (ev) {
            var i = ev.target.dataset.subToggle;
            if (i !== undefined) { ui.draftSubtasks[i].done = ev.target.checked; renderSubtasks(); }
        });
        $("subtaskList").addEventListener("input", function (ev) {
            var i = ev.target.dataset.subEdit;
            if (i !== undefined) ui.draftSubtasks[i].text = ev.target.value;
        });
        $("subtaskList").addEventListener("keydown", function (ev) {
            if (ev.key === "Enter" && ev.target.dataset.subEdit !== undefined) ev.preventDefault();
        });
        $("subtaskList").addEventListener("click", function (ev) {
            var b = ev.target.closest("[data-sub-delete]");
            if (b) { ui.draftSubtasks.splice(+b.dataset.subDelete, 1); renderSubtasks(); }
        });

        // Settings
        $("settingsBtn").addEventListener("click", function () { renderSettings(); $("settings").showModal(); });
        $("notifyBtn").addEventListener("click", function () {
            if (App.Reminders.permission() === "default") enableNotifications();
            else { renderSettings(); $("settings").showModal(); }
        });
        $("enableNotifyBtn").addEventListener("click", enableNotifications);
        $("soundToggle").addEventListener("change", function (ev) { Store.setSetting("sound", ev.target.checked); });
        $("langSeg").addEventListener("click", function (ev) {
            var b = ev.target.closest("button");
            if (b) { Store.setSetting("lang", b.dataset.value); applyI18n(); render(); renderSettings(); }
        });
        $("themeSeg").addEventListener("click", function (ev) {
            var b = ev.target.closest("button");
            if (b) { Store.setSetting("theme", b.dataset.value); applyTheme(); renderSettings(); }
        });
        $("exportBtn").addEventListener("click", function () {
            download("tasks-backup-" + dates.today() + ".json", Store.exportJSON(), "application/json");
        });
        $("importBtn").addEventListener("click", function () { $("importFile").click(); });
        $("importFile").addEventListener("change", function (ev) {
            var file = ev.target.files[0];
            if (!file) return;
            file.text().then(function (text) {
                try { toast(t("importDone", { n: fmtNum(Store.importJSON(text)) }), null, { kind: "success" }); }
                catch (e) { toast(t("importFailed"), null, { kind: "error" }); }
                ev.target.value = "";
            });
        });
        $("clearDoneBtn").addEventListener("click", function () {
            if (confirm(t("clearCompletedConfirm"))) Store.clearCompleted();
        });

        // Close buttons and backdrop clicks for dialogs
        document.querySelectorAll("dialog").forEach(function (d) {
            d.addEventListener("click", function (ev) {
                if (ev.target === d || ev.target.closest("[data-close]")) d.close();
            });
        });

        // Keyboard shortcuts: N = new task, / = search
        document.addEventListener("keydown", function (ev) {
            if (ev.ctrlKey || ev.metaKey || ev.altKey || document.querySelector("dialog[open]")) return;
            var tag = (ev.target.tagName || "").toLowerCase();
            if (tag === "input" || tag === "textarea" || tag === "select") return;
            if (ev.key === "n" || ev.key === "N") { ev.preventDefault(); $("quickInput").focus(); }
            else if (ev.key === "/") { ev.preventDefault(); $("searchInput").focus(); }
        });

        // Refresh "today"/"overdue" when the day changes or time passes.
        setInterval(render, 60000);

        // Notification clicks handled by the service worker open the task here.
        if (navigator.serviceWorker) {
            navigator.serviceWorker.addEventListener("message", function (ev) {
                if (ev.data && ev.data.open) openEditor(ev.data.open);
            });
        }
    }

    function registerServiceWorker() {
        if (!("serviceWorker" in navigator) || location.protocol === "file:") return;
        navigator.serviceWorker.register("sw.js").catch(function () { /* offline support is optional */ });
    }

    function init() {
        Store.init();
        applyI18n();
        applyTheme();
        $("sortSelect").value = Store.state.settings.sort;
        Store.onChange(render);
        bind();
        render();
        App.Reminders.init(showReminder);
        registerServiceWorker();

        var params = new URLSearchParams(location.search);
        if (params.get("task")) openEditor(params.get("task"));
    }

    App.ui = {
        openEditor: openEditor,
        formatDue: formatDue,
        download: download,
        toast: toast
    };

    init();
})(window.App = window.App || {});
