(function () {
  'use strict';

  const MAX_PROMPT_LEN = 500;
  const MAX_TURNS = 10;
  const MAX_REQUESTS_PER_SESSION = 30;
  const PROFILE_URL = 'knowledge/profile.md';

  const SYSTEM_INSTRUCTIONS =
    "You are Deepesh Singh's Assistant. Answer questions about Deepesh using ONLY the profile below.\n" +
    "If the answer is not in the profile, say you don't know and suggest email (deepeshsingh10@gmail.com) or LinkedIn (linkedin.com/in/10dsk).\n" +
    "Refuse unrelated requests (general coding help, trivia, other people's careers). Do not invent salary, clients, or facts not in the profile.\n" +
    "Keep answers concise (2–4 sentences unless the user asks for detail). Be professional and friendly.\n\n";

  let profileContent = null;
  let history = [];
  let requestCount = 0;
  let profileLoadError = null;

  const fab = document.getElementById('chat-fab');
  const panel = document.getElementById('chat-panel');
  const closeBtn = document.getElementById('chat-close');
  const messagesEl = document.getElementById('chat-messages');
  const form = document.getElementById('chat-form');
  const input = document.getElementById('chat-input');
  const sendBtn = document.getElementById('chat-send');
  const errorEl = document.getElementById('chat-error');
  const promptsEl = document.getElementById('chat-prompts');

  if (!fab || !panel) return;

  function getConfig() {
    return window.CHAT_CONFIG || {};
  }

  function escapeHtml(text) {
    const d = document.createElement('div');
    d.textContent = text;
    return d.innerHTML;
  }

  function showError(msg) {
    if (!errorEl) return;
    errorEl.textContent = msg;
    errorEl.hidden = !msg;
  }

  function formatBubbleHtml(text) {
    return escapeHtml(text).replace(/\n/g, '<br>');
  }

  function appendMessage(role, text) {
    const div = document.createElement('div');
    div.className = 'chat-msg chat-msg--' + role;
    div.innerHTML = '<div class="chat-msg-bubble">' + formatBubbleHtml(text) + '</div>';
    messagesEl.appendChild(div);
    messagesEl.scrollTop = messagesEl.scrollHeight;
    return div;
  }

  function createStreamingMessage() {
    const div = document.createElement('div');
    div.className = 'chat-msg chat-msg--assistant';
    div.innerHTML =
      '<div class="chat-msg-bubble is-streaming">' +
      '<span class="chat-stream-text"></span>' +
      '<span class="chat-cursor" aria-hidden="true"></span>' +
      '</div>';
    messagesEl.appendChild(div);
    messagesEl.scrollTop = messagesEl.scrollHeight;
    return div.querySelector('.chat-stream-text');
  }

  function streamText(el, fullText) {
    const tokens = fullText.match(/\S+\s*|\n/g) || [fullText];
    const bubble = el.closest('.chat-msg-bubble');
    let i = 0;
    let shown = '';

    return new Promise((resolve) => {
      function tick() {
        if (i >= tokens.length) {
          bubble.classList.remove('is-streaming');
          bubble.querySelector('.chat-cursor')?.remove();
          el.innerHTML = formatBubbleHtml(fullText);
          messagesEl.scrollTop = messagesEl.scrollHeight;
          resolve();
          return;
        }
        shown += tokens[i++];
        el.innerHTML = formatBubbleHtml(shown);
        messagesEl.scrollTop = messagesEl.scrollHeight;
        const delay = tokens[i - 1].trim().length > 8 ? 28 : 16;
        setTimeout(tick, delay);
      }
      tick();
    });
  }

  async function appendStreamingMessage(text) {
    const el = createStreamingMessage();
    await streamText(el, text);
    return el.closest('.chat-msg');
  }

  function appendTyping() {
    const div = document.createElement('div');
    div.className = 'chat-msg chat-msg--assistant chat-msg--typing';
    div.innerHTML = '<div class="chat-msg-bubble"><span class="chat-dots"><span></span><span></span><span></span></span></div>';
    messagesEl.appendChild(div);
    messagesEl.scrollTop = messagesEl.scrollHeight;
    return div;
  }

  function buildPrompt(userText) {
    const recent = history.slice(-6);
    if (!recent.length) return userText;
    const lines = recent.map((t) => (t.role === 'user' ? 'User: ' : 'Assistant: ') + t.content);
    return 'Previous conversation:\n' + lines.join('\n') + '\n\nUser: ' + userText;
  }

  function parseResponse(data) {
    if (typeof data === 'string') return data;
    if (!data || typeof data !== 'object') return '';
    const keys = ['response', 'result', 'output', 'text', 'message', 'content', 'answer'];
    for (const k of keys) {
      if (typeof data[k] === 'string' && data[k].trim()) return data[k].trim();
    }
    if (data.data && typeof data.data === 'object') {
      for (const k of keys) {
        if (typeof data.data[k] === 'string' && data.data[k].trim()) return data.data[k].trim();
      }
    }
    return '';
  }

  function getDateTimeContext() {
    const now = new Date();
    const weekday = now.toLocaleDateString('en-US', { weekday: 'long' });
    const date = now.toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    });
    const time = now.toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: true
    });
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    return (
      '--- CURRENT DATE & TIME ---\n' +
      'Weekday: ' + weekday + '\n' +
      'Date: ' + date + '\n' +
      'Time: ' + time + '\n' +
      'Timezone: ' + tz + '\n\n'
    );
  }

  async function loadProfileContent() {
    if (profileContent) return profileContent;
    try {
      const res = await fetch(PROFILE_URL);
      if (!res.ok) throw new Error('Could not load profile');
      profileContent = await res.text();
      profileLoadError = null;
    } catch (e) {
      profileLoadError = e.message;
      profileContent =
        'Deepesh Singh is an AI Engineer & Team Lead in Lucknow, India, at Cynapto Technologies. ' +
        'He owns agentic AI and visual dubbing product lines. Contact: deepeshsingh10@gmail.com, LinkedIn /in/10dsk, GitHub DSK10.';
    }
    return profileContent;
  }

  async function buildSystemPrompt() {
    const profile = await loadProfileContent();
    return SYSTEM_INSTRUCTIONS + getDateTimeContext() + '--- PROFILE ---\n' + profile;
  }

  async function callLlm(userText) {
    const cfg = getConfig();
    if (!cfg.key || cfg.key === 'YOUR_SPECTRAL_KEY_HERE') {
      throw new Error('Add your API key in chat-config.local.js (copy from chat-config.example.js).');
    }

    const res = await fetch(cfg.apiUrl || 'https://api-dev.spectralstudios.ai/web/llm', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        system: await buildSystemPrompt(),
        prompt: buildPrompt(userText),
        key: cfg.key,
        model: cfg.model || 'gpt-4o-mini'
      })
    });

    const raw = await res.text();
    let data;
    try {
      data = JSON.parse(raw);
    } catch {
      if (!res.ok) {
        if (raw.includes('502')) throw new Error('Assistant is on vacation — please try again later. 🌴');
        if (raw.includes('<html')) throw new Error('Request failed (' + res.status + '). Try again later.');
      }
      if (!res.ok) throw new Error(raw.slice(0, 120) || 'Request failed');
      return raw.trim();
    }

    if (!res.ok) {
      const errMsg = parseResponse(data) || data.error || data.message || 'API error ' + res.status;
      throw new Error(typeof errMsg === 'string' ? errMsg : 'API error ' + res.status);
    }

    const text = parseResponse(data);
    if (!text) throw new Error('Empty response from API');
    return text;
  }

  async function sendMessage(text) {
    const trimmed = text.trim();
    if (!trimmed || trimmed.length > MAX_PROMPT_LEN) return;

    if (requestCount >= MAX_REQUESTS_PER_SESSION) {
      showError('Session limit reached. Refresh the page to continue.');
      return;
    }

    showError('');
    if (promptsEl) promptsEl.hidden = true;

    appendMessage('user', trimmed);
    history.push({ role: 'user', content: trimmed });
    if (history.length > MAX_TURNS * 2) history = history.slice(-MAX_TURNS * 2);

    input.value = '';
    input.disabled = true;
    sendBtn.disabled = true;

    const typing = appendTyping();

    try {
      requestCount += 1;
      const reply = await callLlm(trimmed);
      typing.remove();
      await appendStreamingMessage(reply);
      history.push({ role: 'assistant', content: reply });
    } catch (err) {
      typing.remove();
      const msg = err.message || 'Something went wrong';
      if (msg.includes('Failed to fetch') || msg.includes('NetworkError')) {
        showError('Cannot reach the API (network or CORS). Serve the site over HTTP/HTTPS, not file://.');
      } else {
        showError(msg);
      }
      await appendStreamingMessage("Sorry, I couldn't answer right now. Try again or email deepeshsingh10@gmail.com.");
      history.pop();
    } finally {
      input.disabled = false;
      sendBtn.disabled = false;
      input.focus();
    }
  }

  function openPanel() {
    panel.hidden = false;
    fab.setAttribute('aria-expanded', 'true');
    document.body.classList.add('chat-open');
    loadProfileContent().then(() => {
      if (profileLoadError && messagesEl.children.length === 0) {
        showError('Profile file not loaded; using summary only.');
      }
    });
    input.focus();
  }

  function closePanel() {
    panel.hidden = true;
    fab.setAttribute('aria-expanded', 'false');
    document.body.classList.remove('chat-open');
  }

  fab.addEventListener('click', () => {
    if (panel.hidden) openPanel();
    else closePanel();
  });

  closeBtn.addEventListener('click', closePanel);

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !panel.hidden) closePanel();
  });

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    sendMessage(input.value);
  });

  promptsEl?.querySelectorAll('[data-prompt]').forEach((btn) => {
    btn.addEventListener('click', () => sendMessage(btn.getAttribute('data-prompt')));
  });

  appendStreamingMessage(
    "Hi! I'm Deepesh's Assistant. Ask about his work, projects, skills, or experience."
  );
})();
