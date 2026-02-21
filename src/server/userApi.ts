import { VM } from 'vm2'
import * as fs from 'fs'
import * as path from 'path'
// @ts-ignore
import needle from 'needle'
import * as crypto from 'crypto'
import * as zlib from 'zlib'
import { promisify } from 'util'

const inflate = promisify(zlib.inflate)
const deflate = promisify(zlib.deflate)

// 彻底切断与沙箱上下文的联系
function decontextify(obj: any): any {
    if (obj === null || obj === undefined) return obj

    // 非对象直接返回
    if (typeof obj !== 'object') return obj

    // 处理 Buffer (极其重要：使用 Uint8Array 中转以切断 Proxy 链)
    try {
        if (Buffer.isBuffer(obj) || obj instanceof Uint8Array || (obj && obj.constructor && obj.constructor.name === 'Buffer')) {
            return Buffer.from(Uint8Array.from(obj as any))
        }
    } catch (e) { }

    // 处理数组
    if (Array.isArray(obj)) {
        try {
            return obj.map(item => decontextify(item))
        } catch (e) {
            return []
        }
    }

    // 处理 Error (增加对沙箱内 Error 的识别)
    if (obj instanceof Error || (obj && obj.constructor && obj.constructor.name === 'Error')) {
        const err = new Error(obj.message)
        err.stack = obj.stack
        return err
    }

    // 处理普通对象 (预防 Proxy Traps)
    try {
        const newObj: any = {}
        const keys = Object.keys(obj)
        for (const key of keys) {
            try {
                newObj[key] = decontextify(obj[key])
            } catch (e) { }
        }
        return newObj
    } catch (e) {
        try {
            const str = JSON.stringify(obj)
            return str ? JSON.parse(str) : String(obj)
        } catch (e2) {
            return String(obj)
        }
    }
}

// 用户API信息接口
interface UserApiInfo {
    id: string
    name: string
    description: string
    version: number | string
    author: string
    homepage: string
    script: string
    sources: Record<string, any>
    enabled: boolean
    owner: string // 'open' or username
    allowUnsafeVM?: boolean
}

// 加载的 API 实例
const loadedApis = new Map<string, any>()

// API 初始化状态追踪 map<id, status>
const apiStatus = new Map<string, { status: 'success' | 'failed', error?: string }>()

export function getApiStatus(id: string) {
    return apiStatus.get(id)
}


// 从脚本注释中提取元数据
export function extractMetadata(script: string): Partial<UserApiInfo> {
    const meta: any = {}

    // 匹配 JSDoc 风格的注释 (支持 /*! 和 /**)
    const commentMatch = script.match(/\/\*[*!]([\s\S]*?)\*\//)
    if (commentMatch) {
        const comment = commentMatch[1]

        // @name
        const nameMatch = comment.match(/@name\s+(.+)/)
        if (nameMatch) meta.name = nameMatch[1].trim()

        // @description
        const descMatch = comment.match(/@description\s+(.+)/)
        if (descMatch) meta.description = descMatch[1].trim()

        // @version
        const verMatch = comment.match(/@version\s+(.+)/)
        if (verMatch) meta.version = verMatch[1].trim()

        // @author
        const authorMatch = comment.match(/@author\s+(.+)/)
        if (authorMatch) meta.author = authorMatch[1].trim()

        // @repository or @homepage
        const repoMatch = comment.match(/@(?:repository|homepage)\s+(.+)/)
        if (repoMatch) meta.homepage = repoMatch[1].trim()
    }

    return meta
}

// 创建 lx.request 包装器（使用 needle）
function createLxRequest(isUnsafe: boolean = false) {
    return (url: string, options: any, callback: Function) => {
        const safeOptions = decontextify(options || {})
        const { method = 'get', timeout, headers, body, form, formData } = safeOptions

        let requestOptions: any = {
            headers,
            response_timeout: typeof timeout === 'number' && timeout > 0 ? Math.min(timeout, 60000) : 60000
        }

        let data = body
        if (form) {
            data = form
            requestOptions.json = false
        } else if (formData) {
            data = formData
            requestOptions.json = false
        }

        const request = needle.request(method, url, data, requestOptions, (err: any, resp: any, body: any) => {
            try {
                if (err) {
                    callback.call(null, decontextify(err), null, null)
                } else {
                    let parsedBody = body
                    if (typeof body === 'string') {
                        try {
                            parsedBody = JSON.parse(body)
                        } catch { }
                    }

                    let safeResp: any = {
                        statusCode: resp.statusCode,
                        statusMessage: resp.statusMessage,
                        headers: resp.headers,
                        body: decontextify(parsedBody)
                    }

                    // 核心修复：原生 VM 模式下，将响应对象通过 JSON 转换以修复原型链，但保留原始 Body 引用（如果不是对象）
                    if (isUnsafe) {
                        const jsonBody = (typeof parsedBody === 'object' && !Buffer.isBuffer(parsedBody))
                            ? JSON.parse(JSON.stringify(parsedBody))
                            : parsedBody;

                        safeResp = JSON.parse(JSON.stringify({
                            statusCode: resp.statusCode,
                            statusMessage: resp.statusMessage,
                            headers: resp.headers
                        }));
                        safeResp.body = jsonBody;
                    }

                    callback.call(null, null, safeResp, safeResp.body)
                }
            } catch (error: any) {
                callback.call(null, decontextify(error), null, null)
            }
        })

        return () => {
            if (!request.request.aborted) request.request.abort()
        }
    }
}

// 加载自定义源脚本
export async function loadUserApi(apiInfo: UserApiInfo): Promise<any> {
    // 从脚本中提取元数据
    const metadata = extractMetadata(apiInfo.script)
    const fullApiInfo = { ...apiInfo, ...metadata }

    // 创建事件处理映射
    const eventHandlers = new Map<string, Function>()
    let registeredSources: any = {}

    // ========== 关键修改：提前创建 initPromise ==========
    let initResolve: (() => void) | null = null
    let initReject: ((err: Error) => void) | null = null
    const initPromise = new Promise<void>((resolve, reject) => {
        initResolve = resolve
        initReject = reject
    })
    // ==================================================

    // lx 环境数据准备
    const lxDataInside = {
        version: '2.0.0',
        env: 'desktop',
        platform: 'web',
        currentScriptInfo: {
            name: fullApiInfo.name,
            description: fullApiInfo.description,
            version: fullApiInfo.version,
            author: fullApiInfo.author,
            homepage: fullApiInfo.homepage,
            rawScript: fullApiInfo.script,
        },
        EVENT_NAMES: {
            request: 'request',
            inited: 'inited',
            updateAlert: 'updateAlert'
        }
    }

    // 构建 lx 工具集
    const lxUtils = {
        buffer: {
            from: (d: any, e: any) => Buffer.from(decontextify(d), decontextify(e)),
            bufToString: (b: any, f: any) => Buffer.isBuffer(b) ? b.toString(f) : Buffer.from(b, 'binary').toString(f)
        },
        crypto: {
            md5: (str: string) => crypto.createHash('md5').update((decontextify(str) || '') as any).digest('hex'),
            aesEncrypt: (buffer: any, mode: string, key: any, iv: any) => {
                const dKey = decontextify(key)
                const dIv = decontextify(iv)
                const dBuffer = decontextify(buffer)
                const algorithm = `aes-${(dKey as any).length * 8}-${mode}`
                const cipher = crypto.createCipheriv(algorithm as any, dKey as any, dIv as any)
                return Buffer.concat([cipher.update(dBuffer as any) as any, cipher.final() as any])
            },
            rsaEncrypt: (buffer: any, key: any) => crypto.publicEncrypt(decontextify(key) as any, decontextify(buffer) as any),
            randomBytes: (size: number) => crypto.randomBytes(size),
        },
        zlib: {
            inflate: (buffer: any) => inflate(decontextify(buffer) as any),
            deflate: (buffer: any) => deflate(decontextify(buffer) as any),
        }
    }

    // 核心 lx 对象
    const lxObject = {
        ...lxDataInside,
        utils: lxUtils,
        request: createLxRequest(!!apiInfo.allowUnsafeVM),
        send: (eventName: string, data: any) => {
            const dData = decontextify(data)
            // console.log(`[UserApi-${fullApiInfo.name}] send:`, eventName)
            if (eventName === 'inited') {
                if (dData && dData.sources) {
                    registeredSources = dData.sources
                    console.log(`[UserApi-${fullApiInfo.name}] Registered sources:`, Object.keys(registeredSources).join(', '))
                }
                if (initResolve) initResolve()
            } else if (eventName === 'updateAlert') {
                const error = new Error(`发现新版本,需要更新: ${JSON.stringify(dData)}`)
                if (initReject) initReject(error)
            }
        },
        on: (eventName: string, handler: Function) => {
            // console.log(`[UserApi-${fullApiInfo.name}] on:`, eventName)
            if (eventName === 'request') {
                eventHandlers.set(eventName, handler)
            }
        }
    }

    // 完整沙箱环境
    const sandbox: any = {
        // console: {
        //     log: () => { }, // 静默脚本内部的普通日志
        //     info: () => { },
        //     error: console.error,
        //     warn: console.warn,
        //     debug: console.debug,
        //     time: console.time,
        //     timeEnd: console.timeEnd
        // },
        console,
        setTimeout,
        clearTimeout,
        setInterval,
        clearInterval,
        Buffer,
        URL,
        URLSearchParams,
        TextEncoder,
        TextDecoder,
        process: {
            nextTick: (fn: Function, ...args: any[]) => setTimeout(() => fn(...args), 0),
            env: { NODE_ENV: process.env.NODE_ENV || 'production' }
        },
        lx: lxObject,
        // 关键：适配混淆脚本对全局变量的引用
        global: null,
        window: null,
        globalThis: null,
        atob: (s: string) => Buffer.from(s, 'base64').toString('binary'),
        btoa: (s: string) => Buffer.from(s, 'binary').toString('base64'),
        crypto: crypto
    }
    sandbox.global = sandbox
    sandbox.window = sandbox
    sandbox.globalThis = sandbox

    try {
        if (apiInfo.allowUnsafeVM) {
            console.log(`[UserApi] ${fullApiInfo.name} 正在以原生 VM 模式启动...`)
            const vm = require('vm')
            const context = vm.createContext(sandbox)
            // 不再注入 injectionCode 字符串，环境已在 sandbox 中就绪
            vm.runInContext(apiInfo.script, context, {
                filename: `custom_source_${fullApiInfo.id}.js`,
                timeout: 10000
            })
        } else {
            // 保持 vm2 逻辑用于安全模式
            try {
                const vmInstance = new VM({
                    timeout: 10000,
                    sandbox,
                    eval: true,
                    wasm: false,
                })
                await vmInstance.run(apiInfo.script)
            } catch (e: any) {
                const isContextError = e.message.includes('contextified object') || e.message.includes('Operation not allowed')
                if (isContextError) {
                    console.warn(`[UserApi] ${fullApiInfo.name} 触发 vm2 安全限制，正在提示用户开启 VM 模式`)
                    throw new Error('REQUIRE_UNSAFE_VM')
                }
                throw e
            }
        }

        // 等待脚本调用 lx.send('inited')（最多等待 3 秒）
        await Promise.race([
            initPromise,
            new Promise((_, reject) => setTimeout(() => reject(new Error('初始化超时，请确保脚本调用了 lx.send("inited", ...)')), 3000))
        ])

        // 保存加载的 API
        const apiInstance = {
            info: { ...fullApiInfo, sources: registeredSources },
            handlers: eventHandlers,
            callRequest: async (action: string, source: string, info: any) => {
                try {
                    const handler = eventHandlers.get('request')
                    if (!handler) throw new Error(`源 ${fullApiInfo.name} 未注册 request 处理器`)

                    // 核心修复：如果是原生 VM 模式，将传入数据 JSON 化以纯净化原型链（确保它是 VM 内的对象）
                    let inputData = { action, source, info }
                    if (apiInfo.allowUnsafeVM) {
                        inputData = JSON.parse(JSON.stringify(inputData))
                    }

                    const result = await handler(inputData)
                    return decontextify(result)
                } catch (e: any) {
                    console.error(`[UserApi-${fullApiInfo.name}] callRequest Error:`, e.message)
                    throw e
                }
            }
        }

        loadedApis.set(apiInfo.id, apiInstance)
        console.log(`[UserApi] ✓ 成功加载: ${fullApiInfo.name} v${fullApiInfo.version} (Owner: ${fullApiInfo.owner})`)
        console.log(`[UserApi]   支持源: ${Object.keys(registeredSources).join(', ')}`)
        return { success: true, apiInstance, error: null }
    } catch (error: any) {
        console.error(`[UserApi] ✗ 加载失败 ${fullApiInfo.name}:`, error.message)
        if (error.stack && error.message !== 'REQUIRE_UNSAFE_VM') {
            console.error(`[UserApi] [Stack] ${fullApiInfo.name}:`, error.stack)
        }
        // 返回详细错误信息而不是直接抛出
        return { success: false, apiInstance: null, error: error.message, requireUnsafe: error.message === 'REQUIRE_UNSAFE_VM' }
    }
}

// 调用自定义源的 getMusicUrl
export async function callUserApiGetMusicUrl(
    source: string,
    songInfo: any,
    quality: string,
    clientUsername?: string
): Promise<{ url: string, type: string, sourceName?: string, attempts?: any[] }> {
    // 标准化 songInfo 格式：将 meta 中的字段提升到顶层
    const normalizedSongInfo = { ...songInfo }
    if (songInfo.meta) {
        // 将 meta 中的所有字段展开到顶层
        Object.assign(normalizedSongInfo, songInfo.meta)

        // ========== 通用字段映射 ==========
        // songId -> songmid (通用)
        if (songInfo.meta.songId && !normalizedSongInfo.songmid) {
            normalizedSongInfo.songmid = songInfo.meta.songId
        }

        // 图片字段统一
        if (songInfo.meta.picUrl && !normalizedSongInfo.img) {
            normalizedSongInfo.img = songInfo.meta.picUrl
        }

        // 音质信息
        if (songInfo.meta.qualitys && !normalizedSongInfo.types) {
            normalizedSongInfo.types = songInfo.meta.qualitys
        }
        if (songInfo.meta._qualitys && !normalizedSongInfo._types) {
            normalizedSongInfo._types = songInfo.meta._qualitys
        }

        // ========== 各平台特有字段 ==========
        // 酷狗 (kg): hash, albumId
        if (songInfo.meta.hash && !normalizedSongInfo.hash) {
            normalizedSongInfo.hash = songInfo.meta.hash
        }
        if (songInfo.meta.albumId && !normalizedSongInfo.albumId) {
            normalizedSongInfo.albumId = songInfo.meta.albumId
        }

        // 咪咕 (mg): copyrightId, lrcUrl, mrcUrl, trcUrl
        if (songInfo.meta.copyrightId && !normalizedSongInfo.copyrightId) {
            normalizedSongInfo.copyrightId = songInfo.meta.copyrightId
        }
        if (songInfo.meta.lrcUrl && !normalizedSongInfo.lrcUrl) {
            normalizedSongInfo.lrcUrl = songInfo.meta.lrcUrl
        }
        if (songInfo.meta.mrcUrl && !normalizedSongInfo.mrcUrl) {
            normalizedSongInfo.mrcUrl = songInfo.meta.mrcUrl
        }
        if (songInfo.meta.trcUrl && !normalizedSongInfo.trcUrl) {
            normalizedSongInfo.trcUrl = songInfo.meta.trcUrl
        }

        // QQ音乐 (tx): strMediaMid, albumMid
        if (songInfo.meta.strMediaMid && !normalizedSongInfo.strMediaMid) {
            normalizedSongInfo.strMediaMid = songInfo.meta.strMediaMid
        }
        if (songInfo.meta.albumMid && !normalizedSongInfo.albumMid) {
            normalizedSongInfo.albumMid = songInfo.meta.albumMid
        }

        // 不再删除 meta 对象，以免有些严谨的脚本报错（许多脚本会读取 info.meta）
        // delete normalizedSongInfo.meta
    }

    // ========== 顶层字段兜底映射 ==========
    if (!normalizedSongInfo.hash && songInfo.hash) {
        normalizedSongInfo.hash = songInfo.hash
    }
    if (!normalizedSongInfo.copyrightId && songInfo.copyrightId) {
        normalizedSongInfo.copyrightId = songInfo.copyrightId
    }
    if (!normalizedSongInfo.strMediaMid && songInfo.strMediaMid) {
        normalizedSongInfo.strMediaMid = songInfo.strMediaMid
    }
    if (!normalizedSongInfo.albumMid && songInfo.albumMid) {
        normalizedSongInfo.albumMid = songInfo.albumMid
    }
    if (!normalizedSongInfo.albumId && songInfo.albumId) {
        normalizedSongInfo.albumId = songInfo.albumId
    }
    if (!normalizedSongInfo.lrcUrl && songInfo.lrcUrl) {
        normalizedSongInfo.lrcUrl = songInfo.lrcUrl
    }
    if (!normalizedSongInfo.mrcUrl && songInfo.mrcUrl) {
        normalizedSongInfo.mrcUrl = songInfo.mrcUrl
    }
    if (!normalizedSongInfo.trcUrl && songInfo.trcUrl) {
        normalizedSongInfo.trcUrl = songInfo.trcUrl
    }

    let supportedCount = 0;
    let lastError: Error | null = null;

    // 查找支持该 source 的 API
    // 收集所有支持该 source 的 API，并根据权限过滤
    const candidates: any[] = []
    for (const [apiId, api] of loadedApis) {
        if (!api.info.enabled) continue
        if (!api.info.sources || !api.info.sources[source]) continue

        // 权限校验：只允许 open 源 或 当前用户及其拥有的源
        if (api.info.owner === 'open' || (clientUsername && api.info.owner === clientUsername)) {
            candidates.push(api)
        }
    }

    supportedCount = candidates.length

    if (supportedCount === 0) {
        // 如果没有找到源，可能是因为权限问题导致筛选后为空
        // 检查是否存在该源但无权限访问的情况（可选，用于调试）
        throw new Error(`未找到支持 ${source} 平台的自定义源，请在设置中添加或启用相关源 (User: ${clientUsername || 'Guest'})`)
    }

    // 逻辑分歧：
    // 1. 如果只有一个源支持 -> 重试 3 次
    // 2. 如果有多个源支持 -> 每个源试一次 (轮询)

    const attempts: any[] = []

    if (supportedCount === 1) {
        const api = candidates[0]
        const maxRetries = 3

        for (let i = 0; i < maxRetries; i++) {
            try {
                console.log(`[UserApi] 尝试 ${api.info.name} 获取 ${source} 音乐链接 (第 ${i + 1}/${maxRetries} 次, Owner: ${api.info.owner})`)

                const url = await api.callRequest('musicUrl', source, {
                    musicInfo: normalizedSongInfo,
                    type: quality
                })

                console.log(`[UserApi] ✓ ${api.info.name} 成功返回链接 (Owner: ${api.info.owner})`)
                attempts.push({ name: api.info.name, status: 'success', message: `第 ${i + 1} 次尝试成功` })
                return { url, type: quality, sourceName: api.info.name, attempts }
            } catch (error: any) {
                console.error(`[UserApi] ${api.info.name} 失败 (第 ${i + 1}/${maxRetries} 次):`, error.message)
                lastError = error
                attempts.push({ name: api.info.name, status: 'fail', message: `第 ${i + 1} 次尝试失败: ${error.message}` })
                // 如果不是最后一次尝试，等待一小会儿
                if (i < maxRetries - 1) {
                    await new Promise(r => setTimeout(r, 1000))
                }
            }
        }
    } else {
        // 多个源，轮流尝试
        for (const api of candidates) {
            try {
                console.log(`[UserApi] 尝试 ${api.info.name} 获取 ${source} 音乐链接 (Owner: ${api.info.owner})`)

                const url = await api.callRequest('musicUrl', source, {
                    musicInfo: normalizedSongInfo,
                    type: quality
                })

                console.log(`[UserApi] ✓ ${api.info.name} 成功返回链接 (Owner: ${api.info.owner})`)
                attempts.push({ name: api.info.name, status: 'success' })
                return { url, type: quality, sourceName: api.info.name, attempts }
            } catch (error: any) {
                console.error(`[UserApi] ${api.info.name} 失败:`, error.message)
                lastError = error
                attempts.push({ name: api.info.name, status: 'fail', message: error.message })
                continue
            }
        }
    }

    const detailMsg = supportedCount === 1
        ? `单音源 [${candidates[0].info.name}] 连续 3 次尝试均失败`
        : `已尝试全部 ${supportedCount} 个支持 ${source} 的自定义音源，但全部失败`

    const finalError: any = new Error(`${detailMsg}。最后错误: ${lastError?.message}`)
    finalError.attempts = attempts
    throw finalError
}

// 辅助函数：加载指定目录下的源
async function loadSourcesFromDir(dirPath: string, owner: string, stats: { loadedCount: number }) {
    const metaPath = path.join(dirPath, 'sources.json')
    if (!fs.existsSync(metaPath)) {
        return
    }

    try {
        const sources = JSON.parse(fs.readFileSync(metaPath, 'utf-8'))
        let needsSave = false

        for (const source of sources) {
            if (!source.enabled) {
                console.log(`[UserApi] [${owner}] 跳过已禁用: ${source.name}`)
                apiStatus.delete(source.id)
                continue
            }

            const scriptPath = path.join(dirPath, source.id)
            if (!fs.existsSync(scriptPath)) {
                console.warn(`[UserApi] [${owner}] 脚本文件未找到: ${source.id}`)
                continue
            }

            try {
                const script = fs.readFileSync(scriptPath, 'utf-8')
                const metadata = extractMetadata(script)

                const result = await loadUserApi({
                    id: source.id,
                    name: metadata.name || source.name,
                    description: metadata.description || '',
                    version: metadata.version || 1,
                    author: metadata.author || '',
                    homepage: metadata.homepage || '',
                    script,
                    sources: {},
                    enabled: true,
                    allowUnsafeVM: source.allowUnsafeVM, // 传递不安全模式标志
                    owner: owner // 设置 owner
                })

                if (result.success) {
                    stats.loadedCount++
                    apiStatus.set(source.id, { status: 'success' })

                    // [Self-Healing] 检查并修复 supportedSources
                    const runtimeSources = Object.keys(result.apiInstance.info.sources).sort();
                    const storedSources = (source.supportedSources || []).sort();

                    if (JSON.stringify(runtimeSources) !== JSON.stringify(storedSources)) {
                        console.log(`[UserApi] [Fix] [${owner}] 更新源 ${source.name} 的支持列表: ${JSON.stringify(storedSources)} -> ${JSON.stringify(runtimeSources)}`);
                        source.supportedSources = runtimeSources;
                        if (metadata.version && source.version !== metadata.version) source.version = metadata.version;
                        if (metadata.author && source.author !== metadata.author) source.author = metadata.author;
                        if (metadata.description && source.description !== metadata.description) source.description = metadata.description;
                        if (metadata.homepage && source.homepage !== metadata.homepage) source.homepage = metadata.homepage;
                        needsSave = true;
                    }
                } else {
                    console.error(`[UserApi] [${owner}] 加载 ${metadata.name || source.name} 失败: ${result.error}`)
                    apiStatus.set(source.id, { status: 'failed', error: result.error })
                }
            } catch (error: any) {
                console.error(`[UserApi] [${owner}] 加载 ${source.name} 失败:`, error.message)
                apiStatus.set(source.id, { status: 'failed', error: error.message })
            }
        }

        if (needsSave) {
            fs.writeFileSync(metaPath, JSON.stringify(sources, null, 2));
            console.log(`[UserApi] [${owner}] 已更新 sources.json 元数据`);
        }
    } catch (error: any) {
        console.error(`[UserApi] [${owner}] 读取 sources.json 失败:`, error.message)
    }
}

// 文件监控相关
let fsWatcher: fs.FSWatcher | null = null
const lastReloadMap = new Map<string, number>() // 记录每个用户的最后加载时间

// 启动文件监控
function startWatcher(sourceRoot: string) {
    if (fsWatcher) return

    console.log(`[UserApi] 启动源文件监控: ${sourceRoot}`)
    const debounceMap = new Map<string, NodeJS.Timeout>()

    try {
        // Warning: recursive option for fs.watch is generally supported on Windows/macOS but not Linux
        // For better cross-platform support, chokidar would be preferred, but using fs.watch as requested/minimal dependency
        fsWatcher = fs.watch(sourceRoot, { recursive: true }, (eventType, filename) => {
            if (!filename) return

            // 仅关注 .js 和 sources.json 文件的变化
            if (!filename.endsWith('.js') && !filename.endsWith('sources.json')) {
                return
            }

            // 解析用户名 (目录名)
            // filename on Windows might be "username\file.js"
            const parts = (filename as string).split(path.sep)
            let username = parts[0]

            // 如果是 _open 目录，对应 'open' 用户
            if (username === '_open') {
                username = 'open'
            }

            // 简单的防抖处理
            if (debounceMap.has(username)) {
                clearTimeout(debounceMap.get(username)!)
            }

            debounceMap.set(username, setTimeout(() => {
                // 检查是否是最近刚手动加载过 (避免面板上传造成的重复加载)
                // 阈值设为 3000ms，假设手动上传触发的 reload 会在这个时间内完成
                const lastReload = lastReloadMap.get(username) || 0
                if (Date.now() - lastReload < 3000) {
                    console.log(`[UserApi] [Watcher] 忽略近期更新的文件变动 (视为手动上传): ${filename}`)
                    return
                }

                console.log(`[UserApi] [Watcher] 检测到文件变动 (${eventType}): ${filename} -> 重新加载 ${username}`)
                initUserApis(username).catch(err => {
                    console.error(`[UserApi] [Watcher] 重新加载失败:`, err)
                })
            }, 2000)) // 2秒防抖，等待文件写入完成
        })

        // 进程退出时关闭监听
        process.on('exit', () => {
            if (fsWatcher) fsWatcher.close()
        })
    } catch (e) {
        console.error('[UserApi] 启动文件监控失败:', e)
    }
}

// 从文件系统加载所有已启用的自定义源
// 路径变更：DATA_PATH/users/source/{username} 和 DATA_PATH/users/source/_open
export async function initUserApis(targetUser?: string) {
    const dataPath = process.env.DATA_PATH || path.join(process.cwd(), 'data')
    const sourceRoot = path.join(dataPath, 'users', 'source')
    const stats = { loadedCount: 0 }

    // 更新最后加载时间
    if (targetUser) {
        lastReloadMap.set(targetUser, Date.now())
    } else {
        // 全局加载
    }

    console.log(`[UserApi] ========================================`)

    // 如果根目录不存在，无需加载
    if (!fs.existsSync(sourceRoot)) {
        console.log(`[UserApi] Source root directory not found: ${sourceRoot}`)
        console.log(`[UserApi] ========================================`)
        return
    }

    // 尝试启动监控 (只会在第一次调用且无 watcher 时启动)
    if (!fsWatcher) {
        startWatcher(sourceRoot)
    }

    if (targetUser) {
        console.log(`[UserApi] 重新加载用户源: ${targetUser}`)
        // 清理该用户的旧源和状态
        for (const [id, api] of loadedApis.entries()) {
            if (api.info.owner === targetUser) {
                loadedApis.delete(id)
                apiStatus.delete(id)
            }
        }

        // 加载该用户的源
        let dirName = targetUser

        // 特殊处理：如果是 'open'，对应目录是 '_open'
        if (targetUser === 'open') {
            dirName = '_open'
        }

        const userSourceDir = path.join(sourceRoot, dirName)
        if (fs.existsSync(userSourceDir)) {
            await loadSourcesFromDir(userSourceDir, targetUser, stats)
        }

    } else {
        console.log(`[UserApi] 初始化所有自定义源...`)
        loadedApis.clear()

        // 扫描 sourceRoot 下的所有子目录
        try {
            const entries = fs.readdirSync(sourceRoot, { withFileTypes: true })
            for (const entry of entries) {
                if (entry.isDirectory()) {
                    let owner = entry.name
                    // 如果目录是 _open，owner 为 'open'
                    if (entry.name === '_open') {
                        owner = 'open'
                    }

                    const dirPath = path.join(sourceRoot, entry.name)
                    await loadSourcesFromDir(dirPath, owner, stats)
                }
            }
        } catch (error: any) {
            console.error('[UserApi] 扫描源目录失败:', error.message)
        }
    }

    console.log(`[UserApi] 本次加载: ${stats.loadedCount} 个源`)
    console.log(`[UserApi] 当前总计: ${loadedApis.size} 个源`)
    console.log(`[UserApi] ========================================`)
}

// 获取所有已加载的 API
export function getLoadedApis() {
    return Array.from(loadedApis.values()).map(api => api.info)
}

// 检查某个源是否被支持
// clientUsername: 调用者的用户名。如果未提供，则只能检查 open 源
export function isSourceSupported(source: string, clientUsername?: string): boolean {
    for (const [apiId, api] of loadedApis) {
        if (!api.info.enabled || !api.info.sources || !api.info.sources[source]) {
            continue
        }

        // 权限检查
        if (api.info.owner === 'open' || (clientUsername && api.info.owner === clientUsername)) {
            return true
        }
    }
    return false
}
