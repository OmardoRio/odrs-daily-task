const taskListEl = document.getElementById('task-list');
const emptyStateEl = document.getElementById('empty-state');
const dateEl = document.getElementById('today-date');
const form = document.getElementById('add-task-form');
const input = document.getElementById('task-input');
const minimizeBtn = document.getElementById('minimize-btn');
const closeBtn = document.getElementById('close-btn');

function formatDate(dateKey) {
  const [y, m, d] = dateKey.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  const formatted = new Intl.DateTimeFormat('pt-BR', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  }).format(date);
  return formatted;
}

let currentState = null;

function renderTasks(state) {
  currentState = state;
  dateEl.textContent = formatDate(state.date);
  taskListEl.innerHTML = '';

  if (!state.tasks.length) {
    emptyStateEl.classList.add('visible');
  } else {
    emptyStateEl.classList.remove('visible');
  }

  for (const task of state.tasks) {
    const isGoogle = task.source === 'google';
    const li = document.createElement('li');
    li.className = 'task-item' + (task.done ? ' done' : '') + (isGoogle ? ' imported' : '');
    li.dataset.id = task.id;

    li.innerHTML = `
      <span class="drag-handle" title="Arrastar para reordenar" draggable="true">&#8942;&#8942;</span>
      <button class="checkbox" aria-label="Marcar tarefa como concluída">
        <svg class="check-mark" viewBox="0 0 24 24"><path d="M4 12l5 5L20 6" /></svg>
      </button>
      ${isGoogle ? '<span class="calendar-badge" title="Importado do Google Agenda">&#128197;</span>' : ''}
      <span class="task-text"></span>
      ${isGoogle ? '' : `
        <button class="edit-btn" aria-label="Editar tarefa" title="Editar">&#9998;</button>
        <button class="delete-btn" aria-label="Remover tarefa" title="Remover">&#10005;</button>
      `}
    `;
    li.querySelector('.task-text').textContent = task.text;
    attachDragHandlers(li, task);
    taskListEl.appendChild(li);
  }
}

// Drag-and-drop reordering, so the order can reflect priority. Dragging
// starts only from the grip handle (avoids hijacking clicks on the row),
// but the whole row moves as the drag image and can be a drop target.
let draggedTaskId = null;

function clearDropIndicators() {
  taskListEl.querySelectorAll('.drag-over-top, .drag-over-bottom').forEach((el) => {
    el.classList.remove('drag-over-top', 'drag-over-bottom');
  });
}

function attachDragHandlers(li, task) {
  const handle = li.querySelector('.drag-handle');

  handle.addEventListener('dragstart', (event) => {
    draggedTaskId = task.id;
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', task.id);
    event.dataTransfer.setDragImage(li, 20, 20);
    requestAnimationFrame(() => li.classList.add('dragging'));
  });

  handle.addEventListener('dragend', () => {
    li.classList.remove('dragging');
    clearDropIndicators();
    draggedTaskId = null;
  });

  li.addEventListener('dragover', (event) => {
    if (!draggedTaskId || draggedTaskId === task.id) return;
    event.preventDefault();
    const rect = li.getBoundingClientRect();
    const before = event.clientY - rect.top < rect.height / 2;
    li.classList.toggle('drag-over-top', before);
    li.classList.toggle('drag-over-bottom', !before);
  });

  li.addEventListener('dragleave', () => {
    li.classList.remove('drag-over-top', 'drag-over-bottom');
  });

  li.addEventListener('drop', async (event) => {
    event.preventDefault();
    const draggingId = draggedTaskId;
    const before = li.classList.contains('drag-over-top');
    clearDropIndicators();
    if (!draggingId || draggingId === task.id) return;

    const ids = currentState.tasks.map((t) => t.id).filter((id) => id !== draggingId);
    const targetIndex = ids.indexOf(task.id);
    ids.splice(before ? targetIndex : targetIndex + 1, 0, draggingId);

    const state = await window.api.reorderTasks(ids);
    renderTasks(state);
  });
}

function enterEditMode(li, task) {
  const textSpan = li.querySelector('.task-text');
  const editInput = document.createElement('input');
  editInput.type = 'text';
  editInput.className = 'task-edit-input';
  editInput.maxLength = 140;
  editInput.value = task.text;
  textSpan.replaceWith(editInput);
  editInput.focus();
  editInput.select();

  let settled = false;
  const commit = async () => {
    if (settled) return;
    settled = true;
    const newText = editInput.value.trim();
    if (newText && newText !== task.text) {
      const state = await window.api.renameTask(task.id, newText);
      renderTasks(state);
    } else {
      renderTasks(currentState);
    }
  };
  const cancel = () => {
    if (settled) return;
    settled = true;
    renderTasks(currentState);
  };

  editInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      commit();
    } else if (event.key === 'Escape') {
      event.preventDefault();
      cancel();
    }
  });
  editInput.addEventListener('blur', commit);
}

async function refresh() {
  const state = await window.api.getTasks();
  renderTasks(state);
  if (state.draft) {
    input.value = state.draft;
  }
}

// Persists whatever is typed but not yet submitted, so an unexpected crash
// or a "computer just froze" moment never loses a task mid-sentence.
let draftTimer = null;
function scheduleDraftSave() {
  clearTimeout(draftTimer);
  draftTimer = setTimeout(() => window.api.setDraft(input.value), 400);
}
function flushDraftSave() {
  clearTimeout(draftTimer);
  window.api.setDraft(input.value);
}

input.addEventListener('input', scheduleDraftSave);
window.addEventListener('blur', flushDraftSave);

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  const text = input.value.trim();
  if (!text) return;
  clearTimeout(draftTimer);
  input.value = '';
  const state = await window.api.addTask(text);
  renderTasks(state);
});

taskListEl.addEventListener('click', async (event) => {
  const item = event.target.closest('.task-item');
  if (!item) return;
  const id = item.dataset.id;

  if (event.target.closest('.checkbox')) {
    const state = await window.api.toggleTask(id);
    renderTasks(state);
  } else if (event.target.closest('.delete-btn')) {
    const state = await window.api.deleteTask(id);
    renderTasks(state);
  } else if (event.target.closest('.edit-btn')) {
    const task = currentState.tasks.find((t) => t.id === id);
    if (task) enterEditMode(item, task);
  }
});

minimizeBtn.addEventListener('click', () => window.api.minimize());
closeBtn.addEventListener('click', () => window.api.close());

// Right-click on empty space (not a task row, not a button/input) pops the
// native "Resetar tarefas" / "Verificar atualizações" menu.
document.addEventListener('contextmenu', (event) => {
  const isInteractive = event.target.closest(
    '.task-item, .add-task-row, .window-controls, button, input'
  );
  if (isInteractive) return;
  event.preventDefault();
  window.api.showContextMenu();
});

window.api.onTasksUpdated((state) => renderTasks(state));

refresh();
