(function () {
    "use strict";

    var STORAGE_KEY = "todo-list.items";

    var form = document.getElementById("todoForm");
    var input = document.getElementById("todoInput");
    var formError = document.getElementById("formError");
    var list = document.getElementById("todoList");
    var emptyState = document.getElementById("emptyState");
    var counter = document.getElementById("counter");
    var clearBtn = document.getElementById("clearCompleted");
    var filterBtns = document.querySelectorAll(".filter-btn");

    var currentFilter = "all";
    var todos = load();

    // ---- Persistence ----

    function load() {
        try {
            var saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
            if (Array.isArray(saved)) return saved;
        } catch (e) { /* storage unavailable or corrupt: fall back to defaults */ }
        return [
            { id: uid(), text: "Play football", done: true },
            { id: uid(), text: "Study", done: false }
        ];
    }

    function save() {
        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(todos));
        } catch (e) { /* ignore: app still works for this session */ }
    }

    function uid() {
        return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
    }

    function find(id) {
        for (var i = 0; i < todos.length; i++) {
            if (todos[i].id === id) return todos[i];
        }
        return null;
    }

    // ---- Rendering ----

    function render() {
        list.innerHTML = "";

        var visible = todos.filter(function (t) {
            if (currentFilter === "active") return !t.done;
            if (currentFilter === "completed") return t.done;
            return true;
        });

        visible.forEach(function (todo) {
            list.appendChild(renderItem(todo));
        });

        emptyState.hidden = visible.length > 0;
        renderStats();
    }

    function renderStats() {
        var remaining = todos.filter(function (t) { return !t.done; }).length;
        counter.textContent = remaining + (remaining === 1 ? " task" : " tasks") + " left";
        clearBtn.disabled = remaining === todos.length;
    }

    function renderItem(todo) {
        var li = document.createElement("li");
        li.className = "todo-item" + (todo.done ? " checked" : "");
        li.dataset.id = todo.id;

        var label = document.createElement("span");
        label.className = "todo-text";
        label.textContent = todo.text;
        label.tabIndex = 0;
        label.setAttribute("role", "checkbox");
        label.setAttribute("aria-checked", String(todo.done));

        var del = document.createElement("button");
        del.type = "button";
        del.className = "close";
        del.setAttribute("aria-label", "Delete \"" + todo.text + "\"");
        del.textContent = "×";

        li.appendChild(label);
        li.appendChild(del);
        return li;
    }

    // ---- Actions ----

    function addTodo(text) {
        todos.push({ id: uid(), text: text, done: false });
        save();
        render();
    }

    // Updates the item in place (no list rebuild) so a double-click
    // still lands on the same element and items don't jump while filtered.
    function toggleTodo(li) {
        var todo = find(li.dataset.id);
        if (!todo) return;
        todo.done = !todo.done;
        li.classList.toggle("checked", todo.done);
        li.querySelector(".todo-text").setAttribute("aria-checked", String(todo.done));
        save();
        renderStats();
    }

    function deleteTodo(id) {
        todos = todos.filter(function (t) { return t.id !== id; });
        save();
        render();
    }

    function startEdit(li) {
        var todo = find(li.dataset.id);
        if (!todo) return;

        var editor = document.createElement("input");
        editor.type = "text";
        editor.className = "edit-input";
        editor.value = todo.text;
        editor.maxLength = 200;
        editor.setAttribute("aria-label", "Edit task");

        var finished = false;
        function finish(commit) {
            if (finished) return;
            finished = true;
            var value = editor.value.trim();
            if (commit) {
                if (value) {
                    todo.text = value;
                } else {
                    todos = todos.filter(function (t) { return t !== todo; });
                }
                save();
            }
            render();
        }

        editor.addEventListener("keydown", function (ev) {
            if (ev.key === "Enter") finish(true);
            else if (ev.key === "Escape") finish(false);
        });
        editor.addEventListener("blur", function () { finish(true); });

        li.innerHTML = "";
        li.classList.add("editing");
        li.appendChild(editor);
        editor.focus();
        editor.select();
    }

    // ---- Events ----

    form.addEventListener("submit", function (ev) {
        ev.preventDefault();
        var text = input.value.trim();
        if (!text) {
            formError.textContent = "You must write something!";
            input.focus();
            return;
        }
        formError.textContent = "";
        addTodo(text);
        input.value = "";
        input.focus();
    });

    input.addEventListener("input", function () {
        formError.textContent = "";
    });

    list.addEventListener("click", function (ev) {
        var li = ev.target.closest("li");
        if (!li || li.classList.contains("editing")) return;
        if (ev.target.classList.contains("close")) {
            deleteTodo(li.dataset.id);
        } else if (ev.detail <= 1) {
            toggleTodo(li);
        }
    });

    list.addEventListener("dblclick", function (ev) {
        var li = ev.target.closest("li");
        if (!li || li.classList.contains("editing") || ev.target.classList.contains("close")) return;
        toggleTodo(li); // undo the toggle from the double-click's first click
        startEdit(li);
    });

    list.addEventListener("keydown", function (ev) {
        if (!ev.target.classList.contains("todo-text")) return;
        var li = ev.target.closest("li");
        if (ev.key === " " || ev.key === "Enter") {
            ev.preventDefault();
            toggleTodo(li);
        } else if (ev.key === "F2") {
            ev.preventDefault();
            startEdit(li);
        }
    });

    filterBtns.forEach(function (btn) {
        btn.addEventListener("click", function () {
            currentFilter = btn.dataset.filter;
            filterBtns.forEach(function (b) {
                var active = b === btn;
                b.classList.toggle("active", active);
                b.setAttribute("aria-pressed", String(active));
            });
            render();
        });
    });

    clearBtn.addEventListener("click", function () {
        todos = todos.filter(function (t) { return !t.done; });
        save();
        render();
    });

    render();
})();
