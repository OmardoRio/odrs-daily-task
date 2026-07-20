const fs = require('fs');
const path = require('path');

function todayKey() {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

class TaskStore {
  constructor(userDataPath) {
    this.filePath = path.join(userDataPath, 'tasks.json');
    this.data = this._load();
    this._rolloverIfNewDay();
  }

  _load() {
    try {
      const raw = fs.readFileSync(this.filePath, 'utf-8');
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object' && Array.isArray(parsed.tasks)) {
        return { draft: '', ...parsed };
      }
    } catch (err) {
      // no file yet, or the file is missing/corrupted (e.g. the machine lost
      // power mid-write before atomic saves were in place) - start fresh
      // rather than crashing the app.
    }
    return { date: todayKey(), tasks: [], draft: '' };
  }

  // Written atomically (temp file + rename) so a crash or power loss mid-save
  // can never leave tasks.json half-written/corrupted on disk.
  _save() {
    const tmpPath = `${this.filePath}.tmp`;
    fs.writeFileSync(tmpPath, JSON.stringify(this.data, null, 2), 'utf-8');
    fs.renameSync(tmpPath, this.filePath);
  }

  // Recurring tasks survive the daily wipe (with "done" reset for the new
  // day); everything else - regular tasks and Google-imported ones, which
  // get refreshed by the next sync anyway - is dropped like before.
  _rolloverIfNewDay() {
    const key = todayKey();
    if (this.data.date !== key) {
      const recurring = this.data.tasks
        .filter((t) => t.recurring)
        .map((t) => ({ ...t, done: false }));
      this.data = { date: key, tasks: recurring, draft: '' };
      this._save();
      return true;
    }
    return false;
  }

  getState() {
    const rolled = this._rolloverIfNewDay();
    return { rolled, date: this.data.date, tasks: this.data.tasks, draft: this.data.draft || '' };
  }

  addTask(text) {
    this._rolloverIfNewDay();
    const trimmed = String(text || '').trim().slice(0, 140);
    if (trimmed) {
      this.data.tasks.push({
        id: `${Date.now()}-${Math.floor(Math.random() * 100000)}`,
        text: trimmed,
        done: false,
        recurring: false,
      });
    }
    this.data.draft = '';
    this._save();
    return this.getState();
  }

  setDraft(text) {
    this._rolloverIfNewDay();
    this.data.draft = String(text || '').slice(0, 140);
    this._save();
    return this.getState();
  }

  toggleTask(id) {
    this._rolloverIfNewDay();
    const task = this.data.tasks.find((t) => t.id === id);
    if (task) {
      task.done = !task.done;
      this._save();
    }
    return this.getState();
  }

  deleteTask(id) {
    this._rolloverIfNewDay();
    this.data.tasks = this.data.tasks.filter((t) => t.id !== id);
    this._save();
    return this.getState();
  }

  renameTask(id, text) {
    this._rolloverIfNewDay();
    const task = this.data.tasks.find((t) => t.id === id);
    // Calendar-imported tasks are managed by the sync, not edited by hand -
    // a rename would just get overwritten on the next sync anyway.
    if (task && task.source !== 'google') {
      const trimmed = String(text || '').trim().slice(0, 140);
      if (trimmed) {
        task.text = trimmed;
        this._save();
      }
    }
    return this.getState();
  }

  // Toggles a task between "recurring" (survives the daily reset) and
  // regular. Google-imported tasks are managed by the sync, not by hand, so
  // this is a no-op for them - same restriction as renameTask above.
  toggleRecurring(id) {
    this._rolloverIfNewDay();
    const task = this.data.tasks.find((t) => t.id === id);
    if (task && task.source !== 'google') {
      task.recurring = !task.recurring;
      this._save();
    }
    return this.getState();
  }

  // Merges today's Google Calendar events into the list without disturbing
  // manually-added tasks OR the user's chosen order: existing google-sourced
  // tasks keep their position and local "done" state when still present,
  // brand-new events are appended at the end, and events that no longer
  // occur today (deleted/moved) are dropped in place.
  syncGoogleEvents(events) {
    this._rolloverIfNewDay();
    const eventIds = new Set(events.map((e) => e.id));
    const eventById = new Map(events.map((e) => [e.id, e]));

    const kept = this.data.tasks
      .filter((t) => t.source !== 'google' || eventIds.has(t.id))
      .map((t) => (t.source === 'google' ? { ...t, text: eventById.get(t.id).text } : t));

    const keptIds = new Set(kept.map((t) => t.id));
    const newOnes = events
      .filter((e) => !keptIds.has(e.id))
      .map((e) => ({ id: e.id, text: e.text, done: false, source: 'google' }));

    this.data.tasks = [...kept, ...newOnes];
    this._save();
    return this.getState();
  }

  // Called when the user disconnects the Google account, so leftover
  // imported events don't linger with no way to ever refresh again.
  clearGoogleTasks() {
    this._rolloverIfNewDay();
    this.data.tasks = this.data.tasks.filter((t) => t.source !== 'google');
    this._save();
    return this.getState();
  }

  // Drag-and-drop reordering: orderedIds is the full new sequence of task
  // ids from the renderer. Any id it doesn't recognize (stale/raced update)
  // is dropped; any task it omits (shouldn't normally happen) is appended at
  // the end rather than silently lost.
  reorderTasks(orderedIds) {
    this._rolloverIfNewDay();
    const byId = new Map(this.data.tasks.map((t) => [t.id, t]));
    const reordered = orderedIds.map((id) => byId.get(id)).filter(Boolean);
    const reorderedIds = new Set(reordered.map((t) => t.id));
    const missing = this.data.tasks.filter((t) => !reorderedIds.has(t.id));
    this.data.tasks = [...reordered, ...missing];
    this._save();
    return this.getState();
  }

  // "Resetar tarefas" from the right-click menu: wipes every task for today,
  // manual and Google-imported alike.
  resetTasks() {
    this._rolloverIfNewDay();
    this.data.tasks = [];
    this._save();
    return this.getState();
  }
}

module.exports = { TaskStore, todayKey };
