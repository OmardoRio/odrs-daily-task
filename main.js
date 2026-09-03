const { app, BrowserWindow, Tray, Menu, ipcMain, screen, nativeImage, dialog } = require('electron');
const { autoUpdater } = require('electron-updater');
const path = require('path');
const fs = require('fs');
const { TaskStore } = require('./taskStore');
const { GoogleCalendarClient } = require('./googleCalendar');

// Only one instance of the widget should ever run at once - opening a
// second copy (e.g. double-clicking the installer's shortcut again) should
// just bring the existing one to front instead of spawning a duplicate
// window. The first instance keeps the lock and this early-exits every
// later one before it creates any window/tray of its own.
const gotTheSingleInstanceLock = app.requestSingleInstanceLock();
if (!gotTheSingleInstanceLock) {
  app.quit();
  process.exit(0);
}

// Without a matching AppUserModelID, Windows can treat the running process
// as a different identity than the installed shortcut it was launched from
// - which is a known cause of the taskbar icon/pin behaving inconsistently
// (not staying pinned, not grouping correctly). Must match build.appId in
// package.json (what the NSIS installer registers on the shortcut).
if (process.platform === 'win32') {
  app.setAppUserModelId('com.omardorio.odrsdailytask');
}

const GOOGLE_SYNC_INTERVAL_MS = 10 * 60 * 1000;
const UPDATE_CHECK_INTERVAL_MS = 2 * 60 * 60 * 1000;

const WINDOW_WIDTH = 336;
const WINDOW_MARGIN = 24;
const MIN_WINDOW_WIDTH = 260;
const MIN_WINDOW_HEIGHT = 160;

// Fixed chrome above the task list (widget padding + header + add-task row),
// plus the empty-state message shown when there are no tasks yet.
const CHROME_HEIGHT = 158;
const PROGRESS_ROW_HEIGHT = 28;
const EMPTY_STATE_HEIGHT = 46;
const ROW_HEIGHT = 38;
const MAX_VISIBLE_ROWS = 8;
const MIN_HEIGHT = CHROME_HEIGHT + EMPTY_STATE_HEIGHT;
const MAX_HEIGHT = CHROME_HEIGHT + PROGRESS_ROW_HEIGHT + ROW_HEIGHT * MAX_VISIBLE_ROWS;

// How opaque/white the glass panel looks - lower reads as darker/more see-
// through, higher as lighter/more solid. Persisted alongside window bounds
// in window-state.json.
const OPACITY_LEVELS = [0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9];
const DEFAULT_OPACITY = 0.5;

// On by default - most users expect a "daily task" widget to just be there
// when they log in, same as any other startup app. Persisted like opacity,
// and toggleable from the tray in case someone doesn't want that.
const DEFAULT_OPEN_AT_LOGIN = true;

let mainWindow = null;
let tray = null;
let taskStore = null;
let googleCalendar = null;
let isQuitting = false;
let currentOpacity = DEFAULT_OPACITY;
let currentOpenAtLogin = DEFAULT_OPEN_AT_LOGIN;

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

// Stored in the same window-state.json as the bounds, merged in so this
// never clobbers a previously saved custom position/size.
function persistOpacity(value) {
  currentOpacity = value;
  saveWindowState({ ...(loadWindowState() || {}), opacity: value });
}

function buildOpacitySubmenu() {
  return OPACITY_LEVELS.map((level) => ({
    label: `${Math.round(level * 100)}%${level === DEFAULT_OPACITY ? ' (padrão)' : ''}`,
    type: 'radio',
    checked: currentOpacity === level,
    click: () => {
      persistOpacity(level);
      if (mainWindow) mainWindow.webContents.send('opacity:changed', level);
    },
  }));
}

// Only takes effect in a packaged build (setLoginItemSettings has nothing
// meaningful to register while running unpackaged via `electron .`).
function setOpenAtLogin(value) {
  currentOpenAtLogin = value;
  saveWindowState({ ...(loadWindowState() || {}), openAtLogin: value });
  if (app.isPackaged) {
    app.setLoginItemSettings({ openAtLogin: value });
  }
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
    // Defensive: alwaysOnTop may have been dropped by the 'minimize' handler
    // below without a matching 'restore' (e.g. the window was minimized,
    // then hidden through some other path) - reassert it before showing.
    mainWindow.setAlwaysOnTop(true);
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
      // Minimize rather than hide: a hidden window drops off the taskbar
      // entirely (no way back except the tray icon), while minimizing keeps
      // its taskbar button/pin in place - this can be reached by a native
      // "Close window" from the taskbar's own right-click menu, not just
      // our in-app buttons (which already call minimize() directly).
      mainWindow.minimize();
    }
  });

  // Windows can fail to properly un-minimize/focus an always-on-top window
  // (a known Chromium/Windows interaction for this window style) - the
  // taskbar icon click, or Alt+Tab, can then silently do nothing. Dropping
  // alwaysOnTop while minimized, and re-asserting it once restored, avoids
  // the OS getting stuck trying to un-minimize a window that's pinned above
  // everything else.
  mainWindow.on('minimize', () => {
    mainWindow.setAlwaysOnTop(false);
  });

  mainWindow.on('restore', () => {
    mainWindow.setAlwaysOnTop(true);
    mainWindow.show();
    mainWindow.focus();
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

function connectGoogleFlow() {
  return googleCalendar
    .connect()
    .then(() => syncGoogleCalendarNow())
    .catch((err) => console.error("ODR's Daily Task: falha ao conectar Google Agenda:", err))
    .finally(() => tray.setContextMenu(buildTrayMenu()));
}

function disconnectGoogleFlow() {
  googleCalendar.disconnect();
  const state = taskStore.clearGoogleTasks();
  resizeToTaskCount(state.tasks.length);
  if (mainWindow) mainWindow.webContents.send('tasks:updated', state);
  tray.setContextMenu(buildTrayMenu());
}

// Only one Google account can be connected at a time: while connected the
// only way to switch is "Desconectar" first, then "Conectar" again (where
// Google's own screen lets the user pick a different account).
function buildGoogleMenuItems() {
  return !googleCalendar.hasCredentials()
    ? [{ label: 'Google Agenda (sem credenciais configuradas)', enabled: false }]
    : googleCalendar.isConnected()
    ? [
        { label: 'Sincronizar Google Agenda agora', click: () => syncGoogleCalendarNow() },
        { label: 'Desconectar Google Agenda', click: () => disconnectGoogleFlow() },
      ]
    : [{ label: 'Conectar Google Agenda...', click: () => connectGoogleFlow() }];
}

function buildTrayMenu() {
  return Menu.buildFromTemplate([
    {
      label: 'Mostrar / Ocultar',
      click: () => toggleMainWindow(),
    },
    {
      label: 'Abrir automaticamente ao ligar o computador',
      type: 'checkbox',
      checked: currentOpenAtLogin,
      click: (menuItem) => setOpenAtLogin(menuItem.checked),
    },
    { type: 'separator' },
    ...buildGoogleMenuItems(),
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

// Someone tried to open a second copy - it already quit itself above, so
// this just means: surface the one window we actually have.
app.on('second-instance', () => {
  if (!mainWindow) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
});

app.whenReady().then(() => {
  windowStatePath = path.join(app.getPath('userData'), 'window-state.json');
  taskStore = new TaskStore(app.getPath('userData'));
  googleCalendar = new GoogleCalendarClient(app.getPath('userData'));
  const savedOpacity = (loadWindowState() || {}).opacity;
  if (OPACITY_LEVELS.includes(savedOpacity)) currentOpacity = savedOpacity;
  const savedOpenAtLogin = (loadWindowState() || {}).openAtLogin;
  setOpenAtLogin(typeof savedOpenAtLogin === 'boolean' ? savedOpenAtLogin : DEFAULT_OPEN_AT_LOGIN);
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
ipcMain.handle('opacity:get', () => currentOpacity);

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
      label: 'Opacidade do widget',
      submenu: buildOpacitySubmenu(),
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
