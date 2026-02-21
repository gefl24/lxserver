import * as fs from 'fs'
import * as path from 'path'
import { extractMetadata, loadUserApi, initUserApis, getApiStatus } from './userApi'
import type { IncomingMessage, ServerResponse } from 'http'

// 读取请求体
async function readBody(req: IncomingMessage): Promise<string> {
    return new Promise((resolve, reject) => {
        let body = ''
        req.on('data', chunk => { body += chunk })
        req.on('end', () => resolve(body))
        req.on('error', reject)
    })
}

// 验证脚本
export async function handleValidate(req: IncomingMessage, res: ServerResponse) {
    try {
        const body = await readBody(req)
        const { script } = JSON.parse(body)

        if (!script || typeof script !== 'string') {
            throw new Error('Invalid script content')
        }

        const metadata = extractMetadata(script)

        // 尝试加载验证
        const result = await loadUserApi({
            id: 'temp_validation',
            script,
            enabled: false,
            ...metadata,
            owner: 'temp' // 临时验证 owner
        } as any)

        if (result.success) {
            // 检查是否注册了任何源
            const api = result.apiInstance
            const sources = api?.info?.sources || {}
            const sourcesCount = Object.keys(sources).length

            if (sourcesCount === 0) {
                throw new Error('脚本没有注册任何音源。请确保脚本正确调用了 lx.send("inited", { sources: {...} })')
            }

            res.writeHead(200, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({
                valid: true,
                metadata,
                sources: Object.keys(sources),
                sourcesCount
            }))
        } else {
            res.writeHead(200, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({
                valid: false,
                error: result.error,
                requireUnsafe: result.requireUnsafe,
                metadata // 即使验证失败也返回元数据，方便前端展示
            }))
        }
    } catch (err: any) {
        res.writeHead(400, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ valid: false, error: err.message }))
    }
}

// 辅助函数：获取脚本信息（元数据和支持的源）
async function getScriptInfo(scriptContent: string, allowUnsafeVM: boolean = false) {
    const metadata = extractMetadata(scriptContent)

    // 试运行脚本以获取支持的源
    let supportedSources: string[] = []
    let requireUnsafe = false
    try {
        const result = await loadUserApi({
            id: 'temp_analysis_' + Date.now(),
            script: scriptContent,
            enabled: false,
            allowUnsafeVM,
            ...metadata,
            owner: 'temp'
        } as any)

        if (result.success && result.apiInstance?.info?.sources) {
            supportedSources = Object.keys(result.apiInstance.info.sources)
        } else {
            requireUnsafe = !!result.requireUnsafe
        }
    } catch (e: any) {
        console.warn('[CustomSource] 分析脚本支持源失败:', e.message)
    }

    return { metadata, supportedSources, requireUnsafe }
}

// 辅助函数：获取源存储目录
function getSourceDir(username?: string) {
    const dataPath = process.env.DATA_PATH || path.join(process.cwd(), 'data')
    const root = path.join(dataPath, 'users', 'source')
    // 如果 username 是 'open' 或 'default' 或空，则映射到 '_open'
    const targetDirName = (username && username !== 'default' && username !== 'open') ? username : '_open'
    return path.join(root, targetDirName)
}

// 上传脚本
export async function handleUpload(req: IncomingMessage, res: ServerResponse) {
    try {
        const body = await readBody(req)
        const { filename, content, username, allowUnsafeVM } = JSON.parse(body)

        // 确定 owner 用于后续标识
        const targetOwner = (username && username !== 'default') ? username : 'open'

        const sourcesDir = getSourceDir(username)
        const metaPath = path.join(sourcesDir, 'sources.json')

        // 创建目录
        if (!fs.existsSync(sourcesDir)) {
            fs.mkdirSync(sourcesDir, { recursive: true })
        }

        // 获取脚本信息
        const { metadata, supportedSources, requireUnsafe } = await getScriptInfo(content, allowUnsafeVM)

        // 如果检测到需要不安全模式但未提供标志，则要求确认
        if (requireUnsafe && !allowUnsafeVM) {
            res.writeHead(200, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ success: false, requireUnsafe: true, message: '该脚本需要原生 VM 模式运行，可能存在安全风险，是否继续？' }))
            return
        }

        // 生成唯一ID
        const id = `${encodeURIComponent(metadata.name || filename)}`
        const scriptPath = path.join(sourcesDir, id)

        // 读取现有列表
        let sources: any[] = []
        if (fs.existsSync(metaPath)) {
            sources = JSON.parse(fs.readFileSync(metaPath, 'utf-8'))
        }

        // 检查是否已存在
        const existing = sources.find(s => s.id === id)
        if (existing) {
            throw new Error(`源 "${metadata.name}" 已存在于 [${targetOwner}]`)
        }

        // 保存脚本文件
        fs.writeFileSync(scriptPath, content, 'utf-8')

        // 更新元数据
        sources.push({
            id,
            name: metadata.name || filename,
            version: metadata.version || '1.0.0',
            author: metadata.author || '未知',
            description: metadata.description || '',
            homepage: metadata.homepage || '',
            size: Buffer.byteLength(content, 'utf-8'),
            supportedSources, // 保存支持的源
            enabled: false, // 默认禁用
            uploadTime: new Date().toISOString(),
            allowUnsafeVM: !!requireUnsafe || !!allowUnsafeVM,
            requireUnsafe: !!requireUnsafe
        })

        fs.writeFileSync(metaPath, JSON.stringify(sources, null, 2))

        // 重新加载该用户的API
        await initUserApis(targetOwner)

        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ success: true, id, metadata, supportedSources, owner: targetOwner, allowUnsafeVM: !!requireUnsafe || !!allowUnsafeVM }))
    } catch (err: any) {
        console.error('[CustomSource] Upload error:', err)
        res.writeHead(500, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ success: false, error: err.message }))
    }
}

// 从远程URL导入脚本
export async function handleImport(req: IncomingMessage, res: ServerResponse) {
    try {
        const body = await readBody(req)
        const { url, filename, username, allowUnsafeVM } = JSON.parse(body)

        if (!url) {
            throw new Error('Missing URL')
        }

        // 下载脚本内容
        const https = require('https')
        const http = require('http')
        const content = await new Promise<string>((resolve, reject) => {
            const protocol = url.startsWith('https') ? https : http
            protocol.get(url, (response: any) => {
                let data = ''
                response.on('data', (chunk: any) => data += chunk)
                response.on('end', () => resolve(data))
                response.on('error', reject)
            }).on('error', reject)
        })

        // 获取脚本信息
        const { metadata, supportedSources, requireUnsafe } = await getScriptInfo(content, allowUnsafeVM)

        // 如果检测到需要不安全模式但未提供标志，则要求确认
        if (requireUnsafe && !allowUnsafeVM) {
            res.writeHead(200, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ success: false, requireUnsafe: true, message: '该脚本需要原生 VM 模式运行，可能存在安全风险，是否继续？' }))
            return
        }

        const targetOwner = (username && username !== 'default') ? username : 'open'
        const sourcesDir = getSourceDir(username)
        const metaPath = path.join(sourcesDir, 'sources.json')

        // 创建目录
        if (!fs.existsSync(sourcesDir)) {
            fs.mkdirSync(sourcesDir, { recursive: true })
        }

        // 生成唯一ID
        const displayName = metadata.name || filename || 'unknown_source'
        const id = `${encodeURIComponent(displayName)}`
        const scriptPath = path.join(sourcesDir, id)

        // 读取现有列表
        let sources: any[] = []
        if (fs.existsSync(metaPath)) {
            sources = JSON.parse(fs.readFileSync(metaPath, 'utf-8'))
        }

        // 检查是否已存在
        const existing = sources.find(s => s.id === id)
        if (existing) {
            throw new Error(`源 "${displayName}" 已存在于 [${targetOwner}]`)
        }

        // 保存脚本文件
        fs.writeFileSync(scriptPath, content, 'utf-8')

        // 更新元数据
        sources.push({
            id,
            name: metadata.name || filename,
            version: metadata.version || '1.0.0',
            author: metadata.author || '未知',
            description: metadata.description || '',
            homepage: metadata.homepage || '',
            size: Buffer.byteLength(content, 'utf-8'),
            supportedSources, // 保存支持的源
            enabled: false,
            uploadTime: new Date().toISOString(),
            sourceUrl: url,
            allowUnsafeVM: !!requireUnsafe || !!allowUnsafeVM,
            requireUnsafe: !!requireUnsafe
        })

        fs.writeFileSync(metaPath, JSON.stringify(sources, null, 2))

        // 重新加载
        await initUserApis(targetOwner)

        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ success: true, filename: displayName, id, metadata, supportedSources, owner: targetOwner, allowUnsafeVM: !!requireUnsafe || !!allowUnsafeVM }))
    } catch (err: any) {
        console.error('[CustomSource] Import error:', err)
        res.writeHead(500, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ success: false, error: err.message }))
    }
}

// 获取列表
// 如果提供了 username，返回 open + username 的源
// 如果没提供，只返回 open 的源
export async function handleList(req: IncomingMessage, res: ServerResponse, username: string) {
    const allSources: any[] = []

    // 1. 读取 Open 源
    const openSourcesDir = getSourceDir('open') // -> .../_open
    const openMetaPath = path.join(openSourcesDir, 'sources.json')

    if (fs.existsSync(openMetaPath)) {
        try {
            const openSources = JSON.parse(fs.readFileSync(openMetaPath, 'utf-8'))
            openSources.forEach((s: any) => {
                s.owner = 'open'
                s.isPublic = true
            })
            allSources.push(...openSources)
        } catch (e) { }
    }

    // 2. 读取 User 源 (如果有)
    if (username && username !== 'default') {
        const userSourcesDir = getSourceDir(username)
        const userMetaPath = path.join(userSourcesDir, 'sources.json')

        if (fs.existsSync(userMetaPath)) {
            try {
                const userSources = JSON.parse(fs.readFileSync(userMetaPath, 'utf-8'))
                userSources.forEach((s: any) => {
                    s.owner = username
                    s.isPublic = false
                })
                allSources.push(...userSources)
            } catch (e) { }
        }
    }

    // 补充运行时状态
    const enrichedSources = allSources.map((source: any) => {
        // 合并运行时状态
        const status = getApiStatus(source.id)
        if (status) {
            source.status = status.status
            source.error = status.error
        }
        return source
    })

    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify(enrichedSources))
}

// 启用/禁用
// 启用/禁用
export async function handleToggle(req: IncomingMessage, res: ServerResponse) {
    try {
        const body = await readBody(req)
        const { id, sourceId, enabled, username, allowUnsafeVM } = JSON.parse(body)
        const targetId = id || sourceId

        let targetOwner = (username && username !== 'default') ? username : 'open'
        let sourcesDir = getSourceDir(targetOwner)
        let metaPath = path.join(sourcesDir, 'sources.json')

        if (!fs.existsSync(metaPath) && targetOwner !== 'open') {
            // 尝试 fallback 到 open
            const openSourcesDir = getSourceDir('open')
            const openMetaPath = path.join(openSourcesDir, 'sources.json')
            if (fs.existsSync(openMetaPath)) {
                targetOwner = 'open'
                sourcesDir = openSourcesDir
                metaPath = openMetaPath
            }
        }

        if (!fs.existsSync(metaPath)) {
            throw new Error('源列表不存在')
        }

        const sources = JSON.parse(fs.readFileSync(metaPath, 'utf-8'))
        const target = sources.find((s: any) => s.id === targetId)

        if (!target) {
            throw new Error('源不存在')
        }

        const oldEnabled = target.enabled
        const oldAllowUnsafeVM = !!target.allowUnsafeVM

        // 修改逻辑：只有当参数明确为 true 时才更新为 true，防止被默认值 false 覆盖
        if (allowUnsafeVM === true) target.allowUnsafeVM = true
        target.enabled = enabled !== undefined ? enabled : !target.enabled

        fs.writeFileSync(metaPath, JSON.stringify(sources, null, 2))

        // 重新加载
        try {
            await initUserApis(targetOwner)

            // 如果是尝试启用，检查启用后的实时状态
            if (target.enabled) {
                const status = getApiStatus(targetId)
                if (status && status.status === 'failed' && status.error === 'REQUIRE_UNSAFE_VM') {
                    console.warn(`[CustomSource] Detect REQUIRE_UNSAFE_VM during toggle for ${targetId}, rolling back...`)
                    // 回滚状态
                    target.enabled = oldEnabled
                    target.allowUnsafeVM = oldAllowUnsafeVM
                    fs.writeFileSync(metaPath, JSON.stringify(sources, null, 2))
                    await initUserApis(targetOwner)

                    res.writeHead(200, { 'Content-Type': 'application/json' })
                    res.end(JSON.stringify({ success: false, requireUnsafe: true, message: '该脚本需要原生 VM 模式运行，可能存在安全风险，是否继续？' }))
                    return
                }
            }

            res.writeHead(200, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ success: true, enabled: target.enabled }))
        } catch (e: any) {
            // initUserApis 本身不应抛出这个错误（内部已捕获并记录 status），但为了健壮性保留此判断
            if (e.message === 'REQUIRE_UNSAFE_VM') {
                res.writeHead(200, { 'Content-Type': 'application/json' })
                res.end(JSON.stringify({ success: false, requireUnsafe: true, message: '该脚本需要原生 VM 模式运行，可能存在安全风险，是否继续？' }))
                return
            }
            throw e
        }
    } catch (err: any) {
        console.error('[CustomSource] Toggle error:', err)
        res.writeHead(500)
        res.end(err.message)
    }
}

// 拖拽排序，更新 sources.json 中源的顺序
export async function handleReorder(req: IncomingMessage, res: ServerResponse) {
    try {
        const body = await readBody(req)
        const { username, sourceIds } = JSON.parse(body)

        if (!Array.isArray(sourceIds)) {
            throw new Error('sourceIds must be an array')
        }

        let targetOwner = (username && username !== 'default') ? username : 'open'
        let sourcesDir = getSourceDir(targetOwner)
        let metaPath = path.join(sourcesDir, 'sources.json')

        // Fallback to open if needed
        if (!fs.existsSync(metaPath) && targetOwner !== 'open') {
            const openSourcesDir = getSourceDir('open')
            const openMetaPath = path.join(openSourcesDir, 'sources.json')
            if (fs.existsSync(openMetaPath)) {
                targetOwner = 'open'
                sourcesDir = openSourcesDir
                metaPath = openMetaPath
            }
        }

        if (!fs.existsSync(metaPath)) {
            throw new Error('源列表不存在')
        }

        // Read current sources
        const sources = JSON.parse(fs.readFileSync(metaPath, 'utf-8'))

        // Reconstruct the array: order it according to sourceIds, any missing go to the end
        const newSources: any[] = []
        const currentSourcesMap = new Map(sources.map((s: any) => [s.id, s]))

        for (const id of sourceIds) {
            if (currentSourcesMap.has(id)) {
                newSources.push(currentSourcesMap.get(id))
                currentSourcesMap.delete(id)
            }
        }

        // Add any remaining sources that somehow weren't in the id array to the end
        for (const [id, source] of currentSourcesMap) {
            newSources.push(source)
        }

        // Save
        fs.writeFileSync(metaPath, JSON.stringify(newSources, null, 2))

        // Reload APIs to apply new priority ordering
        await initUserApis(targetOwner)

        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ success: true }))
    } catch (err: any) {
        console.error('[CustomSource] Reorder error:', err)
        res.writeHead(500)
        res.end(err.message)
    }
}

// 删除
export async function handleDelete(req: IncomingMessage, res: ServerResponse) {
    try {
        const body = await readBody(req)
        const { id, sourceId, username } = JSON.parse(body)
        const targetId = id || sourceId

        // 查找逻辑同 Toggle
        let targetOwner = (username && username !== 'default') ? username : 'open'
        let sourcesDir = getSourceDir(targetOwner)
        let metaPath = path.join(sourcesDir, 'sources.json')

        // 尝试定位源
        let found = false
        let sources = []

        if (fs.existsSync(metaPath)) {
            sources = JSON.parse(fs.readFileSync(metaPath, 'utf-8'))
            if (sources.find((s: any) => s.id === targetId)) {
                found = true
            }
        }

        if (!found && targetOwner !== 'open') {
            const openSourcesDir = getSourceDir('open')
            const openMetaPath = path.join(openSourcesDir, 'sources.json')

            if (fs.existsSync(openMetaPath)) {
                const openSources = JSON.parse(fs.readFileSync(openMetaPath, 'utf-8'))
                if (openSources.find((s: any) => s.id === targetId)) {
                    targetOwner = 'open'
                    sourcesDir = openSourcesDir
                    metaPath = openMetaPath
                    sources = openSources
                    found = true
                }
            }
        }

        if (!found) {
            throw new Error('源不存在')
        }

        const scriptPath = path.join(sourcesDir, targetId)
        sources = sources.filter((s: any) => s.id !== targetId)

        // 删除脚本文件
        if (fs.existsSync(scriptPath)) {
            fs.unlinkSync(scriptPath)
        }

        fs.writeFileSync(metaPath, JSON.stringify(sources, null, 2))

        // 重新初始化
        await initUserApis(targetOwner)

        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ success: true }))
    } catch (err: any) {
        console.error('[CustomSource] Delete error:', err)
        res.writeHead(500)
        res.end(err.message)
    }
}
