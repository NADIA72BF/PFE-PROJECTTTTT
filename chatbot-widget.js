(function () {
  'use strict';

  if (document.getElementById('gi-chatbot')) return; // prevent double init

  // ─── Inject CSS ──────────────────────────────────────────────────────────────
  var styleEl = document.createElement('style');
  styleEl.id = 'gi-chatbot-style';
  styleEl.textContent = [
    '#gi-chatbot{position:fixed;bottom:24px;right:24px;z-index:9999;font-family:"Segoe UI",Tahoma,Geneva,Verdana,sans-serif}',
    '.gi-toggle-btn{width:58px;height:58px;border-radius:50%;border:none;cursor:pointer;background:linear-gradient(135deg,#1d6fd1,#0ba5ec);color:#fff;box-shadow:0 4px 20px rgba(29,111,209,.45);display:flex;align-items:center;justify-content:center;transition:transform .2s,box-shadow .2s;position:relative}',
    '.gi-toggle-btn:hover{transform:scale(1.08);box-shadow:0 6px 28px rgba(29,111,209,.55)}',
    '.gi-toggle-btn svg{width:26px;height:26px}',
    '.gi-notif{position:absolute;top:-2px;right:-2px;width:13px;height:13px;border-radius:50%;background:#ef4444;border:2px solid #fff;display:none}',
    '.gi-popup{position:absolute;bottom:70px;right:0;width:370px;height:520px;background:#fff;border-radius:20px;box-shadow:0 20px 60px rgba(0,0,0,.18);display:flex;flex-direction:column;overflow:hidden;transform-origin:bottom right;animation:giUp .22s ease}',
    '@keyframes giUp{from{opacity:0;transform:scale(.88) translateY(14px)}to{opacity:1;transform:scale(1) translateY(0)}}',
    '.gi-header{background:linear-gradient(135deg,#1d4ed8,#0ea5e9);padding:15px 18px;display:flex;align-items:center;gap:12px;color:#fff;flex-shrink:0}',
    '.gi-avatar{width:40px;height:40px;border-radius:50%;background:rgba(255,255,255,.22);display:flex;align-items:center;justify-content:center;font-weight:700;font-size:17px;flex-shrink:0}',
    '.gi-header-info{flex:1;min-width:0}',
    '.gi-header-name{font-size:15px;font-weight:700}',
    '.gi-header-status{font-size:12px;opacity:.8;margin-top:1px}',
    '.gi-header-close{background:none;border:none;color:#fff;font-size:22px;cursor:pointer;line-height:1;padding:4px 6px;border-radius:8px;opacity:.75;transition:opacity .15s,background .15s}',
    '.gi-header-close:hover{opacity:1;background:rgba(255,255,255,.15)}',
    '.gi-messages{flex:1;overflow-y:auto;padding:14px 14px 6px;display:flex;flex-direction:column;gap:9px;background:#f8faff}',
    '.gi-messages::-webkit-scrollbar{width:4px}',
    '.gi-messages::-webkit-scrollbar-thumb{background:#cbd5e1;border-radius:99px}',
    '.gi-msg{max-width:83%;padding:10px 14px;border-radius:16px;font-size:13.5px;line-height:1.55;word-break:break-word;animation:giFade .18s ease}',
    '@keyframes giFade{from{opacity:0;transform:translateY(5px)}to{opacity:1;transform:translateY(0)}}',
    '.gi-msg.bot{background:#fff;color:#1e293b;border:1px solid #e2e8f0;border-bottom-left-radius:4px;align-self:flex-start;box-shadow:0 1px 4px rgba(0,0,0,.06)}',
    '.gi-msg.user{background:linear-gradient(135deg,#1d6fd1,#0ea5e9);color:#fff;border-bottom-right-radius:4px;align-self:flex-end}',
    '.gi-typing-wrap{align-self:flex-start}',
    '.gi-typing{display:flex;gap:5px;align-items:center;padding:10px 14px}',
    '.gi-dot{width:7px;height:7px;border-radius:50%;background:#94a3b8;animation:giDot 1.1s infinite}',
    '.gi-dot:nth-child(2){animation-delay:.18s}',
    '.gi-dot:nth-child(3){animation-delay:.36s}',
    '@keyframes giDot{0%,80%,100%{transform:scale(.7);opacity:.45}40%{transform:scale(1);opacity:1}}',
    '.gi-input-area{padding:11px 13px;display:flex;gap:8px;align-items:center;border-top:1px solid #e2e8f0;background:#fff;flex-shrink:0}',
    '.gi-input{flex:1;border:1px solid #e2e8f0;border-radius:22px;padding:9px 15px;font-size:13.5px;outline:none;font-family:inherit;color:#1e293b;background:#f8faff;transition:border-color .2s}',
    '.gi-input:focus{border-color:#1d6fd1;background:#fff}',
    '.gi-send{width:37px;height:37px;border-radius:50%;border:none;background:linear-gradient(135deg,#1d6fd1,#0ea5e9);color:#fff;cursor:pointer;display:flex;align-items:center;justify-content:center;flex-shrink:0;transition:transform .15s,box-shadow .15s}',
    '.gi-send:hover{transform:scale(1.09);box-shadow:0 3px 12px rgba(29,111,209,.4)}',
    '.gi-send:disabled{opacity:.45;cursor:not-allowed;transform:none;box-shadow:none}',
    '.gi-send svg{width:16px;height:16px}',
    '@media(max-width:440px){.gi-popup{width:calc(100vw - 32px);right:-12px}}',
    '.gi-chart-card{width:100%;background:#f8faff;border:1px solid #e2e8f0;border-radius:12px;overflow:hidden;margin-top:4px}',
    '.gi-chart-title{padding:7px 11px;font-size:12px;font-weight:700;color:#1e293b;background:#fff;border-bottom:1px solid #e2e8f0}',
    '.gi-chart-iframe{width:100%;height:200px;border:none;display:block}',
    '.gi-chart-link{display:block;text-align:center;padding:6px;font-size:11.5px;color:#1d6fd1;text-decoration:none;background:#f0f7ff;transition:background .15s}',
    '.gi-chart-link:hover{background:#dbeafe}'
  ].join('');
  document.head.appendChild(styleEl);

  // ─── SVG icons ───────────────────────────────────────────────────────────────
  var ICO_CHAT  = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>';
  var ICO_CLOSE = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>';
  var ICO_SEND  = '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/></svg>';

  // ─── Build DOM ───────────────────────────────────────────────────────────────
  var root = document.createElement('div');
  root.id = 'gi-chatbot';
  root.innerHTML =
    '<button class="gi-toggle-btn" id="gi-toggle" aria-label="Ouvrir Nexia" title="Nexia – Assistant IA">' +
      '<span id="gi-btn-icon">' + ICO_CHAT + '</span>' +
      '<span class="gi-notif" id="gi-notif"></span>' +
    '</button>' +
    '<div class="gi-popup" id="gi-popup" style="display:none">' +
      '<div class="gi-header">' +
        '<div class="gi-avatar">N</div>' +
        '<div class="gi-header-info">' +
          '<div class="gi-header-name">Nexia</div>' +
          '<div class="gi-header-status">&#x25CF; Assistant IA en ligne</div>' +
        '</div>' +
        '<button class="gi-header-close" id="gi-close" aria-label="Fermer">&times;</button>' +
      '</div>' +
      '<div class="gi-messages" id="gi-msgs"></div>' +
      '<div class="gi-input-area">' +
        '<input class="gi-input" id="gi-inp" type="text" placeholder="Posez votre question..." maxlength="500" autocomplete="off">' +
        '<button class="gi-send" id="gi-send" aria-label="Envoyer">' + ICO_SEND + '</button>' +
      '</div>' +
    '</div>';

  document.body.appendChild(root);

  // ─── Refs ────────────────────────────────────────────────────────────────────
  var popup     = document.getElementById('gi-popup');
  var toggle    = document.getElementById('gi-toggle');
  var closeBtn  = document.getElementById('gi-close');
  var msgs      = document.getElementById('gi-msgs');
  var inp       = document.getElementById('gi-inp');
  var sendBtn   = document.getElementById('gi-send');
  var notif     = document.getElementById('gi-notif');
  var btnIcon   = document.getElementById('gi-btn-icon');
  var isOpen    = false;
  var isBusy    = false;
  var greeted   = false;

  // ─── Helpers ─────────────────────────────────────────────────────────────────
  function esc(s) {
    return String(s)
      .replace(/&/g,'&amp;').replace(/</g,'&lt;')
      .replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  function addMsg(role, text) {
    var d = document.createElement('div');
    d.className = 'gi-msg ' + role;
    var html = esc(text)
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/\*(.+?)\*/g, '<em>$1</em>')
      .replace(/\n/g, '<br>');
    d.innerHTML = html;
    msgs.appendChild(d);
    msgs.scrollTop = msgs.scrollHeight;
    return d;
  }

  function addChartCard(chart) {
    var d = document.createElement('div');
    d.className = 'gi-msg bot';
    d.style.maxWidth = '100%';
    d.style.padding = '6px';
    d.innerHTML =
      '<div class="gi-chart-card">' +
        '<div class="gi-chart-title">&#128202; ' + esc(chart.title) + '</div>' +
        '<iframe class="gi-chart-iframe" src="' + esc(chart.url) + '" frameborder="0" allowfullscreen loading="lazy"></iframe>' +
        '<a class="gi-chart-link" href="' + esc(chart.url) + '" target="_blank" rel="noopener">&#8599; Ouvrir en plein écran</a>' +
      '</div>';
    msgs.appendChild(d);
    msgs.scrollTop = msgs.scrollHeight;
  }

  function addTyping() {
    var d = document.createElement('div');
    d.className = 'gi-msg bot gi-typing-wrap';
    d.innerHTML = '<div class="gi-typing"><div class="gi-dot"></div><div class="gi-dot"></div><div class="gi-dot"></div></div>';
    msgs.appendChild(d);
    msgs.scrollTop = msgs.scrollHeight;
    return d;
  }

  function openChat() {
    isOpen = true;
    popup.style.display = 'flex';
    btnIcon.innerHTML = ICO_CLOSE;
    notif.style.display = 'none';
    if (!greeted) {
      greeted = true;
      addMsg('bot', 'Bonjour ! Je suis **Nexia**, votre assistant immobilier IA.\nJe peux vous aider à trouver un bien, comparer des prix ou répondre à vos questions. Comment puis-je vous aider ?');
    }
    inp.focus();
  }

  function closeChat() {
    isOpen = false;
    popup.style.display = 'none';
    btnIcon.innerHTML = ICO_CHAT;
  }

  async function send() {
    var text = inp.value.trim();
    if (!text || isBusy) return;
    isBusy = true;
    sendBtn.disabled = true;
    inp.value = '';
    addMsg('user', text);
    var typing = addTyping();
    try {
      var r = await fetch('/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: text }),
        cache: 'no-store'
      });
      var data = await r.json();
      typing.remove();
      addMsg('bot', data.reply || 'Désolé, je n\'ai pas pu répondre. Réessayez.');
      if (data.chart) addChartCard(data.chart);
    } catch (e) {
      typing.remove();
      addMsg('bot', 'Erreur de connexion. Vérifiez votre réseau et réessayez.');
    }
    isBusy = false;
    sendBtn.disabled = false;
    inp.focus();
  }

  // ─── Events ──────────────────────────────────────────────────────────────────
  toggle.addEventListener('click', function () { isOpen ? closeChat() : openChat(); });
  closeBtn.addEventListener('click', closeChat);
  sendBtn.addEventListener('click', send);
  inp.addEventListener('keydown', function (e) {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
  });

  // Show notification dot after 4 s if chat still closed
  setTimeout(function () { if (!isOpen) notif.style.display = 'block'; }, 4000);

})();
