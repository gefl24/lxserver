# LX Music Sync Server (Enhanced Edition)

![lxserver](https://socialify.git.ci/XCQ0607/lxserver/image?description=1&forks=0&issues=0&logo=https://raw.githubusercontent.com/XCQ0607/lxserver/refs/heads/main/public/icon.svg&owner=1&pulls=0&stargazers=0&theme=Auto)

<div align="center">
  <p>
    <img src="https://img.shields.io/badge/build-passing-brightgreen?style=flat-square" alt="Build Status">
    <img src="https://img.shields.io/badge/version-v1.8.1-blue?style=flat-square" alt="Version">
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

[Documentation](https://xcq0607.github.io/lxserver/) | [SyncServer](md/lxserver_EN.md) | [Changelog](changelog.md) | [中文版](README.md)

---
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

### 3. Content & Playlists
  
Browse and search **multi-platform playlists** with ease. View comprehensive **playlist details** including covers, authors, and descriptions. Manage your **playback queue** with drag-and-drop sorting, batch operations, and quick positioning.

<p align="center">
  <img src="md/musiclist.png" width="800" alt="Playlist Browsing">
</p>

<p align="center">
  <img src="md/musiclist-detail.png" width="400" alt="Playlist Details">
  <img src="md/playlist.png" width="400" alt="Queue Management">
</p>

### 4. Powerful Playback Controls
Supports playback mode switching, sound quality selection, lyrics display, sleep timer, playback speed control, and more.

<p align="center">
  <img src="md/controller.png" width="800" alt="Controller">
</p>

### 5. Cache Management
  
Features a **fully automated caching system** for lyrics, links, and song files, managed via a dedicated **cache control panel** for smooth playback even in weak network conditions.

<p align="center">
  <img src="md/cache.png" width="800" alt="Automated Cache Management">
</p>

### 6. Lyric Card Sharing
  
Introducing **Lyric Card Sharing**—generate stunning posters with customizable aspect ratios (Portrait/Landscape/Square), color styles (Dark/Light/Album colors), and line counts, with support for rotation and scaling.

<p align="center">
  <img src="md/share.png" width="800" alt="Social Lyric Card Sharing">
</p>

### 7. Themes & System Configuration
  
Choose from multiple **modern themes** (Emerald, Deep Blue, Warm Sun, Nebula, Crimson) with automatic Light/Dark mode switching. Powerful system settings include **auto-updating network playlists**, **automatic config backups**, and multi-dimensional proxy support for seamless playback.

<p align="center">
  <img src="md/theme.png" width="400" alt="Modern Theme Switching">
  <img src="md/settings.png" width="400" alt="System Configuration">
</p>

### 8. Custom Source Management
Supports importing custom source scripts to expand music sources even further.
<p align="center">
  <img src="md/source.png" width="800" alt="Source Management">
</p>

## 🔒 Access Control & Security
To protect your privacy, the Web Player supports password protection.
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


### Option 1: Desktop Client

You can now run LX Music Sync Server more conveniently via our Desktop Client, available for Windows, macOS, and Linux.

- **📦 Download Latest**: [GitHub Releases](https://github.com/XCQ0607/lxserver/releases/latest)
- **✨ Key Advantages**:
    - **Single Window**: Integrated management dashboard and Web player for a unified experience.
    - **System Tray**: Minimizes to tray on close, ensuring the sync service stays active in the background.
    - **Port Conflict Resolution**: Automatically detects and switches ports if the default is in use.
    - **Setup Wizard**: Guided data path selection on first launch, supports **Portable Mode**.
    - **Multi-Arch Support**: Builds for Windows (x64/x86/ARM64 Setup & Portable), macOS (Intel x64 & Apple Silicon arm64), and Linux (amd64/arm64/armv7l deb/AppImage).

### Option 2: Containerized Deployment via Docker

```bash
docker run -d \
  -p 9527:9527 \
  -v $(pwd)/data:/server/data \
  -v $(pwd)/logs:/server/logs \
  --name lx-sync-server \
  --restart unless-stopped \
  ghcr.io/xcq0607/lxserver:latest
```

### Option 3: Manual Run (Git Clone)

```bash
# 1. Clone project
git clone https://github.com/XCQ0607/lxserver.git && cd lxserver

# 2. Install dependencies and build
npm ci && npm run build

# 3. Start service
npm start
```

### Option 4: Using Release Build

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
| `CONFIG_PATH` | - | Absolute path to external config file | - |
| `DATA_PATH` | - | Absolute path to data storage directory | `./data` |
| `LOG_PATH` | - | Absolute path to log output directory | `./logs` |
| `PROXY_HEADER` | `proxy.header` | Proxy IP header (e.g., `x-real-ip`) | - |
| `USER_ENABLE_ROOT` | `user.enableRoot` | Enable root path (use `ip:port`, password must be unique) | `false` |
| `USER_ENABLE_PATH` | `user.enablePath` | Enable user path (use `ip:port/username`, passwords can repeat) | `true` |
| `WEBDAV_URL` | `webdav.url` | WebDAV URL | - |
| `WEBDAV_USERNAME` | `webdav.username` | WebDAV Username | - |
| `WEBDAV_PASSWORD` | `webdav.password` | WebDAV Password | - |
| `SYNC_INTERVAL` | `sync.interval` | WebDAV auto-backup interval (min) | `60` |
| `ENABLE_WEBPLAYER_AUTH` | `player.enableAuth` | Enable Web Player password | `false` |
| `WEBPLAYER_PASSWORD` | `player.password` | Web Player password | `123456` |
| `DISABLE_TELEMETRY` | `disableTelemetry` | Disable anonymous telemetry and update notifications | `false` |
| `ENABLE_PUBLIC_USER_RESTRICTION` | `user.enablePublicRestriction` | Enable public user permission restriction (restrict upload/delete public sources) | `true` |
| `LIST_ADD_MUSIC_LOCATION_TYPE` | `list.addMusicLocationType` | Position when adding songs to list (`top` / `bottom`) | `top` |
| `LX_USER_<username>` | `users` array | Quickly add a user, value is the password (e.g., `LX_USER_test=123`) | - |

> **Note**: The service currently supports two types of sync connection URLs: `Root Path` (URL configuration is `ip:port`) and `User Path` (URL configuration is `ip:port/username`). If the User Path is disabled, all sync user passwords must be completely unique.

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
