# 基于原LX Music Sync Server (Enhanced Edition)项目
# 魔改版本增加本地歌曲管理功能




**Docker Run 示例：**

```bash
docker run -d \
  -p 9527:9527 \
  -v $(pwd)/data:/server/data \
  -v $(pwd)/logs:/server/logs \
  -v $(pwd)/cache:/server/cache \
  --name lx-sync-server \
  --restart unless-stopped \
  geelonn/lxserver:latest

```

**Docker Compose 示例：**

新建 `docker-compose.yml` 文件：

```yaml
services:
  lx-sync-server:
    image: geelonn/lxserver:latest
    container_name: lx-sync-server
    restart: unless-stopped
    ports:
      - "9527:9527"
    volumes:
      - ./data:/server/data
      - ./logs:/server/logs
      - ./cache:/server/cache
      - ./downloads:/server/downloads
      - ./music:/server/music
    environment:
      - NODE_ENV=production
      - ENABLE_LOCAL_DOWNLOAD=true   # 开启本地下载功能
      - DOWNLOAD_PATH=/server/downloads
      - MUSIC_PATH=/server/music
      - FRONTEND_PASSWORD=123456     # 管理后台密码
      # - ENABLE_WEBPLAYER_AUTH=true # 开启播放器访问认证
      # - WEBPLAYER_PASSWORD=yourpassword

```

## 🤝 贡献与致谢

- 修改自 [XCQ0607/lxserver](https://github.com/XCQ0607/lxserver)。
- Web 播放器逻辑参考 [lx-music-desktop](https://github.com/lyswhut/lx-music-desktop)。
- 接口实现基于 `musicsdk`。

## 📈 Star History

<a href="https://star-history.com/#gefl24/lxserver&Date">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/svg?repos=gefl24/lxserver&type=Date&theme=dark" />
    <source media="(prefers-color-scheme: light)" srcset="https://api.star-history.com/svg?repos=gefl24/lxserver&type=Date" />
    <img alt="Star History Chart" src="https://api.star-history.com/svg?repos=gefl24/lxserver&type=Date" />
  </picture>
</a>

## 📄 开源协议

Apache License 2.0 copyright (c) 2026 [xcq0607](https://github.com/xcq0607)
