import { NextResponse } from "next/server";

export async function GET() {
  const js = `(function() {
  if (window.__saWidgetLoaded) return;
  window.__saWidgetLoaded = true;

  var script = document.currentScript || (function() {
    var scripts = document.getElementsByTagName('script');
    for (var i = scripts.length - 1; i >= 0; i--) {
      if (scripts[i].src && scripts[i].src.indexOf('/widget/embed.js') !== -1) return scripts[i];
    }
    return null;
  })();

  var businessId = script ? script.getAttribute('data-business-id') : null;
  if (!businessId) { console.error('SimplAssist: missing data-business-id'); return; }

  var baseUrl = script.src.substring(0, script.src.indexOf('/widget/embed.js'));

  var config = null;
  var messages = [];
  var sessionId = (typeof crypto !== 'undefined' && crypto.randomUUID) ? crypto.randomUUID() : 'sa-' + Math.random().toString(36).substr(2, 9) + Date.now().toString(36);
  var isOpen = false;
  var isLoading = false;
  var unreadCount = 0;
  var messageCount = 0;
  var leadCaptured = false;
  var visitorName = '';
  var visitorEmail = '';

  function el(tag, attrs, children) {
    var e = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(function(k) {
      if (k === 'style' && typeof attrs[k] === 'object') {
        Object.keys(attrs[k]).forEach(function(s) { e.style[s] = attrs[k][s]; });
      } else if (k.indexOf('on') === 0) {
        e.addEventListener(k.substring(2).toLowerCase(), attrs[k]);
      } else {
        e.setAttribute(k, attrs[k]);
      }
    });
    if (children) {
      if (typeof children === 'string') e.textContent = children;
      else if (Array.isArray(children)) children.forEach(function(c) { if (c) e.appendChild(c); });
      else e.appendChild(children);
    }
    return e;
  }

  var style = document.createElement('style');
  style.textContent = [
    '.sa-widget-container{position:fixed;z-index:2147483647;font-family:system-ui,-apple-system,sans-serif;font-size:14px;line-height:1.5;}',
    '.sa-widget-btn{width:60px;height:60px;border-radius:50%;border:none;cursor:pointer;display:flex;align-items:center;justify-content:center;box-shadow:0 4px 12px rgba(0,0,0,0.15);transition:transform 0.2s,box-shadow 0.2s;position:relative;}',
    '.sa-widget-btn:hover{transform:scale(1.05);box-shadow:0 6px 16px rgba(0,0,0,0.2);}',
    '.sa-widget-badge{position:absolute;top:-4px;right:-4px;background:#ef4444;color:#fff;border-radius:50%;width:22px;height:22px;font-size:12px;font-weight:700;display:flex;align-items:center;justify-content:center;border:2px solid #fff;}',
    '.sa-widget-panel{--sa-brand:#0066FF;width:400px;height:auto;min-height:260px;max-height:500px;border-radius:18px;overflow:hidden;box-shadow:0 10px 40px rgba(0,0,0,0.14);display:flex;flex-direction:column;background:#fff;position:absolute;bottom:72px;transition:opacity 0.25s,transform 0.25s;transform-origin:bottom;}',
    '.sa-widget-panel.sa-hidden{opacity:0;transform:translateY(12px) scale(0.95);pointer-events:none;}',
    '.sa-widget-panel.sa-visible{opacity:1;transform:translateY(0) scale(1);}',
    '.sa-widget-header{padding:14px 16px;color:#fff;display:flex;align-items:center;gap:12px;flex-shrink:0;}',
    '.sa-widget-header-avatar{width:40px;height:40px;border-radius:50%;flex-shrink:0;overflow:hidden;background:rgba(255,255,255,0.22);position:relative;}',
    '.sa-widget-header-avatar img{width:100%;height:100%;object-fit:cover;display:block;}',
    '.sa-widget-header-avatar-fallback{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-size:15px;font-weight:700;color:#fff;background:rgba(255,255,255,0.18);}',
    '.sa-widget-header-avatar.sa-has-logo .sa-widget-header-avatar-fallback{display:none;}',
    '.sa-widget-header-center{flex:1;min-width:0;text-align:left;}',
    '.sa-widget-header-center h3{margin:0;font-size:16px;font-weight:600;line-height:1.25;}',
    '.sa-widget-header-subtitle{margin:4px 0 0;font-size:12px;font-weight:400;opacity:0.92;line-height:1.3;}',
    '.sa-widget-header-actions{display:flex;align-items:center;gap:10px;flex-shrink:0;}',
    '.sa-widget-status-dot{width:8px;height:8px;border-radius:50%;background:#22c55e;box-shadow:0 0 0 2px rgba(255,255,255,0.35);flex-shrink:0;}',
    '.sa-widget-close{background:none;border:none;color:#fff;cursor:pointer;padding:4px 6px;opacity:0.9;font-size:22px;line-height:1;}',
    '.sa-widget-close:hover{opacity:1;}',
    '.sa-widget-messages{flex:1 1 auto;align-self:stretch;overflow-y:auto;min-height:0;max-height:calc(500px - 200px);padding:16px;display:flex;flex-direction:column;gap:10px;background:#fff;}',
    '.sa-widget-msg{max-width:85%;padding:12px 14px;border-radius:14px;word-wrap:break-word;font-size:14px;line-height:1.45;}',
    '.sa-widget-msg-bot{align-self:flex-start;background:#eef1f4;color:#1a1a1a;border-bottom-left-radius:6px;}',
    '.sa-widget-msg-user{align-self:flex-end;color:#fff;border-bottom-right-radius:6px;}',
    '.sa-widget-input-area{padding:12px 16px;border-top:1px solid #e8eaed;display:flex;gap:10px;align-items:center;flex-shrink:0;background:#fff;}',
    '.sa-widget-input{flex:1;border:1px solid #d1d5db;border-radius:999px;padding:10px 16px;font-size:14px;outline:none;font-family:inherit;background:#fff;color:#1a1a1a;}',
    '.sa-widget-input::placeholder{color:#9ca3af;}',
    '.sa-widget-input:focus{border-color:var(--sa-brand);box-shadow:0 0 0 2px rgba(0,0,0,0.06);}',
    '.sa-widget-send{width:40px;height:40px;border-radius:50%;border:none;cursor:pointer;display:flex;align-items:center;justify-content:center;transition:opacity 0.2s;flex-shrink:0;}',
    '.sa-widget-send:disabled{opacity:0.5;cursor:default;}',
    '.sa-widget-footer{padding:10px 12px;border-top:1px solid #e8eaed;background:#f3f4f6;flex-shrink:0;text-align:center;font-size:11px;line-height:1.4;}',
    '.sa-widget-footer a{color:#9ca3af;text-decoration:none;}',
    '.sa-widget-footer a:hover{color:#6b7280;text-decoration:underline;}',
    '.sa-widget-loading-dot{width:12px;height:12px;border-radius:50%;background:var(--sa-brand,#ff8c42);flex-shrink:0;margin:10px 14px;align-self:flex-start;animation:sa-widget-dot-pulse 1.5s infinite;}',
    '@keyframes sa-widget-dot-pulse{0%{transform:scale(1);opacity:1;}50%{transform:scale(1.6);opacity:0.4;}100%{transform:scale(1);opacity:1;}}',
    '.sa-widget-cursor{display:inline-block;width:2px;height:1em;background:#1a1a1a;margin-left:1px;vertical-align:text-bottom;animation:sa-widget-blink 0.7s step-end infinite;}',
    '@keyframes sa-widget-blink{0%,100%{opacity:1;}50%{opacity:0;}}',
    '.sa-widget-lead-form{padding:20px 16px;display:flex;flex-direction:column;gap:12px;}',
    '.sa-widget-lead-form p{margin:0;font-size:14px;color:#4a5568;text-align:center;}',
    '.sa-widget-lead-input{border:1px solid #d1d5db;border-radius:8px;padding:10px 12px;font-size:14px;outline:none;font-family:inherit;}',
    '.sa-widget-lead-input:focus{border-color:var(--sa-brand);box-shadow:0 0 0 2px rgba(0,0,0,0.06);}',
    '.sa-widget-lead-btn{border:none;color:#fff;border-radius:8px;padding:10px;font-size:14px;font-weight:600;cursor:pointer;}',
    '.sa-widget-lead-skip{background:none;border:none;color:#9ca3af;cursor:pointer;font-size:12px;text-align:center;}',
    '@media(max-width:500px){.sa-widget-panel{width:100vw;height:100vh;max-height:none;min-height:0;position:fixed;top:0;left:0;bottom:auto;border-radius:0;}.sa-widget-messages{max-height:none;flex:1;min-height:0;}.sa-widget-container.sa-open .sa-widget-btn{display:none;}}',
    '.sa-widget-btn.sa-btn-hidden{opacity:0;transform:scale(0.8);pointer-events:none;}',
    '.sa-widget-btn.sa-btn-visible{opacity:1;transform:scale(1);transition:opacity 0.4s ease,transform 0.4s ease;}'
  ].join('\\n');
  document.head.appendChild(style);

  var container = el('div', { class: 'sa-widget-container' });
  var btn = el('div');
  var badge = el('div', { class: 'sa-widget-badge', style: { display: 'none' } }, '0');
  var panel = el('div', { class: 'sa-widget-panel sa-hidden' });
  var header = el('div', { class: 'sa-widget-header' });
  var avatarWrap = el('div', { class: 'sa-widget-header-avatar' });
  var avatarImg = el('img', { class: 'sa-widget-header-avatar-img', alt: '' });
  avatarImg.style.display = 'none';
  var avatarFallback = el('span', { class: 'sa-widget-header-avatar-fallback' }, '\\u2026');
  avatarWrap.appendChild(avatarImg);
  avatarWrap.appendChild(avatarFallback);
  var titleH3 = el('h3', null, 'Loading...');
  var subtitleP = el('p', { class: 'sa-widget-header-subtitle' }, 'Typically replies instantly');
  var headerCenter = el('div', { class: 'sa-widget-header-center' });
  headerCenter.appendChild(titleH3);
  headerCenter.appendChild(subtitleP);
  var statusDot = el('span', { class: 'sa-widget-status-dot' });
  statusDot.setAttribute('aria-hidden', 'true');
  var closeBtn = el('button', { class: 'sa-widget-close', onClick: togglePanel, type: 'button', 'aria-label': 'Close chat' }, '\\u00D7');
  var headerActions = el('div', { class: 'sa-widget-header-actions' });
  headerActions.appendChild(statusDot);
  headerActions.appendChild(closeBtn);
  header.appendChild(avatarWrap);
  header.appendChild(headerCenter);
  header.appendChild(headerActions);
  var messagesArea = el('div', { class: 'sa-widget-messages' });
  var inputArea = el('div', { class: 'sa-widget-input-area' });
  var input = el('input', { class: 'sa-widget-input', placeholder: 'Type your message...', type: 'text' });
  var sendBtn = el('button', { class: 'sa-widget-send', type: 'button', 'aria-label': 'Send message' });
  sendBtn.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>';
  var footerEl = el('div', { class: 'sa-widget-footer' });
  var footerLink = el('a', { href: baseUrl + '/home', target: '_blank', rel: 'noopener noreferrer' }, 'Powered by SimplAssist');
  footerEl.appendChild(footerLink);

  input.addEventListener('keydown', function(e) { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); } });
  sendBtn.addEventListener('click', sendMessage);
  inputArea.appendChild(input);
  inputArea.appendChild(sendBtn);
  panel.appendChild(header);
  panel.appendChild(messagesArea);
  panel.appendChild(inputArea);
  panel.appendChild(footerEl);
  btn.appendChild(badge);
  container.appendChild(panel);
  container.appendChild(btn);
  document.body.appendChild(container);
  btn.addEventListener('click', togglePanel);

  function positionWidget(pos) {
    container.style.bottom = '20px';
    if (pos === 'bottom_left') {
      container.style.left = '20px';
      container.style.right = 'auto';
      panel.style.left = '0';
      panel.style.right = 'auto';
    } else {
      container.style.right = '20px';
      container.style.left = 'auto';
      panel.style.right = '0';
      panel.style.left = 'auto';
    }
  }

  function applyBrandColor(color) {
    btn.className = 'sa-widget-btn';
    btn.style.backgroundColor = color;
    btn.innerHTML = '<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>';
    btn.appendChild(badge);
    panel.style.setProperty('--sa-brand', color);
    header.style.backgroundColor = color;
    sendBtn.style.backgroundColor = color;
  }

  function applyHeaderAvatar(name, showLogo, logoUrl) {
    var initial = (name && name.charAt(0)) ? name.charAt(0).toUpperCase() : '?';
    avatarFallback.textContent = initial;
    if (showLogo && logoUrl) {
      avatarWrap.classList.add('sa-has-logo');
      avatarImg.style.display = 'block';
      avatarFallback.style.display = 'none';
      avatarImg.src = logoUrl;
    } else {
      avatarWrap.classList.remove('sa-has-logo');
      avatarImg.removeAttribute('src');
      avatarImg.style.display = 'none';
      avatarFallback.style.display = 'flex';
    }
  }

  avatarImg.addEventListener('error', function() {
    avatarWrap.classList.remove('sa-has-logo');
    avatarImg.style.display = 'none';
    avatarFallback.style.display = 'flex';
  });

  function togglePanel() {
    isOpen = !isOpen;
    if (isOpen) {
      panel.classList.remove('sa-hidden');
      panel.classList.add('sa-visible');
      container.classList.add('sa-open');
      unreadCount = 0;
      badge.style.display = 'none';
      input.focus();
      scrollToBottom();
    } else {
      panel.classList.remove('sa-visible');
      panel.classList.add('sa-hidden');
      container.classList.remove('sa-open');
    }
  }

  function typeMsg(text, msgEl, callback) {
    var i = 0;
    var cursor = el('span', { class: 'sa-widget-cursor' });
    msgEl.textContent = '';
    msgEl.appendChild(cursor);
    var speed = Math.max(5, Math.min(30, 1500 / (text.length || 1)));
    var timer = setInterval(function() {
      if (i < text.length) {
        if (text.charAt(i) === '\\n') {
          cursor.before(document.createElement('br'));
        } else {
          cursor.before(document.createTextNode(text.charAt(i)));
        }
        i++;
        if (i % 3 === 0) scrollToBottom();
      } else {
        clearInterval(timer);
        cursor.remove();
        scrollToBottom();
        if (callback) callback();
      }
    }, speed);
  }

  function addMsg(text, type, callback) {
    var cls = type === 'bot' ? 'sa-widget-msg sa-widget-msg-bot' : 'sa-widget-msg sa-widget-msg-user';
    var msg = el('div', { class: cls });
    if (type === 'user') {
      msg.textContent = text;
      if (config) msg.style.backgroundColor = config.brandColor;
    }
    messagesArea.appendChild(msg);
    messages.push({ text: text, type: type });
    if (type === 'bot' && !isOpen) {
      unreadCount++;
      badge.textContent = String(unreadCount);
      badge.style.display = 'flex';
    }
    scrollToBottom();
    if (type === 'bot') {
      typeMsg(text, msg, callback);
    } else if (callback) {
      callback();
    }
  }

  function scrollToBottom() {
    setTimeout(function() { messagesArea.scrollTop = messagesArea.scrollHeight; }, 50);
  }

  function showLoading() {
    isLoading = true;
    var dots = el('div', { class: 'sa-widget-loading-dot', id: 'sa-loading' });
    messagesArea.appendChild(dots);
    scrollToBottom();
  }

  function hideLoading() {
    isLoading = false;
    var dots = document.getElementById('sa-loading');
    if (dots) dots.remove();
  }

  function needsLeadCapture() {
    if (!config || !config.leadCaptureEnabled || leadCaptured) return false;
    if (config.leadCaptureTiming === 'start' && messageCount === 0) return true;
    if (config.leadCaptureTiming === 'after_3_messages' && messageCount === 3 && !leadCaptured) return true;
    return false;
  }

  function checkBookingMention(text) {
    if (!config || !config.leadCaptureEnabled || leadCaptured) return false;
    if (config.leadCaptureTiming !== 'on_booking') return false;
    return /\\b(book|booking|schedule|appointment|reserve)\\b/i.test(text);
  }

  function showLeadForm() {
    inputArea.style.display = 'none';
    var form = el('div', { class: 'sa-widget-lead-form', id: 'sa-lead-form' });
    form.appendChild(el('p', null, "We'd love to know who we're chatting with!"));
    var nameInput = el('input', { class: 'sa-widget-lead-input', placeholder: 'Your name', type: 'text' });
    var emailInput = el('input', { class: 'sa-widget-lead-input', placeholder: 'Your email', type: 'email' });
    var submitBtn = el('button', { class: 'sa-widget-lead-btn' }, 'Continue');
    if (config) submitBtn.style.backgroundColor = config.brandColor;
    var skipBtn = el('button', { class: 'sa-widget-lead-skip' }, 'Skip for now');
    submitBtn.addEventListener('click', function() {
      visitorName = nameInput.value.trim();
      visitorEmail = emailInput.value.trim();
      leadCaptured = true;
      form.remove();
      inputArea.style.display = 'flex';
      input.focus();
    });
    skipBtn.addEventListener('click', function() {
      leadCaptured = true;
      form.remove();
      inputArea.style.display = 'flex';
      input.focus();
    });
    form.appendChild(nameInput);
    form.appendChild(emailInput);
    form.appendChild(submitBtn);
    form.appendChild(skipBtn);
    panel.insertBefore(form, inputArea);
  }

  function sendMessage() {
    var text = input.value.trim();
    if (!text || isLoading) return;
    input.value = '';
    addMsg(text, 'user');
    messageCount++;

    if (checkBookingMention(text)) {
      showLeadForm();
    }

    showLoading();
    sendBtn.disabled = true;

    fetch(baseUrl + '/api/widget/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        businessId: businessId,
        message: text,
        sessionId: sessionId,
        visitorEmail: visitorEmail || undefined,
        visitorName: visitorName || undefined
      })
    })
    .then(function(r) { return r.json(); })
    .then(function(data) {
      hideLoading();
      isLoading = true;
      if (data.response) {
        addMsg(data.response, 'bot', function() {
          sendBtn.disabled = false;
          isLoading = false;
          messageCount++;
          if (needsLeadCapture()) showLeadForm();
        });
      } else if (data.error) {
        addMsg('Sorry, something went wrong. Please try again.', 'bot', function() {
          sendBtn.disabled = false;
          isLoading = false;
        });
      }
    })
    .catch(function() {
      hideLoading();
      isLoading = true;
      addMsg('Sorry, something went wrong. Please try again.', 'bot', function() {
        sendBtn.disabled = false;
        isLoading = false;
      });
    });
  }

  // Initialize — hide button until config loads
  btn.classList.add('sa-btn-hidden');
  positionWidget('bottom_right');

  fetch(baseUrl + '/api/widget/config?businessId=' + encodeURIComponent(businessId))
    .then(function(r) { return r.json(); })
    .then(function(data) {
      if (data.error) { console.error('SimplAssist:', data.error); return; }
      config = data;
      titleH3.textContent = data.businessName || 'Chat';
      applyHeaderAvatar(data.businessName || 'Chat', !!data.showLogo, data.logoUrl || '');
      applyBrandColor(data.brandColor || '#0066FF');
      positionWidget(data.position || 'bottom_right');
      btn.classList.remove('sa-btn-hidden');
      btn.classList.add('sa-btn-visible');
      addMsg(data.welcomeMessage || 'Hi! How can we help you today?', 'bot');
      unreadCount = 0;
      badge.style.display = 'none';
      if (needsLeadCapture()) showLeadForm();
    })
    .catch(function(err) {
      console.error('SimplAssist: failed to load config', err);
      titleH3.textContent = 'SimplAssist';
      applyHeaderAvatar('SimplAssist', false, '');
      applyBrandColor('#0066FF');
      btn.classList.remove('sa-btn-hidden');
      btn.classList.add('sa-btn-visible');
      addMsg('Hi! How can we help you today?', 'bot');
      unreadCount = 0;
      badge.style.display = 'none';
    });
})();`;

  return new NextResponse(js, {
    headers: {
      "Content-Type": "application/javascript",
      "Cache-Control": "public, max-age=300",
      "Access-Control-Allow-Origin": "*",
    },
  });
}
