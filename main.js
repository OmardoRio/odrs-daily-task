const { app, BrowserWindow, Tray, Menu, ipcMain, screen, nativeImage, dialog } = require('electron');
const { autoUpdater } = require('electron-updater');
const path = require('path');
const fs = require('fs');
const { TaskStore } = require('./taskStore');
const { GoogleCalendarClient } = require('./googleCalendar');

const GOOGLE_SYNC_INTERVAL_MS = 10 * 60 * 1000;
const UPDATE_CHECK_INTERVAL_MS = 2 * 60 * 60 * 1000;

const WINDOW_WIDTH = 336;
const WINDOW_MARGIN = 24;
const MIN_WINDOW_WIDTH = 260;
const MIN_WINDOW_HEIGHT = 160;

// Fixed chrome above the task list (widget padding + header + add-task row),
// plus extra bottom padding that clears the Google-connect badge in the
// widget's bottom-left corner, plus the empty-state message shown when there
// are no tasks yet.
const CHROME_HEIGHT = 182;
const PROGRESS_ROW_HEIGHT = 28;
const EMPTY_STATE_HEIGHT = 46;
const ROW_HEIGHT = 38;
const MAX_VISIBLE_ROWS = 8;
const MIN_HEIGHT = CHROME_HEIGHT + EMPTY_STATE_HEIGHT;
const MAX_HEIGHT = CHROME_HEIGHT + PROGRESS_ROW_HEIGHT + ROW_HEIGHT * MAX_VISIBLE_ROWS;

let mainWindow = null;
let tray = null;
let taskStore = null;
let googleCalendar = null;
let isQuitting = false;

// Once the user manually drags or resizes the widget, that becomes their
// fixed layout and the automatic "grow with the task list" behavior below
// stops touching it (the list just scrolls internally instead).
let windowStatePath = null;
let isCustomized = false;
let suppressBoundsTracking = false;
let boundsSaveTimer = null;

function loadWindowState() {
  try {
    const raw = fs.readFileSync(windowStatePath, 'utf-8');
    return JSON.parse(raw);
  } catch (err) {
    return null;
  }
}

function saveWindowState(state) {
  const tmpPath = `${windowStatePath}.tmp`;
  fs.writeFileSync(tmpPath, JSON.stringify(state, null, 2), 'utf-8');
  fs.renameSync(tmpPath, windowStatePath);
}

function heightForTaskCount(count) {
  if (count <= 0) return MIN_HEIGHT;
  const rows = Math.min(count, MAX_VISIBLE_ROWS);
  return CHROME_HEIGHT + PROGRESS_ROW_HEIGHT + rows * ROW_HEIGHT;
}

// The widget is anchored by its top-right corner, so it grows straight down
// (toward the bottom of the screen) as tasks are added, instead of always
// reserving a tall, mostly-empty box. This stops entirely once the user has
// manually resized the window (see isCustomized above).
function resizeToTaskCount(count) {
  if (!mainWindow || isCustomized) return;
  suppressBoundsTracking = true;
  mainWindow.setSize(WINDOW_WIDTH, heightForTaskCount(count), true);
  setImmediate(() => {
    suppressBoundsTracking = false;
  });
}

function toggleMainWindow() {
  if (!mainWindow) return;
  if (mainWindow.isMinimized()) {
    mainWindow.restore();
    mainWindow.focus();
  } else if (mainWindow.isVisible()) {
    mainWindow.hide();
  } else {
    mainWindow.show();
  }
}

function createWindow(initialTaskCount) {
  const savedState = loadWindowState();
  isCustomized = Boolean(savedState && savedState.customized);

  let x, y, width, height;
  if (isCustomized) {
    ({ x, y, width, height } = savedState);
  } else {
    const { workArea } = screen.getPrimaryDisplay();
    width = WINDOW_WIDTH;
    x = workArea.x + workArea.width - width - WINDOW_MARGIN;
    y = workArea.y + WINDOW_MARGIN;
    height = heightForTaskCount(initialTaskCount);
  }

  mainWindow = new BrowserWindow({
    width,
    height,
    x,
    y,
    minWidth: MIN_WINDOW_WIDTH,
    minHeight: MIN_WINDOW_HEIGHT,
    frame: false,
    transparent: true,
    hasShadow: false,
    resizable: true,
    alwaysOnTop: true,
    skipTaskbar: false,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  mainWindow.on('close', (event) => {
    if (!isQuitting) {
      event.preventDefault();
      mainWindow.hide();
    }
  });

  // Any drag (move) or manual resize the user does themselves - as opposed
  // to our own programmatic setSize() calls above, which set
  // suppressBoundsTracking - becomes their permanent custom layout.
  const persistBoundsIfUserInitiated = () => {
    if (suppressBoundsTracking || !mainWindow) return;
    isCustomized = true;
    clearTimeout(boundsSaveTimer);
    boundsSaveTimer = setTimeout(() => {
      if (!mainWindow) return;
      saveWindowState({ ...mainWindow.getBounds(), customized: true });
    }, 300);
  };
  mainWindow.on('resize', persistBoundsIfUserInitiated);
  mainWindow.on('move', persistBoundsIfUserInitiated);
}

async function syncGoogleCalendarNow() {
  if (!googleCalendar || !googleCalendar.hasCredentials() || !googleCalendar.isConnected()) return;
  try {
    const events = await googleCalendar.fetchTodayEvents();
    const state = taskStore.syncGoogleEvents(events);
    resizeToTaskCount(state.tasks.length);
    if (mainWindow) mainWindow.webContents.send('tasks:updated', state);
  } catch (err) {
    console.error("ODR's Daily Task: falha ao sincronizar Google Agenda:", err);
  }
}

function googleStatusPayload() {
  return {
    hasCredentials: googleCalendar.hasCredentials(),
    connected: googleCalendar.isConnected(),
  };
}

function broadcastGoogleStatus() {
  if (mainWindow) mainWindow.webContents.send('google:status-changed', googleStatusPayload());
}

// Shared by the tray menu item and the widget's own corner badge, so both
// entry points stay in sync (tray label, widget badge state, imported tasks).
async function connectGoogleFlow() {
  try {
    await googleCalendar.connect();
    await syncGoogleCalendarNow();
  } catch (err) {
    console.error("ODR's Daily Task: falha ao conectar Google Agenda:", err);
  } finally {
    tray.setContextMenu(buildTrayMenu());
    broadcastGoogleStatus();
  }
  return googleStatusPayload();
}

function disconnectGoogleFlow() {
  googleCalendar.disconnect();
  const state = taskStore.clearGoogleTasks();
  resizeToTaskCount(state.tasks.length);
  if (mainWindow) mainWindow.webContents.send('tasks:updated', state);
  tray.setContextMenu(buildTrayMenu());
  broadcastGoogleStatus();
  return googleStatusPayload();
}

function buildTrayMenu() {
  // Only one Google account can be connected at a time: while connected the
  // only way to switch is "Desconectar" first, then "Conectar" again (where
  // Google's own screen lets the user pick a different account).
  const googleItems = !googleCalendar.hasCredentials()
    ? [{ label: 'Google Agenda (sem credenciais configuradas)', enabled: false }]
    : googleCalendar.isConnected()
    ? [
        { label: 'Sincronizar Google Agenda agora', click: () => syncGoogleCalendarNow() },
        { label: 'Desconectar Google Agenda', click: () => disconnectGoogleFlow() },
      ]
    : [{ label: 'Conectar Google Agenda...', click: () => connectGoogleFlow() }];

  return Menu.buildFromTemplate([
    {
      label: 'Mostrar / Ocultar',
      click: () => toggleMainWindow(),
    },
    { type: 'separator' },
    ...googleItems,
    { type: 'separator' },
    {
      label: 'Verificar atualizações',
      click: () => checkForAppUpdates(true),
    },
    { type: 'separator' },
    {
      label: 'Sair',
      click: () => {
        isQuitting = true;
        app.quit();
      },
    },
  ]);
}

function createTray() {
  const iconPath = path.join(__dirname, 'assets', 'tray-icon.png');
  let trayIcon = nativeImage.createFromPath(iconPath);
  if (trayIcon.isEmpty()) {
    trayIcon = nativeImage.createEmpty();
  }
  tray = new Tray(trayIcon);
  tray.setToolTip("ODR's Daily Task");
  tray.setContextMenu(buildTrayMenu());

  tray.on('click', () => toggleMainWindow());
}

// `manual` distinguishes a user-initiated click (tray/context menu) from the
// silent background check every 2 hours: only the manual path bothers the
// user with "you're already up to date" / error dialogs. An update actually
// found is always announced either way, since that's actionable regardless
// of how the check was triggered.
let updateCheckInFlight = false;
let lastCheckWasManual = false;

function checkForAppUpdates(manual = false) {
  // No update feed exists outside a packaged build (app-update.yml is
  // generated by electron-builder at build time), so this would just
  // error noisily during `npm start`.
  if (!app.isPackaged) {
    if (manual) {
      dialog.showMessageBox(mainWindow, {
        type: 'info',
        message: 'Verificação de atualizações só funciona no aplicativo instalado, não em modo de desenvolvimento.',
      });
    }
    return;
  }
  if (updateCheckInFlight) return;
  updateCheckInFlight = true;
  lastCheckWasManual = manual;
  autoUpdater.checkForUpdates().catch((err) => {
    updateCheckInFlight = false;
    console.error("ODR's Daily Task: falha ao verificar atualização:", err);
    if (manual) {
      dialog.showMessageBox(mainWindow, {
        type: 'error',
        message: 'Não foi possível verificar atualizações.',
        detail: String((err && err.message) || err),
      });
    }
  });
}

// Registered once at startup. autoDownload is on, so as soon as an update is
// found it starts fetching in the background - no separate "download" click
// needed. Once it's fully downloaded, the user gets an explicit choice:
// restart now to install it, or keep working and let it install itself the
// next time the app is closed (electron-updater's default quit behavior).
function setupAutoUpdater() {
  autoUpdater.autoDownload = true;

  autoUpdater.on('update-not-available', () => {
    updateCheckInFlight = false;
    if (lastCheckWasManual) {
      dialog.showMessageBox(mainWindow, {
        type: 'info',
        message: 'Você já está com a versão mais recente instalada.',
      });
    }
  });

  autoUpdater.on('error', (err) => {
    updateCheckInFlight = false;
    if (lastCheckWasManual) {
      dialog.showMessageBox(mainWindow, {
        type: 'error',
        message: 'Falha ao verificar ou baixar a atualização.',
        detail: String((err && err.message) || err),
      });
    }
  });

  autoUpdater.on('update-downloaded', async (info) => {
    updateCheckInFlight = false;
    const { response } = await dialog.showMessageBox(mainWindow, {
      type: 'info',
      buttons: ['Reiniciar agora', 'Depois'],
      defaultId: 0,
      cancelId: 1,
      message: `Atualização ${info.version} baixada`,
      detail:
        'Reinicie agora para instalar, ou deixe para depois - ela é instalada automaticamente na próxima vez que o app for fechado.',
    });
    if (response === 0) {
      isQuitting = true;
      autoUpdater.quitAndInstall();
    }
  });
}

function checkDailyRollover() {
  if (!taskStore || !mainWindow) return;
  const state = taskStore.getState();
  if (state.rolled) {
    resizeToTaskCount(state.tasks.length);
    mainWindow.webContents.send('tasks:updated', state);
  }
}

app.whenReady().then(() => {
  windowStatePath = path.join(app.getPath('userData'), 'window-state.json');
  taskStore = new TaskStore(app.getPath('userData'));
  googleCalendar = new GoogleCalendarClient(app.getPath('userData'));
  const initialState = taskStore.getState();
  createWindow(initialState.tasks.length);
  createTray();
  setupAutoUpdater();
  setInterval(checkDailyRollover, 60 * 1000);
  syncGoogleCalendarNow();
  setInterval(syncGoogleCalendarNow, GOOGLE_SYNC_INTERVAL_MS);
  checkForAppUpdates(false);
  setInterval(() => checkForAppUpdates(false), UPDATE_CHECK_INTERVAL_MS);

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow(taskStore.getState().tasks.length);
    } else {
      mainWindow.show();
    }
  });
});

app.on('window-all-closed', () => {
  // keep the app alive in the tray, even on platforms that would
  // otherwise quit here; the tray menu is the only way to fully exit.
});

app.on('before-quit', () => {
  isQuitting = true;
});

function withResize(state) {
  resizeToTaskCount(state.tasks.length);
  return state;
}

ipcMain.handle('tasks:get', () => withResize(taskStore.getState()));
ipcMain.handle('tasks:add', (_event, text) => withResize(taskStore.addTask(text)));
ipcMain.handle('tasks:toggle', (_event, id) => withResize(taskStore.toggleTask(id)));
ipcMain.handle('tasks:delete', (_event, id) => withResize(taskStore.deleteTask(id)));
ipcMain.handle('tasks:rename', (_event, id, text) => withResize(taskStore.renameTask(id, text)));
ipcMain.handle('tasks:reorder', (_event, orderedIds) => taskStore.reorderTasks(orderedIds));
ipcMain.handle('draft:set', (_event, text) => taskStore.setDraft(text));

ipcMain.handle('google:getStatus', () => googleStatusPayload());
ipcMain.handle('google:connect', () => connectGoogleFlow());
ipcMain.handle('google:disconnect', () => disconnectGoogleFlow());

ipcMain.on('window:minimize', () => {
  // A real OS minimize (not hide): it lands in the taskbar so it's easy to
  // find and restore, instead of only being reachable from the tray icon.
  if (mainWindow) mainWindow.minimize();
});

ipcMain.on('window:close', () => {
  // By default "x" has the same effect as "-": it pins the widget to the
  // taskbar/Dock instead of hiding it away where only the tray icon can
  // bring it back. Fully closing still only happens via "Sair" in the tray.
  if (mainWindow) mainWindow.minimize();
});

// Right-click on empty space in the widget (not on a task or a button) pops
// this native menu instead of the browser's default one.
ipcMain.on('context-menu:show', () => {
  if (!mainWindow) return;
  const menu = Menu.buildFromTemplate([
    {
      label: 'Resetar tarefas',
      click: async () => {
        const { response } = await dialog.showMessageBox(mainWindow, {
          type: 'warning',
          buttons: ['Cancelar', 'Resetar'],
          defaultId: 0,
          cancelId: 0,
          message: 'Resetar tarefas de hoje?',
          detail:
            'Isso apaga todas as tarefas atuais (inclusive as importadas do Google Agenda). Essa ação não pode ser desfeita.',
        });
        if (response !== 1) return;
        const state = taskStore.resetTasks();
        resizeToTaskCount(state.tasks.length);
        mainWindow.webContents.send('tasks:updated', state);
      },
    },
    { type: 'separator' },
    {
      label: 'Verificar atualizações',
      click: () => checkForAppUpdates(true),
    },
  ]);
  menu.popup({ window: mainWindow });
});

// Right-click on a task row itself: lets it be toggled recurring (skipped
// entirely for Google-imported tasks, which aren't manually managed).
ipcMain.on('task-context-menu:show', (_event, taskId, isRecurring) => {
  if (!mainWindow) return;
  const menu = Menu.buildFromTemplate([
    {
      label: isRecurring ? 'Tornar tarefa comum' : 'Tornar recorrente',
      click: () => {
        const state = taskStore.toggleRecurring(taskId);
        resizeToTaskCount(state.tasks.length);
        mainWindow.webContents.send('tasks:updated', state);
      },
    },
  ]);
  menu.popup({ window: mainWindow });
});
