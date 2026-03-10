/**
 * 配置文件
 * 配置优先级：WEBDAV备份数据 > 环境变量 > config.js (本文件) > src/defaultConfig.ts (默认配置)
 */
module.exports = {
  // 同步服务名称
  // 环境变量: 无
  "serverName": "lxserver",

  // 是否使用代理转发请求到本服务器 (如果配置了 proxy.header，此项会自动设为 true)
  // 环境变量: 无 (通过 PROXY_HEADER 隐式开启)
  "proxy.enabled": false,

  // 代理转发的请求头 原始IP
  // 环境变量: PROXY_HEADER
  "proxy.header": "x-real-ip",

  // 服务绑定IP (0.0.0.0 允许外网访问，127.0.0.1 仅限本机)
  // 环境变量: BIND_IP
  "bindIP": "0.0.0.0",

  // 服务监听端口
  // 环境变量: PORT
  "port": 9527,

  // 是否开启用户路径 (baseurl/用户名)
  // 开启后连接URL需包含用户名，允许不同用户使用相同密码。关闭后仅使用密码鉴权，要求所有用户密码唯一。
  // 环境变量: USER_ENABLE_PATH (true/false)
  "user.enablePath": true,

  // 是否开启根路径 (baseurl)
  // 开启后连接URL即为根路径，不允许不同用户使用相同密码。
  // 环境变量: USER_ENABLE_ROOT (true/false)
  "user.enableRoot": false,

  // 最大快照数 (用于数据回滚)
  // 环境变量: MAX_SNAPSHOT_NUM
  "maxSnapshotNum": 10,

  // 添加歌曲到列表时的位置 (top: 顶部, bottom: 底部)
  // 环境变量: LIST_ADD_MUSIC_LOCATION_TYPE
  "list.addMusicLocationType": "top",

  // 前端管理控制台访问密码
  // 环境变量: FRONTEND_PASSWORD
  "frontend.password": "123456",

  // 用户列表
  // 环境变量: LX_USER_<用户名>=<密码> (例如: LX_USER_user1=123456)
  "users": [
    {
      "name": "admin",
      "password": "password"
    }
  ],

  // WebDAV 同步配置 (可选，用于数据备份)
  // 环境变量: WEBDAV_URL
  "webdav.url": "",

  // WebDAV 用户名
  // 环境变量: WEBDAV_USERNAME
  "webdav.username": "",

  // WebDAV 密码
  // 环境变量: WEBDAV_PASSWORD
  "webdav.password": " ",

  // 同步间隔 (分钟)
  // 环境变量: SYNC_INTERVAL
  "sync.interval": 60,

  // 是否启用 Web播放器 访问密码
  // 环境变量: ENABLE_WEBPLAYER_AUTH (true/false)
  "player.enableAuth": true,

  // Web播放器 访问密码
  // 环境变量: WEBPLAYER_PASSWORD
  "player.password": "123456",

  // 是否禁用数据收集
  // 环境变量: DISABLE_TELEMETRY (true/false)
  // 说明：仅收集版本号、运行环境（Docker/Node）、OS类型等非敏感信息用于项目改进。绝对匿名，不收集IP。
  "disableTelemetry": false
}