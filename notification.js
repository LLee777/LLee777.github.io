// ==================== Notification Service ====================
// 支持 iPhone PWA（添加到主屏幕后）的通知功能
// 需要 iOS 16.4+ 且用户已将应用添加到主屏幕

class NotificationService {
  constructor() {
    this.isSupported = 'Notification' in window;
    this.isStandalone = window.matchMedia('(display-mode: standalone)').matches
      || window.navigator.standalone === true;
  }

  // 检查通知是否可用
  isAvailable() {
    if (!this.isSupported) return false;
    // iPhone PWA 模式下才支持通知
    if (/iPhone|iPad|iPod/.test(navigator.userAgent) && !this.isStandalone) return false;
    return true;
  }

  // 获取当前权限状态
  getPermission() {
    if (!this.isSupported) return 'unsupported';
    return Notification.permission;
  }

  // 请求通知权限
  async requestPermission() {
    if (!this.isSupported) {
      console.log('[Notification] 当前环境不支持通知');
      return false;
    }

    if (Notification.permission === 'granted') return true;
    if (Notification.permission === 'denied') return false;

    try {
      const result = await Notification.requestPermission();
      return result === 'granted';
    } catch (e) {
      console.error('[Notification] 请求权限失败:', e);
      return false;
    }
  }

  // 发送通知
  send(title, body, options = {}) {
    if (!this.isAvailable()) {
      console.log('[Notification] 通知不可用（iPhone 需添加到主屏幕）');
      return false;
    }

    if (Notification.permission !== 'granted') {
      console.log('[Notification] 未获得通知权限');
      return false;
    }

    try {
      const notification = new Notification(title, {
        body,
        icon: options.icon || 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><text y=".9em" font-size="90">📝</text></svg>',
        badge: options.badge || 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><text y=".9em" font-size="90">📝</text></svg>',
        tag: options.tag || 'sticky-note',
        lang: 'zh-CN',
        ...options,
      });

      // 点击通知时聚焦窗口
      notification.onclick = () => {
        window.focus();
        notification.close();
      };

      // 自动关闭（默认 5 秒）
      const autoClose = options.autoClose !== false ? (options.autoClose || 5000) : 0;
      if (autoClose > 0) {
        setTimeout(() => notification.close(), autoClose);
      }

      return true;
    } catch (e) {
      console.error('[Notification] 发送失败:', e);
      return false;
    }
  }

  // 发送便利贴提醒通知
  sendNoteReminder(note) {
    const priorityNames = { 1: '紧急', 2: '重要', 3: '一般', 4: '较低', 5: '日常' };
    const priority = priorityNames[note.priority] || '一般';
    const content = note.content.length > 80
      ? note.content.substring(0, 80) + '...'
      : note.content;

    return this.send(
      `📝 便利贴提醒 [${priority}]`,
      content,
      { tag: `note-${note.id}`, autoClose: 8000 }
    );
  }

  // 发送文本提示通知（通用）
  sendText(message) {
    return this.send('便利贴', message, { autoClose: 4000 });
  }

  // 初始化：注册 service worker 并请求权限
  async init() {
    // 注册 Service Worker（PWA 通知必需）
    if ('serviceWorker' in navigator) {
      try {
        await navigator.serviceWorker.register('./sw.js');
        console.log('[Notification] Service Worker 已注册');
      } catch (e) {
        console.error('[Notification] Service Worker 注册失败:', e);
      }
    }

    // 如果是 PWA 模式且通知权限未决定，提示用户
    if (this.isAvailable() && Notification.permission === 'default') {
      return this.requestPermission();
    }

    return Notification.permission === 'granted';
  }
}

// 导出全局实例
const notificationService = new NotificationService();
