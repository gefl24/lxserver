# LX Music Sync Server (Enhanced Edition)

![lxserver](https://socialify.git.ci/XCQ0607/lxserver/image?description=1&forks=0&issues=0&logo=https://raw.githubusercontent.com/XCQ0607/lxserver/refs/heads/main/public/icon.svg&owner=1&pulls=0&stargazers=0&theme=Auto)

<div align="center">
  <p>
    <img src="https://img.shields.io/badge/build-passing-brightgreen?style=flat-square" alt="Build Status">
    <img src="https://img.shields.io/badge/version-v1.5.3-blue?style=flat-square" alt="Version">
    <img src="https://img.shields.io/badge/node-%3E%3D16-green?style=flat-square" alt="Node Version">
    <img src="https://img.shields.io/github/license/XCQ0607/lxserver?style=flat-square" alt="License">
    <br>
    <br>
    <a href="https://github.com/XCQ0607/lxserver/stargazers"><img src="https://img.shields.io/github/stars/XCQ0607/lxserver?style=flat-square&color=ffe16b" alt="GitHub stars"></a>
    <a href="https://github.com/XCQ0607/lxserver/network/members"><img src="https://img.shields.io/github/forks/XCQ0607/lxserver?style=flat-square" alt="GitHub forks"></a>
    <a href="https://github.com/XCQ0607/lxserver/issues"><img src="https://img.shields.io/github/issues/XCQ0607/lxserver?style=flat-square&color=red" alt="GitHub issues"></a>
    <a href="https://github.com/XCQ0607/lxserver/commits/main"><img src="https://img.shields.io/github/last-commit/XCQ0607/lxserver?style=flat-square&color=blueviolet" alt="Last Commit"></a>
    <img src="https://img.shields.io/github/commit-activity/m/XCQ0607/lxserver?style=flat-square&color=ff69b4" alt="Commit Activity">
    <a href="https://github.com/XCQ0607/lxserver/releases"><img src="https://img.shields.io/github/downloads/XCQ0607/lxserver/total?style=flat-square&color=blue" alt="Total Downloads"></a>
  </p>
</div>

[SyncServer](md/lxserver_EN.md) | [Changelog](changelog.md) | [中文版](README.md)

This project features a powerful built-in **Web Player**, allowing you to enjoy music anywhere in your browser. It also serves as an enhanced [LX Music Data Sync Server](md/lxserver_EN.md).

## ✨ Web Player Key Features

### 1. Modern Interface
Featuring a clean, modern UI design with support for dark mode, providing a top-tier visual experience.
<p align="center">
  <img src="md/player.png" width="800" alt="Web Player Interface">
</p>

### 2. Multi-source Search
Supports aggregated searching across major music platforms, search and listen to anything you want.
<p align="center">
  <img src="md/search.png" width="800" alt="Search Interface">
</p>

### 3. Playlist Sync
Perfectly synced with LX Music clients, your favorite songs are instantly available on the Web side.
<p align="center">
  <img src="md/sync.png" width="400" alt="Sync">
  <img src="md/favorite.png" width="400" alt="Favorite List">
</p>

### 4. Powerful Playback Controls & Settings
Supports playback mode switching, sound quality selection, lyrics display, sleep timer, playback speed control, and more.
<p align="center">
  <img src="md/controller.png" width="600" alt="Controller">
</p>

<div align="center">
  <div style="display: flex; justify-content: center; gap: 20px; flex-wrap: wrap;">
    <div style="text-align: center;">
      <p><b>Custom Display</b></p>
      <img src="md/display.png" width="380" alt="display">
    </div>
    <div style="text-align: center;">
      <p><b>Sleep Timer</b></p>
      <img src="md/sleep.png" width="380" alt="sleep">
    </div>
  </div>
</div>

### 5. Custom Source Management
Supports importing custom source scripts to expand music sources even further.
<p align="center">
  <img src="md/source.png" width="800" alt="Source Management">
</p>

## 🔒 Access Control & Security
To protect your privacy, the Web Player supports password protection.
<p align="center">
  <img src="md/setting.png" width="800" alt="Auth Check">
</p>

### How to Enable

1. **Environment Variable** (Recommended for Docker users):
   - `ENABLE_WEBPLAYER_AUTH=true`: Enable authentication
   - `WEBPLAYER_PASSWORD=yourpassword`: Set access password
2. **Web Interface**:
   Log in to the management dashboard (default port 9527), go to **"System Config"**, check **"Enable Web Player Password"** and set your password.

## 📱 Mobile Adaptation
The Web Player is deeply optimized for mobile devices, providing a native App-like experience in mobile browsers.

---

## 🚀 Quick Start

Built with **Node.js**, supporting multiple deployment methods.

### Method 1: Using Docker (Recommended)

```bash
docker run -d \
  -p 9527:9527 \
  -v $(pwd)/data:/server/data \
  -v $(pwd)/logs:/server/logs \
  --name lx-sync-server \
  --restart unless-stopped \
  ghcr.io/xcq0607/lxserver:latest
```

### Method 2: Manual Run (Git Clone)

```bash
# 1. Clone project
git clone https://github.com/XCQ0607/lxserver.git && cd lxserver

# 2. Install dependencies and build
npm ci && npm run build

# 3. Start service
npm start
```

### Method 3: Using Release Build

1. Download the archive from GitHub Releases.
2. Extract and run `npm install --production`.
3. Execute `npm start`.

### 3. Access Info

- **Web Player**: `http://your-ip:9527/music`
- **Sync Dashboard**: `http://your-ip:9527` (Default password: `123456`)

---

## 🏗️ Architecture

Separated frontend and backend architecture based on Node.js:

- **Backend (Express + WebSocket)**: Core sync logic and WebDAV backup.
- **Console (Vanilla JS)**: Located in the root directory, handles user and data management.
- **WebPlayer (Vanilla JS)**: Located in the `/music` directory, handles music playback.

---

## 🛠️ Configuration

Edit `config.js` directly. Environment variables take precedence:

| Env Variable | Config Key | Description | Default |
| --- | --- | --- | --- |
| `PORT` | `port` | Service port | `9527` |
| `BIND_IP` | `bindIP` | Binding IP | `0.0.0.0` |
| `FRONTEND_PASSWORD` | `frontend.password` | Web dashboard password | `123456` |
| `SERVER_NAME` | `serverName` | Sync service name | `My Sync Server` |
| `MAX_SNAPSHOT_NUM` | `maxSnapshotNum` | Max snapshots to keep | `10` |
| `PROXY_HEADER` | `proxy.header` | Proxy IP header (e.g., `x-real-ip`) | - |
| `WEBDAV_URL` | `webdav.url` | WebDAV URL | - |
| `WEBDAV_USERNAME` | `webdav.username` | WebDAV Username | - |
| `WEBDAV_PASSWORD` | `webdav.password` | WebDAV Password | - |
| `SYNC_INTERVAL` | `sync.interval` | WebDAV auto-backup interval (min) | `60` |
| `ENABLE_WEBPLAYER_AUTH` | `player.enableAuth` | Enable Web Player password | `false` |
| `WEBPLAYER_PASSWORD` | `player.password` | Web Player password | `123456` |
| `DISABLE_TELEMETRY` | `disableTelemetry` | Disable anonymous telemetry and update notifications | `false` |

---

## 🛡️ Data Collection & Privacy

Anonymous telemetry via PostHog is used for:

1. **Bug Tracking**: Version number and environment type.
2. **Notifications**: **Update alerts** and **maintenance notices**.

- **Totally Anonymous**: No IP, username, or playlist content is collected.
- **How to Disable**: Set `DISABLE_TELEMETRY=true`. **Note: Disabling this prevents receiving update notifications.**

---

## 🤝 Credits & Acknowledgements

- Forked from [lyswhut/lx-music-sync-server](https://github.com/lyswhut/lx-music-sync-server).
- Web player logic inspired by [lx-music-desktop](https://github.com/lyswhut/lx-music-desktop).
- API based on `musicsdk`.

---

## 📄 License

Apache License 2.0 copyright (c) 2026 [xcq0607](https://github.com/xcq0607)
