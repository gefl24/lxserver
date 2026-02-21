import http, { type IncomingMessage } from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import { WebSocketServer, WebSocket } from 'ws'
import { registerLocalSyncEvent, callObj, sync } from './sync'
import { authCode, authConnect } from './auth'
import { getAddress, sendStatus, decryptMsg, encryptMsg } from '@/utils/tools'
import { accessLog, startupLog, syncLog } from '@/utils/log4js'
import { SYNC_CLOSE_CODE, SYNC_CODE } from '@/constants'
import { getUserSpace, releaseUserSpace, getUserName, getServerId } from '@/user'
import { createMsg2call } from 'message2call'
import { ElFinderConnector, getSystemRoot } from './elfinderConnector'
import formidable from 'formidable'
// @ts-ignore
import musicSdkRaw from '@/modules/utils/musicSdk/index.js'
const musicSdk = musicSdkRaw as any
import { initUserApis, callUserApiGetMusicUrl, isSourceSupported, getLoadedApis } from './userApi'
import * as customSourceHandlers from './customSourceHandlers'
import * as fileCache from './fileCache'
import crypto from 'node:crypto'

// ===== Player Session Store =====
const playerSessions = new Map<string, { createdAt: number }>()
const SESSION_TTL = 24 * 60 * 60 * 1000 // 24小时
const SESSION_COOKIE_NAME = 'lx_player_session'

/** 生成随机 sessionId */
const generateSessionId = () => crypto.randomBytes(32).toString('hex')

/** 解析 Cookie 字符串 */
const parseCookies = (cookieHeader: string | undefined): Record<string, string> => {
  if (!cookieHeader) return {}
  return Object.fromEntries(
    cookieHeader.split(';').map(c => {
      const [k, ...v] = c.trim().split('=')
      return [k.trim(), decodeURIComponent(v.join('='))]
    })
  )
}

/** 检查请求是否携带有效的 Player Session Cookie */
const checkPlayerAuth = (req: IncomingMessage): boolean => {
  if (!global.lx.config['player.enableAuth']) return true // 未开启认证，直接放行
  const cookies = parseCookies(req.headers['cookie'])
  const sessionId = cookies[SESSION_COOKIE_NAME]
  if (!sessionId) return false
  const session = playerSessions.get(sessionId)
  if (!session) return false
  if (Date.now() - session.createdAt > SESSION_TTL) {
    playerSessions.delete(sessionId)
    return false
  }
  return true
}

/** 定期清理过期 Session（每小时） */
setInterval(() => {
  const now = Date.now()
  for (const [id, session] of playerSessions) {
    if (now - session.createdAt > SESSION_TTL) playerSessions.delete(id)
  }
}, 60 * 60 * 1000)
// ===== End Session Store =====


const getMime = (filename: string) => {
  const ext = path.extname(filename).toLowerCase()
  const mimeTypes: Record<string, string> = {
    '.txt': 'text/plain',
    '.js': 'application/javascript',
    '.json': 'application/json',
    '.html': 'text/html',
    '.css': 'text/css',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.png': 'image/png',
    '.gif': 'image/gif',
    '.svg': 'image/svg+xml',
    '.pdf': 'application/pdf',
    '.zip': 'application/zip',
    '.mp3': 'audio/mpeg',
    '.mp4': 'video/mp4',
  }
  return mimeTypes[ext] || 'application/octet-stream'
}

/**
 * 规范化歌曲信息，确保收藏列表中的 meta 属性在根节点也可用
 * 解决 SDK 无法识别收藏歌曲音质的问题
 */
const normalizeSongInfo = (songInfo: any) => {
  if (!songInfo) return songInfo
  // 处理音质信息 (types / _types)
  if (!songInfo.types && songInfo.meta) {
    songInfo.types = songInfo.meta.qualitys || songInfo.meta.types
  }
  if (!songInfo._types && songInfo.meta) {
    songInfo._types = songInfo.meta._qualitys || songInfo.meta._types
  }
  // 处理标题/专辑/封面等基础备用字段
  if (!songInfo.albumName && songInfo.meta?.albumName) songInfo.albumName = songInfo.meta.albumName
  if (!songInfo.img && songInfo.meta?.picUrl) songInfo.img = songInfo.meta.picUrl

  // 1. 处理通用 ID 转换 (id -> songmid)
  // 收藏夹中的歌曲 id 通常带有前缀 (如 wy_123)，清洗为 SDK 内部通用的 songmid (123)
  if (!songInfo.songmid && songInfo.id) {
    const sourcePrefix = `${songInfo.source}_`
    if (typeof songInfo.id === 'string' && songInfo.id.startsWith(sourcePrefix)) {
      songInfo.songmid = songInfo.id.slice(sourcePrefix.length)
    } else {
      songInfo.songmid = songInfo.id
    }
  }

  // 2. 针对各平台 SDK 所需的特定字段进行“大补全”
  // 目标：确保从“搜索结果”和“收藏列表”传入的信息字段完全对等
  switch (songInfo.source) {
    case 'kg': // 酷狗
      // 关键：hash (用于评论和链接获取)
      if (!songInfo.hash) {
        const mid = String(songInfo.songmid || '')
        if (mid.includes('_')) {
          songInfo.hash = mid.split('_')[1]
        } else if (mid.length === 32) {
          songInfo.hash = mid
        }
      }
      break

    case 'tx': // 腾讯
      // 关键：strMediaMid (获取链接), songId (数字 ID，用于评论)
      if (!songInfo.strMediaMid && songInfo.meta?.strMediaMid) songInfo.strMediaMid = songInfo.meta.strMediaMid
      if (!songInfo.albumMid && songInfo.meta?.albumMid) songInfo.albumMid = songInfo.meta.albumMid

      // 只有当 meta 中的 songId 是纯数字时才回填，否则保持 undefined 触发 SDK 自动获取
      const metaSongId = String(songInfo.meta?.songId || '')
      if (/^\d+$/.test(metaSongId)) {
        songInfo.songId = metaSongId
      } else {
        delete songInfo.songId
      }
      break

    case 'mg': // 咪咕
      // 关键：copyrightId (用于获取链接), songId (用于评论)
      if (!songInfo.copyrightId && songInfo.meta?.copyrightId) songInfo.copyrightId = songInfo.meta.copyrightId
      if (!songInfo.songId) songInfo.songId = songInfo.songmid
      break

    case 'wy': // 网易
      // 关键：songmid (即数字 ID)
      // 已经在步骤 1 中通用处理
      break

    case 'kw': // 酷我
      // 关键：songmid (即数字 ID)
      // 已在步骤 1 中通用处理
      break
  }

  return songInfo
}

let status: LX.Sync.Status = {
  status: false,
  message: '',
  address: [],
  // code: '',
  devices: [],
}

let host = 'http://localhost'
const sseClients = new Set<http.ServerResponse>()

// const codeTools: {
//   timeout: NodeJS.Timer | null
//   start: () => void
//   stop: () => void
// } = {
//   timeout: null,
//   start() {
//     this.stop()
//     this.timeout = setInterval(() => {
//       void generateCode()
//     }, 60 * 3 * 1000)
//   },
//   stop() {
//     if (!this.timeout) return
//     clearInterval(this.timeout)
//     this.timeout = null
//   },
// }

const checkDuplicateClient = (newSocket: LX.Socket) => {
  for (const client of [...wss!.clients]) {
    if (client === newSocket || client.keyInfo.clientId != newSocket.keyInfo.clientId) continue
    syncLog.info('duplicate client', client.userInfo.name, client.keyInfo.deviceName)
    client.isReady = false
    for (const name of Object.keys(client.moduleReadys) as Array<keyof LX.Socket['moduleReadys']>) {
      client.moduleReadys[name] = false
    }
    client.close(SYNC_CLOSE_CODE.normal)
  }
}

const handleConnection = async (socket: LX.Socket, request: IncomingMessage) => {
  const queryData = new URL(request.url as string, host).searchParams
  const clientId = queryData.get('i')

  //   // if (typeof socket.handshake.query.i != 'string') return socket.disconnect(true)
  const userName = getUserName(clientId)
  if (!userName) {
    socket.close(SYNC_CLOSE_CODE.failed)
    return
  }
  const userSpace = getUserSpace(userName)
  const keyInfo = userSpace.dataManage.getClientKeyInfo(clientId)
  if (!keyInfo) {
    socket.close(SYNC_CLOSE_CODE.failed)
    return
  }
  const user = global.lx.config.users.find(u => u.name == userName)
  if (!user) {
    socket.close(SYNC_CLOSE_CODE.failed)
    return
  }
  keyInfo.lastConnectDate = Date.now()
  userSpace.dataManage.saveClientKeyInfo(keyInfo)
  //   // socket.lx_keyInfo = keyInfo
  socket.keyInfo = keyInfo
  socket.userInfo = user

  checkDuplicateClient(socket)

  try {
    await sync(socket)
  } catch (err) {
    // console.log(err)
    syncLog.warn(err)
    socket.close(SYNC_CLOSE_CODE.failed)
    return
  }
  status.devices.push(keyInfo)
  // handleConnection(io, socket)
  sendStatus(status)
  socket.onClose(() => {
    status.devices.splice(status.devices.findIndex(k => k.clientId == keyInfo.clientId), 1)
    sendStatus(status)
  })

  // console.log('connection', keyInfo.deviceName)
  accessLog.info('connection', user.name, keyInfo.deviceName)
  // console.log(socket.handshake.query)

  socket.isReady = true
}

const handleUnconnection = (userName: string) => {
  // console.log('unconnection')
  releaseUserSpace(userName)
}

const authConnection = (req: http.IncomingMessage, callback: (err: string | null | undefined, success: boolean) => void) => {
  // console.log(req.headers)
  // // console.log(req.auth)
  // console.log(req._query.authCode)
  authConnect(req).then(() => {
    callback(null, true)
  }).catch(err => {
    // console.log('WebSocket auth failed:', err.message)
    callback(null, false) // <--- 修改为传递 null, false
  })
}

let wss: LX.SocketServer | null

function noop() { }
function onSocketError(err: Error) {
  console.error(err)
}

const saveUsers = () => {
  const usersJsonPath = path.join(global.lx.dataPath, 'users.json')
  try {
    fs.writeFileSync(usersJsonPath, JSON.stringify(global.lx.config.users.map(u => ({
      name: u.name,
      password: u.password,
      maxSnapshotNum: u.maxSnapshotNum,
      'list.addMusicLocationType': u['list.addMusicLocationType'],
    })), null, 2))
    return true
  } catch (err) {
    console.error('Failed to save users.json', err)
    return false
  }
}

const checkAndCreateDir = (p: string) => {
  try {
    if (!fs.existsSync(p)) {
      fs.mkdirSync(p, { recursive: true })
    }
  } catch (e: any) {
    if (e.code !== 'EEXIST') {
      console.error(`Could not create directory ${p}:`, e.message)
    }
  }
}

const readBody = async (req: IncomingMessage) => await new Promise<string>((resolve, reject) => {
  let body = ''
  req.on('data', chunk => { body += chunk })
  req.on('end', () => { resolve(body) })
  req.on('error', reject)
})

const serveStatic = (req: IncomingMessage, res: http.ServerResponse, filePath: string) => {
  const contentType = getMime(filePath)

  try {
    const stats = fs.statSync(filePath)
    const mtime = stats.mtime.getTime()
    const etag = `W/"${stats.size}-${mtime}"`
    const lastModified = stats.mtime.toUTCString()

    // Check Cache Validity (Conditional Requests)
    if (req.headers['if-none-match'] === etag || req.headers['if-modified-since'] === lastModified) {
      res.writeHead(304)
      res.end()
      return
    }

    fs.readFile(filePath, (err, content) => {
      if (err) {
        if (err.code === 'ENOENT') {
          res.writeHead(404)
          res.end('Not Found')
        } else {
          res.writeHead(500)
          res.end('Server Error')
        }
      } else {
        res.writeHead(200, {
          'Content-Type': contentType,
          'ETag': etag,
          'Last-Modified': lastModified,
          'Cache-Control': 'no-cache, must-revalidate', // Force browser to revalidate every time
          'Pragma': 'no-cache',
          'Expires': '0',
        })
        res.end(content, 'utf-8')
      }
    })
  } catch (err: any) {
    if (err.code === 'ENOENT') {
      res.writeHead(404)
      res.end('Not Found')
    } else {
      res.writeHead(500)
      res.end('Server Error')
    }
  }
}

const handleStartServer = async (port = 9527, ip = '127.0.0.1') => await new Promise((resolve, reject) => {
  const httpServer = http.createServer(async (req, res) => {
    // console.log(req.url)
    const urlObj = new URL(req.url ?? '', `http://${req.headers.host}`)
    const pathname = urlObj.pathname

    // Serve Music Player Static Files
    if (pathname.startsWith('/music')) {
      // 白名单：登录页、静态资源无需认证
      const isLoginPage = pathname === '/music/login' || pathname === '/music/login.html'
      const isPublicAsset = pathname.startsWith('/music/assets/') ||
        pathname.startsWith('/music/css/') ||
        pathname.startsWith('/music/js/') ||
        pathname === '/music/manifest.json' ||
        pathname === '/music/sw.js'

      // 认证检查：仅对主页面（非白名单）进行保护
      if (!isLoginPage && !isPublicAsset && global.lx.config['player.enableAuth']) {
        if (!checkPlayerAuth(req)) {
          res.writeHead(302, { 'Location': '/music/login' })
          res.end()
          return
        }
      }

      // Defaults to index.html if exactly /music or /music/
      let targetPath = pathname
      if (pathname === '/music' || pathname === '/music/') {
        targetPath = '/music/index.html'
      } else if (isLoginPage) {
        targetPath = '/music/login.html'
      }
      // public/music/xxx
      // global.lx.staticPath points to `public`
      const filePath = path.join(global.lx.staticPath, targetPath)
      serveStatic(req, res, filePath)
      return
    }

    // 动态 config.js - 从静态文件读取版本号, 合并服务端配置注入 window.CONFIG
    // 配置优先级: 环境变量 > 根目录 config.js > src/defaultConfig.ts
    if (pathname === '/js/config.js') {
      // 从静态文件读取版本号
      const staticConfigPath = path.join(global.lx.staticPath, 'js', 'config.js')
      let version = 'v1.0.0'
      try {
        const content = fs.readFileSync(staticConfigPath, 'utf-8')
        const match = content.match(/version:\s*['"]([^'"]+)['"]/)
        if (match) version = match[1]
      } catch { }

      // 构造前端配置 (不含敏感字段如密码)
      const frontendConfig = {
        version,
        serverName: global.lx.config.serverName,
        disableTelemetry: global.lx.config.disableTelemetry || false,
        'proxy.enabled': global.lx.config['proxy.enabled'],
        'user.enablePath': global.lx.config['user.enablePath'],
        'user.enableRoot': global.lx.config['user.enableRoot'],
        maxSnapshotNum: global.lx.config.maxSnapshotNum,
        'list.addMusicLocationType': global.lx.config['list.addMusicLocationType'],
        'player.enableAuth': global.lx.config['player.enableAuth'] || false,
        port: global.lx.config.port,
        bindIP: global.lx.config.bindIP,
      }

      const configJs = `window.CONFIG = ${JSON.stringify(frontendConfig, null, 2)};`
      res.writeHead(200, {
        'Content-Type': 'application/javascript; charset=utf-8',
        'Cache-Control': 'no-cache, no-store, must-revalidate',
      })
      res.end(configJs)
      return
    }

    if (pathname.startsWith('/api/')) {


      if (pathname === '/api/login' && req.method === 'POST') {
        void readBody(req).then(body => {
          try {
            const { password } = JSON.parse(body)
            if (password === global.lx.config['frontend.password']) {
              res.writeHead(200, { 'Content-Type': 'application/json' })
              res.end(JSON.stringify({ success: true }))
            } else {
              res.writeHead(401, { 'Content-Type': 'application/json' })
              res.end(JSON.stringify({ success: false }))
            }
          } catch (e) {
            res.writeHead(400)
            res.end('Bad Request')
          }
        })
        return
      }



      // [新增] 获取服务器状态
      if (pathname === '/api/status' && req.method === 'GET') {
        const auth = req.headers['x-frontend-auth']
        if (auth !== global.lx.config['frontend.password']) {
          res.writeHead(401)
          res.end('Unauthorized')
          return
        }

        const status = {
          users: global.lx.config.users.length,
          devices: wss?.clients.size ?? 0,
          uptime: process.uptime(),
          memory: process.memoryUsage().rss
        }

        res.writeHead(200, {
          'Content-Type': 'application/json',
          'Cache-Control': 'no-cache, no-store, must-revalidate',
          'Pragma': 'no-cache',
          'Expires': '0'
        })
        res.end(JSON.stringify(status))
        return
      }

      if (pathname === '/api/users') {
        const auth = req.headers['x-frontend-auth']
        if (auth !== global.lx.config['frontend.password']) {
          res.writeHead(401)
          res.end('Unauthorized')
          return
        }
        if (req.method === 'GET') {
          // 修改：返回包含密码的用户列表
          const users = global.lx.config.users.map(u => ({ name: u.name, password: u.password }))
          res.writeHead(200, {
            'Content-Type': 'application/json',
            'Cache-Control': 'no-cache, no-store, must-revalidate'
          })
          res.end(JSON.stringify(users))
          return
        }
        if (req.method === 'POST') {
          void readBody(req).then(body => {
            try {
              const { name, password } = JSON.parse(body)
              if (!name || !password) {
                res.writeHead(400)
                res.end('Missing name or password')
                return
              }
              if (global.lx.config.users.some(u => u.name === name)) {
                res.writeHead(409)
                res.end('User already exists')
                return
              }

              // eslint-disable-next-line @typescript-eslint/no-var-requires
              const { getUserDirname } = require('@/user')
              const dataPath = path.join(global.lx.userPath, getUserDirname(name))
              checkAndCreateDir(dataPath)

              global.lx.config.users.push({
                name,
                password,
                dataPath,
              })
              saveUsers()

              res.writeHead(200)
              res.end(JSON.stringify({ success: true }))
            } catch (e) {
              res.writeHead(500)
              res.end('Server Error')
            }
          })
          return
        }
        if (req.method === 'PUT') {
          void readBody(req).then(body => {
            try {
              const { name, password } = JSON.parse(body)
              if (!name || !password) {
                res.writeHead(400)
                res.end('Missing name or password')
                return
              }
              const user = global.lx.config.users.find(u => u.name === name)
              if (!user) {
                res.writeHead(404)
                res.end('User not found')
                return
              }

              // 更新密码
              user.password = password
              saveUsers()

              res.writeHead(200)
              res.end(JSON.stringify({ success: true }))
            } catch (e) {
              res.writeHead(500)
              res.end('Server Error')
            }
          })
          return
        }
        if (req.method === 'DELETE') {
          void readBody(req).then(body => {
            try {
              // 修改：同时支持单个 name 和批量 names，以及 deleteData 参数
              const { name, names, deleteData } = JSON.parse(body)
              const targets = names || (name ? [name] : [])

              if (targets.length === 0) {
                res.writeHead(400)
                res.end('Missing name or names')
                return
              }

              let deletedCount = 0
              const deletedUsers: { name: string, dataPath: string }[] = []

              for (const targetName of targets) {
                const idx = global.lx.config.users.findIndex(u => u.name === targetName)
                if (idx !== -1) {
                  const user = global.lx.config.users[idx]

                  // 保存用户数据路径（如果需要删除）
                  console.log(`[DeleteUser] deleteData: ${deleteData}, user.dataPath: ${user.dataPath}`)
                  if (deleteData && user.dataPath) {
                    deletedUsers.push({ name: targetName, dataPath: user.dataPath })
                  } else {
                    console.log(`[DeleteUser] Skipping data deletion for ${targetName}. deleteData=${deleteData}, hasDataPath=${!!user.dataPath}`)
                  }

                  // 断开该用户的连接
                  if (wss) {
                    for (const client of wss.clients) {
                      if (client.userInfo?.name === targetName) client.close(SYNC_CLOSE_CODE.normal)
                    }
                  }
                  global.lx.config.users.splice(idx, 1)
                  deletedCount++
                }
              }

              if (deletedCount > 0) {
                saveUsers()

                // 如果需要删除数据文件夹
                if (deleteData && deletedUsers.length > 0) {
                  console.log(`[DeleteUser] Processing ${deletedUsers.length} data folders deletion...`)
                  for (const user of deletedUsers) {
                    try {
                      console.log(`[DeleteUser] Checking path: ${user.dataPath}`)
                      if (fs.existsSync(user.dataPath)) {
                        fs.rmSync(user.dataPath, { recursive: true, force: true })
                        console.log(`Deleted user data folder: ${user.dataPath}`)
                      } else {
                        console.log(`[DeleteUser] Path not found: ${user.dataPath}`)
                      }
                    } catch (err) {
                      console.error(`Failed to delete user data folder for ${user.name}:`, err)
                      // 继续删除其他用户，不中断流程
                    }
                  }
                } else {
                  console.log('[DeleteUser] No data folders to delete (or deleteData is false)')
                }

                res.writeHead(200)
                res.end(JSON.stringify({ success: true, deletedCount }))
              } else {
                res.writeHead(404)
                res.end('User not found')
              }
            } catch (e) {
              res.writeHead(500)
              res.end('Server Error')
            }
          })
          return
        }
      }

      if (pathname === '/api/data' && req.method === 'GET') {
        const auth = req.headers['x-frontend-auth']
        if (auth !== global.lx.config['frontend.password']) {
          res.writeHead(401)
          res.end('Unauthorized')
          return
        }

        const user = urlObj.searchParams.get('user')
        if (!user) {
          res.writeHead(400)
          res.end('Missing user param')
          return
        }

        const userSpace = getUserSpace(user)
        void userSpace.listManage.getListData().then(data => {
          res.writeHead(200, {
            'Content-Type': 'application/json',
            'Cache-Control': 'no-cache, no-store, must-revalidate'
          })
          res.end(JSON.stringify(data))
        }).catch(err => {
          res.writeHead(500)
          res.end(err.message)
        })
        return
      }
      // 获取快照列表
      if (pathname === '/api/data/snapshots' && req.method === 'GET') {
        const user = urlObj.searchParams.get('user')
        if (!user) {
          res.writeHead(400)
          res.end('Missing user param')
          return
        }
        const userSpace = getUserSpace(user)
        if (!userSpace) {
          res.writeHead(401)
          res.end('Unauthorized')
          return
        }
        try {
          const list = await userSpace.listManage.getSnapshotList()
          res.writeHead(200, {
            'Content-Type': 'application/json',
            'Cache-Control': 'no-cache, no-store, must-revalidate'
          })
          res.end(JSON.stringify(list))
        } catch (err: any) {
          res.writeHead(500)
          res.end(err.message)
        }
        return
      }

      // 下载快照数据
      if (pathname === '/api/data/snapshot' && req.method === 'GET') {
        const user = urlObj.searchParams.get('user')
        if (!user) {
          res.writeHead(400)
          res.end('Missing user param')
          return
        }
        const userSpace = getUserSpace(user)
        if (!userSpace) {
          res.writeHead(401)
          res.end('Unauthorized')
          return
        }
        const id = urlObj.searchParams.get('id')
        if (!id) {
          res.writeHead(400)
          res.end('Missing id')
          return
        }
        try {
          const data = await userSpace.listManage.getSnapshot(id)
          if (!data) {
            res.writeHead(404)
            res.end('Not Found')
            return
          }
          res.writeHead(200, {
            'Content-Type': 'application/json',
            'Cache-Control': 'no-cache, no-store, must-revalidate'
          })
          res.end(JSON.stringify(data))
        } catch (err: any) {
          res.writeHead(500)
          res.end(err.message)
        }
        return
      }

      // 恢复快照
      if (pathname === '/api/data/restore-snapshot' && req.method === 'POST') {
        const user = urlObj.searchParams.get('user')
        if (!user) {
          res.writeHead(400)
          res.end('Missing user param')
          return
        }
        const userSpace = getUserSpace(user)
        if (!userSpace) {
          res.writeHead(401)
          res.end('Unauthorized')
          return
        }
        try {
          const body = await readBody(req)
          const { id } = JSON.parse(body)
          if (!id) throw new Error('Missing id')

          await userSpace.listManage.restoreSnapshot(id)

          res.writeHead(200, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ success: true }))
        } catch (err: any) {
          res.writeHead(500)
          res.end(err.message)
        }
        return
      }

      // [新增] Batch Remove Songs from List (User Auth)
      if (pathname === '/api/music/user/list/remove' && req.method === 'POST') {
        const username = req.headers['x-user-name'] as string
        const password = req.headers['x-user-password'] as string

        if (!username || !password) {
          res.writeHead(401)
          res.end('需要用户认证')
          return
        }

        const user = global.lx.config.users.find(u => u.name === username && u.password === password)
        if (!user) {
          res.writeHead(401)
          res.end('用户名或密码错误')
          return
        }

        void readBody(req).then(async body => {
          try {
            const { listId, songIds } = JSON.parse(body)

            if (!listId || !Array.isArray(songIds)) {
              res.writeHead(400)
              res.end('参数错误:需要listId和songIds数组')
              return
            }

            console.log(`[UserAPI] 批量删除请求: 用户=${username}, 列表=${listId}, 删除歌曲数=${songIds.length}`)
            console.log(`[UserAPI] 待删除歌曲ID:`, songIds)

            const userSpace = getUserSpace(username)

            // Get list before deletion
            const listBefore = await userSpace.listManage.listDataManage.getListMusics(listId)
            console.log(`[UserAPI] 删除前列表歌曲数: ${listBefore.length}`)

            // Remove songs from the list
            const affectedLists = await userSpace.listManage.listDataManage.listMusicRemove(listId, songIds)
            console.log(`[UserAPI] 受影响的列表:`, affectedLists)

            // Get list after deletion  
            const listAfter = await userSpace.listManage.listDataManage.getListMusics(listId)
            console.log(`[UserAPI] 删除后列表歌曲数: ${listAfter.length}`)

            // Create new snapshot to persist changes
            const newSnapshotKey = await userSpace.listManage.createSnapshot()
            console.log(`[UserAPI] 批量删除成功,已创建新快照: ${newSnapshotKey}`)

            res.writeHead(200)
            res.end('删除成功')
          } catch (err: any) {
            console.error('[UserAPI] 批量删除失败:', err)
            res.writeHead(500)
            res.end(err.message || '删除失败')
          }
        })
        return
      }



      // [新增] 删除快照 API
      if (pathname === '/api/data/delete-snapshot' && req.method === 'POST') {
        const user = urlObj.searchParams.get('user')
        if (!user) {
          res.writeHead(400)
          res.end('Missing user param')
          return
        }
        const userSpace = getUserSpace(user)
        if (!userSpace) {
          res.writeHead(401)
          res.end('Unauthorized')
          return
        }
        try {
          const body = await readBody(req)
          const { id } = JSON.parse(body)
          if (!id) throw new Error('Missing id')

          // 调用刚刚在 ListManage 中添加的方法
          await userSpace.listManage.removeSnapshot(id)

          res.writeHead(200, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ success: true }))
        } catch (err: any) {
          res.writeHead(500)
          res.end(err.message)
        }
        return
      }
      // [新增] 上传快照 API
      if (pathname === '/api/data/upload-snapshot' && req.method === 'POST') {
        const user = urlObj.searchParams.get('user')
        const time = parseInt(urlObj.searchParams.get('time') || '0')
        const filename = urlObj.searchParams.get('filename')

        if (!user) {
          res.writeHead(400)
          res.end('Missing user param')
          return
        }
        if (!filename) {
          res.writeHead(400)
          res.end('Missing filename param')
          return
        }

        const userSpace = getUserSpace(user)
        if (!userSpace) {
          res.writeHead(401)
          res.end('Unauthorized')
          return
        }

        try {
          const body = await readBody(req)

          // 处理文件名：如果以 snapshot_ 开头，则去掉（因为 saveSnapshotWithTime 会自动加）
          // 如果不以 snapshot_ 开头，则保持原样（saveSnapshotWithTime 会自动加 snapshot_ 前缀）
          let name = filename
          if (name.startsWith('snapshot_')) {
            name = name.substring(9)
          }

          // 调用 ListManage 中的 saveSnapshotWithTime 方法
          await userSpace.listManage.saveSnapshotWithTime(name, body, time)

          res.writeHead(200, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ success: true }))
        } catch (err: any) {
          res.writeHead(500)
          res.end(err.message)
        }
        return
      }

      // [新增] User Login Verification
      if (pathname === '/api/user/verify' && req.method === 'POST') {
        void readBody(req).then(body => {
          try {
            const { username, password } = JSON.parse(body)
            if (!username || !password) {
              res.writeHead(400)
              res.end('Missing username or password')
              return
            }
            const user = global.lx.config.users.find(u => u.name === username && u.password === password)
            if (user) {
              res.writeHead(200, { 'Content-Type': 'application/json' })
              res.end(JSON.stringify({ success: true }))
            } else {
              res.writeHead(401, { 'Content-Type': 'application/json' })
              res.end(JSON.stringify({ success: false, message: 'Invalid credentials' }))
            }
          } catch (e) {
            res.writeHead(400)
            res.end('Bad Request')
          }
        })
        return
      }

      // [新增] Get User List (User Auth)
      if (pathname === '/api/user/list' && req.method === 'GET') {
        const username = req.headers['x-user-name'] as string
        const password = req.headers['x-user-password'] as string

        if (!username || !password) {
          res.writeHead(401)
          res.end('Missing credentials')
          return
        }

        const user = global.lx.config.users.find(u => u.name === username && u.password === password)
        if (!user) {
          res.writeHead(401)
          res.end('Unauthorized')
          return
        }

        const userSpace = getUserSpace(username)
        void userSpace.listManage.getListData().then(data => {
          res.writeHead(200, {
            'Content-Type': 'application/json',
            'Cache-Control': 'no-cache, no-store, must-revalidate'
          })
          res.end(JSON.stringify(data))
        }).catch(err => {
          res.writeHead(500)
          res.end(err.message)
        })
        return
      }

      // [新增] Update User List (User Auth) - Full Restore/Overwrite
      if (pathname === '/api/user/list' && req.method === 'POST') {
        const username = req.headers['x-user-name'] as string
        const password = req.headers['x-user-password'] as string

        if (!username || !password) {
          res.writeHead(401)
          res.end('Missing credentials')
          return
        }

        const user = global.lx.config.users.find(u => u.name === username && u.password === password)
        if (!user) {
          res.writeHead(401)
          res.end('Unauthorized')
          return
        }

        void readBody(req).then(async body => {
          try {
            const listData = JSON.parse(body)
            const userSpace = getUserSpace(username)
            // Restore ensures consistency with the provided snapshot
            await userSpace.listManage.listDataManage.restore(listData)
            // Create a snapshot after update
            await userSpace.listManage.createSnapshot()

            res.writeHead(200, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ success: true }))
          } catch (err: any) {
            res.writeHead(500)
            res.end(err.message)
          }
        })
        return
      }

      // [新增] File Cache APIs
      // 1. Config Cache Location
      if (pathname === '/api/music/cache/config' && req.method === 'POST') {
        void readBody(req).then(body => {
          try {
            const { location } = JSON.parse(body)
            if (location) {
              fileCache.setCacheLocation(location)
              res.writeHead(200)
              res.end(JSON.stringify({ success: true }))
            } else {
              res.writeHead(400)
              res.end('Missing location')
            }
          } catch (e) {
            res.writeHead(500)
            res.end('Error')
          }
        })
        return
      }

      // 2. Check Cache
      if (pathname === '/api/music/cache/check' && req.method === 'GET') {
        const name = urlObj.searchParams.get('name')
        const singer = urlObj.searchParams.get('singer')
        const source = urlObj.searchParams.get('source')
        const songmid = urlObj.searchParams.get('songmid')
        const songId = urlObj.searchParams.get('songId')
        const quality = urlObj.searchParams.get('quality')

        if (!name || !singer || !source || (!songmid && !songId)) {
          res.writeHead(400)
          res.end('Missing params')
          return
        }

        const username = req.headers['x-user-name'] as string
        const result = fileCache.checkCache({ name, singer, source, songmid, songId, quality }, username)
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify(result))
        return
      }

      // 3. Trigger Download
      if (pathname === '/api/music/cache/download' && req.method === 'POST') {
        void readBody(req).then(body => {
          try {
            const { songInfo, url, quality } = JSON.parse(body)
            if (!songInfo || !url) {
              res.writeHead(400)
              res.end('Missing params')
              return
            }

            // Fire and forget (background download)
            const username = req.headers['x-user-name'] as string
            void fileCache.downloadAndCache(songInfo, url, quality, username)
              .then(() => console.log(`[Cache] Downloaded ${songInfo.name} for ${username || '_open'}`))
              .catch(err => console.error(`[Cache] Failed to download ${songInfo.name}:`, err))

            res.writeHead(200)
            res.end(JSON.stringify({ success: true, message: 'Download started' }))
          } catch (e) {
            res.writeHead(500)
            res.end('Error')
          }
        })
        return
      }

      // 4. Serve Cached File
      if (pathname.startsWith('/api/music/cache/file/')) {
        const parts = pathname.replace('/api/music/cache/file/', '').split('/')
        const username = parts.length > 1 ? decodeURIComponent(parts[0]) : '_open'
        const filename = parts.length > 1 ? parts[1] : parts[0]

        if (filename) {
          fileCache.serveCacheFile(req, res, decodeURIComponent(filename), username)
          return
        }
      }

      // 5. Get Cache Statistics
      if (pathname === '/api/music/cache/stats' && req.method === 'GET') {
        const username = req.headers['x-user-name'] as string
        try {
          const stats = fileCache.getCacheStats(username)
          res.writeHead(200, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ success: true, data: stats }))
        } catch (e: any) {
          res.writeHead(500, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ success: false, message: e.message || 'Failed to get cache stats' }))
        }
        return
      }

      // 6. Clear All Cache
      if (pathname === '/api/music/cache/clear' && req.method === 'POST') {
        const username = req.headers['x-user-name'] as string
        try {
          const result = fileCache.clearAllCache(username)
          res.writeHead(200, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ success: true, data: result }))
        } catch (e: any) {
          res.writeHead(500, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ success: false, message: e.message || 'Failed to clear cache' }))
        }
        return
      }


      // [New] Fetch Lyrics
      if (pathname === '/api/music/lyric' && req.method === 'GET') {
        const source = urlObj.searchParams.get('source')
        const songmid = urlObj.searchParams.get('songmid')

        if (!source || !songmid) {
          res.writeHead(400)
          res.end('Missing source or songmid')
          return
        }

        try {
          if (!musicSdk[source]) {
            throw new Error('Source not supported')
          }

          console.log('[Lyric] Fetching lyric for:', source, songmid)

          // Construct complete songInfo object for SDK compatibility
          // KuGou (kg) needs: name, hash, interval
          // MiGu (mg) needs: copyrightId, lrcUrl, mrcUrl, trcUrl (优先，避免调用getMusicInfo API)
          const songInfo = {
            songmid,
            name: urlObj.searchParams.get('name') || '',
            singer: urlObj.searchParams.get('singer') || '',
            hash: urlObj.searchParams.get('hash') || '',
            interval: urlObj.searchParams.get('interval') || '',
            copyrightId: urlObj.searchParams.get('copyrightId') || '',
            albumId: urlObj.searchParams.get('albumId') || '',
            lrcUrl: urlObj.searchParams.get('lrcUrl') || '',
            mrcUrl: urlObj.searchParams.get('mrcUrl') || '',
            trcUrl: urlObj.searchParams.get('trcUrl') || ''
          }

          const requestObj = musicSdk[source].getLyric(songInfo)
          const lyricInfo = await requestObj.promise

          // console.log(`[Lyric] SDK 返回数据详情 [${source} - ${songmid}]:`, {
          //   hasLrc: !!(lyricInfo.lyric || lyricInfo.lrc),
          //   hasTlrc: !!lyricInfo.tlyric,
          //   hasRlrc: !!lyricInfo.rlyric,
          //   hasKlrc: !!(lyricInfo.klyric || lyricInfo.lxlyric),
          //   keys: Object.keys(lyricInfo)
          // });

          res.writeHead(200, {
            'Content-Type': 'application/json',
            'Cache-Control': 'public, max-age=86400' // Cache lyrics for 1 day
          })
          res.end(JSON.stringify(lyricInfo))
        } catch (err: any) {
          console.error('[Lyric] Fetch error:', source, songmid, err.message || err)

          // Avoid circular structure error - only send message
          res.writeHead(500, { 'Content-Type': 'text/plain' })
          res.end(err.message || 'Failed to fetch lyric')
        }
        return
      }

      // [新增] Download Proxy API
      if (pathname === '/api/music/download' && req.method === 'GET') {
        const urlStr = urlObj.searchParams.get('url')
        const filename = urlObj.searchParams.get('filename') || 'download.mp3'
        const isInline = urlObj.searchParams.get('inline') === '1'

        if (!urlStr) {
          res.writeHead(400)
          res.end('Missing url param')
          return
        }

        try {
          console.log(`[DownloadProxy] Fetching: ${urlStr} (Inline: ${isInline})`)

          // Use needle to fetch stream (supports redirects and more robust)
          const needle = require('needle')

          // Manual redirect handling for maximum control and stability
          const doFetch = (targetUrl: string, attempt: number) => {
            if (attempt > 5) {
              console.error('[DownloadProxy] Too many redirects')
              if (!res.headersSent) {
                res.writeHead(502)
                res.end('Too Many Redirects')
              }
              return
            }

            const options: any = {
              follow_max: 0, // Disable auto-follow
              headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                // 'Referer': new URL(targetUrl).origin // Move to separate try-catch to avoid crash on relative/invalid URLs
              }
            }

            try {
              options.headers['Referer'] = new URL(targetUrl).origin
            } catch (e) {
              // Ignore invalid URLs for Referer
              console.warn(`[DownloadProxy] Could not generate Referer for: ${targetUrl}`)
            }

            // Forward Range header
            if (req.headers['range']) {
              options.headers['Range'] = req.headers['range']
            }

            try {
              // console.log(`[DownloadProxy] Fetching (Attempt ${attempt}): ${targetUrl}`)
              const stream = needle.get(targetUrl, options)

              stream.on('response', (proxyRes: any) => {
                // Handle Redirects
                if ([301, 302, 303, 307, 308].includes(proxyRes.statusCode)) {
                  const location = proxyRes.headers.location
                  if (location) {
                    // console.log(`[DownloadProxy] Redirecting (${proxyRes.statusCode}): ${location}`)
                    doFetch(location, attempt + 1)
                    return
                  }
                }

                // console.log(`[DownloadProxy] Serving Stream: ${proxyRes.statusCode}`)

                // Handle Final Response
                let contentType = proxyRes.headers['content-type'] || 'application/octet-stream'
                if (contentType.includes('audio/') || contentType.includes('video/')) {
                  contentType = contentType.split(';')[0].trim()
                }

                const headers: Record<string, string | string[] | undefined> = {
                  'Content-Type': contentType,
                  'Access-Control-Allow-Origin': '*',
                }

                if (proxyRes.headers['content-length']) headers['Content-Length'] = proxyRes.headers['content-length']
                if (proxyRes.headers['accept-ranges']) headers['Accept-Ranges'] = proxyRes.headers['accept-ranges']
                if (proxyRes.headers['content-range']) headers['Content-Range'] = proxyRes.headers['content-range']

                if (!isInline) {
                  headers['Content-Disposition'] = `attachment; filename="${encodeURIComponent(filename)}"`
                }

                if (!res.headersSent) {
                  res.writeHead(proxyRes.statusCode || 200, headers)
                  proxyRes.pipe(res)
                }
              })

              stream.on('done', (err: any) => {
                if (err) {
                  console.error('[DownloadProxy] Stream Done Error:', err)
                  if (!res.headersSent) {
                    res.writeHead(502)
                    res.end('Stream Error')
                  }
                }
              })

              stream.on('error', (err: any) => {
                console.error('[DownloadProxy] Request Error:', err)
                if (!res.headersSent) {
                  res.writeHead(502)
                  res.end('Request Error')
                }
              })

            } catch (err: any) {
              console.error('[DownloadProxy] Try Error:', err)
              if (!res.headersSent) {
                res.writeHead(500)
                res.end('Internal Server Error')
              }
            }
          }

          // Start the fetch process
          doFetch(urlStr, 0)

        } catch (err: any) {
          console.error('[DownloadProxy] Error:', err)
          res.writeHead(500)
          res.end('Server Error')
        }
        return
      }

      if (pathname === '/api/data/delete-playlist' && req.method === 'POST') {
        const auth = req.headers['x-frontend-auth']
        if (auth !== global.lx.config['frontend.password']) {
          res.writeHead(401)
          res.end('Unauthorized')
          return
        }


        void readBody(req).then(async body => {
          try {
            const { username, playlistId } = JSON.parse(body)

            // 检查用户是否存在
            if (!global.lx.config.users.some(u => u.name === username)) {
              res.writeHead(404)
              res.end('User not found')
              return
            }

            const userSpace = getUserSpace(username)
            const listManage = userSpace.listManage

            // 删除歌单
            await listManage.listDataManage.userListsRemove([playlistId])
            // 创建快照
            await listManage.createSnapshot()

            res.writeHead(200, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ success: true }))
          } catch (err: any) {
            res.writeHead(500)
            res.end(err.message)
          }
        })
        return
      }

      // 删除歌曲
      if (pathname === '/api/data/delete-song' && req.method === 'POST') {
        const auth = req.headers['x-frontend-auth']
        if (auth !== global.lx.config['frontend.password']) {
          res.writeHead(401)
          res.end('Unauthorized')
          return
        }

        void readBody(req).then(async body => {
          try {
            const { username, playlistId, songIndex } = JSON.parse(body)

            // 检查用户是否存在
            if (!global.lx.config.users.some(u => u.name === username)) {
              res.writeHead(404)
              res.end('User not found')
              return
            }

            const userSpace = getUserSpace(username)
            const listManage = userSpace.listManage
            const listData = await listManage.getListData()

            // 获取歌单
            const playlist = listData.userList.find((list: any) => list.id === playlistId)

            if (!playlist) {
              res.writeHead(404)
              res.end('Playlist not found')
              return
            }

            if (!playlist.list || songIndex >= playlist.list.length) {
              res.writeHead(404)
              res.end('Song not found')
              return
            }

            const songInfo = playlist.list[songIndex]
            // 从歌单中删除歌曲
            await listManage.listDataManage.listMusicRemove(playlistId, [songInfo.id])
            // 创建快照
            await listManage.createSnapshot()

            res.writeHead(200, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ success: true }))
          } catch (err: any) {
            res.writeHead(500)
            res.end(err.message)
          }
        })
        return
      }
      // 重命名歌单
      if (pathname === '/api/data/rename-playlist' && req.method === 'POST') {
        const auth = req.headers['x-frontend-auth']
        if (auth !== global.lx.config['frontend.password']) {
          res.writeHead(401)
          res.end('Unauthorized')
          return
        }

        void readBody(req).then(async body => {
          try {
            const { username, playlistId, newName } = JSON.parse(body)

            // 检查用户是否存在
            if (!global.lx.config.users.some(u => u.name === username)) {
              res.writeHead(404)
              res.end('User not found')
              return
            }

            const userSpace = getUserSpace(username)
            const listManage = userSpace.listManage
            const listData = await listManage.getListData()

            // 查找歌单
            const playlist = listData.userList.find((list: any) => list.id === playlistId)

            if (!playlist) {
              res.writeHead(404)
              res.end('Playlist not found')
              return
            }

            // 更新歌单信息
            await listManage.listDataManage.userListsUpdate([{
              id: playlist.id,
              name: newName,
              source: playlist.source,
              sourceListId: playlist.sourceListId,
              locationUpdateTime: playlist.locationUpdateTime
            }])
            // 创建快照
            await listManage.createSnapshot()

            res.writeHead(200, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ success: true }))
          } catch (err: any) {
            res.writeHead(500)
            res.end(err.message)
          }
        })
        return
      }

      // 批量删除歌曲
      if (pathname === '/api/data/batch-delete-songs' && req.method === 'POST') {
        const auth = req.headers['x-frontend-auth']
        if (auth !== global.lx.config['frontend.password']) {
          res.writeHead(401)
          res.end('Unauthorized')
          return
        }

        void readBody(req).then(async body => {
          try {
            const { username, playlistId, songIndices } = JSON.parse(body)

            // 检查用户是否存在
            if (!global.lx.config.users.some(u => u.name === username)) {
              res.writeHead(404)
              res.end('User not found')
              return
            }

            const userSpace = getUserSpace(username)
            const listManage = userSpace.listManage
            const listData = await listManage.getListData()

            // 获取歌单
            const playlist = listData.userList.find((list: any) => list.id === playlistId)

            if (!playlist) {
              res.writeHead(404)
              res.end('Playlist not found')
              return
            }

            // 获取要删除的歌曲ID列表
            const songIds = songIndices.map((index: number) => {
              if (playlist.list && playlist.list[index]) {
                const id = playlist.list[index].id
                return id
              }
              return null
            }).filter((id: any) => id !== null)

            if (songIds.length === 0) {
              res.writeHead(400)
              res.end('No valid songs selected')
              return
            }

            // 批量删除
            await listManage.listDataManage.listMusicRemove(playlistId, songIds)
            // 创建快照
            await listManage.createSnapshot()

            res.writeHead(200, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ success: true }))
          } catch (err: any) {
            res.writeHead(500)
            res.end(err.message)
          }
        })
        return
      }

      // [新增] Web播放器公共配置 API (无需鉴权)
      if (pathname === '/api/music/config' && req.method === 'GET') {
        res.writeHead(200, {
          'Content-Type': 'application/json',
          'Cache-Control': 'no-cache'
        })
        res.end(JSON.stringify({
          'player.enableAuth': global.lx.config['player.enableAuth'] || false
        }))
        return
      }

      // [新增] Web播放器认证 API（颁发 HttpOnly Cookie Session）
      if (pathname === '/api/music/auth' && req.method === 'POST') {
        void readBody(req).then(body => {
          try {
            const { password } = JSON.parse(body)
            const correctPassword = global.lx.config['player.password'] || ''

            if (password === correctPassword) {
              const sessionId = generateSessionId()
              playerSessions.set(sessionId, { createdAt: Date.now() })
              res.writeHead(200, {
                'Content-Type': 'application/json',
                'Set-Cookie': `${SESSION_COOKIE_NAME}=${sessionId}; HttpOnly; Path=/; SameSite=Strict; Max-Age=${SESSION_TTL / 1000}`
              })
              res.end(JSON.stringify({ success: true }))
            } else {
              res.writeHead(200, { 'Content-Type': 'application/json' })
              res.end(JSON.stringify({ success: false }))
            }
          } catch (err: any) {
            res.writeHead(500)
            res.end(JSON.stringify({ success: false, error: err.message }))
          }
        })
        return
      }

      // [新增] Web播放器登出 API（清除 Session Cookie）
      if (pathname === '/api/music/auth/logout' && req.method === 'POST') {
        const cookies = parseCookies(req.headers['cookie'])
        const sessionId = cookies[SESSION_COOKIE_NAME]
        if (sessionId) playerSessions.delete(sessionId)
        res.writeHead(200, {
          'Content-Type': 'application/json',
          'Set-Cookie': `${SESSION_COOKIE_NAME}=; HttpOnly; Path=/; SameSite=Strict; Max-Age=0`
        })
        res.end(JSON.stringify({ success: true }))
        return
      }

      // [新增] Web播放器认证状态检查 API
      if (pathname === '/api/music/auth/verify' && req.method === 'GET') {
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ valid: checkPlayerAuth(req) }))
        return
      }

      // [新增] 音乐搜索 API
      if (pathname === '/api/music/search' && req.method === 'GET') {
        const name = urlObj.searchParams.get('name') || ''
        const singer = urlObj.searchParams.get('singer') || ''
        const source = urlObj.searchParams.get('source') || 'kw'
        const limit = parseInt(urlObj.searchParams.get('limit') || '20')
        const page = parseInt(urlObj.searchParams.get('page') || '1')

        if (!name) {
          res.writeHead(400); res.end('Missing name'); return
        }

        try {
          if (!musicSdk[source]) {
            throw new Error(`Source ${source} is not supported`)
          }
          const searchData = await musicSdk[source].musicSearch.search(name, page, limit)
          const list = searchData.list || []

          fs.appendFileSync(path.join(process.cwd(), 'debug.txt'), `[Search] Source: ${source}, Query: ${name}, Result Count: ${list.length}\n`)
          res.writeHead(200, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify(list))
        } catch (err: any) {
          fs.appendFileSync(path.join(process.cwd(), 'debug.txt'), `[Search Error] ${err.message}\n${err.stack}\n`)
          console.error(err)
          res.writeHead(500, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ error: err.message, code: 500 }))
        }
        return
      }

      // [新增] 音乐 URL API
      if (pathname === '/api/music/url' && req.method === 'POST') {
        const clientUsername = req.headers['x-user-name'] as string | undefined

        void readBody(req).then(async body => {
          try {
            let { songInfo, quality } = JSON.parse(body)
            songInfo = normalizeSongInfo(songInfo)
            // console.log('[MusicUrl] Song Info:', JSON.stringify(songInfo, null, 2))
            if (!songInfo || !songInfo.source) {
              throw new Error('Invalid songInfo')
            }
            const source = songInfo.source
            let result

            let customSourceError: string | null = null
            let attempts: any[] = []
            if (isSourceSupported(source, clientUsername)) {
              try {
                console.log(`[MusicUrl] Using custom source for: ${source} (User: ${clientUsername || 'Guest'})`)
                const userApiResult = await callUserApiGetMusicUrl(source, songInfo, quality || '128k', clientUsername)
                result = userApiResult
                attempts = userApiResult.attempts || []
              } catch (userApiError: any) {
                console.error(`[MusicUrl] Custom source failed:`, userApiError.message)
                customSourceError = userApiError.message
                attempts = userApiError.attempts || []
                // 不抛出错误，继续尝试内置源
              }
            }

            // 回退到内置 musicSdk
            if (!result) {
              if (!musicSdk[source] || !musicSdk[source].getMusicUrl) {
                // 如果内置也不支持，且自定义源也报错了，合并错误抛出
                if (customSourceError) {
                  const err: any = new Error(`自定义源获取失败: ${customSourceError}`)
                  err.attempts = attempts
                  throw err
                }
                throw new Error(`Source ${source} not supported`)
              }
              console.log(`[MusicUrl] Using built-in musicSdk for: ${source}`)
              result = await musicSdk[source].getMusicUrl(songInfo, quality || '128k')
            }

            // 合并自定义源的错误消息和尝试记录用于前端提示
            if (result) {
              if (customSourceError) result.errorMsg = customSourceError
              if (attempts.length > 0) result.attempts = attempts
            }

            // [Fix] Server-side Mixed Content handling & Redirect Resolution
            // If the upstream URL is HTTP, rewrite it to use our secure proxy OR resolve it if it's a redirect
            if (result && result.url) {
              // 1. Resolve Redirects (301, 302, 307, etc.) to get direct link
              try {
                // Only try to resolve if it looks like a remote URL
                if (result.url.startsWith('http')) {
                  const needle = require('needle')
                  const checkRedirect = async (u: string, depth: number = 0): Promise<string> => {
                    if (depth > 3) return u // Max depth 3
                    try {
                      const resp = await needle('head', u, null, {
                        follow_max: 0,
                        response_timeout: 3000,
                        read_timeout: 3000,
                        headers: {
                          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                          'Referer': new URL(u).origin
                        }
                      })
                      if ([301, 302, 303, 307, 308].includes(resp.statusCode) && resp.headers.location) {
                        let nextUrl = resp.headers.location
                        if (!nextUrl.startsWith('http')) {
                          try { nextUrl = new URL(nextUrl, u).href } catch (e) { }
                        }
                        // console.log(`[MusicUrl] Resolving redirect (${resp.statusCode}): ${u} -> ${nextUrl}`)
                        console.log(`[MusicUrl] Resolving redirect `)
                        return checkRedirect(nextUrl, depth + 1)
                      }
                    } catch (e: any) {
                      // console.warn(`[MusicUrl] Resolve check failed for ${u}:`, e.message)
                    }
                    return u
                  }

                  const finalUrl = await checkRedirect(result.url)
                  if (finalUrl !== result.url) {
                    result.url = finalUrl
                  }
                }
              } catch (e) {
                console.error('[MusicUrl] Resolve Error:', e)
              }

              // 2. Mixed Content Handling (Optional Proxy) implementation details handled by frontend now
              // But we can keep the log for debugging
              if (result.url.startsWith('http://')) {
                console.log(`[MusicUrl] Note: URL is HTTP, frontend might proxy if enabled: ${result.url}`)
              }
            }

            res.writeHead(200, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify(result))
          } catch (err: any) {
            console.error('[MusicUrl] Error:', err.message)
            // [Fix] Return 500 but with specific error JSON to let frontend show detailed toast
            res.writeHead(500, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ error: err.message, code: 500, attempts: err.attempts }))
          }
        })
        return
      }

      // [新增] 歌词 API
      if (pathname === '/api/music/lyric' && req.method === 'POST') {
        void readBody(req).then(async body => {
          try {
            let { songInfo } = JSON.parse(body)
            songInfo = normalizeSongInfo(songInfo)
            if (!songInfo || !songInfo.source) {
              throw new Error('Invalid songInfo')
            }
            const source = songInfo.source
            if (!musicSdk[source] || !musicSdk[source].getLyric) {
              throw new Error(`Source ${source} not supported`)
            }
            const result = await musicSdk[source].getLyric(songInfo)
            res.writeHead(200, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify(result))
          } catch (err: any) {
            console.error(err)
            res.writeHead(500)
            res.end(err.message)
          }
        })
        return
      }

      // [新增] 热搜 API
      if (pathname === '/api/music/hotSearch' && req.method === 'GET') {
        const source = urlObj.searchParams.get('source') || 'mg'

        try {
          // 检查是否支持热搜
          if (!musicSdk[source] || !musicSdk[source].hotSearch) {
            res.writeHead(404, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ error: '该音源不支持热搜功能' }))
            return
          }

          console.log(`[HotSearch] 获取热搜: source=${source}`)
          const result = await musicSdk[source].hotSearch.getList()

          res.writeHead(200, {
            'Content-Type': 'application/json',
            'Cache-Control': 'public, max-age=300' // 5分钟缓存
          })
          res.end(JSON.stringify(result))
        } catch (err: any) {
          console.error('[HotSearch] Error:', err.message)
          res.writeHead(500, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ error: err.message || '获取热搜失败' }))
        }
        return
      }


      // [新增] 评论 API
      if (pathname === '/api/music/comment' && req.method === 'POST') {
        void readBody(req).then(async body => {
          try {
            let { songInfo, type, page, limit } = JSON.parse(body)
            songInfo = normalizeSongInfo(songInfo)
            if (!songInfo || !songInfo.source) {
              console.warn('[Comment] Invalid request body:', body)
              throw new Error('Invalid songInfo')
            }
            const source = songInfo.source
            console.log(`[Comment] Request: ${source} - ${songInfo.name} - ${type} - page ${page}`)

            if (!musicSdk[source] || !musicSdk[source].comment) {
              console.warn(`[Comment] Source ${source} not supported for comments`)
              throw new Error(`Source ${source} not supported for comments`)
            }

            const method = type === 'hot' ? 'getHotComment' : 'getComment'
            console.log(`[Comment] Song: ${songInfo.name}, ID: ${songInfo.songmid}, Source: ${source}`)

            if (!musicSdk[source].comment[method]) {
              console.warn(`[Comment] Method ${method} not supported for source ${source}`)
              throw new Error(`Method ${method} not supported for source ${source}`)
            }

            const result = await musicSdk[source].comment[method](songInfo, page, limit)
            console.log(`[Comment] Success: ${source} - ${result.comments?.length} comments found`)
            res.writeHead(200, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify(result))
          } catch (err: any) {
            console.error('[Comment] Error:', err.message)
            res.writeHead(500, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ error: err.message, code: 500 }))
          }
        })
        return
      }

      // [新增] 封面 API (备用)

      // [新增] 自定义源管理 API
      if (pathname === '/api/custom-source/validate' && req.method === 'POST') {
        return customSourceHandlers.handleValidate(req, res)
      }
      if (pathname === '/api/custom-source/import' && req.method === 'POST') {
        return customSourceHandlers.handleImport(req, res)
      }
      if (pathname === '/api/custom-source/upload' && req.method === 'POST') {
        return customSourceHandlers.handleUpload(req, res)
      }
      if (pathname === '/api/custom-source/list' && req.method === 'GET') {
        const username = urlObj.searchParams.get('username') || 'default'
        return customSourceHandlers.handleList(req, res, username)
      }
      if (pathname === '/api/custom-source/toggle' && req.method === 'POST') {
        return customSourceHandlers.handleToggle(req, res)
      }
      if (pathname === '/api/custom-source/delete' && req.method === 'POST') {
        return customSourceHandlers.handleDelete(req, res)
      }

      if (pathname === '/api/custom-source/reorder' && req.method === 'POST') {
        return customSourceHandlers.handleReorder(req, res)
      }

      // elFinder 文件管理器连接器
      if (pathname === '/api/elfinder/connector') {
        // [修改] 优先从 Header 获取，如果没有则尝试从 URL 参数获取 (用于支持下载和预览)
        const auth = req.headers['x-frontend-auth'] || urlObj.searchParams.get('auth')

        if (auth !== global.lx.config['frontend.password']) {
          res.writeHead(401)
          res.end('Unauthorized')
          return
        }

        // 处理GET请求
        if (req.method === 'GET') {
          void (async () => {
            try {
              const params: any = {}
              const url = new URL(req.url || '', `http://${req.headers.host}`)
              url.searchParams.forEach((value, key) => {
                params[key] = value
              })

              const connector = new ElFinderConnector(getSystemRoot())
              const cmd = params.cmd || 'open'
              const result = await connector.handle(cmd, params)

              // [新增] 处理文件下载 (file) 和 打包下载 (zipdl)
              if ((cmd === 'file' || cmd === 'zipdl') && result.path && !result.error) {
                if (fs.existsSync(result.path)) {
                  const mime = getMime(result.path)
                  const headers: any = { 'Content-Type': mime }

                  // 如果是下载请求，或者是打包下载，强制添加附件头
                  if (params.download === '1' || cmd === 'zipdl') {
                    headers['Content-Disposition'] = `attachment; filename="${encodeURIComponent(path.basename(result.path))}"`
                  }

                  res.writeHead(200, headers)
                  fs.createReadStream(result.path).pipe(res)
                  return
                } else {
                  res.writeHead(404)
                  res.end('Not Found')
                  return
                }
              }

              res.writeHead(200, { 'Content-Type': 'application/json' })
              res.end(JSON.stringify(result))
            } catch (err: any) {
              res.writeHead(500)
              res.end(JSON.stringify({ error: [err.message] }))
            }
          })()
          return
        }

        // 处理POST请求
        if (req.method === 'POST') {
          const contentType = req.headers['content-type'] || ''

          // 处理文件上传
          if (contentType.includes('multipart/form-data')) {
            const form = formidable({ multiples: true, uploadDir: require('os').tmpdir() })

            form.parse(req, async (err: any, fields: any, files: any) => {
              if (err) {
                res.writeHead(500)
                res.end(JSON.stringify({ error: ['Upload error'] }))
                return
              }

              const params = { ...fields }
              // formidable v3 返回的值可能是数组，需要转换
              for (const key in params) {
                if (Array.isArray(params[key]) && params[key].length === 1) {
                  params[key] = params[key][0]
                }
              }
              console.log('[ElFinder] Files received:', Object.keys(files))
              console.log('[ElFinder] Files detail:', files)
              try {
                // 获取上传的文件（字段名可能是 upload, upload[] 等）
                const uploadedFiles = files.upload || files['upload[]'] || Object.values(files)[0]

                if (params.cmd === 'upload' && uploadedFiles) {
                  const connector = new ElFinderConnector(getSystemRoot())
                  const uploadFiles = Array.isArray(uploadedFiles) ? uploadedFiles : [uploadedFiles]
                  const added: any[] = []

                  for (const file of uploadFiles) {
                    const target = (connector as any).decode(params.target)
                    const destPath = require('path').join(target, file.originalFilename || file.newFilename)
                    await require('fs').promises.copyFile(file.filepath, destPath)
                    await require('fs').promises.unlink(file.filepath)

                    const fileInfo = await (connector as any).getFileInfo(destPath)
                    if (fileInfo) added.push(fileInfo)
                  }

                  res.writeHead(200, { 'Content-Type': 'application/json' })
                  res.end(JSON.stringify({ added }))
                } else {
                  const connector = new ElFinderConnector(getSystemRoot())
                  const cmd = params.cmd || 'open'
                  const result = await connector.handle(cmd, params)

                  res.writeHead(200, { 'Content-Type': 'application/json' })
                  res.end(JSON.stringify(result))
                }
              } catch (err: any) {
                res.writeHead(500)
                res.end(JSON.stringify({ error: [err.message] }))
              }
            })
            return
          } else {
            // 普通POST数据
            void readBody(req).then(async body => {
              try {
                // 修改开始：兼容 JSON 和 x-www-form-urlencoded
                let params: any = {}
                try {
                  params = JSON.parse(body || '{}')
                } catch (e) {
                  // 如果 JSON 解析失败，尝试解析为 URL 查询参数格式
                  const urlParams = new URLSearchParams(body)
                  urlParams.forEach((value, key) => {
                    // 处理数组情况 (例如 targets[])
                    if (params[key]) {
                      if (Array.isArray(params[key])) {
                        params[key].push(value)
                      } else {
                        params[key] = [params[key], value]
                      }
                    } else {
                      params[key] = value
                    }
                  })
                }
                // 修改结束

                const connector = new ElFinderConnector(getSystemRoot())
                const cmd = params.cmd || 'open'
                const result = await connector.handle(cmd, params)

                res.writeHead(200, { 'Content-Type': 'application/json' })
                res.end(JSON.stringify(result))
              } catch (err: any) {
                res.writeHead(500)
                res.end(JSON.stringify({ error: [err.message] }))
              }
            })
            return
          }
        }

        return
      }


      // Configuration API
      if (pathname === '/api/config') {
        const auth = req.headers['x-frontend-auth']
        if (auth !== global.lx.config['frontend.password']) {
          res.writeHead(401)
          res.end('Unauthorized')
          return
        }

        if (req.method === 'GET') {
          const config = {
            serverName: global.lx.config.serverName,
            maxSnapshotNum: global.lx.config.maxSnapshotNum,
            'list.addMusicLocationType': global.lx.config['list.addMusicLocationType'],
            'proxy.enabled': global.lx.config['proxy.enabled'],
            'proxy.header': global.lx.config['proxy.header'],
            'user.enablePath': global.lx.config['user.enablePath'],
            'user.enableRoot': global.lx.config['user.enableRoot'],
            'frontend.password': global.lx.config['frontend.password'],
            'player.enableAuth': global.lx.config['player.enableAuth'] || false,
            'player.password': global.lx.config['player.password'] || '',
            'webdav.url': global.lx.config['webdav.url'] || '',
            'webdav.username': global.lx.config['webdav.username'] || '',
            'webdav.password': global.lx.config['webdav.password'] || '',
            'sync.interval': global.lx.config['sync.interval'] || 60,
          }
          res.writeHead(200, {
            'Content-Type': 'application/json',
            'Cache-Control': 'no-cache, no-store, must-revalidate'
          })
          res.end(JSON.stringify(config))
          return
        }

        if (req.method === 'POST') {
          void readBody(req).then(body => {
            try {
              const newConfig = JSON.parse(body)
              if (newConfig.serverName !== undefined) global.lx.config.serverName = newConfig.serverName
              if (newConfig.maxSnapshotNum !== undefined) global.lx.config.maxSnapshotNum = parseInt(newConfig.maxSnapshotNum)
              if (newConfig['list.addMusicLocationType'] !== undefined) global.lx.config['list.addMusicLocationType'] = newConfig['list.addMusicLocationType']
              if (newConfig['proxy.enabled'] !== undefined) global.lx.config['proxy.enabled'] = newConfig['proxy.enabled']
              if (newConfig['proxy.header'] !== undefined) global.lx.config['proxy.header'] = newConfig['proxy.header']
              if (newConfig['user.enablePath'] !== undefined) global.lx.config['user.enablePath'] = newConfig['user.enablePath']
              // 新增：处理 user.enableRoot
              if (newConfig['user.enableRoot'] !== undefined) global.lx.config['user.enableRoot'] = newConfig['user.enableRoot']

              let warning = ''

              // 校验：至少开启一种模式
              if (!global.lx.config['user.enablePath'] && !global.lx.config['user.enableRoot']) {
                // 如果都关闭了，强制开启根路径（或者报错，这里建议强制开启并警告）
                global.lx.config['user.enableRoot'] = true
                warning = '必须至少开启一种连接方式，已自动开启“根路径”模式。'
              }

              // 校验：如果开启了根路径，检查密码重复
              if (global.lx.config['user.enableRoot']) {
                const passwords = global.lx.config.users.map(u => u.password)
                if (new Set(passwords).size !== passwords.length) {
                  warning = warning ? warning + '\n' : ''
                  warning += '检测到重复密码！开启“根路径”模式要求所有用户密码唯一，否则可能导致连接错误。'
                }
              }
              if (newConfig['frontend.password'] !== undefined) global.lx.config['frontend.password'] = newConfig['frontend.password']

              // Web播放器配置
              if (newConfig['player.enableAuth'] !== undefined) global.lx.config['player.enableAuth'] = newConfig['player.enableAuth']
              if (newConfig['player.password'] !== undefined) global.lx.config['player.password'] = newConfig['player.password']

              // WebDAV 配置
              if (newConfig['webdav.url'] !== undefined) global.lx.config['webdav.url'] = newConfig['webdav.url']
              if (newConfig['webdav.username'] !== undefined) global.lx.config['webdav.username'] = newConfig['webdav.username']
              if (newConfig['webdav.password'] !== undefined) global.lx.config['webdav.password'] = newConfig['webdav.password']
              if (newConfig['sync.interval'] !== undefined) global.lx.config['sync.interval'] = parseInt(newConfig['sync.interval'])

              // 更新 WebDAVSync 配置
              if (global.lx.webdavSync && (newConfig['webdav.url'] || newConfig['webdav.username'] || newConfig['webdav.password'] || newConfig['sync.interval'])) {
                global.lx.webdavSync.updateConfig({
                  url: global.lx.config['webdav.url'],
                  username: global.lx.config['webdav.username'],
                  password: global.lx.config['webdav.password'],
                  interval: global.lx.config['sync.interval'],
                })
              }

              const configPath = path.join(process.cwd(), 'config.js')
              const configContent = `module.exports = ${JSON.stringify({
                serverName: global.lx.config.serverName,
                'proxy.enabled': global.lx.config['proxy.enabled'],
                'proxy.header': global.lx.config['proxy.header'],
                'user.enablePath': global.lx.config['user.enablePath'],
                'user.enableRoot': global.lx.config['user.enableRoot'],
                maxSnapshotNum: global.lx.config.maxSnapshotNum,
                'list.addMusicLocationType': global.lx.config['list.addMusicLocationType'],
                'frontend.password': global.lx.config['frontend.password'],
                'player.enableAuth': global.lx.config['player.enableAuth'],
                'player.password': global.lx.config['player.password'],
                users: global.lx.config.users.map(u => ({
                  name: u.name,
                  password: u.password,
                  maxSnapshotNum: u.maxSnapshotNum,
                  'list.addMusicLocationType': u['list.addMusicLocationType'],
                })),
              }, null, 2)}`
              fs.writeFileSync(configPath, configContent)

              res.writeHead(200)
              res.end(JSON.stringify({ success: true, warning }))
            } catch (e) {
              res.writeHead(500)
              res.end('Server Error')
            }
          })
          return
        }
      }

      // Logs API
      if (pathname === '/api/logs' && req.method === 'GET') {
        const auth = req.headers['x-frontend-auth']
        if (auth !== global.lx.config['frontend.password']) {
          res.writeHead(401)
          res.end('Unauthorized')
          return
        }

        const logType = urlObj.searchParams.get('type') || 'app'
        const lines = parseInt(urlObj.searchParams.get('lines') || '100')
        const logFile = path.join(global.lx.logPath, `${logType}.log`)

        fs.readFile(logFile, 'utf-8', (err, content) => {
          if (err) {
            res.writeHead(404)
            res.end('Log file not found')
            return
          }
          const logLines = content.split('\n').slice(-lines)
          res.writeHead(200, {
            'Content-Type': 'application/json',
            'Cache-Control': 'no-cache, no-store, must-revalidate'
          })
          res.end(JSON.stringify({ logs: logLines }))
        })
        return
      }

      // Stats API
      if (pathname === '/api/stats' && req.method === 'GET') {
        const auth = req.headers['x-frontend-auth']
        if (auth !== global.lx.config['frontend.password']) {
          res.writeHead(401)
          res.end('Unauthorized')
          return
        }

        const stats = {
          users: global.lx.config.users.length,
          connectedDevices: status.devices.length,
          serverStatus: status.status,
          uptime: process.uptime(),
          memoryUsage: process.memoryUsage(),
        }
        res.writeHead(200, {
          'Content-Type': 'application/json',
          'Cache-Control': 'no-cache, no-store, must-revalidate'
        })
        res.end(JSON.stringify(stats))
        return
      }

      // WebDAV Test Connection API
      if (pathname === '/api/webdav/test' && req.method === 'POST') {
        const auth = req.headers['x-frontend-auth']
        if (auth !== global.lx.config['frontend.password']) {
          res.writeHead(401)
          res.end('Unauthorized')
          return
        }

        const webdavSync = global.lx.webdavSync
        if (!webdavSync) {
          res.writeHead(500)
          res.end(JSON.stringify({ success: false, message: 'WebDAV not initialized' }))
          return
        }

        void webdavSync.testConnection().then((result: any) => {
          res.writeHead(200, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify(result))
        })
        return
      }

      // WebDAV Sync File API
      if (pathname === '/api/webdav/sync-file' && req.method === 'POST') {
        const auth = req.headers['x-frontend-auth']
        if (auth !== global.lx.config['frontend.password']) {
          res.writeHead(401)
          res.end('Unauthorized')
          return
        }

        void readBody(req).then(async body => {
          try {
            const { action, path: filePath } = JSON.parse(body)
            const webdavSync = global.lx.webdavSync

            if (!webdavSync) {
              res.writeHead(500)
              res.end(JSON.stringify({ success: false, message: 'WebDAV not initialized' }))
              return
            }

            let success = false
            if (action === 'upload') {
              success = await webdavSync.uploadFile(filePath)
            } else if (action === 'download') {
              success = await webdavSync.downloadFile(filePath)
            }

            res.writeHead(200, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ success }))
          } catch (err: any) {
            res.writeHead(500)
            res.end(JSON.stringify({ success: false, message: err.message }))
          }
        })
        return
      }

      // WebDAV Backup API
      if (pathname === '/api/webdav/backup' && req.method === 'POST') {
        const auth = req.headers['x-frontend-auth']
        if (auth !== global.lx.config['frontend.password']) {
          res.writeHead(401)
          res.end('Unauthorized')
          return
        }

        const webdavSync = global.lx.webdavSync
        if (!webdavSync) {
          res.writeHead(500)
          res.end(JSON.stringify({ success: false, message: 'WebDAV not initialized' }))
          return
        }

        void readBody(req).then((body) => {
          const { force } = JSON.parse(body || '{}')
          void webdavSync.uploadBackup(force).then((success: boolean) => {
            res.writeHead(200, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ success }))
          })
        })
        return
      }
      // WebDAV Sync All Files API
      if (pathname === '/api/webdav/sync' && req.method === 'POST') {
        const auth = req.headers['x-frontend-auth']
        if (auth !== global.lx.config['frontend.password']) {
          res.writeHead(401)
          res.end('Unauthorized')
          return
        }

        const webdavSync = global.lx.webdavSync
        if (!webdavSync) {
          res.writeHead(500)
          res.end(JSON.stringify({ success: false, message: 'WebDAV not initialized' }))
          return
        }

        void webdavSync.syncAllFiles().then((success: boolean) => {
          res.writeHead(200, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ success }))
        })
        return
      }

      // WebDAV Restore API
      if (pathname === '/api/webdav/restore' && req.method === 'POST') {
        const auth = req.headers['x-frontend-auth']
        if (auth !== global.lx.config['frontend.password']) {
          res.writeHead(401)
          res.end('Unauthorized')
          return
        }

        const webdavSync = global.lx.webdavSync
        if (!webdavSync) {
          res.writeHead(500)
          res.end(JSON.stringify({ success: false, message: 'WebDAV not initialized' }))
          return
        }

        void webdavSync.restoreFromRemote().then((success: boolean) => {
          res.writeHead(200, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ success }))
        })
        return
      }

      // WebDAV Logs API
      if (pathname === '/api/webdav/logs' && req.method === 'GET') {
        const auth = req.headers['x-frontend-auth']
        if (auth !== global.lx.config['frontend.password']) {
          res.writeHead(401)
          res.end('Unauthorized')
          return
        }

        const webdavSync = global.lx.webdavSync
        if (!webdavSync) {
          res.writeHead(404)
          res.end(JSON.stringify({ logs: [] }))
          return
        }

        const logs = webdavSync.getSyncLogs()
        res.writeHead(200, {
          'Content-Type': 'application/json',
          'Cache-Control': 'no-cache, no-store, must-revalidate'
        })
        res.end(JSON.stringify({ logs }))
        return
      }
      // WebDAV Progress SSE API
      if (pathname === '/api/webdav/progress' && req.method === 'GET') {
        const auth = req.headers['x-frontend-auth'] || urlObj.searchParams.get('auth')
        if (auth !== global.lx.config['frontend.password']) {
          res.writeHead(401)
          res.end('Unauthorized')
          return
        }

        res.writeHead(200, {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          'Connection': 'keep-alive',
        })
        res.write('retry: 10000\\n\\n')

        const client = res
        sseClients.add(client)

        req.on('close', () => {
          sseClients.delete(client)
        })
        return
      }
      // Restart Server API
      if (pathname === '/api/restart' && req.method === 'POST') {
        const auth = req.headers['x-frontend-auth']
        if (auth !== global.lx.config['frontend.password']) {
          res.writeHead(401)
          res.end('Unauthorized')
          return
        }

        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ success: true, message: 'Server restarting...' }))

        // 延迟1秒后重启
        setTimeout(() => {
          console.log('Server restarting by admin request...')
          // 尝试通过更新文件时间戳触发 nodemon 重启
          const entryFile = path.join(process.cwd(), 'src', 'index.ts')
          try {
            if (fs.existsSync(entryFile)) {
              const time = new Date()
              fs.utimesSync(entryFile, time, time)
            } else {
              process.exit(0)
            }
          } catch (err) {
            console.error('Restart failed, forcing exit:', err)
            process.exit(0)
          }
        }, 1000)

        return
      }
      // File Management - List Files
      if (pathname === '/api/files' && req.method === 'GET') {
        const auth = req.headers['x-frontend-auth']
        if (auth !== global.lx.config['frontend.password']) {
          res.writeHead(401)
          res.end('Unauthorized')
          return
        }

        const dirPath = urlObj.searchParams.get('path') || ''
        const fullPath = path.join(global.lx.dataPath, dirPath)

        // 安全检查：确保路径在 dataPath 内
        if (!fullPath.startsWith(global.lx.dataPath)) {
          res.writeHead(403)
          res.end('Forbidden')
          return
        }

        try {
          const items = fs.readdirSync(fullPath).map(name => {
            const itemPath = path.join(fullPath, name)
            const stat = fs.statSync(itemPath)
            return {
              name,
              path: path.relative(global.lx.dataPath, itemPath),
              isDirectory: stat.isDirectory(),
              size: stat.size,
              mtime: stat.mtime.getTime(),
            }
          })
          res.writeHead(200, {
            'Content-Type': 'application/json',
            'Cache-Control': 'no-cache, no-store, must-revalidate'
          })
          res.end(JSON.stringify({ items }))
        } catch (err: any) {
          res.writeHead(500)
          res.end(JSON.stringify({ error: err.message }))
        }
        return
      }

      // File Management - Download File
      if (pathname === '/api/files/download' && req.method === 'GET') {
        const auth = req.headers['x-frontend-auth']
        if (auth !== global.lx.config['frontend.password']) {
          res.writeHead(401)
          res.end('Unauthorized')
          return
        }

        const filePath = urlObj.searchParams.get('path') || ''
        const fullPath = path.join(global.lx.dataPath, filePath)

        if (!fullPath.startsWith(global.lx.dataPath)) {
          res.writeHead(403)
          res.end('Forbidden')
          return
        }

        try {
          const content = fs.readFileSync(fullPath)
          res.writeHead(200, {
            'Content-Type': 'application/octet-stream',
            'Content-Disposition': `attachment; filename="${path.basename(fullPath)}"`,
          })
          res.end(content)
        } catch (err) {
          res.writeHead(404)
          res.end('File not found')
        }
        return
      }

      // File Management - Create/Update File
      if (pathname === '/api/files' && (req.method === 'POST' || req.method === 'PUT')) {
        const auth = req.headers['x-frontend-auth']
        if (auth !== global.lx.config['frontend.password']) {
          res.writeHead(401)
          res.end('Unauthorized')
          return
        }

        void readBody(req).then(body => {
          try {
            const { path: filePath, content, isDirectory } = JSON.parse(body)
            const fullPath = path.join(global.lx.dataPath, filePath)

            if (!fullPath.startsWith(global.lx.dataPath)) {
              res.writeHead(403)
              res.end('Forbidden')
              return
            }

            if (isDirectory) {
              fs.mkdirSync(fullPath, { recursive: true })
            } else {
              const dir = path.dirname(fullPath)
              if (!fs.existsSync(dir)) {
                fs.mkdirSync(dir, { recursive: true })
              }
              fs.writeFileSync(fullPath, content || '')
            }

            res.writeHead(200, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ success: true }))
          } catch (err: any) {
            res.writeHead(500)
            res.end(JSON.stringify({ success: false, message: err.message }))
          }
        })
        return
      }

      // File Management - Delete File
      if (pathname === '/api/files' && req.method === 'DELETE') {
        const auth = req.headers['x-frontend-auth']
        if (auth !== global.lx.config['frontend.password']) {
          res.writeHead(401)
          res.end('Unauthorized')
          return
        }

        void readBody(req).then(body => {
          try {
            const { path: filePath } = JSON.parse(body)
            const fullPath = path.join(global.lx.dataPath, filePath)

            if (!fullPath.startsWith(global.lx.dataPath)) {
              res.writeHead(403)
              res.end('Forbidden')
              return
            }

            const stat = fs.statSync(fullPath)
            if (stat.isDirectory()) {
              fs.rmSync(fullPath, { recursive: true })
            } else {
              fs.unlinkSync(fullPath)
            }

            res.writeHead(200, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ success: true }))
          } catch (err: any) {
            res.writeHead(500)
            res.end(JSON.stringify({ success: false, message: err.message }))
          }
        })
        return
      }

      res.writeHead(404)
      res.end('Not Found')
      return
    }

    const endUrl = `/${req.url?.split('/').at(-1) ?? ''}`
    let code
    let msg
    switch (endUrl) {
      case '/hello':
        // 新增：如果禁用了根路径，且当前访问的是根路径 (例如 /hello 而不是 /user/hello)，则拒绝
        if (!global.lx.config['user.enableRoot']) {
          const parts = pathname.split('/').filter(p => p)
          // parts.length <= 1 说明没有用户名部分，只有 'hello'
          if (parts.length <= 1) {
            code = 403
            msg = 'Root access disabled'
            break
          }
        }
        code = 200
        msg = SYNC_CODE.helloMsg
        break
      case '/id':
        // 新增：同上，对 /id 接口也进行同样的检查
        if (!global.lx.config['user.enableRoot']) {
          const parts = pathname.split('/').filter(p => p)
          if (parts.length <= 1) {
            code = 403
            msg = 'Root access disabled'
            break
          }
        }

        code = 200
        msg = SYNC_CODE.idPrefix + getServerId()
        break
      case '/ah':
        let targetUserName

        // 1. 尝试匹配用户路径 /<userName>/ah
        if (global.lx.config['user.enablePath']) {
          const parts = pathname.split('/').filter(p => p)
          // parts 应该是 ['username', 'ah']
          if (parts.length > 1 && parts[parts.length - 1] === 'ah') {
            targetUserName = decodeURIComponent(parts[parts.length - 2])
          }
        }

        // 2. 如果没有匹配到用户名（说明是访问的根路径 /ah，或者 URL 格式不对）
        if (!targetUserName) {
          // 如果未开启根路径模式，则拒绝访问
          if (!global.lx.config['user.enableRoot']) {
            res.writeHead(403)
            res.end('Access denied: Root path access is disabled. Please use /<username>/ah')
            return
          }
          // 如果开启了根路径，targetUserName 保持 undefined，authCode 会遍历尝试所有用户
        }

        // 将 targetUserName 传递给 authCode
        void authCode(req, res, lx.config.users, targetUserName)
        break
      default:
        // Serve static files
        // If root, serve index.html
        let filePath = path.join(process.cwd(), 'public', pathname === '/' ? 'index.html' : pathname)
        // Prevent directory traversal
        if (!filePath.startsWith(path.join(process.cwd(), 'public'))) {
          code = 403
          msg = 'Forbidden'
          break
        }

        // Check if file exists, if not fall back to 404 handled by serveStatic or check original logic
        if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
          serveStatic(req, res, filePath)
          return
        }

        code = 404
        msg = 'Not Found'
        break
    }
    if (!code) return
    res.writeHead(code)
    res.end(msg)
  })

  wss = new WebSocketServer({
    noServer: true,
  })

  // WebDAV Sync Progress Broadcast
  if (global.lx.webdavSync) {
    // 移除旧的监听器以防重复添加
    global.lx.webdavSync.removeAllListeners('progress')
    global.lx.webdavSync.on('progress', (data: any) => {
      // Broadcast to WebSocket clients
      if (wss) {
        const msg = JSON.stringify({ type: 'webdav_progress', data })
        for (const client of wss.clients) {
          if (client.readyState === WebSocket.OPEN) {
            client.send(msg)
          }
        }
      }
      // Broadcast to SSE clients
      const sseMsg = `data: ${JSON.stringify(data)}\\n\\n`
      for (const client of sseClients) {
        client.write(sseMsg)
      }
    })
  }

  wss.on('connection', function (socket, request) {
    socket.isReady = false
    socket.moduleReadys = {
      list: false,
      dislike: false,
    }
    socket.feature = {
      list: false,
      dislike: false,
    }
    socket.on('pong', () => {
      socket.isAlive = true
    })

    // const events = new Map<keyof ActionsType, Array<(err: Error | null, data: LX.Sync.ActionSyncType[keyof LX.Sync.ActionSyncType]) => void>>()
    // const events = new Map<keyof LX.Sync.ActionSyncType, Array<(err: Error | null, data: LX.Sync.ActionSyncType[keyof LX.Sync.ActionSyncType]) => void>>()
    // let events: Partial<{ [K in keyof LX.Sync.ActionSyncType]: Array<(data: LX.Sync.ActionSyncType[K]) => void> }> = {}
    let closeEvents: Array<(err: Error) => (void | Promise<void>)> = []
    let disconnected = false
    const msg2call = createMsg2call<LX.Sync.ClientSyncActions>({
      funcsObj: callObj,
      timeout: 120 * 1000,
      sendMessage(data) {
        if (disconnected) throw new Error('disconnected')
        void encryptMsg(socket.keyInfo, JSON.stringify(data)).then((data) => {
          // console.log('sendData', eventName)
          socket.send(data)
        }).catch(err => {
          syncLog.error('encrypt message error:', err)
          syncLog.error(err.message)
          socket.close(SYNC_CLOSE_CODE.failed)
        })
      },
      onCallBeforeParams(rawArgs) {
        return [socket, ...rawArgs]
      },
      onError(error, path, groupName) {
        const name = groupName ?? ''
        const userName = socket.userInfo?.name ?? ''
        const deviceName = socket.keyInfo?.deviceName ?? ''
        syncLog.error(`sync call ${userName} ${deviceName} ${name} ${path.join('.')} error:`, error)
        // if (groupName == null) return
        // // TODO
        // socket.close(SYNC_CLOSE_CODE.failed)
      },
    })
    socket.remote = msg2call.remote
    socket.remoteQueueList = msg2call.createQueueRemote('list')
    socket.remoteQueueDislike = msg2call.createQueueRemote('dislike')
    socket.addEventListener('message', ({ data }) => {
      if (typeof data != 'string') return
      void decryptMsg(socket.keyInfo, data).then((data) => {
        let syncData: any
        try {
          syncData = JSON.parse(data)
        } catch (err) {
          syncLog.error('parse message error:', err)
          socket.close(SYNC_CLOSE_CODE.failed)
          return
        }
        msg2call.message(syncData)
      }).catch(err => {
        syncLog.error('decrypt message error:', err)
        syncLog.error(err.message)
        socket.close(SYNC_CLOSE_CODE.failed)
      })
    })
    socket.addEventListener('close', () => {
      const err = new Error('closed')
      try {
        for (const handler of closeEvents) void handler(err)
      } catch (err: any) {
        syncLog.error(err?.message)
      }
      closeEvents = []
      disconnected = true
      msg2call.destroy()
      if (socket.isReady) {
        accessLog.info('deconnection', socket.userInfo.name, socket.keyInfo.deviceName)
        // events = {}
        if (!status.devices.map(d => getUserName(d.clientId)).filter(n => n == socket.userInfo.name).length) handleUnconnection(socket.userInfo.name)
      } else {
        const queryData = new URL(request.url as string, host).searchParams
        accessLog.info('deconnection', queryData.get('i'))
      }
    })
    socket.onClose = function (handler: typeof closeEvents[number]) {
      closeEvents.push(handler)
      return () => {
        closeEvents.splice(closeEvents.indexOf(handler), 1)
      }
    }
    socket.broadcast = function (handler) {
      if (!wss) return
      for (const client of wss.clients) handler(client)
    }

    void handleConnection(socket, request)
  })

  httpServer.on('upgrade', function upgrade(request, socket, head) {
    socket.addListener('error', onSocketError)

    // 调用全局定义的 authConnection (在文件顶部约113行已经定义过)
    authConnection(request, (err, success) => {
      // 如果报错或者 success 为 false，则拒绝连接
      if (err || !success) {
        // console.log('Auth failed', err)
        socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n')
        socket.destroy()
        return
      }

      socket.removeListener('error', onSocketError)

      // 鉴权通过，升级协议
      wss?.handleUpgrade(request, socket, head, function done(ws) {
        wss?.emit('connection', ws, request)
      })
    })
  })

  const interval = setInterval(() => {
    wss?.clients.forEach(socket => {
      if (socket.isAlive == false) {
        syncLog.info('alive check false:', socket.userInfo.name, socket.keyInfo.deviceName)
        socket.terminate()
        return
      }

      socket.isAlive = false
      socket.ping(noop)
      if (socket.keyInfo.isMobile) socket.send('ping', noop)
    })
  }, 30000)

  wss.on('close', function close() {
    clearInterval(interval)
  })

  httpServer.on('error', error => {
    console.log(error)
    reject(error)
  })

  httpServer.on('listening', () => {
    const addr = httpServer.address()
    // console.log(addr)
    if (!addr) {
      reject(new Error('address is null'))
      return
    }
    const bind = typeof addr == 'string' ? `pipe ${addr}` : `port ${addr.port}`
    startupLog.info(`Listening on ${ip} ${bind}`)
    resolve(null)
    void registerLocalSyncEvent(wss as LX.SocketServer)
  })

  host = `http://${ip.includes(':') ? `[${ip}]` : ip}:${port}`
  httpServer.listen(port, ip)
})

// const handleStopServer = async() => new Promise<void>((resolve, reject) => {
//   if (!wss) return
//   for (const client of wss.clients) client.close(SYNC_CLOSE_CODE.normal)
//   unregisterLocalSyncEvent()
//   wss.close()
//   wss = null
//   httpServer.close((err) => {
//     if (err) {
//       reject(err)
//       return
//     }
//     resolve()
//   })
// })

// export const stopServer = async() => {
//   codeTools.stop()
//   if (!status.status) {
//     status.status = false
//     status.message = ''
//     status.address = []
//     status.code = ''
//     sendStatus(status)
//     return
//   }
//   console.log('stoping sync server...')
//   await handleStopServer().then(() => {
//     console.log('sync server stoped')
//     status.status = false
//     status.message = ''
//     status.address = []
//     status.code = ''
//   }).catch(err => {
//     console.log(err)
//     status.message = err.message
//   }).finally(() => {
//     sendStatus(status)
//   })
// }

export const startServer = async (port: number, ip: string) => {
  // if (status.status) await handleStopServer()

  startupLog.info(`starting sync server in ${process.env.NODE_ENV == 'production' ? 'production' : 'development'}`)
  try {
    await musicSdk.init()
    startupLog.info('musicSdk initialized')
  } catch (err) {
    startupLog.error('musicSdk init failed:', err)
  }

  // 初始化自定义源
  try {
    console.log('[Server] Initializing custom user APIs...')
    // 修改：不传参数，默认加载 open + 所有用户源
    await initUserApis()
    console.log('[Server] Custom user APIs initialized')
  } catch (err: any) {
    console.error('[Server] Failed to initialize user APIs:', err.message)
  }

  await handleStartServer(port, ip).then(() => {
    // console.log('sync server started')
    status.status = true
    status.message = ''
    status.address = ip == '0.0.0.0' ? getAddress() : [ip]

    // void generateCode()
    // codeTools.start()
  }).catch(err => {
    console.log(err)
    status.status = false
    status.message = err.message
    status.address = []
    // status.code = ''
  })
  // .finally(() => {
  //   sendStatus(status)
  // })
}

export const getStatus = (): LX.Sync.Status => status

// export const generateCode = async() => {
//   status.code = handleGenerateCode()
//   sendStatus(status)
//   return status.code
// }

export const getDevices = async (userName: string) => {
  const userSpace = getUserSpace(userName)
  return userSpace.getDecices()
}

export const removeDevice = async (userName: string, clientId: string) => {
  if (wss) {
    for (const client of wss.clients) {
      if (client.userInfo?.name == userName && client.keyInfo?.clientId == clientId) client.close(SYNC_CLOSE_CODE.normal)
    }
  }
  const userSpace = getUserSpace(userName)
  await userSpace.removeDevice(clientId)
}