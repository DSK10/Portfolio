(function () {
  'use strict';

  const MAX_PROMPT_LEN = 500;
  const MAX_TURNS = 10;
  const MAX_REQUESTS_PER_SESSION = 30;
  const PROFILE_URL = 'knowledge/profile.md';

  const CONTACT_FALLBACK =
    "I don't have a ready answer for that here. For more details, email Deepesh at deepeshsingh10@gmail.com or reach him on LinkedIn: linkedin.com/in/10dsk.";

  const SYSTEM_INSTRUCTIONS =
    "You are Deepesh Singh's Assistant. Answer questions about Deepesh using ONLY the profile below.\n" +
    "If the answer is not in the profile, say you don't know and suggest email (deepeshsingh10@gmail.com) or LinkedIn (linkedin.com/in/10dsk).\n" +
    "Refuse unrelated requests (general coding help, trivia, other people's careers). Do not invent salary, clients, or facts not in the profile.\n" +
    "Keep answers concise (2–4 sentences unless the user asks for detail). Be professional and friendly.\n\n";

  /* Local FAQ — matched before the LLM. First strong match wins. */
  const FAQ = [
    {
      id: 'greeting',
      // Short greetings only (avoid matching "hi" inside longer questions)
      patterns: [
        /^(hi|hello|hey|hola|namaste|yo|sup|hiya)([\s,.!?]|$)/i,
        /^(good\s*)?(morning|afternoon|evening)([\s,.!?]|$)/i,
        /^(hi|hello|hey)\s+(there|deepesh|assistant)([\s,.!?]|$)/i
      ],
      maxLen: 40,
      answer:
        "Hi! I'm Deepesh's Assistant. Ask about his work, projects, skills, experience, or whether he's open to new roles."
    },
    {
      id: 'thanks',
      patterns: [/^(thanks|thank you|thankyou|ty|thx|appreciate it)([\s,.!?]|$)/i],
      maxLen: 48,
      answer: "You're welcome! Happy to help — ask anything else about Deepesh's work or background."
    },
    {
      id: 'bye',
      patterns: [/^(bye|goodbye|see you|see ya|later|take care)([\s,.!?]|$)/i],
      maxLen: 40,
      answer: "Bye! Feel free to come back anytime — or email deepeshsingh10@gmail.com if you'd like to reach Deepesh directly."
    },
    {
      id: 'who',
      includes: [
        'who is deepesh',
        'who are you',
        'tell me about deepesh',
        'tell me about yourself',
        'introduce yourself',
        'about deepesh',
        'who is he'
      ],
      answer:
        "Deepesh Singh is an AI & Deep Learning Scientist at Cynapto Technologies (Mumbai), based in Lucknow. He's the technical owner of agentic AI (enterprise copilots, multi-agent platforms) and visual dubbing (diffusion lip-sync + editing studio), with 4+ years shipping production AI systems."
    },
    {
      id: 'work',
      includes: [
        'what does deepesh work on',
        'current work',
        'what do you work on',
        'what is he working',
        'what is deepesh working',
        'tell me about his work',
        'his work',
        'day to day',
        'day-to-day',
        'what does he do',
        'what do he do'
      ],
      answer:
        "Right now Deepesh is an AI & Deep Learning Scientist at Cynapto. He owns two flagship verticals: agentic AI (enterprise copilots, multi-agent orchestration, RAG systems) and visual dubbing (production lip-sync pipeline + studio). He's also agentifying the dubbing platform into microservices with 12+ LangGraph agents for resumable end-to-end delivery."
    },
    {
      id: 'lip-sync',
      includes: [
        'tell me about the lip-sync project',
        'lip-sync',
        'lipsync',
        'lip sync',
        'dubbing',
        'visual dubbing',
        'diffusion lip'
      ],
      answer:
        "Deepesh built a production lip-sync / visual dubbing pipeline for film, series, and ads — diffusion models trained on ~500 hours of data, running on H100/A100/A40 GPUs, with identity preservation and studio APIs. It pairs with a translation engine covering 50+ languages that cut manual post-edit time by ~70%."
    },
    {
      id: 'rag-agents',
      includes: [
        'rag',
        'agentic',
        'multi-agent',
        'multi agent',
        'copilot',
        'langgraph',
        'enterprise ai',
        'agent builder',
        'orchestration'
      ],
      answer:
        "On the agentic side, Deepesh ships multi-tenant RAG copilots (Text/Query/Graph/Self-RAG over FAISS, Pinecone, Qdrant), a LangGraph + Langflow agent builder, MCP integrations, and LiteLLM failover routing. He also owns evaluation with Ragas, LLM-as-judge golden sets, and Langfuse tracing for cost/latency audits."
    },
    {
      id: 'experience',
      includes: [
        'experience',
        'how many years',
        'years of experience',
        'background',
        'career',
        'previous roles',
        'work history',
        'past roles'
      ],
      answer:
        "Deepesh has 4+ years focused on production AI (5+ years across roles since 2020). He's been at Cynapto since Aug 2022 as AI & Deep Learning Scientist, after roles at Skyrath (Django backend), Omdena (research intern on a career recommender), and freelancing (25+ international deliveries)."
    },
    {
      id: 'skills',
      includes: [
        'skills',
        'tech stack',
        'technologies',
        'what can he do',
        'stack',
        'tools he uses',
        'programming',
        'which languages'
      ],
      answer:
        "His core stack: LangGraph, LangChain, CrewAI, LiteLLM, OpenAI/Gemini, PyTorch, FastAPI, RAG (FAISS/Pinecone/Qdrant), diffusion & CV (OpenCV, FFmpeg), plus AWS, Docker, Redis, PostgreSQL. Strong on agentic systems, generative AI, evaluation/observability, and shipping Python backends."
    },
    {
      id: 'education',
      includes: [
        'education',
        'degree',
        'university',
        'college',
        'm.tech',
        'mtech',
        'b.tech',
        'btech',
        'studied',
        'graduation'
      ],
      answer:
        "He holds an M.Tech in Artificial Intelligence and Robotics and a B.Tech in Computer Science & Engineering from Gautam Buddha University, Greater Noida — GPA 8.0 for both."
    },
    {
      id: 'location',
      includes: [
        'where is he',
        'where does he live',
        'where is deepesh',
        'location',
        'based in',
        'lucknow',
        'mumbai',
        'remote',
        'relocate'
      ],
      answer:
        "Deepesh is based in Lucknow, India. His employer, Cynapto Technologies, is headquartered in Mumbai. He's open to discuss location flexibility for the right role — best via email or LinkedIn."
    },
    {
      id: 'hiring',
      includes: [
        'is he open to new roles',
        'open to work',
        'open to new roles',
        'is he available',
        'hiring',
        'available for',
        'job opportunity',
        'looking for a job',
        'notice period',
        'available to join',
        'can i hire',
        'open to roles'
      ],
      answer:
        "Yes — he's open to AI Engineer, Agentic AI Engineer, Generative AI Engineer, Forward Deployed Engineer, and Python Developer roles, plus research collaborations and consulting. He's currently serving notice (last working day 3 September 2026) and can join from September 2026. Reach him at deepeshsingh10@gmail.com or linkedin.com/in/10dsk."
    },
    {
      id: 'contact',
      includes: [
        'contact',
        'email',
        'reach him',
        'how to reach',
        'phone',
        'linkedin',
        'get in touch',
        'hire him'
      ],
      answer:
        "Best contact: deepeshsingh10@gmail.com or LinkedIn linkedin.com/in/10dsk. GitHub: github.com/DSK10 · YouTube: youtube.com/@DEEPESHSINGH10."
    },
    {
      id: 'resume',
      includes: ['resume', 'cv', 'curriculum'],
      answer:
        "You can view his resume from the portfolio (nav → view resume), or email deepeshsingh10@gmail.com and he'll share the latest copy."
    },
    {
      id: 'github',
      includes: ['github', 'open source', 'repositories', 'repos', 'projects on github'],
      answer:
        "Deepesh has 85+ AI/ML projects on GitHub (github.com/DSK10), including AgenticJobHunt, a conversational AI notetaker, and reproducible ML pipelines with MLflow + DVC."
    },
    {
      id: 'research',
      includes: ['research', 'paper', 'publication', 'published', 'doi'],
      answer:
        "He has a published paper — Improved Two Stage Generative Adversarial Networks for Example Attack (doi:10.2174/2666255816666230608104148) — plus Omdena open-source research and 15+ certifications from Google, IBM, and DeepLearning.ai."
    },
    {
      id: 'hobbies',
      includes: ['hobbies', 'hobby', 'sports', 'free time', 'painting', 'football', 'what does he do for fun'],
      answer:
        "Outside work he plays football, cricket, swimming, and badminton — and enjoys painting, VFX, and 3D animation. Day-to-day tools include VS Code, Cursor, Claude Code, and Jupyter."
    },
    {
      id: 'salary',
      includes: ['salary', 'compensation', 'pay', 'ctc', 'package', 'how much does he make'],
      answer:
        "Compensation details aren't shared here. For role fit and expectations, email deepeshsingh10@gmail.com or message him on LinkedIn."
    }
  ];

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

  function hasApiKey() {
    const key = getConfig().key;
    return !!(key && key !== 'YOUR_SPECTRAL_KEY_HERE');
  }

  function normalizeQuery(text) {
    return String(text || '')
      .toLowerCase()
      .replace(/[^\w\s+'@.-]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  /** Return a canned FAQ answer, or null if nothing matches. */
  function matchFaq(userText) {
    const q = normalizeQuery(userText);
    if (!q) return null;

    function hasPhrase(needle) {
      const n = normalizeQuery(needle);
      if (!n) return false;
      if (n.length <= 3) {
        // Word-boundary match for short tokens (avoid "cv" in "opencv")
        return new RegExp('(?:^|\\s)' + n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(?:\\s|$)').test(q);
      }
      return q.includes(n);
    }

    for (let i = 0; i < FAQ.length; i++) {
      const entry = FAQ[i];
      if (entry.maxLen && q.length > entry.maxLen) continue;

      if (entry.patterns) {
        for (let p = 0; p < entry.patterns.length; p++) {
          if (entry.patterns[p].test(q)) return entry.answer;
        }
      }

      if (entry.includes) {
        for (let j = 0; j < entry.includes.length; j++) {
          if (hasPhrase(entry.includes[j])) return entry.answer;
        }
      }
    }
    return null;
  }

  async function resolveReply(userText) {
    const faq = matchFaq(userText);
    if (faq) return faq;

    if (hasApiKey()) {
      try {
        return await callLlm(userText);
      } catch (_err) {
        // Never surface API/network errors — fall through to contact.
      }
    }

    return CONTACT_FALLBACK;
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
        'Deepesh Singh is an AI & Deep Learning Scientist in Lucknow, India, at Cynapto Technologies (Mumbai). ' +
        'He owns agentic AI and visual dubbing product lines. Contact: deepeshsingh10@gmail.com, LinkedIn /in/10dsk, GitHub DSK10, YouTube @DEEPESHSINGH10.';
    }
    return profileContent;
  }

  async function buildSystemPrompt() {
    const profile = await loadProfileContent();
    return SYSTEM_INSTRUCTIONS + getDateTimeContext() + '--- PROFILE ---\n' + profile;
  }

  async function callLlm(userText) {
    const cfg = getConfig();
    if (!hasApiKey()) {
      throw new Error('API key not configured');
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
      if (!res.ok) throw new Error('Request failed');
      if (raw.trim()) return raw.trim();
      throw new Error('Empty response');
    }

    if (!res.ok) {
      throw new Error('Request failed');
    }

    const text = parseResponse(data);
    if (!text) throw new Error('Empty response');
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
    const fromFaq = !!matchFaq(trimmed);

    try {
      // Only count toward session limit when we hit the LLM
      if (!fromFaq && hasApiKey()) requestCount += 1;
      const reply = await resolveReply(trimmed);
      typing.remove();
      await appendStreamingMessage(reply);
      history.push({ role: 'assistant', content: reply });
    } catch (_err) {
      typing.remove();
      await appendStreamingMessage(CONTACT_FALLBACK);
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
    loadProfileContent(); // warm cache for optional LLM answers
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
