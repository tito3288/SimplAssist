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
    '.sa-widget-panel{width:400px;height:500px;border-radius:16px;overflow:hidden;box-shadow:0 8px 30px rgba(0,0,0,0.12);display:flex;flex-direction:column;background:#fff;position:absolute;bottom:72px;transition:opacity 0.25s,transform 0.25s;transform-origin:bottom;}',
    '.sa-widget-panel.sa-hidden{opacity:0;transform:translateY(12px) scale(0.95);pointer-events:none;}',
    '.sa-widget-panel.sa-visible{opacity:1;transform:translateY(0) scale(1);}',
    '.sa-widget-header{padding:16px;color:#fff;display:flex;align-items:center;justify-content:space-between;}',
    '.sa-widget-header-text h3{margin:0;font-size:16px;font-weight:600;}',
    '.sa-widget-header-text p{margin:2px 0 0;font-size:11px;opacity:0.85;}',
    '.sa-widget-close{background:none;border:none;color:#fff;cursor:pointer;padding:4px;opacity:0.8;font-size:20px;line-height:1;}',
    '.sa-widget-close:hover{opacity:1;}',
    '.sa-widget-messages{flex:1;overflow-y:auto;padding:16px;display:flex;flex-direction:column;gap:8px;}',
    '.sa-widget-msg{max-width:80%;padding:10px 14px;border-radius:16px;word-wrap:break-word;font-size:14px;line-height:1.4;}',
    '.sa-widget-msg-bot{align-self:flex-start;background:#f1f3f5;color:#1a1a1a;border-bottom-left-radius:4px;}',
    '.sa-widget-msg-user{align-self:flex-end;color:#fff;border-bottom-right-radius:4px;}',
    '.sa-widget-input-area{padding:12px 16px;border-top:1px solid #e5e7eb;display:flex;gap:8px;align-items:center;}',
    '.sa-widget-input{flex:1;border:1px solid #d1d5db;border-radius:24px;padding:10px 16px;font-size:14px;outline:none;font-family:inherit;}',
    '.sa-widget-input:focus{border-color:#6366f1;box-shadow:0 0 0 2px rgba(99,102,241,0.15);}',
    '.sa-widget-send{width:36px;height:36px;border-radius:50%;border:none;cursor:pointer;display:flex;align-items:center;justify-content:center;transition:opacity 0.2s;}',
    '.sa-widget-send:disabled{opacity:0.5;cursor:default;}',
    '.sa-widget-dots{display:flex;gap:4px;padding:10px 14px;align-self:flex-start;}',
    '.sa-widget-dots span{width:8px;height:8px;border-radius:50%;background:#9ca3af;animation:sa-bounce 1.4s infinite;}',
    '.sa-widget-dots span:nth-child(2){animation-delay:0.2s;}',
    '.sa-widget-dots span:nth-child(3){animation-delay:0.4s;}',
    '@keyframes sa-bounce{0%,80%,100%{transform:translateY(0);}40%{transform:translateY(-6px);}}',
    '.sa-widget-lead-form{padding:20px 16px;display:flex;flex-direction:column;gap:12px;}',
    '.sa-widget-lead-form p{margin:0;font-size:14px;color:#4a5568;text-align:center;}',
    '.sa-widget-lead-input{border:1px solid #d1d5db;border-radius:8px;padding:10px 12px;font-size:14px;outline:none;font-family:inherit;}',
    '.sa-widget-lead-input:focus{border-color:#6366f1;box-shadow:0 0 0 2px rgba(99,102,241,0.15);}',
    '.sa-widget-lead-btn{border:none;color:#fff;border-radius:8px;padding:10px;font-size:14px;font-weight:600;cursor:pointer;}',
    '.sa-widget-lead-skip{background:none;border:none;color:#9ca3af;cursor:pointer;font-size:12px;text-align:center;}',
    '@media(max-width:500px){.sa-widget-panel{width:100vw;height:100vh;position:fixed;top:0;left:0;bottom:auto;border-radius:0;}.sa-widget-container.sa-open .sa-widget-btn{display:none;}}'
  ].join('\\n');
  document.head.appendChild(style);

  var container = el('div', { class: 'sa-widget-container' });
  var btn = el('div');
  var badge = el('div', { class: 'sa-widget-badge', style: { display: 'none' } }, '0');
  var panel = el('div', { class: 'sa-widget-panel sa-hidden' });
  var header = el('div', { class: 'sa-widget-header' });
  var headerText = el('div', { class: 'sa-widget-header-text' }, [
    el('h3', null, 'Loading...'),
    el('p', null, 'Powered by SimplAssist')
  ]);
  var closeBtn = el('button', { class: 'sa-widget-close', onClick: togglePanel }, '\\u00D7');
  header.appendChild(headerText);
  header.appendChild(closeBtn);
  var messagesArea = el('div', { class: 'sa-widget-messages' });
  var inputArea = el('div', { class: 'sa-widget-input-area' });
  var input = el('input', { class: 'sa-widget-input', placeholder: 'Type a message...', type: 'text' });
  var sendBtn = el('button', { class: 'sa-widget-send' });
  sendBtn.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>';

  input.addEventListener('keydown', function(e) { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); } });
  sendBtn.addEventListener('click', sendMessage);
  inputArea.appendChild(input);
  inputArea.appendChild(sendBtn);
  panel.appendChild(header);
  panel.appendChild(messagesArea);
  panel.appendChild(inputArea);
  btn.appendChild(badge);
  container.appendChild(panel);
  container.appendChild(btn);
  document.body.appendChild(container);

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
    btn.addEventListener('click', togglePanel);
    header.style.backgroundColor = color;
    sendBtn.style.backgroundColor = color;
  }

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

  function addMsg(text, type) {
    var cls = type === 'bot' ? 'sa-widget-msg sa-widget-msg-bot' : 'sa-widget-msg sa-widget-msg-user';
    var msg = el('div', { class: cls }, text);
    if (type === 'user' && config) msg.style.backgroundColor = config.brandColor;
    messagesArea.appendChild(msg);
    messages.push({ text: text, type: type });
    if (type === 'bot' && !isOpen) {
      unreadCount++;
      badge.textContent = String(unreadCount);
      badge.style.display = 'flex';
    }
    scrollToBottom();
  }

  function scrollToBottom() {
    setTimeout(function() { messagesArea.scrollTop = messagesArea.scrollHeight; }, 50);
  }

  function showLoading() {
    isLoading = true;
    var dots = el('div', { class: 'sa-widget-dots', id: 'sa-loading' }, [
      el('span'), el('span'), el('span')
    ]);
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
      sendBtn.disabled = false;
      if (data.response) {
        addMsg(data.response, 'bot');
        messageCount++;
        if (needsLeadCapture()) showLeadForm();
      } else if (data.error) {
        addMsg('Sorry, something went wrong. Please try again.', 'bot');
      }
    })
    .catch(function() {
      hideLoading();
      sendBtn.disabled = false;
      addMsg('Sorry, something went wrong. Please try again.', 'bot');
    });
  }

  // Initialize
  positionWidget('bottom_right');
  applyBrandColor('#0066FF');

  fetch(baseUrl + '/api/widget/config?businessId=' + encodeURIComponent(businessId))
    .then(function(r) { return r.json(); })
    .then(function(data) {
      if (data.error) { console.error('SimplAssist:', data.error); return; }
      config = data;
      headerText.querySelector('h3').textContent = data.businessName;
      applyBrandColor(data.brandColor || '#0066FF');
      positionWidget(data.position || 'bottom_right');
      addMsg(data.welcomeMessage || 'Hi! How can we help you today?', 'bot');
      unreadCount = 0;
      badge.style.display = 'none';
      if (needsLeadCapture()) showLeadForm();
    })
    .catch(function(err) {
      console.error('SimplAssist: failed to load config', err);
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
