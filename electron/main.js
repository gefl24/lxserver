'use strict'

const { app, Tray, Menu, shell, nativeImage, BrowserWindow, dialog } = require('electron')
const path = require('path')
const net = require('net')
const fs = require('fs')

// ─── 路径配置加载逻辑 ─────────────────────────────────────────────────────────
const defaultStorageRoot = app.getPath('userData')
const basePathConfigFile = path.join(defaultStorageRoot, 'base_path.json')

function getStoredPath() {
    try {
        if (fs.existsSync(basePathConfigFile)) {
            const data = JSON.parse(fs.readFileSync(basePathConfigFile, 'utf8'))
            if (data.storagePath && fs.existsSync(data.storagePath)) {
                return data.storagePath
            }
        }
    } catch (_) { }
    return null
}

function saveStoredPath(newPath) {
    try {
        if (!fs.existsSync(defaultStorageRoot)) fs.mkdirSync(defaultStorageRoot, { recursive: true })
        fs.writeFileSync(basePathConfigFile, JSON.stringify({ storagePath: newPath }))
    } catch (e) { console.error('Save path config failed:', e) }
}

// ─── 核心状态 ──────────────────────────────────────────────────────────────
let storageRoot = null
let SERVER_PORT = 9527
let BASE_URL = ''
let tray = null
let mainWindow = null // 唯一的全局窗口

const appRoot = app.getAppPath()
const staticPath = app.isPackaged
    ? path.join(appRoot + '.unpacked', 'public')
    : path.join(appRoot, 'public')
process.env.STATIC_PATH = staticPath

if (app.isPackaged) {
    process.chdir(path.dirname(app.getPath('exe')))
}

// ─── 服务器启动 ─────────────────────────────────────────────────────────────
async function startServer() {
    const dataDir = path.join(storageRoot, 'data')
    const logsDir = path.join(storageRoot, 'logs')
    process.env.DATA_PATH = dataDir
    process.env.LOG_PATH = logsDir

        ;[dataDir, logsDir].forEach(d => { try { fs.mkdirSync(d, { recursive: true }) } catch (_) { } })

    const getAvailablePort = (startPort) => {
        return new Promise((resolve) => {
            const server = net.createServer()
            server.listen(startPort, '0.0.0.0', () => {
                const { port } = server.address()
                server.close(() => resolve(port))
            })
            server.on('error', () => resolve(getAvailablePort(startPort + 1)))
        })
    }

    SERVER_PORT = await getAvailablePort(9527)
    process.env.PORT = SERVER_PORT.toString()
    process.env.BIND_IP = '0.0.0.0'
    BASE_URL = `http://127.0.0.1:${SERVER_PORT}`

    try {
        require('../index.js')
    } catch (err) {
        console.error('Server Failed:', err)
    }
}

// ─── 窗口管理 (单窗口模式) ─────────────────────────────────────────────────────
function getIcon(name) {
    const p = path.join(appRoot, 'electron', 'icons', name)
    if (fs.existsSync(p)) return nativeImage.createFromPath(p)
    return null
}

function navigateTo(type) {
    const isPlayer = type === 'player'
    const url = isPlayer ? `${BASE_URL}/music` : BASE_URL
    const title = isPlayer ? 'LX Music Player' : 'LX Music Server Admin'

    // 如果窗口不存在，创建它
    if (!mainWindow || mainWindow.isDestroyed()) {
        mainWindow = new BrowserWindow({
            title: title,
            width: 1200,
            height: 850,
            minWidth: 900,
            minHeight: 650,
            icon: getIcon('icon.png'),
            autoHideMenuBar: true,
            webPreferences: { nodeIntegration: false, contextIsolation: true }
        })
        mainWindow.on('page-title-updated', (e) => e.preventDefault())

        // 窗口关闭时只隐藏，不销毁（除非点退出）
        mainWindow.on('close', (event) => {
            if (!app.isQuiting) {
                event.preventDefault()
                mainWindow.hide()
            }
        })
    }

    // 在同一个窗口中加载不同的内容
    mainWindow.loadURL(url)
    mainWindow.show()
    mainWindow.focus()
}

function createTray() {
    const icon = getIcon('tray.png') || nativeImage.createEmpty()
    tray = new Tray(icon)
    tray.setToolTip(`LX Music Server (${SERVER_PORT})`)

    const menu = Menu.buildFromTemplate([
        { label: `● 运行中 (端口: ${SERVER_PORT})`, enabled: false },
        { label: `● 存储目录 : ${path.basename(storageRoot)}`, enabled: false },
        { type: 'separator' },
        { label: '打开播放器', click: () => navigateTo('player') },
        { label: '打开管理后台', click: () => navigateTo('admin') },
        { type: 'separator' },
        {
            label: '设置与管理',
            submenu: [
                {
                    label: '更换存储位置...',
                    click: () => {
                        const result = dialog.showOpenDialogSync({
                            title: '选择数据和日志存放目录',
                            properties: ['openDirectory', 'createDirectory']
                        })
                        if (result && result[0]) {
                            saveStoredPath(result[0])
                            app.relaunch(); app.exit()
                        }
                    }
                },
                { type: 'separator' },
                { label: '打开当前存储路径', click: () => shell.openPath(storageRoot) },
                { label: '用外部浏览器打开', click: () => shell.openExternal(BASE_URL) }
            ]
        },
        { type: 'separator' },
        { label: '重启软件', click: () => { app.relaunch(); app.exit() } },
        { label: '完全退出', click: () => { app.isQuiting = true; app.quit() } },
    ])
    tray.setContextMenu(menu)
    tray.on('click', () => navigateTo('player'))
}

// ─── App 生命周期 ─────────────────────────────────────────────────────────
app.whenReady().then(async () => {
    storageRoot = getStoredPath()

    // 初始化引导
    if (!storageRoot) {
        const choice = dialog.showMessageBoxSync({
            type: 'question',
            title: '初始化存储位置',
            message: '请先选择一个用于存放数据和日志的文件夹。',
            buttons: ['选择文件夹', '使用默认 (AppData)']
        })
        storageRoot = (choice === 0) ? (dialog.showOpenDialogSync({ properties: ['openDirectory', 'createDirectory'] }) || [defaultStorageRoot])[0] : defaultStorageRoot
        saveStoredPath(storageRoot)
    }

    await startServer()
    if (process.platform === 'darwin' && app.dock) app.dock.hide()
    createTray()

    // 默认只弹一个播放器窗
    navigateTo('player')
})

// 托盘 App 重写退出逻辑
app.on('before-quit', () => { app.isQuiting = true })
app.on('window-all-closed', () => { })
