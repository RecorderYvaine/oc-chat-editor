const STORAGE_KEY = 'oc-form-creator:chat-editor:v1';
const HANDLE_DB_NAME = 'oc-form-creator:project-handles';
const HANDLE_STORE_NAME = 'handles';
const PROJECT_FILE_NAME = 'chat-editor-project.json';
const root = document.querySelector('#chat-editor');
const $ = (selector, scope = document) => scope.querySelector(selector);
const $$ = (selector, scope = document) => [...scope.querySelectorAll(selector)];
const uid = (prefix) => `${prefix}-${Math.random().toString(36).slice(2, 9)}`;

const defaultCharacters = [
  { id: 'char-me', name: '林澈', avatar: '🌙', side: 'right', bubble: '#b8efc9', text: '#1c2a20', pokeSuffix: '' },
  { id: 'char-aria', name: 'Aria', avatar: '🫧', side: 'left', bubble: '#ffffff', text: '#242b31', pokeSuffix: '' },
  { id: 'char-chen', name: '陈一', avatar: '🪴', side: 'left', bubble: '#ffffff', text: '#242b31', pokeSuffix: '' },
];

const defaultChat = {
  id: 'chat-afternoon',
  title: '午后小组',
  subtitle: '原创角色讨论',
  type: 'group',
  memberIds: ['char-me', 'char-aria', 'char-chen'],
  settings: { surfaceVersion: 2, background: null, wallpaper: 'none', bubbleRadius: null, fontSize: 17, phoneTime: '09:41', battery: 100, showAvatars: true, showNames: true },
  messages: [
    { id: 'time-1', kind: 'time', format: 'dateTime', date: '2026-10-26', time: '14:30', weekday: '周一', label: '2026年10月26日 14:30' },
    { id: 'msg-1', kind: 'message', senderId: 'char-aria', time: '14:31', text: '大家下午好！新一版的角色关系图我整理完了。' },
    { id: 'msg-2', kind: 'message', senderId: 'char-me', time: '14:32', text: '看到了，主线的情绪变化很顺。我们可以再补一条隐藏支线。' },
    { id: 'notice-1', kind: 'system', text: '你邀请了陈一加入群聊' },
    { id: 'msg-3', kind: 'message', senderId: 'char-chen', time: '14:35', text: '收到！我来补充结尾部分。' },
  ],
};

const defaultState = {
  theme: 'wechat',
  activeChatId: defaultChat.id,
  activeMessageId: 'msg-2',
  activeTab: 'chat',
  zoom: 1,
  characters: defaultCharacters,
  chats: [defaultChat],
};

let state = loadState();
let saveTimer;
let settingsTab = 'characters';
let inspectorTab = 'message';
let selectedMessageIds = new Set();
let messageListSelectionMode = false;
let draggedMessageId = null;
let draggedListMessageId = null;
let zoomFrame = 0;
let pendingZoom = null;
let pendingModalAction = null;
let pngPreviewUrl = '';
let exportSession = { kind: 'single', offsets: [], pages: [], selected: 0, maxScroll: 0, messageTop: 0, messageHeight: 0 };
let exportGeneration = 0;
let exportPreviewOffset = 0;
let undoStack = [];
let redoStack = [];
let lastHistoryState = clone(state);
let historyBase = null;
let historyTimer;
let historyApplying = false;
let pointerDrag = null;
let quotePickingMessage = false;
let projectDirectoryHandle = null;
let projectSaveInFlight = Promise.resolve();
// Native browsers may emit a click after a pointer drag. Keep a short,
// position-based guard for that synthetic click so the next independent
// message click is never swallowed.
let suppressNextMessageClick = null;

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function loadState() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (saved?.chats?.length && saved?.characters?.length) return normalizeState(saved);
  } catch (error) {
    console.warn('无法读取聊天编辑器草稿', error);
  }
  return clone(defaultState);
}

function normalizeState(saved) {
  const next = { ...clone(defaultState), ...saved };
  next.theme = ['wechat', 'qq', 'imessage'].includes(saved.theme) ? saved.theme : 'wechat';
  next.zoom = Math.max(0.25, Math.min(1.25, Number(saved.zoom) || 1));
  next.characters = Array.isArray(saved.characters) && saved.characters.length ? saved.characters : clone(defaultCharacters);
  next.chats = Array.isArray(saved.chats) && saved.chats.length ? saved.chats.map(normalizeChat) : [clone(defaultChat)];
  if (!next.chats.some((chat) => chat.id === next.activeChatId)) next.activeChatId = next.chats[0].id;
  next.chats.forEach((chat) => {
    chat.memberIds = [...new Set(chat.memberIds)].filter((id) => next.characters.some((item) => item.id === id));
    // Preserve imported members by opening an oversized private scene as a group.
    if (chat.type === 'private' && chat.memberIds.length > 2) chat.type = 'group';
    if (chat.type === 'private' && !chat.memberIds.length) chat.memberIds = [next.characters[0].id];
    chat.messages.forEach((message) => {
      if (!message.quoteSenderId && message.quoteSender) message.quoteSenderId = next.characters.find((item) => item.name === message.quoteSender)?.id || '';
      if (message.kind === 'poke' && !message.targetId) message.targetId = chat.memberIds.find((id) => id !== message.senderId) || message.senderId;
    });
  });
  return next;
}

function normalizeChat(chat) {
  const settings = { ...clone(defaultChat.settings), ...(chat.settings || {}) };
  // Retire the original mockup defaults while retaining deliberate custom values.
  if (chat.settings?.surfaceVersion !== 2) {
    if (settings.background === '#e9eef2') settings.background = null;
    if (settings.wallpaper === 'dots') settings.wallpaper = 'none';
    if (settings.bubbleRadius === 15) settings.bubbleRadius = null;
    if (settings.fontSize === 13) settings.fontSize = 17;
  }
  settings.surfaceVersion = 2;
  return {
    ...clone(defaultChat),
    ...chat,
    settings,
    memberIds: Array.isArray(chat.memberIds) ? chat.memberIds : [],
    messages: Array.isArray(chat.messages) ? chat.messages.map(normalizeMessage) : [],
  };
}

function normalizeMessage(message) {
  const normalized = {
    hasTranscript: false,
    unread: false,
    duration: 3,
    quoteEnabled: false,
    quoteText: '',
    quoteSender: '',
    quoteSenderId: '',
    ...message,
    status: message.status === 'failed' ? 'failed' : 'sent',
  };
  if (normalized.kind === 'call' && normalized.callStatus === 'ringing') normalized.callStatus = 'missed';
  if (normalized.kind === 'time') {
    normalized.format ||= 'dateTime';
    normalized.date ||= '2026-10-26';
    normalized.time ||= String(normalized.label || '14:30').match(/\d{1,2}:\d{2}/)?.[0] || '14:30';
    normalized.weekday ||= '周一';
  }
  return normalized;
}

function activeChat() {
  return state.chats.find((chat) => chat.id === state.activeChatId) || state.chats[0];
}

function visibleMessages(chat = activeChat()) {
  return chat.messages.filter((message) => supportedMessageKinds().includes(message.kind)).filter((message) => chat.type !== 'private' || ['time', 'system', 'recall'].includes(message.kind) || (chat.memberIds.includes(message.senderId) && (message.kind !== 'poke' || chat.memberIds.includes(message.targetId))));
}

function activeMessage() {
  return activeChat().messages.find((message) => message.id === state.activeMessageId);
}

function character(id) {
  return state.characters.find((item) => item.id === id);
}

function bubbleColorFor(item) {
  if (item?.bubbleMode === 'custom') return item.bubble || '#ffffff';
  if (state.theme === 'qq') return item?.side === 'right' ? '#009fff' : '#ffffff';
  if (state.theme === 'imessage') return item?.side === 'right' ? '#0a84ff' : '#e9e9eb';
  return item?.side === 'right' ? '#95ec69' : '#ffffff';
}

function scheduleSave() {
  if (!historyApplying) {
    if (!historyBase) historyBase = clone(lastHistoryState);
    lastHistoryState = clone(state);
    clearTimeout(historyTimer);
    historyTimer = setTimeout(() => {
      if (historyBase && JSON.stringify(historyBase) !== JSON.stringify(state)) {
        undoStack.push(historyBase);
        if (undoStack.length > 80) undoStack.shift();
        redoStack = [];
      }
      historyBase = null;
      lastHistoryState = clone(state);
      updateHistoryButtons();
    }, 380);
  }
  clearTimeout(saveTimer);
  $('#save-state').textContent = '正在保存…';
  saveTimer = setTimeout(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
      $('#save-state').textContent = projectDirectoryHandle ? '已保存到本地文件' : '已保存到浏览器';
      if (projectDirectoryHandle) persistProjectFile();
    } catch { $('#save-state').textContent = '保存失败，请导出备份'; }
  }, 280);
}

function flushHistory() {
  clearTimeout(historyTimer);
  if (historyBase && JSON.stringify(historyBase) !== JSON.stringify(state)) {
    undoStack.push(historyBase);
    if (undoStack.length > 80) undoStack.shift();
    redoStack = [];
  }
  historyBase = null;
  lastHistoryState = clone(state);
  updateHistoryButtons();
}

function updateHistoryButtons() {
  $('#undo-button').disabled = !undoStack.length;
  $('#redo-button').disabled = !redoStack.length;
}

function undo() {
  flushHistory();
  if (!undoStack.length) return;
  redoStack.push(clone(state));
  historyApplying = true;
  state = undoStack.pop();
  historyApplying = false;
  lastHistoryState = clone(state);
  render(); scheduleSave(); updateHistoryButtons();
}

function redo() {
  flushHistory();
  if (!redoStack.length) return;
  undoStack.push(clone(state));
  historyApplying = true;
  state = redoStack.pop();
  historyApplying = false;
  lastHistoryState = clone(state);
  render(); scheduleSave(); updateHistoryButtons();
}

function setState(mutator, rerender = true) {
  mutator(state);
  scheduleSave();
  if (rerender) render();
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char]));
}

function avatarMarkup(item, extraClass = '') {
  const avatar = item?.avatar || '◌';
  const image = /^(?:https?:\/\/|data:image\/)/.test(avatar) ? `<img src="${escapeHtml(avatar)}" alt="" />` : escapeHtml(avatar);
  return `<span class="avatar ${extraClass}">${image}</span>`;
}

function render() {
  const chat = activeChat();
  if (!chat) return;
  if (!activeMessage()) state.activeMessageId = visibleMessages(chat).at(-1)?.id || null;
  root.className = `theme-${state.theme}`;
  $('#inspector-chat-title').textContent = chat.title || '未命名聊天';
  renderChatChrome();
  updatePreviewScale();
  renderChatList();
  renderMessages();
  renderInspector();
  syncComposer();
  updateHistoryButtons();
  if (!$('#scene-settings-modal').hidden) renderSceneSettings(settingsTab);
}

async function initializeProjectStorage() {
  if (!window.showDirectoryPicker) {
    $('#save-state').textContent = '已保存到浏览器';
    return;
  }
  try {
    const directory = await readStoredProjectHandle();
    if (!directory || await directory.queryPermission({ mode: 'readwrite' }) !== 'granted') {
      $('#save-state').textContent = '已保存到浏览器';
      return;
    }
    projectDirectoryHandle = directory;
    const loaded = await restoreProjectFile(directory);
    if (!loaded) await persistProjectFile();
    $('#save-state').textContent = loaded ? '已从本地文件加载' : '已保存到本地文件';
  } catch {
    projectDirectoryHandle = null;
    $('#save-state').textContent = '已保存到浏览器';
  }
}

function updatePreviewScale() {
  pendingZoom = state.zoom;
  if (!zoomFrame) zoomFrame = requestAnimationFrame(() => {
    zoomFrame = 0;
    $('.preview-area').style.setProperty('--preview-scale', pendingZoom);
    centerPreview();
  });
  if (document.activeElement !== $('#zoom-input')) $('#zoom-input').value = Math.round(state.zoom * 100);
}

function centerPreview() {
  const area = $('.preview-area');
  area.scrollLeft = Math.max(0, (area.scrollWidth - area.clientWidth) / 2);
  area.scrollTop = Math.max(0, (area.scrollHeight - area.clientHeight) / 2);
}

function setZoom(value) {
  state.zoom = Math.max(0.25, Math.min(1.25, value));
  updatePreviewScale();
  scheduleSave();
}

function fitPreview() {
  const area = $('.preview-area');
  setZoom(Math.min(1, (area.clientWidth - 36) / 402, (area.clientHeight - 36) / 874));
}

function syncComposer() {
  const draft = activeChat().draft || '';
  $$('[data-composer-input]').forEach((input) => { if (input.value !== draft) input.value = draft; });
  $$('[data-composer]').forEach((form) => {
    form.classList.toggle('has-draft', Boolean(draft.trim()));
    $('.native-send', form).hidden = !draft.trim();
  });
}

function renderChatChrome() {
  const chat = activeChat();
  $('.device-frame').dataset.chatType = chat.type;
  $('#preview-clock').textContent = (chat.settings.phoneTime || '09:41').replace(/^0/, '');
  $('#battery-fill').setAttribute('width', String(Math.max(0, Math.min(100, Number(chat.settings.battery ?? 100) || 0)) / 5));
  $('#battery-fill').setAttribute('fill', Number(chat.settings.battery ?? 100) <= 20 ? '#ff3b30' : 'currentColor');
  $('.status-battery').setAttribute('aria-label', `电量 ${chat.settings.battery ?? 100}%`);
  $('#preview-chat-title').textContent = chat.title || '未命名聊天';
  const contact = character(chat.memberIds.find((id) => character(id)?.side !== 'right') || chat.memberIds[0]);
  $('#imessage-contact-avatar').innerHTML = avatarMarkup(contact, 'imessage-header-avatar');
  $('#imessage-contact-title').textContent = chat.title || contact?.name || '聊天';
  $('#preview-chat-count').textContent = chat.type === 'group' ? `(${chat.memberIds.length})` : '';
  $('#preview-chat-subtitle').textContent = chat.subtitle || (chat.type === 'group' ? '群聊' : '在线');
}

const timeFormats = {
  time: ({ time }) => time || '12:32',
  yesterday: ({ time }) => `昨天 ${time || '12:32'}`,
  weekday: ({ weekday = '周一', time }) => `${weekday} ${time || '12:32'}`,
  monthDay: ({ date = '2026-10-26', time }) => `${date.slice(5).replace('-', '月')}日 ${time || '12:32'}`,
  monthDayWeekday: ({ date = '2026-10-26', weekday = '周一', time }) => `${date.slice(5).replace('-', '月')}日 ${weekday} ${time || '12:32'}`,
  dateTime: ({ date = '2026-10-26', time }) => `${date.replace('-', '年').replace('-', '月')}日 ${time || '12:32'}`,
};

function formatTimeMessage(message) {
  if (!message || message.kind !== 'time') return message?.label || '';
  if (message.format === 'dateTime') {
    const parts = String(message.date || '2026-10-26').split('-');
    return `${parts[0]}年${parts[1]}月${parts[2]}日 ${message.time || '12:32'}`;
  }
  return (timeFormats[message.format] || timeFormats.dateTime)(message);
}

function nativeBackground() {
  return activeChat().settings.background || (state.theme === 'qq' ? '#f1f1f1' : state.theme === 'imessage' ? '#ffffff' : '#ededed');
}

function nativeRadius() {
  return activeChat().settings.bubbleRadius ?? (state.theme === 'qq' ? 12 : state.theme === 'imessage' ? 20 : 4);
}

function bubbleTextFor(item) {
  if (item?.textMode === 'custom' || !['#1c2a20', '#242b31', '#181818', undefined].includes(item?.text)) {
    return item?.text || '#181818';
  }
  return ['qq', 'imessage'].includes(state.theme) && item?.side === 'right' ? '#ffffff' : '#181818';
}

function senderLabel(item) {
  return `${item.name || '未命名角色'}${item.side === 'right' ? '（右）' : ''}`;
}

function quoteContentForMessage(message) {
  if (!message) return '';
  if (['message', 'emoji', 'sticker'].includes(message.kind)) return message.text || (message.kind === 'emoji' ? '🙂' : '表情包');
  if (message.kind === 'voice') return message.hasTranscript && message.transcript ? message.transcript : `[语音 ${Number(message.duration) || 3}秒]`;
  if (message.kind === 'image') return '[图片]';
  if (message.kind === 'video') return '[视频]';
  if (message.kind === 'redpacket') return `[红包] ${message.text || '恭喜发财，大吉大利'}`;
  if (message.kind === 'transfer') return `[转账] ¥${message.amount || '0.00'}`;
  if (message.kind === 'location') return `[位置] ${message.locationName || '位置'}`;
  if (message.kind === 'file') return `[文件] ${message.filename || '文档.pdf'}`;
  if (message.kind === 'call') return `[${message.callType === 'video' ? '视频' : '语音'}通话]`;
  if (message.kind === 'poke') return '[戳一戳]';
  if (message.kind === 'recall') return '[撤回消息]';
  if (message.kind === 'system') return message.text || '系统通知';
  if (message.kind === 'time') return formatTimeMessage(message);
  return message.text || messageKindLabel(message.kind);
}

function applyQuoteFromMessage(sourceId) {
  const target = activeMessage();
  const source = activeChat().messages.find((item) => item.id === sourceId);
  if (!target || !source || target.id === source.id) return;
  const sender = character(source.senderId);
  target.quoteEnabled = true;
  target.quoteSenderId = sender?.id || '';
  target.quoteSender = sender?.name || '引用消息';
  target.quoteText = quoteContentForMessage(source);
  scheduleSave();
  render();
}

function renderChatList() {
  const query = ($('#chat-search').value || '').trim().toLowerCase();
  const chats = state.chats.filter((chat) => `${chat.title} ${chat.subtitle}`.toLowerCase().includes(query));
  $('#chat-list').innerHTML = chats.length ? chats.map((chat) => {
    const firstCharacter = character(chat.memberIds[0]);
    const lastMessage = visibleMessages(chat).filter((item) => !['time', 'system', 'poke', 'recall'].includes(item.kind)).at(-1);
    const content = lastMessage && (['message', 'emoji'].includes(lastMessage.kind)
      ? lastMessage.text || ''
      : `[${messageKindLabel(lastMessage.kind)}]`);
    const preview = lastMessage ? `${character(lastMessage.senderId)?.name || '未命名角色'}：${content}` : '还没有消息';
    return `<button class="chat-card ${chat.id === state.activeChatId ? 'active' : ''}" data-chat-id="${chat.id}" type="button">
      ${avatarMarkup(firstCharacter)}
      <span class="chat-card-copy"><span class="chat-card-title">${escapeHtml(chat.title || '未命名聊天')}</span><span class="chat-card-meta">${escapeHtml(preview)}</span></span>
    </button>`;
  }).join('') : '<div class="empty-state">没有聊天场景</div>';
}

function renderMessages() {
  const chat = activeChat();
  const settings = chat.settings;
  const bg = nativeBackground();
  const wallpaper = settings.wallpaper === 'none' ? 'none' : settings.wallpaper === 'soft' ? 'soft' : 'dots';
  $('#chat-window').style.setProperty('--native-bg', bg);
  $('#chat-window').style.setProperty('--bubble-radius', `${nativeRadius()}px`);
  $('#chat-window').style.setProperty('--message-size', `${Number(settings.fontSize) || 17}px`);
  $('#messages').className = `messages wallpaper-${wallpaper}`;
  $('#messages').innerHTML = visibleMessages(chat).map((message) => renderMessage(message, chat)).join('') || '';
  $$('#messages img').forEach((image) => { image.draggable = false; });
}

function reorderControls(message) {
  const messages = visibleMessages();
  const index = messages.findIndex((item) => item.id === message.id);
  return `<div class="message-reorder-controls"><button type="button" data-message-move="up" title="上移" ${index === 0 ? 'disabled' : ''}>↑</button><button type="button" data-message-move="down" title="下移" ${index === messages.length - 1 ? 'disabled' : ''}>↓</button></div>`;
}

function renderMessage(message, chat) {
  const selected = message.id === state.activeMessageId || selectedMessageIds.has(message.id);
  const attrs = `data-message-id="${escapeHtml(message.id)}"`;
  const controls = reorderControls(message);
  const failed = message.status === 'failed' ? '<span class="failed-mark" aria-label="发送失败">!</span>' : '';
  if (['time', 'system', 'poke', 'recall'].includes(message.kind)) {
    const body = message.kind === 'time' ? escapeHtml(formatTimeMessage(message) || '时间') : ['poke', 'recall'].includes(message.kind) ? renderMessageBody(message) : escapeHtml(message.text || '系统通知');
    return `<div class="message-select ${message.kind === 'time' ? 'time-divider' : 'system-notice'} ${selected ? 'selected' : ''}" ${attrs}><span class="notice-content">${failed}${body}</span>${controls}</div>`;
  }
  const sender = character(message.senderId);
  const side = sender?.side === 'right' ? 'right' : 'left';
  const showName = chat.settings.showNames !== false && chat.type === 'group' && side === 'left';
  const bare = ['sticker', 'image', 'video'].includes(message.kind);
  const style = `--bubble-bg:${escapeHtml(message.kind === 'redpacket' ? '#f79b49' : bubbleColorFor(sender))};--bubble-text:${escapeHtml(bubbleTextFor(sender))};`;
  const transcript = message.kind === 'voice' && message.hasTranscript && message.transcript ? `<div class="voice-transcript">${escapeHtml(message.transcript)}</div>` : '';
  const quote = !bare && ['message', 'emoji', 'voice'].includes(message.kind) && message.quoteEnabled && message.quoteText ? `<div class="message-quote"><b>${escapeHtml(message.quoteSender || character(message.quoteSenderId)?.name || '引用消息')}</b><span>${escapeHtml(message.quoteText)}</span></div>` : '';
  return `<div class="message-select bubble-row ${side} ${selected ? 'selected' : ''}" ${attrs}>
    ${chat.settings.showAvatars !== false ? avatarMarkup(sender, 'small') : ''}
    <div class="bubble-wrap">${showName ? `<div class="sender-name">${escapeHtml(sender?.name || '未命名角色')}</div>` : ''}
      <div class="message-payload" style="${style}">${failed}<div class="bubble ${bare ? 'media-bubble' : ''} ${message.kind === 'redpacket' ? 'redpacket-bubble' : ''} ${['transfer','call','location','file'].includes(message.kind) ? `${message.kind}-bubble` : ''}">${quote}${renderMessageBody(message)}</div>${message.kind === 'voice' && message.unread && side !== 'right' ? '<i class="voice-unread"></i>' : ''}</div>${transcript}
    </div>${controls}
  </div>`;
}

function renderMessageBody(message) {
  if (message.kind === 'emoji') return `<span class="emoji-message">${escapeHtml(message.text || '🙂')}</span>`;
  if (message.kind === 'sticker') return `<div class="sticker-message">${message.image ? `<img src="${escapeHtml(message.image)}" alt="表情包" />` : `<div class="sticker-art">${escapeHtml(message.text || '🥺')}</div>`}</div>`;
  if (['image', 'video'].includes(message.kind)) return `<div class="media-message ${message.kind === 'video' ? 'video-message' : ''}">${message.image ? `<img src="${escapeHtml(message.image)}" alt="${message.kind === 'video' ? '视频封面' : '图片'}" />` : '<div class="media-placeholder"></div>'}${message.kind === 'video' ? '<span class="play-mark">▶</span>' : ''}</div>`;
  if (message.kind === 'recall') {
    const sender = character(message.senderId);
    const name = sender?.side === 'right' ? '你' : sender?.name || '对方';
    return state.theme === 'imessage' ? `${escapeHtml(name)}撤回了一条信息` : state.theme === 'qq' ? `${escapeHtml(name)}撤回了一条消息` : `${sender?.side === 'right' ? '你' : `“${escapeHtml(name)}”`}撤回了一条消息`;
  }
  if (message.kind === 'location') return `<div class="location-message"><div class="location-copy"><b>${escapeHtml(message.locationName || '位置')}</b><span>${escapeHtml(message.locationAddress || '详细地址')}</span></div><div class="location-map"><img src="${escapeHtml(message.image || './assets/chat-editor/location-map.svg')}" alt="位置地图" /></div>${state.theme === 'imessage' ? '<div class="location-source">地图</div>' : ''}</div>`;
  if (message.kind === 'file') {
    const extension = (message.filename || '文档.pdf').split('.').at(-1).slice(0, 5).toUpperCase();
    return `<div class="file-message"><div class="file-copy"><b>${escapeHtml(message.filename || '文档.pdf')}</b><span>${escapeHtml(message.fileSize || '1.2 MB')}</span></div><span class="file-icon">${escapeHtml(extension)}</span>${state.theme === 'qq' ? `<div class="file-footer">${escapeHtml(message.fileState || '已发送')}</div>` : ''}</div>`;
  }
  if (message.kind === 'redpacket') {
    const cover = message.image ? `<img class="redpacket-cover-image" src="${escapeHtml(message.image)}" alt="红包封面" />` : '';
    const icon = '<svg class="redpacket-icon" viewBox="0 0 36 44" aria-hidden="true"><rect x="1" y="1" width="34" height="42" rx="3" fill="#e86b43"/><path d="m1 12 17 11 17-11" fill="none" stroke="#ffcf8a" stroke-width="1.5"/><circle cx="18" cy="23" r="6" fill="#ffcf8a"/></svg>';
    if (state.theme === 'qq') return `<div class="redpacket-message qq-redpacket">${cover}<div class="qq-redpacket-main"><span class="qq-redpacket-envelope">${icon}</span><div><b>${escapeHtml(message.text || '恭喜发财，大吉大利')}</b><small>QQ红包</small></div></div><div class="qq-redpacket-footer">${escapeHtml(message.qqPacketLabel || 'QQ红包')}</div></div>`;
    return `<div class="redpacket-message wechat-redpacket">${cover}<div class="redpacket-main"><span class="wechat-redpacket-envelope">${icon}</span><div><b>${escapeHtml(message.text || '恭喜发财，大吉大利')}</b><small>微信红包</small></div></div><div class="redpacket-footer">微信红包</div></div>`;
  }
  if (message.kind === 'transfer') {
    const status = message.transferStatus === 'received' ? '我已收款' : message.transferStatus === 'otherReceived' ? '对方已收款' : message.transferStatus === 'returned' ? '已退还' : '待收款';
    const icon = ['received', 'otherReceived'].includes(message.transferStatus) ? '✓' : '¥';
    if (state.theme === 'qq') return `<div class="transfer-message qq-transfer"><div class="transfer-main"><span class="transfer-icon">${icon}</span><div><b>¥${escapeHtml(message.amount || '0.00')}</b><small>${escapeHtml(message.transferNote || '转账')}</small></div></div><div class="transfer-footer"><span>QQ转账</span><span>${status}</span></div></div>`;
    return `<div class="transfer-message wechat-transfer"><div class="transfer-main"><span class="transfer-icon">${icon}</span><div><b>¥${escapeHtml(message.amount || '0.00')}</b><small>${escapeHtml(message.transferNote || '微信转账')}</small></div></div><div class="transfer-footer"><span>微信转账</span><span>${status}</span></div></div>`;
  }
  if (message.kind === 'call') {
    const sender = character(message.senderId);
    const statuses = { missed: sender?.side === 'right' ? '对方无应答' : '未接听', cancelled: sender?.side === 'right' ? '已取消' : '对方已取消', declined: sender?.side === 'right' ? '对方已拒绝' : '已拒绝', busy: '对方忙线中' };
    const icon = message.callType === 'video' ? '<rect x="3" y="5" width="13" height="13" rx="3"/><path d="m16 9 6-3v11l-6-3Z"/>' : '<path d="m4 3 4 1 1 5-3 2q3 6 8 7l2-3 5 1 1 4q-1 3-5 2Q4 19 2 7 1 4 4 3Z"/>';
    const status = message.callStatus === 'connected'
      ? `通话时长 ${String(Math.floor((Number(message.callDuration) || 0) / 60)).padStart(2, '0')}:${String((Number(message.callDuration) || 0) % 60).padStart(2, '0')}`
      : (statuses[message.callStatus] || statuses.missed);
    return `<div class="call-message ${state.theme === 'qq' ? 'qq-call' : 'wechat-call'}"><svg class="call-icon" viewBox="0 0 25 25">${icon}</svg><span>${escapeHtml(status)}</span></div>`;
  }
  if (message.kind === 'poke') {
    const sender = character(message.senderId);
    const target = character(message.targetId) || sender;
    const suffix = message.pokeSuffix ?? target?.pokeSuffix ?? '';
    return state.theme === 'qq'
      ? `${escapeHtml(sender?.name || '未命名角色')} <img class="qq-poke-hand" src="./assets/chat-editor/qq-poke.png" alt="戳一戳" /> 戳了戳 ${escapeHtml(target?.name || '未命名角色')}${suffix ? ` ${escapeHtml(suffix)}` : ''}`
      : `“${escapeHtml(sender?.name || '未命名角色')}”拍了拍“${escapeHtml(target?.name || '未命名角色')}”${escapeHtml(suffix)}`;
  }
  if (message.kind === 'voice') {
    const width = Math.min(200, 68 + (Number(message.duration) || 3) * 2);
    if (state.theme === 'imessage') return `<div class="voice-message" style="width:${Math.max(150, width)}px"><span class="imessage-waveform">${[5,9,17,12,22,8,14,24,16,9,18,6,11,20,14,8,17,10].map((height) => `<i style="--bar:${height}px"></i>`).join('')}</span><b>${Math.floor((Number(message.duration) || 3) / 60)}:${String((Number(message.duration) || 3) % 60).padStart(2,'0')}</b></div>`;
    return `<div class="voice-message" style="width:${width}px"><svg class="voice-wave" viewBox="0 0 22 24" aria-hidden="true"><path d="M6 10q3 2 0 4m4-8q7 6 0 12m4-16q11 10 0 20"/></svg><b>${Number(message.duration) || 3}″</b></div>`;
  }
  return escapeHtml(message.text || '');
}

function supportedMessageKinds() {
  const common = ['message', 'emoji', 'sticker', 'image', 'video', 'voice', 'time', 'location', 'file', 'recall'];
  return state.theme === 'imessage' ? common : [...common, 'redpacket', 'transfer', 'call', 'poke', 'system'];
}

function messageKindOptions(value) {
  const kinds = supportedMessageKinds();
  if (value && !kinds.includes(value)) kinds.unshift(value);
  return kinds.map((kind) => `<option value="${kind}" ${kind === value ? 'selected' : ''} ${!supportedMessageKinds().includes(kind) ? 'disabled' : ''}>${messageKindLabel(kind)}${!supportedMessageKinds().includes(kind) ? '（当前主题隐藏）' : ''}</option>`).join('');
}

function renderInspector() {
  $('#inspector-chat-title').textContent = activeChat().title || '未命名聊天';
  $$('[data-inspector-tab]').forEach((button) => button.classList.toggle('active', button.dataset.inspectorTab === inspectorTab));
  $('#message-list-tools').hidden = inspectorTab !== 'message';
  $('#settings-footer').hidden = inspectorTab !== 'settings';
  $('#inspector-content').innerHTML = inspectorTab === 'settings' ? renderChatInspector() : renderMessageInspector();
}

function renderAllMessages() {
  selectedMessageIds = new Set([...selectedMessageIds].filter((id) => activeChat().messages.some((message) => message.id === id)));
  $('#all-messages-list').innerHTML = activeChat().messages.map((message, index) => `<div class="all-message-row" draggable="true" data-list-drag="${message.id}">${messageListSelectionMode ? `<input type="checkbox" data-list-select="${message.id}" ${selectedMessageIds.has(message.id) ? 'checked' : ''} aria-label="选择第 ${index + 1} 条" />` : ''}<button data-list-message="${message.id}" type="button"><span>${index + 1} · ${escapeHtml(messageKindLabel(message.kind))}${!supportedMessageKinds().includes(message.kind) ? ' · 当前主题隐藏' : ''}</span><b>${escapeHtml(message.kind === 'time' ? formatTimeMessage(message) : message.text || message.filename || message.locationName || messageKindLabel(message.kind))}</b></button></div>`).join('');
  $('#message-list-select-mode').textContent = messageListSelectionMode ? '完成选择' : '选择';
  $('#message-list-title').textContent = quotePickingMessage ? '选择要引用的消息' : '所有消息';
  $('#message-list-select-mode').classList.toggle('active', messageListSelectionMode);
  $('#select-all-messages').hidden = !messageListSelectionMode;
  $('#select-all-messages').checked = selectedMessageIds.size === activeChat().messages.length && selectedMessageIds.size > 0;
  $('#select-all-messages').indeterminate = selectedMessageIds.size > 0 && selectedMessageIds.size < activeChat().messages.length;
  $('#delete-selected-messages').disabled = !selectedMessageIds.size;
  $('#delete-selected-messages').textContent = `删除已选${selectedMessageIds.size ? `（${selectedMessageIds.size}）` : ''}`;
  $('#message-list-modal').hidden = false;
}

function deleteSelectedMessages() {
  const ids = new Set(selectedMessageIds);
  showConfirm('批量删除', `确定删除选中的 ${ids.size} 条消息吗？`, () => {
    activeChat().messages = activeChat().messages.filter((message) => !ids.has(message.id));
    selectedMessageIds.clear(); scheduleSave(); render(); renderAllMessages();
  });
}

function renderSceneSettings(tab = 'chat') {
  settingsTab = tab;
  $$('.settings-modal-tabs .inspector-tab').forEach((button) => button.classList.toggle('active', button.dataset.settingsTab === tab));
  $('#scene-settings-content').innerHTML = renderCharactersInspector();
  $('#scene-settings-modal').hidden = false;
}

function closeSceneSettings() {
  $('#scene-settings-modal').hidden = true;
}

function closeEditorModal() {
  $('#editor-modal').hidden = true;
  pendingModalAction = null;
}

function showEditorModal(title, message, actions = [{ label: '确定', className: 'primary-button' }]) {
  $('#editor-modal-title').textContent = title;
  $('#editor-modal-content').innerHTML = `<p class="modal-copy">${escapeHtml(message)}</p>`;
  $('#editor-modal-actions').innerHTML = actions.map((action, index) => `<button class="${action.className || 'outline-button'}" data-editor-modal-action="${index}" type="button">${escapeHtml(action.label)}</button>`).join('');
  $('#editor-modal').hidden = false;
  pendingModalAction = actions;
}

function showConfirm(title, message, onConfirm) {
  showEditorModal(title, message, [{ label: '取消', className: 'outline-button' }, { label: '确定', className: 'primary-button' }]);
  pendingModalAction = [{ action: closeEditorModal }, { action: () => { closeEditorModal(); onConfirm(); } }];
}

function openPrivateMembersModal() {
  const chat = activeChat();
  $('#private-chat-content').innerHTML = `<div class="private-character-list">${(chat.memberIds.length ? chat.memberIds.map((id) => character(id)).filter(Boolean) : state.characters).map((item) => `<label class="private-character-option"><input type="checkbox" data-private-member="${item.id}" checked /><span>${avatarMarkup(item, 'small')}<b>${escapeHtml(item.name)}</b></span></label>`).join('')}</div>`;
  $('#private-chat-modal').hidden = false;
  updatePrivateConfirm();
}

function closePrivateMembersModal() {
  $('#private-chat-modal').hidden = true;
}

function updatePrivateConfirm() {
  const count = $$('[data-private-member]:checked').length;
  $('[data-private-confirm]').disabled = count < 1 || count > 2;
}

function confirmPrivateMembers() {
  const ids = $$('[data-private-member]:checked').map((input) => input.dataset.privateMember);
  if (ids.length > 2) return;
  if (!ids.length) return showEditorModal('无法切换私聊', '至少保留一个角色。');
  activeChat().memberIds = ids;
  activeChat().type = 'private';
  closePrivateMembersModal();
  scheduleSave();
  render();
}

function renderChatInspector() {
  const chat = activeChat();
  const s = chat.settings;
  return `<section class="section"><div class="section-title"><span>聊天界面</span></div>
    <div class="theme-picker">
      <button class="theme-choice ${state.theme === 'wechat' ? 'active' : ''}" data-theme-choice="wechat" type="button"><strong><i class="theme-chip" style="--chip:#79d8a6"></i>微信界面</strong></button>
      <button class="theme-choice ${state.theme === 'qq' ? 'active' : ''}" data-theme-choice="qq" type="button"><strong><i class="theme-chip" style="--chip:#72a7ff"></i>QQ界面</strong></button>
      <button class="theme-choice ${state.theme === 'imessage' ? 'active' : ''}" data-theme-choice="imessage" type="button"><strong><i class="theme-chip" style="--chip:#0a84ff"></i>iMessage</strong></button>
    </div></section>
    <section class="section"><div class="section-title"><span>会话信息</span></div>
      <label class="field"><span>聊天名称</span><input class="input" data-chat-field="title" value="${escapeHtml(chat.title)}" /></label>
      <label class="field"><span>副标题 / 群聊说明</span><input class="input" data-chat-field="subtitle" value="${escapeHtml(chat.subtitle)}" /></label>
      <label class="field"><span>会话类型</span><select class="select" data-chat-field="type"><option value="group" ${chat.type === 'group' ? 'selected' : ''}>群聊</option><option value="private" ${chat.type === 'private' ? 'selected' : ''}>私聊</option></select></label>
      
    </section>
    <section class="section"><div class="section-title"><span>预览外观</span></div>
      <label class="field"><span>聊天背景颜色</span><input class="color-input" type="color" data-setting="background" value="${escapeHtml(nativeBackground())}" /></label>
      <label class="field"><span>背景纹理</span><select class="select" data-setting="wallpaper"><option value="dots" ${s.wallpaper === 'dots' ? 'selected' : ''}>细点纹理</option><option value="soft" ${s.wallpaper === 'soft' ? 'selected' : ''}>柔和渐变</option><option value="none" ${s.wallpaper === 'none' ? 'selected' : ''}>纯色</option></select></label>
      <label class="field"><span>气泡圆角</span><div class="range-row"><input type="range" min="0" max="30" data-setting="bubbleRadius" value="${nativeRadius()}" /><span class="range-value">${nativeRadius()}px</span></div></label>
      <label class="field"><span>消息字号</span><div class="range-row"><input type="range" min="11" max="20" data-setting="fontSize" value="${Number(s.fontSize) || 17}" /><span class="range-value">${Number(s.fontSize) || 17}px</span></div></label>
      <div class="toggle-row"><span>显示头像</span><label class="toggle"><input type="checkbox" data-setting="showAvatars" ${s.showAvatars !== false ? 'checked' : ''} /><span></span></label></div>
      <div class="toggle-row"><span>显示角色名</span><label class="toggle"><input type="checkbox" data-setting="showNames" ${s.showNames !== false ? 'checked' : ''} /><span></span></label></div>
      <button class="outline-button" data-reset-native-style type="button" style="width:100%;margin-top:10px">恢复当前平台默认外观</button>
    </section>
    <section class="section"><div class="section-title">手机状态栏</div><label class="field"><span>手机时间</span><input class="input" type="time" data-setting="phoneTime" value="${escapeHtml(s.phoneTime || '09:41')}" /></label><label class="field"><span>电量（%）</span><input class="input" type="number" min="0" max="100" data-setting="battery" value="${Number(s.battery ?? 100)}" /></label>
    </section>`;
}

function renderMessageInspector() {
  const message = activeMessage();
  const chat = activeChat();
  if (!message) return '<div class="empty-state">未选择消息</div>';
  if (message.kind === 'time') return messageInspectorShell(message, `<label class="field"><span>时间格式</span><select class="select" data-message-field="format"><option value="time" ${message.format === 'time' ? 'selected' : ''}>仅时间（12:32）</option><option value="yesterday" ${message.format === 'yesterday' ? 'selected' : ''}>昨天 + 时间</option><option value="weekday" ${message.format === 'weekday' ? 'selected' : ''}>周几 + 时间</option><option value="monthDay" ${message.format === 'monthDay' ? 'selected' : ''}>几月几日 + 时间</option><option value="monthDayWeekday" ${message.format === 'monthDayWeekday' ? 'selected' : ''}>几月几日 + 周几 + 时间</option><option value="dateTime" ${!message.format || message.format === 'dateTime' ? 'selected' : ''}>年月日 + 时间</option></select></label><div class="two-col"><label class="field"><span>日期</span><input class="input" type="date" data-message-field="date" value="${escapeHtml(message.date || '2026-10-26')}" /></label><label class="field"><span>时间</span><input class="input" type="time" data-message-field="time" value="${escapeHtml(message.time || '14:30')}" /></label></div><label class="field"><span>周几</span><select class="select" data-message-field="weekday"><option ${message.weekday === '周一' ? 'selected' : ''}>周一</option><option ${message.weekday === '周二' ? 'selected' : ''}>周二</option><option ${message.weekday === '周三' ? 'selected' : ''}>周三</option><option ${message.weekday === '周四' ? 'selected' : ''}>周四</option><option ${message.weekday === '周五' ? 'selected' : ''}>周五</option><option ${message.weekday === '周六' ? 'selected' : ''}>周六</option><option ${message.weekday === '周日' ? 'selected' : ''}>周日</option></select></label>`);
  if (message.kind === 'system') return messageInspectorShell(message, `<label class="field"><span>通知文字</span><textarea class="textarea" data-message-field="text" placeholder="例如：你修改了群聊名称">${escapeHtml(message.text || '')}</textarea></label>`);
  const senderIds = [...new Set([...chat.memberIds, message.senderId].filter(Boolean))];
  const common = `<label class="field"><span>发送角色</span><select class="select" data-message-field="senderId">${senderIds.map((id) => character(id)).filter(Boolean).map((item) => `<option value="${item.id}" ${item.id === message.senderId ? 'selected' : ''}>${escapeHtml(senderLabel(item))}</option>`).join('')}</select></label>`;
  const quoteSenderIds = [...new Set([...chat.memberIds, ...state.characters.map((item) => item.id), message.quoteSenderId].filter(Boolean))];
  const quoteFields = ['message', 'emoji', 'voice'].includes(message.kind) ? `<div class="toggle-row"><span>显示引用消息</span><label class="toggle"><input type="checkbox" data-message-field="quoteEnabled" ${message.quoteEnabled && message.quoteText ? 'checked' : ''} /><span></span></label></div>${message.quoteEnabled ? `<div class="quote-picker"><div class="quote-picker-actions"><button class="outline-button" data-quote-pick type="button">从消息列表选择</button><span class="quote-drop-zone" data-quote-drop>拖入消息</span></div>${message.quoteText ? `<div class="quote-current"><b>${escapeHtml(message.quoteSender || character(message.quoteSenderId)?.name || '引用消息')}</b><span>${escapeHtml(message.quoteText)}</span></div>` : ''}</div><label class="field"><span>引用发送者</span><select class="select" data-message-field="quoteSenderId"><option value="">自定义名称</option>${quoteSenderIds.map((id) => character(id)).filter(Boolean).map((item) => `<option value="${item.id}" ${item.id === message.quoteSenderId ? 'selected' : ''}>${escapeHtml(senderLabel(item))}</option>`).join('')}</select></label>${!message.quoteSenderId ? `<label class="field"><span>自定义引用名称</span><input class="input" data-message-field="quoteSender" value="${escapeHtml(message.quoteSender || '')}" placeholder="引用消息" /></label>` : ''}<label class="field"><span>引用内容</span><textarea class="textarea" data-message-field="quoteText" placeholder="也可以手动输入被引用内容">${escapeHtml(message.quoteText || '')}</textarea></label>` : ''}` : '';
  if (message.kind === 'image' || message.kind === 'video') return messageInspectorShell(message, `${common}${quoteFields}<label class="field"><span>${message.kind === 'video' ? '视频封面' : '图片'}</span><span class="upload-button">上传图片<input type="file" accept="image/*" data-message-file="image" /></span></label>${message.image ? `<div class="upload-preview"><img src="${escapeHtml(message.image)}" alt="预览" /></div>` : ''}`);
  if (message.kind === 'voice') return messageInspectorShell(message, `${common}${quoteFields}<label class="field"><span>语音长度（秒）</span><input class="input" type="number" min="1" max="999" data-message-field="duration" value="${Number(message.duration) || 3}" /></label><div class="toggle-row"><span>新消息红点</span><label class="toggle"><input type="checkbox" data-message-field="unread" ${message.unread ? 'checked' : ''} /><span></span></label></div><div class="toggle-row"><span>有转文字内容</span><label class="toggle"><input type="checkbox" data-message-field="hasTranscript" ${message.hasTranscript ? 'checked' : ''} /><span></span></label></div>${message.hasTranscript ? `<label class="field"><span>转文字内容</span><textarea class="textarea" data-message-field="transcript">${escapeHtml(message.transcript || '')}</textarea></label>` : ''}`);
  if (message.kind === 'redpacket') return messageInspectorShell(message, `${common}${quoteFields}<label class="field"><span>红包封面</span><span class="upload-button">上传图片<input type="file" accept="image/*" data-message-file="image" /></span></label>${message.image ? `<div class="upload-preview redpacket-upload-preview"><img src="${escapeHtml(message.image)}" alt="红包封面预览" /></div>` : ''}<label class="field"><span>红包文字</span><input class="input" data-message-field="text" value="${escapeHtml(message.text || '恭喜发财，大吉大利')}" /></label>${state.theme === 'qq' ? `<label class="field"><span>红包类型</span><input class="input" data-message-field="qqPacketLabel" value="${escapeHtml(message.qqPacketLabel || 'QQ红包')}" /></label>` : ''}`);
  if (message.kind === 'location') return messageInspectorShell(message, `${common}${quoteFields}<label class="field"><span>地点</span><input class="input" data-message-field="locationName" value="${escapeHtml(message.locationName || '')}" /></label><label class="field"><span>地址</span><input class="input" data-message-field="locationAddress" value="${escapeHtml(message.locationAddress || '')}" /></label><label class="field"><span>地图图片</span><span class="upload-button">上传地图<input type="file" accept="image/*" data-message-file="image" /></span></label>`);
  if (message.kind === 'file') return messageInspectorShell(message, `${common}${quoteFields}<label class="field"><span>文件名</span><input class="input" data-message-field="filename" value="${escapeHtml(message.filename || '文档.pdf')}" /></label><label class="field"><span>文件大小</span><input class="input" data-message-field="fileSize" value="${escapeHtml(message.fileSize || '1.2 MB')}" /></label>${state.theme === 'qq' ? `<label class="field"><span>传输状态</span><input class="input" data-message-field="fileState" value="${escapeHtml(message.fileState || '已发送')}" /></label>` : ''}`);
  if (message.kind === 'recall') return messageInspectorShell(message, common);
  if (message.kind === 'transfer') return messageInspectorShell(message, `${common}${quoteFields}<label class="field"><span>金额</span><input class="input" type="number" min="0" step="0.01" data-message-field="amount" value="${escapeHtml(message.amount || '0.00')}" /></label><label class="field"><span>备注</span><input class="input" data-message-field="transferNote" value="${escapeHtml(message.transferNote || '转账')}" /></label><label class="field"><span>状态</span><select class="select" data-message-field="transferStatus">${[['pending','待收款'],['received','我已收款'],['otherReceived','对方已收款'],['returned','已退还']].map(([value,label]) => `<option value="${value}" ${message.transferStatus === value ? 'selected' : ''}>${label}</option>`).join('')}</select></label>`);
  if (message.kind === 'call') return messageInspectorShell(message, `${common}${quoteFields}<label class="field"><span>通话类型</span><select class="select" data-message-field="callType"><option value="voice" ${message.callType !== 'video' ? 'selected' : ''}>语音通话</option><option value="video" ${message.callType === 'video' ? 'selected' : ''}>视频通话</option></select></label><label class="field"><span>通话状态</span><select class="select" data-message-field="callStatus">${[['missed','无应答'],['cancelled','取消'],['declined','拒绝'],['busy','忙线'],['connected','已通话']].map(([value,label]) => `<option value="${value}" ${message.callStatus === value ? 'selected' : ''}>${label}</option>`).join('')}</select></label>${message.callStatus === 'connected' ? `<label class="field"><span>通话时长（秒）</span><input class="input" type="number" min="0" max="86400" data-message-field="callDuration" value="${Number(message.callDuration) || 0}" /></label>` : ''}`);
  if (message.kind === 'poke') return messageInspectorShell(message, `${common}${quoteFields}<label class="field"><span>被戳角色</span><select class="select" data-message-field="targetId">${chat.memberIds.map((id) => character(id)).filter(Boolean).map((item) => `<option value="${item.id}" ${item.id === message.targetId ? 'selected' : ''}>${escapeHtml(item.name)}</option>`).join('')}</select></label><label class="field"><span>个性文字</span><input class="input" data-message-field="pokeSuffix" value="${escapeHtml(message.pokeSuffix ?? character(message.targetId)?.pokeSuffix ?? '')}" placeholder="例如：今天也要开心" /></label>`);
  if (message.kind === 'sticker') return messageInspectorShell(message, `${common}${quoteFields}<label class="field"><span>表情包图片</span><span class="upload-button">上传图片<input type="file" accept="image/*" data-message-file="image" /></span></label>${message.image ? `<div class="upload-preview"><img src="${escapeHtml(message.image)}" alt="预览" /></div>` : ''}<label class="field"><span>没有图片时显示的表情</span><textarea class="textarea" data-message-field="text">${escapeHtml(message.text || '🥺')}</textarea></label>`);
  return messageInspectorShell(message, `${common}${quoteFields}<label class="field"><span>${message.kind === 'emoji' ? '表情' : '消息内容'}</span><textarea class="textarea" data-message-field="text" placeholder="写下这条消息…">${escapeHtml(message.text || '')}</textarea></label>`);
}

function messageInspectorShell(message, fields) {
  return `<section class="section message-editor-section"><label class="field"><span>消息格式</span><select class="select" data-message-field="kind">${messageKindOptions(message.kind)}</select></label><div class="section-title"><span>${message.kind === 'message' ? '普通消息' : message.kind === 'time' ? '时间分隔' : message.kind === 'system' ? '系统通知' : messageKindLabel(message.kind)}</span></div>${fields}<div class="toggle-row"><span>发送失败</span><label class="toggle"><input type="checkbox" data-message-field="status" ${message.status === 'failed' ? 'checked' : ''} /><span></span></label></div><div class="insert-message-row"><button class="outline-button" data-insert-message="before" type="button">上方插入文字</button><button class="outline-button" data-insert-message="after" type="button">下方插入文字</button></div><div class="message-actions"><button class="outline-button" data-message-duplicate type="button">复制消息</button><button class="outline-button danger" data-message-delete type="button">删除消息</button></div></section>`;
}

function messageKindLabel(kind) {
  return ({ message: '普通文字', time: '时间', system: '系统通知', location: '定位', file: '文件', recall: '撤回通知', emoji: '表情', sticker: '表情包', image: '图片', video: '视频', redpacket: '红包', transfer: '转账', call: '通话', poke: '戳一戳', voice: '语音' })[kind] || '消息';
}

function renderCharactersInspector() {
  const chat = activeChat();
  const cards = state.characters.map((item) => `<div class="character-list-row" data-character-open="${item.id}">${avatarMarkup(item, 'small')}<div class="character-list-name"><strong>${escapeHtml(item.name || '未命名角色')}</strong></div><label class="compact-toggle" title="加入当前聊天"><input type="checkbox" data-member-toggle="${item.id}" ${chat.memberIds.includes(item.id) ? 'checked' : ''} /><span></span></label><button class="side-toggle ${item.side === 'right' ? 'right' : ''}" data-side-toggle="${item.id}" type="button" title="切换气泡方向">${item.side === 'right' ? '→' : '←'}</button></div>`).join('');
  return `<section class="section"><div class="section-title"><span>角色列表</span><button class="soft-button" id="add-character" type="button">＋ 新角色</button></div><div class="character-list">${cards || '<div class="empty-state">还没有角色。</div>'}</div></section>`;
}

function renderGlobalCharacters() {
  const list = $('#global-character-list');
  if (!list) return;
  list.innerHTML = state.characters.length ? state.characters.map((item) => `<div class="global-character-row" data-global-character-open="${item.id}">
    ${avatarMarkup(item, 'small')}<div class="global-character-copy"><strong>${escapeHtml(item.name || '未命名角色')}</strong></div>
    <button class="outline-button danger global-character-delete" data-character-delete="${item.id}" type="button">删除</button>
  </div>`).join('') : '<div class="empty-state">还没有角色。</div>';
  $('#global-character-modal').hidden = false;
}

function closeGlobalCharacters() {
  $('#global-character-modal').hidden = true;
}

function renderCharacterModal(id) {
  const item = character(id);
  if (!item) return;
  $('#character-modal-content').innerHTML = `<div class="character-detail-avatar">${avatarMarkup(item, 'detail-avatar')}</div>
    <label class="field"><span>角色名称</span><input class="input" data-modal-character-field="name" value="${escapeHtml(item.name)}" /></label>
    <label class="field"><span>头像图片</span><span class="upload-button">上传头像<input type="file" accept="image/*" data-modal-character-file="avatar" /></span></label>
    <div class="two-col"><label class="field"><span>气泡颜色</span><input class="color-input" type="color" data-modal-character-field="bubble" value="${escapeHtml(bubbleColorFor(item))}" /></label><label class="field"><span>文字颜色</span><input class="color-input" type="color" data-modal-character-field="text" value="${escapeHtml(bubbleTextFor(item))}" /></label></div>
    <label class="field"><span>默认气泡方向</span><select class="select" data-modal-character-field="side"><option value="left" ${item.side === 'left' ? 'selected' : ''}>左侧</option><option value="right" ${item.side === 'right' ? 'selected' : ''}>右侧</option></select></label>
    <label class="field"><span>戳一戳 / 拍一拍个性文字</span><input class="input" data-modal-character-field="pokeSuffix" value="${escapeHtml(item.pokeSuffix || '')}" placeholder="例如：今天也要开心" /></label>
    <div class="button-row"><button class="outline-button" data-character-modal-close type="button">完成</button><button class="outline-button danger" data-character-delete="${item.id}" type="button">删除角色</button></div>`;
  $('#character-modal').hidden = false;
  $('#character-modal').dataset.characterId = id;
}

function closeCharacterModal() {
  $('#character-modal').hidden = true;
  delete $('#character-modal').dataset.characterId;
}

function readFileAsDataURL(file, callback) {
  const reader = new FileReader();
  reader.onload = () => callback(String(reader.result || ''));
  reader.readAsDataURL(file);
}

function createMessage(kind, text) {
  const chat = activeChat();
  const previous = chat.messages.at(-1);
  let message;
  if (kind === 'time') message = { id: uid('time'), kind, format: 'dateTime', date: '2026-10-26', time: '15:00', weekday: '周一', label: '2026年10月26日 15:00' };
  else if (kind === 'system') message = { id: uid('notice'), kind, text: '系统通知' };
  else {
    const senderId = (text !== undefined && chat.memberIds.includes(activeMessage()?.senderId) ? activeMessage().senderId : null) || chat.memberIds.find((id) => character(id)?.side === 'right') || chat.memberIds[0] || state.characters[0].id;
    const targetId = chat.memberIds.find((id) => id !== senderId) || senderId;
    message = normalizeMessage({ id: uid(kind), kind, senderId, targetId, time: previous?.time || '15:00', text: kind === 'emoji' ? '🙂' : kind === 'sticker' ? '🥺' : kind === 'redpacket' ? '恭喜发财，大吉大利' : kind === 'transfer' ? '转账 ¥ 0.00' : kind === 'call' || kind === 'voice' ? '' : '新消息', duration: 3, hasTranscript: false, pokeSuffix: character(targetId)?.pokeSuffix || '', transferNote: '转账', transferStatus: 'pending', callType: 'voice', callStatus: 'missed', callDuration: 0 });
  }
  if (text !== undefined) message.text = text;
  return message;
}

function addMessage(kind, text, position = null) {
  const chat = activeChat();
  const message = createMessage(kind, text);
  if (position !== null) chat.messages.splice(position, 0, message);
  else chat.messages.push(message);
  state.activeMessageId = message.id;
  state.activeTab = 'message';
  setState(() => {});
  requestAnimationFrame(() => $('#messages .message-select.selected')?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }));
}

function insertMessage(direction, kind) {
  const chat = activeChat();
  const index = chat.messages.findIndex((message) => message.id === state.activeMessageId);
  const position = index < 0 ? chat.messages.length : index + (direction === 'after' ? 1 : 0);
  addMessage(kind, undefined, position);
}

function addChat() {
  const number = state.chats.length + 1;
  const chat = normalizeChat({ id: uid('chat'), title: `新聊天 ${number}`, subtitle: '自定义聊天场景', type: 'group', memberIds: state.characters.slice(0, 2).map((item) => item.id), messages: [] });
  state.chats.push(chat);
  state.activeChatId = chat.id;
  state.activeMessageId = null;
  state.activeTab = 'chat';
  inspectorTab = 'settings';
  setState(() => {});
}

function duplicateChat() {
  const source = activeChat();
  const copy = clone(source);
  copy.id = uid('chat');
  copy.title = `${source.title || '聊天'} 副本`;
  copy.messages = copy.messages.map((message) => ({ ...message, id: uid(message.kind === 'message' ? 'msg' : message.kind === 'time' ? 'time' : 'notice') }));
  state.chats.push(copy);
  state.activeChatId = copy.id;
  state.activeMessageId = copy.messages.at(-1)?.id || null;
  inspectorTab = 'settings';
  setState(() => {});
}

function deleteChat() {
  if (state.chats.length <= 1) return showEditorModal('无法删除场景', '至少保留一个聊天场景。');
  const chat = activeChat();
  showConfirm('删除聊天场景', `确定删除“${chat.title}”吗？`, () => {
    state.chats = state.chats.filter((item) => item.id !== chat.id);
    state.activeChatId = state.chats[0].id;
    state.activeMessageId = state.chats[0].messages.at(-1)?.id || null;
    setState(() => {});
  });
}

function deleteMessage() {
  const chat = activeChat();
  if (!activeMessage()) return;
  chat.messages = chat.messages.filter((message) => message.id !== state.activeMessageId);
  state.activeMessageId = chat.messages.at(-1)?.id || null;
  setState(() => {});
}

function duplicateMessage() {
  const chat = activeChat();
  const index = chat.messages.findIndex((message) => message.id === state.activeMessageId);
  if (index < 0) return;
  const copy = { ...clone(chat.messages[index]), id: uid(chat.messages[index].kind === 'message' ? 'msg' : chat.messages[index].kind === 'time' ? 'time' : 'notice') };
  chat.messages.splice(index + 1, 0, copy);
  state.activeMessageId = copy.id;
  setState(() => {});
}

function moveMessage(id, direction) {
  const chat = activeChat();
  const shown = visibleMessages(chat);
  const visibleIndex = shown.findIndex((message) => message.id === id);
  const neighbor = shown[visibleIndex + (direction === 'up' ? -1 : 1)];
  if (visibleIndex < 0 || !neighbor) return;
  const index = chat.messages.findIndex((message) => message.id === id);
  const next = chat.messages.findIndex((message) => message.id === neighbor.id);
  [chat.messages[index], chat.messages[next]] = [chat.messages[next], chat.messages[index]];
  state.activeMessageId = id;
  setState(() => {});
}

function moveMessageBefore(sourceId, targetId, after = false) {
  if (sourceId === targetId) return;
  const messages = activeChat().messages;
  const source = messages.findIndex((message) => message.id === sourceId);
  const target = messages.findIndex((message) => message.id === targetId);
  if (source < 0 || target < 0) return;
  const [message] = messages.splice(source, 1);
  messages.splice(messages.findIndex((item) => item.id === targetId) + (after ? 1 : 0), 0, message);
  state.activeMessageId = sourceId;
  setState(() => {});
}

function addCharacter() {
  const item = { id: uid('char'), name: '新角色', avatar: '✨', side: 'left', bubble: '#ffffff', text: '#242b31', pokeSuffix: '' };
  state.characters.push(item);
  if (activeChat().type !== 'private' || activeChat().memberIds.length < 2) activeChat().memberIds.push(item.id);
  setState(() => {});
  renderCharacterModal(item.id);
  if (!$('#global-character-modal').hidden) renderGlobalCharacters();
}

function deleteCharacter(id) {
  if (state.characters.length <= 1) return showEditorModal('无法删除角色', '至少保留一个角色。');
  const item = character(id);
  if (!item) return;
  showConfirm('删除角色', `删除“${item.name}”？已有消息会保留在记录中。`, () => {
    state.characters = state.characters.filter((candidate) => candidate.id !== id);
    state.chats.forEach((chat) => {
      chat.memberIds = chat.memberIds.filter((memberId) => memberId !== id);
      if (chat.type === 'private' && !chat.memberIds.length) chat.memberIds = [state.characters[0].id];
    });
    if ($('#character-modal').dataset.characterId === id) closeCharacterModal();
    setState(() => {});
    if (!$('#global-character-modal').hidden) renderGlobalCharacters();
  });
}

function updateCurrentMessage(field, value) {
  const message = activeMessage();
  if (!message) return;
  message[field] = value;
  scheduleSave();
  renderMessages();
  renderChatList();
  if (!$('#global-character-modal').hidden) renderGlobalCharacters();
}

function openHandleDatabase() {
  return new Promise((resolve, reject) => {
    if (!('indexedDB' in window)) return resolve(null);
    const request = indexedDB.open(HANDLE_DB_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(HANDLE_STORE_NAME);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function storeProjectHandle(handle) {
  const db = await openHandleDatabase();
  if (!db) return;
  await new Promise((resolve, reject) => {
    const tx = db.transaction(HANDLE_STORE_NAME, 'readwrite');
    tx.objectStore(HANDLE_STORE_NAME).put(handle, 'project-directory');
    tx.oncomplete = resolve; tx.onerror = () => reject(tx.error);
  });
  db.close();
}

async function readStoredProjectHandle() {
  const db = await openHandleDatabase();
  if (!db) return null;
  const handle = await new Promise((resolve, reject) => {
    const tx = db.transaction(HANDLE_STORE_NAME, 'readonly');
    const request = tx.objectStore(HANDLE_STORE_NAME).get('project-directory');
    request.onsuccess = () => resolve(request.result || null); request.onerror = () => reject(request.error);
  });
  db.close();
  return handle;
}

async function projectFileHandle(directory, create = true) {
  return directory.getFileHandle(PROJECT_FILE_NAME, { create });
}

async function persistProjectFile() {
  if (!projectDirectoryHandle) return;
  projectSaveInFlight = projectSaveInFlight.then(async () => {
    const fileHandle = await projectFileHandle(projectDirectoryHandle);
    const writable = await fileHandle.createWritable();
    await writable.write(JSON.stringify({ format: 'oc-form-creator-project', version: 1, state }, null, 2));
    await writable.close();
    $('#save-state').textContent = '已保存到本地文件';
  }).catch(() => { $('#save-state').textContent = '文件保存失败，请检查授权'; });
  return projectSaveInFlight;
}

async function restoreProjectFile(directory) {
  try {
    const handle = await projectFileHandle(directory, false);
    const file = await handle.getFile();
    if (!file.size) return false;
    const data = JSON.parse(await file.text());
    const next = data.state || data;
    if (!next?.chats || !next?.characters) throw new Error('invalid project');
    state = normalizeState(next);
    lastHistoryState = clone(state); historyBase = null; undoStack = []; redoStack = [];
    render();
    return true;
  } catch (error) {
    if (error?.name !== 'NotFoundError') console.warn('无法读取本地项目文件', error);
    return false;
  }
}

async function connectProjectFolder() {
  if (!window.showDirectoryPicker) return showEditorModal('浏览器不支持本地文件授权', '请使用最新版 Chrome 或 Edge，或者继续使用浏览器本地保存。');
  try {
    const directory = await window.showDirectoryPicker({ mode: 'readwrite' });
    const permission = await directory.requestPermission({ mode: 'readwrite' });
    if (permission !== 'granted') return showEditorModal('没有获得文件授权', '未授权时会继续使用浏览器本地保存。');
    projectDirectoryHandle = directory;
    await storeProjectHandle(directory);
    await persistProjectFile();
    $('#save-state').textContent = '已保存到本地文件';
  } catch (error) {
    if (error?.name !== 'AbortError') showEditorModal('本地文件连接失败', '请重新选择一个可以写入的文件夹。');
  }
}

function projectAssetExtension(mime) {
  return ({ 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif', 'image/svg+xml': 'svg' })[mime] || 'png';
}

function makeProjectSnapshot() {
  const snapshot = clone(state);
  const assets = [];
  const visit = (value) => {
    if (typeof value === 'string' && /^data:[^;,]+;base64,/.test(value)) {
      const mime = value.slice(5, value.indexOf(';'));
      const path = `assets/${String(assets.length + 1).padStart(3, '0')}.${projectAssetExtension(mime)}`;
      assets.push({ path, mime, base64: value.slice(value.indexOf(',') + 1) });
      return path;
    }
    if (Array.isArray(value)) return value.map(visit);
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, visit(item)]));
    return value;
  };
  return { state: visit(snapshot), assets };
}

async function exportState() {
  const snapshot = makeProjectSnapshot();
  let blob;
  if (window.JSZip) {
    const zip = new window.JSZip();
    zip.file('project.json', JSON.stringify({ format: 'oc-form-creator-project', version: 1, state: snapshot.state }, null, 2));
    snapshot.assets.forEach((asset) => zip.file(asset.path, asset.base64, { base64: true }));
    blob = await zip.generateAsync({ type: 'blob' });
  } else {
    blob = new Blob([JSON.stringify({ format: 'oc-form-creator-project', version: 1, state }, null, 2)], { type: 'application/json' });
  }
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a'); link.href = url; link.download = 'chat-editor-project.zip'; link.click();
  URL.revokeObjectURL(url);
}

function resetState() {
  showConfirm('恢复示例数据', '恢复示例数据会覆盖当前本地草稿，确定继续吗？', () => {
    state = clone(defaultState);
    localStorage.removeItem(STORAGE_KEY);
    render();
    if (projectDirectoryHandle) persistProjectFile();
  });
}

function replaceComposerInputs(phone, sourceInputs) {
  phone.querySelectorAll('[data-composer-input]').forEach((input, index) => {
    const source = sourceInputs[index];
    const surface = input.ownerDocument.createElement('div');
    surface.className = `${input.className} export-composer-text`;
    const text = input.ownerDocument.createElement('span');
    text.textContent = source?.value || input.placeholder || '';
    if (!source?.value) surface.style.color = '#b0b0b6';
    text.style.transform = `translateX(-${source?.scrollLeft || 0}px)`;
    surface.append(text);
    input.replaceWith(surface);
  });
}

async function waitForExportResources() {
  await document.fonts.ready;
  try {
    await Promise.all([...$('.stage .device-frame').querySelectorAll('img')].map((img) => img.decode()));
  } catch {
    throw new Error('有图片未能加载，请重新上传该图片后再导出。');
  }
}

async function renderPhoneCanvas(scrollTop, { long = false } = {}) {
    await waitForExportResources();
    const sourcePhone = $('.stage .device-frame');
    const sourceInputs = [...sourcePhone.querySelectorAll('[data-composer-input]')].map((input) => ({ value: input.value, scrollLeft: input.scrollLeft }));
    const contentHeight = Math.max($('#messages').clientHeight, $('#messages').scrollHeight);
    const height = long ? 874 + contentHeight - $('#messages').clientHeight : 874;
    if (height * 3 > 30000) throw new Error('长图超过单张图片的安全高度，请使用连续截图 ZIP。');
    await document.fonts.ready;
    const canvas = await window.html2canvas(sourcePhone, {
      width: 402,
      height,
      scale: 3,
      backgroundColor: null,
      useCORS: true,
      logging: false,
      onclone: async (doc) => {
        // Render a fixed phone canvas in the cloned document. Preview zoom,
        // panel widths, and print styles must never affect the exported image.
        const phone = doc.querySelector('.device-frame');
        doc.querySelector('#chat-editor').append(phone);
        Object.assign(phone.style, {
          position: 'absolute', left: '0', top: '0', margin: '0',
          width: '402px', height: `${height}px`, borderRadius: '0', transform: 'none', transition: 'none',
          zoom: '1', boxShadow: 'none',
        });
        phone.querySelectorAll('.message-reorder-controls').forEach((item) => item.remove());
        phone.querySelectorAll('.message-select').forEach((item) => {
          item.classList.remove('selected', 'dragging', 'drop-before', 'drop-after');
          item.removeAttribute('draggable');
          // html2canvas materializes ::before/::after during cloning, before
          // onclone runs. Remove the already-cloned selection lines as well.
          item.querySelectorAll(':scope > html2canvaspseudoelement').forEach((line) => line.remove());
        });
        await Promise.all([...phone.querySelectorAll('img')].map((img) => img.decode()));
        replaceComposerInputs(phone, sourceInputs);
        if (long) Object.assign(phone.querySelector('#messages').style, { height: `${contentHeight}px`, flex: 'none', overflow: 'hidden' });
        // html2canvas does not implement object-fit. Crop uploaded covers and
        // avatars first so they retain the same proportions as the preview.
        await Promise.all([...phone.querySelectorAll('img')].map(async (img) => {
          const fit = doc.defaultView.getComputedStyle(img).objectFit;
          if (!['cover', 'contain'].includes(fit)) return;
          const width = img.clientWidth;
          const height = img.clientHeight;
          if (!width || !height) return;
          const bitmap = document.createElement('canvas');
          bitmap.width = width * 3;
          bitmap.height = height * 3;
          const ratio = (fit === 'cover' ? Math.max : Math.min)(bitmap.width / img.naturalWidth, bitmap.height / img.naturalHeight);
          const drawWidth = img.naturalWidth * ratio;
          const drawHeight = img.naturalHeight * ratio;
          bitmap.getContext('2d').drawImage(img, (bitmap.width - drawWidth) / 2, (bitmap.height - drawHeight) / 2, drawWidth, drawHeight);
          img.style.width = `${width}px`;
          img.style.height = `${height}px`;
          img.src = bitmap.toDataURL('image/png');
          await img.decode();
        }));
        phone.querySelector('#messages').scrollTop = long ? 0 : scrollTop;
      },
    });
    return canvas;
}

async function canvasToBlob(canvas) {
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
  if (!blob) throw new Error('PNG 编码失败');
  return blob;
}

async function exportPng() {
  const button = $('#export-png-button');
  if (button.disabled) return;
  button.disabled = true;
  button.textContent = '正在导出…';
  const filename = `${(activeChat().title || '聊天记录').replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_')}.png`;
  const oldScroll = $('#messages').scrollTop;
  try {
    const canvas = await renderPhoneCanvas(oldScroll);
    const blob = await canvasToBlob(canvas);
    if (pngPreviewUrl) URL.revokeObjectURL(pngPreviewUrl);
    pngPreviewUrl = URL.createObjectURL(blob);
    $('#png-preview-image').src = pngPreviewUrl;
    $('#png-preview-image').dataset.filename = filename;
    $('#png-preview-modal').hidden = false;
  } catch (error) {
    console.error('PNG 导出失败', error);
    showEditorModal('PNG 导出失败', '请检查消息图片是否能正常显示后重试。');
  } finally {
    button.disabled = false;
    button.textContent = '导出 PNG';
  }
}

function downloadPngPreview() {
  if (!pngPreviewUrl) return;
  const link = document.createElement('a');
  link.href = pngPreviewUrl;
  link.download = $('#png-preview-image').dataset.filename || '聊天记录.png';
  document.body.append(link);
  link.click();
  link.remove();
}

function clearExportPreview() {
  exportGeneration += 1;
  closeExportDetail();
  exportSession.pages.forEach((page) => URL.revokeObjectURL(page.url));
  exportSession.pages = [];
  exportSession.offsets = [];
  exportSession.selected = 0;
  $('#export-pages').replaceChildren();
  $('#export-pages').hidden = true;
  ['export-download-single', 'export-download-zip', 'export-download-long', 'export-reset-offsets'].forEach((id) => { $(`#${id}`).hidden = true; });
  $('#export-run').hidden = false;
  $('#export-run').disabled = false;
  if (pngPreviewUrl) { URL.revokeObjectURL(pngPreviewUrl); pngPreviewUrl = null; }
  $('#png-preview-image').removeAttribute('src');
  $('#png-preview-modal').hidden = true;
}

function openExportModal() {
  clearExportPreview();
  exportSession.kind = 'single';
  $('#export-modal').hidden = false;
  $$('.export-mode').forEach((button) => button.classList.toggle('active', button.dataset.exportKind === 'single'));
  $('#export-status').textContent = '选择一种导出方式';
}

function closeExportModal() {
  clearExportPreview();
  $('#export-modal').hidden = true;
}

function calculateExportOffsets() {
  const messages = $('#messages');
  const viewport = messages.clientHeight;
  const maxScroll = Math.max(0, messages.scrollHeight - viewport);
  if (!viewport || maxScroll <= 1) return { offsets: [0], maxScroll, viewport };
  const step = Math.max(1, Math.round(viewport * 0.86));
  const offsets = [0];
  while (offsets.at(-1) < maxScroll) {
    const next = Math.min(maxScroll, offsets.at(-1) + step);
    if (next === offsets.at(-1)) break;
    offsets.push(next);
  }
  return { offsets, maxScroll, viewport };
}

function yieldToBrowser() {
  return new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
}

async function captureExportPage(offset, options) {
  const canvas = await renderPhoneCanvas(offset, options);
  try { return await canvasToBlob(canvas); }
  finally { canvas.width = 0; canvas.height = 0; }
}

function renderExportThumbnails() {
  const pages = $('#export-pages');
  pages.dataset.kind = exportSession.kind;
  pages.innerHTML = exportSession.pages.map((page, index) => `<button class="export-page-thumb ${index === exportSession.selected ? 'active' : ''}" data-export-page="${index}" type="button"><img src="${page.url}" alt="${exportSession.kind === 'long' ? '完整长图' : `第 ${index + 1} 张`}" /><span>${exportSession.kind === 'long' ? '完整长图' : `第 ${index + 1} 张 / 共 ${exportSession.pages.length} 张`}</span></button>`).join('');
  pages.hidden = !exportSession.pages.length;
  $('#export-reset-offsets').hidden = exportSession.kind !== 'pages' || !exportSession.pages.length;
}

function exportError(error) {
  console.error(error);
  $('#export-run').disabled = false;
  $('#export-run').hidden = false;
  $('#export-status').textContent = '生成失败';
  showEditorModal('导出失败', error.message || '请检查消息图片是否可以正常显示后重试。');
}

async function generateContinuousExport(kind) {
  clearExportPreview();
  const token = exportGeneration;
  const status = $('#export-status');
  exportSession.kind = kind;
  $('#export-run').disabled = true;
  try {
    await waitForExportResources();
    if (token !== exportGeneration) return;
    const calculated = calculateExportOffsets();
    exportSession.maxScroll = calculated.maxScroll;
    exportSession.messageHeight = calculated.viewport;
    exportSession.offsets = kind === 'single' ? [$('#messages').scrollTop] : kind === 'long' ? [0] : calculated.offsets;
    for (let index = 0; index < exportSession.offsets.length; index += 1) {
      status.textContent = kind === 'long' ? '正在生成完整长图' : `正在生成第 ${index + 1} 张 / 共 ${exportSession.offsets.length} 张`;
      const offset = exportSession.offsets[index];
      const blob = await captureExportPage(offset, { long: kind === 'long' });
      if (token !== exportGeneration) return;
      exportSession.pages.push({ blob, url: URL.createObjectURL(blob), offset });
      await yieldToBrowser();
      if (token !== exportGeneration) return;
    }
    exportSession.selected = 0;
    renderExportThumbnails();
    $('#export-run').hidden = true;
    $('#export-download-single').hidden = kind !== 'single';
    $('#export-download-zip').hidden = kind !== 'pages';
    $('#export-download-long').hidden = kind !== 'long';
    status.textContent = kind === 'long' ? '已生成完整长图' : `已生成 ${exportSession.pages.length} 张截图`;
  } catch (error) {
    if (token === exportGeneration) exportError(error);
  } finally {
    if (token === exportGeneration) $('#export-run').disabled = false;
  }
}

function saveExportBlob(blob, suffix) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `${(activeChat().title || '聊天记录').replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_')}${suffix}`;
  document.body.append(link); link.click(); link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}

async function downloadExportZip() {
  if (!window.JSZip || !exportSession.pages.length) return;
  const token = exportGeneration;
  const zip = new window.JSZip();
  exportSession.pages.forEach((page, index) => zip.file(`chat_${String(index + 1).padStart(3, '0')}.png`, page.blob));
  const blob = await zip.generateAsync({ type: 'blob', compression: 'STORE' }, (metadata) => {
    if (token === exportGeneration) $('#export-status').textContent = `正在打包 ${Math.round(metadata.percent)}%`;
  });
  if (token !== exportGeneration) return;
  saveExportBlob(blob, '_连续截图.zip');
  $('#export-status').textContent = 'ZIP 已生成';
}

function downloadLongExport() {
  if (!exportSession.pages.length || exportSession.kind !== 'long') return;
  saveExportBlob(exportSession.pages[0].blob, '_长图.png');
}

function closeExportDetail() {
  $('#export-detail-modal').hidden = true;
  $('#export-live-preview').replaceChildren();
}

function openExportDetail(index) {
  if (!exportSession.pages[index]) return;
  exportSession.selected = index;
  exportPreviewOffset = exportSession.offsets[index];
  renderExportThumbnails();
  const host = $('#export-live-preview');
  host.replaceChildren();
  host.removeAttribute('style');
  $('#export-detail-modal').hidden = false;
  $('#export-detail-title').textContent = exportSession.kind === 'long' ? '完整长图' : `第 ${index + 1} 张 / 共 ${exportSession.pages.length} 张`;
  $('#export-detail-prev').disabled = index === 0;
  $('#export-detail-next').disabled = index === exportSession.pages.length - 1;
  $('#export-apply-position').hidden = exportSession.kind === 'long';
  $('#export-apply-position').disabled = false;
  const viewport = $('#export-detail-viewport');
  viewport.scrollTop = 0;
  if (exportSession.kind === 'long') {
    const image = document.createElement('img');
    image.className = 'export-long-image'; image.alt = '完整长图预览';
    image.src = exportSession.pages[0].url;
    host.append(image);
    return;
  }
  const source = $('.stage .device-frame');
  const phone = source.cloneNode(true);
  const messages = phone.querySelector('#messages');
  const sourceInputs = [...source.querySelectorAll('[data-composer-input]')].map((input) => ({ value: input.value, scrollLeft: input.scrollLeft }));
  replaceComposerInputs(phone, sourceInputs);
  phone.querySelectorAll('.message-reorder-controls').forEach((node) => node.remove());
  phone.querySelectorAll('.message-select').forEach((node) => node.classList.remove('selected', 'dragging', 'drop-before', 'drop-after'));
  [phone, ...phone.querySelectorAll('*')].forEach((node) => {
    node.removeAttribute('id'); node.removeAttribute('draggable');
    [...node.attributes].filter((attr) => attr.name.startsWith('data-') && attr.name !== 'data-chat-type').forEach((attr) => node.removeAttribute(attr.name));
    if (node.matches('button')) { node.type = 'button'; node.tabIndex = -1; }
  });
  const scale = Math.min(1, Math.max(0.25, (viewport.clientWidth - 52) / 402), Math.max(0.25, (viewport.clientHeight - 24) / 874));
  host.style.width = `${402 * scale + 28}px`;
  host.style.height = `${874 * scale}px`;
  phone.style.transform = `scale(${scale})`;
  host.append(phone);
  const track = document.createElement('div');
  track.className = 'export-scroll-track';
  track.style.top = `${messages.offsetTop * scale}px`;
  track.style.height = `${messages.clientHeight * scale}px`;
  const rail = document.createElement('div');
  rail.className = 'export-scroll-rail'; rail.tabIndex = 0;
  rail.setAttribute('aria-label', '滚动聊天内容');
  const spacer = document.createElement('div');
  spacer.style.height = `${messages.scrollHeight * scale}px`;
  const thumb = document.createElement('button');
  thumb.type = 'button'; thumb.tabIndex = -1; thumb.className = 'export-scroll-thumb';
  thumb.setAttribute('aria-label', '拖动滚动聊天内容');
  rail.append(spacer); track.append(rail, thumb); host.append(track);
  const thumbHeight = Math.min(track.clientHeight, Math.max(30, track.clientHeight * messages.clientHeight / messages.scrollHeight));
  thumb.style.height = `${thumbHeight}px`;
  const updateThumb = () => {
    const maxScroll = messages.scrollHeight - messages.clientHeight;
    thumb.style.top = `${maxScroll ? (track.clientHeight - thumbHeight) * messages.scrollTop / maxScroll : 0}px`;
    track.hidden = maxScroll <= 0;
  };
  messages.scrollTop = exportPreviewOffset;
  rail.scrollTop = messages.scrollTop * scale;
  updateThumb();
  // Both the phone and its adjacent native scrollbar control this same viewport.
  messages.addEventListener('scroll', () => {
    exportPreviewOffset = messages.scrollTop;
    if (Math.abs(rail.scrollTop - messages.scrollTop * scale) > 1) rail.scrollTop = messages.scrollTop * scale;
    updateThumb();
  });
  rail.addEventListener('scroll', () => {
    if (Math.abs(messages.scrollTop - rail.scrollTop / scale) > 1) messages.scrollTop = rail.scrollTop / scale;
    exportPreviewOffset = messages.scrollTop;
    updateThumb();
  });
  thumb.addEventListener('pointerdown', (event) => {
    event.preventDefault();
    thumb.setPointerCapture(event.pointerId);
    const startY = event.clientY, startScroll = messages.scrollTop;
    const onMove = (move) => {
      const travel = track.clientHeight - thumbHeight;
      if (travel > 0) messages.scrollTop = startScroll + (move.clientY - startY) * (messages.scrollHeight - messages.clientHeight) / travel;
    };
    const finish = () => { thumb.removeEventListener('pointermove', onMove); thumb.removeEventListener('pointerup', finish); thumb.removeEventListener('pointercancel', finish); };
    thumb.addEventListener('pointermove', onMove);
    thumb.addEventListener('pointerup', finish);
    thumb.addEventListener('pointercancel', finish);
  });
  rail.addEventListener('pointerdown', (event) => {
    const travel = track.clientHeight - thumbHeight;
    if (travel > 0) messages.scrollTop = (event.clientY - track.getBoundingClientRect().top - thumbHeight / 2) / travel * (messages.scrollHeight - messages.clientHeight);
    rail.focus();
  });
  track.addEventListener('wheel', (event) => {
    event.preventDefault();
    messages.scrollTop += event.deltaY / scale;
  }, { passive: false });
}

function adjustedExportOffsets(index, offset) {
  const viewport = exportSession.messageHeight;
  const maxScroll = exportSession.maxScroll;
  const anchors = [...new Set([0, offset, maxScroll])].sort((a, b) => a - b);
  const candidates = exportSession.offsets.filter((value, i) => i !== index && anchors.every((anchor) => Math.abs(value - anchor) >= viewport * 0.25));
  const points = [...new Set([...anchors, ...candidates])].sort((a, b) => a - b);
  const offsets = [0];
  for (const point of points.slice(1)) {
    while (point - offsets.at(-1) > viewport) offsets.push(Math.min(point, offsets.at(-1) + Math.round(viewport * 0.86)));
    offsets.push(point);
  }
  return offsets;
}

async function refreshExportPage() {
  const token = exportGeneration;
  const offset = Math.round(Math.max(0, Math.min(exportSession.maxScroll, exportPreviewOffset)));
  const offsets = exportSession.kind === 'single' ? [offset] : adjustedExportOffsets(exportSession.selected, offset);
  const oldPages = [...exportSession.pages];
  const newPages = [];
  $('#export-apply-position').disabled = true;
  try {
    for (let index = 0; index < offsets.length; index += 1) {
      $('#export-detail-title').textContent = `正在更新第 ${index + 1} 张 / 共 ${offsets.length} 张`;
      let page = oldPages.find((page) => page.offset === offsets[index]);
      if (!page) {
        const blob = await captureExportPage(offsets[index]);
        if (token !== exportGeneration) return;
        page = { blob, url: URL.createObjectURL(blob), offset: offsets[index] };
      }
      newPages.push(page);
    }
    if (token !== exportGeneration) return;
    oldPages.filter((page) => !newPages.includes(page)).forEach((page) => URL.revokeObjectURL(page.url));
    exportSession.pages = newPages;
    exportSession.offsets = offsets;
    exportSession.selected = offsets.indexOf(offset);
    renderExportThumbnails();
    closeExportDetail();
    $('#export-status').textContent = `已更新，共 ${offsets.length} 张截图`;
  } catch (error) { if (token === exportGeneration) exportError(error); }
  finally {
    newPages.filter((page) => !exportSession.pages.includes(page) && !oldPages.includes(page)).forEach((page) => URL.revokeObjectURL(page.url));
    $('#export-apply-position').disabled = false;
  }
}

async function importState(file) {
  try {
    let data;
    if (file.name.toLowerCase().endsWith('.zip') || file.type.includes('zip')) {
      if (!window.JSZip) throw new Error('zip unavailable');
      const zip = await window.JSZip.loadAsync(file);
      const projectFile = zip.file('project.json');
      if (!projectFile) throw new Error('missing project');
      data = JSON.parse(await projectFile.async('text'));
      const hydrate = async (value) => {
        if (typeof value === 'string' && value.startsWith('assets/')) {
          const asset = zip.file(value);
          if (!asset) return value;
          const base64 = await asset.async('base64');
          const ext = value.split('.').at(-1).toLowerCase();
          const mime = ext === 'jpg' ? 'image/jpeg' : `image/${ext}`;
          return `data:${mime};base64,${base64}`;
        }
        if (Array.isArray(value)) return Promise.all(value.map(hydrate));
        if (value && typeof value === 'object') return Object.fromEntries(await Promise.all(Object.entries(value).map(async ([key, item]) => [key, await hydrate(item)])));
        return value;
      };
      data.state = await hydrate(data.state);
    } else {
      data = JSON.parse(await file.text());
    }
    const next = data.state || data;
    if (!next?.chats || !next?.characters) throw new Error('invalid project');
    state = normalizeState(next);
    lastHistoryState = clone(state); historyBase = null; undoStack = []; redoStack = [];
    scheduleSave(); render();
  } catch { showEditorModal('导入失败', '这个项目文件无法识别。'); }
}

document.addEventListener('click', (event) => {
  if (suppressNextMessageClick) {
    const guard = suppressNextMessageClick;
    suppressNextMessageClick = null;
    const isSyntheticDragClick = event.target.closest('#messages')
      && performance.now() <= guard.until
      && Math.hypot(event.clientX - guard.x, event.clientY - guard.y) <= 12;
    if (isSyntheticDragClick) { event.preventDefault(); return; }
  }
  if (event.target.closest('.compact-toggle, .upload-button')) return;
  const target = event.target.closest('button, [data-message-id], [data-chat-id], [data-character-open], [data-global-character-open], [data-character-modal-close], [data-global-character-close], [data-scene-settings-close], [data-editor-modal-close], [data-png-preview-close], [data-export-modal-close], [data-export-detail-close], [data-message-list-close]');
  if (!target) return;
  if (target.dataset.inspectorTab) { inspectorTab = target.dataset.inspectorTab; return renderInspector(); }
  if (target.id === 'open-character-list') return renderSceneSettings('characters');
  if (target.id === 'open-message-list') return renderAllMessages();
  if (target.id === 'message-list-select-mode') {
    messageListSelectionMode = !messageListSelectionMode;
    if (!messageListSelectionMode) selectedMessageIds.clear();
    return renderAllMessages();
  }
  if (target.dataset.messageListClose !== undefined) { quotePickingMessage = false; $('#message-list-modal').hidden = true; return; }
  if (target.dataset.quotePick !== undefined) {
    quotePickingMessage = true;
    messageListSelectionMode = false;
    selectedMessageIds.clear();
    renderAllMessages();
    return;
  }
  if (target.id === 'delete-selected-messages') return deleteSelectedMessages();
  if (target.dataset.listMessage) {
    if (quotePickingMessage) {
      const sourceId = target.dataset.listMessage;
      quotePickingMessage = false;
      $('#message-list-modal').hidden = true;
      return applyQuoteFromMessage(sourceId);
    }
    if (messageListSelectionMode) {
      const checkbox = $(`[data-list-select="${target.dataset.listMessage}"]`);
      if (checkbox) { checkbox.checked = !checkbox.checked; checkbox.dispatchEvent(new Event('change', { bubbles: true })); }
      return;
    }
    state.activeMessageId = target.dataset.listMessage;
    selectedMessageIds.clear();
    inspectorTab = 'message'; $('#message-list-modal').hidden = true;
    scheduleSave(); render(); return;
  }
  if (target.id === 'rename-scene') {
    showEditorModal('修改聊天名称', '', [{ label: '取消' }, { label: '保存', className: 'primary-button' }]);
    $('#editor-modal-content').innerHTML = `<label class="field"><span>聊天名称</span><input id="scene-name-input" class="input" value="${escapeHtml(activeChat().title)}" /></label>`;
    pendingModalAction = [{ action: closeEditorModal }, { action: () => { activeChat().title = $('#scene-name-input').value.trim() || '未命名聊天'; closeEditorModal(); scheduleSave(); render(); } }];
    $('#scene-name-input').focus(); $('#scene-name-input').select(); return;
  }
  if (target.dataset.characterOpen) return renderCharacterModal(target.dataset.characterOpen);
  if (target.dataset.characterDelete) return deleteCharacter(target.dataset.characterDelete);
  if (target.dataset.globalCharacterOpen) return renderCharacterModal(target.dataset.globalCharacterOpen);
  if (target.dataset.globalCharacterClose !== undefined) return closeGlobalCharacters();
  if (target.dataset.characterModalClose !== undefined) return closeCharacterModal();
  if (target.dataset.chatId) {
    selectedMessageIds.clear();
    inspectorTab = 'settings';
    setState(() => { state.activeChatId = target.dataset.chatId; state.activeMessageId = activeChat().messages.at(-1)?.id || null; });
    return;
  }
  if (target.dataset.messageMove) return moveMessage(target.closest('[data-message-id]').dataset.messageId, target.dataset.messageMove);
  if (target.dataset.messageId) {
    if (event.metaKey || event.ctrlKey || event.shiftKey) {
      const id = target.dataset.messageId;
      if (selectedMessageIds.has(id)) selectedMessageIds.delete(id); else selectedMessageIds.add(id);
    } else selectedMessageIds.clear();
    state.activeMessageId = target.dataset.messageId;
    inspectorTab = 'message';
    scheduleSave();
    $$('#messages [data-message-id]').forEach((row) => row.classList.toggle('selected', row.dataset.messageId === state.activeMessageId || selectedMessageIds.has(row.dataset.messageId)));
    renderInspector();
    return;
  }
  if (target.id === 'add-chat') return addChat();
  if (target.id === 'undo-button') return undo();
  if (target.id === 'redo-button') return redo();
  if (target.id === 'duplicate-chat') return duplicateChat();
  if (target.id === 'delete-chat') return deleteChat();
  if (target.id === 'reset-button') return resetState();
  if (target.id === 'export-button') return exportState();
  if (target.id === 'export-png-button') return openExportModal();
  if (target.id === 'connect-project-button') return connectProjectFolder();
  if (target.id === 'import-button') return $('#import-file').click();
  if (target.id === 'add-character' || target.id === 'global-add-character') return addCharacter();
  if (target.id === 'open-global-characters') return renderGlobalCharacters();
  if (target.id === 'open-scene-settings') return renderSceneSettings('chat');
  if (target.dataset.sceneSettingsClose !== undefined) return closeSceneSettings();
  if (target.dataset.settingsTab) return renderSceneSettings(target.dataset.settingsTab);
  if (target.dataset.privateCancel !== undefined) { closePrivateMembersModal(); return render(); }
  if (target.dataset.privateConfirm !== undefined) return confirmPrivateMembers();
  if (target.dataset.editorModalClose !== undefined) return closeEditorModal();
  if (target.dataset.editorModalAction !== undefined) {
    const action = pendingModalAction?.[Number(target.dataset.editorModalAction)];
    if (action?.action) return action.action();
    return closeEditorModal();
  }
  if (target.dataset.pngPreviewClose !== undefined) { $('#png-preview-modal').hidden = true; return; }
  if (target.id === 'download-png-confirm') return downloadPngPreview();
  if (target.dataset.exportDetailClose !== undefined) return closeExportDetail();
  if (target.id === 'export-detail-prev') return openExportDetail(exportSession.selected - 1);
  if (target.id === 'export-detail-next') return openExportDetail(exportSession.selected + 1);
  if (target.id === 'export-apply-position') return refreshExportPage();
  if (target.dataset.exportModalClose !== undefined) return closeExportModal();
  if (target.dataset.exportKind) {
    clearExportPreview();
    $$('.export-mode').forEach((button) => button.classList.toggle('active', button.dataset.exportKind === target.dataset.exportKind));
    exportSession.kind = target.dataset.exportKind;
    $('#export-status').textContent = target.dataset.exportKind === 'single' ? '生成当前手机画面的 PNG' : target.dataset.exportKind === 'pages' ? '按真实聊天内容滚动生成连续截图' : '顶部状态栏、全部消息与底部输入框';
    return;
  }
  if (target.id === 'export-run') return generateContinuousExport(exportSession.kind);
  if (target.id === 'export-download-single' && exportSession.pages[0]) return saveExportBlob(exportSession.pages[0].blob, '.png');
  if (target.id === 'export-download-zip') return downloadExportZip();
  if (target.id === 'export-download-long') return downloadLongExport();
  if (target.dataset.exportPage !== undefined) {
    return openExportDetail(Number(target.dataset.exportPage));
  }
  if (target.id === 'export-reset-offsets') {
    return generateContinuousExport(exportSession.kind);
  }
  if (target.id === 'add-text-message') { inspectorTab = 'message'; return addMessage('message'); }
  if (target.id === 'fit-preview') return fitPreview();
  if (target.dataset.insertMessage) return insertMessage(target.dataset.insertMessage, 'message');
  if (target.dataset.sideToggle) return setState(() => {
    const item = character(target.dataset.sideToggle);
    if (item) item.side = item.side === 'right' ? 'left' : 'right';
  });
  if (target.hasAttribute('data-reset-native-style')) return setState(() => {
    Object.assign(activeChat().settings, { background: null, wallpaper: 'none', bubbleRadius: null, fontSize: 17 });
  });
  if (target.dataset.themeChoice) return setState(() => { state.theme = target.dataset.themeChoice; });
  if (target.dataset.addKind) return addMessage(target.dataset.addKind);
  if (target.dataset.messageDelete !== undefined) return showConfirm('删除消息', '确定删除这条消息吗？', deleteMessage);
  if (target.dataset.messageDuplicate !== undefined) return duplicateMessage();
  if (target.dataset.characterDelete) return deleteCharacter(target.dataset.characterDelete);
});

function messageFieldValue(target) {
  if (target.type === 'checkbox') return target.dataset.messageField === 'status' ? (target.checked ? 'failed' : 'sent') : target.checked;
  if (target.type !== 'number') return target.value;
  const minimum = Number(target.min || 0), maximum = target.max ? Number(target.max) : Number.MAX_SAFE_INTEGER;
  return Math.max(minimum, Math.min(maximum, Number(target.value) || 0));
}

function updateRoleField(target) {
  const item = character($('#character-modal').dataset.characterId);
  if (!item) return;
  const key = target.dataset.modalCharacterField;
  item[key] = target.value;
  if (key === 'bubble') item.bubbleMode = 'custom';
  if (key === 'text') item.textMode = 'custom';
  scheduleSave();
  renderMessages();
  renderChatChrome();
  renderChatList();
  if (!$('#global-character-modal').hidden) renderGlobalCharacters();
  if (!$('#scene-settings-modal').hidden) renderSceneSettings(settingsTab);
}

document.addEventListener('input', (event) => {
  const target = event.target;
  if (target.id === 'chat-search') return renderChatList();
  if (target.id === 'zoom-input') {
    if (target.value && Number(target.value) >= 25) setZoom(Number(target.value) / 100);
    return;
  }
  if (target.matches('[data-composer-input]')) {
    activeChat().draft = target.value;
    syncComposer(); scheduleSave(); return;
  }
  if (target.dataset.modalCharacterField) return updateRoleField(target);
  if (target.dataset.messageField && !['checkbox', 'select-one'].includes(target.type)) return updateCurrentMessage(target.dataset.messageField, messageFieldValue(target));
  if (target.dataset.chatField && target.dataset.chatField !== 'type') {
    activeChat()[target.dataset.chatField] = target.value;
    scheduleSave();
    $('#inspector-chat-title').textContent = activeChat().title || '未命名聊天';
    renderChatChrome(); renderChatList(); return;
  }
  if (target.dataset.setting && target.type !== 'checkbox') {
    activeChat().settings[target.dataset.setting] = ['range', 'number'].includes(target.type) ? messageFieldValue(target) : target.value;
    scheduleSave(); renderMessages(); renderChatChrome();
    if (target.type === 'range') $('.range-value', target.closest('.range-row')).textContent = `${target.value}px`;
  }
});

document.addEventListener('change', (event) => {
  const target = event.target;
  if (target.dataset.listSelect) {
    if (target.checked) selectedMessageIds.add(target.dataset.listSelect); else selectedMessageIds.delete(target.dataset.listSelect);
    renderMessages(); return renderAllMessages();
  }
  if (target.id === 'select-all-messages') {
    selectedMessageIds = target.checked ? new Set(activeChat().messages.map((message) => message.id)) : new Set();
    renderMessages(); return renderAllMessages();
  }
  if (target.id === 'zoom-input') { setZoom((Number(target.value) || 100) / 100); target.value = Math.round(state.zoom * 100); return; }
  if (target.id === 'import-file' && target.files[0]) { importState(target.files[0]); target.value = ''; return; }
  if (target.dataset.privateMember) return updatePrivateConfirm();
  if (target.dataset.messageFile === 'image' && target.files[0]) {
    const message = activeMessage();
    if (!message) return;
    return readFileAsDataURL(target.files[0], (data) => { message.image = data; scheduleSave(); render(); });
  }
  if (target.dataset.messageField) {
    const message = activeMessage();
    if (!message) return;
    const key = target.dataset.messageField;
    if (key === 'quoteSenderId') {
      message.quoteSenderId = target.value;
      message.quoteSender = character(target.value)?.name || message.quoteSender || '引用消息';
    } else if (key === 'kind') {
      const defaults = createMessage(target.value);
      const wasPlaceholder = message.text === '新消息';
      Object.assign(message, defaults, { ...message, kind: target.value });
      if (wasPlaceholder) message.text = defaults.text;
      if (target.value === 'time') { message.date ||= defaults.date; message.time ||= defaults.time; message.format ||= 'dateTime'; }
    } else message[key] = messageFieldValue(target);
    if (key === 'targetId') message.pokeSuffix = character(message.targetId)?.pokeSuffix || '';
    scheduleSave(); renderMessages(); renderChatList();
    if (['select-one', 'checkbox'].includes(target.type)) renderInspector();
    return;
  }
  if (target.dataset.modalCharacterFile === 'avatar' && target.files[0]) {
    const item = character($('#character-modal').dataset.characterId);
    if (!item) return;
    return readFileAsDataURL(target.files[0], (data) => { item.avatar = data; scheduleSave(); renderCharacterModal(item.id); render(); });
  }
  if (target.dataset.modalCharacterField) return updateRoleField(target);
  if (target.dataset.chatField === 'type') {
    if (target.value === 'private' && (activeChat().memberIds.length > 2 || !activeChat().memberIds.length)) {
      target.value = activeChat().type;
      return openPrivateMembersModal();
    }
    activeChat().type = target.value; scheduleSave(); render(); return;
  }
  if (target.dataset.setting) {
    activeChat().settings[target.dataset.setting] = target.type === 'checkbox' ? target.checked : ['range', 'number'].includes(target.type) ? messageFieldValue(target) : target.value;
    scheduleSave(); renderMessages(); renderChatChrome(); return;
  }
  if (target.dataset.memberToggle) {
    const chat = activeChat();
    if (chat.type === 'private' && ((target.checked && chat.memberIds.length >= 2) || (!target.checked && chat.memberIds.length <= 1))) {
      target.checked = !target.checked;
      return showEditorModal('角色数量限制', target.checked ? '私聊最多加入两个角色。' : '私聊至少保留一个角色。');
    }
    chat.memberIds = target.checked ? [...new Set([...chat.memberIds, target.dataset.memberToggle])] : chat.memberIds.filter((id) => id !== target.dataset.memberToggle);
    scheduleSave(); render();
  }
});

document.addEventListener('submit', (event) => {
  if (!event.target.matches('[data-composer]')) return;
  event.preventDefault();
  const text = $('[data-composer-input]', event.target).value.trim();
  if (!text) return;
  activeChat().draft = '';
  addMessage('message', text);
  $('[data-composer-input]', event.target).focus();
});

document.addEventListener('keydown', (event) => {
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'z') {
    event.preventDefault();
    if (event.shiftKey) redo(); else undo();
    return;
  }
  if (event.key === 'Escape') {
    if (!$('#editor-modal').hidden) closeEditorModal();
    else if (!$('#export-detail-modal').hidden) closeExportDetail();
    else if (!$('#message-list-modal').hidden) { quotePickingMessage = false; $('#message-list-modal').hidden = true; }
    else if (!$('#private-chat-modal').hidden) { closePrivateMembersModal(); render(); }
    else if (!$('#global-character-modal').hidden) closeGlobalCharacters();
    else if (!$('#character-modal').hidden) closeCharacterModal();
    else if (!$('#png-preview-modal').hidden) $('#png-preview-modal').hidden = true;
    else if (!$('#export-modal').hidden) closeExportModal();
    else closeSceneSettings();
  }
  const resizer = event.target.closest('[data-resize]');
  if (resizer && ['ArrowLeft', 'ArrowRight'].includes(event.key)) {
    event.preventDefault();
    const side = resizer.dataset.resize;
    const panel = side === 'left' ? $('.sidebar') : $('.inspector');
    resizePanel(side, panel.getBoundingClientRect().width + (event.key === 'ArrowRight' ? 12 : -12) * (side === 'left' ? 1 : -1));
    scheduleSave();
  }
});

function clearPointerDrag() {
  if (!pointerDrag) return;
  const { row, placeholder } = pointerDrag;
  // The dragged row is temporarily moved out of #messages so the scroll
  // container cannot clip it. Put the same node back into its original slot
  // before clearing the temporary positioning styles; no clone/ghost is used.
  if (placeholder?.isConnected) placeholder.replaceWith(row);
  else if (!row.closest('#messages')) $('#messages').append(row);
  row.style.position = '';
  row.style.left = '';
  row.style.top = '';
  row.style.width = '';
  row.style.zIndex = '';
  row.style.transformOrigin = '';
  row.style.transform = '';
  row.style.pointerEvents = '';
  row.style.opacity = '';
  row.classList.remove('dragging', 'drop-before', 'drop-after');
  document.body.classList.remove('message-pointer-dragging');
  $('[data-quote-drop]')?.classList.remove('active');
  $$('#messages .drop-before, #messages .drop-after').forEach((row) => row.classList.remove('drop-before', 'drop-after'));
  pointerDrag = null;
}

$('#messages').addEventListener('pointerdown', (event) => {
  if (event.button !== 0 || event.target.closest('button, input, textarea, select, a')) return;
  const row = event.target.closest('[data-message-id]');
  if (!row) return;
  const startX = event.clientX, startY = event.clientY;
  const begin = () => {
    if (pointerDrag) return;
    const rect = row.getBoundingClientRect();
    const device = $('.device-frame');
    const deviceRect = device.getBoundingClientRect();
    const scale = device.offsetWidth ? deviceRect.width / device.offsetWidth : 1;
    const layoutWidth = row.offsetWidth;
    const placeholder = document.createElement('div');
    placeholder.className = 'message-drag-placeholder';
    placeholder.style.height = `${row.offsetHeight}px`;
    placeholder.style.width = `${layoutWidth}px`;
    placeholder.style.marginBottom = getComputedStyle(row).marginBottom;
    row.before(placeholder);
    // Keep the real message node, but lift it into the editor root. The root
    // is not transformed, so fixed coordinates are viewport coordinates and
    // remain visible even when the phone preview is zoomed or scrolled.
    $('#chat-editor').append(row);
    row.style.position = 'fixed';
    row.style.left = `${rect.left}px`;
    row.style.top = `${rect.top}px`;
    row.style.width = `${layoutWidth}px`;
    row.style.zIndex = '1000';
    row.style.transformOrigin = 'top left';
    row.style.transform = `scale(${scale})`;
    pointerDrag = {
      row,
      id: row.dataset.messageId,
      placeholder,
      startRect: rect,
      scale,
      offsetX: (event.clientX - rect.left) / scale,
      offsetY: (event.clientY - rect.top) / scale,
      moved: true,
    };
    row.classList.add('dragging');
    row.style.pointerEvents = 'none';
    document.body.classList.add('message-pointer-dragging');
    updatePointerDrag(event);
  };
  const move = (moveEvent) => {
    if (!pointerDrag && Math.hypot(moveEvent.clientX - startX, moveEvent.clientY - startY) < 6) return;
    if (!pointerDrag) begin();
    updatePointerDrag(moveEvent);
  };
  const finish = (upEvent) => {
    if (pointerDrag) {
      const target = pointerDrag.target;
      const quoteDrop = pointerDrag.quoteDrop;
      const id = pointerDrag.id;
      const after = pointerDrag.after;
      clearPointerDrag();
      if (quoteDrop) applyQuoteFromMessage(id);
      else if (target && target.dataset.messageId !== id) moveMessageBefore(id, target.dataset.messageId, after);
      suppressNextMessageClick = { x: upEvent.clientX, y: upEvent.clientY, until: performance.now() + 350 };
      upEvent.preventDefault();
    }
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', finish);
    window.removeEventListener('pointercancel', finish);
  };
  window.addEventListener('pointermove', move, { passive: false });
  window.addEventListener('pointerup', finish, { once: true });
  window.addEventListener('pointercancel', finish, { once: true });
});

function updatePointerDrag(event) {
  if (!pointerDrag) return;
  event.preventDefault();
  const { row, id, scale, offsetX, offsetY } = pointerDrag;
  row.style.left = `${event.clientX - offsetX * scale}px`;
  row.style.top = `${event.clientY - offsetY * scale}px`;
  const box = $('#messages').getBoundingClientRect();
  const quoteDrop = document.elementFromPoint(event.clientX, event.clientY)?.closest('[data-quote-drop]');
  pointerDrag.quoteDrop = Boolean(quoteDrop);
  $('[data-quote-drop]')?.classList.toggle('active', Boolean(quoteDrop));
  if (quoteDrop) {
    $$('#messages .drop-before, #messages .drop-after').forEach((item) => item.classList.remove('drop-before', 'drop-after'));
    pointerDrag.target = null;
    return;
  }
  const distance = Math.min(event.clientY - box.top, box.bottom - event.clientY);
  if (distance < 70) {
    const speed = distance < 24 ? 2 : distance < 45 ? 1 : .35;
    $('#messages').scrollTop += (event.clientY < box.top + 70 ? -speed : speed);
  }
  // Hit testing a row misses its margins and the dragged row's placeholder.
  // Resolve an insertion slot from the actual row positions instead, including
  // all the whitespace between them. Use the same slot for the line and drop.
  if (event.clientX >= box.left && event.clientX <= box.right) {
    const rows = $$('#messages > [data-message-id]').filter((item) => item.dataset.messageId !== id);
    const next = rows.find((item) => {
      const rect = item.getBoundingClientRect();
      return event.clientY < rect.top + rect.height / 2;
    });
    pointerDrag.target = next || rows.at(-1);
    pointerDrag.after = !next;
  }
  $$('#messages .drop-before, #messages .drop-after').forEach((item) => item.classList.remove('drop-before', 'drop-after'));
  pointerDrag.target?.classList.add(pointerDrag.after ? 'drop-after' : 'drop-before');
}

document.addEventListener('dragstart', (event) => {
  if (event.target.closest('#messages')) event.preventDefault();
});

$('#all-messages-list').addEventListener('dragstart', (event) => {
  if (messageListSelectionMode) { event.preventDefault(); return; }
  const row = event.target.closest('[data-list-drag]');
  if (!row) return;
  draggedListMessageId = row.dataset.listDrag;
  event.dataTransfer.setData('text/plain', draggedListMessageId);
  event.dataTransfer.effectAllowed = 'move';
  const ghost = document.createElement('canvas'); ghost.width = 1; ghost.height = 1;
  event.dataTransfer.setDragImage(ghost, 0, 0);
  row.classList.add('dragging');
});
$('#all-messages-list').addEventListener('dragover', (event) => {
  if (!draggedListMessageId || messageListSelectionMode) return;
  event.preventDefault();
  $$('.drop-before, .drop-after', $('#all-messages-list')).forEach((row) => row.classList.remove('drop-before', 'drop-after'));
  const row = event.target.closest('[data-list-drag]');
  if (row && row.dataset.listDrag !== draggedListMessageId) {
    const box = row.getBoundingClientRect();
    row.classList.add(event.clientY > box.top + box.height / 2 ? 'drop-after' : 'drop-before');
  }
});
$('#all-messages-list').addEventListener('drop', (event) => {
  if (!draggedListMessageId || messageListSelectionMode) return;
  event.preventDefault();
  const row = event.target.closest('[data-list-drag]');
  if (row && row.dataset.listDrag !== draggedListMessageId) moveMessageBefore(draggedListMessageId, row.dataset.listDrag, row.classList.contains('drop-after'));
  clearListDrag();
  renderAllMessages();
});
$('#all-messages-list').addEventListener('dragend', clearListDrag);
function clearListDrag() {
  draggedListMessageId = null;
  $$('#all-messages-list .dragging, #all-messages-list .drop-before, #all-messages-list .drop-after').forEach((row) => row.classList.remove('dragging', 'drop-before', 'drop-after'));
}

const previewArea = $('.preview-area');
previewArea.addEventListener('wheel', (event) => {
  if (!event.ctrlKey) return;
  event.preventDefault();
  setZoom(state.zoom * Math.exp(-event.deltaY * 0.01));
}, { passive: false });
let gestureZoom = 1;
previewArea.addEventListener('gesturestart', (event) => { event.preventDefault(); gestureZoom = state.zoom; }, { passive: false });
previewArea.addEventListener('gesturechange', (event) => { event.preventDefault(); setZoom(gestureZoom * event.scale); }, { passive: false });
previewArea.addEventListener('gestureend', (event) => event.preventDefault(), { passive: false });

function resizePanel(side, width) {
  const other = side === 'left' ? $('.inspector') : $('.sidebar');
  const maximum = Math.min(side === 'left' ? 400 : 520, $('.workspace').clientWidth - other.getBoundingClientRect().width - 380);
  const minimum = side === 'left' ? 210 : 280;
  const value = Math.max(minimum, Math.min(Math.max(minimum, maximum), width));
  root.style.setProperty(`--${side}-width`, `${value}px`);
  state.panelWidths = { ...state.panelWidths, [side]: value };
  return value;
}
$$('[data-resize]').forEach((handle) => {
  handle.addEventListener('pointerdown', (event) => {
    if (event.button !== 0) return;
    event.preventDefault();
    const side = handle.dataset.resize;
    const startX = event.clientX;
    const startWidth = (side === 'left' ? $('.sidebar') : $('.inspector')).getBoundingClientRect().width;
    handle.setPointerCapture(event.pointerId);
    root.classList.add('resizing-panels');
    const move = (next) => resizePanel(side, startWidth + (next.clientX - startX) * (side === 'left' ? 1 : -1));
    const finish = () => {
      handle.removeEventListener('pointermove', move);
      handle.removeEventListener('pointerup', finish);
      handle.removeEventListener('pointercancel', finish);
      handle.removeEventListener('lostpointercapture', finish);
      root.classList.remove('resizing-panels');
      scheduleSave();
    };
    handle.addEventListener('pointermove', move);
    handle.addEventListener('pointerup', finish);
    handle.addEventListener('pointercancel', finish);
    handle.addEventListener('lostpointercapture', finish);
  });
});

window.addEventListener('resize', () => {
  if (!state.panelWidths) return;
  resizePanel('left', $('.sidebar').getBoundingClientRect().width);
  resizePanel('right', $('.inspector').getBoundingClientRect().width);
  scheduleSave();
});

render();
if (typeof ResizeObserver !== 'undefined') new ResizeObserver(centerPreview).observe($('.preview-area'));
if (state.panelWidths) Object.entries(state.panelWidths).forEach(([side, width]) => { if (['left', 'right'].includes(side)) resizePanel(side, width); });
if (!localStorage.getItem(STORAGE_KEY)) requestAnimationFrame(fitPreview);
initializeProjectStorage();
