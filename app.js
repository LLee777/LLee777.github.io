    // ==================== Database Manager ====================
    class DatabaseManager {
      constructor() {
        this.dbName = 'StickyNotesDB';
        this.storeName = 'notes';
        this.db = null;
      }

      async init() {
        return new Promise((resolve, reject) => {
          const request = indexedDB.open(this.dbName, 2);
          request.onupgradeneeded = (event) => {
            const db = event.target.result;
            if (!db.objectStoreNames.contains(this.storeName)) {
              const store = db.createObjectStore(this.storeName, { keyPath: 'id', autoIncrement: true });
              store.createIndex('createdAt', 'createdAt', { unique: false });
              store.createIndex('priority', 'priority', { unique: false });
              store.createIndex('completed', 'completed', { unique: false });
            }
          };
          request.onsuccess = (event) => {
            this.db = event.target.result;
            resolve();
          };
          request.onerror = (event) => reject(event.target.error);
        });
      }

      async add(note) {
        return this._transaction('readwrite', (store) => store.add(note));
      }

      async update(note) {
        return this._transaction('readwrite', (store) => store.put(note));
      }

      async delete(id) {
        return this._transaction('readwrite', (store) => store.delete(id));
      }

      async get(id) {
        return this._transaction('readonly', (store) => store.get(id));
      }

      async getAll() {
        return this._transaction('readonly', (store) => {
          return new Promise((resolve, reject) => {
            const request = store.getAll();
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
          });
        });
      }

      async getPaginated(page, pageSize, filter, sortBy, search) {
        let notes = await this.getAll();

        // Filter by completion status
        if (filter === 'pending') {
          notes = notes.filter(n => !n.completed);
        } else if (filter === 'completed') {
          notes = notes.filter(n => n.completed);
        }

        // Search by content
        if (search && search.trim()) {
          const keyword = search.trim().toLowerCase();
          notes = notes.filter(n => n.content.toLowerCase().includes(keyword));
        }

        // Sort
        if (sortBy === 'priority') {
          notes.sort((a, b) => a.priority - b.priority || b.createdAt - a.createdAt);
        } else {
          notes.sort((a, b) => b.createdAt - a.createdAt);
        }

        const total = notes.length;
        const totalPages = Math.ceil(total / pageSize) || 1;
        const start = (page - 1) * pageSize;
        const items = notes.slice(start, start + pageSize);

        return { items, total, totalPages, page };
      }

      async getStats() {
        const notes = await this.getAll();
        const total = notes.length;
        const completed = notes.filter(n => n.completed).length;
        const pending = total - completed;
        return { total, completed, pending };
      }

      _transaction(mode, callback) {
        return new Promise((resolve, reject) => {
          const tx = this.db.transaction(this.storeName, mode);
          const store = tx.objectStore(this.storeName);
          const result = callback(store);
          if (result instanceof Promise) {
            result.then(resolve).catch(reject);
          } else {
            tx.oncomplete = () => resolve(result);
            tx.onerror = () => reject(tx.error);
          }
        });
      }
    }

    // ==================== Time Service ====================
    class TimeService {
      static async getNetworkTime() {
        // Try worldtimeapi first
        try {
          const res = await fetch('https://worldtimeapi.org/api/timezone/Asia/Shanghai', {
            signal: AbortSignal.timeout(3000)
          });
          if (res.ok) {
            const data = await res.json();
            return new Date(data.utc_datetime).getTime();
          }
        } catch (e) { /* fallback */ }

        // Fallback: local time
        return Date.now();
      }
    }

    // ==================== UI Manager ====================
    class UIManager {
      constructor(db) {
        this.db = db;
        this.currentPage = 1;
        this.pageSize = 10;
        this.currentFilter = 'all';
        this.currentSort = 'time';
        this.searchKeyword = '';
        this.editingNote = null;

        this.els = {
          noteList: document.getElementById('noteList'),
          pagination: document.getElementById('pagination'),
          prevBtn: document.getElementById('prevBtn'),
          nextBtn: document.getElementById('nextBtn'),
          pageInfo: document.getElementById('pageInfo'),
          emptyState: document.getElementById('emptyState'),
          stats: document.getElementById('stats'),
          searchInput: document.getElementById('searchInput'),
          sortBtn: document.getElementById('sortBtn'),
          sortLabel: document.getElementById('sortLabel'),
          fabBtn: document.getElementById('fabBtn'),
          modalOverlay: document.getElementById('modalOverlay'),
          modalSheet: document.getElementById('modalSheet'),
          modalTitle: document.getElementById('modalTitle'),
          noteContent: document.getElementById('noteContent'),
          prioritySelector: document.getElementById('prioritySelector'),
          cancelBtn: document.getElementById('cancelBtn'),
          saveBtn: document.getElementById('saveBtn'),
          confirmOverlay: document.getElementById('confirmOverlay'),
          confirmDialog: document.getElementById('confirmDialog'),
          confirmMessage: document.getElementById('confirmMessage'),
          confirmCancel: document.getElementById('confirmCancel'),
          confirmOk: document.getElementById('confirmOk'),
          toast: document.getElementById('toast'),
          notifyBtn: document.getElementById('notifyBtn'),
          testNotifyBtn: document.getElementById('testNotifyBtn'),
        };

        this.selectedPriority = 3;
        this._confirmResolve = null;
        this._isSaving = false; // 保存状态锁

        this.bindEvents();
      }

      bindEvents() {
        // Search
        let searchTimer;
        this.els.searchInput.addEventListener('input', () => {
          clearTimeout(searchTimer);
          searchTimer = setTimeout(() => {
            this.searchKeyword = this.els.searchInput.value;
            this.currentPage = 1;
            this.loadNotes();
          }, 300);
        });

        // Filter tabs
        document.querySelectorAll('.filter-tab').forEach(tab => {
          tab.addEventListener('click', () => {
            document.querySelectorAll('.filter-tab').forEach(t => t.classList.remove('active'));
            tab.classList.add('active');
            this.currentFilter = tab.dataset.filter;
            this.currentPage = 1;
            this.loadNotes();
          });
        });

        // Sort
        this.els.sortBtn.addEventListener('click', () => {
          this.currentSort = this.currentSort === 'time' ? 'priority' : 'time';
          this.els.sortLabel.textContent = this.currentSort === 'time' ? '时间' : '优先级';
          this.loadNotes();
        });

        // Pagination
        this.els.prevBtn.addEventListener('click', () => {
          if (this.currentPage > 1) {
            this.currentPage--;
            this.loadNotes();
          }
        });
        this.els.nextBtn.addEventListener('click', () => {
          this.currentPage++;
          this.loadNotes();
        });

        // FAB
        this.els.fabBtn.addEventListener('click', () => this.openCreateModal());

        // Modal
        this.els.modalOverlay.addEventListener('click', () => this.closeModal());
        this.els.cancelBtn.addEventListener('click', () => this.closeModal());
        this.els.saveBtn.addEventListener('click', () => this.saveNote());

        // Notification button
        if (this.els.notifyBtn) {
          this.els.notifyBtn.addEventListener('click', () => this.requestNotification());
        }
        // Test notification button
        if (this.els.testNotifyBtn) {
          this.els.testNotifyBtn.addEventListener('click', () => this.testNotification());
        }

        // Priority selector
        this.els.prioritySelector.querySelectorAll('.priority-option').forEach(opt => {
          opt.addEventListener('click', () => {
            this.els.prioritySelector.querySelectorAll('.priority-option').forEach(o => o.classList.remove('selected'));
            opt.classList.add('selected');
            this.selectedPriority = parseInt(opt.dataset.priority);
          });
        });

        // Confirm dialog
        this.els.confirmCancel.addEventListener('click', () => this._closeConfirm(false));
        this.els.confirmOk.addEventListener('click', () => this._closeConfirm(true));
        this.els.confirmOverlay.addEventListener('click', () => this._closeConfirm(false));
      }

      async loadNotes() {
        try {
          const result = await this.db.getPaginated(
            this.currentPage, this.pageSize,
            this.currentFilter, this.currentSort,
            this.searchKeyword
          );

          this.renderNotes(result.items);
          this.renderPagination(result);
          this.updateStats();

          if (result.total === 0) {
            this.els.emptyState.style.display = 'block';
            this.els.noteList.style.display = 'none';
          } else {
            this.els.emptyState.style.display = 'none';
            this.els.noteList.style.display = 'flex';
          }
        } catch (e) {
          console.error('Load notes error:', e);
          this.showToast('加载失败，请重试');
        }
      }

      renderNotes(notes) {
        this.els.noteList.innerHTML = notes.map(note => this.renderNoteCard(note)).join('');

        // Bind card actions
        this.els.noteList.querySelectorAll('.note-card').forEach(card => {
          const id = parseInt(card.dataset.id);

          card.querySelector('.complete-btn')?.addEventListener('click', (e) => {
            e.stopPropagation();
            this.toggleComplete(id);
          });

          card.querySelector('.copy-btn')?.addEventListener('click', (e) => {
            e.stopPropagation();
            this.copyContent(id);
          });

          card.querySelector('.edit-btn')?.addEventListener('click', (e) => {
            e.stopPropagation();
            this.openEditModal(id);
          });

          card.querySelector('.delete-btn')?.addEventListener('click', (e) => {
            e.stopPropagation();
            this.deleteNote(id);
          });
        });
      }

      renderNoteCard(note) {
        const priorityColors = { 1: 'var(--p1)', 2: 'var(--p2)', 3: 'var(--p3)', 4: 'var(--p4)', 5: 'var(--p5)' };
        const priorityNames = { 1: '紧急', 2: '重要', 3: '一般', 4: '较低', 5: '日常' };
        const color = priorityColors[note.priority] || priorityColors[3];
        const name = priorityNames[note.priority] || '一般';
        const time = this.formatTime(note.createdAt);
        const completedClass = note.completed ? 'completed' : '';
        const completeIcon = note.completed
          ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><path d="m9 11 3 3L22 4"/></svg>'
          : '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/></svg>';
        const completeBtnClass = note.completed ? 'complete-btn completed-action' : 'complete-btn';

        return `
          <div class="note-card ${completedClass}" data-id="${note.id}">
            <div class="priority-bar" style="background:${color}"></div>
            <div class="note-header">
              <div style="display:flex;align-items:center;gap:8px;flex:1;min-width:0;">
                <span class="priority-badge" style="background:${color}">${name}</span>
              </div>
              <div class="note-actions">
                <button class="action-btn copy-btn" title="复制" aria-label="复制内容">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg>
                </button>
                <button class="action-btn ${completeBtnClass}" title="完成" aria-label="切换完成状态">
                  ${completeIcon}
                </button>
                <button class="action-btn edit-btn" title="编辑" aria-label="编辑">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/><path d="m15 5 4 4"/></svg>
                </button>
                <button class="action-btn delete-btn" title="删除" aria-label="删除">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/><line x1="10" x2="10" y1="11" y2="17"/><line x1="14" x2="14" y1="11" y2="17"/></svg>
                </button>
              </div>
            </div>
            <div class="note-content">${this.escapeHtml(note.content)}</div>
            <div class="note-meta">
              <span>${time}</span>
            </div>
          </div>
        `;
      }

      renderPagination(result) {
        const { total, totalPages, page } = result;
        if (totalPages <= 1) {
          this.els.pagination.style.display = 'none';
        } else {
          this.els.pagination.style.display = 'flex';
          this.els.prevBtn.disabled = page <= 1;
          this.els.nextBtn.disabled = page >= totalPages;
          this.els.pageInfo.textContent = `${page} / ${totalPages}`;
        }
      }

      async updateStats() {
        const stats = await this.db.getStats();
        this.els.stats.textContent = `${stats.total} 条记录`;
      }

      openCreateModal() {
        this.editingNote = null;
        this.els.modalTitle.textContent = '新建便利贴';
        this.els.noteContent.value = '';
        this.selectedPriority = 3;

        this.resetPrioritySelector();

        this.showModal();
      }

      async openEditModal(id) {
        const note = await this.db.get(id);
        if (!note) return;

        this.editingNote = note;
        this.els.modalTitle.textContent = '编辑便利贴';
        this.els.noteContent.value = note.content;
        this.selectedPriority = note.priority;

        // Update priority selector
        this.els.prioritySelector.querySelectorAll('.priority-option').forEach(opt => {
          opt.classList.toggle('selected', parseInt(opt.dataset.priority) === note.priority);
        });

        this.showModal();
      }

      async saveNote() {
        // 防止重复提交
        if (this._isSaving) return;
        this._isSaving = true;
        this.els.saveBtn.disabled = true;
        this.els.saveBtn.textContent = '保存中...';

        try {
          const content = this.els.noteContent.value.trim();
          if (!content) {
            this.showToast('请输入内容');
            this.els.noteContent.focus();
            return;
          }

          const now = await TimeService.getNetworkTime();

          if (this.editingNote) {
            // Update
            this.editingNote.content = content;
            this.editingNote.priority = this.selectedPriority;
            this.editingNote.updatedAt = now;
            await this.db.update(this.editingNote);
            this.showToast('已更新');
          } else {
            // Create
            const note = {
              content,
              priority: this.selectedPriority,
              completed: false,
              createdAt: now,
              updatedAt: now,
            };
            await this.db.add(note);
            this.showToast('已创建');
          }

          this.closeModal();
          this.loadNotes();
        } finally {
          this._isSaving = false;
          this.els.saveBtn.disabled = false;
          this.els.saveBtn.textContent = '保存';
        }
      }

      async toggleComplete(id) {
        const note = await this.db.get(id);
        if (!note) return;
        note.completed = !note.completed;
        note.updatedAt = await TimeService.getNetworkTime();
        await this.db.update(note);
        this.showToast(note.completed ? '已完成' : '已恢复');
        this.loadNotes();
      }

      async copyContent(id) {
        const note = await this.db.get(id);
        if (!note) return;
        try {
          await navigator.clipboard.writeText(note.content);
          this.showToast('已复制到剪贴板');
        } catch {
          // Fallback
          const ta = document.createElement('textarea');
          ta.value = note.content;
          ta.style.position = 'fixed';
          ta.style.left = '-9999px';
          document.body.appendChild(ta);
          ta.select();
          document.execCommand('copy');
          document.body.removeChild(ta);
          this.showToast('已复制到剪贴板');
        }
      }

      async deleteNote(id) {
        const confirmed = await this.showConfirm('确定要删除这条便利贴吗？');
        if (!confirmed) return;
        await this.db.delete(id);
        this.showToast('已删除');
        // Adjust page if needed
        const stats = await this.db.getStats();
        const totalPages = Math.ceil(stats.total / this.pageSize) || 1;
        if (this.currentPage > totalPages) this.currentPage = totalPages;
        this.loadNotes();
      }

      showModal() {
        this.els.modalOverlay.classList.add('active');
        this.els.modalSheet.classList.add('active');
        document.body.style.overflow = 'hidden';
        setTimeout(() => this.els.noteContent.focus(), 350);
      }

      closeModal() {
        this.els.modalOverlay.classList.remove('active');
        this.els.modalSheet.classList.remove('active');
        document.body.style.overflow = '';
      }

      showConfirm(message) {
        return new Promise((resolve) => {
          this.els.confirmMessage.textContent = message;
          this.els.confirmOverlay.classList.add('active');
          this.els.confirmDialog.classList.add('active');
          this._confirmResolve = resolve;
        });
      }

      _closeConfirm(result) {
        this.els.confirmOverlay.classList.remove('active');
        this.els.confirmDialog.classList.remove('active');
        if (this._confirmResolve) {
          this._confirmResolve(result);
          this._confirmResolve = null;
        }
      }

      showToast(message) {
        this.els.toast.textContent = message;
        this.els.toast.classList.add('show');
        setTimeout(() => this.els.toast.classList.remove('show'), 2000);
      }

      resetPrioritySelector() {
        this.els.prioritySelector.querySelectorAll('.priority-option').forEach(opt => {
          opt.classList.toggle('selected', parseInt(opt.dataset.priority) === 3);
        });
      }

      formatTime(timestamp) {
        const d = new Date(timestamp);
        const now = new Date();
        const diff = now - d;

        if (diff < 60000) return '刚刚';
        if (diff < 3600000) return `${Math.floor(diff / 60000)} 分钟前`;
        if (diff < 86400000 && d.getDate() === now.getDate()) {
          return `今天 ${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`;
        }

        const yesterday = new Date(now);
        yesterday.setDate(yesterday.getDate() - 1);
        if (d.getDate() === yesterday.getDate() && d.getMonth() === yesterday.getMonth()) {
          return `昨天 ${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`;
        }

        return `${d.getMonth() + 1}/${d.getDate()} ${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`;
      }

      toLocalDatetimeString(date) {
        const pad = n => n.toString().padStart(2, '0');
        return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
      }

      escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
      }

      // 请求通知权限（必须由用户点击触发）
      async requestNotification() {
        if (typeof notificationService === 'undefined') return;

        const result = await notificationService.requestPermission();
        
        if (result.success) {
          this.showToast('通知已开启');
          notificationService.sendText('便利贴通知已开启，重要提醒不会错过！');
          this.updateNotifyButton();
        } else {
          if (result.reason === 'denied') {
            this.showToast('通知权限被拒绝，请在系统设置中开启');
          } else if (result.reason === 'unsupported') {
            this.showToast('当前环境不支持通知');
          } else {
            this.showToast('通知开启失败');
          }
        }
      }

      // 更新通知按钮状态
      updateNotifyButton() {
        if (typeof notificationService === 'undefined' || !this.els.notifyBtn) return;

        const status = notificationService.getStatus();
        const btn = this.els.notifyBtn;

        btn.style.display = 'flex';

        if (status === 'granted') {
          btn.classList.add('granted');
          btn.querySelector('span').textContent = '已开启';
          if (this.els.testNotifyBtn) {
            this.els.testNotifyBtn.style.display = 'flex';
          }
        } else {
          btn.classList.remove('granted');
          btn.querySelector('span').textContent = '开启通知';
          if (this.els.testNotifyBtn) {
            this.els.testNotifyBtn.style.display = 'none';
          }
        }
      }

      // 测试发送通知
      async testNotification() {
        if (typeof notificationService === 'undefined') {
          this.showToast('通知服务未加载');
          return;
        }

        if (!notificationService.isAvailable()) {
          this.showToast('请先开启通知权限');
          return;
        }

        const sent = notificationService.sendText('这是一条测试通知，通知功能正常工作！');
        
        if (sent) {
          this.showToast('测试通知已发送，请查看通知栏');
        } else {
          this.showToast('发送失败，请重试');
        }
      }
    }

    // ==================== App Init ====================
    async function initApp() {
      const db = new DatabaseManager();
      await db.init();

      const ui = new UIManager(db);
      await ui.loadNotes();

      // 初始化通知服务
      if (typeof notificationService !== 'undefined') {
        await notificationService.init();
        // 更新通知按钮状态
        ui.updateNotifyButton();
      }

      // 页面隐藏时发送状态通知
      document.addEventListener('visibilitychange', async () => {
        if (document.visibilityState === 'hidden') {
          if (typeof notificationService === 'undefined' || !notificationService.isAvailable()) return;
          
          const stats = await db.getStats();
          const pendingCount = stats.pending || (stats.total - stats.completed);
          
          if (pendingCount > 0) {
            notificationService.send(
              '便利贴状态',
              `您有 ${pendingCount} 条未完成的便利贴`,
              { tag: 'page-hidden-status', autoClose: 5000 }
            );
          } else {
            notificationService.send(
              '便利贴状态',
              `当前共有 ${stats.total} 条便利贴，全部已完成`,
              { tag: 'page-hidden-status', autoClose: 4000 }
            );
          }
        }
      });
    }

    initApp().catch(console.error);
