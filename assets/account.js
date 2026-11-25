/* ============================================================
   JSON Studio — accounts, plans & billing (local demo)
   ------------------------------------------------------------
   Everything lives in this browser: accounts, sessions, plan
   state, masked cards and receipts. Passwords are salted and
   PBKDF2-hashed (with a deterministic fallback when WebCrypto
   is unavailable on file://). The checkout is a simulation and
   never charges a real card.
   ============================================================ */
(function (global) {
  'use strict';

  const STORAGE_KEY = 'json-studio-account-v1';
  const DAY = 86400000;
  const FREE_MAX_BYTES = 1000000;
  const PRO_MAX_BYTES = 25000000;
  const FREE_HISTORY = 3;
  const PRO_HISTORY = 25;
  const MAX_HISTORY_STORED = 25;

  const PRICES = {
    monthly: { cents: 900, label: '$9', suffix: '/ month', note: 'Billed monthly' },
    yearly: { cents: 7200, label: '$72', suffix: '/ year', note: '$6 / month · billed yearly', saving: 'Save 33%' }
  };

  const ACCENTS = [
    { id: 'violet', label: 'Violet', color: '#8b5cf6' },
    { id: 'ocean', label: 'Ocean', color: '#0ea5e9' },
    { id: 'emerald', label: 'Emerald', color: '#10b981' },
    { id: 'sunset', label: 'Sunset', color: '#f97316' },
    { id: 'rose', label: 'Rose', color: '#f43f5e' }
  ];

  const FEATURES = {
    free: [
      'Local JSON parser & tree explorer',
      'Format, minify, sort & lenient mode',
      'TypeScript and YAML converters',
      'Stats, search and JSONPath bar',
      '1 MB document limit',
      '3 recent documents'
    ],
    pro: [
      'Everything in Free',
      'JSONPath-lite query studio',
      'CSV, Python & JavaScript converters',
      'JSON Schema and mock data generators',
      '25 MB document limit',
      '25 recent documents',
      '5 accent themes',
      'Receipts, invoices & priority support'
    ]
  };

  const COUNTRIES = [
    ['US', 'United States'], ['CA', 'Canada'], ['GB', 'United Kingdom'], ['DE', 'Germany'],
    ['FR', 'France'], ['NL', 'Netherlands'], ['IE', 'Ireland'], ['ES', 'Spain'],
    ['IT', 'Italy'], ['SE', 'Sweden'], ['IN', 'India'], ['AU', 'Australia'],
    ['NZ', 'New Zealand'], ['SG', 'Singapore'], ['JP', 'Japan'], ['BR', 'Brazil'],
    ['ZA', 'South Africa'], ['AE', 'United Arab Emirates']
  ];

  /* ------------------------------------------------------------
     Storage
     ------------------------------------------------------------ */

  function emptyDb() {
    return { version: 1, seeded: false, users: [], sessionId: null };
  }

  function loadDb() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return emptyDb();
      const parsed = JSON.parse(raw);
      if (!parsed || !Array.isArray(parsed.users)) return emptyDb();
      return Object.assign(emptyDb(), parsed);
    } catch (e) {
      return emptyDb();
    }
  }

  let db = loadDb();
  let listeners = [];
  let notifyFn = function () {};
  let activeModal = null;
  let menuOpen = false;
  let pendingIntent = null;
  let authTab = 'login';
  let pricingInterval = 'monthly';
  let checkoutState = null;
  let seedPromise = null;

  function saveDb() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(db)); } catch (e) { /* private mode */ }
  }

  function currentUser() {
    if (!db.sessionId) return null;
    return db.users.find(function (u) { return u.id === db.sessionId; }) || null;
  }

  function publicUser(user) {
    if (!user) return null;
    return {
      id: user.id,
      name: user.name,
      email: user.email,
      plan: user.plan || 'free',
      interval: user.interval || null,
      planSince: user.planSince || null,
      renewsAt: user.renewsAt || null,
      card: user.card || null,
      accent: user.accent || 'violet',
      createdAt: user.createdAt,
      invoices: (user.invoices || []).slice()
    };
  }

  function emit() {
    applyAccent();
    renderAccount();
    const snapshot = publicUser(currentUser());
    for (const fn of listeners) {
      try { fn(snapshot, isPro()); } catch (e) { /* isolate */ }
    }
    try {
      document.dispatchEvent(new CustomEvent('jsonstudio:accountchange', {
        detail: { user: snapshot, pro: isPro() }
      }));
    } catch (e) { /* ignore */ }
  }

  /* ------------------------------------------------------------
     Hashing
     ------------------------------------------------------------ */

  function randomHex(bytes) {
    const arr = new Uint8Array(bytes);
    if (global.crypto && global.crypto.getRandomValues) global.crypto.getRandomValues(arr);
    else for (let i = 0; i < bytes; i++) arr[i] = Math.floor(Math.random() * 256);
    return Array.from(arr).map(function (b) { return b.toString(16).padStart(2, '0'); }).join('');
  }

  function hexToBytes(hex) {
    const out = new Uint8Array(hex.length / 2);
    for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.substr(i * 2, 2), 16);
    return out;
  }

  function bytesToHex(buffer) {
    return Array.from(new Uint8Array(buffer)).map(function (b) { return b.toString(16).padStart(2, '0'); }).join('');
  }

  function fnvHash(input) {
    let h1 = 0x811c9dc5;
    let h2 = 0x01000193;
    for (let i = 0; i < input.length; i++) {
      const c = input.charCodeAt(i);
      h1 = Math.imul(h1 ^ c, 0x01000193) >>> 0;
      h2 = Math.imul(h2 ^ (c + i), 0x85ebca6b) >>> 0;
    }
    return (h1 >>> 0).toString(16).padStart(8, '0') + (h2 >>> 0).toString(16).padStart(8, '0');
  }

  function canUseWebCrypto() {
    return !!(global.crypto && global.crypto.subtle && global.TextEncoder);
  }

  async function hashPassword(password, saltHex) {
    if (canUseWebCrypto()) {
      try {
        const enc = new TextEncoder();
        const key = await global.crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
        const bits = await global.crypto.subtle.deriveBits({
          name: 'PBKDF2', salt: hexToBytes(saltHex), iterations: 120000, hash: 'SHA-256'
        }, key, 256);
        return { alg: 'pbkdf2-sha256-120000', hash: bytesToHex(bits) };
      } catch (e) { /* fall through */ }
    }
    return { alg: 'fnv1a', hash: fnvHash(saltHex + '|' + password + '|' + saltHex) };
  }

  async function verifyPassword(user, password) {
    const result = await hashPassword(password, user.salt);
    return result.alg === (user.alg || result.alg) && result.hash === user.hash;
  }

  /* ------------------------------------------------------------
     Seeding demo account
     ------------------------------------------------------------ */

  async function ensureDemo() {
    if (db.seeded) return;
    db.seeded = true;
    if (!db.users.length) {
      const salt = randomHex(16);
      const hashed = await hashPassword('demo1234', salt);
      const now = Date.now();
      db.users.push({
        id: 'usr_demo',
        name: 'Ada Lovelace',
        email: 'demo@jsonstudio.app',
        salt: salt,
        hash: hashed.hash,
        alg: hashed.alg,
        createdAt: now,
        plan: 'pro',
        interval: 'monthly',
        planSince: now,
        renewsAt: now + 30 * DAY,
        accent: 'violet',
        card: { brand: 'Visa', last4: '4242', exp: '12/29', name: 'Ada Lovelace', zip: '94107', country: 'US' },
        invoices: [{
          id: 'INV-' + new Date(now).getUTCFullYear() + '-0001',
          date: now,
          amount: 900,
          plan: 'Pro',
          interval: 'monthly',
          last4: '4242',
          status: 'paid'
        }]
      });
    }
    saveDb();
  }

  seedPromise = ensureDemo();

  /* ------------------------------------------------------------
     Top bar account UI
     ------------------------------------------------------------ */

  function esc(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function money(cents) {
    return '$' + (cents / 100).toFixed(2);
  }

  function shortDate(ts) {
    if (!ts) return '—';
    return new Date(ts).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  }

  function initials(name) {
    const parts = String(name || '?').trim().split(/\s+/);
    return ((parts[0] || '?').charAt(0) + (parts[1] ? parts[1].charAt(0) : '')).toUpperCase();
  }

  function accentAllowed() {
    return isPro();
  }

  function applyAccent() {
    const user = currentUser();
    let accent = 'violet';
    if (user && user.plan === 'pro' && ACCENTS.some(function (a) { return a.id === user.accent; })) {
      accent = user.accent;
    }
    document.documentElement.dataset.accent = accent;
  }

  function renderAccount() {
    const slot = document.getElementById('accountSlot');
    if (!slot) return;
    const user = currentUser();

    if (!user) {
      slot.classList.remove('open');
      slot.innerHTML =
        '<button class="account-btn guest" data-account-act="signin" title="Sign in or create a free account">' +
        '<svg class="icon"><use href="#i-user"/></svg><span>Sign in</span></button>';
      menuOpen = false;
      return;
    }

    const pro = user.plan === 'pro';
    const card = user.card;
    const planLine = pro
      ? (user.interval === 'yearly' ? 'Billed yearly · renews ' : 'Billed monthly · renews ') + shortDate(user.renewsAt)
      : 'Free forever · upgrade any time';

    let menu = '<div class="account-menu" role="menu">' +
      '<div class="acct-head">' +
        '<span class="avatar ' + (pro ? 'pro' : '') + '">' + esc(initials(user.name)) + '</span>' +
        '<div class="acct-id"><strong>' + esc(user.name) + '</strong><span>' + esc(user.email) + '</span></div>' +
      '</div>' +
      '<div class="acct-plan ' + (pro ? 'pro' : '') + '">' +
        '<div class="acct-plan-top"><span class="plan-badge ' + (pro ? 'pro' : 'free') + '">' + (pro ? 'PRO' : 'FREE') + '</span>' +
        '<span class="acct-plan-line">' + esc(planLine) + '</span></div>' +
        (pro
          ? '<button class="btn small" data-account-act="manage"><svg class="icon"><use href="#i-card"/></svg>Manage subscription</button>'
          : '<button class="btn small primary" data-account-act="upgrade"><svg class="icon"><use href="#i-crown"/></svg>Upgrade to Pro</button>') +
      '</div>' +
      '<div class="acct-links">' +
        '<button data-account-act="recent"><svg class="icon"><use href="#i-history"/></svg><span>Recent documents</span></button>' +
        '<button data-account-act="billing"><svg class="icon"><use href="#i-card"/></svg><span>Billing &amp; receipts</span></button>' +
        '<button data-account-act="profile"><svg class="icon"><use href="#i-settings"/></svg><span>Account settings</span></button>' +
      '</div>' +
      '<div class="acct-accent">' +
        '<div class="acct-accent-label"><span>Accent</span>' + (pro ? '' : '<span class="pro-tag">PRO</span>') + '</div>' +
        '<div class="accent-swatches">' +
          ACCENTS.map(function (a) {
            const active = (user.accent || 'violet') === a.id;
            return '<button class="accent-swatch' + (active ? ' active' : '') + '" data-account-accent="' + a.id +
              '" style="--swatch:' + a.color + '" title="' + a.label + (pro ? '' : ' (Pro)') + '" aria-label="' + a.label + '">' +
              (active ? '<svg class="icon"><use href="#i-check"/></svg>' : '') + '</button>';
          }).join('') +
        '</div>' +
      '</div>' +
      '<div class="acct-foot">' +
        '<button class="acct-signout" data-account-act="signout"><svg class="icon"><use href="#i-logout"/></svg>Sign out</button>' +
        '<span class="acct-version">JSON Studio</span>' +
      '</div>' +
    '</div>';

    slot.classList.toggle('open', menuOpen);
    slot.innerHTML =
      '<button class="account-btn" data-account-act="menu" aria-haspopup="menu" aria-expanded="' + String(menuOpen) + '">' +
        '<span class="avatar ' + (pro ? 'pro' : '') + '">' + esc(initials(user.name)) + '</span>' +
        '<span class="account-meta"><span class="account-name">' + esc(user.name.split(/\s+/)[0]) + '</span>' +
        '<span class="plan-badge ' + (pro ? 'pro' : 'free') + '">' + (pro ? 'PRO' : 'FREE') + '</span></span>' +
        '<svg class="icon account-chevron"><use href="#i-down"/></svg>' +
      '</button>' + menu;

    // card presence used for billing badge (kept simple)
    void card;
  }

  function toggleMenu(force) {
    menuOpen = typeof force === 'boolean' ? force : !menuOpen;
    const slot = document.getElementById('accountSlot');
    if (!slot) return;
    slot.classList.toggle('open', menuOpen);
    const btn = slot.querySelector('[data-account-act="menu"]');
    if (btn) btn.setAttribute('aria-expanded', String(menuOpen));
  }

  /* ------------------------------------------------------------
     Modal plumbing
     ------------------------------------------------------------ */

  function closeAccountModals() {
    const nodes = document.querySelectorAll('.account-backdrop');
    for (const node of nodes) node.remove();
    activeModal = null;
    checkoutState = null;
  }

  function showModal(inner, className) {
    closeAccountModals();
    const wrap = document.createElement('div');
    wrap.className = 'modal-backdrop account-backdrop';
    wrap.innerHTML = '<div class="modal ' + (className || '') + '" role="dialog" aria-modal="true">' + inner + '</div>';
    document.body.appendChild(wrap);
    activeModal = wrap;
    wrap.addEventListener('click', function (e) {
      if (e.target === wrap || e.target.closest('[data-acct-close]')) closeAccountModals();
    });
    setTimeout(function () {
      const focusable = wrap.querySelector('input:not([type="hidden"]), select, button:not([data-acct-close])');
      if (focusable) {
        try { focusable.focus(); } catch (e) { /* ignore */ }
      }
    }, 40);
    return wrap;
  }

  function modalHead(title, sub) {
    return '<div class="modal-head">' +
      '<div><h2>' + esc(title) + '</h2>' + (sub ? '<p class="modal-sub">' + sub + '</p>' : '') + '</div>' +
      '<button class="icon-btn" data-acct-close aria-label="Close"><svg class="icon"><use href="#i-x"/></svg></button>' +
    '</div>';
  }

  function formError(message) {
    return '<div class="form-error" role="alert"><svg class="icon"><use href="#i-alert"/></svg><span>' + esc(message) + '</span></div>';
  }

  function setFormError(modal, message) {
    const box = modal.querySelector('.form-error');
    if (!box) return;
    if (!message) { box.hidden = true; box.querySelector('span').textContent = ''; return; }
    box.querySelector('span').textContent = message;
    box.hidden = false;
  }

  function setBusy(button, busy, label) {
    if (!button) return;
    button.disabled = busy;
    if (busy) {
      button.dataset.label = button.innerHTML;
      button.innerHTML = '<span class="spinner"></span>' + (label || 'Working…');
    } else if (button.dataset.label) {
      button.innerHTML = button.dataset.label;
      delete button.dataset.label;
    }
  }

  function fieldError(input, message) {
    const field = input.closest('.field');
    if (!field) return;
    field.classList.toggle('invalid', !!message);
    let msg = field.querySelector('.field-msg');
    if (message) {
      if (!msg) {
        msg = document.createElement('span');
        msg.className = 'field-msg';
        field.appendChild(msg);
      }
      msg.textContent = message;
    } else if (msg) {
      msg.remove();
    }
  }

  function clearFieldErrors(form) {
    for (const field of form.querySelectorAll('.field.invalid')) {
      field.classList.remove('invalid');
      const msg = field.querySelector('.field-msg');
      if (msg) msg.remove();
    }
    for (const row of form.querySelectorAll('.check-row.invalid')) row.classList.remove('invalid');
  }

  /* ------------------------------------------------------------
     Auth
     ------------------------------------------------------------ */

  function openAuth(tab, intent) {
    authTab = tab === 'register' ? 'register' : 'login';
    if (intent) pendingIntent = intent;
    const wrap = showModal(
      '<div class="auth-layout">' +
        '<aside class="auth-aside">' +
          '<div class="auth-brand"><span class="logo mini"><span>{</span><span>}</span></span>' +
          '<span>JSON Studio</span></div>' +
          '<h2>Your data.<br>Your workspace.</h2>' +
          '<p>One account keeps your plan, billing and preferences together — right in this browser.</p>' +
          '<ul class="auth-bullets">' +
            '<li><svg class="icon"><use href="#i-check"/></svg>Free plan, no credit card</li>' +
            '<li><svg class="icon"><use href="#i-check"/></svg>Local-first &amp; private</li>' +
            '<li><svg class="icon"><use href="#i-crown"/></svg>Pro unlocks the studio</li>' +
          '</ul>' +
          '<div class="auth-aside-foot">Passwords are salted and hashed with PBKDF2. Accounts are stored only in this browser.</div>' +
        '</aside>' +
        '<section class="auth-main">' +
          '<div class="auth-topbar">' +
            '<div class="auth-tabs" role="tablist">' +
              '<button role="tab" data-auth-tab="login" class="' + (authTab === 'login' ? 'active' : '') + '">Sign in</button>' +
              '<button role="tab" data-auth-tab="register" class="' + (authTab === 'register' ? 'active' : '') + '">Create account</button>' +
            '</div>' +
            '<button class="icon-btn" data-acct-close aria-label="Close"><svg class="icon"><use href="#i-x"/></svg></button>' +
          '</div>' +
          '<div id="authBody"></div>' +
          '<p class="auth-fineprint">Local demo account — no email is sent and nothing leaves this device.</p>' +
        '</section>' +
      '</div>',
      'auth-modal'
    );

    renderAuthBody(wrap);
    wrap.addEventListener('click', function (e) {
      const tabBtn = e.target.closest('[data-auth-tab]');
      if (tabBtn) {
        e.preventDefault();
        authTab = tabBtn.dataset.authTab;
        const modal = tabBtn.closest('.modal');
        for (const b of modal.querySelectorAll('[data-auth-tab]')) {
          b.classList.toggle('active', b.dataset.authTab === authTab);
        }
        renderAuthBody(wrap);
      }
      const fill = e.target.closest('[data-fill-demo]');
      if (fill) {
        e.preventDefault();
        const email = wrap.querySelector('[name="email"]');
        const pass = wrap.querySelector('[name="password"]');
        if (email) email.value = 'demo@jsonstudio.app';
        if (pass) pass.value = 'demo1234';
        if (email) email.focus();
      }
      const reveal = e.target.closest('[data-reveal-pass]');
      if (reveal) {
        e.preventDefault();
        const input = wrap.querySelector('[name="password"]');
        if (input) {
          input.type = input.type === 'password' ? 'text' : 'password';
          reveal.classList.toggle('on', input.type === 'text');
        }
      }
    });
  }

  function renderAuthBody(wrap) {
    const body = wrap.querySelector('#authBody');
    if (!body) return;
    if (authTab === 'register') {
      body.innerHTML =
        '<form id="registerForm" novalidate autocomplete="on">' +
          '<div class="auth-title"><h3>Create your free account</h3><p>Start free. Upgrade whenever you need more.</p></div>' +
          field('text', 'name', 'Full name', 'Ada Lovelace', 'name') +
          field('email', 'email', 'Work email', 'you@example.com', 'email') +
          '<label class="field"><span>Password</span>' +
            '<div class="pass-wrap"><input type="password" name="password" autocomplete="new-password" placeholder="At least 8 characters" required>' +
            '<button type="button" class="pass-reveal" data-reveal-pass aria-label="Show password"><svg class="icon"><use href="#i-eye"/></svg></button></div>' +
            '<div class="strength" id="strength"><span></span><span></span><span></span><span></span></div>' +
            '<small class="field-hint" id="strengthText">Use 8+ characters with a number</small>' +
          '</label>' +
          '<label class="field"><span>Confirm password</span><input type="password" name="confirm" autocomplete="new-password" placeholder="Repeat your password" required></label>' +
          '<label class="check-row"><input type="checkbox" name="terms"><span>I agree to the <a href="#" data-account-act="terms">demo terms</a> and to storing this account locally.</span></label>' +
          '<div class="form-error" role="alert" hidden><svg class="icon"><use href="#i-alert"/></svg><span></span></div>' +
          '<button class="btn primary auth-submit" type="submit">Create free account</button>' +
          '<p class="auth-switch">Already have an account? <button type="button" data-auth-tab="login">Sign in</button></p>' +
        '</form>';
    } else {
      body.innerHTML =
        '<form id="loginForm" novalidate autocomplete="on">' +
          '<div class="auth-title"><h3>Welcome back</h3><p>Sign in to sync your plan and preferences.</p></div>' +
          field('email', 'email', 'Email', 'you@example.com', 'email') +
          '<label class="field"><span>Password</span>' +
            '<div class="pass-wrap"><input type="password" name="password" autocomplete="current-password" placeholder="Your password" required>' +
            '<button type="button" class="pass-reveal" data-reveal-pass aria-label="Show password"><svg class="icon"><use href="#i-eye"/></svg></button></div>' +
          '</label>' +
          '<div class="form-error" role="alert" hidden><svg class="icon"><use href="#i-alert"/></svg><span></span></div>' +
          '<button class="btn primary auth-submit" type="submit">Sign in</button>' +
          '<div class="demo-card"><div><strong>Demo Pro account</strong><span>demo@jsonstudio.app · demo1234</span></div>' +
            '<button type="button" class="btn small" data-fill-demo>Use demo</button></div>' +
          '<p class="auth-switch">New to JSON Studio? <button type="button" data-auth-tab="register">Create a free account</button></p>' +
        '</form>';
    }

    const form = body.querySelector('form');
    const strength = wrap.querySelector('#strength');
    if (strength) {
      const pass = form.querySelector('[name="password"]');
      pass.addEventListener('input', function () { renderStrength(strength, pass.value); });
      renderStrength(strength, '');
    }

    form.addEventListener('submit', function (e) {
      e.preventDefault();
      if (authTab === 'register') submitRegister(wrap, form);
      else submitLogin(wrap, form);
    });
  }

  function field(type, name, label, placeholder, autocomplete) {
    return '<label class="field"><span>' + esc(label) + '</span>' +
      '<input type="' + type + '" name="' + name + '" placeholder="' + esc(placeholder) + '" autocomplete="' + (autocomplete || 'off') + '" required>' +
      '</label>';
  }

  function renderStrength(container, value) {
    let score = 0;
    if (value.length >= 8) score++;
    if (/[a-z]/.test(value) && /[A-Z]/.test(value)) score++;
    if (/\d/.test(value)) score++;
    if (/[^A-Za-z0-9]/.test(value) || value.length >= 14) score++;
    const labels = ['Too short', 'Weak', 'Fair', 'Good', 'Strong'];
    container.dataset.score = String(score);
    for (let i = 0; i < container.children.length; i++) {
      container.children[i].classList.toggle('on', i < score);
    }
    const text = document.getElementById('strengthText');
    if (text) text.textContent = labels[score] + (score < 4 ? ' · add length, numbers and symbols' : ' · looks great');
  }

  async function submitLogin(wrap, form) {
    await ensureDemo();
    clearFieldErrors(form);
    setFormError(wrap, '');
    const email = form.email.value.trim().toLowerCase();
    const password = form.password.value;
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) {
      fieldError(form.email, 'Enter a valid email address');
      form.email.focus();
      return;
    }
    if (!password) { fieldError(form.password, 'Enter your password'); form.password.focus(); return; }

    const btn = form.querySelector('.auth-submit');
    setBusy(btn, true, 'Signing in…');
    try {
      const user = db.users.find(function (u) { return u.email === email; });
      if (!user) throw new Error('No account found for that email. Create a free account instead.');
      const ok = await verifyPassword(user, password);
      if (!ok) throw new Error('Incorrect password. Try again.');
      db.sessionId = user.id;
      saveDb();
      emit();
      closeAccountModals();
      notify('Welcome back, ' + user.name.split(/\s+/)[0], 'success');
      const intent = pendingIntent;
      pendingIntent = null;
      if (intent === 'pricing') setTimeout(function () { openPricing(); }, 120);
    } catch (err) {
      setFormError(wrap, err.message || 'Could not sign in');
      setBusy(btn, false);
      return;
    }
    setBusy(btn, false);
  }

  async function submitRegister(wrap, form) {
    await ensureDemo();
    clearFieldErrors(form);
    setFormError(wrap, '');
    const nameInput = form.elements.name;
    const emailInput = form.elements.email;
    const passInput = form.elements.password;
    const confirmInput = form.elements.confirm;
    const name = nameInput.value.trim();
    const email = emailInput.value.trim().toLowerCase();
    const password = passInput.value;
    const confirm = confirmInput.value;
    const terms = form.elements.terms.checked;

    let bad = false;
    if (name.length < 2) { fieldError(nameInput, 'Tell us your name'); bad = true; }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) { fieldError(emailInput, 'Enter a valid email address'); bad = true; }
    else if (db.users.some(function (u) { return u.email === email; })) {
      fieldError(emailInput, 'An account with this email already exists');
      bad = true;
    }
    if (password.length < 8 || !/[A-Za-z]/.test(password) || !/\d/.test(password)) {
      fieldError(passInput, 'Use 8+ characters with at least one letter and one number');
      bad = true;
    }
    if (confirm !== password) { fieldError(confirmInput, 'Passwords do not match'); bad = true; }
    if (!terms) {
      const row = form.querySelector('.check-row');
      if (row) row.classList.add('invalid');
      bad = true;
    }
    if (bad) return;

    const btn = form.querySelector('.auth-submit');
    setBusy(btn, true, 'Creating account…');
    try {
      const salt = randomHex(16);
      const hashed = await hashPassword(password, salt);
      const user = {
        id: 'usr_' + randomHex(6),
        name: name,
        email: email,
        salt: salt,
        hash: hashed.hash,
        alg: hashed.alg,
        createdAt: Date.now(),
        plan: 'free',
        interval: null,
        planSince: null,
        renewsAt: null,
        accent: 'violet',
        card: null,
        invoices: []
      };
      db.users.push(user);
      db.sessionId = user.id;
      saveDb();
      emit();
      closeAccountModals();
      notify('Account created — welcome to JSON Studio');
      const intent = pendingIntent;
      pendingIntent = null;
      if (intent === 'pricing') setTimeout(function () { openPricing(); }, 140);
    } catch (err) {
      setFormError(wrap, err.message || 'Could not create account');
    } finally {
      setBusy(btn, false);
    }
  }

  function signOut() {
    const user = currentUser();
    if (!user) return;
    db.sessionId = null;
    saveDb();
    menuOpen = false;
    emit();
    notify('Signed out of ' + user.email, 'success');
  }

  /* ------------------------------------------------------------
     Pricing
     ------------------------------------------------------------ */

  function planCardsHTML() {
    const user = currentUser();
    const pro = isPro();
    const price = PRICES[pricingInterval];
    const currentFree = user && !pro;
    const currentPro = pro;

    return '<div class="billing-toggle">' +
        '<button class="' + (pricingInterval === 'monthly' ? 'active' : '') + '" data-price-interval="monthly">Monthly</button>' +
        '<button class="' + (pricingInterval === 'yearly' ? 'active' : '') + '" data-price-interval="yearly">Yearly <span class="save-chip">Save 33%</span></button>' +
      '</div>' +
      '<div class="plan-grid">' +
        '<article class="plan-card free' + (currentFree ? ' current' : '') + '">' +
          '<div class="plan-head"><div><h3>Free</h3><p>For quick everyday checks.</p></div><div class="plan-price"><strong>$0</strong><span>forever</span></div></div>' +
          '<ul class="plan-features">' + FEATURES.free.map(function (f) {
            return '<li><svg class="icon"><use href="#i-check"/></svg>' + esc(f) + '</li>';
          }).join('') + '</ul>' +
          (currentFree
            ? '<button class="btn plan-cta" disabled>Current plan</button>'
            : currentPro
              ? '<button class="btn plan-cta" data-account-act="downgrade">Downgrade to Free</button>'
              : '<button class="btn plan-cta" data-account-act="signup-free">Start free</button>') +
        '</article>' +
        '<article class="plan-card pro' + (currentPro ? ' current' : '') + '">' +
          '<span class="plan-ribbon">Most popular</span>' +
          '<div class="plan-head"><div><h3>Pro <svg class="icon crown"><use href="#i-crown"/></svg></h3><p>For serious JSON work.</p></div>' +
          '<div class="plan-price"><strong>' + price.label + '</strong><span>' + price.suffix + '</span></div></div>' +
          '<ul class="plan-features">' + FEATURES.pro.map(function (f) {
            return '<li><svg class="icon"><use href="#i-check"/></svg>' + esc(f) + '</li>';
          }).join('') + '</ul>' +
          (currentPro
            ? '<button class="btn plan-cta" data-account-act="manage">Manage subscription</button>'
            : '<button class="btn primary plan-cta" data-account-act="checkout" data-interval="' + pricingInterval + '">' +
              '<svg class="icon"><use href="#i-crown"/></svg>Upgrade to Pro · ' + price.label + '</button>') +
        '</article>' +
      '</div>' +
      '<div class="pricing-foot">' +
        '<span><svg class="icon"><use href="#i-lock"/></svg>Demo checkout · no real card is charged</span>' +
        '<span>Cancel any time · data stays local</span>' +
      '</div>';
  }

  function openPricing(reason) {
    pendingIntent = null;
    const user = currentUser();
    const wrap = showModal(
      '<div class="pricing-head">' +
        '<div><span class="eyebrow">Plans</span><h2>Do more with Pro</h2>' +
        '<p class="modal-sub">' + (reason ? esc(reason) + ' is a Pro feature.' : 'Unlock the full studio — queries, extra converters, bigger files and more.') + '</p></div>' +
        '<button class="icon-btn" data-acct-close aria-label="Close"><svg class="icon"><use href="#i-x"/></svg></button>' +
      '</div>' +
      '<div id="pricingBody">' + planCardsHTML() + '</div>' +
      '<p class="pricing-note">' + (user
        ? 'Signed in as ' + esc(user.email) + ' · plan changes apply instantly in this browser.'
        : 'You can browse plans now. Create a free account to upgrade.') + '</p>',
      'pricing-modal'
    );

    wrap.addEventListener('click', function (e) {
      const intervalBtn = e.target.closest('[data-price-interval]');
      if (intervalBtn) {
        pricingInterval = intervalBtn.dataset.priceInterval;
        wrap.querySelector('#pricingBody').innerHTML = planCardsHTML();
        return;
      }
      const cta = e.target.closest('[data-account-act]');
      if (!cta) return;
      e.stopPropagation();
      const act = cta.dataset.accountAct;
      if (act === 'checkout') {
        if (!currentUser()) {
          pendingIntent = 'pricing';
          openAuth('register');
          return;
        }
        openCheckout(cta.dataset.interval || pricingInterval);
      } else if (act === 'signup-free') {
        openAuth('register');
      } else if (act === 'manage') {
        openBilling();
      } else if (act === 'downgrade') {
        openBilling();
      } else if (act === 'terms') {
        e.preventDefault();
        showTerms();
      }
    });
  }

  function showTerms() {
    showModal(
      modalHead('Demo terms', 'A short, plain-language summary.') +
      '<div class="legal-body">' +
        '<h3>1. This is a local demo</h3>' +
        '<p>JSON Studio runs entirely in your browser. Accounts, plans, invoices and payment methods are stored in this browser\'s local storage. Nothing is uploaded to a server.</p>' +
        '<h3>2. Payments</h3>' +
        '<p>The checkout is a simulation. No card is charged. Only the card brand, last four digits and expiry are retained; full card numbers and CVCs are never stored. Do not enter a real card number.</p>' +
        '<h3>3. Your data</h3>' +
        '<p>Clearing site data removes your account, plan and receipts. Export anything you need first.</p>' +
        '<h3>4. Plans</h3>' +
        '<p>Pro features are enforced in the app. Upgrades and cancellations take effect immediately in this demo.</p>' +
      '</div>' +
      '<div class="modal-actions"><button class="btn primary" data-acct-close>Got it</button></div>',
      'terms-modal'
    );
  }

  /* ------------------------------------------------------------
     Checkout
     ------------------------------------------------------------ */

  function detectBrand(number) {
    const n = String(number || '').replace(/\D/g, '');
    if (/^4/.test(n)) return { name: 'Visa', id: 'visa' };
    if (/^(5[1-5]|2[2-7])/.test(n)) return { name: 'Mastercard', id: 'mastercard' };
    if (/^3[47]/.test(n)) return { name: 'Amex', id: 'amex' };
    if (/^(6011|65|64[4-9])/.test(n)) return { name: 'Discover', id: 'discover' };
    return { name: 'Card', id: 'generic' };
  }

  function luhn(number) {
    const n = String(number || '').replace(/\D/g, '');
    if (n.length < 12) return false;
    let sum = 0;
    let double = false;
    for (let i = n.length - 1; i >= 0; i--) {
      let digit = Number(n[i]);
      if (double) {
        digit *= 2;
        if (digit > 9) digit -= 9;
      }
      sum += digit;
      double = !double;
    }
    return sum % 10 === 0;
  }

  function formatCardNumber(raw) {
    let digits = String(raw || '').replace(/\D/g, '').slice(0, 19);
    const brand = detectBrand(digits);
    if (brand.id === 'amex') {
      digits = digits.slice(0, 15);
      const parts = [digits.slice(0, 4), digits.slice(4, 10), digits.slice(10, 15)].filter(Boolean);
      return parts.join(' ');
    }
    return digits.replace(/(\d{4})(?=\d)/g, '$1 ');
  }

  function formatExpiry(raw) {
    let digits = String(raw || '').replace(/\D/g, '').slice(0, 4);
    if (digits.length === 1 && Number(digits) > 1) digits = '0' + digits;
    if (digits.length >= 3) return digits.slice(0, 2) + '/' + digits.slice(2);
    return digits;
  }

  function validExpiry(value) {
    const m = /^(\d{2})\/(\d{2})$/.exec(String(value || '').trim());
    if (!m) return false;
    const month = Number(m[1]);
    const year = 2000 + Number(m[2]);
    if (month < 1 || month > 12) return false;
    const now = new Date();
    const end = new Date(year, month, 1);
    return end > now;
  }

  function openCheckout(interval, options) {
    const user = currentUser();
    if (!user) { openAuth('login', 'pricing'); return; }
    const updateCard = !!(options && options.updateCard);
    const safeInterval = interval === 'yearly' ? 'yearly' : 'monthly';
    const price = PRICES[safeInterval];
    const expiryDate = new Date(Date.now() + (safeInterval === 'yearly' ? 365 : 30) * DAY);
    const title = updateCard ? 'Update payment method' : 'Upgrade to Pro';

    const wrap = showModal(
      modalHead(title, updateCard
        ? 'Replace the card on file for your subscription.'
        : 'You’re one step away from the full studio.') +
      '<div class="checkout-grid">' +
        '<aside class="checkout-summary">' +
          '<span class="eyebrow">' + (updateCard ? 'Payment method' : 'Order summary') + '</span>' +
          (updateCard
            ? '<div class="summary-plan"><div><strong>Pro</strong><span>Keep your current plan</span></div><span class="summary-price">—</span></div>'
            : '<div class="summary-plan"><div><strong>JSON Studio Pro</strong><span>' + (safeInterval === 'yearly' ? 'Yearly' : 'Monthly') + ' billing</span></div><span class="summary-price">' + price.label + '</span></div>' +
              '<div class="summary-row"><span>Subtotal</span><span>' + price.label + '.00</span></div>' +
              '<div class="summary-row"><span>Tax</span><span>$0.00</span></div>' +
              '<div class="summary-row total"><span>Due today</span><span>' + price.label + '.00</span></div>' +
              '<div class="summary-renew">' + (updateCard ? 'Your next renewal is unchanged.' : 'Renews ' + shortDate(expiryDate.getTime()) + ' · cancel any time') + '</div>') +
          '<ul class="summary-perks">' +
            '<li><svg class="icon"><use href="#i-check"/></svg>Query studio &amp; 3 extra converters</li>' +
            '<li><svg class="icon"><use href="#i-check"/></svg>Schema + mock data generators</li>' +
            '<li><svg class="icon"><use href="#i-check"/></svg>25 MB documents &amp; 25-document history</li>' +
          '</ul>' +
        '</aside>' +
        '<form id="payForm" class="checkout-form" novalidate>' +
          '<div class="credit-card" id="cardPreview" data-brand="generic">' +
            '<div class="cc-top"><span class="cc-chip"></span><span class="cc-brand" id="ccBrand">CARD</span></div>' +
            '<div class="cc-number" id="ccPreviewNumber">•••• •••• •••• ••••</div>' +
            '<div class="cc-bottom"><div><span class="cc-label">Card holder</span><strong id="ccPreviewName">YOUR NAME</strong></div>' +
              '<div><span class="cc-label">Expires</span><strong id="ccPreviewExp">MM/YY</strong></div></div>' +
          '</div>' +
          '<label class="field"><span>Card number</span>' +
            '<div class="cc-input-wrap"><input id="ccNumber" name="ccNumber" inputmode="numeric" autocomplete="cc-number" placeholder="4242 4242 4242 4242" maxlength="23">' +
            '<span class="cc-brand-mini" id="ccBrandMini">CARD</span></div>' +
          '</label>' +
          '<div class="field-row">' +
            '<label class="field"><span>Expiry</span><input id="ccExp" name="ccExp" inputmode="numeric" autocomplete="cc-exp" placeholder="MM/YY" maxlength="5"></label>' +
            '<label class="field"><span>CVC</span><input id="ccCvc" name="ccCvc" inputmode="numeric" autocomplete="cc-csc" placeholder="123" maxlength="4"></label>' +
          '</div>' +
          '<label class="field"><span>Name on card</span><input id="ccName" name="ccName" autocomplete="cc-name" placeholder="Ada Lovelace" value="' + esc(updateCard && user.card ? user.card.name : user.name) + '"></label>' +
          '<div class="field-row">' +
            '<label class="field"><span>Country</span><select id="ccCountry" name="ccCountry">' +
              COUNTRIES.map(function (c) {
                return '<option value="' + c[0] + '"' + (updateCard && user.card && user.card.country === c[0] ? ' selected' : '') + '>' + esc(c[1]) + '</option>';
              }).join('') +
            '</select></label>' +
            '<label class="field"><span>ZIP / postal code</span><input id="ccZip" name="ccZip" autocomplete="postal-code" placeholder="94107" value="' + esc(updateCard && user.card ? user.card.zip || '' : '') + '"></label>' +
          '</div>' +
          '<label class="check-row small"><input type="checkbox" id="ccSave" checked><span>Save this card for future payments</span></label>' +
          '<div class="form-error" role="alert" hidden><svg class="icon"><use href="#i-alert"/></svg><span></span></div>' +
          '<button class="btn primary pay-btn" type="submit">' + (updateCard ? 'Save card' : 'Pay ' + price.label + '.00') + '</button>' +
          '<p class="test-hint"><svg class="icon"><use href="#i-shield"/></svg>Demo checkout — no real charge. Use <code>4242 4242 4242 4242</code>; decline test: <code>4000 0000 0000 0002</code>.</p>' +
        '</form>' +
      '</div>',
      'checkout-modal'
    );

    checkoutState = { interval: safeInterval, updateCard: updateCard };

    const numberInput = wrap.querySelector('#ccNumber');
    const expInput = wrap.querySelector('#ccExp');
    const cvcInput = wrap.querySelector('#ccCvc');
    const nameInput = wrap.querySelector('#ccName');
    const preview = wrap.querySelector('#cardPreview');

    function paintPreview() {
      const digits = numberInput.value.replace(/\D/g, '');
      const brand = detectBrand(digits);
      preview.dataset.brand = brand.id;
      wrap.querySelector('#ccBrand').textContent = brand.name.toUpperCase();
      wrap.querySelector('#ccBrandMini').textContent = brand.name.toUpperCase();
      const last4 = digits.slice(-4);
      wrap.querySelector('#ccPreviewNumber').textContent = digits
        ? '•••• •••• •••• ' + last4.padStart(4, '•')
        : '•••• •••• •••• ••••';
      wrap.querySelector('#ccPreviewName').textContent = (nameInput.value || 'YOUR NAME').toUpperCase().slice(0, 24);
      wrap.querySelector('#ccPreviewExp').textContent = expInput.value || 'MM/YY';
    }

    numberInput.addEventListener('input', function () {
      const pos = numberInput.selectionStart;
      const before = numberInput.value.slice(0, pos).replace(/\D/g, '').length;
      numberInput.value = formatCardNumber(numberInput.value);
      let seen = 0;
      let newPos = numberInput.value.length;
      for (let i = 0; i < numberInput.value.length; i++) {
        if (/\d/.test(numberInput.value[i])) seen++;
        if (seen === before) { newPos = i + 1; break; }
      }
      try { numberInput.setSelectionRange(newPos, newPos); } catch (e) { /* ignore */ }
      fieldError(numberInput, '');
      paintPreview();
    });
    expInput.addEventListener('input', function () {
      expInput.value = formatExpiry(expInput.value);
      fieldError(expInput, '');
      paintPreview();
    });
    cvcInput.addEventListener('input', function () {
      cvcInput.value = cvcInput.value.replace(/\D/g, '').slice(0, 4);
      fieldError(cvcInput, '');
    });
    nameInput.addEventListener('input', function () {
      fieldError(nameInput, '');
      paintPreview();
    });
    wrap.querySelector('#ccZip').addEventListener('input', function (e) { fieldError(e.target, ''); });
    paintPreview();

    const form = wrap.querySelector('#payForm');
    form.addEventListener('submit', async function (e) {
      e.preventDefault();
      clearFieldErrors(form);
      setFormError(wrap, '');

      const digits = numberInput.value.replace(/\D/g, '');
      const brand = detectBrand(digits);
      const cvcLength = brand.id === 'amex' ? 4 : 3;
      let bad = false;

      if (!luhn(digits)) { fieldError(numberInput, 'Enter a valid card number'); bad = true; }
      if (!validExpiry(expInput.value)) { fieldError(expInput, 'Use a future MM/YY date'); bad = true; }
      if (!new RegExp('^\\d{' + cvcLength + '}$').test(cvcInput.value)) {
        fieldError(cvcInput, brand.id === 'amex' ? '4 digits' : '3 digits');
        bad = true;
      }
      if (nameInput.value.trim().length < 2) { fieldError(nameInput, 'Add the name on the card'); bad = true; }
      const zip = wrap.querySelector('#ccZip').value.trim();
      if (!/^[A-Za-z0-9][A-Za-z0-9 -]{2,9}$/.test(zip)) { fieldError(wrap.querySelector('#ccZip'), 'Add a valid postal code'); bad = true; }
      if (bad) return;

      const payBtn = form.querySelector('.pay-btn');
      setBusy(payBtn, true, updateCard ? 'Saving…' : 'Processing…');
      await new Promise(function (resolve) { setTimeout(resolve, 1500); });

      if (digits === '4000000000000002' || /0002$/.test(digits) && /^4000/.test(digits)) {
        setBusy(payBtn, false);
        setFormError(wrap, 'Card declined (demo test card). Try 4242 4242 4242 4242.');
        return;
      }

      const live = currentUser();
      if (!live) {
        setBusy(payBtn, false);
        setFormError(wrap, 'Your session expired — sign in again.');
        return;
      }

      const card = {
        brand: brand.name,
        last4: digits.slice(-4),
        exp: expInput.value,
        name: nameInput.value.trim(),
        zip: zip,
        country: wrap.querySelector('#ccCountry').value
      };

      if (updateCard) {
        live.card = card;
        saveDb();
        emit();
        closeAccountModals();
        notify('Payment method updated');
        setTimeout(function () { openBilling(); }, 120);
        return;
      }

      live.plan = 'pro';
      live.interval = safeInterval;
      live.planSince = Date.now();
      live.renewsAt = Date.now() + (safeInterval === 'yearly' ? 365 : 30) * DAY;
      live.card = card;
      const invoice = {
        id: 'INV-' + new Date().getUTCFullYear() + '-' + String((live.invoices || []).length + 1).padStart(4, '0'),
        date: Date.now(),
        amount: price.cents,
        plan: 'Pro',
        interval: safeInterval,
        last4: card.last4,
        status: 'paid'
      };
      live.invoices = [invoice].concat(live.invoices || []);
      saveDb();
      emit();
      showCheckoutSuccess(invoice, safeInterval);
    });
  }

  function showCheckoutSuccess(invoice, interval) {
    const wrap = showModal(
      '<div class="success-panel">' +
        '<div class="success-badge"><svg class="icon"><use href="#i-check"/></svg></div>' +
        '<span class="eyebrow">Payment complete</span>' +
        '<h2>You’re on Pro</h2>' +
        '<p>Every Pro feature is unlocked right now. Your receipt is saved under Billing &amp; receipts.</p>' +
        '<div class="success-receipt">' +
          '<div><span>Invoice</span><strong>' + esc(invoice.id) + '</strong></div>' +
          '<div><span>Amount</span><strong>' + money(invoice.amount) + ' ' + (interval === 'yearly' ? '/ year' : '/ month') + '</strong></div>' +
          '<div><span>Card</span><strong>•••• ' + esc(invoice.last4) + '</strong></div>' +
        '</div>' +
        '<ul class="success-list">' +
          '<li><svg class="icon"><use href="#i-check"/></svg>Query studio + CSV, Python, JS &amp; Schema</li>' +
          '<li><svg class="icon"><use href="#i-check"/></svg>25 MB files, 25-document history, accent themes</li>' +
        '</ul>' +
        '<div class="success-actions">' +
          '<button class="btn primary" data-acct-close><svg class="icon"><use href="#i-sparkles"/></svg>Start using Pro</button>' +
          '<button class="btn" data-account-act="receipt" data-invoice="' + esc(invoice.id) + '"><svg class="icon"><use href="#i-download"/></svg>Receipt</button>' +
        '</div>' +
        '<p class="demo-note">Demo checkout — no real payment was processed.</p>' +
      '</div>',
      'success-modal'
    );
    wrap.addEventListener('click', function (e) {
      const btn = e.target.closest('[data-account-act="receipt"]');
      if (btn) downloadReceipt(btn.dataset.invoice);
    });
    notify('Welcome to Pro — everything is unlocked');
  }

  /* ------------------------------------------------------------
     Billing
     ------------------------------------------------------------ */

  function invoiceRows(user) {
    const invoices = user.invoices || [];
    if (!invoices.length) {
      return '<div class="billing-empty">No invoices yet. Your first receipt will appear after upgrading.</div>';
    }
    return '<div class="invoice-table"><div class="invoice-head"><span>Invoice</span><span>Date</span><span>Amount</span><span>Status</span><span></span></div>' +
      invoices.map(function (inv) {
        return '<div class="invoice-row">' +
          '<span class="inv-id">' + esc(inv.id) + '</span>' +
          '<span>' + shortDate(inv.date) + '</span>' +
          '<span>' + money(inv.amount) + '</span>' +
          '<span><span class="paid-pill"><svg class="icon"><use href="#i-check"/></svg>Paid</span></span>' +
          '<span class="inv-actions"><button class="mini-btn" data-account-act="receipt" data-invoice="' + esc(inv.id) + '" title="Download receipt"><svg class="icon"><use href="#i-download"/></svg></button></span>' +
        '</div>';
      }).join('') + '</div>';
  }

  function openBilling() {
    const user = currentUser();
    if (!user) { openAuth('login'); return; }
    const pro = user.plan === 'pro';
    const card = user.card;

    const wrap = showModal(
      modalHead('Billing & receipts', 'Manage your plan, payment method and receipts.') +
      '<div class="billing-body">' +
        '<div class="billing-top">' +
          '<div class="billing-plan ' + (pro ? 'pro' : '') + '">' +
            '<div><span class="eyebrow">Current plan</span><h3>' + (pro ? 'Pro' : 'Free') + '</h3>' +
            '<p>' + (pro
              ? (user.interval === 'yearly' ? 'Yearly billing' : 'Monthly billing') + ' · renews ' + shortDate(user.renewsAt)
              : 'Upgrade to unlock queries, converters and more.') + '</p></div>' +
            (pro
              ? '<span class="plan-badge pro">PRO</span>'
              : '<span class="plan-badge free">FREE</span>') +
          '</div>' +
          '<div class="billing-actions">' +
            (pro
              ? '<button class="btn small" data-billing-act="update-card"><svg class="icon"><use href="#i-card"/></svg>Update card</button>' +
                (user.interval === 'monthly' ? '<button class="btn small primary" data-account-act="upgrade-yearly"><svg class="icon"><use href="#i-sparkles"/></svg>Switch to yearly</button>' : '')
              : '<button class="btn small primary" data-account-act="upgrade"><svg class="icon"><use href="#i-crown"/></svg>Upgrade to Pro</button>') +
          '</div>' +
        '</div>' +
        (pro && card
          ? '<div class="payment-method"><div class="pm-card"><span class="pm-brand">' + esc(card.brand) + '</span>' +
              '<span class="pm-number">•••• •••• •••• ' + esc(card.last4) + '</span>' +
              '<span class="pm-exp">Exp ' + esc(card.exp) + '</span></div>' +
              '<div class="pm-meta"><strong>' + esc(card.name) + '</strong><span>' + esc(card.brand) + ' ending in ' + esc(card.last4) + ' · ' + esc(card.exp) + '</span></div>' +
              '<button class="btn small" data-billing-act="update-card">Edit</button></div>'
          : '<div class="billing-empty">No payment method on file. Add one when you upgrade.</div>') +
        '<div class="billing-section"><div class="billing-section-head"><span>Invoices</span><span class="count">' + (user.invoices || []).length + '</span></div>' +
          invoiceRows(user) + '</div>' +
        (pro
          ? '<div class="billing-danger"><div><strong>Cancel subscription</strong><span>Keep Pro until the end of this demo billing period, then return to Free.</span></div>' +
              '<button class="btn small danger" data-billing-act="cancel">Cancel Pro</button>' +
              '<div class="cancel-confirm" hidden><p>Cancel Pro now? Pro features will lock immediately in this demo.</p>' +
                '<div class="cancel-actions"><button class="btn small" data-billing-act="cancel-abort">Keep Pro</button>' +
                '<button class="btn small danger" data-billing-act="cancel-confirm">Yes, cancel</button></div></div></div>'
          : '') +
        '<p class="demo-note"><svg class="icon"><use href="#i-shield"/></svg>Local demo billing — no card is charged and only masked card details are stored.</p>' +
      '</div>',
      'billing-modal'
    );

    wrap.addEventListener('click', function (e) {
      const btn = e.target.closest('[data-billing-act], [data-account-act]');
      if (!btn) return;
      e.stopPropagation();
      const billingAct = btn.dataset.billingAct;
      const accountAct = btn.dataset.accountAct;

      if (billingAct === 'update-card') {
        openCheckout(user.interval || 'monthly', { updateCard: true });
      } else if (billingAct === 'cancel') {
        const box = wrap.querySelector('.cancel-confirm');
        if (box) box.hidden = false;
      } else if (billingAct === 'cancel-abort') {
        const box = wrap.querySelector('.cancel-confirm');
        if (box) box.hidden = true;
      } else if (billingAct === 'cancel-confirm') {
        const live = currentUser();
        if (!live) return;
        live.plan = 'free';
        live.interval = null;
        live.renewsAt = null;
        saveDb();
        emit();
        closeAccountModals();
        notify('Subscription cancelled — you are on the Free plan', 'warn');
        setTimeout(function () { openBilling(); }, 140);
      } else if (accountAct === 'upgrade') {
        openPricing();
      } else if (accountAct === 'upgrade-yearly') {
        openCheckout('yearly');
      } else if (accountAct === 'receipt') {
        downloadReceipt(btn.dataset.invoice);
      }
    });
  }

  function downloadReceipt(invoiceId) {
    const user = currentUser();
    if (!user) return;
    const invoice = (user.invoices || []).find(function (inv) { return inv.id === invoiceId; });
    if (!invoice) { notify('Receipt not found', 'error'); return; }
    const lines = [
      'JSON STUDIO — PAYMENT RECEIPT',
      '================================',
      '',
      'Invoice:      ' + invoice.id,
      'Date:         ' + shortDate(invoice.date),
      'Account:      ' + user.name + ' <' + user.email + '>',
      'Plan:         ' + invoice.plan + ' (' + invoice.interval + ')',
      'Card:         •••• ' + invoice.last4,
      'Amount:       ' + money(invoice.amount) + ' USD',
      'Status:       ' + invoice.status.toUpperCase(),
      '',
      'This is a demo receipt. No real payment was processed.',
      'Generated locally by JSON Studio.'
    ];
    const blob = new Blob([lines.join('\n')], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'json-studio-' + invoice.id.toLowerCase() + '.txt';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 1200);
    notify('Receipt downloaded');
  }

  /* ------------------------------------------------------------
     Profile
     ------------------------------------------------------------ */

  function openProfile() {
    const user = currentUser();
    if (!user) { openAuth('login'); return; }
    const wrap = showModal(
      modalHead('Account settings', 'Update your profile or change your local password.') +
      '<div class="profile-body">' +
        '<div class="profile-head"><span class="avatar lg ' + (isPro() ? 'pro' : '') + '">' + esc(initials(user.name)) + '</span>' +
          '<div><h3>' + esc(user.name) + '</h3><p>' + esc(user.email) + ' · member since ' + shortDate(user.createdAt) + '</p></div>' +
          '<span class="plan-badge ' + (isPro() ? 'pro' : 'free') + '">' + (isPro() ? 'PRO' : 'FREE') + '</span></div>' +
        '<form id="profileForm" class="profile-form">' +
          '<div class="settings-section"><h4>Profile</h4>' +
            '<label class="field"><span>Full name</span><input name="name" value="' + esc(user.name) + '" autocomplete="name"></label>' +
            '<label class="field"><span>Email</span><input name="email" value="' + esc(user.email) + '" autocomplete="email"></label>' +
            '<div class="inline-actions"><button class="btn small primary" type="submit">Save profile</button></div>' +
          '</div>' +
        '</form>' +
        '<form id="passwordForm" class="profile-form">' +
          '<div class="settings-section"><h4>Change password</h4>' +
            '<label class="field"><span>Current password</span><input type="password" name="current" autocomplete="current-password"></label>' +
            '<label class="field"><span>New password</span><input type="password" name="next" autocomplete="new-password" placeholder="At least 8 characters"></label>' +
            '<label class="field"><span>Confirm new password</span><input type="password" name="confirm" autocomplete="new-password"></label>' +
            '<div class="form-error" role="alert" hidden><svg class="icon"><use href="#i-alert"/></svg><span></span></div>' +
            '<div class="inline-actions"><button class="btn small" type="submit">Update password</button></div>' +
          '</div>' +
        '</form>' +
        '<div class="settings-section plan-settings"><h4>Plan</h4>' +
          '<div class="settings-plan-row"><div><strong>' + (isPro() ? 'Pro' : 'Free') + '</strong><span>' +
            (isPro() ? (user.interval === 'yearly' ? 'Yearly' : 'Monthly') + ' · renews ' + shortDate(user.renewsAt) : 'Upgrade to unlock Pro features') +
          '</span></div>' +
          '<button class="btn small' + (isPro() ? '' : ' primary') + '" data-account-act="' + (isPro() ? 'manage' : 'upgrade') + '">' +
            (isPro() ? 'Manage billing' : 'Upgrade') + '</button></div>' +
        '</div>' +
        '<button class="btn small danger-ghost" data-account-act="signout">Sign out</button>' +
      '</div>',
      'profile-modal'
    );

    const profileForm = wrap.querySelector('#profileForm');
    profileForm.addEventListener('submit', function (e) {
      e.preventDefault();
      const nameInput = profileForm.elements.name;
      const emailInput = profileForm.elements.email;
      const name = nameInput.value.trim();
      const email = emailInput.value.trim().toLowerCase();
      let bad = false;
      if (name.length < 2) { fieldError(nameInput, 'Enter your name'); bad = true; }
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) { fieldError(emailInput, 'Enter a valid email'); bad = true; }
      else if (email !== user.email && db.users.some(function (u) { return u.email === email; })) {
        fieldError(emailInput, 'That email is already in use');
        bad = true;
      }
      if (bad) return;
      user.name = name;
      user.email = email;
      saveDb();
      emit();
      notify('Profile updated');
      openProfile();
    });

    const passwordForm = wrap.querySelector('#passwordForm');
    passwordForm.addEventListener('submit', async function (e) {
      e.preventDefault();
      clearFieldErrors(passwordForm);
      setFormError(wrap, '');
      const current = passwordForm.current.value;
      const next = passwordForm.next.value;
      const confirm = passwordForm.confirm.value;
      let bad = false;
      if (!current) { fieldError(passwordForm.current, 'Enter your current password'); bad = true; }
      if (next.length < 8 || !/[A-Za-z]/.test(next) || !/\d/.test(next)) {
        fieldError(passwordForm.next, 'Use 8+ characters with a letter and a number');
        bad = true;
      }
      if (next !== confirm) { fieldError(passwordForm.confirm, 'Passwords do not match'); bad = true; }
      if (bad) return;
      const btn = passwordForm.querySelector('button[type="submit"]');
      setBusy(btn, true, 'Updating…');
      try {
        if (!(await verifyPassword(user, current))) throw new Error('Current password is incorrect');
        const salt = randomHex(16);
        const hashed = await hashPassword(next, salt);
        user.salt = salt;
        user.hash = hashed.hash;
        user.alg = hashed.alg;
        saveDb();
        notify('Password updated');
        passwordForm.reset();
      } catch (err) {
        setFormError(wrap, err.message || 'Could not update password');
      } finally {
        setBusy(btn, false);
      }
    });

    wrap.addEventListener('click', function (e) {
      const act = e.target.closest('[data-account-act]');
      if (!act) return;
      e.stopPropagation();
      if (act.dataset.accountAct === 'signout') { closeAccountModals(); signOut(); }
      else if (act.dataset.accountAct === 'upgrade') openPricing();
      else if (act.dataset.accountAct === 'manage') { closeAccountModals(); openBilling(); }
    });
  }

  /* ------------------------------------------------------------
     Public controller
     ------------------------------------------------------------ */

  function isPro() {
    const user = currentUser();
    return !!user && user.plan === 'pro';
  }

  function setAccent(id) {
    const user = currentUser();
    if (!user) { openAuth('login'); return false; }
    if (user.plan !== 'pro') {
      openPricing('Custom accent themes');
      return false;
    }
    if (!ACCENTS.some(function (a) { return a.id === id; })) return false;
    user.accent = id;
    saveDb();
    applyAccent();
    renderAccount();
    notify('Accent updated');
    return true;
  }

  function handleAccountClick(e) {
    const accentBtn = e.target.closest('[data-account-accent]');
    if (accentBtn && accentBtn.closest('#accountSlot')) {
      setAccent(accentBtn.dataset.accountAccent);
      return;
    }

    const trigger = e.target.closest('[data-account-act]');
    if (!trigger) {
      if (!e.target.closest('#accountSlot')) {
        if (menuOpen) toggleMenu(false);
      }
      return;
    }

    const act = trigger.dataset.accountAct;
    if (trigger.closest('.account-backdrop') && act !== 'terms') return;
    if (act === 'signin') openAuth('login');
    else if (act === 'menu') { toggleMenu(); return; }
    else if (act === 'upgrade') openPricing();
    else if (act === 'manage') { toggleMenu(false); openBilling(); }
    else if (act === 'billing') { toggleMenu(false); openBilling(); }
    else if (act === 'recent') {
      toggleMenu(false);
      document.dispatchEvent(new CustomEvent('jsonstudio:open-recent'));
    } else if (act === 'profile') { toggleMenu(false); openProfile(); }
    else if (act === 'signout') { toggleMenu(false); signOut(); }
    else if (act === 'checkout') {
      const interval = trigger.dataset.interval || pricingInterval;
      if (!currentUser()) { pendingIntent = 'pricing'; openAuth('register'); }
      else openCheckout(interval);
    } else if (act === 'receipt') {
      downloadReceipt(trigger.dataset.invoice);
    } else if (act === 'terms') {
      e.preventDefault();
      showTerms();
    }

    if (trigger.closest('.account-menu')) toggleMenu(false);
  }

  document.addEventListener('click', handleAccountClick);

  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Escape') return;
    if (activeModal) {
      closeAccountModals();
      e.stopPropagation();
    } else if (menuOpen) {
      toggleMenu(false);
    }
  });

  // Apply saved/accent theme as soon as the account module boots.
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { applyAccent(); renderAccount(); });
  } else {
    applyAccent();
    renderAccount();
  }

  global.JSONStudioAccount = {
    isPro: isPro,
    isLoggedIn: function () { return !!currentUser(); },
    getUser: function () { return publicUser(currentUser()); },
    onChange: function (fn) {
      if (typeof fn !== 'function') return function () {};
      listeners.push(fn);
      return function () { listeners = listeners.filter(function (item) { return item !== fn; }); };
    },
    setNotify: function (fn) { if (typeof fn === 'function') notifyFn = fn; notify = notifyFn; },
    notify: function (message, kind) { notifyFn(message, kind); },
    requirePro: function (reason) {
      if (isPro()) return true;
      openPricing(reason);
      return false;
    },
    openAuth: openAuth,
    openPricing: openPricing,
    openBilling: openBilling,
    openProfile: openProfile,
    maxDocBytes: function () { return isPro() ? PRO_MAX_BYTES : FREE_MAX_BYTES; },
    historyLimit: function () { return isPro() ? PRO_HISTORY : FREE_HISTORY; },
    maxHistoryStored: function () { return MAX_HISTORY_STORED; },
    maxDocBytesFor: function (plan) { return plan === 'pro' ? PRO_MAX_BYTES : FREE_MAX_BYTES; },
    historyLimitFor: function (plan) { return plan === 'pro' ? PRO_HISTORY : FREE_HISTORY; },
    accents: ACCENTS.slice(),
    getAccent: function () {
      const user = currentUser();
      return user && user.plan === 'pro' ? user.accent || 'violet' : 'violet';
    },
    setAccent: setAccent,
    refresh: emit
  };

  // `notify` is used before setNotify is called.
  function notify(message, kind) { notifyFn(message, kind); }
})(typeof window !== 'undefined' ? window : globalThis);
