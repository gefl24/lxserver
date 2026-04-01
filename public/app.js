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


const API_BASE = '';

class App {
    constructor() {
        this.password = null;
        this.currentView = 'dashboard';
        this.users = [];
        this.init();
        this.initVersion();
    }

    init() {
        // 检查是否已登录
        const savedPassword = localStorage.getItem('lx_auth');
        if (savedPassword) {
            this.password = savedPassword;
            this.showApp();
            this.loadDashboard();
        }

        // 绑定登录事件
        document.getElementById('login-btn')?.addEventListener('click', () => this.login());
        document.getElementById('access-password')?.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') this.login();
        });

        // 绑定退出登录
        document.getElementById('logout-btn')?.addEventListener('click', () => this.logout());

        // 绑定导航
        document.querySelectorAll('.nav-item').forEach(item => {
            item.addEventListener('click', (e) => {
                e.preventDefault();
                const view = item.dataset.view;
                this.switchView(view);
            });
        });

        // 绑定快速操作
        document.querySelectorAll('.action-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const action = btn.dataset.action;
                this.handleQuickAction(action);
            });
        });

        // 用户管理
        document.getElementById('add-user-btn')?.addEventListener('click', () => this.showAddUserModal());
        // 新增：批量删除和全选
        document.getElementById('batch-delete-users-btn')?.addEventListener('click', () => this.batchDeleteUsers());
        document.getElementById('select-all-users')?.addEventListener('change', (e) => this.toggleAllUsers(e.target.checked));

        // 新增：密码修改模态框事件
        document.getElementById('save-password-btn')?.addEventListener('click', () => this.saveNewPassword());
        // 绑定所有模态框关闭按钮
        document.querySelectorAll('.modal-close').forEach(btn => {
            btn.addEventListener('click', () => {
                document.getElementById('edit-password-modal')?.classList.add('hidden');
                document.getElementById('modal')?.classList.add('hidden');
            });
        });

        document.getElementById('restart-server-btn')?.addEventListener('click', () => {
            this.restartServer()
        })

        // 数据查看
        document.getElementById('refresh-data-btn')?.addEventListener('click', () => this.loadUserData());
        document.getElementById('data-user-select')?.addEventListener('change', () => this.loadUserData());

        // 配置管理
        document.getElementById('config-form')?.addEventListener('submit', (e) => {
            e.preventDefault();
            this.saveConfig();
        });
        document.getElementById('reload-config-btn')?.addEventListener('click', () => this.loadConfig());

        // 日志查看
        document.getElementById('refresh-logs-btn')?.addEventListener('click', () => this.loadLogs());
        document.getElementById('log-type-select')?.addEventListener('change', () => this.loadLogs());

        // 模态框
        document.querySelector('.modal-close')?.addEventListener('click', () => this.closeModal());
        document.getElementById('modal')?.addEventListener('click', (e) => {
            if (e.target.id === 'modal') this.closeModal();
        });
        document.getElementById('data-user-select')?.addEventListener('change', () => this.loadUserData());

        // 快照管理用户选择事件
        document.getElementById('snapshot-user-select')?.addEventListener('change', () => this.loadSnapshots());
        // WebDAV 和文件管理器
        this.bindWebDAVEvents();
        this.bindFileManagerEvents();

        // PWA 安装事件
        this.deferredPrompt = null;
        window.addEventListener('beforeinstallprompt', (e) => {
            e.preventDefault();
            this.deferredPrompt = e;
            const installBtn = document.getElementById('install-pwa-btn');
            if (installBtn) {
                installBtn.style.display = 'inline-flex';
                installBtn.addEventListener('click', () => this.installPWA());
            }
        });

        // [新增] 绑定上传事件
        document.getElementById('snapshot-upload-input')?.addEventListener('change', (e) => this.handleSnapshotUpload(e));

        // Mobile Menu Events
        this.initMobileEvents();
    }

    initMobileEvents() {
        const mobileMenuBtn = document.getElementById('mobile-menu-btn');
        const mobileSidebarOverlay = document.getElementById('mobile-sidebar-overlay');
        const sidebar = document.querySelector('.sidebar');

        const toggleMobileSidebar = () => {
            if (!sidebar || !mobileSidebarOverlay) return;

            sidebar.classList.toggle('active');
            mobileSidebarOverlay.classList.toggle('active');

            if (mobileSidebarOverlay.classList.contains('active')) {
                mobileSidebarOverlay.classList.remove('hidden');
            } else {
                // Wait for animation to finish before hiding
                setTimeout(() => {
                    if (!mobileSidebarOverlay.classList.contains('active')) {
                        mobileSidebarOverlay.classList.add('hidden');
                    }
                }, 300);
            }
        };

        if (mobileMenuBtn) {
            mobileMenuBtn.addEventListener('click', toggleMobileSidebar);
        }

        if (mobileSidebarOverlay) {
            mobileSidebarOverlay.addEventListener('click', toggleMobileSidebar);
        }

        // Close on nav click (mobile only)
        document.querySelectorAll('.nav-item').forEach(item => {
            item.addEventListener('click', () => {
                if (window.innerWidth <= 768 && sidebar && sidebar.classList.contains('active')) {
                    toggleMobileSidebar();
                }
            });
        });
    }

    async installPWA() {
        if (!this.deferredPrompt) return;
        this.deferredPrompt.prompt();
        const { outcome } = await this.deferredPrompt.userChoice;
        console.log(`User response to the install prompt: ${outcome}`);
        this.deferredPrompt = null;
        document.getElementById('install-pwa-btn').style.display = 'none';
    }

    async login() {
        const password = document.getElementById('access-password').value;
        const errorEl = document.getElementById('login-error');

        if (!password) {
            errorEl.textContent = '请输入密码';
            return;
        }

        try {
            const res = await this.request('/api/login', {
                method: 'POST',
                body: JSON.stringify({ password })
            });

            if (res.success) {
                this.password = password;
                localStorage.setItem('lx_auth', password);
                this.showApp();
                this.loadDashboard();
            } else {
                errorEl.textContent = '密码错误';
            }
        } catch (err) {
            errorEl.textContent = '登录失败，请重试';
        }
    }

    logout() {
        localStorage.removeItem('lx_auth');
        location.reload();
    }

    showApp() {
        document.getElementById('login-overlay').classList.add('hidden');
        document.getElementById('app').classList.remove('hidden');
    }

    switchView(viewName) {
        // 更新导航状态
        document.querySelectorAll('.nav-item').forEach(item => {
            item.classList.toggle('active', item.dataset.view === viewName);
        });

        // 切换视图
        document.querySelectorAll('.view').forEach(view => {
            view.classList.toggle('active', view.id === `view-${viewName}`);
        });

        // 更新标题
        const titles = {
            dashboard: '仪表盘',
            users: '用户管理',
            data: '数据查看',
            config: '系统配置',
            logs: '系统日志',
            webdav: 'WebDAV同步',
            files: '文件管理',
            snapshots: '快照管理',
            about: '关于'
        };
        document.getElementById('page-title').textContent = titles[viewName] || viewName;

        this.currentView = viewName;

        // 加载对应数据
        switch (viewName) {
            case 'dashboard':
                this.loadDashboard();
                break;
            case 'users':
                this.loadUsers();
                break;
            case 'data':
                this.loadUserData();
                break;
            case 'config':
                this.loadConfig();
                break;
            case 'logs':
                this.loadLogs();
                break;
            case 'webdav':
                this.loadSyncLogs();
                break;
            case 'snapshots':
                this.loadSnapshots();
                break;
            case 'about':
                this.loadAbout();
                break;
            case 'files':
                // 跳转到新的 elFinder 文件管理器
                window.location.href = '/filemanager.html';
                return;
            case 'music':
                window.location.href = '/music';
                return;
        }
    }

    handleQuickAction(action) {
        switch (action) {
            case 'add-user':
                this.switchView('users');
                setTimeout(() => this.showAddUserModal(), 100);
                break;
            case 'view-logs':
                this.switchView('logs');
                break;
            case 'edit-config':
                this.switchView('config');
                break;
        }
    }

    async loadAbout() {
        const container = document.getElementById('about-content');
        if (!container) return;

        try {
            const response = await fetch('/about.md');
            if (!response.ok) throw new Error('Failed to load about.md');
            const text = await response.text();

            // Render Markdown
            if (window.marked) {
                // Replace {{version}} and {{buildHash}} placeholder
                const version = (window.CONFIG && window.CONFIG.version) || 'v1.0.0';
                const buildHash = (window.CONFIG && window.CONFIG.buildHash) || 'unknown';
                let content = text.replace(/{{version}}/g, version);
                content = content.replace(/{{buildHash}}/g, buildHash);
                container.innerHTML = window.marked.parse(content);
            } else {
                container.innerText = text;
            }
        } catch (e) {
            console.error('Failed to load about content:', e);
            container.innerHTML = '<p style="color: var(--accent-error); text-align: center;">加载关于页面失败</p>';
        }
    }

    checkForUpdates() {
        if (window.LxNotification && window.LxNotification.checkUpdates) {
            window.LxNotification.checkUpdates(true);
        } else {
            showInfo('通知服务未就绪，请稍后重试');
        }
    }

    initVersion() {
        if (window.CONFIG && window.CONFIG.version) {
            const versionEl = document.getElementById('console-version');
            if (versionEl) {
                versionEl.textContent = window.CONFIG.version;
                versionEl.classList.remove('hidden');
            }
            const sidebarVersionEl = document.getElementById('sidebar-version');
            if (sidebarVersionEl) {
                sidebarVersionEl.textContent = window.CONFIG.version;
                sidebarVersionEl.classList.remove('hidden');
            }
        }
    }

    async loadDashboard() {
        try {
            // [新增] 获取服务器状态
            const status = await this.request('/api/status');

            // 更新 UI
            document.getElementById('stat-users').textContent = status.users;
            document.getElementById('stat-devices').textContent = status.devices;
            document.getElementById('stat-uptime').textContent = this.formatUptime(status.uptime);
            document.getElementById('stat-memory').textContent = this.formatFileSize(status.memory);

            // 加载用户列表以填充数据查看下拉框
            const users = await this.request('/api/users');
            const userOptions = '<option value="">选择用户</option>' +
                users.map(u => `<option value="${u.name}">${u.name}</option>`).join('');

            // 填充数据查看页面的下拉框
            const dataSelect = document.getElementById('data-user-select');
            if (dataSelect) dataSelect.innerHTML = userOptions;

            // [新增] 填充快照管理页面的下拉框
            const snapshotSelect = document.getElementById('snapshot-user-select');
            if (snapshotSelect) snapshotSelect.innerHTML = userOptions;

        } catch (err) {
            console.error('Failed to load dashboard:', err);
        }
    }

    async loadUsers() {
        try {
            const users = await this.request('/api/users');
            this.users = users;
            this.renderUsers();
        } catch (err) {
            console.error('Failed to load users:', err);
        }
    }

    async batchDeleteUsers() {
        const checked = document.querySelectorAll('.user-checkbox:checked');
        // 使用 data-index 获取对应的用户对象
        const names = Array.from(checked).map(cb => {
            const index = parseInt(cb.dataset.index);
            return this.users[index]?.name;
        }).filter(name => name); // 过滤掉无效的 name

        if (!names.length) return;

        // 显示自定义确认对话框
        const deleteData = await this.showBatchDeleteUserDialog(names.length);
        if (deleteData === null) return; // 用户取消

        try {
            await this.request('/api/users', {
                method: 'DELETE',
                body: JSON.stringify({ names, deleteData })
            });
            this.loadUsers();
            showSuccess('批量删除成功');
        } catch (err) {
            showError('删除失败: ' + err.message);
        }
    }

    // 显示批量删除用户确认对话框
    async showBatchDeleteUserDialog(count) {
        return new Promise((resolve) => {
            const modal = document.getElementById('modal');
            const modalTitle = document.getElementById('modal-title');
            const modalBody = document.getElementById('modal-body');

            modalTitle.textContent = '批量删除用户确认';
            modalBody.innerHTML = `
                <div style="padding: 1rem 0;">
                    <p style="margin-bottom: 1rem; font-size: 1rem;">确定要删除选中的 <strong>${count}</strong> 个用户吗？</p>
                    <div class="form-group" style="margin-top: 1.5rem;">
                        <label class="checkbox-label" style="display: flex; align-items: center; cursor: pointer;">
                            <input type="checkbox" id="batch-delete-user-data-checkbox" style="margin-right: 0.5rem;">
                            <span>同时删除用户数据文件夹</span>
                        </label>
                        <small style="color: var(--text-secondary); display: block; margin-top: 0.5rem; margin-left: 1.5rem;">
                            ⚠️ 勾选后将永久删除所有选中用户的数据（歌单、收藏等），不可恢复！
                        </small>
                    </div>
                </div>
                <div class="form-actions" style="margin-top: 1.5rem;">
                    <button type="button" class="btn-primary" id="confirm-batch-delete-users">确认删除</button>
                    <button type="button" class="btn-secondary" id="cancel-batch-delete-users">取消</button>
                </div>
            `;

            modal.classList.remove('hidden');

            document.getElementById('confirm-batch-delete-users').addEventListener('click', () => {
                const deleteData = document.getElementById('batch-delete-user-data-checkbox').checked;
                modal.classList.add('hidden');
                resolve(deleteData);
            });

            document.getElementById('cancel-batch-delete-users').addEventListener('click', () => {
                modal.classList.add('hidden');
                resolve(null);
            });
        });
    }
    // 全选/取消全选用户
    toggleAllUsers(checked) {
        const checkboxes = document.querySelectorAll('.user-checkbox');
        checkboxes.forEach(cb => {
            cb.checked = checked;
        });
        this.updateUserBatchBtn();
    }

    // 更新批量删除按钮状态
    updateUserBatchBtn() {
        const checked = document.querySelectorAll('.user-checkbox:checked');
        const btn = document.getElementById('batch-delete-users-btn');
        const countSpan = document.getElementById('user-selected-count');

        if (btn && countSpan) {
            if (checked.length > 0) {
                btn.style.display = 'inline-flex';
                countSpan.textContent = checked.length;
            } else {
                btn.style.display = 'none';
            }
        }

        // 更新全选框状态（如果手动取消了某个子项，全选框也应取消）
        const selectAll = document.getElementById('select-all-users');
        if (selectAll) {
            const allCheckboxes = document.querySelectorAll('.user-checkbox');
            if (allCheckboxes.length > 0) {
                selectAll.checked = checked.length === allCheckboxes.length;
            } else {
                selectAll.checked = false;
            }
        }
    }
    renderUsers() {
        const container = document.getElementById('users-list');
        if (!this.users.length) {
            container.innerHTML = `
                <div class="glass" style="padding: 3rem; text-align: center; width: 100%;">
                    <p style="color: var(--text-secondary);">暂无用户，点击上方按钮添加用户</p>
                </div>
            `;
            return;
        }

        container.innerHTML = this.users.map((user, index) => `
            <div class="user-row glass">
                <div class="col-checkbox">
                    <input type="checkbox" class="user-checkbox" data-index="${index}" onchange="app.updateUserBatchBtn()">
                </div>
                <div class="col-name">
                    <div class="user-avatar">
                        <span>${user.name.charAt(0).toUpperCase()}</span>
                    </div>
                    <span>${this.escapeHtml(user.name)}</span>
                </div>
                <div class="col-password">
                    <span class="password-text" id="pwd-text-${index}">******</span>
                    <button class="btn-icon" onclick="app.togglePasswordVisibility(${index})" title="显示/隐藏">
                        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
                            <circle cx="12" cy="12" r="3"/>
                        </svg>
                    </button>
                    <button class="btn-icon" onclick="app.showEditPasswordModal(${index})" title="修改密码">
                        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
                            <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
                        </svg>
                    </button>
                </div>
                <div class="col-status">
                    <span class="status-badge active">活跃</span>
                </div>
                <div class="col-actions">
                    <button class="btn-delete" onclick="app.deleteUser(${index})" title="删除用户">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
                        </svg>
                    </button>
                </div>
            </div>
        `).join('');

        // 重置全选状态
        const selectAll = document.getElementById('select-all-users');
        if (selectAll) selectAll.checked = false;
        this.updateUserBatchBtn();
    }

    showAddUserModal() {
        const modal = document.getElementById('modal');
        const modalTitle = document.getElementById('modal-title');
        const modalBody = document.getElementById('modal-body');

        modalTitle.textContent = '添加用户';
        modalBody.innerHTML = `
            <form id="add-user-form">
                <div class="form-group">
                    <label>用户名</label>
                    <input type="text" name="name" class="form-input" required />
                </div>
                <div class="form-group">
                    <label>密码</label>
                    <input type="password" name="password" class="form-input" required />
                </div>
                <div class="form-actions">
                    <button type="submit" class="btn-primary">添加</button>
                    <button type="button" class="btn-secondary" onclick="app.closeModal()">取消</button>
                </div>
            </form>
        `;

        modal.classList.remove('hidden');

        document.getElementById('add-user-form').addEventListener('submit', async (e) => {
            e.preventDefault();
            const formData = new FormData(e.target);
            const data = Object.fromEntries(formData);

            try {
                await this.request('/api/users', {
                    method: 'POST',
                    body: JSON.stringify(data)
                });
                this.closeModal();
                this.loadUsers();
                this.loadDashboard();
            } catch (err) {
                showError('添加用户失败: ' + err.message);
            }
        });
    }

    // 切换密码显示/隐藏
    togglePasswordVisibility(index) {
        const user = this.users[index];
        if (!user) return;

        const el = document.getElementById(`pwd-text-${index}`);
        if (el.textContent === '******') {
            el.textContent = user.password;
        } else {
            el.textContent = '******';
        }
    }

    // 显示修改密码模态框
    showEditPasswordModal(index) {
        const user = this.users[index];
        if (!user) return;

        this.editingUser = user.name; // 保存当前正在编辑的用户名
        document.getElementById('edit-password-input').value = '';
        document.getElementById('edit-password-modal').classList.remove('hidden');
    }

    // 保存新密码
    async saveNewPassword() {
        const newPassword = document.getElementById('edit-password-input').value;
        if (!newPassword) {
            showInfo('请填写新密码');
            return;
        }

        try {
            await this.request('/api/users', {
                method: 'PUT',
                body: JSON.stringify({
                    name: this.editingUser,
                    password: newPassword
                })
            });

            document.getElementById('edit-password-modal').classList.add('hidden');
            this.loadUsers();
            showSuccess('密码修改成功');
        } catch (err) {
            showError('修改失败: ' + err.message);
        }
    }

    async deleteUser(index) {
        const user = this.users[index];
        if (!user) return;
        const username = user.name;

        // 显示自定义确认对话框
        const deleteData = await this.showDeleteUserDialog(username);
        if (deleteData === null) return; // 用户取消

        try {
            await this.request('/api/users', {
                method: 'DELETE',
                body: JSON.stringify({ name: username, deleteData })
            });
            this.loadUsers();
            this.loadDashboard();
        } catch (err) {
            showError('删除用户失败: ' + err.message);
        }
    }

    // 显示删除用户确认对话框
    async showDeleteUserDialog(username) {
        return new Promise((resolve) => {
            const modal = document.getElementById('modal');
            const modalTitle = document.getElementById('modal-title');
            const modalBody = document.getElementById('modal-body');

            modalTitle.textContent = '删除用户确认';
            modalBody.innerHTML = `
                <div style="padding: 1rem 0;">
                    <p style="margin-bottom: 1rem; font-size: 1rem;">确定要删除用户 <strong>"${this.escapeHtml(username)}"</strong> 吗？</p>
                    <div class="form-group" style="margin-top: 1.5rem;">
                        <label class="checkbox-label" style="display: flex; align-items: center; cursor: pointer;">
                            <input type="checkbox" id="delete-user-data-checkbox" style="margin-right: 0.5rem;">
                            <span>同时删除用户数据文件夹</span>
                        </label>
                        <small style="color: var(--text-secondary); display: block; margin-top: 0.5rem; margin-left: 1.5rem;">
                            ⚠️ 勾选后将永久删除该用户的所有数据（歌单、收藏等），不可恢复！
                        </small>
                    </div>
                </div>
                <div class="form-actions" style="margin-top: 1.5rem;">
                    <button type="button" class="btn-primary" id="confirm-delete-user">确认删除</button>
                    <button type="button" class="btn-secondary" id="cancel-delete-user">取消</button>
                </div>
            `;

            modal.classList.remove('hidden');

            document.getElementById('confirm-delete-user').addEventListener('click', () => {
                const deleteData = document.getElementById('delete-user-data-checkbox').checked;
                modal.classList.add('hidden');
                resolve(deleteData);
            });

            document.getElementById('cancel-delete-user').addEventListener('click', () => {
                modal.classList.add('hidden');
                resolve(null);
            });
        });
    }

    currentUserData = null;
    currentPlaylistView = null;

    async loadUserData() {
        const username = document.getElementById('data-user-select')?.value;
        if (!username) {
            document.getElementById('data-content').innerHTML = '<p style="color: var(--text-secondary); padding: 2rem; text-align: center;">请选择用户</p>';
            return;
        }

        try {
            const data = await this.request(`/api/data?user=${encodeURIComponent(username)}`);
            this.currentUserData = { username, data };

            // 统计数据
            let totalSongs = 0;
            const defaultCount = data.defaultList?.length || 0;
            const loveCount = data.loveList?.length || 0;
            const userListCount = data.userList?.length || 0;

            data.userList?.forEach(list => {
                totalSongs += list.list?.length || 0;
            });
            totalSongs += defaultCount + loveCount;

            document.getElementById('data-stats').innerHTML = `
                <div class="data-stat-card clickable" onclick="app.viewAllSongs()">
                    <h4>总歌曲数</h4>
                    <div class="value">${totalSongs}</div>
                </div>
                <div class="data-stat-card clickable" onclick="app.viewSystemList('default')">
                    <h4>试听列表</h4>
                    <div class="value">${defaultCount}</div>
                </div>
                <div class="data-stat-card clickable" onclick="app.viewSystemList('love')">
                    <h4>我的收藏</h4>
                    <div class="value">${loveCount}</div>
                </div>
                <div class="data-stat-card clickable" onclick="app.renderPlaylists()">
                    <h4>自定义列表</h4>
                    <div class="value">${userListCount}</div>
                </div>
            `;

            this.renderPlaylists();
        } catch (err) {
            document.getElementById('data-content').innerHTML = '<p style="color: var(--accent-error); padding: 2rem; text-align: center;">加载数据失败</p>';
        } finally {
            applyMarqueeChecks();
        }
    }

    renderPlaylists() {
        const data = this.currentUserData?.data;
        if (!data) return;

        let content = '<div class="playlists-header"><h3>播放列表</h3></div>';

        if (data.userList && data.userList.length) {
            content += '<div class="playlists-grid">';
            data.userList.forEach((list, index) => {
                const songCount = list.list?.length || 0;
                content += `
                    <div class="playlist-card glass">
                        <div class="playlist-card-header">
                            <div class="playlist-info">
                                <div class="playlist-name">${this.escapeHtml(list.name)}</div>
                                <div class="playlist-meta">
                                    <span class="playlist-id">ID: ${list.id}</span>
                                    <span class="playlist-count">${songCount} 首</span>
                                </div>
                            </div>
                        </div>
                        <div class="playlist-card-actions">
                            <button class="btn-view" onclick="app.viewPlaylistDetails(${index})">
                                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                    <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
                                    <circle cx="12" cy="12" r="3"/>
                                </svg>
                                查看详情
                            </button>
                            <button class="btn-delete-playlist" onclick="app.deletePlaylist(${index})">
                                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                    <polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
                                </svg>
                                删除歌单
                            </button>
                        </div>
                    </div>
                `;
            });
            content += '</div>';
        } else {
            content += '<p style="color: var(--text-secondary); padding: 1rem;">暂无自定义列表</p>';
        }

        document.getElementById('data-content').innerHTML = content;
    }

    viewPlaylistDetails(index) {
        const playlist = this.currentUserData?.data?.userList?.[index];
        if (!playlist) return;

        this.currentPlaylistView = index;

        let content = `
            <div class="playlist-detail-header">
                <button onclick="app.renderPlaylists()" class="btn-back">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <line x1="19" y1="12" x2="5" y2="12"/><polyline points="12 19 5 12 12 5"/>
                    </svg>
                    返回列表
                </button>
                <div class="playlist-title-row">
                    <h3 id="playlist-name-${index}">${this.escapeHtml(playlist.name)}</h3>
                    <button onclick="app.editPlaylistName(${index})" class="btn-edit-name" title="编辑名称">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
                            <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
                        </svg>
                    </button>
                </div>
                <div class="playlist-detail-meta">
                    <span>ID: ${playlist.id}</span>
                    <span>${playlist.list?.length || 0} 首歌曲</span>
                </div>
            </div>
        `;

        if (playlist.list && playlist.list.length) {
            content += `
                <div class="search-sort-bar">
                    <div class="search-box">
                        <input type="text" id="song-search" placeholder="搜索歌曲、歌手..." oninput="app.filterSongs()">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/>
                        </svg>
                    </div>
                    <select id="song-sort" onchange="app.sortSongs()" class="sort-select">
                        <option value="">默认排序</option>
                        <option value="name-asc">歌曲名 ↑</option>
                        <option value="name-desc">歌曲名 ↓</option>
                        <option value="artist-asc">歌手 ↑</option>
                        <option value="artist-desc">歌手 ↓</option>
                    </select>
                </div>
                <div class="batch-actions">
                    <div class="batch-select-btns">
                        <button onclick="app.selectAllSongs()" class="btn-batch">全选</button>
                        <button onclick="app.invertSelection()" class="btn-batch">反选</button>
                        <button onclick="app.clearSelection()" class="btn-batch">清空</button>
                    </div>
                    <button onclick="app.batchDeleteSongs()" class="btn-batch-delete" id="batch-delete-btn" disabled>
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
                        </svg>
                        批量删除 (<span id="selected-count">0</span>)
                    </button>
                </div>
            `;
            content += '<div class="songs-table">';
            content += `
                <div class="songs-table-header with-checkbox">
                    <div class="song-col-checkbox">
                        <input type="checkbox" id="select-all-checkbox" onchange="app.toggleAllSongs(this.checked)">
                    </div>
                    <div class="song-col-index">#</div>
                    <div class="song-col-name">歌曲</div>
                    <div class="song-col-artist">歌手</div>
                    <div class="song-col-album">专辑</div>
                    <div class="song-col-actions">操作</div>
                </div>
            `;

            playlist.list.forEach((song, songIndex) => {
                content += `
                    <div class="song-row with-checkbox">
                        <div class="song-col-checkbox">
                            <input type="checkbox" class="song-checkbox" data-index="${songIndex}" onchange="app.updateBatchDeleteBtn()">
                        </div>
                        <div class="song-col-index">${songIndex + 1}</div>
                        ${this.renderSongNameCell(song)}
                        <div class="song-col-artist">${this.escapeHtml(song.singer || '未知歌手')}</div>
                        <div class="song-col-album">${this.escapeHtml(song.albumName || '-')}</div>
                        <div class="song-col-actions">
                            <button class="btn-delete-song" onclick="app.deleteSong(${index}, ${songIndex})" title="删除歌曲">
                                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                    <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
                                </svg>
                            </button>
                        </div>
                    </div>
                `;
            });

            content += '</div>';
        } else {
            content += '<p style="color: var(--text-secondary); padding: 2rem; text-align: center;">此歌单暂无歌曲</p>';
        }

        document.getElementById('data-content').innerHTML = content;
    }

    async deletePlaylist(index) {
        const playlist = this.currentUserData?.data?.userList?.[index];
        if (!playlist) return;

        if (!(await showSelect('删除歌单', `确定要删除歌单 "${playlist.name}" 吗？\n此操作将删除歌单及其中的所有歌曲！`, { danger: true }))) return;

        try {
            await this.request('/api/data/delete-playlist', {
                method: 'POST',
                body: JSON.stringify({
                    username: this.currentUserData.username,
                    playlistId: playlist.id
                })
            });

            showSuccess('删除成功！');
            this.loadUserData();
        } catch (err) {
            showError('删除失败: ' + err.message);
        }
    }

    async deleteSong(playlistIndexOrType, songIndex) {
        let playlist, song, playlistId, isSystemList = false;

        // 检查是否是系统列表
        if (typeof playlistIndexOrType === 'string') {
            isSystemList = true;
            const listType = playlistIndexOrType;
            const listMap = {
                'default': { list: this.currentUserData?.data?.defaultList, name: '试听列表', id: 'default' },
                'love': { list: this.currentUserData?.data?.loveList, name: '我的收藏', id: 'love' }
            };
            playlist = listMap[listType];
            song = playlist?.list?.[songIndex];
            playlistId = playlist?.id;
        } else {
            playlist = this.currentUserData?.data?.userList?.[playlistIndexOrType];
            song = playlist?.list?.[songIndex];
            playlistId = playlist?.id;
        }

        if (!song) return;

        if (!(await showSelect('删除歌曲', `确定要从 "${playlist.name}" 中删除歌曲 "${song.name}" 吗？`, { danger: true }))) return;

        try {
            await this.request('/api/data/delete-song', {
                method: 'POST',
                body: JSON.stringify({
                    username: this.currentUserData.username,
                    playlistId: playlistId,
                    songIndex: songIndex
                })
            });

            showSuccess('删除成功！');
            // 重新加载并显示当前列表
            await this.loadUserData();
            if (isSystemList) {
                this.viewSystemList(playlistIndexOrType);
            } else {
                this.viewPlaylistDetails(playlistIndexOrType);
            }
        } catch (err) {
            showError('删除失败: ' + err.message);
        }
    }

    viewSystemList(listType) {
        const data = this.currentUserData?.data;
        if (!data) return;

        const listMap = {
            'default': { list: data.defaultList, name: '试听列表', id: 'default' },
            'love': { list: data.loveList, name: '我的收藏', id: 'love' }
        };

        const systemList = listMap[listType];
        if (!systemList) return;

        this.currentPlaylistView = listType; // 存储当前查看的系统列表类型

        let content = `
            <div class="playlist-detail-header">
                <button onclick="app.renderPlaylists()" class="btn-back">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <line x1="19" y1="12" x2="5" y2="12"/><polyline points="12 19 5 12 12 5"/>
                    </svg>
                    返回列表
                </button>
                <h3>${systemList.name}</h3>
                <div class="playlist-detail-meta">
                    <span>系统列表</span>
                    <span>${systemList.list?.length || 0} 首歌曲</span>
                </div>
            </div>
        `;

        if (systemList.list && systemList.list.length) {
            content += '<div class="songs-table">';
            content += `
                <div class="songs-table-header">
                    <div class="song-col-index">#</div>
                    <div class="song-col-name">歌曲</div>
                    <div class="song-col-artist">歌手</div>
                    <div class="song-col-album">专辑</div>
                    <div class="song-col-source">来源</div>
                    <div class="song-col-actions">操作</div>
                </div>
            `;

            systemList.list.forEach((song, songIndex) => {
                content += `
                    <div class="song-row">
                        <div class="song-col-index">${songIndex + 1}</div>
                        ${this.renderSongNameCell(song)}
                        <div class="song-col-artist">${this.escapeHtml(song.singer || '未知歌手')}</div>
                        <div class="song-col-album">${this.escapeHtml(song.albumName || '-')}</div>
                        <div class="song-col-actions">
                            <button class="btn-delete-song" onclick="app.deleteSong('${listType}', ${songIndex})" title="删除歌曲">
                                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                    <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
                                </svg>
                            </button>
                        </div>
                    </div>
                `;
            });

            content += '</div>';
        } else {
            content += '<p style="color: var(--text-secondary); padding: 2rem; text-align: center;">此列表暂无歌曲</p>';
        }

        document.getElementById('data-content').innerHTML = content;
    }

    async editPlaylistName(index) {
        const playlist = this.currentUserData?.data?.userList?.[index];
        if (!playlist) return;

        const newName = await showInput('编辑歌单名称', '请输入新的歌单名称:', { defaultValue: playlist.name });
        if (!newName || newName === playlist.name) return;

        try {
            await this.request('/api/data/rename-playlist', {
                method: 'POST',
                body: JSON.stringify({
                    username: this.currentUserData.username,
                    playlistId: playlist.id,
                    newName: newName
                })
            });

            showSuccess('重命名成功！');
            await this.loadUserData();
            this.viewPlaylistDetails(index);
        } catch (err) {
            showError('重命名失败: ' + err.message);
        }
    }

    // 更新批量删除按钮状态
    updateBatchDeleteBtn() {
        const checkboxes = document.querySelectorAll('.song-checkbox:checked');
        const count = checkboxes.length;
        const btn = document.getElementById('batch-delete-btn');
        const countSpan = document.getElementById('selected-count');

        if (countSpan) countSpan.textContent = count;
        if (btn) btn.disabled = count === 0;

        // 更新全选复选框状态
        const allCheckboxes = document.querySelectorAll('.song-checkbox');
        const selectAllCheckbox = document.getElementById('select-all-checkbox');
        if (selectAllCheckbox && allCheckboxes.length > 0) {
            selectAllCheckbox.checked = count === allCheckboxes.length;
            selectAllCheckbox.indeterminate = count > 0 && count < allCheckboxes.length;
        }
    }

    // 全选/取消全选
    toggleAllSongs(checked) {
        document.querySelectorAll('.song-checkbox').forEach(cb => {
            cb.checked = checked;
        });
        this.updateBatchDeleteBtn();
    }

    // 全选
    selectAllSongs() {
        document.querySelectorAll('.song-checkbox').forEach(cb => {
            cb.checked = true;
        });
        this.updateBatchDeleteBtn();
    }

    // 反选
    invertSelection() {
        document.querySelectorAll('.song-checkbox').forEach(cb => {
            cb.checked = !cb.checked;
        });
        this.updateBatchDeleteBtn();
    }

    // 清空选择
    clearSelection() {
        document.querySelectorAll('.song-checkbox').forEach(cb => {
            cb.checked = false;
        });
        this.updateBatchDeleteBtn();
    }

    // 批量删除歌曲
    async batchDeleteSongs() {
        const checkboxes = document.querySelectorAll('.song-checkbox:checked');
        if (checkboxes.length === 0) return;

        const playlistIndex = this.currentPlaylistView;
        const playlist = this.currentUserData?.data?.userList?.[playlistIndex];
        if (!playlist) return;

        if (!(await showSelect('批量删除', `确定要删除选中的 ${checkboxes.length} 首歌曲吗？`, { danger: true }))) return;

        try {
            // 获取选中歌曲的索引（需要从大到小排序，避免删除时索引变化）
            const songIndices = Array.from(checkboxes)
                .map(cb => parseInt(cb.dataset.index))
                .sort((a, b) => b - a);

            await this.request('/api/data/batch-delete-songs', {
                method: 'POST',
                body: JSON.stringify({
                    username: this.currentUserData.username,
                    playlistId: playlist.id,
                    songIndices: songIndices
                })
            });

            showSuccess('批量删除成功！');
            await this.loadUserData();
            this.viewPlaylistDetails(playlistIndex);
        } catch (err) {
            showError('批量删除失败: ' + err.message);
        }
    }

    // 筛选歌曲
    filterSongs() {
        const searchText = document.getElementById('song-search')?.value.toLowerCase() || '';
        const rows = document.querySelectorAll('.song-row');

        rows.forEach(row => {
            const nameEl = row.querySelector('.song-col-name');
            const artistEl = row.querySelector('.song-col-artist');
            const name = nameEl?.textContent.toLowerCase() || '';
            const artist = artistEl?.textContent.toLowerCase() || '';

            if (name.includes(searchText) || artist.includes(searchText)) {
                row.style.display = '';
            } else {
                row.style.display = 'none';
            }
        });
    }

    // 排序歌曲
    sortSongs() {
        const sortValue = document.getElementById('song-sort')?.value;
        if (!sortValue) {
            // 恢复默认顺序 - 重新渲染
            if (typeof this.currentPlaylistView === 'number') {
                this.viewPlaylistDetails(this.currentPlaylistView);
            } else if (typeof this.currentPlaylistView === 'string') {
                this.viewSystemList(this.currentPlaylistView);
            }
            return;
        }

        const [field, order] = sortValue.split('-');
        const tbody = document.querySelector('.songs-table');
        const rows = Array.from(document.querySelectorAll('.song-row'));

        rows.sort((a, b) => {
            let aValue, bValue;

            if (field === 'name') {
                aValue = a.querySelector('.song-col-name')?.textContent || '';
                bValue = b.querySelector('.song-col-name')?.textContent || '';
            } else if (field === 'artist') {
                aValue = a.querySelector('.song-col-artist')?.textContent || '';
                bValue = b.querySelector('.song-col-artist')?.textContent || '';
            }

            const comparison = aValue.localeCompare(bValue, 'zh-CN');
            return order === 'asc' ? comparison : -comparison;
        });

        // 重新插入排序后的行
        const header = tbody.querySelector('.songs-table-header');
        rows.forEach(row => tbody.appendChild(row));
    }

    // 查看所有歌曲
    viewAllSongs() {
        const data = this.currentUserData?.data;
        if (!data) return;

        this.currentPlaylistView = 'all';

        // 收集所有歌曲
        let allSongs = [];

        // 添加试听列表
        if (data.defaultList && data.defaultList.length) {
            data.defaultList.forEach(song => {
                allSongs.push({ ...song, _source: '试听列表' });
            });
        }

        // 添加我的收藏
        if (data.loveList && data.loveList.length) {
            data.loveList.forEach(song => {
                allSongs.push({ ...song, _source: '我的收藏' });
            });
        }

        // 添加自定义列表中的歌曲
        if (data.userList && data.userList.length) {
            data.userList.forEach(list => {
                if (list.list && list.list.length) {
                    list.list.forEach(song => {
                        allSongs.push({ ...song, _source: list.name });
                    });
                }
            });
        }

        let content = `
            <div class="playlist-detail-header">
                <button onclick="app.renderPlaylists()" class="btn-back">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <line x1="19" y1="12" x2="5" y2="12"/><polyline points="12 19 5 12 12 5"/>
                    </svg>
                    返回列表
                </button>
                <h3>所有歌曲</h3>
                <div class="playlist-detail-meta">
                    <span>总计 ${allSongs.length} 首歌曲</span>
                </div>
            </div>
        `;

        if (allSongs.length) {
            content += `
                <div class="search-sort-bar">
                    <div class="search-box">
                        <input type="text" id="song-search" placeholder="搜索歌曲、歌手..." oninput="app.filterSongs()">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/>
                        </svg>
                    </div>
                    <select id="song-sort" onchange="app.sortSongs()" class="sort-select">
                        <option value="">默认排序</option>
                        <option value="name-asc">歌曲名 ↑</option>
                        <option value="name-desc">歌曲名 ↓</option>
                        <option value="artist-asc">歌手 ↑</option>
                        <option value="artist-desc">歌手 ↓</option>
                        <option value="source-asc">所属列表 ↑</option>
                        <option value="source-desc">所属列表 ↓</option>
                    </select>
                </div>
            `;
            content += '<div class="songs-table">';
            content += `
                <div class="songs-table-header">
                    <div class="song-col-index">#</div>
                    <div class="song-col-name">歌曲</div>
                    <div class="song-col-artist">歌手</div>
                    <div class="song-col-album">专辑</div>
                    <div class="song-col-playlist">所属列表</div>
                </div>
            `;

            allSongs.forEach((song, songIndex) => {
                content += `
                    <div class="song-row">
                        <div class="song-col-index">${songIndex + 1}</div>
                        ${this.renderSongNameCell(song)}
                        <div class="song-col-artist" title="${this.escapeHtml(song.singer || '未知歌手')}">${this.escapeHtml(song.singer || '未知歌手')}</div>
                        <div class="song-col-album" title="${this.escapeHtml(song.albumName || '-')}">${this.escapeHtml(song.albumName || '-')}</div>
                        <div class="song-col-playlist">${this.escapeHtml(song._source)}</div>
                    </div>
                `;
            });

            content += '</div>';
        } else {
            content += '<p style="color: var(--text-secondary); padding: 2rem; text-align: center;">暂无歌曲</p>';
        }

        document.getElementById('data-content').innerHTML = content;
    }

    async loadConfig() {
        try {
            const config = await this.request('/api/config');
            const form = document.getElementById('config-form');

            form.elements['serverName'].value = config.serverName || '';
            form.elements['maxSnapshotNum'].value = config.maxSnapshotNum || 10;
            form.elements['list.addMusicLocationType'].value = config['list.addMusicLocationType'] || 'top';
            form.elements['proxy.enabled'].checked = config['proxy.enabled'] || false;
            form.elements['proxy.header'].value = config['proxy.header'] || '';
            if (form.elements['user.enablePath']) {
                form.elements['user.enablePath'].checked = config['user.enablePath'] !== false;
            }
            if (form.elements['user.enableRoot']) {
                form.elements['user.enableRoot'].checked = config['user.enableRoot'] === true;
            }
            if (form.elements['user.enablePublicRestriction']) {
                form.elements['user.enablePublicRestriction'].checked = config['user.enablePublicRestriction'] === true;
            }
            form.elements['frontend.password'].value = config['frontend.password'] || '';

            // Web播放器配置
            if (form.elements['player.enableAuth']) {
                form.elements['player.enableAuth'].checked = config['player.enableAuth'] === true;
            }
            if (form.elements['player.password']) {
                form.elements['player.password'].value = config['player.password'] || '';
            }

            // WebDAV 配置
            if (form.elements['webdav.url']) {
                form.elements['webdav.url'].value = config['webdav.url'] || '';
            }
            if (form.elements['webdav.username']) {
                form.elements['webdav.username'].value = config['webdav.username'] || '';
            }
            if (form.elements['webdav.password']) {
                form.elements['webdav.password'].value = config['webdav.password'] || '';
            }
            if (form.elements['sync.interval']) {
                form.elements['sync.interval'].value = config['sync.interval'] || 60;
            }
        } catch (err) {
            console.error('Failed to load config:', err);
        }
    }

    async saveConfig() {
        const form = document.getElementById('config-form');
        const formData = new FormData(form);
        const config = {
            serverName: formData.get('serverName'),
            maxSnapshotNum: parseInt(formData.get('maxSnapshotNum')),
            'list.addMusicLocationType': formData.get('list.addMusicLocationType'),
            'proxy.enabled': formData.get('proxy.enabled') === 'on',
            'proxy.header': formData.get('proxy.header'),
            'user.enablePath': formData.get('user.enablePath') === 'on',
            'user.enableRoot': formData.get('user.enableRoot') === 'on',
            'user.enablePublicRestriction': formData.get('user.enablePublicRestriction') === 'on',
            'frontend.password': formData.get('frontend.password'),
            'player.enableAuth': formData.get('player.enableAuth') === 'on',
            'player.password': formData.get('player.password'),
            'webdav.url': formData.get('webdav.url'),
            'webdav.username': formData.get('webdav.username'),
            'webdav.password': formData.get('webdav.password'),
            'sync.interval': parseInt(formData.get('sync.interval')) || 60,
        };

        try {
            const res = await this.request('/api/config', {
                method: 'POST',
                body: JSON.stringify(config)
            });

            // 如果密码改了，更新本地存储
            if (config['frontend.password'] && config['frontend.password'] !== this.password) {
                this.password = config['frontend.password'];
                localStorage.setItem('lx_auth', config['frontend.password']);
            }

            if (res.warning) {
                showInfo('配置保存成功！\n\n⚠️ 警告：' + res.warning);
            } else {
                showSuccess('配置保存成功！');
            }
        } catch (err) {
            showError('配置保存失败: ' + err.message);
        }
    }

    async loadLogs() {
        const logType = document.getElementById('log-type-select')?.value || 'app';

        try {
            const data = await this.request(`/api/logs?type=${logType}&lines=200`);
            const container = document.getElementById('logs-content');

            if (data.logs && data.logs.length) {
                container.innerHTML = data.logs
                    .filter(line => line.trim())
                    .map(line => `<div class="log-line">${this.escapeHtml(line)}</div>`)
                    .join('');

                // 滚动到底部
                container.scrollTop = container.scrollHeight;
            } else {
                container.innerHTML = '<p style="color: var(--text-secondary);">暂无日志</p>';
            }
        } catch (err) {
            document.getElementById('logs-content').innerHTML = '<p style="color: var(--accent-error);">加载日志失败</p>';
        }
    }

    closeModal() {
        document.getElementById('modal').classList.add('hidden');
    }

    async request(url, options = {}) {
        const defaultOptions = {
            headers: {
                'Content-Type': 'application/json',
                'X-Frontend-Auth': this.password
            }
        };

        const response = await fetch(API_BASE + url, { ...defaultOptions, ...options });

        if (response.status === 401) {
            this.logout();
            throw new Error('Unauthorized');
        }

        if (!response.ok) {
            const text = await response.text();
            throw new Error(text || 'Request failed');
        }

        return response.json();
    }

    formatUptime(seconds) {
        if (!seconds) return '0h';
        const hours = Math.floor(seconds / 3600);
        const minutes = Math.floor((seconds % 3600) / 60);
        if (hours > 24) {
            const days = Math.floor(hours / 24);
            return `${days}d ${hours % 24}h`;
        }
        return `${hours}h ${minutes}m`;
    }

    formatMemory(bytes) {
        return (bytes / 1024 / 1024).toFixed(1) + ' MB';
    }

    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }
    // ========== WebDAV 功能 ==========

    async testWebDAV() {
        try {
            const result = await this.request('/api/webdav/test', { method: 'POST' });
            if (result.success) {
                showSuccess('✅ WebDAV连接成功！\n' + result.message);
            } else {
                showError('❌ WebDAV连接失败\n' + result.message);
            }
        } catch (err) {
            showError('❌ 连接失败: ' + err.message);
        }
    }

    async backupToWebDAV() {
        if (!(await showSelect('WebDAV 备份', '确定要创建全量备份并上传到 WebDAV 吗？'))) return;

        const statusEl = document.getElementById('sync-status-content');
        statusEl.innerHTML = '<p style="color: var(--accent-warning);">正在备份...</p>';
        this.showProgress(true);

        try {
            const result = await this.request('/api/webdav/backup', {
                method: 'POST',
                body: JSON.stringify({ force: true })
            });
            if (result.success) {
                statusEl.innerHTML = '<p style="color: var(--accent-success);">✅ 备份成功！</p>';
                this.loadSyncLogs();
            } else {
                statusEl.innerHTML = '<p style="color: var(--accent-error);">❌ 备份失败</p>';
            }
        } catch (err) {
            statusEl.innerHTML = '<p style="color: var(--accent-error);">❌ 备份失败: ' + err.message + '</p>';
        } finally {
            setTimeout(() => this.showProgress(false), 3000);
        }
    }

    async restoreFromWebDAV() {
        if (!(await showSelect('WebDAV 恢复', '⚠️ 警告：从云端恢复将覆盖本地所有数据！\n\n确定要继续吗？', { danger: true }))) return;

        const statusEl = document.getElementById('sync-status-content');
        statusEl.innerHTML = '<p style="color: var(--accent-warning);">正在从云端恢复数据...</p>';

        try {
            const result = await this.request('/api/webdav/restore', { method: 'POST' });
            if (result.success) {
                statusEl.innerHTML = '<p style="color: var(--accent-success);">✅ 恢复成功！页面将刷新...</p>';
                setTimeout(() => location.reload(), 2000);
            } else {
                statusEl.innerHTML = '<p style="color: var(--accent-error);">❌ 恢复失败</p>';
            }
        } catch (err) {
            statusEl.innerHTML = '<p style="color: var(--accent-error);">❌ 恢复失败: ' + err.message + '</p>';
        }
    }

    async syncFilesToWebDAV() {
        if (!(await showSelect('同步文件', '确定要强制同步所有文件到 WebDAV 吗？'))) return;

        const statusEl = document.getElementById('sync-status-content');
        statusEl.innerHTML = '<p style="color: var(--accent-warning);">正在同步文件...</p>';
        this.showProgress(true);

        try {
            const result = await this.request('/api/webdav/sync', { method: 'POST' });
            if (result.success) {
                statusEl.innerHTML = '<p style="color: var(--accent-success);">✅ 同步成功！</p>';
                this.loadSyncLogs();
            } else {
                statusEl.innerHTML = '<p style="color: var(--accent-error);">❌ 同步失败</p>';
            }
        } catch (err) {
            statusEl.innerHTML = '<p style="color: var(--accent-error);">❌ 同步失败: ' + err.message + '</p>';
        } finally {
            setTimeout(() => this.showProgress(false), 3000);
        }
    }

    showProgress(show) {
        const container = document.getElementById('sync-progress-container');
        if (show) {
            container.classList.remove('hidden');
            this.updateProgress(0, '准备中...');
        } else {
            container.classList.add('hidden');
        }
    }

    updateProgress(percent, text) {
        const bar = document.getElementById('progress-bar');
        const textEl = document.getElementById('progress-text');
        const percentEl = document.getElementById('progress-percent');

        if (bar) bar.style.width = `${percent}%`;
        if (textEl) textEl.textContent = text;
        if (percentEl) percentEl.textContent = `${Math.round(percent)}%`;
    }

    // 辅助方法：生成歌曲标签 HTML
    renderSongTags(song) {
        let html = '<div class="song-meta-tags">';

        // 来源标签
        if (song.source) {
            html += `<span class="tag tag-source ${song.source}">${this.escapeHtml(song.source)}</span>`;
        }

        // 音质标签
        if (song.meta && song.meta._qualitys) {
            const qualitys = song.meta._qualitys;
            // 优先显示最高音质
            if (qualitys.flac24bit) {
                html += '<span class="tag tag-quality hr">Hi-Res</span>';
            } else if (qualitys.flac) {
                html += '<span class="tag tag-quality lossless">SQ</span>';
            } else if (qualitys['320k']) {
                html += '<span class="tag tag-quality high">HQ</span>';
            } else if (qualitys['128k']) {
                // 128k 一般不显示标签，或者显示 standard
                // html += '<span class="tag tag-quality">PQ</span>';
            }
        } else if (song.meta && song.meta.qualitys) { // 兼容旧结构 array
            const qualitys = song.meta.qualitys;
            if (qualitys.some(q => q.type === 'flac24bit')) {
                html += '<span class="tag tag-quality hr">Hi-Res</span>';
            } else if (qualitys.some(q => q.type === 'flac')) {
                html += '<span class="tag tag-quality lossless">SQ</span>';
            } else if (qualitys.some(q => q.type === '320k')) {
                html += '<span class="tag tag-quality high">HQ</span>';
            }
        }

        // 时长
        if (song.interval) {
            html += `<span class="tag tag-interval">${this.escapeHtml(song.interval)}</span>`;
        }

        html += '</div>';
        return html;
    }

    // 辅助方法：生成歌曲名称列 HTML（包含封面）
    renderSongNameCell(song) {
        const picUrl = song.meta?.picUrl || '';
        // 使用默认图占位，data-src 用于懒加载 (IntersectionObserver 稍后实现，这里直接用原生 lazy loading)
        // 注意：Web 原生 loading="lazy" 对 background-image 无效，对 img 标签有效。
        // 这里使用 img 标签
        const coverHtml = picUrl
            ? `<img src="${picUrl}" class="song-cover" loading="lazy" alt="cover" onerror="this.style.opacity=0">`
            : `<div class="song-cover" style="background: rgba(255,255,255,0.1); display: flex; align-items: center; justify-content: center;">🎵</div>`;

        return `
            <div class="song-col-name">
                ${coverHtml}
                <div class="song-info-wrapper min-w-0">
                    <span class="song-title-text dynamic-marquee truncate" title="${this.escapeHtml(song.name)}">${this.escapeHtml(song.name || '未知歌曲')}</span>
                    ${this.renderSongTags(song)}
                </div>
            </div>
        `;
    }

    initSSE() {
        if (this.sseSource) return;

        const auth = this.password || localStorage.getItem('lx_auth');
        if (!auth) return;

        this.sseSource = new EventSource(`/api/webdav/progress?auth=${encodeURIComponent(auth)}`);

        this.sseSource.onmessage = (event) => {
            try {
                const data = JSON.parse(event.data);
                // console.log('SSE Progress:', data);

                if (data.type === 'backup') {
                    if (data.status === 'uploading') {
                        const percent = (data.current / data.total) * 100;
                        this.updateProgress(percent, `正在上传备份: ${this.formatFileSize(data.current)} / ${this.formatFileSize(data.total)}`);
                    } else if (data.status === 'packing') {
                        this.updateProgress(5, data.message || '正在打包文件...');
                    } else if (data.status === 'preparing') {
                        this.updateProgress(0, data.message);
                    } else if (data.status === 'success') {
                        this.updateProgress(100, '备份上传完成');
                    }
                } else if (data.type === 'sync') {
                    if (data.status === 'processing') {
                        const percent = (data.current / data.total) * 100;
                        this.updateProgress(percent, `正在同步文件 (${data.current}/${data.total}): ${data.file}`)
                    } else if (data.status === 'finish') {
                        this.updateProgress(100, '文件同步完成');
                    }
                } else if (data.type === 'restore') {
                    if (data.status === 'processing') {
                        const percent = (data.current / data.total) * 100;
                        this.updateProgress(percent, `正在恢复文件 (${data.current}/${data.total}): ${data.file}`);
                    } else if (data.status === 'downloading') {
                        this.updateProgress(30, data.message || '正在下载备份...');
                    } else if (data.status === 'extracting') {
                        this.updateProgress(70, data.message || '正在解压备份...');
                    } else if (data.status === 'start') {
                        this.updateProgress(0, data.message || '正在从云端恢复数据...');
                    } else if (data.status === 'finish') {
                        this.updateProgress(100, data.message || '数据恢复完成');
                    } else if (data.status === 'error') {
                        this.updateProgress(0, data.message || '恢复失败');
                    }
                } else if (data.type === 'file') {
                    // 单文件上传进度（如果需要显示）
                    if (data.status === 'uploading') {
                        // 可以在这里更新更细粒度的进度，但可能会闪烁太快
                    }
                }
            } catch (e) {
                console.error('SSE Parse Error:', e);
            }
        };

        this.sseSource.onerror = (err) => {
            // console.error('SSE Error:', err);
            // 连接失败不报错，静默重试
        };
    }

    async loadSyncLogs() {
        try {
            const data = await this.request('/api/webdav/logs');
            const container = document.getElementById('sync-logs-content');

            if (!data.logs || data.logs.length === 0) {
                container.innerHTML = '<p style="color: var(--text-secondary); padding: 2rem; text-align: center;">暂无同步日志</p>';
                return;
            }

            container.innerHTML = data.logs.map(log => `
            <div class="sync-log-item">
                <div class="log-info">
                    <span class="log-type log-type-${log.type}">${this.getLogTypeText(log.type)}</span>
                    <span class="log-file">${log.file}</span>
                    ${log.message ? `<div style="font-size: 0.75rem; color: var(--text-muted); margin-top: 0.25rem;">${log.message}</div>` : ''}
                </div>
                <div style="display: flex; align-items: center; gap: 1rem;">
                    <span class="log-status log-status-${log.status}">${log.status === 'success' ? '成功' : '失败'}</span>
                    <span class="log-time">${this.formatTime(log.timestamp)}</span>
                </div>
            </div>
        `).join('');
        } catch (err) {
            console.error('Failed to load sync logs:', err);
        }
    }

    getLogTypeText(type) {
        const types = {
            upload: '上传',
            download: '下载',
            backup: '备份',
            restore: '恢复'
        };
        return types[type] || type;
    }

    formatTime(timestamp) {
        const now = Date.now();
        const diff = now - timestamp;
        const minute = 60 * 1000;
        const hour = 60 * minute;
        const day = 24 * hour;

        if (diff < minute) return '刚刚';
        if (diff < hour) return Math.floor(diff / minute) + '分钟前';
        if (diff < day) return Math.floor(diff / hour) + '小时前';

        const date = new Date(timestamp);
        return date.toLocaleString('zh-CN');
    }

    // ========== 文件管理器功能 ==========

    currentPath = '';

    async loadFiles(path = '') {
        this.currentPath = path;

        try {
            const data = await this.request(`/api/files?path=${encodeURIComponent(path)}`);
            this.renderFileList(data.items || []);
            this.updateBreadcrumb(path);
        } catch (err) {
            console.error('Failed to load files:', err);
            document.getElementById('file-items').innerHTML = '<p style="padding: 2rem; text-align: center; color: var(--accent-error);">加载文件失败</p>';
        }
    }

    renderFileList(items) {
        const container = document.getElementById('file-items');

        if (items.length === 0) {
            container.innerHTML = '<p style="padding: 2rem; text-align: center; color: var(--text-secondary);">此文件夹为空</p>';
            return;
        }

        // 排序：文件夹在前
        items.sort((a, b) => {
            if (a.isDirectory && !b.isDirectory) return -1;
            if (!a.isDirectory && b.isDirectory) return 1;
            return a.name.localeCompare(b.name);
        });

        container.innerHTML = items.map(item => `
        <div class="file-item">
            <div class="file-name" onclick="app.${item.isDirectory ? `loadFiles('${item.path}')` : `viewFile('${item.path}')`}">
                <span class="file-icon">${item.isDirectory ? '📁' : this.getFileIcon(item.name)}</span>
                <span>${item.name}</span>
            </div>
            <div class="file-size">${item.isDirectory ? '-' : this.formatFileSize(item.size)}</div>
            <div class="file-date">${this.formatDate(item.mtime)}</div>
            <div class="file-item-actions">
                ${!item.isDirectory ? `<button onclick="app.editFile('${item.path}')">编辑</button>` : ''}
                <button onclick="app.downloadFile('${item.path}')">下载</button>
                <button onclick="app.deleteFile('${item.path}', ${item.isDirectory})" style="color: var(--accent-error);">删除</button>
            </div>
        </div>
    `).join('');
    }

    getFileIcon(filename) {
        const ext = filename.split('.').pop().toLowerCase();
        const icons = {
            json: '📄',
            txt: '📝',
            log: '📋',
            js: '📜',
            css: '🎨',
            html: '🌐',
            md: '📖',
        };
        return icons[ext] || '📄';
    }

    updateBreadcrumb(path) {
        const parts = path ? path.split('/').filter(p => p) : [];
        const breadcrumb = document.getElementById('file-breadcrumb');

        let html = '<a href="#" onclick="app.loadFiles(\'\'); return false;">根目录</a>';

        let currentPath = '';
        parts.forEach((part, index) => {
            currentPath += (index > 0 ? '/' : '') + part;
            html += `<a href="#" onclick="app.loadFiles('${currentPath}'); return false;">${part}</a>`;
        });

        breadcrumb.innerHTML = html;
    }

    async createNewFile() {
        const filename = await showInput('创建文件', '请输入文件名：');
        if (!filename) return;

        const path = this.currentPath ? `${this.currentPath}/${filename}` : filename;

        try {
            await this.request('/api/files', {
                method: 'POST',
                body: JSON.stringify({ path, content: '', isDirectory: false })
            });
            this.loadFiles(this.currentPath);
            showSuccess('文件创建成功');
        } catch (err) {
            showError('创建文件失败: ' + err.message);
        }
    }

    async createNewFolder() {
        const foldername = await showInput('创建文件夹', '请输入文件夹名：');
        if (!foldername) return;

        const path = this.currentPath ? `${this.currentPath}/${foldername}` : foldername;

        try {
            await this.request('/api/files', {
                method: 'POST',
                body: JSON.stringify({ path, isDirectory: true })
            });
            this.loadFiles(this.currentPath);
            showSuccess('文件夹创建成功');
        } catch (err) {
            showError('创建文件夹失败: ' + err.message);
        }
    }

    async editFile(filePath) {
        // 简单的编辑：使用 showInput
        const newContent = await showInput('编辑文件', '编辑文件内容（简易编辑器）：\n\n提示：输入新内容后点击确定', { defaultValue: '' });
        if (newContent === null) return;

        try {
            await this.request('/api/files', {
                method: 'PUT',
                body: JSON.stringify({ path: filePath, content: newContent })
            });
            showSuccess('保存成功！');
        } catch (err) {
            showError('保存失败: ' + err.message);
        }
    }

    viewFile(filePath) {
        showInfo('文件查看功能：' + filePath + '\n\n可以通过下载按钮下载文件后查看');
    }

    async downloadFile(filePath) {
        const url = `/api/files/download?path=${encodeURIComponent(filePath)}`;
        const a = document.createElement('a');
        a.href = url;
        a.download = filePath.split('/').pop();
        a.click();
    }

    async deleteFile(filePath, isDirectory) {
        const type = isDirectory ? '文件夹' : '文件';
        if (!(await showSelect('删除文件', `确定要删除${type} "${filePath}" 吗？\n\n${isDirectory ? '⚠️ 文件夹内的所有内容也会被删除！' : ''}`, { danger: true }))) return;

        try {
            await this.request('/api/files', {
                method: 'DELETE',
                body: JSON.stringify({ path: filePath })
            });
            this.loadFiles(this.currentPath);
            showSuccess('删除成功');
        } catch (err) {
            showError('删除失败: ' + err.message);
        }
    }

    formatFileSize(bytes) {
        if (bytes < 1024) return bytes + ' B';
        if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
        return (bytes / 1024 / 1024).toFixed(1) + ' MB';
    }

    formatDate(timestamp) {
        const date = new Date(timestamp);
        return date.toLocaleString('zh-CN');
    }

    formatUptime(seconds) {
        const d = Math.floor(seconds / (3600 * 24));
        const h = Math.floor((seconds % (3600 * 24)) / 3600);
        const m = Math.floor((seconds % 3600) / 60);

        const parts = [];
        if (d > 0) parts.push(`${d}d`);
        if (h > 0) parts.push(`${h}h`);
        if (m > 0) parts.push(`${m}m`);
        if (parts.length === 0) parts.push('0m');

        return parts.join(' ');
    }

    // ========== 初始化事件绑定 ==========

    bindWebDAVEvents() {
        document.getElementById('test-webdav-btn')?.addEventListener('click', () => this.testWebDAV());
        document.getElementById('backup-webdav-btn')?.addEventListener('click', () => this.backupToWebDAV());
        document.getElementById('restore-webdav-btn')?.addEventListener('click', () => this.restoreFromWebDAV());
        document.getElementById('sync-files-btn')?.addEventListener('click', () => this.syncFilesToWebDAV());
        document.getElementById('refresh-sync-logs-btn')?.addEventListener('click', () => this.loadSyncLogs());

        // [新增] 本地备份/还原事件绑定
        document.getElementById('backup-local-btn')?.addEventListener('click', () => this.downloadLocalBackup());
        document.getElementById('restore-local-btn')?.addEventListener('click', () => document.getElementById('local-backup-input').click());
        document.getElementById('local-backup-input')?.addEventListener('change', (e) => this.handleLocalRestore(e));

        this.initSSE();
    }

    bindFileManagerEvents() {
        document.getElementById('new-file-btn')?.addEventListener('click', () => this.createNewFile());
        document.getElementById('new-folder-btn')?.addEventListener('click', () => this.createNewFolder());
        document.getElementById('refresh-files-btn')?.addEventListener('click', () => this.loadFiles(this.currentPath));
    }

    async loadSnapshots() {
        const username = document.getElementById('snapshot-user-select')?.value;
        const container = document.getElementById('snapshots-list');

        if (!username) {
            container.innerHTML = '<div style="padding: 2rem; text-align: center; color: var(--text-secondary);">请先选择用户</div>';
            return;
        }

        try {
            // 添加 user 参数
            const list = await this.request(`/api/data/snapshots?user=${encodeURIComponent(username)}`);

            if (!list.length) {
                container.innerHTML = '<div style="padding: 2rem; text-align: center; color: var(--text-secondary);">暂无快照</div>';
                return;
            }

            container.innerHTML = list.map(item => `
            <div class="snapshot-row">
                <div class="col-time">${new Date(item.time).toLocaleString()}</div>
                <div class="col-id" title="${item.id}">snapshot_${item.id}</div>
                <div class="col-size">${this.formatFileSize(item.size)}</div>
                <div class="col-actions snapshot-actions">
                    <button class="btn-download" onclick="app.downloadSnapshot('${item.id}')">
                        <!-- 下载图标 -->
                        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
                            <polyline points="7 10 12 15 17 10"></polyline>
                            <line x1="12" y1="15" x2="12" y2="3"></line>
                        </svg>
                        下载备份
                    </button>
                    <button class="btn-restore" onclick="app.restoreSnapshot('${item.id}')">
                        <!-- 恢复图标 -->
                        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2">
                            <polyline points="1 4 1 10 7 10"></polyline>
                            <path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"></path>
                        </svg>
                        回滚
                    </button>
                    <!-- [新增] 删除按钮 -->
                    <button class="btn-delete" onclick="app.deleteSnapshot('${item.id}')">
                        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2">
                            <polyline points="3 6 5 6 21 6"></polyline>
                            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                        </svg>
                        删除
                    </button>
                </div>
            </div>
        `).join('');
        } catch (err) {
            console.error(err);
            showError('加载快照列表失败: ' + err.message);
        }
    }
    triggerUploadSnapshot() {
        const username = document.getElementById('snapshot-user-select')?.value;
        if (!username) {
            showInfo('请先选择用户');
            return;
        }
        document.getElementById('snapshot-upload-input').click();
    }

    // [新增] 处理快照上传
    async handleSnapshotUpload(event) {
        const file = event.target.files[0];
        if (!file) return;

        const username = document.getElementById('snapshot-user-select')?.value;
        if (!username) return;

        // 重置 input，允许重复上传同名文件
        event.target.value = '';

        try {
            const content = await file.text();
            // 使用文件最后修改时间
            const time = file.lastModified;
            const filename = file.name;

            const response = await fetch(`/api/data/upload-snapshot?user=${encodeURIComponent(username)}&time=${time}&filename=${encodeURIComponent(filename)}`, {
                method: 'POST',
                headers: {
                    'X-Frontend-Auth': this.password
                },
                body: content
            });

            if (!response.ok) {
                const text = await response.text();
                throw new Error(text || 'Upload failed');
            }

            showSuccess('上传成功');
            this.loadSnapshots();
        } catch (err) {
            console.error(err);
            showError('上传失败: ' + err.message);
        }
    }

    // [新增] 删除快照
    async deleteSnapshot(id) {
        if (!(await showSelect('删除快照', '确定要删除这个快照吗？', { danger: true }))) return;

        const username = document.getElementById('snapshot-user-select')?.value;
        if (!username) return;

        try {
            const response = await fetch(`/api/data/delete-snapshot?user=${encodeURIComponent(username)}`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-Frontend-Auth': this.password
                },
                body: JSON.stringify({ id })
            });

            if (!response.ok) {
                const text = await response.text();
                throw new Error(text || 'Delete failed');
            }

            this.loadSnapshots();
            showSuccess('删除成功');
        } catch (err) {
            console.error(err);
            showError('删除失败: ' + err.message);
        }
    }
    async downloadSnapshot(id) {
        const username = document.getElementById('snapshot-user-select')?.value;
        if (!username) {
            showInfo('请先选择用户');
            return;
        }

        try {
            // 添加 user 参数
            const data = await this.request(`/api/data/snapshot?id=${id}&user=${encodeURIComponent(username)}`);

            // 转换为 LX Music 备份格式
            const defaultList = { id: 'default', name: 'list__name_default' };
            const loveList = { id: 'love', name: 'list__name_love' };

            const backupData = {
                type: 'playList_v2',
                data: [
                    { ...defaultList, list: data.defaultList || [] },
                    { ...loveList, list: data.loveList || [] },
                    ...(data.userList || []),
                ],
            };

            const blob = new Blob([JSON.stringify(backupData, null, 2)], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `lx_backup_${username}_${id.substring(0, 8)}.json`;
            a.click();
            URL.revokeObjectURL(url);
        } catch (err) {
            console.error(err);
            showError('导出快照失败: ' + err.message);
        }
    }

    // [新增] 本地备份下载
    async downloadLocalBackup() {
        if (!(await showSelect('本地备份', '确定要创建并下载本地全量 ZIP 备份吗？\n\n这可能需要一些时间，取决于数据量。'))) return;

        try {
            // 直接通过 URL 下载，后端会处理 ZIP 创建并流式传输
            const url = `/api/backup/download?auth=${encodeURIComponent(this.password)}`;
            const a = document.createElement('a');
            a.href = url;
            // 获取当前日期作为文件名建议
            const dateStr = new Date().toISOString().split('T')[0];
            a.download = `lx-sync-backup-local-${dateStr}.zip`;
            a.click();
        } catch (err) {
            showError('下载本地备份失败: ' + err.message);
        }
    }

    // [新增] 本地备份还原处理
    async handleLocalRestore(event) {
        const file = event.target.files[0];
        if (!file) return;

        if (!(await showSelect('还原数据', '确定要从上传的 ZIP 文件还原数据吗？\n\n⚠️ 警告：这将覆盖当前的服务器所有数据！\n强烈建议在还原前先手动下载一个本地备份。操作不可撤销。', { danger: true }))) {
            event.target.value = '';
            return;
        }

        const formData = new FormData();
        formData.append('backup', file);

        // 创建临时加载提示
        const loadingOverlay = document.createElement('div');
        loadingOverlay.className = 'overlay';
        loadingOverlay.style.background = 'rgba(0,0,0,0.8)';
        loadingOverlay.innerHTML = `
            <div class="login-box glass" style="padding: 3rem;">
                <div class="status-dot" style="margin: 0 auto 1.5rem; width: 12px; height: 12px;"></div>
                <h2>正在还原数据...</h2>
                <p style="color: var(--text-secondary); margin-top: 1rem;">正在解压并恢复文件，请勿关闭或刷新页面。</p>
            </div>
        `;
        document.body.appendChild(loadingOverlay);

        try {
            const response = await fetch('/api/backup/upload', {
                method: 'POST',
                headers: {
                    'X-Frontend-Auth': this.password
                },
                body: formData
            });

            if (!response.ok) {
                const text = await response.text();
                throw new Error(text || 'Restore failed');
            }

            const result = await response.json();
            showSuccess('🎉 还原成功！数据已更新，页面将立即刷新以加载最新配置。');
            setTimeout(() => window.location.reload(), 1500);
        } catch (err) {
            console.error(err);
            showError('本地还原失败: ' + err.message);
            loadingOverlay.remove();
        } finally {
            event.target.value = '';
        }
    }

    async restoreSnapshot(id) {
        const username = document.getElementById('snapshot-user-select')?.value;
        if (!username) {
            showInfo('请先选择用户');
            return;
        }

        if (!(await showSelect('回滚快照', '警告：此操作将把服务器数据回滚到选定的快照状态！\n\n1. 当前所有未保存的更改将丢失。\n2. 所有客户端的同步状态将被重置。\n3. 客户端连接后，请务必选择【远程覆盖本地】以获取回滚后的数据。\n\n确定要继续吗？', { danger: true }))) {
            return;
        }

        try {
            // 添加 user 参数
            await this.request(`/api/data/restore-snapshot?user=${encodeURIComponent(username)}`, {
                method: 'POST',
                body: JSON.stringify({ id })
            });
            showSuccess('回滚成功！请重启客户端或重新连接同步服务。');
            this.loadDashboard(); // 刷新数据概览
        } catch (err) {
            showError('回滚失败: ' + err.message);
        }
    }
    async restartServer() {
        if (!(await showSelect('重启服务器', '确定要重启服务器吗？\n\n重启后所有连接的客户端将断开，大约需要几秒钟时间。', { danger: true }))) {
            return;
        }

        try {
            const result = await this.request('/api/restart', { method: 'POST' })
            if (result.success) {
                showSuccess('服务器正在重启，请稍候...\n\n页面将在 5 秒后自动刷新。');
                // 5秒后刷新页面
                setTimeout(() => {
                    window.location.reload()
                }, 5000)
            } else {
                showError('重启失败: ' + (result.message || '未知错误'))
            }
        } catch (err) {
            showError('重启请求失败: ' + err.message)
        }
    }
}

// 初始化应用
const app = new App();
