/*
 * Copyright 2026 xcq0607 (https://github.com/xcq0607)
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

function checkForUpdates() {
    if (window.LxNotification && window.LxNotification.checkUpdates) {
        window.LxNotification.checkUpdates(true);
    } else {
        showinfo('通知服务未就绪，请稍后重试');
    }
}

const API_BASE = '/api/music';
let currentPage = 1;
let currentSearch = { name: '', source: 'kw' };
let currentPlaylist = [];
let currentIndex = -1;
window.viewingPlaylist = []; // [New] Currently displayed list in UI
let currentPlayingScope = 'network'; // [New] Scope for active playback
window.currentSearchScope = 'network'; // 'network', 'local_list', 'local_all' - Scope for UI view
let currentPlayingSong = null; // [Fix] Track currently playing song independently of view
const audio = document.getElementById('audio-player');
let currentPlaybackRate = 1.0;

// Settings & Batch Selection
let settings = {
    itemsPerPage: 20, // Default 20 items per page, can be 'all'
    preferredQuality: '320k', // 默认音质偏好
    enablePublicSources: true, // 是否显示公开源
    enableProxyPlayback: false, // 播放音乐代理
    enableProxyDownload: false, // 下载音乐代理
    enableAutoProxy: true, // 自动代理
    hotSearchLimit: 20, // 热搜显示数量
    lyricFontSize: 1.25, // 歌词字体大小 (rem)
    lyricFontFamily: '', // 词字体
    switchPlaylistOnSearchPlay: true, // 播放搜索歌曲时切换歌单 (默认开启)
    switchPlaylistOnSongListPlay: true, // 播放歌单歌曲时切换歌单 (默认开启)
    autoResume: true, // 自动恢复进度 (默认开启)
    showSidebarSongInfo: true, // 展示侧边栏封面
    enableCrossfade: true, // 音频淡入淡出
    keepScreenAwake: true, // 保持屏幕唤醒设置
    enableKeyboardShortcuts: true, // 按键快捷方式 (默认开启)
    showLyricTranslation: true, // 显示歌词翻译
    showLyricRoma: false, // 显示歌词罗马音
    swapLyricTransRoma: false, // 交换翻译与罗马音位置
    autoCompactPlaybar: true, // 自动精简控制栏 (默认开启)
    enableAutoSkipOnError: true, // 失败自动下一曲 (默认开启)
    // Visualizer Settings (Refactored)
    showFooterVisualizer: true,
    footerVisualizerStyle: 'bars',
    showDetailVisualizer: false,
    detailVisualizerStyle: 'pulse',
    visualizerOpacity: 0.5,
    visualizerGlobalStyle: 'blocks',
    // Cache Settings
    enableServerCache: true, // 开启服务器缓存
    serverCacheLocation: 'root', // 缓存位置: 'data' (synced) or 'root' (local)
    enableLyricCache: true,
    enableSongUrlCache: true,
    enableLyricGlow: true, // 歌词荧光效果 (默认开启)
    playerBackground: 'blur' // 播放页背景: 'blur', 'solid', 'dark'
};

// 歌词原始数据，用于设置切换时重新渲染
let currentRawLrc = '';
let currentRawTlrc = '';
let currentRawRlrc = '';
let currentRawKlrc = ''; // 逐词歌词 (klyric/lxlyric)

// 从 localStorage 加载设置
try {
    const saved = localStorage.getItem('lx_settings');
    if (saved) {
        settings = { ...settings, ...JSON.parse(saved) };
    }
} catch (e) {
    console.error('[Settings] 加载设置失败:', e);
}
window.settings = settings; // 显式挂载到 window

// Initial Sync for Server Cache Config
setTimeout(() => {
    if (settings.serverCacheLocation && window.updateServerCacheConfig) {
        console.log('[ServerCache] Syncing config:', settings.serverCacheLocation);
        window.updateServerCacheConfig(settings.serverCacheLocation);
    }
}, 2000);

window.batchMode = false;
window.selectedItems = new Set();
window.selectedSongObjects = new Map();
let expandBtnTimeout = null; // 展开按钮淡化计时器
let toggleLyricsBtnTimeout = null; // 歌词按钮淡化计时器

// ===== 认证相关代码 (服务端 Cookie Session) =====
let authEnabled = false;
// authToken 保留用于 API 请求头 x-user-token（与播放器登录认证不同）
let authToken = sessionStorage.getItem('lx_player_auth');

// 页面加载时：检查是否开启认证，若开启则显示登出按钮
(async () => {
    try {
        const response = await fetch('/api/music/config');
        const config = await response.json();
        authEnabled = config['player.enableAuth'] === true;
        // 若开启认证，显示登出按钮
        if (authEnabled) {
            const logoutBtn = document.getElementById('logout-btn');
            if (logoutBtn) {
                logoutBtn.classList.remove('hidden');
                logoutBtn.classList.add('flex');
            }
        }
    } catch (error) {
        console.error('[Auth] 初始化检查失败:', error);
    }
})();

// 登出：调用服务端清除 Session，跳转到登录页
async function handleLogout() {
    try {
        await fetch('/api/music/auth/logout', { method: 'POST' });
    } catch (e) {
        console.error('[Auth] 登出请求失败:', e);
    }
    window.location.replace('/music/login');
}
// ===== 认证代码结束 =====

// 音质选择器初始化
document.addEventListener('DOMContentLoaded', () => {
    // 音质选择器初始化
    const qualitySelect = document.getElementById('quality-select');
    if (qualitySelect && settings.preferredQuality) {
        qualitySelect.value = settings.preferredQuality;
    }

    // Initialize Proxy Settings UI
    const proxyPlayback = document.getElementById('toggle-proxy-playback');
    if (proxyPlayback) proxyPlayback.checked = settings.enableProxyPlayback;

    const proxyDownload = document.getElementById('toggle-proxy-download');
    if (proxyDownload) proxyDownload.checked = settings.enableProxyDownload;

    const autoProxy = document.getElementById('toggle-auto-proxy');
    if (autoProxy) autoProxy.checked = settings.enableAutoProxy;

    const hotSearchLimitInput = document.getElementById('hot-search-limit-input');
    if (hotSearchLimitInput) {
        hotSearchLimitInput.value = (settings.hotSearchLimit !== undefined && settings.hotSearchLimit !== null) ? settings.hotSearchLimit : 20;
    }

    // Initialize SongList Manager
    if (window.SongListManager) {
        window.SongListManager.init();
    }

    // Initialize Lyric Font Size UI
    const lyricFontSizeSlider = document.getElementById('lyric-font-size-slider');
    const lyricFontSizeValue = document.getElementById('lyric-font-size-value');
    if (lyricFontSizeSlider && lyricFontSizeValue) {
        const size = settings.lyricFontSize || 1.25;
        lyricFontSizeSlider.value = size;
        lyricFontSizeValue.innerText = size;
        document.documentElement.style.setProperty('--lyric-font-size', `${size}rem`);
    }

    // Initialize Lyric Font Family UI
    const lyricFontFamilySelect = document.getElementById('lyric-font-family-select');
    if (lyricFontFamilySelect) {
        const fontFamily = settings.lyricFontFamily || '';
        // Check if value exists in default options, if not create it (unless empty)
        if (fontFamily) {
            let exists = Array.from(lyricFontFamilySelect.options).some(opt => opt.value === fontFamily);
            if (!exists) {
                const option = document.createElement('option');
                option.value = fontFamily;
                option.textContent = fontFamily; // Fallback display name
                lyricFontFamilySelect.add(option, null);
            }
            lyricFontFamilySelect.value = fontFamily;
            document.documentElement.style.setProperty('--lyric-font-family', fontFamily);
        }
    }

    // Initialize Progress & Volume Dragging
    const progressContainer = document.getElementById('progress-container');
    if (progressContainer) {
        progressContainer.addEventListener('mousedown', (e) => startDragging(e, 'progress'));
        progressContainer.addEventListener('touchstart', (e) => startDragging(e, 'progress'), { passive: false });
    }

    const volumeContainer = document.getElementById('volume-container');
    if (volumeContainer) {
        volumeContainer.addEventListener('mousedown', (e) => startDragging(e, 'volume'));
        volumeContainer.addEventListener('touchstart', (e) => startDragging(e, 'volume'), { passive: false });
    }

    window.addEventListener('mousemove', handleDragMove);
    window.addEventListener('touchmove', handleDragMove, { passive: false });
    window.addEventListener('mouseup', stopDragging);
    window.addEventListener('touchend', stopDragging);

    // 同步所有设置 UI
    syncSettingsUI();
});

// Dragging Logic
let isDragging = null; // 'progress' or 'volume'
let dragPercentage = 0; // Temp value for progress smoothing
let lastSeekTime = 0; // Throttling for live seeking
let lastSeekPct = -1; // 上次执行 seek 时的进度百分比，用于避免原地抖动
const SEEK_THROTTLE_MS = 100; // How often to update audio position while dragging (ms)

function startDragging(e, type) {
    if (e.type === 'touchstart') e.preventDefault(); // Prevent scrolling while seeking
    isDragging = type;
    if (type === 'progress') lastSeekPct = -1; // 重置
    handleDragMove(e);
}

function stopDragging() {
    if (isDragging === 'progress' && Number.isFinite(dragPercentage)) {
        // 只有当最终位置与上次 seek 的位置差异较大时，才执行最后一次 seek
        if (Math.abs(dragPercentage - lastSeekPct) > 0.001) {
            audio.currentTime = dragPercentage * audio.duration;
            if (typeof lyricPlayer !== 'undefined' && lyricPlayer) {
                lyricPlayer.play(audio.currentTime * 1000);
            }
        }
    }
    isDragging = null;
    lastSeekPct = -1;
}

function handleDragMove(e) {
    if (!isDragging) return;

    if (e.type === 'touchmove') e.preventDefault(); // Prevent scrolling

    const clientX = e.type.startsWith('touch') ? e.touches[0].clientX : e.clientX;

    if (isDragging === 'progress') {
        const container = document.getElementById('progress-container');
        if (!container || !audio.duration || !Number.isFinite(audio.duration)) return;
        const rect = container.getBoundingClientRect();
        const x = clientX - rect.left;
        const pct = Math.max(0, Math.min(1, x / rect.width));

        dragPercentage = pct;

        // 1. Update UI immediately (Always smooth)
        document.getElementById('progress-bar').style.width = `${pct * 100}%`;
        document.getElementById('time-current').innerText = formatTime(pct * audio.duration);

        // 2. Throttled update of audio position (Live Seeking)
        const now = Date.now();
        if (now - lastSeekTime > SEEK_THROTTLE_MS) {
            // 只有当进度百分比发生较明显变化（大于 0.1%）时才执行 seek
            // 这可以防止鼠标微小抖动导致的“原地复读”感，并允许停下时正常播放（预览）
            if (Math.abs(pct - lastSeekPct) > 0.001) {
                audio.currentTime = pct * audio.duration;

                // 同步更新歌词进度
                if (typeof lyricPlayer !== 'undefined' && lyricPlayer) {
                    lyricPlayer.play(audio.currentTime * 1000);
                    // 强制歌词对齐但不等待平滑滚动，保持灵敏度
                    scrollToActiveLine(true);
                }

                lastSeekTime = now;
                lastSeekPct = pct;
            }
        }
    } else if (isDragging === 'volume') {
        const container = document.getElementById('volume-container');
        if (!container) return;
        const rect = container.getBoundingClientRect();
        const x = clientX - rect.left;
        const pct = Math.max(0, Math.min(1, x / rect.width));
        currentVolume = pct;
        audio.volume = pct;
        isMuted = false;
        updateVolumeUI();
        // Debounce saving if needed, but simple localstorage here
        localStorage.setItem('lx_volume', currentVolume.toString());
    }
}

// 切换代理设置
function changeProxyPlayback(enabled) {
    settings.enableProxyPlayback = enabled;
    localStorage.setItem('lx_settings', JSON.stringify(settings));
    console.log(`[Settings] Proxy Playback: ${enabled}`);
}

function changeProxyDownload(enabled) {
    settings.enableProxyDownload = enabled;
    localStorage.setItem('lx_settings', JSON.stringify(settings));
    console.log(`[Settings] Proxy Download: ${enabled}`);
}

function changeAutoProxy(enabled) {
    settings.enableAutoProxy = enabled;
    localStorage.setItem('lx_settings', JSON.stringify(settings));
    console.log(`[Settings] Auto Proxy: ${enabled}`);
}

function changeHotSearchLimit(value) {
    const limit = parseInt(value);
    // [Fix] Allow 0, Check Range 0-50
    if (!isNaN(limit) && limit >= 0 && limit <= 50) {
        settings.hotSearchLimit = limit;
        localStorage.setItem('lx_settings', JSON.stringify(settings));
        console.log(`[Settings] Hot Search Limit: ${limit}`);

        // If currently on search tab and showing hot search, refresh
        // Check if search-results-header is hidden (means we are in hot search mode or initial state)
        if (document.getElementById('search-results-header')?.classList.contains('hidden')) {
            showInitialSearchState(); // Refreshes the view
        }
    } else {
        showError('请输入 0 到 50 之间的数字');
        // Reset input
        const input = document.getElementById('hot-search-limit-input');
        if (input) input.value = settings.hotSearchLimit || 20;
    }
}

function changeLyricFontSize(value) {
    const size = parseFloat(value);
    if (!isNaN(size)) {
        settings.lyricFontSize = size;
        localStorage.setItem('lx_settings', JSON.stringify(settings));

        // Apply style
        document.documentElement.style.setProperty('--lyric-font-size', `${size}rem`);

        // Update UI value display
        const valueEl = document.getElementById('lyric-font-size-value');
        if (valueEl) valueEl.innerText = size;

        console.log(`[Settings] Lyric Font Size: ${size}rem`);
    }
}

// 读取本地字体
/**
 * 通用加载本地字体逻辑
 * @param {string} targetSelectId - 目标下拉框的 ID，默认为设置页的 'lyric-font-family-select'
 * @param {HTMLElement} btnEl - 触发按钮的引用，用于显示加载动画
 */
async function loadLocalFonts(targetSelectId = 'lyric-font-family-select', btnEl = null) {
    if (!('queryLocalFonts' in window)) {
        showError('抱歉，您的浏览器不支持读取本地字体功能 (Local Font Access API)。\n建议使用 Chrome / Edge 浏览器，并确保在 HTTPS 环境下使用。');
        return;
    }

    const btn = btnEl || document.querySelector('button[onclick="loadLocalFonts()"]');
    const originalText = btn ? btn.innerHTML : '';

    try {
        if (btn) {
            btn.disabled = true;
            btn.innerHTML = '<i class="fas fa-spinner fa-spin mr-1"></i>读取中...';
        }

        const fonts = await window.queryLocalFonts();
        const fontSelect = document.getElementById(targetSelectId);
        if (!fontSelect) return;

        // Use a set to store unique families
        const fontFamilies = new Set();
        fonts.forEach(font => fontFamilies.add(font.family));

        // Sort alphabetically
        const sortedFamilies = Array.from(fontFamilies).sort();

        if (sortedFamilies.length === 0) {
            showError('未能获取到字体列表');
            return;
        }

        // Remove existing local fonts group if exists
        const oldGroup = fontSelect.querySelector('optgroup[data-source="local"]');
        if (oldGroup) {
            oldGroup.remove();
        }

        // Create a single group for local fonts
        const group = document.createElement('optgroup');
        group.dataset.source = 'local';
        group.label = `本地已安装字体 (${sortedFamilies.length})`;

        sortedFamilies.forEach(family => {
            const option = document.createElement('option');
            // 如果是歌词卡片，保持带引号格式；如果是设置页，保持原样（lyric-card.js 会处理字体族名称）
            option.value = targetSelectId === 'lc-font-select' ? `"${family}", sans-serif` : family;
            option.textContent = family;
            group.appendChild(option);
        });
        fontSelect.appendChild(group);

        showSuccess(`成功获取 ${sortedFamilies.length} 个本地字体！`);

    } catch (err) {
        console.error('[Font] Error loading fonts:', err);
        showError('获取字体失败: ' + err.message);
    } finally {
        if (btn) {
            btn.disabled = false;
            btn.innerHTML = originalText;
        }
    }
}

function changeLyricFontFamily(value) {
    settings.lyricFontFamily = value.trim();
    localStorage.setItem('lx_settings', JSON.stringify(settings));

    // Apply style
    document.documentElement.style.setProperty('--lyric-font-family', settings.lyricFontFamily || 'inherit');
    console.log(`[Settings] Lyric Font Family: ${settings.lyricFontFamily}`);
}

// 切换音质偏好
function changeQualityPreference(quality) {
    settings.preferredQuality = quality;
    try {
        localStorage.setItem('lx_settings', JSON.stringify(settings));
        console.log(`[Settings] 音质偏好已更改为: ${quality}`);

        // 显示提示
        const toast = document.createElement('div');
        toast.className = 'fixed bottom-24 right-4 bg-emerald-500 text-white px-4 py-2 rounded-lg shadow-lg z-50';
        toast.textContent = `默认音质已设置为: ${window.QualityManager.getQualityDisplayName(quality)}`;
        document.body.appendChild(toast);
        setTimeout(() => {
            toast.classList.add('opacity-0', 'transition-opacity');
            setTimeout(() => toast.remove(), 300);
        }, 2000);
    } catch (e) {
        console.error('[Settings] 保存设置失败:', e);
    }
}


// Tab Switching
function switchTab(tabId) {
    document.querySelectorAll('[id^="view-"]').forEach(el => {
        el.classList.add('hidden');
        el.classList.remove('opacity-100');
        el.classList.add('opacity-0');
    });
    // special handling for favorites
    if (tabId === 'favorites' && currentListData) {
        handleFavoritesClick();
        return;
    }

    const activeView = document.getElementById(`view-${tabId}`);
    if (!activeView) return;

    activeView.classList.remove('hidden');
    // small delay to allow display block to apply before opacity transition
    setTimeout(() => {
        activeView.classList.remove('opacity-0');
        activeView.classList.add('opacity-100');
    }, 10);

    // Reset Sidebar Highlight
    document.querySelectorAll('[id^="tab-"]').forEach(el => {
        el.classList.remove('active-tab', 'text-emerald-600');
        el.classList.add('t-text-muted');
    });
    const activeTab = document.getElementById(`tab-${tabId}`);
    if (activeTab) {
        activeTab.classList.add('active-tab');
        activeTab.classList.remove('t-text-muted');
    }

    // Mobile: Close sidebar when switching tabs except for favorites (which should show sub-lists)
    if (window.innerWidth < 768 && tabId !== 'favorites') {
        const sidebar = document.getElementById('main-sidebar');
        if (sidebar && !sidebar.classList.contains('-translate-x-full')) {
            toggleSidebar();
        }
    }

    // Always clear sub-item highlight when switching top-level tabs
    document.querySelectorAll('[data-sidebar-list-id]').forEach(el => {
        el.classList.remove('active-sub-item');
        el.classList.add('t-text-muted');
    });

    // Reset Search Scope if switching to search/settings explicitly
    if (tabId === 'search') {
        currentSearchScope = 'network';
        document.getElementById('search-source').classList.remove('hidden');
        document.getElementById('search-input').placeholder = "搜索歌曲、歌手...";
        document.getElementById('page-title').innerText = "搜索音乐";
    }

    if (tabId === 'songlist') {
        document.getElementById('page-title').innerText = "歌单";
    }

    // Collapse Favorites if leaving
    if (tabId !== 'favorites') {
        const favList = document.getElementById('favorites-children');
        const arrow = document.getElementById('favorites-arrow');
        if (favList && favList.style.height !== '0px') {
            favList.style.height = '0px';
            if (arrow) arrow.style.transform = 'rotate(-90deg)';
        }
    }

    // Title update (handled above for search, others here)
    if (tabId === 'settings') {
        document.getElementById('page-title').innerText = '设置';
        // 确保设置界面的自定义源列表是最新的
        if (typeof loadCustomSources === 'function') {
            loadCustomSources();
        }
    }

    if (tabId === 'about') {
        document.getElementById('page-title').innerText = '关于';
        loadAboutContent();
    }

    // Auto-exit batch mode when switching tabs
    if (window.batchMode && typeof toggleBatchMode === 'function') {
        toggleBatchMode();
    }
}

// Load About Content
async function loadAboutContent() {
    const aboutContainer = document.getElementById('about-content');
    if (!aboutContainer) return;

    try {
        const response = await fetch('/music/about.md');
        if (!response.ok) throw new Error('Failed to load about.md');
        const text = await response.text();

        // Render Markdown
        if (window.marked) {
            // Replace {{version}} and {{buildHash}} placeholder
            const version = (window.CONFIG && window.CONFIG.version) || 'v1.0.0';
            const buildHash = (window.CONFIG && window.CONFIG.buildHash) || 'unknown';
            let content = text.replace(/{{version}}/g, version);
            content = content.replace(/{{buildHash}}/g, buildHash);
            aboutContainer.innerHTML = window.marked.parse(content);
        } else {
            aboutContainer.innerText = text; // Fallback
        }
        aboutContainer.classList.remove('animate-pulse');
    } catch (e) {
        console.error('Failed to load about content:', e);
        aboutContainer.innerHTML = '<p class="text-red-500">加载关于页面失败，请稍后重试。</p>';
    }
}

// Set Version on Load
document.addEventListener('DOMContentLoaded', () => {
    if (window.CONFIG && window.CONFIG.version) {
        const versionEl = document.getElementById('app-version');
        if (versionEl) {
            versionEl.innerText = window.CONFIG.version + ' Web';
        }
    }

    // 为展开按钮添加悬放恢复逻辑
    const expandBtn = document.getElementById('btn-expand-panel');
    if (expandBtn) {
        expandBtn.addEventListener('mouseenter', () => {
            if (expandBtnTimeout) clearTimeout(expandBtnTimeout);
            expandBtn.classList.remove('faint');
        });
        expandBtn.addEventListener('mouseleave', () => {
            const footer = document.getElementById('player-footer');
            if (footer && footer.classList.contains('translate-y-[110%]')) {
                startExpandBtnTimer();
            }
        });
    }

    // 为歌词按钮添加悬停恢复逻辑
    const toggleLyricsBtn = document.getElementById('btn-toggle-lyrics');
    if (toggleLyricsBtn) {
        toggleLyricsBtn.addEventListener('mouseenter', () => {
            if (toggleLyricsBtnTimeout) clearTimeout(toggleLyricsBtnTimeout);
            toggleLyricsBtn.classList.remove('faint');
        });
        toggleLyricsBtn.addEventListener('mouseleave', () => {
            const view = document.getElementById('view-player-detail');
            if (view && !view.classList.contains('translate-y-[100%]')) {
                startToggleLyricsBtnTimer();
            }
        });
    }
});

// ==================== 播放队列 (Queue) 逻辑 ====================
let isQueueRendered = false;

function toggleQueueDrawer() {
    const drawer = document.getElementById('queue-drawer');
    if (!drawer) return;

    const isHidden = drawer.classList.contains('translate-x-full');
    if (isHidden) {
        renderQueue();
        drawer.classList.remove('translate-x-full');
        // Hide sidebar if open on mobile
        if (window.innerWidth < 768) {
            const sidebar = document.getElementById('main-sidebar');
            if (sidebar && !sidebar.classList.contains('-translate-x-full')) {
                toggleSidebar();
            }
        }
    } else {
        drawer.classList.add('translate-x-full');
    }
}
window.toggleQueueDrawer = toggleQueueDrawer;

function renderQueue() {
    const listContainer = document.getElementById('queue-list');
    const countEl = document.getElementById('queue-count');
    if (!listContainer) return;

    if (!currentPlaylist || currentPlaylist.length === 0) {
        listContainer.innerHTML = `
            <div class="flex flex-col items-center justify-center py-20 opacity-30 select-none">
                <i class="fas fa-music text-4xl mb-4"></i>
                <p class="text-xs font-bold uppercase tracking-widest">队列为空</p>
            </div>
        `;
        if (countEl) countEl.innerText = '0 SONGS';
        return;
    }

    if (countEl) countEl.innerText = `${currentPlaylist.length} SONGS`;

    listContainer.innerHTML = currentPlaylist.map((song, index) => {
        const isActive = index === currentIndex;
        return `
            <div class="group flex items-center gap-3 p-3 rounded-xl transition-all hover:t-bg-item-hover cursor-pointer relative ${isActive ? 't-bg-item-hover border-l-4 border-emerald-500 pl-2' : ''}"
                 onclick="playSongFromQueue(${index})">
                
                <div class="w-10 h-10 rounded-lg overflow-hidden flex-shrink-0 relative">
                    <img src="${getImgUrl(song)}" onerror="this.src='/music/assets/logo.svg'" class="w-full h-full object-cover">
                    ${isActive ? '<div class="absolute inset-0 bg-emerald-500/20 flex items-center justify-center"><div class="w-1.5 h-1.5 bg-emerald-500 rounded-full animate-ping"></div></div>' : ''}
                </div>
                
                <div class="flex-1 min-w-0">
                    <div class="text-sm font-bold truncate ${isActive ? 'text-emerald-500' : 't-text-main'}">${song.name}</div>
                    <div class="text-[10px] t-text-muted truncate mt-0.5">${song.singer}</div>
                </div>

                <div class="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button onclick="event.stopPropagation(); removeFromQueue(${index})" class="p-2 text-gray-400 hover:text-red-500 transition-colors">
                        <i class="fas fa-trash-alt text-xs"></i>
                    </button>
                    <div class="p-2 text-gray-400 cursor-grab active:cursor-grabbing queue-drag-handle">
                        <i class="fas fa-grip-lines text-xs"></i>
                    </div>
                </div>
            </div>
        `;
    }).join('');

    // Initialize/Update Sortable (Supports Mobile Touch)
    if (typeof Sortable !== 'undefined' && listContainer) {
        try {
            const oldSortable = Sortable.get(listContainer);
            if (oldSortable) oldSortable.destroy();
        } catch (e) { }

        Sortable.create(listContainer, {
            animation: 200,
            handle: '.queue-drag-handle',
            ghostClass: 'sortable-ghost-solid',
            chosenClass: 'sortable-chosen-item',
            dragClass: 'sortable-drag-item',
            forceFallback: true,
            fallbackOnBody: true,
            delay: 100,
            delayOnTouchOnly: true,
            touchStartThreshold: 3,
            onStart: () => {
                document.body.classList.add('select-none');
            },
            onEnd: (evt) => {
                document.body.classList.remove('select-none');
                const oldIndex = evt.oldIndex;
                const newIndex = evt.newIndex;
                if (oldIndex === newIndex) return;

                // Reorder currentPlaylist
                const movedItem = currentPlaylist.splice(oldIndex, 1)[0];
                currentPlaylist.splice(newIndex, 0, movedItem);

                // Update currentIndex if it was affected
                if (currentIndex === oldIndex) {
                    currentIndex = newIndex;
                } else if (oldIndex < currentIndex && newIndex >= currentIndex) {
                    currentIndex--;
                } else if (oldIndex > currentIndex && newIndex <= currentIndex) {
                    currentIndex++;
                }

                renderQueue();
                savePlaybackState();
                showInfo('播放顺序已更新');
            }
        });
    }

    // Update status to show hint if more than 1 item
    const tip = document.getElementById('queue-tip');
    if (tip) {
        if (currentPlaylist.length > 1) tip.classList.remove('hidden');
        else tip.classList.add('hidden');
    }
}

function playSongFromQueue(index) {
    if (!currentPlaylist[index]) return;
    playSong(currentPlaylist[index], index);
}
window.playSongFromQueue = playSongFromQueue;

function removeFromQueue(index) {
    if (!currentPlaylist || index < 0 || index >= currentPlaylist.length) return;

    const removedId = currentPlaylist[index].id;
    currentPlaylist.splice(index, 1);

    // If we removed the currently playing song's index, we need to adjust currentIndex
    if (index === currentIndex) {
        // [Optional] Auto-play next or just stop? Here we just adjust index for next song
        // Typically people expect it to stay at same index but if it was last, wrap around
        if (currentPlaylist.length === 0) {
            currentIndex = -1;
            try { audio.pause(); } catch (e) { }
        } else if (currentIndex >= currentPlaylist.length) {
            currentIndex = 0; // Wrap to start
        }
        // [Think] Should we auto-play next? Usually delete means "remove but keep playing current"
        // But if user clicks delete on current, maybe skip to next.
        // For now, let's keep playing but adjust index.
    } else if (index < currentIndex) {
        currentIndex--;
    }

    renderQueue();
    savePlaybackState(); // Save state after removal
    showSuccess('已从队列移除');
}
window.removeFromQueue = removeFromQueue;

async function clearQueue() {
    if (!currentPlaylist || currentPlaylist.length === 0) return;
    if (await showSelect('清空队列', '确定要清空当前播放队列吗？', { danger: true })) {
        currentPlaylist = [];
        currentIndex = -1;
        try { audio.pause(); } catch (e) { }
        renderQueue();
        savePlaybackState(); // Save empty state
        showInfo('队列已清空');
    }
}
window.clearQueue = clearQueue;

// --- Native Drag & Drop Handlers (Removed, replaced by SortableJS) ---
// ===============================================

// Search Logic
function handleSearchKeyPress(e) {
    if (e.key === 'Enter') doSearch();
}

const SOURCES = ['kw', 'kg', 'tx', 'wy', 'mg'];

//搜索歌曲
async function doSearch(page = 1, append = false) {
    const input = document.getElementById('search-input').value.trim();
    const resultsContainer = document.getElementById('search-results');

    // Local Search Logic
    if (currentSearchScope === 'local_list' || currentSearchScope === 'local_all') {
        if (!input) {
            renderResults(viewingPlaylist);
            return;
        }

        let targets = [];
        if (currentSearchScope === 'local_list') {
            // 从当前正在查看的列表中搜索，而不是播放列表
            const listId = window.currentViewingListId || 'default';
            if (currentListData) {
                if (listId === 'default') targets = currentListData.defaultList;
                else if (listId === 'love') targets = currentListData.loveList;
                else {
                    const uList = currentListData.userList.find(l => l.id === listId);
                    if (uList) targets = uList.list;
                }
            }
        } else {
            // Aggregate all local
            if (currentListData) {
                targets = [
                    ...(currentListData.defaultList || []),
                    ...(currentListData.loveList || []),
                    ...(currentListData.userList || []).flatMap(l => l.list)
                ];
            }
        }

        const lower = input.toLowerCase();
        const filtered = targets.filter(item =>
            (item.name && item.name.toLowerCase().includes(lower)) ||
            (item.singer && item.singer.toLowerCase().includes(lower))
        );
        renderResults(filtered);
        return;
    }

    // Network Search Logic
    const source = document.getElementById('search-source').value;
    if (!input) {
        showInitialSearchState();
        return;
    }

    if (!append) {
        currentSearch = { name: input, source };
        currentPage = 1;
        window.currentNetworkPage = page;
        resultsContainer.innerHTML = '<div class="flex items-center justify-center h-full"><i class="fas fa-spinner fa-spin text-4xl text-emerald-500"></i></div>';
    } else {
        window.currentNetworkPage = page;
    }

    try {
        const headers = {};
        if (typeof authToken !== 'undefined' && authToken) headers['x-user-token'] = authToken;
        if (typeof currentListData !== 'undefined' && currentListData && currentListData.username) headers['x-user-name'] = currentListData.username;

        let list = [];
        if (source === 'all') {
            // Aggregate Search
            const pageInfoEl = document.getElementById('page-info');
            if (pageInfoEl) pageInfoEl.innerText = `聚合搜索 (前20条/源)`;

            const promises = SOURCES.map(s =>
                fetch(`${API_BASE}/search?name=${encodeURIComponent(input)}&source=${s}&page=1`, { headers })
                    .then(res => res.json())
                    .then(data => data.map(item => ({ ...item, source: s })))
                    .catch(e => {
                        console.warn(`[聚合搜索] ${s} 源失败:`, e);
                        return [];
                    })
            );
            const results = await Promise.all(promises);
            list = results.flat();
        } else {
            // Single Source Search - 使用老版本简单逻辑
            const res = await fetch(`${API_BASE}/search?name=${encodeURIComponent(input)}&source=${source}&page=${page}`, { headers });

            if (!res.ok) {
                throw new Error(`搜索请求失败: ${res.status} ${res.statusText}`);
            }

            const data = await res.json();

            // 检查返回的数据是否为数组
            if (!Array.isArray(data)) {
                console.error('[Search] 后端返回非数组数据:', data);
                throw new Error(data.error || data.message || '搜索返回的数据格式错误');
            }

            list = data.map(item => ({ ...item, source }));

            const pageInfoEl = document.getElementById('page-info');
            if (pageInfoEl && !append) pageInfoEl.innerText = `第 ${page} 页`;
        }

        if (append) {
            // [Fix] Ensure each new song has unique ID
            if (list && list.length > 0) {
                list.forEach((item, idx) => {
                    if (!item.id || item.id === 'undefined') {
                        item.id = item.songmid || item.songId || item.hash || item.copyrightId || item.mid || item.mediaMid || `temp_${Date.now()}_${idx}_append`;
                    }
                });
            }
            const existingIds = new Set((window.viewingPlaylist || []).map(item => String(item.id)));
            const newItems = list.filter(item => !existingIds.has(String(item.id)));

            if (newItems.length > 0) {
                const combinedList = [...(window.viewingPlaylist || []), ...newItems];
                currentPage++;
                renderResults(combinedList);
            } else {
                try {
                    showError('没有更多搜索结果了');
                } catch (err) {
                    showInfo('没有更多搜索结果了');
                }
            }
        } else {
            renderResults(list);
        }
    } catch (e) {
        console.error('[Search] 搜索失败:', e);
        if (append) {
            try {
                showError(`搜索追加出错: ${e.message}`);
            } catch (err) {
                showError(`搜索追加出错: ${e.message}`);
            }
        } else {
            resultsContainer.innerHTML = `<div class="text-center text-red-500 p-8">搜索出错: ${e.message}</div>`;
        }
    }
}

function changePage(delta) {
    const source = document.getElementById('search-source').value;
    if (source === 'all') {
        showInfo('聚合搜索模式暂不支持翻页');
        return;
    }
    const newPage = currentPage + delta;
    if (newPage < 1) return;
    doSearch(newPage);
}

// ========== 热搜功能 ==========
let hotSearchCache = null;
let hotSearchCacheTime = 0;
const HOT_SEARCH_CACHE_DURATION = 5 * 60 * 1000; // 5分钟缓存

async function fetchHotSearch(source = 'mg') {
    // 检查缓存（必须匹配 source）
    if (hotSearchCache &&
        hotSearchCache.source === source && // Add checking source
        Date.now() - hotSearchCacheTime < HOT_SEARCH_CACHE_DURATION) {
        return hotSearchCache;
    }

    try {
        const res = await fetch(`${API_BASE}/hotSearch?source=${source}`);
        if (!res.ok) {
            throw new Error(`获取热搜失败: ${res.status}`);
        }
        const data = await res.json();

        // 更新缓存
        hotSearchCache = data;
        // Ensure data also carries the source info if not present
        if (!hotSearchCache.source) hotSearchCache.source = source;

        hotSearchCacheTime = Date.now();

        return data;
    } catch (e) {
        console.error('[HotSearch] 获取热搜失败:', e);
        return null;
    }
}

function renderHotSearch(data) {
    const container = document.getElementById('search-results');
    const header = document.getElementById('search-results-header');

    // 隐藏表头
    if (header) {
        header.classList.add('hidden');
    }

    // [Fix] If limit is 0, treat as disabled and show default state
    if (!container || !data || !data.list || data.list.length === 0 || settings.hotSearchLimit === 0) {
        // 显示默认空白状态
        container.innerHTML = `
            <div class="flex flex-col items-center justify-center h-full t-text-muted space-y-4">
                <i class="fas fa-music text-6xl opacity-20"></i>
                <p>输入关键词开始搜索音乐</p>
            </div>
        `;
        return;
    }

    const sourceTag = getSourceTag(data.source);
    // [Fix] Correctly handle 0, do not fall back to 20 if 0 is set
    const limit = (settings.hotSearchLimit !== undefined && settings.hotSearchLimit !== null) ? settings.hotSearchLimit : 20;
    const keywords = data.list.slice(0, limit); // 使用设置的数量

    container.innerHTML = `
        <div class="hot-search-container p-8">
            <div class="flex items-center mb-6">
                <i class="fas fa-fire text-orange-500 text-2xl mr-3"></i>
                <h3 class="text-xl font-bold t-text-main">热门搜索</h3>
                <span class="ml-3">${sourceTag}</span>
            </div>
            <div class="hot-search-list grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
                ${keywords.map((keyword, index) => `
                    <button onclick="handleHotSearchClick('${keyword.replace(/'/g, "\\'")}')" 
                            class="hot-search-item group flex items-center p-3 t-bg-panel hover:bg-emerald-50 border t-border-main hover:border-emerald-400 rounded-lg transition-all shadow-sm hover:shadow-md overflow-hidden h-14">
                        <span class="rank flex-shrink-0 w-6 h-6 flex items-center justify-center rounded-full text-xs font-bold mr-3 ${index < 3 ? 'bg-gradient-to-r from-orange-400 to-red-500 text-white' : 'bg-gray-100 text-gray-500'
        }">
                            ${index + 1}
                        </span>
                        <span class="keyword flex-1 text-left text-sm font-medium t-text-main group-hover:text-emerald-600 truncate">
                            ${keyword}
                        </span>
                        <i class="fas fa-search text-xs text-gray-300 group-hover:text-emerald-500 transition-colors ml-2"></i>
                    </button>
                `).join('')}
            </div>
            <div class="mt-6 text-center">
                <button onclick="showInitialSearchState()" 
                        class="text-sm t-text-muted hover:text-emerald-500 transition-colors">
                    <i class="fas fa-sync-alt mr-1"></i>
                    刷新热搜
                </button>
            </div>
        </div>
    `;

    // 动态检测溢出并应用滚动效果
    setTimeout(() => {
        const items = container.querySelectorAll('.hot-search-item .keyword');
        items.forEach(el => {
            if (el.scrollWidth > el.clientWidth) {
                const text = el.textContent.trim();
                el.classList.remove('truncate');
                // 使用 mask-image 实现渐变列表
                el.innerHTML = `
                    <div class="w-full overflow-hidden relative" style="mask-image: linear-gradient(to right, transparent 0%, black 5%, black 95%, transparent 100%); -webkit-mask-image: linear-gradient(to right, transparent 0%, black 5%, black 95%, transparent 100%);">
                        <div class="inline-block whitespace-nowrap animate-marquee hover-scroll-paused" style="will-change: transform;">
                             <span>${text}</span>
                             <span class="mx-8"></span>
                             <span>${text}</span>
                             <span class="mx-8"></span>
                        </div>
                    </div>
                `;
            }
        });
    }, 0);
}

function handleHotSearchClick(keyword) {
    const searchInput = document.getElementById('search-input');
    if (searchInput) {
        searchInput.value = keyword;
        doSearch();
    }
}

function showInitialSearchState() {
    const container = document.getElementById('search-results');
    const header = document.getElementById('search-results-header');

    // 隐藏表头
    if (header) {
        header.classList.add('hidden');
    }

    // 显示加载状态
    container.innerHTML = `
        <div class="flex flex-col items-center justify-center h-full t-text-muted space-y-4">
            <i class="fas fa-spinner fa-spin text-4xl text-emerald-500"></i>
            <p>正在加载热门搜索...</p>
        </div>
    `;

    // 异步获取并显示热搜
    const sourceSelect = document.getElementById('search-source');
    const source = sourceSelect ? sourceSelect.value : 'wy';

    fetchHotSearch(source).then(data => {
        renderHotSearch(data);
    }).catch(err => {
        console.error('[HotSearch] 显示热搜失败:', err);
        // 失败时显示默认状态
        container.innerHTML = `
            <div class="flex flex-col items-center justify-center h-full t-text-muted space-y-4">
                <i class="fas fa-music text-6xl opacity-20"></i>
                <p>输入关键词开始搜索音乐</p>
            </div>
        `;
    });
}


function getQualityTags(item) {
    const tags = [];
    // 兼容多种音质字段位置:
    // 1. types / _types (旧版/部分源)
    // 2. qualitys / _qualitys (新版/标准)
    // 3. meta.qualitys (收藏列表)
    const rawTypes = item.types || item._types ||
        item.qualitys || item._qualitys ||
        (item.meta && (item.meta.qualitys || item.meta._qualitys)) ||
        {};

    // Normalize types check
    let has320 = false;
    let hasFlac = false;
    let hasHiRes = false;

    if (Array.isArray(rawTypes)) {
        // 数组格式: [{type: '320k', ...}, {type: 'flac', ...}]
        has320 = rawTypes.some(t => t.type === '320k');
        hasFlac = rawTypes.some(t => t.type === 'flac');
        hasHiRes = rawTypes.some(t => t.type === 'flac24bit');
    } else {
        // 对象格式: { '320k': {size: ...}, 'flac': ... }
        has320 = !!rawTypes['320k'];
        hasFlac = !!rawTypes['flac'];
        hasHiRes = !!rawTypes['flac24bit'];
    }

    if (hasHiRes) tags.push('<span class="px-1 py-0.5 rounded text-[10px] t-badge-yellow border border-yellow-200 dark:border-yellow-500/30 ml-1 transition-colors">HR</span>');
    else if (hasFlac) tags.push('<span class="px-1 py-0.5 rounded text-[10px] t-badge-green border border-emerald-200 dark:border-emerald-500/30 ml-1 transition-colors">SQ</span>');
    else if (has320) tags.push('<span class="px-1 py-0.5 rounded text-[10px] t-badge-blue border border-blue-200 dark:border-blue-500/30 ml-1 transition-colors">HQ</span>');

    return tags.join('');
}

function getSourceTag(source) {
    const colors = {
        kw: 't-badge-yellow border-yellow-200 dark:border-yellow-500/30',
        kg: 't-badge-blue border-blue-200 dark:border-blue-500/30',
        tx: 't-badge-green border-green-200 dark:border-emerald-500/30',
        wy: 't-badge-red border-red-200 dark:border-red-500/30',
        mg: 't-badge-pink border-pink-200 dark:border-pink-500/30'
    };
    const names = { kw: '酷我', kg: '酷狗', tx: 'QQ', wy: '网易', mg: '咪咕' };
    const color = colors[source] || 't-bg-main t-text-muted t-border-main';
    const name = names[source] || source.toUpperCase();
    return `<span class="px-1.5 py-0.5 rounded-md text-[10px] font-bold border ${color} mr-2">${name}</span>`;
}



// Helper for loose image paths
function getImgUrl(item) {
    if (!item) return '/music/assets/logo.svg';
    const s = item;
    // 优先从标准 meta 获取
    if (s.meta && s.meta.picUrl) return s.meta.picUrl;
    // 兼容各种 SDK 的原始字段
    return s.img || s.pic || s.picUrl || s.picture ||
        (s.album && (s.album.picUrl || s.album.img || s.album.pic)) ||
        (s.al && (s.al.picUrl || s.al.img)) ||
        (s.meta && (s.meta.img || s.meta.pic)) ||
        '/music/assets/logo.svg';
}

function renderResults(list) {
    const container = document.getElementById('search-results');
    const header = document.getElementById('search-results-header');
    const headerTitle = document.getElementById('header-title');
    const headerAlbum = document.getElementById('header-album');

    // Determine if we should show the album column
    // Search results (network) show album, collections (local) do not
    const showAlbum = currentSearchScope === 'network';

    // Update Header
    if (header) {
        header.classList.remove('hidden');
    }
    if (headerTitle) {
        if (showAlbum) {
            headerTitle.classList.remove('lg:col-span-6');
            headerTitle.classList.add('lg:col-span-4');
        } else {
            headerTitle.classList.remove('lg:col-span-4');
            headerTitle.classList.add('lg:col-span-6');
        }
    }
    if (headerAlbum) {
        if (showAlbum) {
            headerAlbum.classList.add('hidden');
            headerAlbum.classList.add('lg:block');
        } else {
            headerAlbum.classList.add('hidden');
            headerAlbum.classList.remove('lg:block');
        }
    }

    container.innerHTML = '';

    // [Fix] 确保每个歌曲都有唯一的 ID，防止批量操作时因为 ID 缺失(undefined)导致只能选中一个
    // 很多源(如酷狗、咪咕)返回的原始数据可能只有 hash 或 copyrightsId 而没有 id 字段
    if (list && list.length > 0) {
        list.forEach((item, idx) => {
            if (!item.id || item.id === 'undefined') {
                item.id = item.songmid || item.songId || item.hash || item.copyrightId || item.mid || item.mediaMid || `temp_${Date.now()}_${idx}`;
            }
        });
    }

    window.viewingPlaylist = list;

    if (!list || list.length === 0) {
        container.innerHTML = '<div class="text-center t-text-muted p-8">未找到相关结果</div>';
        updatePaginationInfo(0, 0, 0);
        return;
    }

    // Pagination
    const totalItems = list.length;
    let itemsPerPage = settings.itemsPerPage === 'all' ? totalItems : parseInt(settings.itemsPerPage);
    const totalPages = Math.ceil(totalItems / itemsPerPage);

    // Bounds check
    if (currentPage > totalPages) currentPage = totalPages;
    if (currentPage < 1) currentPage = 1;

    const startIndex = (currentPage - 1) * itemsPerPage;
    const endIndex = Math.min(startIndex + itemsPerPage, totalItems);
    const pageList = list.slice(startIndex, endIndex);

    pageList.forEach((item, pageIndex) => {
        const actualIndex = startIndex + pageIndex; // Index in full list
        const row = document.createElement('div');
        row.className = 'grid grid-cols-12 gap-4 p-3 hover:t-bg-main border-b border-gray-50 items-center text-sm group transition-colors';

        // Image
        const imgUrl = getImgUrl(item);

        const isSelected = window.selectedItems.has(String(item.id));

        // Grid Layout Adjustment
        const titleLgSpan = showAlbum ? 'lg:col-span-4' : 'lg:col-span-6';

        row.innerHTML = `
            <!-- Index -->
            <div class="col-span-2 sm:col-span-1 text-center font-mono t-text-muted text-xs md:text-sm flex items-center justify-center">
                ${window.batchMode ? `
                    <input type="checkbox" 
                           class="batch-checkbox w-4 h-4 text-emerald-600 rounded" 
                           data-song-id="${item.id}"
                           ${isSelected ? 'checked' : ''}
                    onclick="event.stopPropagation(); handleBatchSelect('${String(item.id)}', this.checked);">
                ` : `<span class="index-num">${actualIndex + 1}</span>`}
            </div>

            <!-- Title (Image + Text) -->
            <div class="col-span-8 sm:col-span-7 md:col-span-6 ${titleLgSpan} flex items-center overflow-hidden pr-2">
                <div class="relative w-10 h-10 md:w-12 md:h-12 mr-3 md:mr-4 flex-shrink-0 group cursor-pointer">
                     <img data-src="${imgUrl}" src="/music/assets/logo.svg" 
                          class="lazy-image w-full h-full rounded-lg object-cover shadow-sm group-hover:shadow-md transition-all group-hover:scale-105 duration-300 dynamic-logo" 
                          alt="${item.name}"
                          onerror="this.src='/music/assets/logo.svg'"
                          onclick="playFromView(${actualIndex})">
                     <div class="absolute inset-0 bg-black/20 rounded-lg hidden group-hover:flex items-center justify-center transition-all"
                          onclick="playFromView(${actualIndex})">
                        <i class="fas fa-play text-white text-xs md:text-sm"></i>
                     </div>
                </div>
                <div class="min-w-0 flex-1 flex flex-col justify-center overflow-hidden">
                    <div class="font-bold t-text-main text-sm md:text-base leading-tight hover:text-emerald-600 cursor-pointer transition-colors" 
                         onclick="playFromView(${actualIndex})">
                         ${createMarqueeHtml(item.name)}
                    </div>
                    <div class="flex items-center gap-1 mt-0.5 md:mt-1">
                         ${getSourceTag(item.source)}
                         ${getQualityTags(item)}
                    </div>
                </div>
            </div>

            <!-- Artist (Hidden on Mobile) -->
            <div class="hidden sm:block sm:col-span-3 md:col-span-3 lg:col-span-3 t-text-muted text-sm md:text-base truncate flex items-center hover:text-emerald-600 transition-colors cursor-pointer"
                 title="${item.singer}"
                 onclick="event.stopPropagation(); document.getElementById('search-input').value = '${item.singer.replace(/'/g, "\\'")}'; doSearch();">
                ${item.singer}
            </div>

            <!-- Album (Hidden until LG) -->
            ${showAlbum ? `
            <div class="hidden lg:block lg:col-span-2 text-gray-500 text-sm truncate flex items-center" title="${item.albumName || ''}">
                ${item.albumName || '-'}
            </div>
            ` : ''}

            <!-- Duration (Hidden until MD) -->
            <div class="hidden md:block md:col-span-1 t-text-muted text-sm font-mono text-center flex items-center justify-center">
                ${item.interval || '--:--'}
            </div>

            <!-- Actions -->
            <div class="col-span-2 sm:col-span-1 flex items-center justify-end gap-1 opacity-100 sm:opacity-0 group-hover:opacity-100 transition-opacity">
                <button class="p-1.5 hover:bg-emerald-50 rounded text-emerald-600 transition-colors" 
                        title="播放" 
                        onclick="event.stopPropagation(); playFromView(${actualIndex})">
                    <i class="fas fa-play w-4 h-4"></i>
                </button>
                <button class="p-1.5 hover:bg-blue-50 rounded text-blue-600 transition-colors" 
                        title="下载" 
                        onclick="event.stopPropagation(); downloadSong(${JSON.stringify(item).replace(/"/g, '&quot;')})">
                    <i class="fas fa-download w-4 h-4"></i>
                </button>
                ${currentSearchScope !== 'network' ? `
                <button class="p-1.5 hover:bg-red-50 rounded text-red-600 transition-colors" 
                        title="删除" 
                        onclick="event.stopPropagation(); deleteSingleSong('${item.id}')">
                    <i class="fas fa-trash w-4 h-4"></i>
                </button>
                ` : ''}
            </div>
        `;


        container.appendChild(row);
    });

    // Update pagination info
    updatePaginationInfo(startIndex + 1, endIndex, totalItems);

    // Init Lazy Loader
    lazyLoadImages();
    applyMarqueeChecks();
}

// Generic Marquee Helper
function createMarqueeHtml(text, className = '') {
    // Return a container marked for dynamic checking
    // different screens are different, so we check overflow after render
    // Added min-w-0 to prevent flex item from expanding beyond parent
    return `<div class="truncate dynamic-marquee min-w-0 ${className}" data-text="${text.replace(/"/g, '&quot;')}">${text}</div>`;
}

function applyMarqueeChecks() {
    // Wait for render
    setTimeout(() => {
        const elements = document.querySelectorAll('.dynamic-marquee.truncate');
        elements.forEach(el => {
            if (el.scrollWidth > el.clientWidth) {
                const text = el.getAttribute('data-text') || el.innerText;
                const gap = '<span class="mx-8"></span>'; // 增加间距

                // 必须保留 overflow-hidden 以限制宽度
                el.classList.remove('truncate');
                el.classList.add('overflow-hidden');

                // 使用 mask-image 实现边缘渐隐效果
                const maskStyle = 'mask-image: linear-gradient(to right, transparent 0%, black 5%, black 95%, transparent 100%); -webkit-mask-image: linear-gradient(to right, transparent 0%, black 5%, black 95%, transparent 100%);';

                el.innerHTML = `
                <div class="w-full relative" style="${maskStyle}">
                    <div class="inline-block whitespace-nowrap animate-marquee hover:pause-animation">
                        <span>${text}</span>${gap}<span>${text}</span>${gap}
                    </div>
                </div>`;
            }
        });
    }, 50);
}

// Re-check marquees on resize
window.addEventListener('resize', () => {
    clearTimeout(window._marqueeResizeTimer);
    window._marqueeResizeTimer = setTimeout(applyMarqueeChecks, 300);
});

// Lazy Loading Logic
let imageObserver;

function lazyLoadImages() {
    // If IntersectionObserver is supported
    if ('IntersectionObserver' in window) {
        if (imageObserver) {
            imageObserver.disconnect();
        }

        imageObserver = new IntersectionObserver((entries, observer) => {
            entries.forEach(entry => {
                if (entry.isIntersecting) {
                    const img = entry.target;
                    const src = img.getAttribute('data-src');

                    if (src) {
                        img.src = src;
                        img.onload = () => {
                            img.classList.remove('opacity-0'); // Optional fade-in if we add class
                            img.removeAttribute('data-src');
                        };
                        img.onerror = () => {
                            img.src = '/music/assets/logo.svg';
                        };
                    }
                    observer.unobserve(img);
                }
            });
        }, {
            rootMargin: '100px 0px', // Load before it comes into view
            threshold: 0.01
        });

        const images = document.querySelectorAll('img.lazy-image');
        images.forEach(img => {
            imageObserver.observe(img);
        });
    } else {
        // Fallback for older browsers
        const images = document.querySelectorAll('img.lazy-image');
        images.forEach(img => {
            const src = img.getAttribute('data-src');
            if (src) img.src = src;
        });
    }
}


// Playback Logic
let currentLoadingSongId = null; // Track currently loading song
let loadingRequestCounter = 0;   // To identify unique play requests
let currentLoadingRequestId = 0; // Track latest request ID

let currentQuality = null; // 当前播放音质 (从 settings.preferredQuality 动态获取)
let currentSourceType = 'normal'; // 当前链接来源类型: 'normal' | 'cache' | 'server_cache'
let hintTimeout = null;

// --- Server Cache Helpers ---
async function checkServerCache(song, quality) {
    try {
        const username = currentListData?.username || '';
        const params = new URLSearchParams({
            name: song.name,
            singer: song.singer,
            source: song.source,
            songmid: song.songmid || (song.meta && (song.meta.songmid || song.meta.songId)) || '',
            songId: song.songId || (song.meta && song.meta.songId) || song.id,
            quality: quality || ''
        });
        const headers = {};
        if (username) headers['x-user-name'] = username;

        const res = await fetch(`/api/music/cache/check?${params}`, { headers });
        if (res.ok) {
            const data = await res.json();
            if (data.exists) {
                // Correctly format URL with username segment
                const userPath = username || '_open';
                const filename = data.filename || data.url.split('/').pop();
                return `/api/music/cache/file/${encodeURIComponent(userPath)}/${filename}`;
            }
        }
    } catch (e) { console.error('[ServerCache] Check failed:', e); }
    return null;
}

async function triggerServerCache(song, url, quality) {
    try {
        console.log('[ServerCache] Triggering background download for:', song.name);
        const username = currentListData?.username || '';
        const headers = { 'Content-Type': 'application/json' };
        if (username) headers['x-user-name'] = username;

        await fetch('/api/music/cache/download', {
            method: 'POST',
            headers: headers,
            body: JSON.stringify({ songInfo: song, url, quality })
        });
    } catch (e) { console.error('[ServerCache] Trigger failed:', e); }
}

function updateServerCacheConfig(location) {
    fetch('/api/music/cache/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ location })
    }).catch(e => console.error('[ServerCache] Config update failed:', e));
}
window.updateServerCacheConfig = updateServerCacheConfig; // Expose global

/**
 * playFromView handles user click on a song in the search/list view.
 * It ensures the playback queue is updated to match the viewed list.
 */
function playFromView(index) {
    if (!viewingPlaylist || !viewingPlaylist[index]) return;
    // Update playlist and scope when user explicitly clicks a song to play
    updatePlaylist(viewingPlaylist, index, currentSearchScope);
}
window.playFromView = playFromView;

async function playSong(song, index, forceQuality = null, noPlay = false, isRetry = false, shouldAddToDefault = null) {
    // 1. Debounce / Lock: If already loading this song, ignore click
    // [Fix] Allow retry to bypass this check
    if (currentLoadingSongId === song.id && !isRetry) {
        console.log(`[Player] Already loading ${song.name}, ignoring request.`);
        return;
    }

    // 2. New Song Request: Update target
    const thisRequestSongId = song.id;
    // Clear any pending auto-skip timer
    if (window._autoSkipTimer) {
        clearTimeout(window._autoSkipTimer);
        window._autoSkipTimer = null;
    }

    const thisRequestId = ++loadingRequestCounter;
    currentLoadingSongId = thisRequestSongId;
    currentLoadingRequestId = thisRequestId;

    currentIndex = index;
    currentPlayingSong = song;
    window.currentPlayingSong = song; // expose for lyric-card.js
    updatePlayerInfo(song);
    updateMediaSessionMetadata(song);

    // Refresh queue UI if drawer is open to update active indicator
    const queueDrawer = document.getElementById('queue-drawer');
    if (queueDrawer && !queueDrawer.classList.contains('translate-x-full')) {
        renderQueue();
    }

    // [Fix] 切换歌曲前强制重置手动滚动状态
    isUserScrolling = false;
    if (scrollLockTimeout) {
        clearTimeout(scrollLockTimeout);
        scrollLockTimeout = null;
    }
    const indicator = document.getElementById('lyric-scroll-indicator');
    if (indicator) {
        indicator.classList.add('hidden');
        indicator.style.display = 'none';
    }

    // Show persistent loading toast
    if (!isRetry) showInfo(`正在加载: ${song.name}...`);

    // 处理切换提示的显示与隐藏
    const hint = document.getElementById('toggle-hint');
    if (hint) {
        // 重置为可见：清理内联样式，恢复 CSS 类定义的默认状态 (opacity-80, max-h-8, mt-2)
        hint.style.opacity = '';
        hint.style.maxHeight = '';
        hint.style.marginTop = '';
        hint.classList.remove('opacity-0');

        if (hintTimeout) clearTimeout(hintTimeout);
        hintTimeout = setTimeout(() => {
            // 强制使用内联样式隐藏并收起占位
            hint.style.opacity = '0';
            hint.style.maxHeight = '0px';
            hint.style.marginTop = '0px';
        }, 5000);
    }

    // 显示加载状态
    setPlayerStatus('正在获取播放链接...');

    // [Crossfade] 如果开启了淡入淡出，则先执行淡出
    if (settings.enableCrossfade && !noPlay && audio && !audio.paused && audio.src) {
        // [Improvement] 等待一个快速的淡出 (300ms)，确保切换时听感顺滑并能触发暂停
        await fadeVolume(0, 300);
    }

    if (!noPlay) {
        try { audio.pause(); } catch (e) { } // 确保上一首立即停止
    }
    updatePlayButton(false); // 暂停按钮状态

    try {
        // 智能音质选择
        const quality = forceQuality || window.QualityManager.getBestQuality(
            song,
            settings.preferredQuality || '320k'
        );
        currentQuality = quality;

        console.log(`[Player] 播放歌曲: ${song.name} - ${song.singer} [${quality}]`);

        const cleanedSong = cleanSongData(song);
        const cacheKey = `lx_url_${cleanedSong.id}_${quality}`;

        // ===== 优先尝试：读取服务器文件缓存 (本地文件) =====
        // 优先级逻辑链: 服务器文件缓存 (本地文件) > 链接缓存 (浏览器) > 在线获取
        const allowServerCache = !isRetry && settings.enableServerCache && !forceQuality;

        if (allowServerCache) {
            setPlayerStatus('正在检查服务器缓存...');
            const serverCacheUrl = await checkServerCache(cleanedSong, quality);
            if (serverCacheUrl) {
                console.log('[Player] 使用服务器文件缓存:', serverCacheUrl);

                audio.src = serverCacheUrl; // 本地路径，无需代理

                const retryHandler = () => {
                    console.warn('[Player] 服务器缓存文件失效，正在尝试逻辑链下一环（链接缓存）...');
                    showInfo('本地缓存文件失效，尝试链接缓存...');
                    // 服务器缓存失效，跳过它尝试链接缓存
                    playSong(song, index, forceQuality, noPlay, 'local_retry');
                };
                audio.addEventListener('error', retryHandler, { once: true });
                const successHandler = () => { audio.removeEventListener('error', retryHandler); };
                audio.addEventListener('playing', successHandler, { once: true });

                // 设置链接来源为服务器缓存
                currentSourceType = 'server_cache';

                // 如果是静默加载（用于恢复进度）
                if (noPlay) {
                    currentQuality = quality;
                    setPlayerStatus('', false);
                    updatePlayButton(false);
                    if (window._resumeInfo && window._resumeInfo.time > 0) {
                        audio.addEventListener('loadedmetadata', () => {
                            audio.currentTime = window._resumeInfo.time;
                            delete window._resumeInfo;
                        }, { once: true });
                    }
                    return;
                }

                setPlayerStatus('正在加载服务器缓存文件...', false);
                if (!noPlay) {
                    try {
                        if (settings.enableCrossfade) {
                            audio.volume = 0;
                        } else {
                            audio.volume = typeof currentVolume !== 'undefined' ? currentVolume : 1;
                        }

                        await audio.play();
                        showSuccess('已命中本地文件播放');

                        if (settings.enableCrossfade) {
                            fadeVolume(typeof currentVolume !== 'undefined' ? currentVolume : 1, 1000);
                        }
                    } catch (e) {
                        console.error("[Player] Auto-play failed:", e);
                        updatePlayButton(false);
                    }
                }
                return;
            }
        }

        // ===== 其次尝试：读取链接缓存 (浏览器 localStorage) =====
        const allowLinkCache = (!isRetry || isRetry === 'local_retry') && settings.enableSongUrlCache !== false && !forceQuality;

        if (allowLinkCache) {
            const cachedUrl = localStorage.getItem(cacheKey);
            if (cachedUrl) {
                console.log('[Player] 使用缓存链接:', cachedUrl);

                let finalUrl = cachedUrl;
                // Apply Proxy Setting logic
                let shouldProxyPlayback = settings.enableProxyPlayback;
                if (!shouldProxyPlayback && settings.enableAutoProxy) {
                    if (window.location.protocol === 'https:' && finalUrl.startsWith('http://')) {
                        shouldProxyPlayback = true;
                        console.log('[Proxy] 自动代理 HTTP 链接 (缓存源)');
                    }
                }

                if (shouldProxyPlayback) {
                    if (!finalUrl.startsWith('/api/music/download')) {
                        const filename = `${song.singer} - ${song.name}.mp3`;
                        finalUrl = `/api/music/download?url=${encodeURIComponent(cachedUrl)}&filename=${encodeURIComponent(filename)}&inline=1`;
                    }
                }

                audio.src = finalUrl;

                // 设置重试机制：如果缓存链接失效，则清除缓存，并尝试在线获取
                const retryHandler = () => {
                    console.warn('[Player] 缓存链接失效，正在尝试在线获取...');
                    showInfo('缓存链接失效，尝试在线获取...');
                    localStorage.removeItem(cacheKey);
                    // 标记为 true，跳过所有缓存逻辑
                    playSong(song, index, forceQuality, noPlay, true);
                };

                audio.addEventListener('error', retryHandler, { once: true });

                // 成功播放后移除错误监听
                const successHandler = () => {
                    audio.removeEventListener('error', retryHandler);
                };
                audio.addEventListener('playing', successHandler, { once: true });

                // 设置链接来源为缓存
                currentSourceType = 'cache';

                // 如果是静默加载（用于恢复进度）
                if (noPlay) {
                    currentQuality = quality;
                    setPlayerStatus('', false);
                    updatePlayButton(false);
                    if (window._resumeInfo && window._resumeInfo.time > 0) {
                        audio.addEventListener('loadedmetadata', () => {
                            audio.currentTime = window._resumeInfo.time;
                            delete window._resumeInfo;
                        }, { once: true });
                    }
                    return;
                }

                setPlayerStatus('正在加载缓存链接...', false);
                if (!noPlay) {
                    try {
                        if (settings.enableCrossfade) {
                            audio.volume = 0;
                        } else {
                            audio.volume = typeof currentVolume !== 'undefined' ? currentVolume : 1;
                        }

                        await audio.play();
                        showSuccess('已命中缓存链接播放');

                        if (settings.enableCrossfade) {
                            fadeVolume(typeof currentVolume !== 'undefined' ? currentVolume : 1, 1000);
                        }
                    } catch (e) {
                        console.error("[Player] Auto-play failed:", e);
                        updatePlayButton(false);
                    }
                }
                return; // 命中缓存
            }
        }

        const headers = { 'Content-Type': 'application/json' };
        if (typeof authToken !== 'undefined' && authToken) headers['x-user-token'] = authToken;
        if (typeof currentListData !== 'undefined' && currentListData && currentListData.username) headers['x-user-name'] = currentListData.username;

        setPlayerStatus('正在从服务器获取播放地址...');
        const res = await fetch(`${API_BASE}/url`, {
            method: 'POST',
            headers,
            body: JSON.stringify({ songInfo: song, quality })
        });

        // 3. Stale Check: If user switched song while fetching, discard result
        if (currentLoadingRequestId !== thisRequestId) {
            console.log(`[Player] Discarding stale result for ${song.name} (Now loading ID: ${currentLoadingRequestId}, Current: ${thisRequestId})`);
            return;
        }

        if (!res.ok) {
            // [Improvement] Try to get detailed error
            let errorMsg = `HTTP ${res.status}`;
            let result = {};
            try {
                result = await res.json();
                if (result.error) errorMsg = result.error;
            } catch (e) { /* ignore JSON parse error */ }

            // [New] 显示中间尝试记录 (失败分支)
            if (result.attempts) {
                showPlaybackAttempts(result.attempts);
            }
            throw new Error(errorMsg);
        }

        const result = await res.json();

        if (result.url) {
            // [New] 显示中间尝试记录 (成功分支)
            if (result.attempts) {
                showPlaybackAttempts(result.attempts);
            }

            // [New] 显示具体音源成功提示 (如果 result.sourceName 存在且未被 attempts 覆盖)
            if (result.sourceName && (!result.attempts || !result.attempts.some(a => a.status === 'success' && a.name === result.sourceName))) {
                showSuccess(`[${result.sourceName}] 成功获取链接`);
            }
            // [New] 显示中间产生的失败警告（例如部分音源重试失败但最终成功）
            if (result.errorMsg) {
                showError(result.errorMsg);
            }

            let finalUrl = result.url;

            // ===== 写入缓存 =====
            if (settings.enableSongUrlCache !== false) {
                try {
                    localStorage.setItem(cacheKey, result.url);
                    updateStorageStatsUI();
                } catch (e) { console.warn('Cache full'); }
            }

            // ===== 触发服务器缓存下载 =====
            if (settings.enableServerCache && !result.url.includes('/api/music/cache/file/')) {
                triggerServerCache(song, result.url, quality);
            }

            // Apply Proxy Setting logic
            let shouldProxyPlayback = settings.enableProxyPlayback;
            if (!shouldProxyPlayback && settings.enableAutoProxy) {
                if (window.location.protocol === 'https:' && finalUrl.startsWith('http://')) {
                    shouldProxyPlayback = true;
                    console.log('[Proxy] 自动代理 HTTP 链接');
                }
            }

            if (shouldProxyPlayback) {
                // Wrap in proxy if not already wrapped
                if (!finalUrl.startsWith('/api/music/download')) {
                    const filename = `${song.singer} - ${song.name}.mp3`;
                    finalUrl = `/api/music/download?url=${encodeURIComponent(result.url)}&filename=${encodeURIComponent(filename)}&inline=1`;
                }
            }

            audio.src = finalUrl;

            // 如果是静默加载（用于恢复进度）
            if (noPlay) {
                currentQuality = result.type || quality;
                currentSourceType = 'normal'; // 设置链接来源为正常
                setPlayerStatus('', false); // 使用智能状态显示
                updatePlayButton(false);
                // 加载元数据后尝试恢复进度
                if (window._resumeInfo && window._resumeInfo.time > 0) {
                    audio.addEventListener('loadedmetadata', () => {
                        audio.currentTime = window._resumeInfo.time;
                        delete window._resumeInfo;
                    }, { once: true });
                }
                return;
            }

            // 尝试播放
            try {
                // [Crossfade] 播放前先将音量降为 0，准备淡入
                if (settings.enableCrossfade) {
                    audio.volume = 0;
                } else {
                    audio.volume = typeof currentVolume !== 'undefined' ? currentVolume : 1;
                }

                await audio.play();

                if (settings.enableCrossfade) {
                    fadeVolume(typeof currentVolume !== 'undefined' ? currentVolume : 1, 1000);
                }

                currentQuality = result.type || quality;
                currentSourceType = 'normal'; // 设置链接来源为正常
                setPlayerStatus('', true); // 使用智能状态显示
                updatePlayButton(true);

                // 保存播放历史
                savePlayHistory(song, currentQuality);
                // 只要是显式要求或者符合搜索/歌单范围，就添加到默认列表 (试听列表)
                const finalAdd = shouldAddToDefault !== null ? shouldAddToDefault : (currentPlayingScope === 'network' || currentPlayingScope === 'songlist');

                if (finalAdd) {
                    addToDefaultList(song);

                    // [播放逻辑] 根据设置决定是否切换播放上下文
                    // 默认值处理：只有在明确设为 false 时才不切换
                    let shouldSwitch = (currentPlayingScope === 'songlist')
                        ? (settings.switchPlaylistOnSongListPlay !== false)
                        : (settings.switchPlaylistOnSearchPlay !== false);

                    if (!shouldSwitch && typeof currentListData !== 'undefined' && currentListData.defaultList) {
                        currentPlaylist = currentListData.defaultList;
                        currentIndex = 0; // unshift 到了第一位
                        currentPlayingScope = 'local_list';
                        window.currentViewingListId = 'default';
                        console.log(`[Logic] 已切换播放上下文到默认列表 (Stay in Default List) - From: ${currentPlayingScope}`);
                    } else {
                        console.log(`[Logic] 保持当前播放上下文: ${currentPlayingScope}, ShouldSwitch: ${shouldSwitch}`);
                    }
                }

                console.log(`[Player] 播放成功: ${result.url.substring(0, 50)}...`);
            } catch (playError) {
                console.error('[Player] 自动播放被阻止:', playError);
                setPlayerStatus('请点击播放按钮');
            }
        } else {
            throw new Error('服务器未返回播放链接');
        }
    } catch (error) {
        // Stale Check in error
        if (currentLoadingRequestId !== thisRequestId) return;

        console.error('[Player] 播放失败:', error);

        const isSourceError = error.message.includes('自定义源') || error.message.includes('not supported');

        // 尝试降级重试
        const nextQuality = window.QualityManager.getNextLowerQuality(currentQuality);
        const canRetry = nextQuality && !forceQuality && !isSourceError;

        if (canRetry) {
            console.log(`[Player] 尝试降级到 ${nextQuality} 重试...`);
            setPlayerStatus(`播放失败，尝试降级到 ${window.QualityManager.getQualityDisplayName(nextQuality)}...`);

            // Allow retry to proceed as new request
            currentLoadingRequestId = 0;
            currentLoadingSongId = null;

            setTimeout(() => {
                playSong(song, index, nextQuality);
            }, 1000);
        } else {
            // 无法重试，显示错误并停止播放 (防止无限跳过循环)
            console.error(`[Player] Playback failed: ${error.message}`);
            setPlayerStatus('播放失败');
            showError(`播放失败: ${error.message}`);

            // [Fix] Disable auto-skip on error to prevent infinite loop
            // asking user to check sources instead
            if (error.message.includes('not supported') || error.message.includes('自定义源')) {
                showError('未找到该歌曲的可用源，请检查自定义源设置');
            }

            // 失败自动下一曲逻辑
            if (settings.enableAutoSkipOnError) {
                console.log('[Player] Playback failed, auto-skipping to next in 3s...');
                if (window._autoSkipTimer) clearTimeout(window._autoSkipTimer);
                window._autoSkipTimer = setTimeout(() => {
                    playNext();
                }, 3000);
            }
        }
        updatePlayButton(false);
    } finally {
        if (currentLoadingRequestId === thisRequestId) {
            currentLoadingRequestId = 0;
            currentLoadingSongId = null;
        }
    }
}

// 设置播放器状态文本
function setPlayerStatus(status, isPlaying = null) {
    const statusEl = document.getElementById('player-status');
    if (!statusEl) return;

    // 如果传入的是完整的状态文本（如"正在获取播放链接..."），直接显示
    if (typeof status === 'string' && (status.includes('...') || status.includes('请点击') || status.includes('即将跳过'))) {
        statusEl.innerText = status;
        return;
    }

    // 构建状态文本
    let statusText = '';

    // 确定播放状态
    if (isPlaying === null) {
        // 从 audio 元素获取当前状态
        isPlaying = !audio.paused;
    }

    const playStatus = isPlaying ? '播放中' : '暂停中';


    // 获取音质显示名称
    const qualityName = currentQuality ? window.QualityManager.getQualityDisplayName(currentQuality) : '';

    // 组合状态文本
    if (qualityName) {
        statusText = `${playStatus} (${qualityName})`;
    } else {
        statusText = playStatus;
    }

    // 根据链接来源添加提示
    if (currentSourceType === 'cache') {
        statusText += ' 【缓存链接】';
    } else if (currentSourceType === 'server_cache') {
        statusText += ' 【服务器缓存】';
    }

    statusEl.innerText = statusText;
}


// 保存播放历史
function savePlayHistory(song, quality) {
    try {
        const history = JSON.parse(localStorage.getItem('play_history') || '[]');
        history.unshift({
            ...song,
            quality,
            playedAt: Date.now()
        });
        // 只保留最近 50 条
        localStorage.setItem('play_history', JSON.stringify(history.slice(0, 50)));
    } catch (e) {
        console.error('[Player] 保存播放历史失败:', e);
    }
}

// 添加到默认列表 (试听列表)
async function addToDefaultList(song) {
    if (!currentListData || !currentListData.defaultList) return;

    try {
        const cleanedData = cleanSongData(song);
        const targetId = cleanedData.id;
        const list = currentListData.defaultList;

        // Check if exists
        const idx = list.findIndex(s => s.id === targetId);

        if (idx !== -1) {
            // Already exists, move to top
            list.splice(idx, 1);
        }

        // Add to top
        list.unshift(cleanedData);

        // Limit size to avoid bloat (e.g., 200 songs)
        if (list.length > 200) {
            list.length = 200;
        }

        // Sync
        await pushDataChange();

        // Refresh sidebar to update count
        renderMyLists(currentListData);
    } catch (e) {
        console.error('[DefaultList] 添加失败:', e);
    }
}

/**
 * 更新当前播放列表并开始播放指定歌曲
 * @param {Array} list 歌曲列表
 * @param {number} startIndex 开始播放的索引 (默认 0)
 * @param {string} scope 搜索范围/来源 (用于播放逻辑识别)
 * @param {boolean} shouldAddToDefault 是否加入默认(试听)列表
 */
function updatePlaylist(list, startIndex = 0, scope = 'local_list', shouldAddToDefault = null) {
    if (!list || list.length === 0) {
        showError('播放列表为空');
        return;
    }

    // [New] Use a shallow copy to prevent mutations from affecting the source list
    currentPlaylist = [...list];
    currentPlayingScope = scope;

    // 如果是从网络搜索或歌单来源，确保 playSong 能识别并更新 UI/历史
    playSong(currentPlaylist[startIndex], startIndex, null, false, false, shouldAddToDefault);

    console.log(`[Queue] 播放列表已更新 (${currentPlaylist.length} 首), 来源: ${scope}, 加入默认列表: ${shouldAddToDefault}`);

    // Refresh queue UI if it's open
    if (!document.getElementById('queue-drawer').classList.contains('translate-x-full')) {
        renderQueue();
    }
}
window.updatePlaylist = updatePlaylist;

// 显示错误提示（现代化 Toast）
function showError(message) {
    // 移除旧的提示
    const oldToast = document.querySelector('.error-toast');
    if (oldToast) oldToast.remove();

    const toast = document.createElement('div');
    toast.className = 'error-toast fixed bottom-24 right-4 bg-red-500 text-white px-4 py-3 rounded-lg shadow-lg z-50 max-w-sm animate-slide-in';
    toast.innerHTML = `
        <div class="flex items-center gap-2">
            <i class="fas fa-exclamation-circle"></i>
            <span>${message}</span>
        </div>
    `;
    document.body.appendChild(toast);

    setTimeout(() => {
        toast.classList.add('opacity-0', 'transition-opacity');
        setTimeout(() => toast.remove(), 300);
    }, 3000);
}


function updatePlayerInfo(song) {
    // Bottom Player - 更新标题
    const titleEl = document.getElementById('player-title');
    if (titleEl) {
        titleEl.innerText = song.name;
        titleEl.setAttribute('data-text', song.name);
        titleEl.classList.add('truncate');
        titleEl.classList.remove('overflow-hidden');
    }

    // Bottom Player - 更新来源标签
    const sourceEl = document.getElementById('player-source');
    if (sourceEl) {
        if (song.source) {
            const qualityTags = getQualityTags(song);
            sourceEl.innerHTML = getSourceTag(song.source) + qualityTags;
            sourceEl.classList.remove('hidden');
        } else {
            sourceEl.innerHTML = '';
            sourceEl.classList.add('hidden');
        }
    }

    // Bottom Player - 更新艺术家
    const artistEl = document.getElementById('player-artist');
    if (artistEl) {
        artistEl.innerText = song.singer;
        artistEl.setAttribute('data-text', song.singer);
        artistEl.classList.add('truncate');
        artistEl.classList.remove('overflow-hidden');
    }

    // 触发滚动检测
    applyMarqueeChecks();

    const imgUrl = getImgUrl(song);

    const setImg = (id, src) => {
        const el = document.getElementById(id);
        if (el) {
            el.src = src;
            el.onerror = () => { el.src = '/music/assets/logo.svg'; };
        }
    };

    setImg('player-cover', imgUrl);
    setImg('sidebar-cover', imgUrl);
    setImg('detail-cover', imgUrl);

    // Sidebar Mini Info
    document.getElementById('sidebar-song-info').classList.remove('hidden');
    document.getElementById('sidebar-song-name').innerText = song.name;
    document.getElementById('sidebar-singer').innerText = song.singer;

    // Detail View Info (Lyrics Page)
    const detailTitle = document.getElementById('detail-title');
    const detailContainer = document.getElementById('detail-title-container');

    if (detailTitle && detailContainer) {
        // 直接设置文本，由 CSS 处理双行换行和省略号
        detailTitle.innerText = song.name;
        detailTitle.classList.remove('animate-marquee');
    }

    const detailArtist = document.getElementById('detail-artist');
    if (detailArtist) detailArtist.innerText = song.singer;


    // Update Like Button State (Collection Status)
    const btnLike = document.getElementById('player-like-btn');

    // Check if song is in ANY list (except 'default' - temporary list)
    // Actually, 'default' is usually the play queue. We check 'loveList' and 'userList'.
    let isCollected = false;
    if (currentListData) {
        let checkId = song.id;
        // [Fix] Check for QQ Music prefixed ID
        if (song.source === 'tx' && song.songmid && !song.id.startsWith('tx_')) {
            checkId = `tx_${song.songmid}`;
        }

        if (currentListData.loveList.some(s => s.id === song.id || s.id === checkId)) isCollected = true;
        if (currentListData.userList.some(ul => ul.list.some(s => s.id === song.id || s.id === checkId))) isCollected = true;
    }

    // Bind click to Open Modal
    btnLike.onclick = (e) => {
        e.stopPropagation();
        openPlaylistAddModal();
    };

    if (isCollected) {
        btnLike.classList.add('text-red-500');
        btnLike.classList.remove('text-gray-300');
    } else {
        btnLike.classList.remove('text-red-500');
        btnLike.classList.add('text-gray-300');
    }
}

async function togglePlay() {
    // 忽略因为长按触发的 click 事件
    if (window.playBtnIsLongPress) {
        window.playBtnIsLongPress = false;
        return;
    }

    if (audio.paused) {
        try {
            // [Crossfade] 如果开启了淡入淡出，先将进度置为 0，播放后再淡入
            if (settings.enableCrossfade) {
                audio.volume = 0;
            }
            await audio.play();
            updatePlayButton(true);

            if (settings.enableCrossfade) {
                fadeVolume(typeof currentVolume !== 'undefined' ? currentVolume : 1, 600);
            }
        } catch (e) {
            console.error("[Player] Play blocked:", e);
        }
    } else {
        // [Crossfade] 如果开启了淡入淡出，先淡出再暂停
        if (settings.enableCrossfade) {
            await fadeVolume(0, 600);
        }
        audio.pause();
        if (window._autoSkipTimer) {
            clearTimeout(window._autoSkipTimer);
            window._autoSkipTimer = null;
        }
        updatePlayButton(false);
    }
}

function updatePlayButton(isPlaying) {
    const btn = document.getElementById('btn-play');
    btn.innerHTML = isPlaying ? '<i class="fas fa-pause"></i>' : '<i class="fas fa-play ml-1"></i>';
}

function playNext() {
    if (currentPlaylist.length === 0) return;

    let nextIndex;

    switch (playMode) {
        case 'single':
            // 单曲循环：继续播放当前歌曲
            nextIndex = currentIndex;
            break;

        case 'random':
            // 随机播放：随机选择一首（避免重复播放当前歌曲）
            if (currentPlaylist.length === 1) {
                nextIndex = 0;
            } else {
                do {
                    nextIndex = Math.floor(Math.random() * currentPlaylist.length);
                } while (nextIndex === currentIndex);
            }
            break;

        case 'order':
            // 顺序播放：播放下一首，到末尾停止
            nextIndex = currentIndex + 1;
            if (nextIndex >= currentPlaylist.length) {
                console.log('[PlayMode] 顺序播放已到末尾');
                return; // 停止播放
            }
            break;

        case 'list':
        default:
            // 列表循环：播放下一首，到末尾回到开头
            nextIndex = currentIndex + 1;
            if (nextIndex >= currentPlaylist.length) nextIndex = 0;
            break;
    }

    playSong(currentPlaylist[nextIndex], nextIndex);
}

function playPrev() {
    if (currentPlaylist.length === 0) return;

    let prevIndex;

    switch (playMode) {
        case 'single':
            // 单曲循环：继续播放当前歌曲
            prevIndex = currentIndex;
            break;

        case 'random':
            // 随机播放：随机选择一首（避免重复播放当前歌曲）
            if (currentPlaylist.length === 1) {
                prevIndex = 0;
            } else {
                do {
                    prevIndex = Math.floor(Math.random() * currentPlaylist.length);
                } while (prevIndex === currentIndex);
            }
            break;

        case 'order':
        case 'list':
        default:
            // 列表循环 & 顺序播放：播放上一首
            prevIndex = currentIndex - 1;
            if (prevIndex < 0) prevIndex = currentPlaylist.length - 1;
            break;
    }

    playSong(currentPlaylist[prevIndex], prevIndex);
}

// 音量淡入淡出辅助函数
let volumeFadeInterval = null;
function fadeVolume(targetVolume, duration = 800) {
    if (volumeFadeInterval) clearInterval(volumeFadeInterval);

    const startVolume = audio.volume;
    const steps = 20;
    const increment = (targetVolume - startVolume) / steps;
    const stepTime = duration / steps;
    let currentStep = 0;

    return new Promise((resolve) => {
        volumeFadeInterval = setInterval(() => {
            currentStep++;
            let nextVolume = startVolume + (increment * currentStep);

            // 边界检查
            if (nextVolume < 0) nextVolume = 0;
            if (nextVolume > 1) nextVolume = 1;

            audio.volume = nextVolume;

            if (currentStep >= steps) {
                clearInterval(volumeFadeInterval);
                audio.volume = targetVolume;
                resolve();
            }
        }, stepTime);
    });
}

// Audio Events
audio.addEventListener('timeupdate', () => {
    if (isDragging === 'progress') return; // Skip updating UI while user is dragging

    const current = audio.currentTime;
    const duration = audio.duration;

    // [Crossfade] 自然播放接近结束时提前淡出
    if (settings.enableCrossfade && duration > 5 && (duration - current < 1.0)) {
        if (!window._isFadingOut) {
            window._isFadingOut = true;
            fadeVolume(0, 1000);
        }
    } else if (duration - current > 1.5) {
        window._isFadingOut = false;
    }

    document.getElementById('time-current').innerText = formatTime(current);
    document.getElementById('time-total').innerText = formatTime(duration);

    const pct = (current / duration) * 100;
    document.getElementById('progress-bar').style.width = `${pct}%`;

    // 自动恢复：保存播放进度 (节流)
    const now = Date.now();
    if (settings.autoResume && (!window._lastStateSave || now - window._lastStateSave > 5000)) {
        savePlaybackState();
        window._lastStateSave = now;
    }
});

// Screen Wake Lock (NoSleep.js) Wrapper
let noSleepInstance = null;
function toggleNoSleep(enable) {
    if (typeof NoSleep === 'undefined') return;
    if (!noSleepInstance) {
        noSleepInstance = new NoSleep();
    }
    if (enable && settings.keepScreenAwake) {
        if (!noSleepInstance.isEnabled) {
            noSleepInstance.enable().catch(e => console.warn('[NoSleep] 启用失败:', e));
        }
    } else {
        if (noSleepInstance && noSleepInstance.isEnabled) {
            noSleepInstance.disable();
        }
    }
}

// Update Media Session State on Play/Pause
audio.addEventListener('play', () => {
    toggleNoSleep(true);
    // 确保播放时应用设置的倍速
    audio.playbackRate = currentPlaybackRate;

    if ('mediaSession' in navigator) {
        navigator.mediaSession.playbackState = 'playing';
        updatePositionState();
    }

    // [Fix] 这里的状态更新确保 UI 与实际播放状态同步 (e.g. 键盘媒体键控制)
    setPlayerStatus('', true); // 使用智能状态显示
    updatePlayButton(true);

    // [Notice] 我们不再在这里调用 lyricPlayer.play，而是等待 'playing' 事件
    // 这样可以避免在网络缓冲时歌词就开始跑
    if (lyricPlayer) {
        isUserScrolling = false; // 切回自动滚动模式

        // 隐藏滚动指示器
        const indicator = document.getElementById('lyric-scroll-indicator');
        if (indicator) {
            indicator.classList.add('hidden');
            indicator.style.display = 'none';
        }
    }
});

audio.addEventListener('playing', () => {
    // [Fix] 'playing' 事件表示音频真正开始震动输出，此时同步最准确
    if (lyricPlayer) {
        lyricPlayer.play(audio.currentTime * 1000);
        isUserScrolling = false;
        scrollToActiveLine(true); // 强制对齐
    }
});

audio.addEventListener('pause', () => {
    toggleNoSleep(false);
    if ('mediaSession' in navigator) {
        navigator.mediaSession.playbackState = 'paused';
        updatePositionState();
    }

    // [Fix] 这里的状态更新确保 UI 与实际播放状态同步
    setPlayerStatus('', false); // 使用智能状态显示
    updatePlayButton(false);

    if (lyricPlayer) {
        lyricPlayer.pause();
    }
    if (wordAnimationId) cancelAnimationFrame(wordAnimationId); // 立即停止行动画
    if (settings.autoResume) savePlaybackState();
});

// ========================================
// Auto-Resume State Logic
// ========================================

function savePlaybackState() {
    if (!currentPlayingSong) return;
    try {
        const state = {
            song: currentPlayingSong,
            index: currentIndex,
            time: audio.currentTime,
            scope: currentPlayingScope,
            listId: window.currentViewingListId,
            // [Fix] 保存整个当前播放队列副本。
            // 限制长度为 300 首以兼顾性能和容量（通常足够临时列表使用）
            playlist: currentPlaylist ? currentPlaylist.slice(0, 300) : null,
            playMode: playMode,
            timestamp: Date.now()
        };
        localStorage.setItem('lx_playback_state', JSON.stringify(state));
    } catch (e) {
        console.error('[Resume] 无法保存播放状态:', e);
    }
}

async function restorePlaybackState() {
    if (!settings.autoResume) return;

    try {
        const saved = localStorage.getItem('lx_playback_state');
        if (!saved) return;

        const state = JSON.parse(saved);
        if (!state || !state.song) return;

        console.log('[Resume] 正在恢复上次内容:', state.song.name, '队列长度:', state.playlist ? state.playlist.length : 0);

        // 1. 恢复播放模式
        if (state.playMode) {
            playMode = state.playMode;
            updatePlayModeUI();
        }

        // 2. 恢复播放列表 (优先从持久化队列恢复)
        if (state.playlist && state.playlist.length > 0) {
            currentPlaylist = state.playlist;
            currentPlayingScope = state.scope || 'network';
        } else if (['local_list', 'local_all', 'songlist'].includes(state.scope)) {
            // 回退逻辑：如果队列没存，根据作用域恢复
            currentPlayingScope = state.scope;
            window.currentViewingListId = state.listId || 'default';
        }

        currentIndex = state.index >= 0 ? state.index : 0;
        currentPlayingSong = state.song;
        window.currentPlayingSong = state.song;

        // 3. 更新 UI (静默更新)
        updatePlayerInfo(state.song);
        updateMediaSessionMetadata(state.song);
        renderQueue(); // 提前渲染队列 UI

        // 4. 设置恢复时间点
        const resumeTime = state.time || 0;
        window._resumeInfo = {
            time: resumeTime,
            song: state.song
        };

        // 5. 延迟加载播放源（静默模式）并同步 Tab 状态
        setTimeout(() => {
            if (state.scope === 'network') {
                switchTab('search');
                renderResults(currentPlaylist);
            } else if (state.scope === 'local_list' || state.scope === 'local_all') {
                switchTab('favorites');
                window._pendingResumeListId = state.listId || 'default';
            } else if (state.scope === 'songlist') {
                switchTab('songlist');
            }

            // 初始化音频源但不立即播放（除非设置了自动播放，当前 playSong handles resumeTime）
            playSong(state.song, currentIndex, null, true);
        }, 800);

    } catch (e) {
        console.error('[Resume] 恢复播放状态失败:', e);
    }
}

// 辅助函数：根据 ID 查找列表内容
function findListById(data, id) {
    if (!data) return null;
    if (id === 'default') return data.defaultList;
    if (id === 'love') return data.loveList;
    const ul = data.userList.find(l => l.id === id);
    return ul ? ul.list : null;
}

// 辅助函数：获取所有歌曲（我的收藏）
function getAllSongs(data) {
    if (!data) return [];
    let all = [...data.defaultList, ...data.loveList];
    data.userList.forEach(l => {
        all = all.concat(l.list);
    });
    // 去重
    const seen = new Set();
    return all.filter(s => {
        const sid = s.id || s.songmid;
        if (seen.has(sid)) return false;
        seen.add(sid);
        return true;
    });
}

function updatePositionState() {
    if ('mediaSession' in navigator && navigator.mediaSession.setPositionState) {
        // Ensure duration is finite (not Infinity/NaN) before updating
        if (Number.isFinite(audio.duration) && audio.duration > 0) {
            try {
                navigator.mediaSession.setPositionState({
                    duration: audio.duration,
                    playbackRate: audio.playbackRate,
                    position: audio.currentTime
                });
            } catch (e) {
                console.warn('[MediaSession] Failed to update position state:', e);
            }
        }
    }
}

// 歌曲播放结束时根据播放模式处理
audio.addEventListener('ended', () => {
    playNext();
});

// Additional events to sync progress
audio.addEventListener('loadedmetadata', updatePositionState);
audio.addEventListener('ratechange', updatePositionState);
audio.addEventListener('seeked', () => {
    updatePositionState();
    if (lyricPlayer) {
        if (!audio.paused) {
            lyricPlayer.play(audio.currentTime * 1000);
        } else {
            // 如果处于暂停状态，只同步位置不启动计时器
            lyricPlayer.pause();
            const time = audio.currentTime * 1000;
            // 找到当前行并高亮
            const lineNum = lyricPlayer._findCurLineNum(time);
            if (lineNum !== undefined && lineNum >= 0) {
                syncLyricByLineNum(lineNum);
            }
        }
    }
});
audio.addEventListener('waiting', () => {
    if (lyricPlayer) {
        lyricPlayer.pause();
    }
});

// Initialize Media Session Actions
if ('mediaSession' in navigator) {
    navigator.mediaSession.setActionHandler('play', () => {
        togglePlay();
    });
    navigator.mediaSession.setActionHandler('pause', () => {
        togglePlay();
    });
    navigator.mediaSession.setActionHandler('previoustrack', () => {
        playPrev();
    });
    navigator.mediaSession.setActionHandler('nexttrack', () => {
        playNext();
    });

    // Support seeking (Bidirectional Progress Control)
    navigator.mediaSession.setActionHandler('seekto', (details) => {
        if (details.seekTime != null) {
            audio.currentTime = details.seekTime;
            updatePositionState();
        }
    });

    navigator.mediaSession.setActionHandler('seekbackward', (details) => {
        const skipTime = details.seekOffset || 10;
        audio.currentTime = Math.max(audio.currentTime - skipTime, 0);
        updatePositionState();
    });

    navigator.mediaSession.setActionHandler('seekforward', (details) => {
        const skipTime = details.seekOffset || 10;
        audio.currentTime = Math.min(audio.currentTime + skipTime, audio.duration);
        updatePositionState();
    });
}

function updateMediaSessionMetadata(song) {
    if (!('mediaSession' in navigator)) return;

    const imgUrl = getImgUrl(song);
    // Ensure absolute URL if possible
    const fullImgUrl = new URL(imgUrl, window.location.href).href;

    try {
        navigator.mediaSession.metadata = new MediaMetadata({
            title: song.name,
            artist: song.singer,
            album: song.albumName || '',
            artwork: [
                { src: fullImgUrl, sizes: '96x96', type: 'image/jpeg' },
                { src: fullImgUrl, sizes: '128x128', type: 'image/jpeg' },
                { src: fullImgUrl, sizes: '192x192', type: 'image/jpeg' },
                { src: fullImgUrl, sizes: '256x256', type: 'image/jpeg' },
                { src: fullImgUrl, sizes: '384x384', type: 'image/jpeg' },
                { src: fullImgUrl, sizes: '512x512', type: 'image/jpeg' }
            ]
        });
        // Reset playback state logic is handled by event listeners, but metadata update often implies new song start
        // updatePositionState() will be called when loadedmetadata fires for new source
    } catch (e) {
        console.warn('[MediaSession] Failed to update metadata:', e);
    }
}


function seek(e) {
    // Prevent seek if audio is not ready or has infinite duration (live stream)
    if (!audio.duration || !Number.isFinite(audio.duration)) return;

    const container = document.getElementById('progress-container');
    const rect = container.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const pct = Math.max(0, Math.min(1, x / rect.width)); // Clamp between 0 and 1
    const time = pct * audio.duration;

    // Ensure time is valid
    if (Number.isFinite(time)) {
        audio.currentTime = time;
    }
}

// ========== 音量控制 ==========
let currentVolume = 0.75; // 默认音量 75%
let isMuted = false;

// 初始化音量
audio.volume = currentVolume;
updateVolumeUI();

// 设置音量
function setVolume(e) {
    const container = document.getElementById('volume-container');
    const rect = container.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const pct = Math.max(0, Math.min(1, x / rect.width)); // 限制在 0-1 之间

    currentVolume = pct;
    audio.volume = currentVolume;
    isMuted = false;

    updateVolumeUI();

    // 保存到本地存储
    try {
        localStorage.setItem('lx_volume', currentVolume.toString());
    } catch (e) {
        console.error('[Volume] 保存音量失败:', e);
    }
}

// 切换静音
function toggleMute() {
    isMuted = !isMuted;
    audio.muted = isMuted;
    updateVolumeUI();
}

// 更新音量 UI
function updateVolumeUI() {
    const volumeBar = document.getElementById('volume-bar');
    const volumeIcon = document.getElementById('volume-icon');

    if (volumeBar) {
        const displayVolume = isMuted ? 0 : currentVolume;
        volumeBar.style.width = `${displayVolume * 100}%`;
    }

    if (volumeIcon) {
        if (isMuted || currentVolume === 0) {
            volumeIcon.className = 'fas fa-volume-mute w-4';
        } else if (currentVolume < 0.5) {
            volumeIcon.className = 'fas fa-volume-down w-4';
        } else {
            volumeIcon.className = 'fas fa-volume-up w-4';
        }
    }
}

// ========== 播放模式 ==========
let playMode = 'list'; // 'list': 列表循环, 'single': 单曲循环, 'random': 随机播放, 'order': 顺序播放

// 设置播放模式
function setPlayMode(mode) {
    playMode = mode;
    updatePlayModeUI();

    // 保存到本地存储
    try {
        localStorage.setItem('lx_play_mode', mode);
    } catch (e) {
        console.error('[PlayMode] 保存播放模式失败:', e);
    }

    // 显示提示
    const modeNames = {
        'list': '列表循环',
        'single': '单曲循环',
        'random': '随机播放',
        'order': '顺序播放'
    };

    // Close menu (Mobile/Click mode)
    const menu = document.getElementById('play-mode-menu');
    if (menu) menu.classList.remove('force-visible');

    const toast = document.createElement('div');
    toast.className = 'fixed bottom-28 right-4 bg-emerald-500 text-white px-4 py-2 rounded-lg shadow-lg z-50';
    toast.innerHTML = `<i class="fas fa-check-circle mr-2"></i>${modeNames[mode]}`;
    document.body.appendChild(toast);

    setTimeout(() => {
        toast.classList.add('opacity-0', 'transition-opacity');
        setTimeout(() => toast.remove(), 300);
    }, 1500);
}

// 切换播放模式菜单（适配移动端点击）
function togglePlayModeMenu(e) {
    if (e) e.stopPropagation();
    const menu = document.getElementById('play-mode-menu');
    if (menu) {
        menu.classList.toggle('force-visible');
    }
}

// 切换播放倍速菜单（适配移动端点击）
function togglePlaybackRateMenu(e) {
    if (e) e.stopPropagation();
    const menu = document.getElementById('playback-rate-menu');
    if (menu) {
        menu.classList.toggle('force-visible');
    }
}

// 设置播放倍速
function setPlaybackRate(rate) {
    currentPlaybackRate = parseFloat(rate);
    audio.playbackRate = currentPlaybackRate;
    if (lyricPlayer) {
        lyricPlayer.setPlaybackRate(currentPlaybackRate);
        // 强制同步当前音频时间，确保位置严格匹配
        lyricPlayer.play(audio.currentTime * 1000);
        isUserScrolling = false; // 重置手动滚动模式，进入自动跟随
        scrollToActiveLine(true); // 立即对齐并滚动到当前行
    }
    updatePlaybackRateUI();

    // 关闭菜单
    const menu = document.getElementById('playback-rate-menu');
    if (menu) menu.classList.remove('force-visible');
}

// 更新播放倍速 UI
function updatePlaybackRateUI() {
    const btn = document.getElementById('playback-rate-btn');
    if (btn) {
        btn.innerText = currentPlaybackRate === 1.0 ? '1.0x' : `${currentPlaybackRate}x`;
        btn.classList.toggle('text-emerald-500', currentPlaybackRate !== 1.0);
    }

    const options = document.querySelectorAll('.playback-rate-option');
    options.forEach(opt => {
        const rate = parseFloat(opt.dataset.rate);
        if (rate === currentPlaybackRate) {
            opt.classList.add('active-option', 'font-bold');
        } else {
            opt.classList.remove('active-option', 'font-bold');
        }
    });
}

// 监听全局点击，关闭菜单
document.addEventListener('click', (e) => {
    // 关闭播放模式菜单
    const pmMenu = document.getElementById('play-mode-menu');
    const pmBtn = document.getElementById('play-mode-btn');
    if (pmMenu && pmBtn && !pmMenu.contains(e.target) && !pmBtn.contains(e.target)) {
        pmMenu.classList.remove('force-visible');
    }

    // 关闭倍速菜单
    const prMenu = document.getElementById('playback-rate-menu');
    const prBtn = document.getElementById('playback-rate-btn');
    if (prMenu && prBtn && !prMenu.contains(e.target) && !prBtn.contains(e.target)) {
        prMenu.classList.remove('force-visible');
    }
});

// 更新播放模式 UI
function updatePlayModeUI() {
    const btn = document.getElementById('play-mode-btn');
    const options = document.querySelectorAll('.play-mode-option');

    // 更新按钮图标和颜色
    if (btn) {
        const icons = {
            'list': 'fa-redo',
            'single': 'fa-redo-alt',
            'random': 'fa-random',
            'order': 'fa-play'
        };
        const colors = {
            'list': 'text-emerald-500',
            'single': 'text-blue-500',
            'random': 'text-purple-500',
            'order': 'text-gray-500'
        };

        const icon = btn.querySelector('i');
        if (icon) {
            icon.className = `fas ${icons[playMode]}`;
            btn.className = `${colors[playMode]} hover:opacity-80 transition-colors`;
            btn.title = getPlayModeName(playMode);
        }
    }

    // 高亮当前选中的选项
    options.forEach(opt => {
        if (opt.dataset.mode === playMode) {
            opt.classList.add('active-option', 'font-bold');
        } else {
            opt.classList.remove('active-option', 'font-bold');
        }
    });
}

function getPlayModeName(mode) {
    const names = {
        'list': '列表循环',
        'single': '单曲循环',
        'random': '随机播放',
        'order': '顺序播放'
    };
    return names[mode] || '未知';
}

function formatTime(s) {
    if (!s || isNaN(s)) return '00:00';
    const min = Math.floor(s / 60);
    const sec = Math.floor(s % 60);
    return `${min < 10 ? '0' + min : min}:${sec < 10 ? '0' + sec : sec}`;
}

// Update pagination information display
function updatePaginationInfo(start, end, total) {
    const infoEl = document.getElementById('pagination-info');
    if (infoEl) {
        if (total === 0) {
            infoEl.textContent = '暂无数据';
        } else {
            infoEl.textContent = `显示 ${start}-${end} 条，共 ${total} 条`;
        }
    }
}

// Load settings from localStorage
function loadSettings() {
    try {
        const saved = localStorage.getItem('lx_settings');
        if (saved) {
            const loaded = JSON.parse(saved);
            settings = { ...settings, ...loaded };
            console.log('[Settings] 加载设置成功:', settings);
        }
    } catch (e) {
        console.error('[Settings] 加载设置失败:', e);
    }

    // 同步 UI 状态
    syncSettingsUI();
}

// ========== 键盘快捷键逻辑 ==========
let seekTimer = null;
let isLongPress = false;

function handleSeekKey(direction, action) {
    if (action === 'down') {
        if (seekTimer) return; // 已经在处理中

        // 初始步长跳转 (默认 5% 长度)
        let delta = direction === 'forward' ? 10 : -10;
        if (audio.duration && Number.isFinite(audio.duration)) {
            delta = audio.duration * (direction === 'forward' ? 0.05 : -0.05);
        }

        audio.currentTime = Math.max(0, Math.min(audio.duration, audio.currentTime + delta));

        // 设置长按逻辑 (500ms 后进入连续推进模式)
        seekTimer = setTimeout(() => {
            isLongPress = true;
            seekTimer = setInterval(() => {
                const step = direction === 'forward' ? 2 : -2; // 每 100ms 推进 2s = 20s/s
                audio.currentTime = Math.max(0, Math.min(audio.duration, audio.currentTime + step));
            }, 100);
        }, 500);
    } else {
        // 松开按键，重置状态
        if (seekTimer) {
            if (isLongPress) clearInterval(seekTimer);
            else clearTimeout(seekTimer);
            seekTimer = null;
            isLongPress = false;
        }
    }
}

function changeVolume(delta) {
    currentVolume = Math.max(0, Math.min(1, currentVolume + delta));
    audio.volume = currentVolume;
    isMuted = false;
    updateVolumeUI();
    try {
        localStorage.setItem('lx_volume', currentVolume.toString());
    } catch (e) { }
}

// 注册全局键盘监听
document.addEventListener('keydown', (e) => {
    if (!settings.enableKeyboardShortcuts) return;

    // 如果焦点在输入框中，忽略快捷键
    const target = e.target;
    if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) {
        return;
    }

    switch (e.code) {
        case 'Space':
            e.preventDefault();
            togglePlay();
            break;
        case 'ArrowUp':
            e.preventDefault();
            changeVolume(0.05);
            break;
        case 'ArrowDown':
            e.preventDefault();
            changeVolume(-0.05);
            break;
        case 'ArrowLeft':
            e.preventDefault();
            handleSeekKey('backward', 'down');
            break;
        case 'ArrowRight':
            e.preventDefault();
            handleSeekKey('forward', 'down');
            break;
        case 'BracketLeft': // '['
            playPrev();
            break;
        case 'BracketRight': // ']'
            playNext();
            break;
        case 'KeyL':
            toggleLyrics();
            break;
        case 'Digit1':
            if (e.altKey) switchTab('search');
            break;
        case 'Digit2':
            if (e.altKey) switchTab('favorites');
            break;
        case 'Digit3':
            if (e.altKey) switchTab('settings');
            break;
        case 'Digit4':
            if (e.altKey) switchTab('about');
            break;
        case 'KeyF':
            updateSetting('showFooterVisualizer', !settings.showFooterVisualizer);
            break;
        case 'KeyG':
            updateSetting('showDetailVisualizer', !settings.showDetailVisualizer);
            break;
    }
});

document.addEventListener('keyup', (e) => {
    if (!settings.enableKeyboardShortcuts) return;
    if (e.code === 'ArrowLeft') handleSeekKey('backward', 'up');
    if (e.code === 'ArrowRight') handleSeekKey('forward', 'up');
});

function updateSetting(key, value) {
    settings[key] = value;
    window.settings = settings; // 确保全局引用同步
    try {
        localStorage.setItem('lx_settings', JSON.stringify(settings));
        console.log(`[Settings] ${key} 已更新为:`, value);
    } catch (e) {
        console.error('[Settings] 保存设置失败:', e);
    }
    // 实时同步 UI 并应用效果
    syncSettingsUI(key, value);

    // Special handlers for visual changes
    if (key.includes('Visualizer') || key.startsWith('visualizer')) {
        if (window.musicVisualizer) {
            // 如果正在播放且开启了开关，尝试强制初始化 (防止第一次点击开关没反应)
            if (typeof audio !== 'undefined' && !audio.paused && (settings.showFooterVisualizer || settings.showDetailVisualizer)) {
                window.musicVisualizer.init();
            }
            window.musicVisualizer.applySettings();
        }

        // 更新透明度数值显示
        if (key === 'visualizerOpacity') {
            const el = document.getElementById('visualizer-opacity-value');
            if (el) el.innerText = value;
        }
    }

    if (key === 'playerBackground') {
        applyPlayerBackground(value);
    }
}

//缓存设置项
function syncSettingsUI(key = null, value = null) {
    // 如果指定了 key 和 value，则只更新对应项
    if (key !== null && value !== null) {
        if (key === 'switchPlaylistOnSearchPlay') {
            const check = document.getElementById('setting-switch-playlist-search');
            if (check) check.checked = value;
        }

        if (key === 'switchPlaylistOnSongListPlay') {
            const check = document.getElementById('setting-switch-playlist-songlist');
            if (check) check.checked = value;
        }

        if (key === 'showSidebarSongInfo') {
            const check = document.getElementById('setting-show-sidebar-info');
            if (check) check.checked = value;

            // 实时应用逻辑 (通过控制 md:block 来决定桌面端是否显示，底色 hidden 保留)
            const sidebarInfo = document.querySelector('.sidebar-song-info-wrapper');
            if (sidebarInfo) {
                if (value) {
                    sidebarInfo.classList.add('md:block');
                } else {
                    sidebarInfo.classList.remove('md:block');
                }
            }
        }

        if (key === 'enableCrossfade') {
            const check = document.getElementById('setting-enable-crossfade');
            if (check) check.checked = value;
        }

        if (key === 'keepScreenAwake') {
            const check = document.getElementById('setting-keep-screen-awake');
            if (check) check.checked = value;
            toggleNoSleep(value && !audio.paused); // 实时应用
        }

        if (key === 'enableKeyboardShortcuts') {
            const check = document.getElementById('setting-enable-shortcuts');
            if (check) check.checked = value;
        }

        if (['showLyricTranslation', 'showLyricRoma', 'swapLyricTransRoma'].includes(key)) {
            const idMap = {
                showLyricTranslation: 'setting-show-lyric-translation',
                showLyricRoma: 'setting-show-lyric-roma',
                swapLyricTransRoma: 'setting-swap-lyric-trans-roma'
            };
            const check = document.getElementById(idMap[key]);
            if (check) check.checked = value;

            // 实时应用：如果当前有播放中的歌词，则重新设置
            if (lyricPlayer && currentRawLrc) {
                applyLyricUpdate();
            }
        }

        if (key === 'autoCompactPlaybar') {
            const check = document.getElementById('setting-auto-compact-playbar');
            if (check) check.checked = value;
        }

        if (key === 'enableAutoSkipOnError') {
            const check = document.getElementById('setting-auto-skip-on-error');
            if (check) check.checked = value;
        }

        if (key === 'showFooterVisualizer') {
            const check = document.getElementById('setting-show-footer-visualizer');
            if (check) check.checked = value;
        }

        if (key === 'footerVisualizerStyle') {
            const select = document.getElementById('setting-footer-visualizer-style');
            if (select) select.value = value;
        }

        if (key === 'showDetailVisualizer') {
            const check = document.getElementById('setting-show-detail-visualizer');
            if (check) check.checked = value;
        }

        if (key === 'detailVisualizerStyle') {
            const select = document.getElementById('setting-detail-visualizer-style');
            if (select) select.value = value;
        }

        if (key === 'visualizerOpacity') {
            const range = document.getElementById('setting-visualizer-opacity');
            const valueDisplay = document.getElementById('visualizer-opacity-value');
            if (range) range.value = value;
            if (valueDisplay) valueDisplay.innerText = value;
        }

        if (key === 'visualizerGlobalStyle') {
            const select = document.getElementById('setting-visualizer-global-style');
            if (select) select.value = value;
        }

        if (key === 'enableLyricCache') {
            const check = document.getElementById('setting-enable-lyric-cache');
            if (check) check.checked = value;
        }

        if (key === 'enableSongUrlCache') {
            const check = document.getElementById('setting-enable-url-cache');
            if (check) check.checked = value;
        }

        if (key === 'enableLyricGlow') {
            const check = document.getElementById('setting-enable-lyric-glow');
            if (check) check.checked = value;

            // 实时应用
            const detailView = document.getElementById('view-player-detail');
            if (detailView) {
                if (value) detailView.classList.add('enable-lyric-glow');
                else detailView.classList.remove('enable-lyric-glow');
            }
        }

        if (key === 'playerBackground') {
            const select = document.getElementById('setting-player-background');
            if (select) select.value = value;
            applyPlayerBackground(value);
        }

        // 如果有其他需要实时更新的设置，可以在这里添加
        return;
    }

    // 否则，同步所有 UI 状态
    // 背景设置
    const backgroundSelect = document.getElementById('setting-player-background');
    if (backgroundSelect) {
        backgroundSelect.value = settings.playerBackground || 'blur';
    }
    applyPlayerBackground(settings.playerBackground || 'blur');

    // 逻辑页签设置
    const switchSearch = document.getElementById('setting-switch-playlist-search');
    if (switchSearch) {
        switchSearch.checked = settings.switchPlaylistOnSearchPlay !== false;
    }

    const switchSongList = document.getElementById('setting-switch-playlist-songlist');
    if (switchSongList) {
        switchSongList.checked = settings.switchPlaylistOnSongListPlay !== false;
    }

    const autoResume = document.getElementById('setting-auto-resume');
    if (autoResume) {
        autoResume.checked = settings.autoResume !== false;
    }

    const visOpacity = document.getElementById('setting-visualizer-opacity');
    const visOpacityVal = document.getElementById('visualizer-opacity-value');
    if (visOpacity) visOpacity.value = settings.visualizerOpacity || 0.5;
    if (visOpacityVal) visOpacityVal.innerText = settings.visualizerOpacity || 0.5;

    const showFooterVis = document.getElementById('setting-show-footer-visualizer');
    if (showFooterVis) showFooterVis.checked = settings.showFooterVisualizer !== false;

    const footerVisStyle = document.getElementById('setting-footer-visualizer-style');
    if (footerVisStyle) footerVisStyle.value = settings.footerVisualizerStyle || 'bars';

    const globalVisStyle = document.getElementById('setting-visualizer-global-style');
    if (globalVisStyle) globalVisStyle.value = settings.visualizerGlobalStyle || 'blocks';

    const showDetailVis = document.getElementById('setting-show-detail-visualizer');
    if (showDetailVis) showDetailVis.checked = settings.showDetailVisualizer !== false;

    const detailVisStyle = document.getElementById('setting-detail-visualizer-style');
    if (detailVisStyle) detailVisStyle.value = settings.detailVisualizerStyle || 'pulse';

    const showSidebar = document.getElementById('setting-show-sidebar-info');
    if (showSidebar) {
        showSidebar.checked = settings.showSidebarSongInfo !== false;

        // 初始应用
        const sidebarInfo = document.querySelector('.sidebar-song-info-wrapper');
        if (sidebarInfo) {
            if (settings.showSidebarSongInfo !== false) {
                sidebarInfo.classList.add('md:block');
            } else {
                sidebarInfo.classList.remove('md:block');
            }
        }
    }

    const crossfade = document.getElementById('setting-enable-crossfade');
    if (crossfade) {
        crossfade.checked = settings.enableCrossfade !== false;
    }

    const keepAwake = document.getElementById('setting-keep-screen-awake');
    if (keepAwake) {
        keepAwake.checked = settings.keepScreenAwake === true;
    }

    const shortcuts = document.getElementById('setting-enable-shortcuts');
    if (shortcuts) {
        shortcuts.checked = settings.enableKeyboardShortcuts !== false;
    }

    const lyricGlow = document.getElementById('setting-enable-lyric-glow');
    if (lyricGlow) {
        lyricGlow.checked = settings.enableLyricGlow !== false;
    }

    // 初始应用荧光效果
    const detailView = document.getElementById('view-player-detail');
    if (detailView) {
        if (settings.enableLyricGlow !== false) {
            detailView.classList.add('enable-lyric-glow');
        } else {
            detailView.classList.remove('enable-lyric-glow');
        }
    }

    // 歌词设置同步
    const lrcTrans = document.getElementById('setting-show-lyric-translation');
    if (lrcTrans) lrcTrans.checked = settings.showLyricTranslation !== false;

    const lrcRoma = document.getElementById('setting-show-lyric-roma');
    if (lrcRoma) lrcRoma.checked = settings.showLyricRoma === true;

    const lrcSwap = document.getElementById('setting-swap-lyric-trans-roma');
    if (lrcSwap) lrcSwap.checked = settings.swapLyricTransRoma === true;

    const autoCompact = document.getElementById('setting-auto-compact-playbar');
    if (autoCompact) autoCompact.checked = settings.autoCompactPlaybar !== false;

    const autoSkip = document.getElementById('setting-auto-skip-on-error');
    if (autoSkip) autoSkip.checked = settings.enableAutoSkipOnError !== false;

    const lyricCache = document.getElementById('setting-enable-lyric-cache');
    if (lyricCache) lyricCache.checked = settings.enableLyricCache !== false;

    const urlCache = document.getElementById('setting-enable-url-cache');
    if (urlCache) urlCache.checked = settings.enableSongUrlCache !== false;

    // Server Cache
    const serverCache = document.getElementById('setting-enable-server-cache');
    if (serverCache) serverCache.checked = settings.enableServerCache !== false;

    const serverLoc = document.getElementById('setting-server-cache-location');
    if (serverLoc) serverLoc.value = settings.serverCacheLocation || 'root';

    // 其他设置项同步 (如需扩展可以加在这里)
    const qualitySelect = document.getElementById('quality-select');
    if (qualitySelect) qualitySelect.value = settings.preferredQuality || '320k';

    const itemsPerPage = document.getElementById('items-per-page-select');
    if (itemsPerPage) itemsPerPage.value = settings.itemsPerPage || 20;

    // 更新存储统计
    updateStorageStatsUI();

    // 更新服务器缓存统计
    updateServerCacheSize();
}

/**
 * 应用播放页背景样式
 * @param {string} mode - 'blur', 'solid', 'dark'
 */
function applyPlayerBackground(mode) {
    const detailBg = document.getElementById('view-player-detail');
    const bgCover = document.getElementById('detail-bg-cover');
    const bgOverlay = document.getElementById('player-detail-bg-overlay');
    if (!detailBg || !bgCover || !bgOverlay) return;

    console.log(`[PlayerBackground] Applying style: ${mode}`);

    // 重置默认状态
    bgCover.style.display = 'block';
    bgOverlay.className = 'absolute inset-0 t-bg-panel/30 backdrop-blur-3xl';
    bgOverlay.style.backgroundColor = '';
    bgOverlay.style.backdropFilter = '';
    detailBg.style.backgroundColor = '';

    if (mode === 'solid') {
        bgCover.style.display = 'none';
        bgOverlay.className = 'absolute inset-0 t-bg-panel';
        bgOverlay.style.backdropFilter = 'none';
    } else if (mode === 'dark') {
        bgCover.style.display = 'none';
        bgOverlay.className = 'absolute inset-0';
        bgOverlay.style.backgroundColor = '#000000';
        bgOverlay.style.backdropFilter = 'none';
    }
    // 'blur' 模式由上面的重置逻辑处理
}

// ========== 缓存统计与重置逻辑 ==========

function calcStorageUsage() {
    let total = 0;
    for (let x in localStorage) {
        if (!localStorage.hasOwnProperty(x)) continue;
        const val = localStorage.getItem(x);
        total += (x.length + val.length) * 2; // UTF-16 characters are 2 bytes
    }
    // Convert to readable format
    if (total < 1024) return total + ' B';
    if (total < 1024 * 1024) return (total / 1024).toFixed(2) + ' KB';
    return (total / (1024 * 1024)).toFixed(2) + ' MB';
}

function updateStorageStatsUI() {
    const el = document.getElementById('storage-usage-info');
    if (el) {
        el.innerText = calcStorageUsage();
    }
}

async function resetAllSettings() {
    const ok = await showSelect('重置所有设置', '确定要重置吗？这不会删除您的歌单，但会恢复音质、列表显示、主题等设置到默认状态。', { danger: true });
    if (!ok) return;
    try {
        localStorage.removeItem('lx_settings');
        localStorage.removeItem('lx_playback_state'); // 同时重置播放进度记忆
        showSuccess('设置已重置，正在重新加载页面...');
        setTimeout(() => {
            window.location.reload();
        }, 1500);
    } catch (e) {
        showError('重置失败: ' + e.message);
    }
}

async function clearCache(type) {
    if (!(await showSelect('清除缓存', '确定要清除本地缓存吗？', { danger: true }))) return;

    let count = 0;
    const keysToRemove = [];

    for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        // [Fix] 统一使用 lx_lyric_ 和 lx_url_ 前缀进行清理
        if (type === 'lyric' && key.startsWith('lx_lyric_')) {
            keysToRemove.push(key);
        } else if (type === 'url' && key.startsWith('lx_url_')) {
            keysToRemove.push(key);
        }
    }

    keysToRemove.forEach(k => {
        localStorage.removeItem(k);
        count++;
    });

    updateStorageStatsUI();
    const mapFromName = { 'lyric': '歌词', 'url': '链接' };
    showSuccess(`已清除 ${count} 条${mapFromName[type] || ''}缓存`);
}

// 更新服务器缓存大小统计
async function updateServerCacheSize() {
    const infoEl = document.getElementById('server-cache-info');
    if (!infoEl) return;

    try {
        infoEl.textContent = '计算中...';
        infoEl.className = 'text-sm font-bold text-gray-500 t-bg-main px-2 py-1 rounded';

        const username = currentListData?.username || '';
        const headers = {};
        if (username) headers['x-user-name'] = username;
        const response = await fetch('/api/music/cache/stats', { headers });
        if (!response.ok) {
            throw new Error('获取缓存统计失败');
        }

        const data = await response.json();
        if (data.success) {
            // 格式化文件大小
            const size = data.data.totalSize;
            const count = data.data.fileCount;
            let sizeText = '';

            if (size >= 1024 * 1024 * 1024) {
                sizeText = (size / (1024 * 1024 * 1024)).toFixed(2) + ' GB';
            } else if (size >= 1024 * 1024) {
                sizeText = (size / (1024 * 1024)).toFixed(2) + ' MB';
            } else if (size >= 1024) {
                sizeText = (size / 1024).toFixed(2) + ' KB';
            } else {
                sizeText = size + ' B';
            }

            infoEl.textContent = `${sizeText} (${count} 首)`;
            infoEl.className = 'text-sm font-bold text-blue-600 bg-blue-50 px-2 py-1 rounded';
        } else {
            throw new Error(data.message || '未知错误');
        }
    } catch (e) {
        console.error('[Cache] 获取服务器缓存统计失败:', e);
        infoEl.textContent = '获取失败';
        infoEl.className = 'text-sm font-bold text-red-500 bg-red-50 px-2 py-1 rounded';
    }
}

// 清除服务器缓存
async function clearServerCache() {
    if (!(await showSelect('清除离线缓存', '确定要清除所有服务器缓存的歌曲文件吗？\n此操作不可恢复！', { danger: true }))) return;

    try {
        const username = currentListData?.username || '';
        const headers = {};
        if (username) headers['x-user-name'] = username;
        const response = await fetch('/api/music/cache/clear', {
            method: 'POST',
            headers: headers
        });

        if (!response.ok) {
            throw new Error('清除缓存失败');
        }

        const data = await response.json();
        if (data.success) {
            showSuccess(`清除成功！\n已删除 ${data.data.deletedCount} 个文件，释放 ${(data.data.freedSize / (1024 * 1024)).toFixed(2)} MB 空间`);
            updateServerCacheSize(); // 刷新统计
        } else {
            throw new Error(data.message || '未知错误');
        }
    } catch (e) {
        console.error('[Cache] 清除服务器缓存失败:', e);
        showError('清除失败: ' + e.message);
    }
}


// Expose functions to window for HTML access
window.switchTab = switchTab;
window.handleSearchKeyPress = handleSearchKeyPress;
window.doSearch = doSearch;
window.changePage = changePage;
window.handleHotSearchClick = handleHotSearchClick;
window.playSong = playSong;
window.togglePlay = togglePlay;
window.playNext = playNext;
window.changeProxyPlayback = changeProxyPlayback;
window.changeProxyDownload = changeProxyDownload;
window.resetAllSettings = resetAllSettings;
window.clearCache = clearCache;
window.updateServerCacheSize = updateServerCacheSize;
window.clearServerCache = clearServerCache;
window.playPrev = playPrev;
window.seek = seek;
window.changeLyricFontSize = changeLyricFontSize;
// 音量控制
window.setVolume = setVolume;
window.toggleMute = toggleMute;
// 播放模式
window.setPlayMode = setPlayMode;
// --- Lyrics & Detail View Logic ---

let currentLyricLines = [];
let isLyricViewOpen = false;
let currentLyricIndex = -1;
let wordAnimationId = null; // 用于逐词歌词动画
let lyricPlayer = null; // LinePlayer instance for parsing and syncing
let isUserScrolling = false; // 用户是否正在手动滚动
let scrollLockTimeout = null; // 滚动锁定计时器
let isProgrammaticScroll = false; // 标记是否为程序自动滚动
const SCROLL_LOCK_DURATION = 5000; // 5秒后解除锁定

function toggleLyrics() {
    isLyricViewOpen = !isLyricViewOpen;
    const view = document.getElementById('view-player-detail');

    if (isLyricViewOpen) {
        view.classList.remove('hidden');
        // Trigger reflow
        void view.offsetWidth;
        view.classList.remove('translate-y-[100%]', 'opacity-0');

        // 开始歌词按钮淡化倒计时
        startToggleLyricsBtnTimer();

        // Update UI
        if (currentPlayingSong) {
            updateDetailInfo(currentPlayingSong);
            // If no lyrics yet, try fetch
            if (currentLyricLines.length === 0) {
                fetchLyric(currentPlayingSong);
            }
            // 仅在音频正在播放时才启动歌词滚动，防止暂停时打开详情页歌词自走
            if (lyricPlayer && !audio.paused) {
                lyricPlayer.play(audio.currentTime * 1000);
            }
            setTimeout(() => scrollToActiveLine(true), 100);
        }

        // Notify visualizer to switch canvas
        setTimeout(() => {
            if (window.musicVisualizer) window.musicVisualizer.applySettings();
        }, 300);

        // 如果开启了自动精简，且在手机端进入详情页，则自动精简
        if (settings.autoCompactPlaybar !== false && window.innerWidth < 768) {
            window.setCompactPlaybar(true);
        }
    } else {
        view.classList.add('translate-y-[100%]', 'opacity-0');
        setTimeout(() => {
            view.classList.add('hidden');
            // Notify visualizer to switch back to footer
            if (window.musicVisualizer) window.musicVisualizer.applySettings();
        }, 600); // match transition duration

        // 关闭详情页自动展开控制栏
        if (settings.autoCompactPlaybar !== false && window.innerWidth < 768) {
            window.setCompactPlaybar(false);
        }
    }
}

function updateDetailInfo(song) {
    document.getElementById('detail-title').innerText = song.name;
    document.getElementById('detail-artist').innerText = song.singer;
    const imgUrl = getImgUrl(song);
    // Use high res image if possible or same URL
    document.getElementById('detail-cover').src = imgUrl; // Need bigger res?
    document.getElementById('detail-bg-cover').src = imgUrl;
}

async function fetchLyric(song) {
    if (!song) {
        return;
    }

    // 支持两种数据结构:
    // 1. 搜索结果: song.songmid, song.source 在顶层
    // 2. 收藏列表: song.songmid, song.source 可能在 meta 中
    // 3. 不同平台字段名差异: songmid vs songId
    let songmid = song.songmid || song.songId;
    let source = song.source;

    // 如果顶层没有,尝试从 meta 中获取
    if (!songmid && song.meta) {
        songmid = song.meta.songmid || song.meta.songId;
    }
    if (!source && song.meta) {
        source = song.meta.source;
    }

    // 如果还是没有必要的数据,退出
    if (!songmid || !source) {
        console.warn('[Lyric] 歌曲缺少必要的字段 songmid/songId 或 source:', song);
        return;
    }

    document.getElementById('lyric-content').innerHTML = '<p class="t-text-muted text-lg animate-pulse">正在加载歌词...</p>';
    currentLyricLines = [];

    // ===== 尝试读取缓存 =====
    const cacheKey = `lx_lyric_${source}_${songmid}`;
    if (settings.enableLyricCache !== false) {
        try {
            const cached = localStorage.getItem(cacheKey);
            if (cached) {
                const data = JSON.parse(cached);
                currentRawLrc = data.lrc || '';
                currentRawTlrc = data.tlyric || '';
                currentRawRlrc = data.rlyric || '';
                currentRawKlrc = data.klyric || data.lxlyric || '';

                console.log(`[Lyric] 使用缓存歌词: ${source}_${songmid}`, {
                    hasLrc: !!currentRawLrc,
                    hasTlrc: !!currentRawTlrc,
                    hasRlrc: !!currentRawRlrc,
                    hasKlyric: !!currentRawKlrc
                });

                // Initialize logic
                initLyricPlayer();
                applyLyricUpdate();
                return; // 命中缓存，直接返回
            }
        } catch (e) {
            console.warn('[Lyric] 读取缓存失败:', e);
            localStorage.removeItem(cacheKey); // 清除损坏的缓存
        }
    }

    try {
        // 构建完整的URL参数，包含酷狗和咪咕所需的所有字段
        // KuGou (kg) needs: name, hash, interval
        // MiGu (mg) needs: copyrightId, lrcUrl, mrcUrl, trcUrl (优先，避免调用getMusicInfo API)
        const params = new URLSearchParams({
            source,
            songmid,
            name: song.name || song.songname || '',
            singer: song.singer || song.singername || '',
            hash: song.hash || '',
            interval: song.interval || song.duration || '',
            copyrightId: song.copyrightId || '',
            albumId: song.albumId || '',
            lrcUrl: song.lrcUrl || '',
            mrcUrl: song.mrcUrl || '',
            trcUrl: song.trcUrl || ''
        });

        const url = `${API_BASE}/lyric?${params.toString()}`;

        const headers = {};
        if (typeof authToken !== 'undefined' && authToken) headers['x-user-token'] = authToken;
        if (typeof currentListData !== 'undefined' && currentListData && currentListData.username) headers['x-user-name'] = currentListData.username;

        const res = await fetch(url, { headers });

        if (!res.ok) {
            throw new Error(`Fetch lyric failed: ${res.status}`);
        }

        const data = await res.json();
        currentRawLrc = data.lyric || data.lrc || '';
        currentRawTlrc = data.tlyric || '';
        currentRawRlrc = data.rlyric || '';
        currentRawKlrc = data.klyric || data.lxlyric || '';

        console.log(`[Lyric] 获取到网络歌词:`, {
            source: source,
            songmid: songmid,
            hasLrc: !!currentRawLrc,
            hasTlrc: !!currentRawTlrc,
            hasRlrc: !!currentRawRlrc,
            hasKlyric: !!currentRawKlrc,
            dataKeys: Object.keys(data)
        });

        // ===== 写入缓存 =====
        if (settings.enableLyricCache !== false && currentRawLrc) {
            try {
                const cacheData = {
                    lrc: currentRawLrc,
                    tlyric: currentRawTlrc,
                    rlyric: currentRawRlrc,
                    klyric: currentRawKlrc
                };
                localStorage.setItem(cacheKey, JSON.stringify(cacheData));
                updateStorageStatsUI();
            } catch (e) {
                console.warn('[Lyric] 写入缓存失败 (可能空间已满):', e);
            }
        }

        if (!currentRawLrc) {
            renderLyric([]);
            return;
        }

        // Initialize LinePlayer
        initLyricPlayer();
        applyLyricUpdate();

    } catch (e) {
        console.error('[Lyric] Failed:', e);
        renderLyric([], '暂无歌词');
    }
}

// 辅助函数：根据当前设置应用歌词更新
function applyLyricUpdate() {
    if (!lyricPlayer || !currentRawLrc) return;

    const extendedLyrics = [];
    const showTrans = settings.showLyricTranslation !== false;
    const showRoma = settings.showLyricRoma === true;
    const isSwap = settings.swapLyricTransRoma === true;

    if (showTrans && currentRawTlrc && showRoma && currentRawRlrc) {
        if (isSwap) {
            extendedLyrics.push(currentRawRlrc);
            extendedLyrics.push(currentRawTlrc);
        } else {
            extendedLyrics.push(currentRawTlrc);
            extendedLyrics.push(currentRawRlrc);
        }
    } else if (showTrans && currentRawTlrc) {
        extendedLyrics.push(currentRawTlrc);
    } else if (showRoma && currentRawRlrc) {
        extendedLyrics.push(currentRawRlrc);
    }

    // 优先使用逐字歌词 (klyric/lxlyric)，如果不存在则使用普通歌词
    const mainLyric = currentRawKlrc || currentRawLrc;
    lyricPlayer.setLyric(mainLyric, extendedLyrics);

    // [Fix] 仅在音频真正播放时才启动歌词滚动
    if (!audio.paused) {
        lyricPlayer.play(audio.currentTime * 1000);
    } else {
        lyricPlayer.pause(); // 确保强制同步到暂停状态
    }
}

// 辅助函数：初始化歌词播放器
function initLyricPlayer() {
    if (!window.LinePlayer) {
        console.error('[Lyric] LinePlayer not loaded');
        return;
    }

    if (!lyricPlayer) {
        lyricPlayer = new window.LinePlayer({
            offset: 0,
            rate: currentPlaybackRate || 1,
            onPlay: (lineNum, text, curTime) => {
                syncLyricByLineNum(lineNum);
            },
            onSetLyric: (lines, offset) => {
                currentLyricLines = lines;
                window.currentLyricLines = lines; // expose for lyric-card.js
                renderLyric(lines);
            }
        });
    }
}

// Helper function to calculate lyric offset (Center Line)
function getLyricOffset() {
    const containerBox = document.getElementById('lyric-container');
    if (!containerBox) return 0;

    // 无论桌面还是移动端，显示还是隐藏封面，统一使用固定比例参考线
    // 这样可以保证指示器(indicator)高度在切换模式时保持绝对稳定
    const footer = document.getElementById('player-footer');
    const isFooterHidden = footer && footer.classList.contains('translate-y-[110%]');

    // 使用 0.35 作为黄金分割参考线位置 [lyric-scroll-indicator]
    const ratio = isFooterHidden ? 0.25 : 0.25;
    return containerBox.clientHeight * ratio;
}

// Helper to scroll to active line
function scrollToActiveLine(force = false) {
    if (isUserScrolling && !force) return;

    const containerBox = document.getElementById('lyric-container');
    const lyricContent = document.getElementById('lyric-content');
    if (!containerBox || !lyricContent) return;

    const lines = lyricContent.children;
    if (lines.length === 0) return;

    // Use currentLyricIndex, default to 0 if invalid
    let targetIndex = currentLyricIndex;
    if (targetIndex < 0 || targetIndex >= lines.length) targetIndex = 0;

    const currentLine = lines[targetIndex];
    if (!currentLine) return;

    const lineTop = currentLine.offsetTop;

    // 计算目标参考线位置
    const offsetInContainer = getLyricOffset();

    const targetScroll = lineTop - offsetInContainer;

    // 标记为程序滚动
    isProgrammaticScroll = true;

    // Clear any existing forced cleanup timer
    if (window.programmaticScrollTimer) clearTimeout(window.programmaticScrollTimer);

    containerBox.scrollTo({
        top: targetScroll,
        behavior: 'smooth'
    });

    // 1500ms 后清除标记 (给予平滑滚动足够的时间)
    window.programmaticScrollTimer = setTimeout(() => {
        isProgrammaticScroll = false;
        window.programmaticScrollTimer = null;
    }, 1500);
}

// Sync lyric by line number (called by LinePlayer)
function syncLyricByLineNum(lineNum) {
    // Always update the highlight classes regardless of scroll
    const container = document.getElementById('lyric-content');
    if (!container) return;

    const lines = container.children;

    // Check if index actually changed to update classes
    if (lineNum !== currentLyricIndex) {
        currentLyricIndex = lineNum;
        window.currentLyricIndex = lineNum;   // expose for lyric-card.js
        window.currentLyricLines = currentLyricLines; // expose for lyric-card.js

        // Remove active class from previous line
        const prev = container.querySelector('.active');
        if (prev) prev.classList.remove('active');

        // Add active class to current line
        if (lineNum >= 0 && lineNum < lines.length) {
            lines[lineNum].classList.add('active');
        }
    }

    // 仅在正在播放且有逐字歌词时，才启动动画循环
    if (wordAnimationId) cancelAnimationFrame(wordAnimationId);
    if (!audio.paused && lineNum >= 0 && lineNum < lines.length) {
        const lineData = currentLyricLines[lineNum];
        if (lineData && lineData.words && lineData.words.length > 0) {
            startWordProgressUpdate(lineNum, lines[lineNum], lineData);
        }
    }

    // Perform scroll (scrollToActiveLine handles isUserScrolling check)
    scrollToActiveLine();
}

/**
 * 启动逐字动画更新循环 (仅针对有逐字数据的行)
 */
function startWordProgressUpdate(lineIndex, lineEl, lineData) {
    const wordSpans = lineEl.querySelectorAll('.word-item');
    if (!wordSpans.length) return;

    const lineStartTime = lineData.time;

    // 获取该行最后一个字结束的真实时长作为整行时长
    let lineDuration = 5000;
    const lastWord = lineData.words[lineData.words.length - 1];
    if (lastWord) {
        lineDuration = lastWord.startTime + lastWord.duration;
    }
    if (lineDuration <= 0) lineDuration = 5000;

    // 提前计算本行所有字的总演唱时长，用于翻译进度的精准映射
    let totalWordsDuration = 0;
    wordSpans.forEach(span => {
        totalWordsDuration += parseInt(span.dataset.duration) || 0;
    });

    function update() {
        // 如果当前播放行已改变，或音频暂停，停止动画
        if (currentLyricIndex !== lineIndex || audio.paused) {
            return;
        }

        const curTimeMs = audio.currentTime * 1000;
        const relativeTime = curTimeMs - lineStartTime;

        let sungDuration = 0;

        // 2. 更新逐字进度
        wordSpans.forEach(span => {
            const start = parseInt(span.dataset.start);
            const duration = parseInt(span.dataset.duration);

            if (relativeTime >= start + duration) {
                // 已播放完
                sungDuration += duration;
                span.style.setProperty('--word-progress', '100%');
                span.classList.add('passed');
                span.classList.remove('playing');
            } else if (relativeTime >= start) {
                // 正在播放中
                sungDuration += (relativeTime - start);
                const progress = Math.min(100, Math.max(0, ((relativeTime - start) / duration) * 100));
                span.style.setProperty('--word-progress', `${progress}%`);
                span.classList.add('playing');
                span.classList.remove('passed');
            } else {
                // 尚未播放
                span.style.setProperty('--word-progress', '0%');
                span.classList.remove('passed', 'playing');
            }
        });

        // 1. 更新整行进度 (用于带有逐字数据的翻译/罗马音平滑扫过)
        // 通过 实际已唱时长 / 总发声时长，实现翻译和原词进度严丝合缝对齐，消除"晚来早走"现象
        const lineProgress = totalWordsDuration > 0 ? (sungDuration / totalWordsDuration) * 100 : Math.min(100, Math.max(0, (relativeTime / lineDuration) * 100));
        lineEl.style.setProperty('--line-progress', `${lineProgress}%`);

        // 2. 更新扩展歌词逐字类 (翻译/罗马音) - 实现与主词同步的平滑“染色”
        const extSpans = lineEl.querySelectorAll('.extended');
        extSpans.forEach(ext => {
            const items = ext.querySelectorAll('.ext-item');
            const itemCount = items.length;
            if (itemCount > 0) {
                const perItemWeight = 100 / itemCount;
                items.forEach((item, idx) => {
                    const itemStart = idx * perItemWeight;
                    const itemEnd = (idx + 1) * perItemWeight;

                    if (lineProgress >= itemEnd) {
                        item.style.setProperty('--word-progress', '100%');
                        item.classList.add('passed');
                        item.classList.remove('playing');
                    } else if (lineProgress >= itemStart) {
                        // 正在该字符/单词内平滑填充
                        const progress = ((lineProgress - itemStart) / perItemWeight) * 100;
                        item.style.setProperty('--word-progress', `${progress}%`);
                        item.classList.add('playing');
                        item.classList.remove('passed');
                    } else {
                        item.style.setProperty('--word-progress', '0%');
                        item.classList.remove('passed', 'playing');
                    }
                });
            }
        });

        wordAnimationId = requestAnimationFrame(update);
    }

    wordAnimationId = requestAnimationFrame(update);
}

// 节流函数
let scrollThrottleTimer = null;

// 用户手动滚动歌词
function handleLyricScroll() {
    // 忽略程序自动滚动
    if (isProgrammaticScroll) {
        return;
    }

    // 标记用户正在滚动
    isUserScrolling = true;

    // 显示指示器
    const indicator = document.getElementById('lyric-scroll-indicator');
    const container = document.getElementById('lyric-container');
    if (indicator && container) {
        // [Fix] 每次显示时动态更新高度，确保与自动滚动对齐点一致
        // indicator 是绝对定位在 lyrics-wrapper 内 (父容器)
        // offset 是相对于 lyric-container 顶部的距离 (子容器)
        // lyric-container 顶部可能有 Title 占据空间，因此需要加上 container.offsetTop
        const offset = getLyricOffset();
        indicator.style.top = `${container.offsetTop + offset}px`;

        indicator.classList.remove('hidden');
        indicator.style.display = 'flex';
    }

    // 清除之前的计时器
    if (scrollLockTimeout) {
        clearTimeout(scrollLockTimeout);
    }

    // 优化：如果有正在等待的帧，直接返回，不重复计算 (Leading throttle behavior)
    if (scrollThrottleTimer) {
        return;
    }

    // 使用 requestAnimationFrame 实时更新（约16ms一次，流畅无延迟）
    scrollThrottleTimer = requestAnimationFrame(() => {
        updateScrollIndicator();
        scrollThrottleTimer = null;
    });

    // 5秒后恢复自动滚动并隐藏指示器
    scrollLockTimeout = setTimeout(() => {
        isUserScrolling = false;
        scrollLockTimeout = null;

        // 隐藏指示器
        if (indicator) {
            indicator.classList.add('hidden');
            indicator.style.display = 'none';
        }

        // 清除滚动目标高亮
        const lyricContent = document.getElementById('lyric-content');
        if (lyricContent) {
            const lines = lyricContent.children;
            for (let i = 0; i < lines.length; i++) {
                lines[i].classList.remove('scroll-target');
            }
        }

        // 恢复后立即同步到当前播放位置
        if (lyricPlayer && !audio.paused) {
            // 确保内部状态同步
            lyricPlayer.play(audio.currentTime * 1000);
        }

        // [Fix] 立即滚动回当前歌词，不等待下一句更新
        scrollToActiveLine(true);

    }, SCROLL_LOCK_DURATION);
}

// 更新滚动指示器（显示当前对准的歌词时间）
function updateScrollIndicator() {
    const container = document.getElementById('lyric-container');
    const indicator = document.getElementById('lyric-scroll-indicator');
    const lyricContent = document.getElementById('lyric-content');

    // 如果不在滚动状态，清除所有高亮并返回
    if (!container || !indicator || !lyricContent || !isUserScrolling) {
        if (lyricContent) {
            const lines = lyricContent.children;
            for (let i = 0; i < lines.length; i++) {
                lines[i].classList.remove('scroll-target');
            }
        }
        return;
    }


    // [Refactor] 虚线位置已在 handleLyricScroll 中动态设置，这里不再需要一次性初始化
    // 且现在完全依赖 getLyricOffset() 保证位置统一

    // 直接获取虚线的实际屏幕位置
    const indicatorRect = indicator.getBoundingClientRect();
    const referenceY = indicatorRect.top + indicatorRect.height / 2;

    const lines = lyricContent.children;
    let overlapIndex = -1;
    let closestIndex = -1;
    let minDist = Infinity;

    // 遍历查找重叠或最近的歌词行
    // 改为纯几何碰撞检测，比 elementFromPoint 更可靠
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const rect = line.getBoundingClientRect();

        // 1. 检查是否重叠 (Green line inside the rect)
        if (referenceY >= rect.top && referenceY <= rect.bottom) {
            overlapIndex = i;
        }

        // 2. 检查距离 (Fallback)
        const center = rect.top + rect.height / 2;
        const dist = Math.abs(center - referenceY);
        if (dist < minDist) {
            minDist = dist;
            closestIndex = i;
        }
    }

    // 优先使用重叠的行，其次使用距离最近的行
    const targetIndex = overlapIndex !== -1 ? overlapIndex : closestIndex;

    let targetTime = 0;
    if (targetIndex !== -1 && lines[targetIndex]) {
        targetTime = parseFloat(lines[targetIndex].dataset.time) / 1000;
    }

    // 高亮对应的歌词行
    for (let i = 0; i < lines.length; i++) {
        if (i === targetIndex) {
            lines[i].classList.add('scroll-target');
        } else {
            lines[i].classList.remove('scroll-target');
        }
    }

    // 更新时间显示
    const timeDisplay = indicator.querySelector('.time-display');
    if (timeDisplay && targetTime > 0) {
        const minutes = Math.floor(targetTime / 60);
        const seconds = Math.floor(targetTime % 60);
        timeDisplay.textContent = `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
    }
}

// renderLyric function - generates DOM elements for each lyric line
function renderLyric(lines, emptyMsg = '暂无歌词') {
    const container = document.getElementById('lyric-content');
    container.innerHTML = '';

    if (lines.length === 0) {
        container.innerHTML = `<p class="t-text-muted text-lg font-medium">${emptyMsg}</p>`;
        return;
    }

    // 根据设置决定是否开启荧光效果
    if (settings.enableLyricGlow !== false) {
        container.classList.add('enable-lyric-glow');
    } else {
        container.classList.remove('enable-lyric-glow');
    }

    // Create fragment for better performance
    const frag = document.createDocumentFragment();

    lines.forEach((line, idx) => {
        const div = document.createElement('div');
        div.className = `lyric-line relative py-2 px-1 text-center md:text-left transition-all duration-300`;
        div.dataset.time = line.time;
        div.dataset.index = idx;

        // Click to seek
        div.onclick = () => {
            // line.time 是毫秒，audio.currentTime 需要秒
            audio.currentTime = line.time / 1000;

            // 立即更新 UI 高亮和位置，提供即时反馈
            syncLyricByLineNum(idx);
            scrollToActiveLine(true);

            // 解除滚动锁定
            isUserScrolling = false;
            if (scrollLockTimeout) {
                clearTimeout(scrollLockTimeout);
                scrollLockTimeout = null;
            }

            // 隐藏指示器
            const indicator = document.getElementById('lyric-scroll-indicator');
            if (indicator) {
                indicator.classList.add('hidden');
                indicator.style.display = 'none';
            }

            // [Fix] 清除所有的高亮样式 (scroll-target)
            const allLines = document.querySelectorAll('.lyric-line');
            allLines.forEach(l => l.classList.remove('scroll-target'));


        };

        // Inner content wrapper
        const contentDiv = document.createElement('div');
        contentDiv.className = 'line-content';

        // Main lyric text
        const span = document.createElement('span');
        span.className = 'font-lrc text-gray-500 transition-all block w-fit mx-auto md:ml-0';

        if (line.words && line.words.length > 0) {
            div.classList.add('has-words');
            line.words.forEach(word => {
                const wordSpan = document.createElement('span');
                wordSpan.className = 'word-item';
                wordSpan.textContent = word.text;
                wordSpan.dataset.start = word.startTime;
                wordSpan.dataset.duration = word.duration;
                span.appendChild(wordSpan);
            });
        } else {
            span.textContent = line.text;
            span.classList.add('plain-lyric');
        }

        contentDiv.appendChild(span);

        // Extended Lyrics (Translation, Romanization, etc.)
        if (line.extendedLyrics && line.extendedLyrics.length > 0) {
            line.extendedLyrics.forEach(extText => {
                if (!extText) return;
                const extSpan = document.createElement('span');
                extSpan.className = 'extended t-text-muted block w-fit mx-auto md:ml-0';

                // 逐字/逐字符拆分：中日韩按字符，其他按空格
                const hasCJK = /[\u4e00-\u9fa5]|[\u3040-\u309f]|[\u30a0-\u30ff]/.test(extText);
                const segments = hasCJK ? extText.split('') : extText.split(/(\s+)/).filter(s => s.length > 0);

                segments.forEach(seg => {
                    const s = document.createElement('span');
                    s.className = 'ext-item';
                    s.textContent = seg;
                    extSpan.appendChild(s);
                });

                contentDiv.appendChild(extSpan);
            });
        }

        div.appendChild(contentDiv);
        frag.appendChild(div);
    });

    container.appendChild(frag);

    // [Fix] Ensure we are in auto-scroll mode and centered on load
    isUserScrolling = false;

    // If audio is already playing, sync the player immediately to highlight the right line
    if (lyricPlayer && !audio.paused) {
        lyricPlayer.play(audio.currentTime * 1000);
    }

    // Force a scroll update after a short delay to ensure layout is ready
    setTimeout(() => {
        scrollToActiveLine(true);
    }, 100);
}


// syncLyric removed - LinePlayer handles all syncing via syncLyricByLineNum callback
// Audio timeupdate listener removed - LinePlayer automatically syncs lyrics

// Hook into PlaySong to clear/fetch lyrics
const originalPlaySong = window.playSong;
// We need to intercept playSong call in some way or just update playSong function?
// Since I can't override const declared in file easily without redefining,
// I will just modify the `playSong` function inside `app.js` using replace, OR
// I can just rely on `updatePlayerInfo` which is called by `playSong`.

// Let's modify `updatePlayerInfo` to also trigger generic 'song changed' event logic?
// No, I'll modify `playSong` via Replace.
// Wait, I can't easily replace the whole `playSong` as it's big.
// I will just Hook into `updatePlayerInfo` as it is called when song starts.
// Actually `updatePlayerInfo` is perfect.

const _originalUpdatePlayerInfo = updatePlayerInfo;
updatePlayerInfo = function (song) {
    _originalUpdatePlayerInfo(song);
    // Detail View update
    updateDetailInfo(song);
    // Fetch lyrics
    fetchLyric(song);
};

window.toggleLyrics = toggleLyrics;

// Initial
console.log('App.js loaded successfully');

// Initialize Favorites as hidden (collapsed)
const favList = document.getElementById('favorites-children');
if (favList) {
    favList.style.height = '0px';
    // favList.classList.add('hidden'); // using height transition instead
}

function toggleFavorites() {
    const list = document.getElementById('favorites-children');
    const arrow = document.getElementById('favorites-arrow');

    // Toggle logic
    if (list.style.height === '0px' || list.style.height === '') {
        list.style.height = 'auto'; // Estimate or auto
        list.style.height = list.scrollHeight + 'px'; // Smooth transition
        arrow.style.transform = 'rotate(0deg)'; // Arrow down
    } else {
        list.style.height = '0px';
        arrow.style.transform = 'rotate(-90deg)'; // Arrow right
    }
}

// Initial rotate for collapsed state
const favArrow = document.getElementById('favorites-arrow');
if (favArrow) favArrow.style.transform = 'rotate(-90deg)';


// Link SyncManager from user_sync.js
// Link SyncManager from user_sync.js
const syncManager = window.SyncManager;
let currentListData = null;
let syncModeResolve = null;

function switchSyncMode(mode) {
    const btnLocal = document.getElementById('btn-mode-local');
    const btnRemote = document.getElementById('btn-mode-remote');
    const formLocal = document.getElementById('sync-form-local');
    const formRemote = document.getElementById('sync-form-remote');

    if (mode === 'local') {
        btnLocal.className = "px-4 py-2 rounded-lg text-sm font-medium bg-emerald-100 text-emerald-700 ring-2 ring-emerald-500 transition-all";
        btnRemote.className = "px-4 py-2 rounded-lg text-sm font-medium bg-gray-100 t-text-muted hover:bg-gray-200 transition-all";
        formLocal.classList.remove('hidden');
        formRemote.classList.add('hidden');
    } else {
        btnLocal.className = "px-4 py-2 rounded-lg text-sm font-medium bg-gray-100 t-text-muted hover:bg-gray-200 transition-all";
        btnRemote.className = "px-4 py-2 rounded-lg text-sm font-medium bg-blue-100 text-blue-700 ring-2 ring-blue-500 transition-all";
        formLocal.classList.add('hidden');
        formRemote.classList.remove('hidden');
        // Reset Remote Flow
        handleRemoteBack();
    }
}

async function handleLocalLogin() {
    const user = document.getElementById('sync-local-user').value;
    const pass = document.getElementById('sync-local-pass').value;
    const statusEl = document.getElementById('sync-status');

    if (!user || !pass) {
        showError('请输入用户名和密码');
        return;
    }

    statusEl.innerHTML = '<i class="fas fa-spinner fa-spin text-emerald-500"></i> 正在登录...';

    try {
        syncManager.initLocal(user, pass);
        const success = await syncManager.client.login();

        if (success) {
            statusEl.innerHTML = '<i class="fas fa-check-circle text-emerald-500"></i> 登录成功，正在同步...';
            // Fetch List
            const listData = await syncManager.sync();
            currentListData = listData;
            if (currentListData) currentListData.username = user; // Attach username
            renderMyLists(listData);

            // [Cache] Save list data immediately for offline availability / quick load
            localStorage.setItem('lx_list_data', JSON.stringify(listData));

            statusEl.innerHTML = `<i class="fas fa-check-circle text-emerald-500"></i> 已同步 (用户: ${user})`;
            // Save credentials to localStorage (Simple version)
            localStorage.setItem('lx_sync_mode', 'local'); // [Fix] Save mode
            localStorage.setItem('lx_sync_user', user);
            localStorage.setItem('lx_sync_pass', pass);
        } else {
            statusEl.innerHTML = '<i class="fas fa-times-circle text-red-500"></i> 登录失败: 用户名或密码错误';
        }
    } catch (e) {
        statusEl.innerHTML = `<i class="fas fa-exclamation-circle text-red-500"></i> 错误: ${e.message}`;
    }
}

function showSyncModeModal() {
    const modal = document.getElementById('sync-auth-modal');
    modal.classList.remove('hidden');
    modal.classList.add('flex');
    document.getElementById('sync-connect-form').classList.add('hidden');
    document.getElementById('sync-mode-selection').classList.remove('hidden');
}


function closeSyncModal() {
    const modal = document.getElementById('sync-auth-modal');
    modal.classList.add('hidden');
    modal.classList.remove('flex');
    // Reset views
    document.getElementById('sync-connect-form').classList.remove('hidden');
    document.getElementById('sync-mode-selection').classList.add('hidden');

    if (syncModeResolve) {
        syncModeResolve('cancel');
        syncModeResolve = null;
    }
}

function selectSyncMode(mode) {
    const fullOverwrite = document.getElementById('sync-full-overwrite').checked;
    if (fullOverwrite && mode.startsWith('overwrite')) {
        mode += '_full';
    }

    if (syncModeResolve) {
        syncModeResolve(mode);
        syncModeResolve = null;
    }
    closeSyncModal();
}

function cancelSyncMode() {
    if (syncModeResolve) {
        syncModeResolve('cancel');
        syncModeResolve = null;
    }
    closeSyncModal();
}

function handleRemoteStep1() {
    const url = document.getElementById('sync-remote-url').value.trim();
    if (!url) {
        showError('请输入链接地址');
        return;
    }
    // Basic validation
    if (!url.match(/^(ws|http)s?:\/\//)) {
        showError('链接格式错误，应以 http://, https://, ws:// 或 wss:// 开头');
        return;
    }

    document.getElementById('sync-remote-step1').classList.add('hidden');
    document.getElementById('sync-remote-step2').classList.remove('hidden');
}

function handleRemoteBack() {
    document.getElementById('sync-remote-step1').classList.remove('hidden');
    document.getElementById('sync-remote-step2').classList.add('hidden');
    document.getElementById('sync-remote-code').value = ''; // Optional clear
}

function handleRemoteConnect() {
    const url = document.getElementById('sync-remote-url').value;
    const code = document.getElementById('sync-remote-code').value;
    const statusEl = document.getElementById('sync-status');

    if (!code) {
        showError('请输入连接码');
        return;
    }

    statusEl.innerHTML = '<i class="fas fa-spinner fa-spin text-blue-500"></i> 正在连接远程服务器...';

    try {
        syncManager.initRemote(url, code, {
            getData: async () => {
                // Try to load from cache first
                const cached = localStorage.getItem('lx_list_data');
                if (cached) {
                    try {
                        const data = JSON.parse(cached);
                        console.log('[Cache] 从缓存加载列表数据');
                        return data;
                    } catch (e) {
                        console.error('[Cache] 解析缓存失败:', e);
                    }
                }
                return currentListData || { defaultList: [], loveList: [], userList: [] };
            },
            setData: async (data) => {
                console.log('[Sync] 远程数据已同步:', data);
                // Save to cache
                localStorage.setItem('lx_list_data', JSON.stringify(data));
                // Update global
                const oldUsername = currentListData ? currentListData.username : null;
                currentListData = data;
                if (oldUsername) currentListData.username = oldUsername; // Preserve username

                // Render UI
                renderMyLists(data);
                statusEl.innerHTML = '<i class="fas fa-check-circle text-blue-500"></i> 数据已同步';
            },
            getSyncMode: async () => {
                return new Promise((resolve) => {
                    syncModeResolve = resolve;
                    showSyncModeModal();
                });
            }
        });

        // Setup Callbacks
        syncManager.client.onLogin = async (success, msg) => {
            if (success) {
                statusEl.innerHTML = '<i class="fas fa-check-circle text-green-500"></i> 已连接 (等待同步...)';
                // Remove manual sync() call. Let the server drive the sync via RPC.

                // Save connection info and authInfo to localStorage
                localStorage.setItem('lx_sync_mode', 'remote');
                localStorage.setItem('lx_sync_url', url);
                localStorage.setItem('lx_sync_code', code);

                // Save authInfo for reconnection
                if (syncManager.client.authInfo) {
                    localStorage.setItem('lx_ws_auth', JSON.stringify(syncManager.client.authInfo));
                    console.log('[Cache] WS认证信息已保存');
                }
            } else {
                statusEl.innerHTML = `<i class="fas fa-times-circle text-red-500"></i> 连接失败: ${msg || '未知错误'}`;
            }
        };

        syncManager.client.connect();

    } catch (e) {
        statusEl.innerHTML = `<i class="fas fa-exclamation-circle text-red-500"></i> 错误: ${e.message}`;
    }
}

function renderMyLists(data) {
    const container = document.getElementById('my-lists-container');
    container.innerHTML = '';

    if (!data) return;

    // Helper to create list item
    const createItem = (listObj, name, icon, count) => {
        const id = typeof listObj === 'string' ? listObj : listObj.id;
        const div = document.createElement('div');
        div.className = "px-6 py-2 text-sm t-text-muted hover:t-bg-main cursor-pointer flex items-center group transition-colors overflow-hidden";
        div.setAttribute('data-sidebar-list-id', id);
        div.onclick = () => handleListClick(id);

        // Use createMarqueeHtml for list name
        const nameHtml = name.length > 8 ? createMarqueeHtml(name, 'flex-1') : `<span class="ml-2 flex-1 truncate">${name}</span>`;

        // Buttons logic (for collected external playlists)
        const showExternalOps = listObj && listObj.sourceListId && listObj.source;
        let opsHtml = '';
        if (showExternalOps) {
            opsHtml = `
                <i class="fas fa-sync-alt refresh-btn text-gray-400 hover:text-emerald-500 hidden group-hover:block flex-shrink-0 text-[10px] mr-2 transition-all active:rotate-180" 
                   title="更新歌单内容" 
                   onclick="event.stopPropagation(); handleRefreshList('${id}', event)"></i>
                <i class="fas fa-external-link-alt jump-btn text-gray-400 hover:text-emerald-500 hidden group-hover:block flex-shrink-0 text-[10px] mr-2 transition-all" 
                   title="打开原始歌单" 
                   onclick="event.stopPropagation(); handleJumpToOriginalList('${id}', event)"></i>
            `;
        }

        div.innerHTML = `
            ${opsHtml}
            <i class="fas ${icon} w-5 t-text-muted group-hover:text-emerald-500 transition-colors flex-shrink-0"></i>
            ${name.length > 8 ? `<div class="ml-2 flex-1 overflow-hidden">${nameHtml}</div>` : nameHtml}
            <span class="text-xs text-gray-300 group-hover:t-text-muted mr-2 flex-shrink-0">${count}</span>
            ${id !== 'default' && id !== 'love' ? `<i class="fas fa-trash text-gray-300 hover:text-red-500 hidden group-hover:block flex-shrink-0" onclick="handleRemoveList('${id}', event)"></i>` : ''}
        `;
        return div;
    };

    // Default List
    if (data.defaultList) {
        container.appendChild(createItem('default', '默认列表', 'fa-list', data.defaultList.length));
    }
    // Love List
    if (data.loveList) {
        container.appendChild(createItem('love', '我的收藏', 'fa-heart', data.loveList.length));
    }
    // User Lists
    if (data.userList) {
        data.userList.forEach(l => {
            const listLen = l.list ? l.list.length : 0;
            container.appendChild(createItem(l, l.name, 'fa-music', listLen));
        });
    }

    // [Resume] 处理本地列表的自动恢复跳转
    if (window._pendingResumeListId) {
        const listId = window._pendingResumeListId;
        delete window._pendingResumeListId;
        console.log('[Resume] 正在同步本地播放列表上下文:', listId);
        // 调用 handleListClick 以加载真实的列表数据并应用高亮
        handleListClick(listId);
    }
}

function handleListClick(listId) {
    if (!currentListData) return;

    // Mobile: Close sidebar when a list is selected
    if (window.innerWidth < 768) {
        const sidebar = document.getElementById('main-sidebar');
        // If sidebar is open (class removed), close it
        if (sidebar && !sidebar.classList.contains('-translate-x-full')) {
            toggleSidebar();
        }
    }

    // Set current viewing list ID for batch operations
    window.currentViewingListId = listId;
    currentSearchScope = 'local_list';

    let list = [];
    let title = '';

    if (listId === 'default') {
        list = currentListData.defaultList;
        title = '默认列表';
    } else if (listId === 'love') {
        list = currentListData.loveList;
        title = '我的收藏';
    } else {
        const uList = currentListData.userList.find(l => l.id === listId);
        if (uList) {
            list = uList.list;
            title = uList.name;
        }
    }

    // Switch to Search View (as List View)
    // Manually handle tab switch to avoid 'network' reset
    document.querySelectorAll('[id^="view-"]').forEach(el => el.classList.add('hidden'));
    const activeView = document.getElementById('view-search');
    activeView.classList.remove('hidden');
    setTimeout(() => {
        activeView.classList.remove('opacity-0');
        activeView.classList.add('opacity-100');
    }, 10);

    // UI Updates
    document.getElementById('page-title').innerText = title;
    document.getElementById('search-input').value = '';
    document.getElementById('search-input').placeholder = `在 ${title} 中搜索...`;

    // Set Scope
    currentSearchScope = 'local_list';
    document.getElementById('search-source').classList.add('hidden'); // Hide selector

    // Reset all tabs to muted, then highlight Favorites as the parent
    document.querySelectorAll('[id^="tab-"]').forEach(el => {
        el.classList.remove('active-tab', 'text-emerald-600');
        el.classList.add('t-text-muted');
    });
    const favTab = document.getElementById('tab-favorites');
    if (favTab) {
        favTab.classList.add('active-tab');
        favTab.classList.remove('t-text-muted');
    }

    // Highlight Child List
    document.querySelectorAll('[data-sidebar-list-id]').forEach(el => {
        el.classList.remove('active-sub-item');
        el.classList.add('t-text-muted');
    });
    const subItem = document.querySelector(`[data-sidebar-list-id="${listId}"]`);
    if (subItem) {
        subItem.classList.add('active-sub-item');
        subItem.classList.remove('t-text-muted');
    }

    // Render
    currentPage = 1; // Reset pagination
    renderResults(list);
}

function handleFavoritesClick() {
    toggleFavorites(); // Toggle folder dropdown in sidebar

    if (!currentListData) {
        // Not logged in, switch to the guidance view directly
        switchTab('favorites');
        document.getElementById('page-title').innerText = "我的收藏";
        return;
    }

    // Switch to Search View (Global Local)
    document.querySelectorAll('[id^="view-"]').forEach(el => el.classList.add('hidden'));
    const activeView = document.getElementById('view-search');
    activeView.classList.remove('hidden');
    setTimeout(() => activeView.classList.remove('opacity-0'), 10); // Simple fade

    // Highlight Header
    document.querySelectorAll('[id^="tab-"]').forEach(el => {
        el.classList.remove('active-tab', 'text-emerald-600');
        el.classList.add('t-text-muted');
    });
    const favTab = document.getElementById('tab-favorites');
    if (favTab) {
        favTab.classList.add('active-tab');
        favTab.classList.remove('t-text-muted');
    }

    // Always clear sub-item highlight when switching to "All Favorites"
    document.querySelectorAll('[data-sidebar-list-id]').forEach(el => {
        el.classList.remove('active-sub-item');
        el.classList.add('t-text-muted');
    });

    // UI Updates
    document.getElementById('page-title').innerText = "我的收藏 (全部)";
    document.getElementById('search-input').value = '';
    document.getElementById('search-input').placeholder = "搜索所有收藏...";
    document.getElementById('search-source').classList.add('hidden');

    // Set Scope
    currentSearchScope = 'local_all';

    // Collect all songs from Default, Love, and User Lists
    let allSongs = [];
    if (currentListData) {
        if (currentListData.defaultList) allSongs = allSongs.concat(currentListData.defaultList);
        if (currentListData.loveList) allSongs = allSongs.concat(currentListData.loveList);
        if (currentListData.userList) {
            currentListData.userList.forEach(l => {
                if (l.list) allSongs = allSongs.concat(l.list);
            });
        }
    }

    // Deduplicate by song ID
    const uniqueSongs = [];
    const seenIds = new Set();
    allSongs.forEach(s => {
        if (s && s.id && !seenIds.has(s.id)) {
            seenIds.add(s.id);
            uniqueSongs.push(s);
        }
    });

    // Update render
    currentPage = 1;
    renderResults(uniqueSongs);
}

async function handleCreateList() {
    const name = await showInput("新建歌单", "请输入新歌单的名称：", {
        placeholder: "歌单名称"
    });

    if (name && currentListData) {
        const newList = {
            id: 'webplayer_' + Date.now(),
            name: name,
            source: 'webplayer',
            list: []
        };
        currentListData.userList.push(newList);
        // Sync
        try {
            await pushDataChange();
            renderMyLists(currentListData);
            // Re-render the add modal grid if it is open (or just to keep it fresh)
            if (typeof renderPlaylistAddGrid === 'function') {
                renderPlaylistAddGrid();
            }
            showSuccess('歌单创建成功');
        } catch (e) {
            console.error('Create list failed:', e);
            showError('创建失败，请重试');
        }
    }
}

function formatSongToLxMusicStandard(item) {
    if (!item) return item;
    const s = JSON.parse(JSON.stringify(item));

    // 获取封面地址 (兼容各种 SDK 原始字段和 meta 字段)
    const picUrl = s.img || s.pic || s.picUrl ||
        (s.meta && (s.meta.picUrl || s.meta.img || s.meta.pic)) ||
        (s.album && (s.album.picUrl || s.album.img)) ||
        (s.al && s.al.picUrl) || null;

    // 如果已经包含合法的 meta 且有 songId，且 ID 符合规范，可能是已格式化的
    if (s.meta && s.meta.songId && s.id && (String(s.id).includes('_') || s.source === 'mg')) {
        // 确保 picUrl 存在
        if (!s.meta.picUrl && picUrl) s.meta.picUrl = picUrl;
        return s;
    }

    const source = s.source || '';
    const songmid = s.songmid || s.id || '';

    // 1. 提取核心元数据
    const albumName = s.albumName ||
        (s.album && s.album.name) ||
        (s.al && s.al.name) ||
        (s.meta && s.meta.albumName) || '';

    const albumId = s.albumId ||
        (s.album && s.album.id) ||
        (s.al && s.al.id) ||
        (s.meta && s.meta.albumId) || null;

    // 2. 构造干净的 meta 对象（只保留标准字段）
    let meta = {
        songId: String(songmid),
        albumName: albumName,
        picUrl: picUrl,
        qualitys: s.qualitys || s.types || (s.meta && (s.meta.qualitys || s.meta.types)) || [],
        _qualitys: s._qualitys || s._types || (s.meta && (s.meta._qualitys || s.meta._types)) || {}
    };

    if (albumId) meta.albumId = String(albumId);

    // 3. 构造标准 root 对象
    const rootItem = {
        name: s.name || '',
        singer: s.singer || '',
        source: source,
        interval: s.interval || s.time || '',
        meta: meta
    };

    // 4. 针对各平台源的特殊 ID 处理
    switch (source) {
        case 'tx':
            if (s.strMediaMid || (s.meta && s.meta.strMediaMid))
                meta.strMediaMid = s.strMediaMid || s.meta.strMediaMid;
            if (s.albumMid || (s.meta && s.meta.albumMid))
                meta.albumMid = s.albumMid || s.meta.albumMid;
            if (s.songId || (s.meta && s.meta.songId))
                meta.songId = String(s.songId || s.meta.songId);
            rootItem.id = `tx_${songmid}`;
            break;
        case 'wy':
            rootItem.id = `wy_${songmid}`;
            break;
        case 'kg':
            let hash = s.hash || (s.meta && s.meta.hash) || '';
            if (!hash && String(songmid).includes('_')) {
                hash = String(songmid).split('_')[1];
            } else if (!hash && String(songmid).length === 32) {
                hash = songmid;
            }

            let kgSongId = s.songId || (s.meta && s.meta.songId) || (String(songmid).includes('_') ? String(songmid).split('_')[0] : songmid);
            if (kgSongId === hash) kgSongId = '';

            meta.songId = String(kgSongId || '');
            meta.hash = hash;

            if (kgSongId && hash) {
                rootItem.id = `${kgSongId}_${hash}`;
            } else if (hash) {
                rootItem.id = hash;
            } else {
                rootItem.id = `kg_${kgSongId}`;
            }
            break;
        case 'mg':
            if (s.copyrightId || (s.meta && s.meta.copyrightId))
                meta.copyrightId = s.copyrightId || s.meta.copyrightId;
            if (s.lrcUrl || (s.meta && s.meta.lrcUrl))
                meta.lrcUrl = s.lrcUrl || s.meta.lrcUrl;
            rootItem.id = String(songmid);
            break;
        case 'kw':
            rootItem.id = `kw_${songmid}`;
            break;
        default:
            rootItem.id = songmid;
            break;
    }

    return rootItem;
}

function collectCurrentSongList() {
    if (!currentListData || typeof window.SongListManager === 'undefined') return;
    const detail = window.SongListManager.getCurrentDetail();
    if (!detail || !detail.id || !detail.list || detail.list.length === 0) {
        if (window.showToast) window.showToast('error', '歌单数据不完整或为空');
        return;
    }

    // Check if already collected
    const existingIndex = currentListData.userList.findIndex(l => String(l.sourceListId) === String(detail.id) && l.source === detail.source);
    if (existingIndex >= 0) {
        if (window.showToast) window.showToast('info', '该歌单已在您的收藏中');
        return;
    }

    // Generate random 32 chars hex string for id consistency with other clients
    const randomHex = () => Math.floor(Math.random() * 0xffffffff).toString(16).padStart(8, '0');
    const newId = `${detail.source}_${randomHex()}${randomHex()}${randomHex()}${randomHex()}`;

    // Make sure each song has the source attribute and correct id format
    const listWithSource = detail.list.map(s => {
        const item = formatSongToLxMusicStandard(s);
        if (!item.source) item.source = detail.source;
        return item;
    });

    const newList = {
        id: newId,
        name: detail.info.name || '未命名歌单',
        source: detail.source,
        sourceListId: String(detail.id),
        locationUpdateTime: null,
        list: listWithSource
    };

    currentListData.userList.push(newList);

    // Sync
    pushDataChange().then(() => {
        renderMyLists(currentListData);
        if (window.showToast) window.showToast('success', '歌单收藏成功！');
    }).catch(err => {
        console.error('收藏失败:', err);
        if (window.showToast) window.showToast('error', '收藏失败，请重试');
    });
}

async function toggleLove() {
    if (!currentListData || currentIndex < 0) return;
    const song = currentPlaylist[currentIndex];

    // Format song to standardized format
    const formattedSong = formatSongToLxMusicStandard(song);
    let targetId = formattedSong.id || song.id;

    const index = currentListData.loveList.findIndex(s => s.id === targetId || s.id === song.id);
    if (index >= 0) {
        currentListData.loveList.splice(index, 1);
    } else {
        currentListData.loveList.push(formattedSong);
    }

    // Update UI immediately
    updatePlayerInfo(song);

    // Sync
    await pushDataChange();
}

async function handleRefreshList(listId, event) {
    if (event) event.stopPropagation();
    if (!currentListData) return;

    const list = currentListData.userList.find(l => l.id === listId);
    if (!list || !list.sourceListId || !list.source) {
        if (window.showToast) window.showToast('info', '该歌单不支持在线刷新');
        return;
    }

    const confirmed = await showSelect('更新歌单', `是否更新当前歌单 "${list.name}"？\n(确认后将重新从服务器拉取歌单并覆盖当前内容)`, {
        confirmText: '确定更新',
        confirmColor: 'bg-emerald-500'
    });

    if (!confirmed) return;

    if (window.showToast) window.showToast('info', '正在同步最新歌单内容...');

    try {
        const url = `${API_BASE}/songList/detail?source=${list.source}&id=${encodeURIComponent(list.sourceListId)}&page=1`;
        const res = await fetch(url);
        const data = await res.json();

        if (!data || !data.list) throw new Error('数据拉取失败');

        // 格式化新歌曲列表
        const newList = data.list.map(s => {
            const item = formatSongToLxMusicStandard(s);
            if (!item.source) item.source = list.source;
            return item;
        });

        // 更新列表模型
        list.list = newList;
        if (data.info && data.info.name) list.name = data.info.name;

        // 推送同步并重绘 UI
        await pushDataChange();
        renderMyLists(currentListData);

        // 如果当前正处于该列表视图，刷新结果列表显示
        if (window.currentViewingListId === listId) {
            handleListClick(listId);
        }

        if (window.showToast) window.showToast('success', '歌单内容已同步至最新状态');
    } catch (e) {
        console.error('[Refresh] Failed:', e);
        if (window.showToast) window.showToast('error', '歌单同步失败: ' + e.message);
    }
}

async function handleJumpToOriginalList(listId, event) {
    if (event) event.stopPropagation();
    if (!currentListData) return;

    const list = currentListData.userList.find(l => l.id === listId);
    if (!list || !list.sourceListId || !list.source) {
        if (window.showToast) window.showToast('info', '该歌单不支持跳转到原始页');
        return;
    }

    // 1. Switch Tab to songlist
    switchTab('songlist');

    // 2. Adjust SongListManager source select if available
    const sourceSelect = document.getElementById('songlist-source');
    if (sourceSelect) {
        sourceSelect.value = list.source;
    }

    // 3. Open Detail view via SongListManager
    if (window.SongListManager && window.SongListManager.openDetail) {
        window.SongListManager.openDetail(list.sourceListId, list.source);
    }
}

async function handleRemoveList(listId, event) {
    event.stopPropagation();
    if (!(await showSelect('删除歌单', '确定要删除此歌单吗？', { danger: true }))) return;

    if (currentListData) {
        const index = currentListData.userList.findIndex(l => l.id === listId);
        if (index >= 0) {
            currentListData.userList.splice(index, 1);
            try {
                await pushDataChange();
                renderMyLists(currentListData);
            } catch (e) {
                showError('删除同步失败');
            }
        }
    }
}

// Auto-restore on page load
window.addEventListener('load', () => {
    // 0. Load settings first
    loadSettings();

    // Checkbox State
    const pubToggle = document.getElementById('toggle-public-sources');
    if (pubToggle) {
        pubToggle.checked = settings.enablePublicSources !== false;
    }

    // Update UI to match settings
    const selectEl = document.getElementById('items-per-page-select');
    if (selectEl && settings.itemsPerPage) {
        selectEl.value = settings.itemsPerPage.toString();
    }

    // [新增] 恢复音量设置
    try {
        const savedVolume = localStorage.getItem('lx_volume');
        if (savedVolume) {
            currentVolume = parseFloat(savedVolume);
            audio.volume = currentVolume;
            updateVolumeUI();
            console.log('[Volume] 已恢复音量设置:', currentVolume);
        }
    } catch (e) {
        console.error('[Volume] 恢复音量设置失败:', e);
    }

    // [新增] 恢复播放模式设置
    try {
        const savedMode = localStorage.getItem('lx_play_mode');
        if (savedMode && ['list', 'single', 'random', 'order'].includes(savedMode)) {
            playMode = savedMode;
            updatePlayModeUI();
            console.log('[PlayMode] 已恢复播放模式:', playMode);
        } else {
            // 默认模式
            updatePlayModeUI();
        }
    } catch (e) {
        console.error('[PlayMode] 恢复播放模式失败:', e);
    }

    // 1. Restore cached list data
    const cachedList = localStorage.getItem('lx_list_data');
    if (cachedList) {
        try {
            currentListData = JSON.parse(cachedList);
            const savedUser = localStorage.getItem('lx_sync_user');
            if (savedUser && currentListData) currentListData.username = savedUser; // Restore username from cache

            renderMyLists(currentListData);
            console.log('[Cache] 已恢复缓存的列表数据');
        } catch (e) {
            console.error('[Cache] 恢复列表数据失败:', e);
        }
    }

    // 2. Auto-reconnect or auto-login
    const syncMode = localStorage.getItem('lx_sync_mode');

    if (syncMode === 'local') {
        // Local mode: auto-login
        const user = localStorage.getItem('lx_sync_user');
        const pass = localStorage.getItem('lx_sync_pass');
        if (user && pass) {
            document.getElementById('sync-local-user').value = user;
            document.getElementById('sync-local-pass').value = pass;
            console.log('[Cache] 自动登录本地账号:', user);
            handleLocalLogin();
        }
    } else if (syncMode === 'remote') {
        // Remote mode: auto-reconnect
        const url = localStorage.getItem('lx_sync_url');
        const code = localStorage.getItem('lx_sync_code');
        const authStr = localStorage.getItem('lx_ws_auth');

        if (url && code) {
            document.getElementById('sync-remote-url').value = url;
            document.getElementById('sync-remote-code').value = code;

            // Check if we have saved authInfo
            if (authStr) {
                try {
                    const authInfo = JSON.parse(authStr);
                    console.log('[Cache] 使用缓存的认证信息自动重连...');

                    // Pre-populate authInfo in client
                    syncManager.initRemote(url, code, {
                        getData: async () => {
                            const cached = localStorage.getItem('lx_list_data');
                            return cached ? JSON.parse(cached) : { defaultList: [], loveList: [], userList: [] };
                        },
                        setData: async (data) => {
                            localStorage.setItem('lx_list_data', JSON.stringify(data));
                            const oldUsername = currentListData ? currentListData.username : null;
                            currentListData = data;
                            if (oldUsername) currentListData.username = oldUsername; // Preserve username

                            renderMyLists(data);
                            document.getElementById('sync-status').innerHTML = '<i class="fas fa-check-circle text-blue-500"></i> 数据已同步';
                        },
                        getSyncMode: async () => {
                            return new Promise((resolve) => {
                                syncModeResolve = resolve;
                                showSyncModeModal();
                            });
                        }
                    });

                    syncManager.client.authInfo = authInfo; // Reuse saved auth
                    syncManager.client.onLogin = (success) => {
                        if (success) {
                            console.log('[Cache] 自动重连成功');
                            document.getElementById('sync-status').innerHTML = '<i class="fas fa-check-circle text-green-500"></i> 已自动重连';
                        } else {
                            console.log('[Cache] 自动重连失败,需要手动重新配对');
                            localStorage.removeItem('lx_ws_auth'); // Clear invalid auth
                        }
                    };
                    syncManager.client.connect();
                } catch (e) {
                    console.error('[Cache] 自动重连失败:', e);
                }
            } else {
                console.log('[Cache] 无缓存认证信息,请手动连接');
            }
        }
    }
});

window.switchSyncMode = switchSyncMode;
window.handleLocalLogin = handleLocalLogin;

// Helper to Push Changes to Remote
async function pushDataChange() {
    if (!currentListData) return;
    try {
        await window.SyncManager.push(currentListData);
        console.log('Data Pushed to Remote');
    } catch (e) {
        console.error('Push Failed', e);
    }
}
window.handleRemoteConnect = handleRemoteConnect;
window.handleCreateList = handleCreateList;
window.handleRefreshList = handleRefreshList;
window.handleRemoveList = handleRemoveList;
window.toggleFavorites = toggleFavorites;
window.handleFavoritesClick = handleFavoritesClick;
window.handleRemoteStep1 = handleRemoteStep1;
window.handleRemoteBack = handleRemoteBack;


// ========================================
// Custom Source Management (自定义源管理)
// ========================================

let customSourceMode = 'file'; // 'file' or 'url'

// 切换上传方式
function switchCustomSourceMode(mode) {
    customSourceMode = mode;

    // 更新按钮样式
    document.getElementById('btn-source-file').className = mode === 'file'
        ? 'px-4 py-2 text-sm font-medium bg-emerald-100 text-emerald-700 rounded-lg'
        : 'px-4 py-2 text-sm font-medium bg-gray-100 t-text-muted rounded-lg hover:bg-gray-200';

    document.getElementById('btn-source-url').className = mode === 'url'
        ? 'px-4 py-2 text-sm font-medium bg-emerald-100 text-emerald-700 rounded-lg'
        : 'px-4 py-2 text-sm font-medium bg-gray-100 t-text-muted rounded-lg hover:bg-gray-200';

    // 切换显示
    document.getElementById('custom-source-file').classList.toggle('hidden', mode !== 'file');
    document.getElementById('custom-source-url').classList.toggle('hidden', mode !== 'url');
}

// 处理本地文件上传
async function handleFileUpload(input) {
    const file = input.files[0];
    if (!file) return;

    // 验证文件类型
    if (!file.name.endsWith('.js')) {
        showError('请选择 .js 文件');
        return;
    }

    // 更新文件名显示
    // document.getElementById('file-name-display').textContent = file.name;

    try {
        // 读取文件内容
        const content = await file.text();

        // 先验证脚本
        showInfo('正在验证脚本...');
        const validation = await fetch('/api/custom-source/validate', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ script: content })
        }).then(r => r.json());

        if (!validation.valid && !validation.requireUnsafe) {
            showError(`脚本无效: ${validation.error}`);
            input.value = '';
            // document.getElementById('file-name-display').textContent = '点击选择 .js 文件';
            return;
        }

        // 验证通过，上传
        showInfo(`验证通过，正在上传 "${validation.metadata.name || file.name}"...`);
        let result = await uploadCustomSource(file.name, content, 'file');

        // 如果需要不安全模式确认
        if (result.requireUnsafe) {
            const confirmed = await showSelect('安全风险确认', result.message || '该脚本需要原生 VM 模式运行，可能存在安全风险，是否继续？', { danger: true, confirmText: '允许并上传' });
            if (confirmed) {
                result = await uploadCustomSource(file.name, content, 'file', true);
            } else {
                showInfo('已取消上传');
                input.value = '';
                return;
            }
        }

        showSuccess(`已上传: ${validation.metadata.name || file.name} ${validation.metadata.version ? (/^v/i.test(validation.metadata.version) ? validation.metadata.version : 'v' + validation.metadata.version) : ''}`);

        // 重置输入
        input.value = '';
        // document.getElementById('file-name-display').textContent = '点击选择 .js 文件';

        // 刷新源列表
        loadCustomSources();
    } catch (error) {
        console.error('[CustomSource] 上传失败:', error);
        showError(`上传失败: ${error.message}`);
    }
}

// 处理远程链接导入
async function handleUrlImport() {
    // [Fix] UI does not have an input box, use Prompt
    const input = prompt("请输入自定义源脚本的 URL 地址 (.js):");
    if (input === null) return; // User cancelled

    const url = input.trim();

    if (!url) {
        showError('请输入链接地址');
        return;
    }

    if (!url.endsWith('.js')) {
        showError('链接必须指向 .js 文件');
        return;
    }

    try {
        // 获取文件名
        const filename = url.split('/').pop();

        // 从服务器代理下载
        const response = await fetch(`/api/custom-source/import`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                url,
                filename,
                username: currentListData?.username || 'default'
            })
        });

        let result = await response.json();

        // 如果需要不安全模式确认
        if (result.requireUnsafe) {
            const confirmed = await showSelect('安全风险确认', result.message || '该脚本需要原生 VM 模式运行，可能存在安全风险，是否继续？', { danger: true, confirmText: '允许并导入' });
            if (confirmed) {
                const retryResp = await fetch(`/api/custom-source/import`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        url,
                        filename,
                        username: currentListData?.username || 'default',
                        allowUnsafeVM: true
                    })
                });
                result = await retryResp.json();
            } else {
                showInfo('已取消导入');
                return;
            }
        }

        showSuccess(`已导入: ${result.filename}`);

        // 刷新源列表
        loadCustomSources();
    } catch (error) {
        console.error('[CustomSource] 导入失败:', error);
        showError(`导入失败: ${error.message}`);
    }
}

// 上传自定义源到服务器
async function uploadCustomSource(filename, content, type, allowUnsafeVM = false) {
    const response = await fetch('/api/custom-source/upload', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            filename,
            content,
            type,
            username: currentListData?.username || 'default', // 使用当前登录用户
            allowUnsafeVM
        })
    });

    if (!response.ok) {
        const error = await response.text();
        throw new Error(error || `HTTP ${response.status}`);
    }

    return await response.json();
}

// 加载自定义源列表 (随时可以调用以刷新界面)
async function loadCustomSources() {
    await renderCustomSources();
}

// ========== 自定义源管理逻辑 ==========

async function fetchCustomSources() {
    try {
        const username = currentListData?.username || 'default';
        const res = await fetch(`/api/custom-source/list?username=${username}`);
        if (!res.ok) throw new Error('Failed to fetch sources');
        return await res.json();
    } catch (err) {
        console.error('Fetch sources failed:', err);
        return [];
    }
}


function updateSourceScopeUI() {
    const username = currentListData?.username || 'default';
    const isPublic = username === 'default';
    const showPublic = settings.enablePublicSources !== false; // Default true

    const settingsTag = document.getElementById('settings-source-scope-tag');
    const modalTag = document.getElementById('modal-source-scope-info');

    // Tag Content Logic
    let tagHtml = '';
    if (isPublic) {
        tagHtml = `<span class="px-2 py-0.5 rounded text-xs font-bold bg-blue-100 text-blue-700 border border-blue-200 whitespace-nowrap inline-block">公开</span>`;
    } else {
        // User logged in
        let userTag = `<span class="px-2 py-0.5 rounded text-xs font-bold bg-purple-100 text-purple-700 border border-purple-200 whitespace-nowrap inline-block">${username}</span>`;
        if (showPublic) {
            userTag += `<span class="ml-1 px-2 py-0.5 rounded text-xs font-bold bg-blue-100 text-blue-700 border border-blue-200 whitespace-nowrap inline-block">公开</span>`
        }
        tagHtml = userTag;
    }

    if (settingsTag) settingsTag.innerHTML = tagHtml;

    if (modalTag) {
        modalTag.innerHTML = isPublic
            ? `<div class="flex items-center gap-2 text-xs text-blue-600 bg-blue-50 px-3 py-1.5 rounded-lg border border-blue-100 w-fit mb-2"><i class="fas fa-globe"></i> 上传到: 公开</div>`
            : `<div class="flex items-center gap-2 text-xs text-purple-600 bg-purple-50 px-3 py-1.5 rounded-lg border border-purple-100 w-fit mb-2"><i class="fas fa-user-circle"></i> 上传到: ${username}</div>`;
    }
}

function togglePublicSourcesSetting() {
    settings.enablePublicSources = !settings.enablePublicSources;
    // Save
    localStorage.setItem('lx_settings', JSON.stringify(settings));

    // Refresh Logic
    updateSourceScopeUI();
    renderCustomSources(); // Re-render list
}

async function renderCustomSources() {
    let list = await fetchCustomSources();

    // Filter based on setting
    if (settings.enablePublicSources === false) {
        // Filter out sources where owner is 'open'. 
        // Note: fetchCustomSources returns API objects. We need to check structure.
        // The API returns array of { id, name, version, ..., owner: 'open' || 'username' }
        list = list.filter(item => item.owner !== 'open');
    }

    updateSourceScopeUI();

    // 渲染目标容器 ID 列表：模态框内 & 设置界面内
    const targetIds = ['custom-sources-list', 'settings-custom-sources-list'];

    targetIds.forEach(containerId => {
        const container = document.getElementById(containerId);
        if (!container) return;

        // 空状态
        if (list.length === 0) {
            container.innerHTML = `
                <div class="flex flex-col items-center justify-center p-6 t-text-muted">
                    <i class="fas fa-box-open text-3xl mb-3 opacity-30"></i>
                    <p class="text-sm">暂无自定义源</p>
                    ${containerId === 'custom-sources-list' ?
                    `<button onclick="document.getElementById('script-file').click()" class="mt-3 text-emerald-600 hover:text-emerald-700 text-sm font-medium">即刻上传</button>`
                    : ''}
                </div>
            `;
            return;
        }

        container.innerHTML = '';

        list.forEach((source, index) => {
            const div = document.createElement('div');
            // 设置界面使用稍紧凑的样式，模态框使用标准样式 (这里为了统一先用一样的，微调边距)
            div.className = `t-bg-panel p-4 rounded-xl border t-border-main shadow-sm hover:shadow-md transition-all mb-3 relative group flex items-start source-item`;
            div.dataset.id = source.id;
            div.dataset.enabled = source.enabled;
            div.dataset.index = index;

            // 格式化支持的源
            let supportedBadges = '';
            if (source.supportedSources && source.supportedSources.length > 0) {
                const sourceMap = {
                    'kg': { name: '酷狗', color: 't-badge-blue' },
                    'kw': { name: '酷我', color: 't-badge-yellow' },
                    'tx': { name: 'QQ', color: 't-badge-green' },
                    'wy': { name: '网易', color: 't-badge-red' },
                    'mg': { name: '咪咕', color: 't-badge-pink' }
                };

                supportedBadges = `<div class="flex flex-wrap gap-2 mt-2">
                ${source.supportedSources.map(s => {
                    const info = sourceMap[s] || { name: s, color: 't-badge-gray' };
                    return `<span class="px-2 py-0.5 rounded-md text-[10px] font-semibold transition-colors ${info.color}">${info.name}</span>`;
                }).join('')}
            </div>`;
            } else {
                supportedBadges = `<div class="mt-2 text-[10px] t-text-muted italic">未知支持源</div>`;
            }

            const size = source.size && !isNaN(source.size) ? (source.size / 1024).toFixed(1) + ' KB' : '未知大小';
            let date = '未知日期';
            try {
                if (source.uploadTime) date = new Date(source.uploadTime).toLocaleDateString();
            } catch (e) { }

            /* Status Badge Logic */
            let statusBadge = '';
            let errorMsg = '';

            if (source.enabled) {
                if (source.status === 'success') {
                    statusBadge = `<span class="text-[10px] bg-emerald-50 text-emerald-600 dark:bg-emerald-500/20 dark:text-emerald-400 dark:border-emerald-500/30 px-1.5 py-0.5 rounded-full border border-emerald-100 flex items-center gap-1 transition-colors"><i class="fas fa-check-circle"></i>正常</span>`;
                } else if (source.status === 'failed') {
                    statusBadge = `<span class="text-[10px] bg-red-50 text-red-600 dark:bg-red-500/20 dark:text-red-400 dark:border-red-500/30 px-1.5 py-0.5 rounded-full border border-red-100 flex items-center gap-1 cursor-help transition-colors" title="${source.error || '加载失败'}"><i class="fas fa-times-circle"></i>失败</span>`;
                    errorMsg = `<div class="text-[10px] text-red-500 dark:text-red-400 mt-1 flex items-start gap-1 p-1.5 bg-red-50 dark:bg-red-900/20 rounded transition-colors"><i class="fas fa-info-circle mt-0.5 flex-shrink-0"></i><span class="break-all">${source.error || '未知错误'}</span></div>`;
                } else {
                    // If enabled but no status (yet), assume initializing or loaded before status tracking
                    statusBadge = `<span class="text-[10px] bg-blue-50 text-blue-600 dark:bg-blue-500/20 dark:text-blue-400 dark:border-blue-500/30 px-1.5 py-0.5 rounded-full border border-blue-100 flex items-center gap-1 transition-colors"><i class="fas fa-circle-notch fa-spin"></i>加载...</span>`;
                }
            }

            div.innerHTML = `
            <div class="flex items-center self-stretch cursor-grab custom-source-handle t-text-muted hover:text-emerald-500 pr-4 -ml-2 transition-all active:scale-110 touch-none" title="拖拽排序">
                <i class="fas fa-grip-vertical text-lg"></i>
            </div>
            <div class="flex justify-between items-start flex-1 min-w-0">
                <div class="flex-1 pr-4 min-w-0">
                    <div class="flex items-center gap-2 mb-1 flex-wrap">
                        <div class="flex items-center gap-2 min-w-0 flex-1">
                            <i class="fas fa-file-code text-emerald-500 flex-shrink-0"></i>
                            ${createMarqueeHtml(source.name, "font-bold t-text-main text-sm")}
                        </div>
                        <div class="flex items-center gap-2">
                             ${statusBadge}
                        </div>
                    </div>
                    ${errorMsg}
                    <div class="flex items-center text-[10px] t-text-muted space-x-2 mt-1">
                        <span><i class="fas fa-user mr-1"></i>${source.author || '未知'}</span>
                        <span><i class="far fa-hdd mr-1"></i>${size}</span>
                        <span class="t-bg-main t-text-muted px-1.5 py-0.5 rounded shrink-0 transition-colors font-mono pointer-events-none">${source.version ? (/^v/i.test(source.version) ? source.version : 'v' + source.version) : '未知'}</span>
                    </div>
                    ${supportedBadges}
                </div>
                
                <div class="flex flex-col items-end gap-2 shrink-0">
                    <button onclick="toggleSource('${source.id}', ${source.enabled})" 
                            class="px-3 py-1 rounded-lg text-xs font-medium transition-colors whitespace-nowrap w-20 flex justify-center items-center ${source.enabled
                    ? (source.status === 'failed' ? 'bg-red-100 text-red-700 dark:bg-red-500/20 dark:text-red-400 hover:bg-red-200 dark:hover:bg-red-500/30' : 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-400 hover:bg-emerald-200 dark:hover:bg-emerald-500/30')
                    : 't-bg-track t-text-muted hover:t-bg-item-hover'}">
                        ${source.enabled ? '已启用' : '已禁用'}
                    </button>
                    
                    <div class="flex items-center gap-1">
                        ${source.enabled && source.status === 'failed' ? `
                        <button onclick="reloadSource('${source.id}')" 
                                class="p-1.5 text-blue-500 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300 hover:bg-blue-50 dark:hover:bg-blue-900/40 rounded-lg transition-colors"
                                title="尝试重新加载">
                            <i class="fas fa-sync-alt text-sm"></i>
                        </button>` : ''}
                        
                        <button onclick="deleteSource('${source.id}')" 
                                class="p-1.5 t-text-muted hover:text-red-500 dark:hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/40 rounded-lg transition-colors"
                                title="删除">
                            <i class="fas fa-trash-alt text-sm"></i>
                        </button>
                    </div>
                </div>
            </div>
        `;
            container.appendChild(div);
        });

        // Add Sortable (Optimized for Mobile)
        if (typeof Sortable !== 'undefined') {
            // Destroy existing instance to avoid duplicates
            try {
                const oldSortable = Sortable.get(container);
                if (oldSortable) oldSortable.destroy();
            } catch (e) { }

            Sortable.create(container, {
                animation: 200,
                handle: '.custom-source-handle',
                ghostClass: 'sortable-ghost-solid',
                chosenClass: 'sortable-chosen-item',
                dragClass: 'sortable-drag-item',

                // 核心配置
                forceFallback: true,
                fallbackOnBody: false,
                fallbackTolerance: 0,

                // 响应优化
                delay: 0,
                touchStartThreshold: 3,

                // 排序逻辑
                swapThreshold: 0.5,
                invertSwap: true,
                direction: 'vertical',

                onStart: function () {
                    document.body.classList.add('select-none');
                },
                onEnd: async function (evt) {
                    document.body.classList.remove('select-none');
                    const items = Array.from(container.querySelectorAll('.source-item'));

                    // Parse current state from DOM after drag
                    const draggedItem = evt.item;
                    const draggedId = draggedItem.dataset.id;
                    const isEnabled = draggedItem.dataset.enabled === 'true';

                    // Separate into enabled and disabled to enforce grouping
                    let enabledIds = [];
                    let disabledIds = [];

                    items.forEach(el => {
                        const id = el.dataset.id;
                        const stateEnabled = el.dataset.enabled === 'true';

                        // Enforce logic: an item keeps its enabled/disabled state, 
                        // we just figure out its relative order within its group.
                        if (stateEnabled) {
                            enabledIds.push(id);
                        } else {
                            disabledIds.push(id);
                        }
                    });

                    // Check if a swap occurred across boundaries causing a weird state?
                    // Actually, the UI just re-arranged the divs. By separating them into enabledIds and disabledIds, 
                    // we automatically force enabled to be before disabled.
                    // If an enabled source was dragged to the disabled section, it will naturally be at the end of the enabledIds array (because it was placed after other enabled items).
                    // Same vice versa.

                    const finalOrderIds = [...enabledIds, ...disabledIds];

                    try {
                        const username = currentListData?.username || 'default';
                        const response = await fetch('/api/custom-source/reorder', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ username, sourceIds: finalOrderIds })
                        });

                        if (!response.ok) throw new Error('Reorder failed');

                        // Re-render to show the forcefully corrected order (enabled on top)
                        renderCustomSources();
                    } catch (error) {
                        console.error('Reorder error:', error);
                        showError('保存排序失败');
                        renderCustomSources(); // Revert UI
                    }
                }
            });
        }
    });

    // Apply dynamic marquee checks after rendering source list
    if (typeof applyMarqueeChecks === 'function') {
        applyMarqueeChecks();
    }
}

// 重新加载源 (强制重新启用)
async function reloadSource(sourceId) {
    try {
        const username = currentListData?.username || 'default';
        const response = await fetch('/api/custom-source/toggle', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, sourceId, enabled: true }) // Force enable triggers reload
        });

        if (!response.ok) throw new Error(`HTTP ${response.status}`);

        showInfo('正在重新加载...');
        // Wait a bit for server to process
        setTimeout(() => {
            renderCustomSources();
        }, 1000);

    } catch (error) {
        console.error('Reload failed:', error);
        showError(`重载请求失败: ${error.message}`);
    }
}

// 切换状态
async function toggleSource(sourceId, currentEnabled, allowUnsafeVM = false) {
    try {
        const username = currentListData?.username || 'default';
        const response = await fetch('/api/custom-source/toggle', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, sourceId, enabled: !currentEnabled, allowUnsafeVM }) // Send new state
        });

        if (!response.ok) throw new Error(`HTTP ${response.status}`);

        const result = await response.json();

        // 处理 REQUIRE_UNSAFE_VM
        if (result.requireUnsafe) {
            const confirmed = await showSelect('安全风险确认', result.message || '该脚本需要原生 VM 模式运行，可能存在安全风险，是否继续？', { danger: true, confirmText: '依然启用' });
            if (confirmed) {
                return await toggleSource(sourceId, currentEnabled, true);
            } else {
                return;
            }
        }

        // 刷新列表
        await renderCustomSources();
        showSuccess(currentEnabled ? '已禁用' : '已启用');
    } catch (error) {
        console.error('[CustomSource] 切换状态失败:', error);
        showError(`操作失败: ${error.message}`);
    }
}

// 删除源
async function deleteSource(sourceId) {
    if (!(await showSelect('删除自定义源', '确定要删除这个自定义源吗？', { danger: true }))) return;

    try {
        const username = currentListData?.username || 'default';
        const response = await fetch('/api/custom-source/delete', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, sourceId })
        });

        if (!response.ok) throw new Error(`HTTP ${response.status}`);

        showSuccess('已删除');
        await renderCustomSources();
    } catch (error) {
        console.error('[CustomSource] 删除失败:', error);
        showError(`删除失败: ${error.message}`);
    }
}

// 模态框控制
function openCustomSourceModal() {
    const modal = document.getElementById('custom-source-modal');
    const content = document.getElementById('custom-source-modal-content');
    if (modal) modal.classList.remove('hidden');

    // 渲染列表
    renderCustomSources();

    setTimeout(() => {
        if (content) {
            content.classList.remove('scale-95', 'opacity-0');
            content.classList.add('scale-100', 'opacity-100');
        }
    }, 10);
}

function closeCustomSourceModal() {
    const modal = document.getElementById('custom-source-modal');
    const content = document.getElementById('custom-source-modal-content');

    if (content) {
        content.classList.remove('scale-100', 'opacity-100');
        content.classList.add('scale-95', 'opacity-0');
    }

    setTimeout(() => {
        if (modal) modal.classList.add('hidden');
    }, 300);
}


// ========================================
// Playlist Add Modal (Collections)
// ========================================


// Helper to render the grid (can be called from anywhere)
function renderPlaylistAddGrid() {
    const song = currentPlayingSong;
    if (!song) return;

    const listContainer = document.getElementById('playlist-add-list');
    if (!listContainer) return;

    // Use standardized ID for checking inclusion
    // Reuse cleanSongData logic to ensure we match what's saved
    const cleanedSong = cleanSongData(song);
    const targetId = cleanedSong.id;

    listContainer.innerHTML = '';

    // Helper to create grid item
    const createGridItem = (listId, listName, count, isIncluded) => {
        const btn = document.createElement('button');
        // Base styles
        let className = "relative h-14 rounded-lg text-sm font-bold transition-all duration-200 flex items-center justify-center gap-1 shadow-sm overflow-hidden ";

        // Active/Inactive styles
        if (isIncluded) {
            className += "bg-emerald-500 text-white shadow-md scale-[1.02] ring-2 ring-emerald-200";
        } else {
            className += "bg-emerald-50 text-emerald-500 hover:bg-emerald-100 hover:shadow";
        }

        btn.className = className;
        btn.onclick = () => handleTogglePlaylist(listId, btn); // Use handler wrapper

        btn.innerHTML = `
            <span class="truncate max-w-[80%]">${listName}</span>
            ${isIncluded ? '<i class="fas fa-check text-xs ml-1 opacity-80"></i>' : ''}
        `;
        return btn;
    };

    // 1. My Love
    const loveList = currentListData.loveList || [];
    const isLoved = loveList.some(s => s.id === targetId);
    listContainer.appendChild(createGridItem('love', '我的收藏', loveList.length, isLoved));

    // 2. User Lists
    if (currentListData.userList) {
        currentListData.userList.forEach(list => {
            const isIncluded = list.list.some(s => s.id === targetId);
            listContainer.appendChild(createGridItem(list.id, list.name, list.list.length, isIncluded));
        });
    }

    // 3. Create New List Dash Box
    const createNewBtn = document.createElement('button');
    createNewBtn.className = "h-14 rounded-lg text-xs font-bold border-2 border-dashed border-gray-300 dark:border-gray-600 text-gray-500 hover:text-emerald-500 hover:border-emerald-400 transition-all flex items-center justify-center gap-2 t-bg-main/20 hover:t-bg-main/50 shadow-sm";
    createNewBtn.innerHTML = `
        <i class="fas fa-plus"></i> 新建歌单
    `;
    createNewBtn.onclick = () => {
        handleCreateList();
    };
    listContainer.appendChild(createNewBtn);
}

async function openPlaylistAddModal() {
    if (!currentListData) {
        showError('请先登录后使用收藏功能');
        return;
    }
    // [Fix] Use currentPlayingSong instead of currentPlaylist[currentIndex]
    // currentPlaylist might have changed if user searched for something else
    const song = currentPlayingSong;
    if (!song) {
        showError('当前没有正在播放的歌曲');
        return;
    }

    const modal = document.getElementById('playlist-add-modal');
    const content = document.getElementById('playlist-add-modal-content');
    const nameLabel = document.getElementById('playlist-add-song-name');

    if (!modal) return;

    // Set Info
    nameLabel.innerText = song.name;

    // Render List Items
    renderPlaylistAddGrid();

    // Show Modal
    modal.classList.remove('hidden');
    setTimeout(() => {
        content.classList.remove('scale-95', 'opacity-0');
        content.classList.add('scale-100', 'opacity-100');
    }, 10);
}

function closePlaylistAddModal() {
    const modal = document.getElementById('playlist-add-modal');
    const content = document.getElementById('playlist-add-modal-content');

    if (content) {
        content.classList.remove('scale-100', 'opacity-100');
        content.classList.add('scale-95', 'opacity-0');
    }

    setTimeout(() => {
        if (modal) modal.classList.add('hidden');
        // Update Player Info to refresh heart icon state
        if (currentPlayingSong) {
            updatePlayerInfo(currentPlayingSong);
        }
    }, 300);
}

// 绑定模态框背景点击
const playlistAddModal = document.getElementById('playlist-add-modal');
if (playlistAddModal) {
    playlistAddModal.addEventListener('click', (e) => {
        if (e.target === e.currentTarget) {
            closePlaylistAddModal();
        }
    });
}


// Helper: Clean song data to match LX.Music.MusicInfoOnline interface
function cleanSongData(song) {
    if (!song) return null;

    // Ensure meta exists, defaulting to empty object if missing
    const sourceMeta = song.meta || {};

    // 1. Resolve Song ID (songId or songmid or id)
    // Different sources/APIs place the ID in different spots
    let songId = sourceMeta.songId || song.songId || song.songmid || song.id;

    // [Fix] 针对 QQ 音乐 (tx)，强制使用 songmid 作为主 ID，避免使用数字 ID
    if (song.source === 'tx' && song.songmid) {
        songId = song.songmid;
    }

    // 2. Resolve Album Name
    let albumName = sourceMeta.albumName || song.albumName || song.album?.name || '';

    // 3. Resolve Pic URL
    let picUrl = sourceMeta.picUrl || song.picUrl || song.img || song.album?.cover;

    // Common Meta
    const meta = {
        songId: songId,
        albumName: albumName,
        picUrl: picUrl,
        qualitys: sourceMeta.qualitys || song.qualitys || song.types,
        _qualitys: sourceMeta._qualitys || song._qualitys || song._types,
        albumId: sourceMeta.albumId || song.albumId
    };

    // Source Reference: src/types/music.d.ts
    // 补全特定源的字段
    if (song.source === 'kg') {
        meta.hash = sourceMeta.hash || song.hash;
    } else if (song.source === 'tx') {
        meta.strMediaMid = sourceMeta.strMediaMid || song.strMediaMid || song.mediaMid;
        meta.id = sourceMeta.id || song.songId || song.id; // tx often uses numerical ID here
        meta.albumMid = sourceMeta.albumMid || song.albumMid;
    } else if (song.source === 'mg') {
        meta.copyrightId = sourceMeta.copyrightId || song.copyrightId || songId; // fallback
        meta.lrcUrl = sourceMeta.lrcUrl || song.lrcUrl;
        meta.mrcUrl = sourceMeta.mrcUrl || song.mrcUrl;
        meta.trcUrl = sourceMeta.trcUrl || song.trcUrl;
    }

    // Common Base
    // 确保 ID 格式为 source_songId (如 kw_123456)
    // 如果 song.id 已经是 source_id 格式则保留，否则拼接
    const fullId = (song.source && songId && !String(songId).startsWith(song.source + '_'))
        ? `${song.source}_${songId}`
        : (song.id || `${song.source || 'temp'}_${songId}`);

    const cleanSong = {
        id: fullId, // Standardized ID
        name: song.name,
        singer: song.singer,
        source: song.source,
        interval: song.interval,
        meta: meta
    };

    // Remove undefined keys
    const removeUndefined = (obj) => {
        Object.keys(obj).forEach(key => {
            if (obj[key] === undefined) delete obj[key];
            else if (typeof obj[key] === 'object' && obj[key] !== null) removeUndefined(obj[key]);
        });
        return obj;
    };

    return removeUndefined(cleanSong);
}


// Modified handler for Grid Buttons
async function handleTogglePlaylist(listId, btnElement) {
    if (!currentListData || !currentPlayingSong) return;
    const song = currentPlayingSong;

    // Determine current state based on data, NOT UI
    // (UI might represent old state if sync failed, but we assume optimistic UI for responsiveness)

    let targetListArray;
    if (listId === 'love') {
        targetListArray = currentListData.loveList;
    } else {
        const uList = currentListData.userList.find(l => l.id === listId);
        if (uList) targetListArray = uList.list;
    }

    if (!targetListArray) return;

    const cleanedSong = cleanSongData(song); // 获取标准化的歌曲数据
    const targetId = cleanedSong.id;

    // Check against the standardized ID to ensure correct matching
    const isCurrentlyIncluded = targetListArray.some(s => s.id === targetId);
    const willAdd = !isCurrentlyIncluded;

    // Optimistic UI Update
    updateGridItemVisuals(btnElement, willAdd);

    try {
        if (willAdd) {
            targetListArray.unshift(cleanedSong);
        } else {
            const idx = targetListArray.findIndex(s => s.id === targetId);
            if (idx >= 0) targetListArray.splice(idx, 1);
        }

        await pushDataChange();

        // No toast needed for rapid toggling, visual feedback on button is enough
        // showSuccess(willAdd ? '已添加' : '已移除'); 

        // Update My Lists sidebar
        renderMyLists(currentListData);
    } catch (e) {
        showError('同步失败: ' + e.message);
        // Revert UI if failed
        updateGridItemVisuals(btnElement, !willAdd);
    }
}

function updateGridItemVisuals(btn, isIncluded) {
    if (isIncluded) {
        btn.className = "relative h-14 rounded-lg text-sm font-bold transition-all duration-200 flex items-center justify-center gap-1 shadow-sm overflow-hidden bg-red-500 text-white shadow-md scale-[1.02] ring-2 ring-red-200";
        // Update icon if needed, though innerHTML replacement is easiest
        const textSpan = btn.querySelector('span'); // Assuming first span is text
        const text = textSpan ? textSpan.innerText : btn.innerText;
        btn.innerHTML = `
            <span class="truncate max-w-[80%]">${text}</span>
            <i class="fas fa-check text-xs ml-1 opacity-80"></i>
        `;
    } else {
        btn.className = "relative h-14 rounded-lg text-sm font-bold transition-all duration-200 flex items-center justify-center gap-1 shadow-sm overflow-hidden bg-red-50 text-red-500 hover:bg-red-100 hover:shadow";
        const textSpan = btn.querySelector('span');
        const text = textSpan ? textSpan.innerText : btn.innerText;
        btn.innerHTML = `<span class="truncate max-w-[80%]">${text}</span>`;
    }
}



let currentCommentType = 'hot'; // 'hot' or 'new'
let currentCommentPage = 1;
let isCommentLoading = false;

// 评论数据缓存
let lastCommentSongId = null;
let commentCache = {
    hot: { pages: {}, total: 0, maxPage: 1 },
    new: { pages: {}, total: 0, maxPage: 1 }
};

function clearCommentCache() {
    commentCache.hot = { pages: {}, total: 0, maxPage: 1 };
    commentCache.new = { pages: {}, total: 0, maxPage: 1 };
    const hotCount = document.getElementById('hot-comment-count');
    const newCount = document.getElementById('new-comment-count');
    if (hotCount) hotCount.innerText = '';
    if (newCount) newCount.innerText = '';
}

// 解决变量名不一致问题
function getActiveSongInfo() {
    if (typeof currentPlayingSong !== 'undefined' && currentPlayingSong) return currentPlayingSong;
    return null;
}


function toggleCommentModal() {
    const modal = document.getElementById('comment-modal');
    const content = document.getElementById('comment-modal-content');
    if (!modal || !content) return;

    const isHidden = modal.classList.contains('hidden');

    if (isHidden) {
        // 打开
        modal.classList.remove('hidden');
        modal.classList.add('flex');

        // 触发动画
        requestAnimationFrame(() => {
            content.classList.remove('translate-y-10', 'opacity-0');
            content.classList.add('translate-y-0', 'opacity-100');
        });

        // 加载评论
        const song = getActiveSongInfo();
        if (song) {
            const songId = song.songmid || song.hash || song.id;
            if (lastCommentSongId !== songId) {
                console.log('[Comment] Song changed, clearing cache and refreshing');
                lastCommentSongId = songId;
                clearCommentCache();
                refreshComments();
            } else {
                console.log('[Comment] Same song, using cache check');
                fetchComments();
            }
        } else {
            console.warn('[Comment] No song playing, showing empty state');
            document.getElementById('comment-list').innerHTML = '<div class="text-center py-10 t-text-muted font-bold">请先播放歌曲</div>';
            document.getElementById('comment-loader').classList.add('hidden');
        }
    } else {
        // 关闭
        content.classList.remove('translate-y-0', 'opacity-100');
        content.classList.add('translate-y-10', 'opacity-0');

        setTimeout(() => {
            modal.classList.add('hidden');
            modal.classList.remove('flex');
        }, 300);
    }
}

async function switchCommentType(type) {
    if (currentCommentType === type) return;
    currentCommentType = type;

    // UI Feedback
    const hotBtn = document.getElementById('tab-hot-comments');
    const newBtn = document.getElementById('tab-new-comments');

    if (type === 'hot') {
        hotBtn.classList.add('text-emerald-600');
        hotBtn.classList.remove('t-text-muted');
        hotBtn.querySelector('div').classList.remove('scale-x-0');

        newBtn.classList.remove('text-emerald-600');
        newBtn.classList.add('t-text-muted');
        newBtn.querySelector('div').classList.add('scale-x-0');
    } else {
        newBtn.classList.add('text-emerald-600');
        newBtn.classList.remove('t-text-muted');
        newBtn.querySelector('div').classList.remove('scale-x-0');

        hotBtn.classList.remove('text-emerald-600');
        hotBtn.classList.add('t-text-muted');
        hotBtn.querySelector('div').classList.add('scale-x-0');
    }

    refreshComments(false);
}

async function refreshComments(force = true) {
    if (force) {
        clearCommentCache();
    }
    currentCommentPage = 1;
    await fetchComments();
}

async function changeCommentPage(delta) {
    const newPage = currentCommentPage + delta;
    if (newPage < 1 || isCommentLoading) return;

    currentCommentPage = newPage;
    await fetchComments();

    // 滚动到顶部
    const container = document.getElementById('comment-list-container');
    if (container) container.scrollTo({ top: 0, behavior: 'smooth' });
}

async function fetchComments() {
    const song = getActiveSongInfo();
    if (!song || isCommentLoading) {
        console.log('[Comment] Fetch skipped:', { hasSong: !!song, isLoading: isCommentLoading });
        return;
    }

    const loader = document.getElementById('comment-loader');
    const list = document.getElementById('comment-list');
    const pageIndicator = document.getElementById('comment-page-indicator');

    // 1. 检查当前类型和页码是否有缓存
    const cache = commentCache[currentCommentType];
    const cachedPage = cache.pages[currentCommentPage];

    if (cachedPage) {
        console.log(`[Comment] Using cached ${currentCommentType} page ${currentCommentPage}`);
        if (list) list.innerHTML = ''; // 确保清空上一页内容
        renderComments(cachedPage);
        updateCommentCountLabels(cache.total);
        updatePaginationUI(cache.total, cache.maxPage);
        if (loader) loader.classList.add('hidden');
        isCommentLoading = false;
        return;
    }

    // 2. Cache miss: 显示加载状态
    isCommentLoading = true;
    if (loader) loader.classList.remove('hidden');
    if (list) list.innerHTML = '';
    if (pageIndicator) pageIndicator.innerText = `PAGE -- / --`;

    // 更新标题和来源
    document.getElementById('comment-title').innerText = `${song.name} - 评论`;
    document.getElementById('comment-source-info').innerText = `Source: ${song.source.toUpperCase()}`;

    console.log(`[Comment] Fetching ${currentCommentType} for ${song.name} (${song.source}), page ${currentCommentPage}`);

    try {
        const response = await fetch('/api/music/comment', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                songInfo: song,
                type: currentCommentType,
                page: currentCommentPage,
                limit: 20
            })
        });

        if (!response.ok) {
            const errorText = await response.text();
            console.error('[Comment] API Error:', response.status, errorText);
            throw new Error(`API Error: ${response.status}`);
        }

        const data = await response.json();
        console.log('[Comment] Data received:', data);
        if (data.error) throw new Error(data.error);

        // 存入缓存
        commentCache[currentCommentType].pages[currentCommentPage] = data.comments;
        commentCache[currentCommentType].total = data.total;
        commentCache[currentCommentType].maxPage = data.maxPage || Math.ceil((data.total || 0) / 20) || 1;

        renderComments(data.comments);
        updateCommentCountLabels(data.total);
        updatePaginationUI(data.total, data.maxPage);

    } catch (e) {
        console.error('Fetch comments failed:', e);
        if (list) list.innerHTML = `<div class="text-center py-10 text-red-400 font-bold">加载失败: ${e.message}</div>`;
    } finally {
        if (loader) loader.classList.add('hidden');
        isCommentLoading = false;
    }
}

function updatePaginationUI(total, maxPage) {
    const totalPages = maxPage || Math.ceil((total || 0) / 20) || 1;
    const pageIndicator = document.getElementById('comment-page-indicator');
    if (pageIndicator) pageIndicator.innerText = `PAGE ${currentCommentPage} / ${totalPages}`;

    const prevBtn = document.getElementById('btn-comment-prev');
    const nextBtn = document.getElementById('btn-comment-next');
    if (prevBtn) prevBtn.disabled = currentCommentPage <= 1;
    if (nextBtn) nextBtn.disabled = currentCommentPage >= totalPages;

    // 兼容旧版统计逻辑 (如果有)
    const oldInfo = document.getElementById('comment-pagination-info');
    if (oldInfo) oldInfo.innerText = `Page ${currentCommentPage}`;
}

function updateCommentCountLabels(total) {
    if (total === undefined) return;
    const countLabel = currentCommentType === 'hot' ? 'hot-comment-count' : 'new-comment-count';
    const el = document.getElementById(countLabel);
    if (el) el.innerText = total > 1000 ? (total / 1000).toFixed(1) + 'k' : total;
}

function renderComments(comments) {
    const list = document.getElementById('comment-list');
    if (!list) return;

    if (!comments || comments.length === 0) {
        if (currentCommentPage === 1) {
            list.innerHTML = '<div class="text-center py-20 text-gray-300 font-bold uppercase tracking-widest">暂无评论</div>';
        }
        return;
    }

    const html = comments.map(c => createCommentItemHTML(c)).join('');
    if (currentCommentPage === 1) {
        list.innerHTML = html;
    } else {
        list.insertAdjacentHTML('beforeend', html);
    }
}

function createCommentItemHTML(comment, isReply = false) {
    const timeStr = comment.timeStr || (comment.time ? new Date(comment.time).toLocaleString() : '');
    const location = comment.location ? ` • ${comment.location}` : '';

    // 头像处理
    const defaultAvatar = '/music/assets/logo.svg';
    const avatar = comment.avatar || defaultAvatar;
    const isDefault = avatar.includes('logo.svg') || !comment.avatar;
    const avatarClass = `w-8 h-8 md:w-10 md:h-10 rounded-full shadow-sm hover:scale-110 transition-transform t-bg-main flex-shrink-0 object-cover ${isDefault ? 'dynamic-logo p-1.5' : ''}`;

    let replyHtml = '';
    if (comment.reply && comment.reply.length > 0) {
        replyHtml = `
            <div class="mt-4 ml-2 pl-4 border-l-2 t-border-main space-y-4">
                ${comment.reply.map(r => createCommentItemHTML(r, true)).join('')}
            </div>
        `;
    }

    return `
        <div class="group flex gap-3 md:gap-4 transition-all animate-fade-in-up">
            <img src="${avatar}" 
                 class="${avatarClass}" 
                 onerror="if(!this.dataset.tried){this.dataset.tried=1;this.src='/music/assets/logo.svg';this.classList.add('dynamic-logo','p-1.5','bg-emerald-50');this.style.filter='var(--logo-filter, none)';}">
            <div class="flex-1 min-w-0">
                <div class="flex items-center justify-between mb-1">
                    <span class="text-xs md:text-sm font-black t-text-main truncate">${comment.userName}</span>
                    <div class="flex items-center gap-1.5 text-[10px] t-text-muted font-bold">
                        <i class="far fa-thumbs-up"></i>
                        <span>${comment.likedCount || 0}</span>
                    </div>
                </div>
                <p class="text-xs md:text-sm t-text-muted leading-relaxed break-words whitespace-pre-wrap">${comment.text}</p>
                ${comment.images && comment.images.length > 0 ? `
                    <div class="mt-2 flex flex-wrap gap-2">
                        ${comment.images.map(img => `
                            <img src="${img}" class="max-w-[200px] max-h-[300px] rounded-lg shadow-sm cursor-pointer hover:opacity-90 transition-opacity" 
                                 onclick="window.open('${img}', '_blank')"
                                 onerror="this.style.display='none'">
                        `).join('')}
                    </div>
                ` : ''}
                <div class="mt-2 flex items-center gap-3 text-[10px] t-text-muted font-bold uppercase tracking-tight">
                    <span>${timeStr}${location}</span>
                </div>
                ${replyHtml}
            </div>
        </div>
    `;
}

async function toggleSongInList(listId, isAdd) {
    // Deprecated in favor of handleTogglePlaylist
    console.warn("toggleSongInList is deprecated");
}


// ========================================
// 导出函数到 window (ES Module 需要显式暴露)
// ========================================

// Custom Source functions
window.openCustomSourceModal = openCustomSourceModal;
window.closeCustomSourceModal = closeCustomSourceModal;
window.switchCustomSourceMode = switchCustomSourceMode;
window.handleFileUpload = handleFileUpload;
window.handleUrlImport = handleUrlImport;

// Playlist Modal functions
window.openPlaylistAddModal = openPlaylistAddModal;
window.closePlaylistAddModal = closePlaylistAddModal;
window.toggleSongInList = toggleSongInList;


// 新版函数名
window.toggleSource = toggleSource;
window.deleteSource = deleteSource;
window.reloadSource = reloadSource;

// 兼容旧版函数名 (Alias)
window.toggleCustomSource = toggleSource;
window.deleteCustomSource = deleteSource;
window.importFromUrl = handleUrlImport;

window.togglePublicSourcesSetting = togglePublicSourcesSetting;

// Core functions
window.switchTab = switchTab;
window.handleSearchKeyPress = handleSearchKeyPress;
window.doSearch = doSearch;
window.changePage = changePage;
window.handleHotSearchClick = handleHotSearchClick;
window.playSong = playSong;
window.togglePlay = togglePlay;
window.playNext = playNext;
window.playPrev = playPrev;
window.seek = seek;
window.changeQualityPreference = changeQualityPreference;

// Volume
window.setVolume = setVolume;
window.toggleMute = toggleMute;
window.setPlayMode = setPlayMode;
window.showSelect = showSelect;

// Lyrics
window.toggleLyrics = toggleLyrics;

// Favorites & Lists
window.toggleFavorites = toggleFavorites;
window.handleFavoritesClick = handleFavoritesClick;
window.handleListClick = handleListClick;
window.handleCreateList = handleCreateList;
window.handleRefreshList = handleRefreshList;
window.handleJumpToOriginalList = handleJumpToOriginalList;
window.handleRemoveList = handleRemoveList;
window.toggleLove = toggleLove;

// Sync functions
window.switchSyncMode = switchSyncMode;
window.handleLocalLogin = handleLocalLogin;
window.handleRemoteConnect = handleRemoteConnect;
window.handleRemoteStep1 = handleRemoteStep1;
window.handleRemoteBack = handleRemoteBack;
window.selectSyncMode = selectSyncMode;
window.cancelSyncMode = cancelSyncMode;
window.closeSyncModal = closeSyncModal;

// Comment functions
window.toggleCommentModal = toggleCommentModal;
window.switchCommentType = switchCommentType;
window.refreshComments = refreshComments;
window.fetchComments = fetchComments;


// [Redundant block removed]

// ========================================
// UI Helper Functions (Toast Notifications)
// ========================================

/**
 * 弹出选择/确认对话框 (showSelect)
 * @param {string} title 标题
 * @param {string} message 内容
 * @param {object} options 配置 (confirmText, cancelText, danger)
 * @returns {Promise<boolean>}
 */
// 确认弹窗
/**
 * 弹出输入对话框 (showInput)
 * @param {string} title 标题
 * @param {string} message 提示信息
 * @param {object} options 配置 (placeholder, defaultValue, confirmText, cancelText)
 * @returns {Promise<string | null>}
 */
function showInput(title, message, options = {}) {
    const {
        placeholder = '请输入内容...',
        defaultValue = '',
        confirmText = '确定',
        cancelText = '取消',
        confirmColor = 'bg-emerald-500'
    } = options;

    return new Promise((resolve) => {
        const modal = document.createElement('div');
        modal.className = "fixed inset-0 z-[100] flex items-center justify-center p-4 animate-fade-in";
        modal.innerHTML = `
            <div class="absolute inset-0 bg-black/60 backdrop-blur-sm transition-opacity duration-300"></div>
            <div class="t-bg-panel rounded-xl shadow-2xl w-full max-w-sm overflow-hidden transform transition-all animate-slide-up relative z-10 border t-border-main">
                <!-- Header -->
                <div class="px-5 py-4 border-b border-emerald-100/50 flex justify-between items-center bg-emerald-50/50">
                    <h3 class="text-sm font-bold t-text-main">${title}</h3>
                    <button id="modal-close-x" class="t-text-muted hover:text-emerald-500 transition-colors">
                        <i class="fas fa-times text-lg"></i>
                    </button>
                </div>
                <!-- Body -->
                <div class="p-6">
                    <div class="flex items-start gap-4 mb-4">
                        <div class="w-10 h-10 rounded-full bg-emerald-50 text-emerald-500 flex items-center justify-center shrink-0">
                            <i class="fas fa-edit text-lg"></i>
                        </div>
                        <div class="flex-1">
                            <p class="text-sm t-text-muted leading-relaxed mb-4">${message}</p>
                            <input type="text" id="modal-input" 
                                class="w-full px-4 py-2.5 t-bg-main border t-border-main rounded-xl focus:outline-none focus:ring-2 focus:ring-emerald-500 transition-all text-sm"
                                placeholder="${placeholder}" value="${defaultValue}">
                        </div>
                    </div>
                </div>
                <!-- Footer -->
                <div class="p-4 t-bg-main/50 border-t t-border-main/50 flex gap-3 flex-row-reverse">
                    <button id="confirm-ok" class="flex-1 py-2.5 text-sm font-bold text-white ${confirmColor} hover:opacity-90 rounded-xl shadow-lg transition-all active:scale-95">
                        ${confirmText}
                    </button>
                    <button id="confirm-cancel" class="flex-1 py-2.5 text-sm font-bold t-text-muted hover:t-text-main hover:bg-gray-100 dark:hover:bg-gray-700 rounded-xl transition-all">
                        ${cancelText}
                    </button>
                </div>
            </div>
        `;

        document.body.appendChild(modal);

        const input = modal.querySelector('#modal-input');
        input.focus();
        if (defaultValue) input.select();

        const close = (result) => {
            const content = modal.querySelector('.max-w-sm');
            if (content) {
                content.classList.add('scale-95', 'opacity-0');
            }
            modal.classList.add('opacity-0');
            setTimeout(() => {
                modal.remove();
                resolve(result);
            }, 200);
        };

        modal.querySelector('#confirm-ok').onclick = () => close(input.value.trim() || null);
        modal.querySelector('#confirm-cancel').onclick = () => close(null);
        modal.querySelector('#modal-close-x').onclick = () => close(null);
        modal.querySelector('div:first-child').onclick = () => close(null);

        input.onkeydown = (e) => {
            if (e.key === 'Enter') close(input.value.trim() || null);
            if (e.key === 'Escape') close(null);
        };
    });
}


//确认弹窗
function showSelect(title, message, options = {}) {
    const {
        confirmText = '确定',
        cancelText = '取消',
        confirmColor = 'bg-emerald-500',
        danger = false
    } = options;

    const btnColor = danger ? 'bg-red-500 hover:bg-red-600 shadow-red-100' : `${confirmColor} hover:opacity-90 shadow-emerald-100`;

    return new Promise((resolve) => {
        const modal = document.createElement('div');
        modal.className = "fixed inset-0 z-[100] flex items-center justify-center p-4 animate-fade-in";
        modal.innerHTML = `
            <div class="absolute inset-0 bg-black/60 backdrop-blur-sm transition-opacity duration-300"></div>
            <div class="t-bg-panel rounded-2xl shadow-2xl w-full max-w-sm overflow-hidden transform transition-all animate-slide-up relative z-10 border t-border-main">
                <!-- Header -->
                <div class="px-5 py-4 border-b border-emerald-100/50 flex justify-between items-center bg-emerald-50/50">
                    <h3 class="text-sm font-bold t-text-main">${title}</h3>
                    <button id="modal-close-x" class="t-text-muted hover:text-emerald-500 transition-colors">
                        <i class="fas fa-times text-lg"></i>
                    </button>
                </div>
                <!-- Body -->
                <div class="p-6">
                    <div class="flex items-start gap-4">
                        <div class="w-10 h-10 rounded-full ${danger ? 'bg-red-50 text-red-500' : 'bg-emerald-50 text-emerald-500'} flex items-center justify-center shrink-0">
                            <i class="fas ${danger ? 'fa-exclamation-triangle' : 'fa-question-circle'} text-lg"></i>
                        </div>
                        <div class="flex-1">
                            <p class="text-sm t-text-muted leading-relaxed">${message}</p>
                        </div>
                    </div>
                </div>
                <!-- Footer -->
                <div class="p-4 t-bg-main/50 border-t t-border-main/50 flex gap-3 flex-row-reverse">
                    <button id="confirm-ok" class="flex-1 py-2.5 text-sm font-bold text-white ${btnColor} rounded-xl shadow-lg transition-all active:scale-95">
                        ${confirmText}
                    </button>
                    <button id="confirm-cancel" class="flex-1 py-2.5 text-sm font-bold t-text-muted hover:t-text-main hover:bg-gray-100 dark:hover:bg-gray-700 rounded-xl transition-all">
                        ${cancelText}
                    </button>
                </div>
            </div>
        `;

        document.body.appendChild(modal);

        const close = (result) => {
            const content = modal.querySelector('.max-w-sm');
            if (content) {
                content.classList.add('scale-95', 'opacity-0');
            }
            modal.classList.add('opacity-0');
            setTimeout(() => {
                modal.remove();
                resolve(result);
            }, 200);
        };

        modal.querySelector('#confirm-ok').onclick = () => close(true);
        modal.querySelector('#confirm-cancel').onclick = () => close(false);
        modal.querySelector('#modal-close-x').onclick = () => close(false);
        modal.querySelector('div:first-child').onclick = () => close(false);
    });
}

// 通用 Toast 显示函数 (支持宽屏、滚动文字、点击重置倒计时)
function showToast(type, message, duration = 3000) {
    const config = {
        success: { bg: 'bg-emerald-500', icon: 'fa-check-circle' },
        info: { bg: 'bg-blue-500', icon: 'fa-info-circle' },
        error: { bg: 'bg-red-500', icon: 'fa-exclamation-circle' }
    };
    const conf = config[type] || config.info;

    const toast = document.createElement('div');
    // 加大宽度 (w-80 / w-96), 允许点击交互, 添加 cursor-pointer
    toast.className = `fixed bottom-24 right-4 ${conf.bg} text-white px-4 py-3 rounded-lg shadow-lg z-[1000] animate-slide-in flex items-center gap-3 w-80 md:w-96 max-w-[90vw] cursor-pointer transition-all duration-300`;

    // 判断文字长度，长文字启用滚动显示
    // 假设中文占2字符宽，英文1字符。w-96大约容纳25-30个汉字。
    // 这里简单按长度判断，超过 20 字则启用滚动
    const isLongText = message.length > 20;

    let contentHtml = '';
    if (isLongText) {
        // Marquee 结构: 使用 index.html 定义的 animate-marquee
        // 注意: animate-marquee 是 translateX(-50%)，所以需要双重内容
        contentHtml = `
            <div class="flex-1 overflow-hidden relative h-6 group mask-image-linear-fade">
                <div class="whitespace-nowrap absolute animate-marquee flex gap-8 items-center h-full">
                    <span>${message}</span>
                    <span>${message}</span>
                </div>
            </div>
        `;
    } else {
        contentHtml = `<span class="flex-1 font-medium truncate">${message}</span>`;
    }

    toast.innerHTML = `
        <i class="fas ${conf.icon} text-xl shrink-0"></i>
        ${contentHtml}
    `;

    document.body.appendChild(toast);

    // 倒计时逻辑
    let hideTimer = null;

    const startTimer = () => {
        if (hideTimer) clearTimeout(hideTimer);
        hideTimer = setTimeout(() => {
            toast.classList.add('opacity-0', 'translate-y-4'); // 向下滑出
            setTimeout(() => toast.remove(), 300);
        }, duration);
    };

    startTimer();

    // 点击事件: 重新计时 (用户请求: 点击了那个信息就重新计时隐藏)
    toast.addEventListener('click', () => {
        // 视觉反馈
        toast.classList.add('scale-[1.02]', 'brightness-110');
        setTimeout(() => toast.classList.remove('scale-[1.02]', 'brightness-110'), 150);

        // 重置计时器
        startTimer();
        console.log('[Toast] Timer reset by click');
    });

    // 鼠标悬停暂停计时 (优化体验)
    toast.addEventListener('mouseenter', () => {
        if (hideTimer) clearTimeout(hideTimer);
    });

    toast.addEventListener('mouseleave', () => {
        startTimer();
    });
}

// 封装旧 API
function showSuccess(message) { showToast('success', message, 2000); }
function showInfo(message) { showToast('info', message, 3000); }
function showError(message) { showToast('error', message, 4000); }

/**
 * 分步展示播放尝试日志
 * @param {Array} attempts - [{name, status, message}]
 */
function showPlaybackAttempts(attempts) {
    if (!attempts || !attempts.length) return;
    attempts.forEach((attempt, index) => {
        setTimeout(() => {
            const msg = `[${attempt.name}] ${attempt.message || (attempt.status === 'success' ? '解析成功' : '解析失败')}`;
            if (attempt.status === 'success') {
                showSuccess(msg);
            } else {
                showError(msg);
            }
        }, index * 300); // 间隔展示，避免瞬间堆叠
    });
}

// ========================================
// Sleep Timer Logic
// ========================================

let sleepTimerId = null;
let sleepTimerEnd = 0;

function openSleepTimerModal() {
    const modal = document.getElementById('sleep-timer-modal');
    const content = document.getElementById('sleep-timer-modal-content');
    if (!modal || !content) return;

    modal.classList.remove('hidden');
    modal.classList.add('flex');

    // Trigger animation
    requestAnimationFrame(() => {
        content.classList.remove('scale-95', 'opacity-0');
        content.classList.add('scale-100', 'opacity-100');
    });

    updateSleepTimerModalUI();
}

function closeSleepTimerModal() {
    const modal = document.getElementById('sleep-timer-modal');
    const content = document.getElementById('sleep-timer-modal-content');
    if (!modal || !content) return;

    content.classList.add('scale-95', 'opacity-0');
    content.classList.remove('scale-100', 'opacity-100');

    setTimeout(() => {
        modal.classList.add('hidden');
        modal.classList.remove('flex');
    }, 300);
}

function setSleepTimer(minutes) {
    cancelSleepTimer();
    const durationMs = minutes * 60 * 1000;
    sleepTimerEnd = Date.now() + durationMs;

    startSleepTimerLoop();
    closeSleepTimerModal();
    showSuccess(`已设置 ${minutes} 分钟后停止播放`);
}

function cancelSleepTimer() {
    if (sleepTimerId) {
        clearInterval(sleepTimerId);
        sleepTimerId = null;
    }
    sleepTimerEnd = 0;

    const countdown = document.getElementById('sleep-timer-countdown');
    const triggerIcon = document.querySelector('#sleep-timer-trigger i');
    const activeStatus = document.getElementById('active-timer-status');

    if (countdown) countdown.classList.add('hidden');
    if (activeStatus) activeStatus.classList.add('hidden');
    if (triggerIcon) {
        triggerIcon.classList.replace('fas', 'far');
        triggerIcon.classList.remove('text-emerald-500');
    }
}

function startSleepTimerLoop() {
    const countdown = document.getElementById('sleep-timer-countdown');
    const triggerIcon = document.querySelector('#sleep-timer-trigger i');

    if (countdown) countdown.classList.remove('hidden');
    if (triggerIcon) {
        triggerIcon.classList.replace('far', 'fas');
        triggerIcon.classList.add('text-emerald-500');
    }

    updateSleepTimerDisplay();
    sleepTimerId = setInterval(() => {
        updateSleepTimerDisplay();
    }, 1000);
}

function updateSleepTimerDisplay() {
    const now = Date.now();
    const remain = sleepTimerEnd - now;

    if (remain <= 0) {
        finishSleepTimer();
        return;
    }

    const minutes = Math.floor(remain / 60000);
    const seconds = Math.floor((remain % 60000) / 1000);
    const timeStr = `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;

    const countdown = document.getElementById('sleep-timer-countdown');
    const statusCountdown = document.getElementById('status-countdown');

    if (countdown) countdown.innerText = timeStr;
    if (statusCountdown) statusCountdown.innerText = timeStr;
}

function finishSleepTimer() {
    cancelSleepTimer();
    // Use audio.pause directly or togglePlay if music is active
    if (audio && !audio.paused) {
        audio.pause();
        updatePlayButton(false);
        showInfo('睡眠时间到，音乐已停止播放 🌙');
    }
}

function updateSleepTimerModalUI() {
    const activeStatus = document.getElementById('active-timer-status');
    const customInput = document.getElementById('custom-timer-input');

    if (activeStatus) {
        if (sleepTimerEnd > Date.now()) {
            activeStatus.classList.remove('hidden');
        } else {
            activeStatus.classList.add('hidden');
        }
    }
    if (customInput) customInput.classList.add('hidden');
}

function showCustomTimerInput() {
    const input = document.getElementById('custom-timer-input');
    if (input) input.classList.remove('hidden');
}

function applyCustomTimer() {
    const inputEl = document.getElementById('custom-minutes');
    const val = parseInt(inputEl.value);
    if (val > 0) {
        setSleepTimer(val);
        inputEl.value = '';
    } else {
        showError('请输入正确的时间（分钟）');
    }
}

// 监听模态框外部点击关闭
document.addEventListener('mousedown', (e) => {
    const modal = document.getElementById('sleep-timer-modal');
    const content = document.getElementById('sleep-timer-modal-content');
    if (modal && !modal.classList.contains('hidden') && e.target === modal) {
        closeSleepTimerModal();
    }
});

// 监听窗口大小变化
window.addEventListener('resize', () => {
    const indicator = document.getElementById('lyric-scroll-indicator');
    if (indicator) {
        indicator.dataset.positioned = '';
    }
});

// ========== 页面初始化 ==========
document.addEventListener('DOMContentLoaded', () => {
    console.log('[Init] 页面加载完成');

    // 预加载自定义源数据，确保设置界面和模态框打开时有数据
    loadCustomSources();

    // 默认在搜索界面，直接显示热搜
    if (typeof showInitialSearchState === 'function') {
        showInitialSearchState();
    }

    // [Fix] Listen to scroll event for real-time highlighting
    const lyricContainer = document.getElementById('lyric-container');
    if (lyricContainer) {
        // Core user interaction detection
        // 只有当用户真的 "摸" 了或者是 "滑" 了，才认为是用户滚动
        // 纯 scroll 事件会被 scrollTo 触发，所以不能仅依赖 scroll 事件来 *启动* 手动模式
        const setUserInteracting = () => {
            // 强制清除程序滚动标记，因为用户干预了
            isProgrammaticScroll = false;
            if (window.programmaticScrollTimer) {
                clearTimeout(window.programmaticScrollTimer);
                window.programmaticScrollTimer = null;
            }
        };

        lyricContainer.addEventListener('mousedown', setUserInteracting, { passive: true });
        lyricContainer.addEventListener('touchstart', setUserInteracting, { passive: true });
        lyricContainer.addEventListener('touchmove', setUserInteracting, { passive: true });
        lyricContainer.addEventListener('wheel', setUserInteracting, { passive: true });
        lyricContainer.addEventListener('keydown', setUserInteracting, { passive: true }); // Keyboard arrow keys

        // 使用 passive: true 提高滚动性能
        lyricContainer.addEventListener('scroll', handleLyricScroll, { passive: true });
    }

    // 绑定音质选择
    const qualitySelect = document.getElementById('quality-select');
    if (qualitySelect && settings.preferredQuality) {
        qualitySelect.value = settings.preferredQuality;
    }

    // 恢复其他设置
    loadSettings();
    restorePlaybackState();

    // 监听源切换，自动刷新热搜
    const searchSourceSelect = document.getElementById('search-source');
    if (searchSourceSelect) {
        searchSourceSelect.addEventListener('change', () => {
            const searchInput = document.getElementById('search-input');
            // 仅当搜索框为空（即处于显示热搜状态）时刷新
            if (!searchInput || !searchInput.value.trim()) {
                showInitialSearchState();
            }
        });
    }

    // [Fix] Auto-Login logic (Restore Session)
    const savedMode = localStorage.getItem('lx_sync_mode');
    if (savedMode === 'local') {
        const u = localStorage.getItem('lx_sync_user');
        const p = localStorage.getItem('lx_sync_pass');
        if (u && p) {
            console.log('[AutoLogin] 检测到本地账户，正在自动登录...');
            // Fill UI
            document.getElementById('sync-local-user').value = u;
            document.getElementById('sync-local-pass').value = p;
            // Trigger login
            handleLocalLogin();
        }
    } else if (savedMode === 'remote') {
        const url = localStorage.getItem('lx_sync_url');
        const code = localStorage.getItem('lx_sync_code');
        if (url && code) {
            console.log('[AutoLogin] 检测到远程同步设置，正在自动连接...');
            // Fill UI
            document.getElementById('sync-remote-url').value = url;
            document.getElementById('sync-remote-step1').classList.add('hidden');
            document.getElementById('sync-remote-step2').classList.remove('hidden');
            document.getElementById('sync-remote-code').value = code;
            // Trigger connect
            handleRemoteConnect();
        }
    }

    // [New] 全局精简播放栏控制函数
    window.setCompactPlaybar = function (compact, showToastMsg = false) {
        const infoEl = document.getElementById('player-song-info');
        const collapseBtn = document.getElementById('btn-collapse-panel');
        if (!infoEl) return;

        if (compact) {
            infoEl.style.display = 'none';
            if (collapseBtn) collapseBtn.style.display = 'none';
            if (showToastMsg) showToast('info', '已开启精简播放控制栏', 1500);
        } else {
            infoEl.style.display = '';
            if (collapseBtn) collapseBtn.style.display = '';
            if (showToastMsg) showToast('info', '已恢复完整播放栏控制', 1500);
        }

        // 重新计算并应用底栏自适应布局高度 (解决手机端 Footer 高度重叠)
        if (window.musicVisualizer && window.musicVisualizer.applySettings) {
            setTimeout(() => window.musicVisualizer.applySettings(), 50);
        }
    };

    // [New] 长按播放键隐藏播放栏内容 (精简模式)
    const btnPlay = document.getElementById('btn-play');
    if (btnPlay) {
        let pressTimer;
        const infoEl = document.getElementById('player-song-info');

        const startPress = (e) => {
            if (e.type === 'mousedown' && e.button !== 0) return; // 仅限左键
            window.playBtnIsLongPress = false;
            pressTimer = setTimeout(() => {
                window.playBtnIsLongPress = true;
                if (navigator.vibrate) navigator.vibrate(50);

                if (infoEl) {
                    const isHidden = infoEl.style.display === 'none';
                    window.setCompactPlaybar(!isHidden, true);
                }
            }, 600); // 600ms = 长按
        };

        const cancelPress = () => {
            if (pressTimer) clearTimeout(pressTimer);
        };

        // 事件绑定
        btnPlay.addEventListener('mousedown', startPress);
        btnPlay.addEventListener('touchstart', startPress, { passive: true });
        btnPlay.addEventListener('mouseup', cancelPress);
        btnPlay.addEventListener('touchend', cancelPress);
        btnPlay.addEventListener('mouseleave', cancelPress);
        btnPlay.addEventListener('touchcancel', cancelPress);
    }
});

// ========================================
// Global Overrides
// ========================================

// Override batch_pagination.js helper to access local currentSearchScope
window.getCurrentActiveListId = function () {
    if (currentSearchScope === 'local_list') return window.currentViewingListId;
    if (currentSearchScope === 'local_all') return 'love';
    return null;
};



// ========================================
// Mobile Optimization Logic
// ========================================

// Mobile Sidebar Toggle
function toggleSidebar() {
    const sidebar = document.getElementById('main-sidebar');
    const backdrop = document.getElementById('mobile-sidebar-backdrop');

    if (sidebar.classList.contains('-translate-x-full')) {
        // Open
        sidebar.classList.remove('-translate-x-full');
        sidebar.classList.add('translate-x-0');
        backdrop.classList.remove('hidden');
    } else {
        // Close
        sidebar.classList.remove('translate-x-0');
        sidebar.classList.add('-translate-x-full');
        backdrop.classList.add('hidden');
    }
}

// Auto-adjust layout on resize
window.addEventListener('resize', () => {
    const sidebar = document.getElementById('main-sidebar');
    const backdrop = document.getElementById('mobile-sidebar-backdrop');

    if (sidebar && window.innerWidth >= 768) {
        // Reset styles for desktop
        sidebar.classList.remove('-translate-x-full', 'translate-x-0');
        if (backdrop) backdrop.classList.add('hidden');
    } else if (sidebar) {
        // Ensure default closed state for mobile if not explicitly open
        if (!sidebar.classList.contains('translate-x-0')) {
            sidebar.classList.add('-translate-x-full');
        }
    }
});

// 切换详情页封面显示（移动端优化）
function toggleDetailCover() {
    const cover = document.getElementById('mobile-player-cover-container');
    const container = document.getElementById('player-detail-container');
    const lyricsWrapper = document.getElementById('lyrics-wrapper');
    const lyricContent = document.getElementById('lyric-content');

    // 获取标题区域父容器
    const titleParent = lyricsWrapper ? lyricsWrapper.querySelector('div:first-child') : null;

    if (!cover || !container) return;

    // 根据 cover 的透明度状态判断当前是否隐藏
    const isHidden = cover.classList.contains('opacity-0');

    if (!isHidden) {
        // --- 隐藏封面 ---
        cover.style.display = 'none'; // 彻底移除渲染占位
        cover.classList.add('opacity-0', 'scale-90', 'border-0');

        // 隐藏封面时，不再需要那么大的 pt-8/md:pt-32。
        // 保留 md:pt-10 左右以避开顶部 Now Playing 即可，让歌词有更多纵向空间
        container.classList.remove('pt-8', 'mt-4', 'md:pt-0', 'md:pt-24');
        container.classList.add('pt-4', 'md:pt-10');

        if (lyricsWrapper) {
            lyricsWrapper.classList.remove('md:w-auto', 'md:max-w-[50%]', 'md:w-[500px]', 'lg:w-[600px]', 'flex-shrink-0');
            lyricsWrapper.classList.add('md:w-2/3', 'mx-auto', 'lyrics-centered');
            // 隐藏封面时允许歌词区域更高
            lyricsWrapper.style.maxHeight = '85vh';
        }

        if (lyricContent) {
            lyricContent.classList.remove('md:items-start', 'md:text-left', 'md:pl-6');
            lyricContent.classList.add('items-center', 'text-center');
        }

        if (titleParent) {
            titleParent.classList.remove('md:text-left', 'md:pl-6');
            titleParent.classList.add('text-center');
        }

        container.classList.add('has-centered-lyrics');

    } else {
        // --- 显示封面 ---
        cover.style.display = 'block'; // 恢复显示
        cover.classList.remove('opacity-0', 'scale-90', 'border-0');

        container.classList.remove('has-centered-lyrics');

        // 恢复当前使用的固定间距
        container.classList.add('gap-4', 'md:gap-20');
        container.classList.remove('pt-8', 'md:pt-32', 'md:pt-10'); // 移除纯歌词专用间距

        // 手机端恢复默认 pt
        if (window.innerWidth < 768) {
            container.classList.add('pt-8', 'mt-4');
        }


        if (lyricsWrapper) {
            lyricsWrapper.classList.remove('md:w-auto', 'md:max-w-[50%]', 'md:w-2/3', 'mx-auto', 'lyrics-centered');
            // 锁定桌面端宽度，防止长短歌词导致封面抖动
            lyricsWrapper.classList.add('md:w-[500px]', 'lg:w-[600px]', 'flex-shrink-0');
            lyricsWrapper.style.maxHeight = ''; // 恢复默认值
        }

        if (lyricContent) {
            lyricContent.classList.add('items-center', 'md:items-start', 'text-center', 'md:text-left', 'md:pl-6');
        }

        if (titleParent) {
            titleParent.classList.add('text-center', 'md:text-left', 'md:pl-6');
        }
    }
}

// 启动展开按钮淡化计时器
function startExpandBtnTimer() {
    const expandBtn = document.getElementById('btn-expand-panel');
    if (!expandBtn) return;

    if (expandBtnTimeout) clearTimeout(expandBtnTimeout);
    expandBtn.classList.remove('faint');

    expandBtnTimeout = setTimeout(() => {
        // 只有当播放栏仍处于隐藏状态时才淡化
        const footer = document.getElementById('player-footer');
        if (footer && footer.classList.contains('translate-y-[110%]')) {
            expandBtn.classList.add('faint');
        }
    }, 3000);
}

// 启动歌词按钮淡化计时器
function startToggleLyricsBtnTimer() {
    const toggleBtn = document.getElementById('btn-toggle-lyrics');
    if (!toggleBtn) return;

    if (toggleLyricsBtnTimeout) clearTimeout(toggleLyricsBtnTimeout);
    toggleBtn.classList.remove('faint');

    toggleLyricsBtnTimeout = setTimeout(() => {
        // 只有当歌词页面处于显示状态时才淡化
        const view = document.getElementById('view-player-detail');
        if (view && !view.classList.contains('translate-y-[100%]')) {
            toggleBtn.classList.add('faint');
        }
    }, 3000);
}

// 切换底部播放栏显示/隐藏 (移动端)
function togglePlayerPanel() {
    const footer = document.getElementById('player-footer');
    const expandBtn = document.getElementById('btn-expand-panel');
    const container = document.getElementById('player-detail-container');

    if (!footer || !expandBtn) return;

    // 检查是否已经隐藏 (通过 transform 判断)
    // 注意: Tailwind 的 translate-y-full 等同于 transform: translateY(100%)
    const isHidden = footer.classList.contains('translate-y-[110%]');

    const views = ['view-search', 'view-settings', 'view-favorites', 'view-about', 'main-sidebar', 'view-songlist', 'songlist-detail-view'];
    const playerDetail = document.getElementById('view-player-detail');
    const lyricsWrapper = document.getElementById('lyrics-wrapper');

    if (isHidden) {
        // 显示播放栏
        footer.classList.remove('translate-y-[110%]');
        footer.style.opacity = '1';
        footer.style.pointerEvents = 'auto';

        // 隐藏展开按钮
        expandBtn.classList.remove('translate-y-0', 'scale-100', 'opacity-100');
        expandBtn.classList.add('translate-y-20', 'scale-75', 'opacity-0');

        // 重置状态
        if (expandBtnTimeout) clearTimeout(expandBtnTimeout);
        expandBtn.classList.remove('faint');

        // 恢复内容底部 Padding
        views.forEach(id => {
            const el = document.getElementById(id);
            if (el) {
                el.classList.remove('pb-32', 'pb-44');
                el.classList.add('pb-44', 'md:pb-32');
            }
        });

        // 歌词页: 增加底部 Padding (避开播放栏)
        if (playerDetail) {
            playerDetail.classList.add('pb-24');
            playerDetail.classList.remove('pb-0');
        }

        // 桌面端: 恢复 md:pt-0 (垂直居中, 无顶部Padding)
        if (container) {
            container.classList.remove('translate-y-12', 'opacity-80', 'scale-95');
            container.classList.remove('md:pt-24', 'md:pt-12');
            container.classList.add('md:pt-0');
        }
    } else {
        // 隐藏播放栏 (向下移出屏幕) 
        footer.classList.add('translate-y-[110%]');
        footer.style.opacity = '0';
        footer.style.pointerEvents = 'none';

        // 停止动画并清除可视化画布，防止在偏移后仍有残留渲染
        if (window.musicVisualizer && window.musicVisualizer.clear) {
            window.musicVisualizer.clear('footer');
        }
        setTimeout(() => {
            expandBtn.classList.remove('translate-y-20', 'scale-75', 'opacity-0');
            expandBtn.classList.add('translate-y-0', 'scale-100', 'opacity-100');
        }, 300);

        // 开启 3s 自动淡化计时器
        startExpandBtnTimer();

        // 移除内容底部 Padding (内容延伸到底部)
        views.forEach(id => {
            const el = document.getElementById(id);
            if (el) el.classList.remove('pb-32', 'pb-44');
        });

        // 歌词页: 移除底部 Padding (利用底部空间)
        if (playerDetail) {
            playerDetail.classList.remove('pb-24');
            playerDetail.classList.add('pb-0');
        }

        // 桌面端: 移除 md:pt-0, 添加 md:pt-24 (避免遮挡顶部 NOW PLAYING)
        // 调整内容容器以填满全屏
        if (container) {
            container.classList.remove('md:pt-0');
            container.classList.add('md:pt-24');
            container.classList.add('translate-y-12', 'opacity-80', 'scale-95');
            // 稍后移除微调，保持丝滑
            setTimeout(() => {
                container.classList.remove('translate-y-12', 'opacity-80', 'scale-95');
            }, 600);
        }
    }

    // [New] 触发可视化模块更新布局 (Padding 处理)
    if (window.musicVisualizer) {
        window.musicVisualizer.applySettings();
    }

    // 重新校准歌词位置 (动画结束后执行)
    setTimeout(() => {
        scrollToActiveLine(true);
    }, 300);
}

// 导出函数
window.togglePlayerPanel = togglePlayerPanel;
