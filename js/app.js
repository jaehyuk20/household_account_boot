/*
 * 모아봐요 가계부 — 화면 동작
 * 시작(boot) → 로그인(auth) → 가계부(app) 세 화면을 오갑니다.
 * 가계부는 휴대폰에서는 한 줄로 쌓이고, 넓은 화면(PC)에서는 요약·내역·달력·원그래프를 한 화면에 펼칩니다.
 */
(function () {
  'use strict';

  const Store = window.Store;
  const S = window.Sprites;
  const M = window.Motion;

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  const fmt = (n) => n.toLocaleString('ko-KR');
  const MINUS = '−';
  const WEEK = ['일요일', '월요일', '화요일', '수요일', '목요일', '금요일', '토요일'];
  const TYPE_NAME = { income: '수입', expense: '지출' };
  const KINDS = ['expense', 'income'];
  const pad2 = (n) => String(n).padStart(2, '0');

  const today = new Date();
  const state = {
    screen: 'boot',
    cloud: null,
    user: null,
    pendingName: '',
    y: today.getFullYear(),
    m: today.getMonth() + 1,
    tab: 'list',
    statKind: 'expense',
    loaded: new Set(), // 데이터를 받아 처음 그린 달
    renderedSig: '',
    busyUntil: 0,
    nav: Promise.resolve(),
    sheet: { open: false, mode: 'add', id: null, type: 'expense', amount: 0, cat: null, opener: null, origin: null, lastType: 'expense', from: null },
    talk: { lines: [], idx: 0, empty: null }, // empty: 마지막으로 말할 때 이 달이 비어 있었는지
    authMode: 'login',
    authLine: 0,
    listFull: false, // 내역을 화면 가득 펼쳤는지
    calFocus: null, // 달력에서 키보드 초점이 머무는 날짜
    layoutChoice: null, // 'compact'면 넓은 화면에서도 휴대폰처럼
    otherOpen: { expense: null, income: null }, // 원그래프 '그 외' 펼침 (null이면 화면 배치에 따라)
    totalsErrShown: false,
  };
  let odometer = null;
  let prevSummary = { income: 0, expense: 0 };
  let prevCurrent = null;
  let wide = false; // 넓은 화면 배치인지

  /* 받침에 따라 조사 고르기 (예: 식비예요 / 교육이에요) */
  function josa(word, withFinal, withoutFinal) {
    const code = word.charCodeAt(word.length - 1) - 0xac00;
    if (code < 0 || code > 11171) return withoutFinal;
    return code % 28 ? withFinal : withoutFinal;
  }
  const signed = (type, n) => (type === 'income' ? '+' : MINUS) + fmt(n);
  const won = (n) => `${n < 0 ? MINUS : ''}${fmt(Math.abs(n))}원`;
  const spokenWon = (n) => `${n < 0 ? '마이너스 ' : ''}${fmt(Math.abs(n))}원`;
  const isCurrentMonth = () => state.y === today.getFullYear() && state.m === today.getMonth() + 1;
  const monthIndex = (y, m) => y * 12 + m;
  const busy = (ms) => {
    state.busyUntil = Math.max(state.busyUntil, Date.now() + ms);
  };
  const shake = (el) => {
    el.classList.remove('shake');
    void el.offsetWidth;
    el.classList.add('shake');
  };
  const flash = (el, cls = 'flash', ms = 1900) => {
    el.classList.remove(cls);
    void el.offsetWidth;
    el.classList.add(cls);
    clearTimeout(el._flash);
    el._flash = setTimeout(() => el.classList.remove(cls), ms);
  };
  const listVisible = () => wide || state.listFull || state.tab === 'list';
  const statsVisible = () => wide || (!state.listFull && state.tab === 'stats');
  const addButton = () => (wide || state.listFull ? $('#list-add') : $('#fab'));

  /* ───────── 정적 스프라이트 채우기 ───────── */
  function setSprite(img, name, scale = 2) {
    const { w, h } = S.size(name);
    img.src = S.url(name);
    img.width = w * scale;
    img.height = h * scale;
  }
  function paintSprites(root = document) {
    for (const img of $$('img[data-sprite]', root)) {
      setSprite(img, img.dataset.sprite, +(img.dataset.scale || 2));
      img.classList.add('px-img');
      img.draggable = false;
    }
    const toriSheet = `url("${S.sheet('tori')}")`;
    $('#tori').style.setProperty('--img', toriSheet);
    $('#auth-tori').style.setProperty('--img', toriSheet);
  }

  /* ───────── 테마 ───────── */
  const mqDark = window.matchMedia('(prefers-color-scheme: dark)');
  function currentTheme() {
    const t = document.documentElement.dataset.theme;
    if (t === 'dark' || t === 'light') return t;
    return mqDark.matches ? 'dark' : 'light';
  }
  function syncTheme() {
    const dark = currentTheme() === 'dark';
    const btn = $('#theme-btn');
    btn.setAttribute('aria-label', dark ? '낮 풍경으로 바꾸기' : '밤 풍경으로 바꾸기');
    btn.querySelector('img').src = S.url(dark ? 'sun' : 'moon');
    const meta = $('meta[name="theme-color"]');
    if (meta) meta.content = dark ? '#10173a' : '#8fd8f7';
    M.Ambient.start(today.getMonth() + 1, dark);
    KINDS.forEach(drawPie); // 원그래프 색은 테마마다 다릅니다
  }
  function toggleTheme() {
    const next = currentTheme() === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    try {
      localStorage.setItem('moa-theme', next);
    } catch {
      /* 저장할 수 없어도 화면 전환은 됩니다 */
    }
    M.animate($('#theme-btn img'), [{ transform: 'rotate(-180deg) scale(.4)', opacity: 0 }, { transform: 'none', opacity: 1 }], {
      duration: M.SPRING.duration,
      easing: M.SPRING.easing,
    });
  }

  /* ───────── 화면 배치: 넓은 화면(PC)이면 한 화면 대시보드 ─────────
   * 창 너비가 1200px 이상이면 저절로 넓게 펼치고, 위쪽 버튼으로 휴대폰 배치로 되돌릴 수 있습니다. */
  const mqWide = window.matchMedia('(min-width: 1200px)');
  function readLayoutChoice() {
    try {
      return localStorage.getItem('moa-layout');
    } catch {
      return null;
    }
  }
  function applyLayout() {
    const can = mqWide.matches;
    const next = can && state.layoutChoice !== 'compact';
    const btn = $('#layout-btn');
    btn.hidden = !can || state.screen !== 'app';
    btn.setAttribute('aria-label', next ? '좁게 보기: 휴대폰처럼 한 줄로 보기' : '넓게 보기: 한 화면에 모두 보기');
    btn.title = next ? '좁게 보기' : '넓게 보기';
    setSprite(btn.querySelector('img'), next ? 'viewPhone' : 'viewWide', 2);
    if (next === wide) return false;
    wide = next;
    document.documentElement.classList.toggle('layout-wide', wide);
    // 넓은 화면에서는 달 넘기기를 맨 위 가운데로 올립니다
    const bar = $('.month-bar');
    if (wide) $('#top-month').appendChild(bar);
    else $('.hero').prepend(bar);
    paintTabs();
    paintStatKind();
    paintEmptyHint();
    if (state.screen === 'app') {
      renderStats({ animate: false });
      updateFades();
    }
    return true;
  }
  function toggleLayout() {
    const goWide = !wide;
    state.layoutChoice = goWide ? null : 'compact';
    try {
      if (state.layoutChoice) localStorage.setItem('moa-layout', state.layoutChoice);
      else localStorage.removeItem('moa-layout');
    } catch {
      /* 저장할 수 없어도 지금 화면은 바뀝니다 */
    }
    const run = () => {
      applyLayout();
      window.scrollTo(0, 0);
    };
    if (document.startViewTransition && !M.reduced()) {
      const root = document.documentElement;
      root.classList.add('vt-layout');
      const t = document.startViewTransition(run);
      t.finished.finally(() => root.classList.remove('vt-layout'));
    } else {
      run();
      if (goWide) rise($$('#app > .hero, #app > .talk, #panel-list, #cal-card, #pie-card'), 0);
    }
    // 화면 전환(View Transition)은 한 박자 늦게 바뀌므로 미리 정한 goWide로 알립니다
    toast(goWide ? '한 화면에 모두 펼쳐 볼게요.' : '휴대폰처럼 한 줄로 볼게요. 위의 버튼으로 다시 넓게 볼 수 있어요.', {
      icon: goWide ? 'viewWide' : 'viewPhone',
      duration: 2600,
    });
  }

  /* ───────── 화면 전환 ───────── */
  function setScreen(name) {
    state.screen = name;
    document.documentElement.dataset.screen = name;
    $('#boot').hidden = name !== 'boot';
    $('#auth').hidden = name !== 'auth';
    $('#app').hidden = name !== 'app';
    $('.fab-wrap').hidden = name !== 'app';
    $('#account').hidden = name !== 'app';
    $('#layout-btn').hidden = name !== 'app' || !mqWide.matches;
    if (name !== 'app') toggleAccountMenu(false);
  }

  /* 나뭇잎 동그라미가 화면을 덮었다가 걷히면서 다음 화면이 나옵니다 */
  async function wipe(swap, origin) {
    const el = $('#wipe');
    if (M.reduced()) {
      swap();
      return;
    }
    let cx = innerWidth / 2;
    let cy = innerHeight / 2;
    if (origin) {
      const r = origin.getBoundingClientRect();
      cx = r.left + r.width / 2;
      cy = r.top + r.height / 2;
    }
    const cover = (x, y) => Math.hypot(Math.max(x, innerWidth - x), Math.max(y, innerHeight - y)) + 4;
    el.hidden = false;
    const close = el.animate(
      [{ clipPath: `circle(0px at ${cx}px ${cy}px)` }, { clipPath: `circle(${cover(cx, cy)}px at ${cx}px ${cy}px)` }],
      { duration: 460, easing: 'cubic-bezier(.65,0,.35,1)', fill: 'forwards' }
    );
    M.animate($('img', el), [{ transform: 'scale(0) rotate(-120deg)' }, { transform: 'none' }], {
      duration: M.SPRING.duration,
      easing: M.SPRING.easing,
      delay: 160,
      fill: 'backwards',
    });
    await close.finished.catch(() => {});
    swap();
    await new Promise((r) => setTimeout(r, 160));
    const mx = innerWidth / 2;
    const my = innerHeight / 2;
    const open = el.animate(
      [{ clipPath: `circle(${cover(mx, my)}px at ${mx}px ${my}px)` }, { clipPath: `circle(0px at ${mx}px ${my}px)` }],
      { duration: 520, easing: 'cubic-bezier(.65,0,.35,1)', fill: 'forwards' }
    );
    await open.finished.catch(() => {});
    el.hidden = true;
    close.cancel();
    open.cancel();
  }

  /* 화면 이동은 순서대로 하나씩 처리합니다 */
  function go(name, prepare, origin) {
    state.nav = state.nav.then(async () => {
      const swap = () => {
        prepare();
        setScreen(name);
        window.scrollTo(0, 0);
      };
      if (state.screen === 'boot') swap();
      else await wipe(swap, origin);
    });
    return state.nav;
  }

  /* ───────── 달 표시 ───────── */
  function monthLabelHTML() {
    return `<span><span class="yr">${state.y}년</span>${state.m}월</span>`;
  }
  function renderMonthLabel(dir = 0) {
    const el = $('#month-title');
    if (!dir || M.reduced() || !el.firstElementChild) {
      el.innerHTML = monthLabelHTML();
      return;
    }
    // 빠르게 여러 번 넘길 때 남아 있는 이전 글자는 바로 치웁니다
    const prevs = Array.from(el.children);
    prevs.slice(0, -1).forEach((n) => n.remove());
    const old = prevs[prevs.length - 1];
    const tmp = document.createElement('div');
    tmp.innerHTML = monthLabelHTML();
    const neu = tmp.firstElementChild;
    old.style.position = 'absolute';
    old.style.inset = '0';
    el.appendChild(neu);
    M.animate(old, [{ transform: 'none', opacity: 1 }, { transform: `translateY(${dir * -100}%)`, opacity: 0 }], {
      duration: 260,
      easing: M.EASE_IN,
      fill: 'forwards',
    }).finished.then(() => old.remove(), () => old.remove());
    M.animate(neu, [{ transform: `translateY(${dir * 100}%)`, opacity: 0 }, { transform: 'none', opacity: 1 }], {
      duration: M.SPRING.duration,
      easing: M.SPRING.easing,
    });
  }

  /* ───────── 요약 ───────── */
  function renderSummary({ animate = true, delay = 0 } = {}) {
    const ready = Store.ready(state.y, state.m);
    $('.hero').classList.toggle('is-loading', !ready);
    $('#balance-label').textContent = isCurrentMonth() ? '이번 달 남은 돈' : `${state.m}월 남은 돈`;
    paintCurrent();
    if (!ready) {
      $('#meter-note').textContent = '기록을 불러오는 중…';
      return;
    }
    const s = Store.summary(state.y, state.m);
    const bal = $('#balance');
    bal.classList.toggle('is-neg', s.balance < 0);
    bal.querySelector('.sign').textContent = s.balance < 0 ? MINUS : s.balance > 0 ? '+' : '';
    bal.classList.toggle('long', fmt(Math.abs(s.balance)).length > 10);
    odometer.set(s.balance, { instant: !animate, delay });
    $('#balance-sr').textContent = `${s.balance < 0 ? '마이너스 ' : ''}${fmt(Math.abs(s.balance))}원`;

    const inFmt = (n) => (n ? `+${fmt(n)}원` : '0원');
    const outFmt = (n) => (n ? `${MINUS}${fmt(n)}원` : '0원');
    if (animate) {
      M.countUp($('#sum-in'), prevSummary.income, s.income, { format: inFmt, delay });
      M.countUp($('#sum-out'), prevSummary.expense, s.expense, { format: outFmt, delay });
    } else {
      $('#sum-in').textContent = inFmt(s.income);
      $('#sum-out').textContent = outFmt(s.expense);
    }
    prevSummary = s;

    let ratio = 0;
    let note = '';
    if (!s.income && !s.expense) note = '아직 이 달의 기록이 없어요';
    else if (!s.income) {
      ratio = 1;
      note = '수입 기록 없이 지출만 있어요';
    } else {
      ratio = Math.min(1, s.expense / s.income);
      note =
        s.expense > s.income
          ? `수입보다 ${fmt(s.expense - s.income)}원 더 썼어요`
          : `수입의 ${Math.round((s.expense / s.income) * 100)}%를 썼어요`;
    }
    const fill = $('#meter-fill');
    const apply = () => {
      fill.style.setProperty('--ratio', ratio.toFixed(4));
      fill.classList.toggle('warn', ratio >= 0.7 && ratio < 0.9);
      fill.classList.toggle('over', ratio >= 0.9);
    };
    if (delay && animate) setTimeout(apply, delay);
    else apply();
    const meter = $('#meter');
    meter.setAttribute('aria-valuenow', String(Math.round(ratio * 100)));
    meter.setAttribute('aria-valuetext', note);
    $('#meter-note').textContent = note;
  }

  /* 처음부터 이어지는 현재 잔액 (오늘까지의 모든 기록 + 시작 잔액) */
  function paintCurrent() {
    const v = Store.current();
    const el = $('#now-val');
    const inList = $('#list-now');
    if (v === null) {
      el.textContent = Store.totalsFailed ? '계산 못 함' : '계산 중…';
      el.classList.add('is-pending');
      el.classList.remove('is-neg');
      if (inList) inList.textContent = '…';
      prevCurrent = null;
      return;
    }
    el.classList.remove('is-pending');
    el.classList.toggle('is-neg', v < 0);
    if (inList) {
      inList.textContent = won(v);
      inList.classList.toggle('neg', v < 0);
    }
    if (v === prevCurrent) return; // 같은 값이면 굴러가던 숫자를 그대로 둡니다
    if (prevCurrent !== null) {
      M.countUp(el, prevCurrent, v, { format: won, duration: 700 });
      pulse(el);
    } else el.textContent = won(v);
    prevCurrent = v;
  }

  function pulse(el) {
    el.classList.remove('pulse');
    void el.offsetWidth;
    el.classList.add('pulse');
  }

  /* ───────── 내역 ───────── */
  function entryItem(e) {
    const c = Store.category(e.type, e.cat);
    const li = document.createElement('li');
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'entry px';
    btn.dataset.id = e.id;
    const img = document.createElement('img');
    img.className = 'px-img';
    img.alt = '';
    img.width = 40;
    img.height = 40;
    img.src = S.tile(c.icon, c.tile, c.lip);
    const main = document.createElement('span');
    main.className = 'main';
    const cat = document.createElement('span');
    cat.className = 'e-cat';
    cat.textContent = c.name;
    main.appendChild(cat);
    if (e.memo) {
      const memo = document.createElement('span');
      memo.className = 'e-memo';
      memo.textContent = e.memo;
      main.appendChild(memo);
    }
    const right = document.createElement('span');
    right.className = 'e-right';
    const amt = document.createElement('span');
    amt.className = 'e-amt ' + (e.type === 'income' ? 'in' : 'out');
    amt.textContent = signed(e.type, e.amount) + '원';
    const bal = document.createElement('span');
    bal.className = 'e-bal is-pending';
    bal.textContent = '잔액 …';
    right.append(amt, bal);
    btn.append(img, main, right);
    btn.dataset.label = `${c.name} ${TYPE_NAME[e.type]} ${fmt(e.amount)}원${e.memo ? ', ' + e.memo : ''}`;
    btn.setAttribute('aria-label', `${btn.dataset.label}. 눌러서 고치기`);
    li.appendChild(btn);
    return li;
  }

  /* 기록마다 '그 기록 직후의 잔액'을 채웁니다. 합계가 아직 없으면 자리만 둡니다. */
  function paintBalances() {
    if (state.screen !== 'app' || !Store.ready(state.y, state.m)) return;
    const map = Store.balances(state.y, state.m);
    for (const btn of $$('#list .entry[data-id]')) {
      const el = btn.querySelector('.e-bal');
      const v = map ? map.get(btn.dataset.id) : undefined;
      if (v === undefined) {
        el.textContent = Store.totalsFailed ? '잔액 —' : '잔액 …';
        el.classList.add('is-pending');
        el.classList.remove('is-neg');
        btn.setAttribute('aria-label', `${btn.dataset.label}. 눌러서 고치기`);
        continue;
      }
      el.textContent = `잔액 ${won(v)}`;
      el.classList.remove('is-pending');
      el.classList.toggle('is-neg', v < 0);
      btn.setAttribute('aria-label', `${btn.dataset.label}, 거래 후 잔액 ${spokenWon(v)}. 눌러서 고치기`);
    }
  }

  function renderListHead() {
    const ready = Store.ready(state.y, state.m);
    const yr = state.y !== today.getFullYear() ? `${state.y}년 ` : '';
    $('#list-title').textContent = `${state.listFull ? yr : ''}${state.m}월 내역`;
    const n = ready ? Store.month(state.y, state.m).length : 0;
    $('#list-count').textContent = n ? `${n}건` : '';
    const sum = $('#list-sum');
    sum.textContent = '';
    if (!ready) return;
    const s = Store.summary(state.y, state.m);
    const part = (label, value, cls, id) => {
      const span = document.createElement('span');
      const b = document.createElement('b');
      b.className = cls;
      if (id) b.id = id;
      b.textContent = value;
      span.append(`${label} `, b);
      sum.appendChild(span);
    };
    part('기록', `${n}건`, '');
    part('수입', s.income ? `+${fmt(s.income)}원` : '0원', 'in');
    part('지출', s.expense ? `${MINUS}${fmt(s.expense)}원` : '0원', 'out');
    const cur = Store.current();
    part('현재 잔액', cur === null ? '…' : won(cur), cur !== null && cur < 0 ? 'neg' : '', 'list-now');
  }

  function paintEmptyHint() {
    $('#empty-sub').textContent =
      wide || state.listFull ? '기록하기 버튼을 눌러 첫 기록을 남겨 보세요.' : '아래 나뭇잎 버튼을 눌러 첫 기록을 남겨 보세요.';
  }

  /* 내역 칸에 위·아래로 더 볼 것이 있으면 가장자리를 흐리게 합니다 */
  function updateFades() {
    const sc = $('#list-scroll');
    const max = sc.scrollHeight - sc.clientHeight;
    sc.classList.toggle('fade-top', max > 2 && sc.scrollTop > 2);
    sc.classList.toggle('fade-bottom', max > 2 && max - sc.scrollTop > 2);
  }

  function flipKey(el) {
    return el.dataset.id ? 'e:' + el.dataset.id : 'd:' + el.dataset.key;
  }
  function measure(root) {
    const map = new Map();
    for (const el of $$('.entry[data-id], .day-head[data-key]', root)) map.set(flipKey(el), el.getBoundingClientRect());
    return map;
  }

  function renderList({ flip = false, enterDir = null, fresh = null, delay = 0 } = {}) {
    const list = $('#list');
    const ready = Store.ready(state.y, state.m);
    $('#list-loading').hidden = ready;
    renderListHead();
    if (!ready) {
      list.textContent = '';
      $('#empty').hidden = true;
      $('#list-loading-text').textContent = '기록을 불러오는 중…';
      state.renderedSig = 'loading';
      updateFades();
      return;
    }
    const entries = Store.month(state.y, state.m);
    const before = flip ? measure(list) : null;
    list.textContent = '';
    $('#empty').hidden = entries.length > 0;

    const groups = new Map();
    for (const e of entries) {
      if (!groups.has(e.date)) groups.set(e.date, []);
      groups.get(e.date).push(e);
    }
    const todayISO = Store.todayISO();
    for (const [date, items] of groups) {
      const d = Store.parseISO(date);
      const day = document.createElement('section');
      day.className = 'day';
      const head = document.createElement('h3');
      head.className = 'day-head';
      head.dataset.key = date;
      let inSum = 0;
      let outSum = 0;
      for (const e of items) {
        if (e.type === 'income') inSum += e.amount;
        else outSum += e.amount;
      }
      head.innerHTML =
        `<span>${d.getDate()}일 ${WEEK[d.getDay()]}</span>` +
        (date === todayISO ? '<span class="today px">오늘</span>' : '') +
        `<span class="day-sum">${inSum ? `<span class="in">+${fmt(inSum)}</span>` : ''}${
          outSum ? `<span class="out">${MINUS}${fmt(outSum)}</span>` : ''
        }</span>`;
      const ul = document.createElement('ul');
      ul.className = 'entries';
      for (const e of items) ul.appendChild(entryItem(e));
      day.append(head, ul);
      list.appendChild(day);
    }
    state.renderedSig = Store.signature(state.y, state.m);
    paintBalances();

    if (flip) playFlip(list, before, fresh);
    else if (enterDir !== null) cascade(list, enterDir, delay);
    if (fresh) {
      const el = list.querySelector(`.entry[data-id="${CSS.escape(fresh)}"]`);
      if (el) {
        el.classList.add('fresh');
        setTimeout(() => el.classList.remove('fresh'), 1900);
      }
    }
    updateFades();
  }

  function playFlip(root, before, freshId) {
    for (const el of $$('.entry[data-id], .day-head[data-key]', root)) {
      const prev = before.get(flipKey(el));
      if (el.dataset.id && el.dataset.id === freshId) {
        M.animate(el, [{ transform: 'scale(.4)', opacity: 0 }, { transform: 'none', opacity: 1 }], {
          duration: M.SPRING.duration,
          easing: M.SPRING.easing,
          delay: 160,
          fill: 'backwards',
        });
        continue;
      }
      if (!prev) {
        M.animate(el, [{ opacity: 0 }, { opacity: 1 }], { duration: 320, delay: 120, fill: 'backwards' });
        continue;
      }
      const now = el.getBoundingClientRect();
      const dx = prev.left - now.left;
      const dy = prev.top - now.top;
      if (Math.abs(dx) < 1 && Math.abs(dy) < 1) continue;
      M.animate(el, [{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'none' }], {
        duration: M.SPRING_SOFT.duration,
        easing: M.SPRING_SOFT.easing,
      });
    }
  }

  function cascade(root, dir, delay = 0) {
    if (M.reduced()) return;
    $$('.day-head, .entry', root).forEach((el, i) => {
      if (i > 16) return;
      M.animate(
        el,
        [
          { opacity: 0, transform: dir ? `translateX(${dir * 28}px)` : 'translateY(12px)' },
          { opacity: 1, transform: 'none' },
        ],
        { duration: 460, delay: delay + 30 + i * 30, easing: M.EASE_OUT, fill: 'backwards' }
      );
    });
  }

  // 높이를 접으며 사라지게 합니다
  function collapse(li, delay = 0) {
    if (!li || M.reduced()) return Promise.resolve();
    const h = li.getBoundingClientRect().height;
    li.style.overflow = 'hidden';
    const a = li.animate(
      [
        { height: h + 'px', opacity: 1, transform: 'none' },
        { height: '0px', opacity: 0, transform: 'scale(.92)' },
      ],
      { duration: 280, delay, easing: M.EASE_IN, fill: 'forwards' }
    );
    return a.finished.catch(() => {});
  }

  /* 그 기록이 내역 칸(과 화면) 안에 보이도록 굴립니다 */
  function revealRow(row) {
    const sc = $('#list-scroll');
    const r = row.getBoundingClientRect();
    const b = sc.getBoundingClientRect();
    const inBox = r.top >= b.top && r.bottom <= b.bottom;
    const onScreen = r.top >= 0 && r.bottom <= innerHeight;
    if (!inBox || !onScreen) row.scrollIntoView({ block: 'nearest', behavior: M.reduced() ? 'auto' : 'smooth' });
  }

  /* 달력에서 고른 날짜의 내역으로 갑니다 */
  function goToDay(iso) {
    if (!wide && state.tab !== 'list') setTab('list');
    requestAnimationFrame(() => {
      const head = $(`#list .day-head[data-key="${iso}"]`);
      if (!head) return;
      const sc = $('#list-scroll');
      const top = head.getBoundingClientRect().top - sc.getBoundingClientRect().top + sc.scrollTop - 4;
      const behavior = M.reduced() ? 'auto' : 'smooth';
      sc.scrollTo({ top, behavior });
      if (!wide && !state.listFull) {
        const p = $('#panel-list').getBoundingClientRect();
        if (p.top < 0 || p.top > innerHeight * 0.45) $('#panel-list').scrollIntoView({ block: 'start', behavior });
      }
      flash(head.parentElement);
    });
  }

  /* ───────── 내역 크게 보기 (화면 가득) ───────── */
  function setListFull(on, { animate = true } = {}) {
    if (state.listFull === on) return;
    const panel = $('#panel-list');
    const ghost = $('#list-ghost');
    const scrim = $('#list-scrim');
    const btn = $('#list-expand');
    const others = [$('.topbar'), ...$$('#app > *').filter((el) => el !== panel && el !== ghost)];
    const anim = animate && !M.reduced();
    panel.getAnimations().forEach((a) => a.cancel());
    scrim.getAnimations().forEach((a) => a.cancel());
    state.listFull = on;
    document.documentElement.classList.toggle('list-full', on);
    setSprite(btn.querySelector('img'), on ? 'shrink' : 'expand', 2);
    btn.setAttribute('aria-expanded', String(on));
    btn.setAttribute('aria-label', on ? '내역 작게 보기' : '내역 크게 보기');
    btn.title = on ? '작게 보기' : '크게 보기';
    paintEmptyHint();
    syncScrollLock();

    if (on) {
      const from = panel.getBoundingClientRect();
      ghost.style.setProperty('--ghost-h', `${from.height}px`);
      ghost.hidden = false;
      panel.classList.add('is-full');
      scrim.hidden = false;
      others.forEach((el) => (el.inert = true));
      renderListHead();
      updateFades();
      if (anim) {
        const to = panel.getBoundingClientRect();
        const clip = `inset(${from.top - to.top}px ${to.right - from.right}px ${to.bottom - from.bottom}px ${from.left - to.left}px)`;
        M.animate(panel, [{ clipPath: clip }, { clipPath: 'inset(0px)' }], { duration: 480, easing: M.EASE_OUT });
        M.animate(scrim, [{ opacity: 0 }, { opacity: 1 }], { duration: 300 });
      }
      btn.focus({ preventScroll: true });
      return;
    }

    const finish = () => {
      if (state.listFull) return;
      panel.classList.remove('is-full');
      ghost.hidden = true;
      scrim.hidden = true;
      panel.getAnimations().forEach((a) => a.cancel());
      scrim.getAnimations().forEach((a) => a.cancel());
      others.forEach((el) => (el.inert = false));
      renderListHead();
      updateFades();
    };
    if (anim && !ghost.hidden) {
      const from = panel.getBoundingClientRect();
      const to = ghost.getBoundingClientRect();
      const clip = `inset(${to.top - from.top}px ${from.right - to.right}px ${from.bottom - to.bottom}px ${to.left - from.left}px)`;
      const a = M.animate(panel, [{ clipPath: 'inset(0px)' }, { clipPath: clip }], { duration: 300, easing: M.EASE_IN, fill: 'forwards' });
      M.animate(scrim, [{ opacity: 1 }, { opacity: 0 }], { duration: 300, fill: 'forwards' });
      a.finished.then(finish, finish);
    } else finish();
    if (state.screen === 'app') btn.focus({ preventScroll: true });
  }

  /* ───────── 달력 ───────── */
  const dayISO = (d) => `${state.y}-${pad2(state.m)}-${pad2(d)}`;

  function renderCalendar({ animate = false, dir = 0 } = {}) {
    const grid = $('#cal-grid');
    const ready = Store.ready(state.y, state.m);
    const key = Store.monthKey(state.y, state.m);
    $('#cal-title').textContent = `${state.m}월 달력`;
    grid.classList.toggle('is-loading', !ready);
    grid.setAttribute('aria-busy', String(!ready));
    const days = new Date(state.y, state.m, 0).getDate();
    const lead = new Date(state.y, state.m - 1, 1).getDay();
    const cells = Math.ceil((lead + days) / 7) * 7;
    const byDay = ready ? Store.byDay(state.y, state.m) : new Map();
    const todayISO = Store.todayISO();
    if (!state.calFocus || state.calFocus.slice(0, 7) !== key) state.calFocus = todayISO.slice(0, 7) === key ? todayISO : dayISO(1);

    const frag = document.createDocumentFragment();
    for (let i = 0; i < cells; i++) {
      const d = i - lead + 1;
      if (d < 1 || d > days) {
        const blank = document.createElement('span');
        blank.className = 'cal-blank';
        blank.setAttribute('aria-hidden', 'true');
        frag.appendChild(blank);
        continue;
      }
      const iso = dayISO(d);
      const info = byDay.get(iso);
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'cal-day px';
      btn.dataset.date = iso;
      btn.dataset.day = String(d);
      btn.tabIndex = iso === state.calFocus ? 0 : -1;
      const num = document.createElement('span');
      num.className = 'd';
      num.textContent = String(d);
      btn.appendChild(num);
      const isToday = iso === todayISO;
      if (isToday) btn.classList.add('today');
      let label = `${state.m}월 ${d}일 ${WEEK[(lead + d - 1) % 7]}${isToday ? ', 오늘' : ''}`;
      if (info) {
        btn.classList.add('has');
        const amts = document.createElement('span');
        amts.className = 'amts';
        const parts = [];
        if (info.income) {
          const s = document.createElement('span');
          s.className = 'ci';
          s.dataset.n = String(info.income);
          amts.appendChild(s);
          parts.push(`수입 ${fmt(info.income)}원`);
        }
        if (info.expense) {
          const s = document.createElement('span');
          s.className = 'co';
          s.dataset.n = String(info.expense);
          amts.appendChild(s);
          parts.push(`지출 ${fmt(info.expense)}원`);
        }
        btn.appendChild(amts);
        label += `, ${parts.join(', ')}, ${info.count}건. 눌러서 그날 내역 보기`;
      } else if (ready) {
        label += ', 기록 없음. 눌러서 이 날짜로 기록하기';
      }
      btn.setAttribute('aria-label', label);
      frag.appendChild(btn);
    }
    grid.textContent = '';
    grid.appendChild(frag);
    fitCalendar();
    renderCalFoot(byDay, ready);

    if (animate && !M.reduced()) {
      M.animate(grid, [{ opacity: 0, transform: dir ? `translateX(${dir * 24}px)` : 'translateY(10px)' }, { opacity: 1, transform: 'none' }], {
        duration: M.SPRING_SOFT.duration,
        easing: M.SPRING_SOFT.easing,
      });
      $$('.cal-day.has .amts', grid).forEach((el, i) => {
        M.animate(el, [{ opacity: 0, transform: 'translateY(6px) scale(.7)' }, { opacity: 1, transform: 'none' }], {
          duration: M.SPRING.duration,
          easing: M.SPRING.easing,
          delay: 140 + Math.min(i, 20) * 22,
          fill: 'backwards',
        });
      });
    }
  }

  /* 금액을 칸 너비에 맞게 줄여 씁니다. 한 달력 안에서는 모두 같은 방식으로 씁니다.
   * 0: 152,000  1: 15.2만  2: 15만·4.8천  3: 15만·5천 */
  let measureCtx = null;
  function textWidth(text, font) {
    if (!measureCtx) measureCtx = document.createElement('canvas').getContext('2d');
    measureCtx.font = font;
    return measureCtx.measureText(text).width;
  }
  function calAmount(n, level) {
    const short = (v, digits) => String(+v.toFixed(digits));
    if (level === 0) return fmt(n);
    if (level === 1) {
      if (n >= 1e8) return `${short(n / 1e8, 2)}억`;
      if (n >= 1e4) return `${short(n / 1e4, 1)}만`;
      return fmt(n);
    }
    if (level === 2) {
      if (n >= 1e8) return `${short(n / 1e8, 1)}억`;
      if (n >= 1e4) return `${Math.round(n / 1e4)}만`;
      if (n >= 1e3) return `${short(n / 1e3, 1)}천`;
      return String(n);
    }
    if (n >= 1e8) return `${Math.round(n / 1e8)}억`;
    if (n >= 1e4) return `${Math.round(n / 1e4)}만`;
    if (n >= 1e3) return `${Math.round(n / 1e3)}천`;
    return String(n);
  }
  function fitCalendar() {
    const grid = $('#cal-grid');
    const cell = grid.querySelector('.cal-day');
    const amts = grid.querySelector('.amts');
    if (!cell || !amts) return;
    const cs = getComputedStyle(cell);
    const avail = cell.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
    if (avail <= 0) return; // 아직 화면에 없음
    const fs = getComputedStyle(amts);
    const font = `${fs.fontWeight} ${fs.fontSize} ${fs.fontFamily}`;
    // 달력 칸은 좁아서 폭이 좁은 붙임표(-)를 빼기 기호로 씁니다
    const items = $$('.ci, .co', grid).map((el) => ({ el, n: +el.dataset.n, sign: el.classList.contains('ci') ? '+' : '-' }));
    let level = 0;
    while (level < 3 && items.some((it) => textWidth(it.sign + calAmount(it.n, level), font) > avail + 0.5)) level++;
    for (const it of items) it.el.textContent = it.sign + calAmount(it.n, level);
    grid.dataset.level = String(level);
  }

  /* 달력 아래 요약: 하루 평균 지출, 가장 많이 쓴 날, 지출 없는 날 */
  function renderCalFoot(byDay, ready) {
    const foot = $('#cal-foot');
    foot.textContent = '';
    if (!ready) return;
    const days = new Date(state.y, state.m, 0).getDate();
    const viewed = monthIndex(state.y, state.m);
    const now = monthIndex(today.getFullYear(), today.getMonth() + 1);
    // 지난 달은 한 달 전체, 이번 달은 오늘까지, 다음 달부터는 아직 지나지 않았습니다
    const elapsed = viewed < now ? days : viewed === now ? new Date().getDate() : 0;
    let spent = 0;
    let top = null;
    let free = 0;
    for (let d = 1; d <= days; d++) {
      const info = byDay.get(dayISO(d));
      const out = info ? info.expense : 0;
      if (d <= elapsed) {
        spent += out;
        if (!out) free++;
      }
      if (out && (!top || out > top.out)) top = { d, out };
    }
    const item = (term, value, note) => {
      const box = document.createElement('div');
      box.className = 'px';
      const dt = document.createElement('dt');
      dt.textContent = term;
      const dd = document.createElement('dd');
      dd.textContent = value;
      if (note) {
        const small = document.createElement('small');
        small.textContent = note;
        dd.appendChild(small);
      }
      box.append(dt, dd);
      foot.appendChild(box);
    };
    item('하루 평균 지출', elapsed ? won(Math.round(spent / elapsed)) : '—', elapsed ? `${elapsed}일 기준` : '아직 지나지 않은 달');
    item(
      '가장 많이 쓴 날',
      top ? `${state.m}월 ${top.d}일` : '—',
      top ? `${MINUS}${fmt(top.out)}원` : '지출 기록 없음'
    );
    item('지출 없는 날', elapsed ? `${free}일` : '—', elapsed ? `지난 ${elapsed}일 중` : '');
  }
  function focusCalDay(d) {
    state.calFocus = dayISO(d);
    for (const b of $$('#cal-grid .cal-day')) b.tabIndex = b.dataset.date === state.calFocus ? 0 : -1;
    const el = $(`#cal-grid .cal-day[data-day="${d}"]`);
    if (el) el.focus();
  }
  function flashCalDay(iso) {
    const cell = $(`#cal-grid .cal-day[data-date="${iso}"]`);
    if (!cell || !statsVisible()) return;
    flash(cell);
    M.FX.sparkles(cell, { count: 6 });
  }

  /* ───────── 원그래프 ─────────
   * 낮은 해상도 캔버스에 화소를 하나씩 찍고 3배로 키워서 픽셀 그림처럼 보이게 합니다.
   * 큰 순서대로 다섯 조각에 색을 주고, 나머지는 회색 '그 외'로 묶습니다. 조각 사이에는 틈을 둡니다. */
  const PIE_SLOTS = 5;
  const pies = { expense: null, income: null };

  function parseColor(v) {
    let m = /^#([0-9a-f]{6})$/i.exec(v);
    if (m) {
      const n = parseInt(m[1], 16);
      return [n >> 16, (n >> 8) & 255, n & 255, 255];
    }
    m = /^rgba?\(([^)]+)\)$/i.exec(v);
    if (m) {
      const p = m[1].split(/[\s,/]+/).filter(Boolean).map(parseFloat);
      return [p[0], p[1], p[2], Math.round((p.length > 3 ? p[3] : 1) * 255)];
    }
    return [160, 150, 140, 255];
  }
  const cssColor = (name) => parseColor(getComputedStyle(document.documentElement).getPropertyValue(name).trim());

  function pieData(kind) {
    const rows = Store.byCategory(state.y, state.m, kind);
    const total = rows.reduce((a, r) => a + r.sum, 0);
    const count = rows.reduce((a, r) => a + r.count, 0);
    let slices = rows.map((r, i) => ({ cat: r.cat, sum: r.sum, count: r.count, color: `--pie-${i + 1}` }));
    if (rows.length > PIE_SLOTS) {
      const rest = rows.slice(PIE_SLOTS);
      slices = slices.slice(0, PIE_SLOTS);
      slices.push({
        other: rest,
        sum: rest.reduce((a, r) => a + r.sum, 0),
        count: rest.reduce((a, r) => a + r.count, 0),
        color: '--pie-other',
      });
    }
    // 12시 방향에서 시계 방향으로 큰 조각부터
    let a = 0;
    for (const s of slices) {
      s.start = a;
      a += (s.sum / total) * Math.PI * 2;
      s.end = a;
    }
    return { rows, slices, total, count };
  }

  const pct = (n, total) => {
    const p = (n / total) * 100;
    return p < 1 ? '<1%' : `${Math.round(p)}%`;
  };

  function textSpan(cls, text) {
    const s = document.createElement('span');
    if (cls) s.className = cls;
    s.textContent = text;
    return s;
  }

  function renderLegend(block, kind, pie) {
    const ol = $('.legend', block);
    ol.textContent = '';
    ol.setAttribute('aria-label', `${TYPE_NAME[kind]} 카테고리별 금액`);
    pie.slices.forEach((s, i) => {
      const li = document.createElement('li');
      li.className = 'lg-row px';
      li.dataset.i = String(i);
      li.style.setProperty('--sw', `var(${s.color})`);
      const sw = document.createElement('span');
      sw.className = 'lg-sw';
      let icon;
      if (s.other) icon = document.createElement('span');
      else {
        icon = document.createElement('img');
        icon.className = 'px-img';
        icon.alt = '';
        icon.width = 16;
        icon.height = 16;
        icon.src = S.url(s.cat.icon);
      }
      const name = document.createElement('span');
      name.className = 'lg-name';
      name.append(textSpan('', s.other ? `그 외 ${s.other.length}개` : s.cat.name));
      const small = document.createElement('small');
      small.textContent = `${s.count}건`;
      name.appendChild(small);
      li.append(sw, icon, name, textSpan('lg-amt', `${fmt(s.sum)}원`), textSpan('lg-pct', pct(s.sum, pie.total)));
      if (s.other) {
        // 넓은 화면에서 칸이 넘치면 접어 둡니다 (autoFoldLegend). 직접 펼치거나 접은 뒤에는 그대로 둡니다.
        const open = state.otherOpen[kind] !== false;
        const more = document.createElement('button');
        more.type = 'button';
        more.className = 'lg-more';
        more.setAttribute('aria-expanded', String(open));
        more.setAttribute('aria-controls', `lg-sub-${kind}`);
        more.dataset.closed = `${s.other.map((r) => r.cat.name).slice(0, 2).join(', ')}${s.other.length > 2 ? ' 등' : ''} 펼치기`;
        more.textContent = open ? '접기' : more.dataset.closed;
        li.appendChild(more);
        const sub = document.createElement('ul');
        sub.className = 'lg-sub';
        sub.id = `lg-sub-${kind}`;
        sub.hidden = !open;
        for (const r of s.other) {
          const row = document.createElement('li');
          row.append(textSpan('', `${r.cat.name} ${r.count}건`), textSpan('', `${fmt(r.sum)}원`), textSpan('', pct(r.sum, pie.total)));
          sub.appendChild(row);
        }
        li.appendChild(sub);
      }
      ol.appendChild(li);
    });
  }

  function renderPie(kind, { animate = false } = {}) {
    const block = $(`#pie-${kind}`);
    const ready = Store.ready(state.y, state.m);
    const prev = pies[kind];
    if (prev && prev.raf) cancelAnimationFrame(prev.raf);
    const pie = Object.assign({ slices: [], rows: [], total: 0, count: 0 }, ready ? pieData(kind) : null, { sweep: 1, active: -1, raf: 0 });
    pies[kind] = pie;
    const empty = ready && !pie.total;
    $('.loading', block).hidden = ready;
    $('.pie-empty', block).hidden = !empty;
    $('.pie-body', block).hidden = !ready || empty;
    const cap = $('.pie-cap', block);
    cap.textContent = '';
    cap.append(textSpan('k', TYPE_NAME[kind]));
    if (pie.total) {
      const b = document.createElement('b');
      b.textContent = `${fmt(pie.total)}원`;
      cap.append(b, textSpan('', `${pie.count}건 · ${pie.rows.length}개 카테고리`));
    }
    renderLegend(block, kind, pie);
    hideTip(kind);
    if (!pie.total) return;
    if (animate && !M.reduced()) {
      sweepPie(kind);
      $$('.lg-row', block).forEach((el, i) => {
        M.animate(el, [{ opacity: 0, transform: 'translateX(-10px)' }, { opacity: 1, transform: 'none' }], {
          duration: 420,
          delay: 160 + i * 60,
          easing: M.EASE_OUT,
          fill: 'backwards',
        });
      });
    } else drawPie(kind);
  }

  /* 화소 하나가 어느 조각에 속하는지: -1 바깥, -2 조각 사이 틈 */
  function pieGeometry(N) {
    return { c: N / 2, cy: N / 2 - 0.5, R: N / 2 - 2 };
  }
  function drawPie(kind) {
    const pie = pies[kind];
    if (!pie || !pie.total) return;
    const canvas = $(`#pie-${kind} .pie-canvas`);
    const css = canvas.clientWidth;
    if (!css) return; // 지금은 안 보임 (탭이 닫혀 있음)
    const N = Math.max(24, Math.round(css / 3));
    if (canvas.width !== N) {
      canvas.width = N;
      canvas.height = N;
    }
    const ctx = canvas.getContext('2d');
    const img = ctx.createImageData(N, N);
    const px = img.data;
    const colors = pie.slices.map((s) => cssColor(s.color));
    const shadow = cssColor('--shadow');
    const { c, cy, R } = pieGeometry(N);
    const TAU = Math.PI * 2;
    const sweep = pie.sweep * TAU;
    const slices = pie.slices;
    const bounds = slices.length > 1 ? slices.map((s) => s.start) : [];
    const act = pie.active;
    let ox = 0;
    let oy = 0;
    if (act >= 0) {
      const mid = (slices[act].start + slices[act].end) / 2;
      ox = Math.round(Math.sin(mid) * 1.7);
      oy = Math.round(-Math.cos(mid) * 1.7);
    }
    const at = (x, y) => {
      const dx = x + 0.5 - c;
      const dy = y + 0.5 - cy;
      const r = Math.hypot(dx, dy);
      if (r > R) return -1;
      let a = Math.atan2(dx, -dy);
      if (a < 0) a += TAU;
      if (a > sweep) return -1;
      if (r > 1.2) {
        for (const b of bounds) {
          let d = Math.abs(a - b);
          if (d > Math.PI) d = TAU - d;
          if (d < Math.PI / 2 && r * Math.sin(d) < 0.55) return -2;
        }
      }
      for (let i = 0; i < slices.length; i++) if (a < slices[i].end) return i;
      return slices.length - 1;
    };
    for (let y = 0; y < N; y++) {
      for (let x = 0; x < N; x++) {
        const o = (y * N + x) * 4;
        let idx = -1;
        if (act >= 0 && at(x - ox, y - oy) === act) idx = act;
        if (idx < 0) {
          const k = at(x, y);
          if (k >= 0 && k !== act) idx = k;
          else if (k === -1 && at(x, y - 1) !== -1) {
            // 원 아래쪽 한 칸 그림자 (카드의 두께와 같은 느낌)
            px[o] = shadow[0];
            px[o + 1] = shadow[1];
            px[o + 2] = shadow[2];
            px[o + 3] = shadow[3];
            continue;
          }
        }
        if (idx < 0) continue;
        const col = colors[idx];
        px[o] = col[0];
        px[o + 1] = col[1];
        px[o + 2] = col[2];
        px[o + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
  }
  function sweepPie(kind) {
    const pie = pies[kind];
    const t0 = performance.now();
    const dur = 760;
    pie.sweep = 0;
    const step = (now) => {
      if (pies[kind] !== pie) return;
      const p = Math.min(1, (now - t0) / dur);
      pie.sweep = 1 - Math.pow(1 - p, 3);
      drawPie(kind);
      pie.raf = p < 1 ? requestAnimationFrame(step) : 0;
    };
    pie.raf = requestAnimationFrame(step);
  }

  function pieIndexAt(kind, e) {
    const pie = pies[kind];
    if (!pie || !pie.total) return -1;
    const canvas = $(`#pie-${kind} .pie-canvas`);
    const rect = canvas.getBoundingClientRect();
    const N = canvas.width;
    const x = ((e.clientX - rect.left) / rect.width) * N;
    const y = ((e.clientY - rect.top) / rect.height) * N;
    const { c, cy, R } = pieGeometry(N);
    const dx = x - c;
    const dy = y - cy;
    if (Math.hypot(dx, dy) > R + 2) return -1;
    let a = Math.atan2(dx, -dy);
    if (a < 0) a += Math.PI * 2;
    const i = pie.slices.findIndex((s) => a < s.end);
    return i < 0 ? pie.slices.length - 1 : i;
  }
  function setPieActive(kind, i, { tip = false } = {}) {
    const pie = pies[kind];
    if (!pie || !pie.total) return;
    if (pie.active !== i) {
      pie.active = i;
      if (!pie.raf) drawPie(kind);
    }
    for (const row of $$(`#pie-${kind} .lg-row`)) row.classList.toggle('is-active', +row.dataset.i === i);
    if (tip && i >= 0) showTip(kind, i);
    else hideTip(kind);
  }
  function showTip(kind, i) {
    const pie = pies[kind];
    const s = pie.slices[i];
    const wrap = $(`#pie-${kind} .pie-wrap`);
    const tip = $('.pie-tip', wrap);
    tip.textContent = '';
    const b = document.createElement('b');
    b.textContent = `${fmt(s.sum)}원 · ${pct(s.sum, pie.total)}`;
    tip.append(b, s.other ? `그 외 ${s.other.length}개 카테고리` : `${s.cat.name} · ${s.count}건`);
    tip.hidden = false;
    const size = wrap.clientWidth;
    const mid = (s.start + s.end) / 2;
    const half = tip.offsetWidth / 2;
    let x = size / 2 + Math.sin(mid) * size * 0.3;
    x = Math.min(size + 12 - half, Math.max(half - 12, x));
    const y = size / 2 - Math.cos(mid) * size * 0.3;
    tip.style.left = `${x}px`;
    tip.style.top = `${y}px`;
  }
  function hideTip(kind) {
    const tip = $(`#pie-${kind} .pie-tip`);
    if (tip) tip.hidden = true;
  }

  function renderPies({ animate = false } = {}) {
    for (const kind of KINDS) renderPie(kind, { animate: animate && !$(`#pie-${kind}`).hidden });
    autoFoldLegend();
  }

  /* '그 외'에 묶인 카테고리 목록을 펼치거나 접습니다 */
  function setOtherOpen(kind, open, { animate = false } = {}) {
    const more = $(`#pie-${kind} .lg-more`);
    const sub = $(`#lg-sub-${kind}`);
    if (!more || !sub) return;
    more.setAttribute('aria-expanded', String(open));
    more.textContent = open ? '접기' : more.dataset.closed;
    sub.hidden = !open;
    if (open && animate) {
      M.animate(sub, [{ opacity: 0, transform: 'translateY(-6px)' }, { opacity: 1, transform: 'none' }], {
        duration: 360,
        easing: M.EASE_OUT,
      });
    }
  }
  /* 넓은 화면에서 원그래프 칸이 넘치면, 사용자가 직접 고르지 않은 '그 외' 목록부터 접습니다 */
  function autoFoldLegend() {
    if (!wide || state.screen !== 'app') return;
    const card = $('#pie-card .card-body');
    const auto = KINDS.filter((k) => state.otherOpen[k] === null && $(`#pie-${k} .lg-more`));
    auto.forEach((k) => setOtherOpen(k, true));
    for (const k of auto) {
      if (card.scrollHeight <= card.clientHeight + 1) break;
      setOtherOpen(k, false);
    }
  }

  function renderStats({ animate = false, dir = 0 } = {}) {
    renderCalendar({ animate, dir });
    renderPies({ animate });
  }

  /* ───────── 탭 ───────── */
  function paintTabs() {
    const isList = state.tab === 'list';
    $('#view-tabs').style.setProperty('--tab', isList ? 0 : 1);
    const tl = $('#tab-list');
    const ts = $('#tab-stats');
    tl.setAttribute('aria-selected', String(isList));
    ts.setAttribute('aria-selected', String(!isList));
    tl.tabIndex = isList ? 0 : -1;
    ts.tabIndex = isList ? -1 : 0;
    const list = $('#panel-list');
    const stats = $('#panel-stats');
    list.hidden = !wide && !isList;
    stats.hidden = !wide && isList;
    // 넓은 화면에는 탭이 없으니 각 칸을 제목 붙은 영역으로 둡니다
    if (wide) {
      list.removeAttribute('role');
      list.setAttribute('aria-labelledby', 'list-title');
      stats.removeAttribute('role');
      stats.removeAttribute('aria-labelledby');
    } else {
      list.setAttribute('role', 'tabpanel');
      list.setAttribute('aria-labelledby', 'tab-list');
      stats.setAttribute('role', 'tabpanel');
      stats.setAttribute('aria-labelledby', 'tab-stats');
    }
  }
  function setTab(tab, { focus = false } = {}) {
    if (state.tab === tab) return;
    state.tab = tab;
    paintTabs();
    if (wide) return;
    const isList = tab === 'list';
    if (focus) (isList ? $('#tab-list') : $('#tab-stats')).focus();
    const show = isList ? $('#panel-list') : $('#panel-stats');
    M.animate(show, [{ opacity: 0, transform: `translateX(${isList ? -24 : 24}px)` }, { opacity: 1, transform: 'none' }], {
      duration: M.SPRING_SOFT.duration,
      easing: M.SPRING_SOFT.easing,
    });
    if (isList) {
      cascade($('#list'), 0);
      updateFades();
    } else renderStats({ animate: true });
  }

  function paintStatKind() {
    const kind = state.statKind;
    const seg = $('.seg');
    seg.dataset.kind = kind;
    seg.style.setProperty('--seg', kind === 'expense' ? 0 : 1);
    const radio = $(`input[name="stat-kind"][value="${kind}"]`);
    if (radio) radio.checked = true;
    for (const k of KINDS) $(`#pie-${k}`).hidden = !wide && k !== kind;
  }
  function setStatKind(kind) {
    state.statKind = kind;
    paintStatKind();
    renderPie(kind, { animate: true });
  }

  /* ───────── 달 이동 ───────── */
  function watchMonth(y, m) {
    const key = Store.monthKey(y, m);
    if (Store.watch(y, m)) state.loaded.add(key);
    else state.loaded.delete(key);
  }

  function changeMonth(dir) {
    let { y, m } = state;
    m += dir;
    if (m < 1) {
      m = 12;
      y -= 1;
    } else if (m > 12) {
      m = 1;
      y += 1;
    }
    state.y = y;
    state.m = m;
    watchMonth(y, m);
    renderMonthLabel(dir);
    renderSummary();
    const listOn = listVisible();
    const statsOn = statsVisible();
    const targets = [];
    if (listOn) targets.push($('#list'));
    if (statsOn) targets.push($('#cal-grid'), ...$$('.pie-block:not([hidden]) .pie-body'));
    $$('.card-body').forEach((b) => (b.scrollTop = 0));
    const redraw = () => {
      $('#list-scroll').scrollTop = 0;
      renderList({ enterDir: listOn ? dir : null });
      renderStats({ animate: statsOn, dir });
    };
    const outs = M.reduced()
      ? []
      : targets
          .map((el) =>
            M.animate(el, [{ opacity: 1, transform: 'none' }, { opacity: 0, transform: `translateX(${-dir * 28}px)` }], {
              duration: 150,
              easing: M.EASE_IN,
            })
          )
          .filter(Boolean);
    if (outs.length) outs[0].onfinish = redraw;
    else redraw();
    refreshTalk();
  }

  /* ───────── 데이터가 도착하거나 바뀌었을 때 ───────── */
  function arrive() {
    renderSummary({ animate: true });
    renderList({ enterDir: 0 });
    renderStats({ animate: statsVisible() });
    refreshTalk();
  }

  let syncTimer = 0;
  function scheduleSync() {
    clearTimeout(syncTimer);
    syncTimer = setTimeout(syncNow, 160);
  }
  function syncNow() {
    const wait = state.busyUntil - Date.now();
    if (wait > 0) {
      syncTimer = setTimeout(syncNow, wait + 30);
      return;
    }
    if (state.screen !== 'app' || !Store.ready(state.y, state.m)) return;
    if (Store.signature(state.y, state.m) === state.renderedSig) return;
    renderList({ flip: true });
    renderSummary();
    renderStats({ animate: false });
    // 다른 기기에서 첫 기록이 들어왔거나 모두 지워졌으면 토리의 말도 바꿉니다
    const empty = !Store.month(state.y, state.m).length;
    if (state.talk.empty !== null && empty !== state.talk.empty && !state.sheet.open) refreshTalk();
  }

  function onStoreChange(key) {
    if (!state.user || state.screen !== 'app' || key !== Store.monthKey(state.y, state.m)) return;
    if (!state.loaded.has(key)) {
      state.loaded.add(key);
      arrive();
    } else scheduleSync();
  }

  function onStoreError(kind, err) {
    console.error('[가계부]', kind, err);
    const denied = err && err.code === 'permission-denied';
    if (kind === 'read') {
      $('#list-loading-text').textContent = '기록을 불러오지 못했어요.';
      toast(denied ? '이 기록을 볼 권한이 없어요. 다시 로그인해 주세요.' : '기록을 불러오지 못했어요. 인터넷 연결을 확인해 주세요.', {
        icon: 'close',
      });
    } else if (kind === 'totals') {
      // 잔액 합계는 자주 다시 세므로 알림은 한 번만 띄웁니다
      if (state.totalsErrShown) return;
      state.totalsErrShown = true;
      const noIndex = err && err.code === 'failed-precondition';
      toast(
        denied
          ? '잔액을 계산할 권한이 없어요. 사이트 관리자에게 보안 규칙을 새로 게시해 달라고 알려 주세요.'
          : noIndex
            ? '잔액 계산에 필요한 색인이 아직 없어요. 사이트 관리자에게 README의 “색인 만들기”를 알려 주세요.'
            : '잔액을 계산하지 못했어요. 인터넷 연결을 확인해 주세요.',
        { icon: 'close', duration: 6000 }
      );
    } else {
      toast(
        denied
          ? '저장할 권한이 없어요. 다시 로그인해도 안 되면 사이트 관리자에게 알려 주세요.'
          : '저장하지 못했어요. 인터넷 연결을 확인하고 다시 시도해 주세요.',
        { icon: 'close' }
      );
      scheduleSync();
    }
  }

  /* ───────── 토리의 말 ───────── */
  const TALKERS = {
    app: { tori: '#tori', bubble: '#bubble', text: '#talk-text', live: '#talk-live' },
    auth: { tori: '#auth-tori', bubble: '#auth-bubble', text: '#auth-talk-text', live: '#auth-talk-live' },
  };
  const talkCtrl = {};
  const AUTH_LINES = [
    '어서 와요! 로그인하면 어느 기기에서든 내 가계부를 이어서 쓸 수 있어요.',
    '처음이라면 회원가입 탭에서 이메일로 가입해 보세요. Google 계정도 돼요.',
    '기록은 계정마다 따로 보관돼요. 다른 사용자는 내 기록을 볼 수 없어요.',
  ];

  function greeting() {
    const who = state.user && state.user.name ? `${state.user.name}님, ` : '';
    const h = new Date().getHours();
    if (h >= 5 && h < 11) return `${who}좋은 아침이에요! 오늘도 도토리를 차곡차곡 모아 봐요.`;
    if (h >= 11 && h < 17) return `${who}점심은 먹었어요? 먹은 것도 잊기 전에 적어 두면 좋아요.`;
    if (h >= 17 && h < 22) return `${who}오늘 하루도 수고했어요. 자기 전에 오늘 쓴 돈을 한번 정리해 봐요.`;
    return `${who}밤이 깊었어요. 오늘 기록만 마무리하고 푹 쉬어요.`;
  }

  function buildLines() {
    if (!Store.ready(state.y, state.m)) return ['기록을 불러오는 중이에요. 잠시만요!'];
    const s = Store.summary(state.y, state.m);
    const entries = Store.month(state.y, state.m);
    const cur = isCurrentMonth();
    const when = cur ? '이번 달' : `${state.m}월`;
    const lines = [];
    if (!entries.length) {
      lines.push(
        cur
          ? wide
            ? '이번 달 기록은 아직 없어요. 내역 칸의 기록하기 버튼으로 첫 기록을 남겨 봐요!'
            : '이번 달 기록은 아직 없어요. 아래 나뭇잎 버튼을 눌러 첫 기록을 남겨 봐요!'
          : `${state.m}월에는 기록이 없어요. 달력에서 날짜를 눌러 지난 기록도 남길 수 있어요.`
      );
    } else {
      lines.push(`${when} 수입은 ${fmt(s.income)}원, 지출은 ${fmt(s.expense)}원이에요.`);
      if (s.income && s.expense > s.income) {
        lines.push('지출이 수입보다 많아요. 겨울을 나려면 도토리를 조금 아껴 둬야 해요!');
      } else if (s.income) {
        const p = Math.round((s.expense / s.income) * 100);
        lines.push(p <= 50 ? `수입의 ${p}%만 썼어요. 알뜰하게 잘 모으고 있어요!` : `수입의 ${p}%를 썼어요. 남은 날도 차근차근 가 봐요.`);
      }
      const top = Store.byCategory(state.y, state.m, 'expense')[0];
      if (top) {
        lines.push(
          `가장 많이 쓴 곳은 ${top.cat.name}${josa(top.cat.name, '이에요', '예요')}. ${top.count}건, ${fmt(top.sum)}원을 썼어요.`
        );
      }
      if (cur) {
        const n = entries.filter((e) => e.date === Store.todayISO()).length;
        lines.push(n ? `오늘은 벌써 ${n}건을 기록했어요. 꼼꼼해요!` : '오늘 쓴 돈이 있다면 잊기 전에 적어 둬요.');
      }
    }
    const now = Store.current();
    if (now !== null) {
      lines.push(
        now < 0 ? `지금 잔액은 마이너스 ${fmt(-now)}원이에요. 조금씩 채워 봐요!` : `처음 기록부터 이어서 센 지금 잔액은 ${fmt(now)}원이에요.`
      );
      if (!Store.opening) lines.push('실제 통장 잔액과 다르면 위의 ‘맞추기’를 눌러 한 번 맞춰 두세요.');
    }
    lines.push(greeting());
    return lines;
  }

  function say(text, { hop = false, who = 'app' } = {}) {
    const t = TALKERS[who];
    const tori = $(t.tori);
    const bubble = $(t.bubble);
    bubble.classList.remove('done');
    tori.classList.add('is-talking');
    if (hop) {
      tori.classList.remove('hop');
      void tori.offsetWidth;
      tori.classList.add('hop');
    }
    $(t.live).textContent = text;
    talkCtrl[who] = M.typewriter($(t.text), text, {
      speed: 34,
      onDone: () => {
        tori.classList.remove('is-talking');
        bubble.classList.add('done');
      },
    });
  }
  function refreshTalk(first) {
    state.talk.lines = buildLines();
    state.talk.idx = 0;
    state.talk.empty = Store.ready(state.y, state.m) ? !Store.month(state.y, state.m).length : null;
    say(first || state.talk.lines[0]);
  }
  function nextLine() {
    const c = talkCtrl.app;
    if (c && !c.done) {
      c.skip();
      return;
    }
    const t = state.talk;
    t.lines = buildLines();
    t.idx = (t.idx + 1) % t.lines.length;
    say(t.lines[t.idx], { hop: true });
  }
  function nextAuthLine() {
    const c = talkCtrl.auth;
    if (c && !c.done) {
      c.skip();
      return;
    }
    state.authLine = (state.authLine + 1) % AUTH_LINES.length;
    say(AUTH_LINES[state.authLine], { hop: true, who: 'auth' });
  }

  /* ───────── 알림 ───────── */
  function toast(text, { icon = 'leaf', action = null, onAction = null, duration = 3200 } = {}) {
    const box = $('#toasts');
    const el = document.createElement('div');
    el.className = 'toast px';
    const img = S.img(icon, 2);
    const p = document.createElement('p');
    p.textContent = text;
    el.append(img, p);
    let timer = 0;
    const dismiss = () => {
      clearTimeout(timer);
      if (el._gone) return;
      el._gone = true;
      const a = M.animate(el, [{ opacity: 1, transform: 'none' }, { opacity: 0, transform: 'translateY(-60%) scale(.95)' }], {
        duration: 220,
        easing: M.EASE_IN,
        fill: 'forwards',
      });
      (a ? a.finished : Promise.resolve()).then(() => el.remove(), () => el.remove());
    };
    if (action) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'undo';
      b.textContent = action;
      b.addEventListener('click', () => {
        if (el._gone) return;
        dismiss();
        onAction();
      });
      el.appendChild(b);
      duration = Math.max(duration, 6000);
    }
    box.appendChild(el);
    while (box.children.length > 3) box.firstElementChild.remove();
    M.animate(el, [{ transform: 'translateY(-140%) scale(.9)', opacity: 0 }, { transform: 'none', opacity: 1 }], {
      duration: M.SPRING.duration,
      easing: M.SPRING.easing,
    });
    timer = setTimeout(dismiss, duration);
    el.addEventListener('pointerenter', () => clearTimeout(timer));
    el.addEventListener('pointerleave', () => {
      clearTimeout(timer);
      timer = setTimeout(dismiss, 1800);
    });
    el.addEventListener('focusin', () => clearTimeout(timer));
  }

  /* ───────── 계정 메뉴 ───────── */
  function updateAccount() {
    const u = state.user;
    if (!u) return;
    $('#account-name').textContent = u.name ? `${u.name}님` : '섬 주민';
    $('#account-email').textContent = u.email;
    $('#account-btn').setAttribute('aria-label', `내 계정 (${u.email || u.name})`);
  }
  function toggleAccountMenu(force) {
    const menu = $('#account-menu');
    const btn = $('#account-btn');
    const open = typeof force === 'boolean' ? force : menu.hidden;
    if (open === !menu.hidden) return;
    btn.setAttribute('aria-expanded', String(open));
    if (open) {
      menu.hidden = false;
      M.animate(menu, [{ opacity: 0, transform: 'translateY(-10px) scale(.88)' }, { opacity: 1, transform: 'none' }], {
        duration: M.SPRING.duration,
        easing: M.SPRING.easing,
      });
      return;
    }
    const a = M.animate(menu, [{ opacity: 1, transform: 'none' }, { opacity: 0, transform: 'translateY(-6px) scale(.95)' }], {
      duration: 140,
      easing: M.EASE_IN,
    });
    (a ? a.finished : Promise.resolve()).then(
      () => {
        if (btn.getAttribute('aria-expanded') === 'false') menu.hidden = true;
      },
      () => {}
    );
  }
  async function logout() {
    const btn = $('#logout-btn');
    btn.setAttribute('aria-busy', 'true');
    try {
      await state.cloud.signOut();
    } catch {
      toast('로그아웃하지 못했어요. 다시 시도해 주세요.', { icon: 'close' });
    } finally {
      btn.setAttribute('aria-busy', 'false');
    }
  }

  /* ───────── 현재 잔액 맞추기 ─────────
   * 지금 실제로 가진 돈을 적으면, 기록은 그대로 두고 '기록 전 잔액(시작 잔액)'을 거꾸로 계산해 저장합니다. */
  function setAdjustSign(neg) {
    const b = $('#adjust-sign');
    b.setAttribute('aria-pressed', String(neg));
    b.textContent = neg ? MINUS : '+';
  }
  function adjustValue() {
    const digits = $('#adjust-amount').value.replace(/\D/g, '');
    if (!digits) return null;
    const v = Number(digits);
    return $('#adjust-sign').getAttribute('aria-pressed') === 'true' ? -v : v;
  }
  function adjustError(text) {
    const p = $('#adjust-error');
    p.textContent = text || '';
    p.hidden = !text;
    if (text) shake($('#adjust-form'));
  }
  function openAdjust() {
    const dlg = $('#adjust-dialog');
    if (dlg.open || state.screen !== 'app') return;
    toggleAccountMenu(false);
    const cur = Store.current();
    $('#adjust-calc').textContent = cur === null ? '계산 중…' : won(cur);
    setAdjustSign(cur !== null && cur < 0);
    $('#adjust-amount').value = cur ? fmt(Math.abs(cur)) : '';
    adjustError('');
    $('#adjust-save').setAttribute('aria-busy', 'false');
    dlg.showModal();
    syncScrollLock();
    M.animate($('#adjust-form'), [{ opacity: 0, transform: 'translateY(28px) scale(.94)' }, { opacity: 1, transform: 'none' }], {
      duration: M.SPRING.duration,
      easing: M.SPRING.easing,
    });
    const input = $('#adjust-amount');
    input.focus();
    input.select();
  }
  async function submitAdjust(e) {
    e.preventDefault();
    const btn = $('#adjust-save');
    if (btn.getAttribute('aria-busy') === 'true') return;
    const v = adjustValue();
    if (v === null) {
      adjustError('지금 가진 금액을 적어 주세요.');
      $('#adjust-amount').focus();
      return;
    }
    adjustError('');
    btn.setAttribute('aria-busy', 'true');
    try {
      await Store.setActualBalance(v);
      $('#adjust-dialog').close();
      toast(`현재 잔액을 ${won(v)}으로 맞췄어요.`, { icon: 'check' });
      say(`좋아요! 지금 잔액은 ${won(v)}이에요. 앞으로의 기록은 여기서부터 이어서 셀게요.`, { hop: true });
      M.FX.sparkles($('#now-val'), { count: 8 });
    } catch (err) {
      console.error('[가계부] 잔액 맞추기', err);
      adjustError(
        err && err.code === 'out-of-range'
          ? '금액이 너무 커요. 다시 확인해 주세요.'
          : err && err.code === 'permission-denied'
            ? '저장할 권한이 없어요. 사이트 관리자에게 보안 규칙을 새로 게시해 달라고 알려 주세요.'
            : '맞추지 못했어요. 인터넷 연결을 확인하고 다시 시도해 주세요.'
      );
    } finally {
      btn.setAttribute('aria-busy', 'false');
    }
  }

  /* ───────── 로그인 화면 ───────── */
  const AUTH_ERRORS = {
    'auth/invalid-email': '이메일 주소 형식이 올바르지 않아요.',
    'auth/missing-email': '이메일을 입력해 주세요.',
    'auth/missing-password': '비밀번호를 입력해 주세요.',
    'auth/invalid-credential': '이메일 또는 비밀번호가 맞지 않아요.',
    'auth/invalid-login-credentials': '이메일 또는 비밀번호가 맞지 않아요.',
    'auth/wrong-password': '이메일 또는 비밀번호가 맞지 않아요.',
    'auth/user-not-found': '이메일 또는 비밀번호가 맞지 않아요.',
    'auth/email-already-in-use': '이미 가입된 이메일이에요. 로그인 탭에서 로그인해 주세요.',
    'auth/weak-password': '비밀번호는 6자 이상으로 정해 주세요.',
    'auth/too-many-requests': '시도가 너무 많았어요. 잠시 뒤에 다시 해 주세요.',
    'auth/network-request-failed': '인터넷 연결을 확인하고 다시 시도해 주세요.',
    'auth/popup-blocked': '로그인 창이 막혔어요. 브라우저에서 팝업을 허용해 주세요.',
    'auth/operation-not-allowed': '이 로그인 방법은 아직 켜져 있지 않아요. 사이트 관리자에게 알려 주세요.',
    'auth/unauthorized-domain': '이 주소는 로그인 허용 목록에 없어요. 사이트 관리자에게 알려 주세요.',
    'auth/user-disabled': '사용이 중지된 계정이에요.',
    'auth/invalid-api-key': '로그인 설정(apiKey)이 올바르지 않아요. 사이트 관리자에게 알려 주세요.',
    'auth/account-exists-with-different-credential': '같은 이메일로 다른 방법을 써서 가입한 계정이 있어요. 원래 방법으로 로그인해 주세요.',
  };
  const SILENT = new Set(['auth/popup-closed-by-user', 'auth/cancelled-popup-request', 'auth/user-cancelled']);
  function authErrorText(err) {
    const code = (err && err.code) || '';
    if (AUTH_ERRORS[code]) return AUTH_ERRORS[code];
    if (code.startsWith('auth/api-key')) return AUTH_ERRORS['auth/invalid-api-key'];
    return '로그인하지 못했어요. 잠시 뒤에 다시 시도해 주세요.';
  }

  function authMessage(text, { ok = false } = {}) {
    const p = $('#auth-msg');
    p.textContent = text || '';
    p.classList.toggle('ok', ok);
    p.hidden = !text;
    if (text && !ok) shake($('#auth-form'));
  }

  function setAuthMode(mode, { focus = false } = {}) {
    state.authMode = mode;
    const signup = mode === 'signup';
    $('#auth-tabs').style.setProperty('--tab', signup ? 1 : 0);
    const tl = $('#auth-tab-login');
    const ts = $('#auth-tab-signup');
    tl.setAttribute('aria-selected', String(!signup));
    ts.setAttribute('aria-selected', String(signup));
    tl.tabIndex = signup ? -1 : 0;
    ts.tabIndex = signup ? 0 : -1;
    if (focus) (signup ? ts : tl).focus();
    $('#auth-form').setAttribute('aria-labelledby', signup ? 'auth-tab-signup' : 'auth-tab-login');
    $('#auth-title').textContent = signup ? '회원가입' : '로그인';
    $('#auth-pw').autocomplete = signup ? 'new-password' : 'current-password';
    $('#pw-hint').hidden = !signup;
    $('#forgot-btn').hidden = signup;
    $('#auth-submit .label-text').textContent = signup ? '가입하고 시작하기' : '로그인';
    authMessage('');
    const nick = $('#nick-field');
    if (nick.hidden === !signup) return;
    nick.hidden = !signup;
    if (signup) {
      M.animate(nick, [{ opacity: 0, transform: 'translateY(-8px) scale(.97)' }, { opacity: 1, transform: 'none' }], {
        duration: M.SPRING_SOFT.duration,
        easing: M.SPRING_SOFT.easing,
      });
    }
  }

  function setAuthBusy(btn, on) {
    btn.setAttribute('aria-busy', on ? 'true' : 'false');
    $('#auth-fields').disabled = on;
    $('#google-btn').disabled = on;
  }

  function resetAuthForm() {
    $('#auth-form').reset();
    $('#auth-pw').type = 'password';
    $('#pw-toggle').textContent = '보기';
    $('#pw-toggle').setAttribute('aria-pressed', 'false');
    $('#pw-toggle').setAttribute('aria-label', '비밀번호 보기');
    setAuthMode('login');
    setAuthBusy($('#auth-submit'), false);
  }

  function setNotice(reason) {
    const box = $('#auth-notice');
    const blocked = Boolean(reason);
    box.hidden = !blocked;
    $('#retry-btn').hidden = reason !== 'load' && reason !== 'timeout';
    if (reason === 'config') {
      $('#auth-notice-text').textContent =
        '아직 로그인 서버(Firebase)가 연결되지 않았어요. 이 사이트를 만든 분이라면 README의 "Firebase 연결하기" 순서대로 js/config.js를 채워 주세요.';
    } else if (blocked) {
      $('#auth-notice-text').textContent = '로그인 서비스를 불러오지 못했어요. 인터넷 연결을 확인한 뒤 다시 시도해 주세요.';
    }
    $('#auth-fields').disabled = blocked;
    $('#google-btn').disabled = blocked;
  }

  const looksLikeEmail = (v) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);

  async function submitAuth(e) {
    e.preventDefault();
    const btn = $('#auth-submit');
    if (btn.getAttribute('aria-busy') === 'true' || !state.cloud || !state.cloud.ready) return;
    const email = $('#auth-email').value.trim();
    const pw = $('#auth-pw').value;
    const nick = $('#auth-nick').value.trim().slice(0, 12);
    if (!looksLikeEmail(email)) {
      authMessage('이메일 주소를 확인해 주세요.');
      $('#auth-email').focus();
      return;
    }
    if (state.authMode === 'signup' ? pw.length < 6 : !pw) {
      authMessage(state.authMode === 'signup' ? '비밀번호가 너무 짧아요.' : '비밀번호를 입력해 주세요.');
      $('#auth-pw').focus();
      return;
    }
    authMessage('');
    setAuthBusy(btn, true);
    try {
      if (state.authMode === 'signup') {
        state.pendingName = nick;
        const user = await state.cloud.signUp(email, pw, nick);
        if (nick && state.user && user && state.user.uid === user.uid) {
          state.user.name = nick;
          updateAccount();
        }
      } else {
        await state.cloud.signIn(email, pw);
      }
    } catch (err) {
      state.pendingName = '';
      authMessage(authErrorText(err));
    } finally {
      setAuthBusy(btn, false);
    }
  }

  async function googleAuth() {
    const btn = $('#google-btn');
    if (!state.cloud || !state.cloud.ready) return;
    authMessage('');
    setAuthBusy(btn, true);
    try {
      await state.cloud.signInGoogle();
    } catch (err) {
      if (!SILENT.has(err && err.code)) authMessage(authErrorText(err));
    } finally {
      setAuthBusy(btn, false);
    }
  }

  async function forgotPassword() {
    if (!state.cloud || !state.cloud.ready) return;
    const email = $('#auth-email').value.trim();
    if (!looksLikeEmail(email)) {
      authMessage('비밀번호를 다시 정할 이메일 주소를 위 칸에 먼저 적어 주세요.');
      $('#auth-email').focus();
      return;
    }
    const btn = $('#forgot-btn');
    btn.disabled = true;
    try {
      await state.cloud.resetPassword(email);
      authMessage(`${email}로 비밀번호 재설정 메일을 보냈어요. 메일함을 확인해 주세요.`, { ok: true });
    } catch (err) {
      authMessage(authErrorText(err));
    } finally {
      btn.disabled = false;
    }
  }

  function showAuth({ notice = null } = {}) {
    if (state.sheet.open) closeSheet({ restoreFocus: false });
    if ($('#adjust-dialog').open) $('#adjust-dialog').close();
    setListFull(false, { animate: false });
    Store.end();
    state.user = null;
    state.loaded.clear();
    return go('auth', () => {
      resetAuthForm();
      setNotice(notice);
    }).then(() => {
      authIntro();
      state.authLine = 0;
      setTimeout(() => say(AUTH_LINES[0], { hop: true, who: 'auth' }), M.reduced() ? 0 : 350);
    });
  }

  function enterApp(user) {
    if (state.user && state.user.uid === user.uid) {
      if (user.name) state.user.name = user.name;
      updateAccount();
      return state.nav;
    }
    state.user = { uid: user.uid, email: user.email, name: user.name || state.pendingName };
    state.pendingName = '';
    Store.begin(state.cloud, user.uid);
    state.loaded.clear();
    state.renderedSig = '';
    state.y = today.getFullYear();
    state.m = today.getMonth() + 1;
    state.tab = 'list';
    state.statKind = 'expense';
    state.calFocus = null;
    state.totalsErrShown = false;
    state.otherOpen = { expense: null, income: null };
    prevSummary = { income: 0, expense: 0 };
    prevCurrent = null;
    return go(
      'app',
      () => {
        updateAccount();
        paintTabs();
        paintStatKind();
        paintEmptyHint();
        odometer.set(0, { instant: true });
        $('#balance .sign').textContent = '';
        $('#sum-in').textContent = '0원';
        $('#sum-out').textContent = '0원';
        $('#meter-fill').style.setProperty('--ratio', 0);
        $('#list-scroll').scrollTop = 0;
        renderMonthLabel(0);
        watchMonth(state.y, state.m);
        renderSummary();
        renderList();
        renderStats({ animate: false });
      },
      $('#auth-submit')
    ).then(() => {
      intro();
      const key = Store.monthKey(state.y, state.m);
      if (Store.ready(state.y, state.m)) {
        state.loaded.add(key);
        arrive();
      } else {
        setTimeout(() => {
          if (state.screen === 'app' && !Store.ready(state.y, state.m)) say('기록을 불러오는 중이에요. 잠시만요!', { hop: true });
        }, 500);
      }
    });
  }

  /* ───────── 기록 시트 ───────── */
  const sheetEl = () => $('#sheet');

  function defaultDate() {
    if (isCurrentMonth()) return Store.todayISO();
    const viewed = monthIndex(state.y, state.m);
    const now = monthIndex(today.getFullYear(), today.getMonth() + 1);
    const day = viewed < now ? new Date(state.y, state.m, 0).getDate() : 1;
    return dayISO(day);
  }

  function buildCategoryGrid(type, { animate = false } = {}) {
    const grid = $('#cat-grid');
    grid.dataset.type = type;
    grid.textContent = '';
    Store.CATEGORIES[type].forEach((c, i) => {
      const label = document.createElement('label');
      label.className = 'cat';
      const input = document.createElement('input');
      input.type = 'radio';
      input.name = 'cat';
      input.value = c.id;
      const tile = document.createElement('span');
      tile.className = 'tile px';
      tile.style.setProperty('--tile', c.tile);
      tile.style.setProperty('--tile-lip', c.lip);
      tile.appendChild(S.img(c.icon, 2));
      const name = document.createElement('span');
      name.className = 'name';
      name.textContent = c.name;
      const check = document.createElement('span');
      check.className = 'check';
      check.setAttribute('aria-hidden', 'true');
      check.appendChild(S.img('check', 2));
      label.append(input, tile, name, check);
      grid.appendChild(label);
      if (animate) {
        M.animate(label, [{ opacity: 0, transform: 'translateY(14px) scale(.6) rotate(-8deg)' }, { opacity: 1, transform: 'none' }], {
          duration: M.SPRING.duration,
          easing: M.SPRING.easing,
          delay: 40 + i * 24,
          fill: 'backwards',
        });
      }
    });
  }

  function setType(type, { animate = true } = {}) {
    const sh = state.sheet;
    const changed = sh.type !== type || $('#cat-grid').dataset.type !== type;
    sh.type = type;
    sheetEl().dataset.type = type;
    $('.type-switch').style.setProperty('--t', type === 'expense' ? 0 : 1);
    $(`#type-${type}`).checked = true;
    if (changed) {
      buildCategoryGrid(type, { animate });
      selectCat(null);
    }
  }

  function selectCat(id) {
    state.sheet.cat = id;
    for (const input of $$('#cat-grid input')) input.checked = input.value === id;
  }

  function setAmount(v, { animate = true } = {}) {
    v = Math.max(0, Math.min(Store.MAX_AMOUNT, Math.floor(v || 0)));
    const prev = state.sheet.amount;
    state.sheet.amount = v;
    const input = $('#amount');
    const raw = v ? String(v) : '';
    if (input.value !== raw) input.value = raw;
    const view = $('#amount-view');
    const digits = view.querySelector('.digits');
    const text = v ? fmt(v) : '0';
    const prevDigits = prev ? String(prev) : '';
    digits.textContent = '';
    let di = 0;
    for (const ch of text) {
      const span = document.createElement('span');
      span.textContent = ch;
      if (ch >= '0' && ch <= '9') {
        if (animate && v && prevDigits[di] !== ch) span.className = 'pop';
        di++;
      }
      digits.appendChild(span);
    }
    view.classList.toggle('is-empty', !v);
    view.classList.toggle('long', text.length > 10);
  }

  function showError(field, msg) {
    const p = $(`#${field}-error`);
    p.textContent = msg;
    p.hidden = false;
    shake(field === 'amount' ? $('#amount-field') : field === 'cat' ? $('#cats') : $('#date-field'));
  }
  function hideError(field) {
    const p = $(`#${field}-error`);
    if (p) p.hidden = true;
  }

  /* 시트·크게 보기·잔액 맞추기 중 하나라도 열려 있으면 뒤 화면은 스크롤하지 않습니다 */
  function syncScrollLock() {
    const dlg = $('#adjust-dialog');
    const lock = state.sheet.open || state.listFull || (dlg && dlg.open);
    document.documentElement.style.overflow = lock ? 'hidden' : '';
  }
  function lockPage(lock) {
    $('#page').inert = lock;
    $('.fab-wrap').inert = lock;
    syncScrollLock();
  }

  function openSheet({ mode = 'add', entry = null, opener = null, date = null, from = null } = {}) {
    const sh = state.sheet;
    if (sh.open) return;
    sh.open = true;
    sh.mode = mode;
    sh.id = entry ? entry.id : null;
    sh.opener = opener;
    sh.from = from;
    toggleAccountMenu(false);

    const layer = $('#sheet-layer');
    const sheet = sheetEl();
    const iris = $('#iris');
    sheet.getAnimations().forEach((a) => a.cancel());
    iris.getAnimations().forEach((a) => a.cancel());

    setType(entry ? entry.type : sh.lastType, { animate: false });
    selectCat(entry ? entry.cat : null);
    setAmount(entry ? entry.amount : 0, { animate: false });
    $('#date').value = entry ? entry.date : date || defaultDate();
    $('#memo').value = entry ? entry.memo : '';
    $('#sheet-title').textContent = mode === 'edit' ? '기록 고치기' : '새 기록';
    $('#save-btn .label-text').textContent = mode === 'edit' ? '고친 내용 저장' : '기록하기';
    $('#delete-btn').hidden = mode !== 'edit';
    ['amount', 'cat', 'date'].forEach(hideError);

    layer.hidden = false;
    lockPage(true);
    $('#fab').classList.add('is-open');
    sheet.querySelector('.sheet-scroll').scrollTop = 0;

    const r = (opener || addButton()).getBoundingClientRect();
    const cx = r.left + r.width / 2;
    const cy = r.top + r.height / 2;
    const R = Math.hypot(Math.max(cx, innerWidth - cx), Math.max(cy, innerHeight - cy));
    sh.origin = { cx, cy, R };
    M.animate(iris, [{ clipPath: `circle(0px at ${cx}px ${cy}px)` }, { clipPath: `circle(${R}px at ${cx}px ${cy}px)` }], {
      duration: 560,
      easing: M.EASE_OUT,
    });
    M.animate(sheet, [{ opacity: 0, transform: 'translateY(48px) scale(.92)' }, { opacity: 1, transform: 'none' }], {
      duration: M.SPRING.duration,
      easing: M.SPRING.easing,
      delay: 90,
      fill: 'backwards',
    });
    const parts = $$('.sheet-band, .type-switch, .amount-field, .cat, .row2, .sheet-actions', sheet);
    parts.forEach((el, i) => {
      M.animate(el, [{ opacity: 0, transform: 'translateY(14px)' }, { opacity: 1, transform: 'none' }], {
        duration: 460,
        delay: 150 + i * 26,
        easing: M.EASE_OUT,
        fill: 'backwards',
      });
    });

    const fine = window.matchMedia('(pointer: fine)').matches;
    setTimeout(() => {
      if (!state.sheet.open) return;
      if (fine) $('#amount').focus({ preventScroll: true });
      else sheet.focus({ preventScroll: true });
    }, 60);
  }

  function closeSheet({ restoreFocus = true } = {}) {
    const sh = state.sheet;
    if (!sh.open) return;
    sh.open = false;
    const layer = $('#sheet-layer');
    const sheet = sheetEl();
    const iris = $('#iris');
    $('#fab').classList.remove('is-open');
    lockPage(false);
    const { cx, cy, R } = sh.origin || { cx: innerWidth / 2, cy: innerHeight, R: innerHeight };
    const a1 = M.animate(sheet, [{ opacity: 1, transform: 'none' }, { opacity: 0, transform: 'translateY(28px) scale(.95)' }], {
      duration: 200,
      easing: M.EASE_IN,
      fill: 'forwards',
    });
    const a2 = M.animate(iris, [{ clipPath: `circle(${R}px at ${cx}px ${cy}px)` }, { clipPath: `circle(0px at ${cx}px ${cy}px)` }], {
      duration: 380,
      delay: 60,
      easing: 'cubic-bezier(.65,0,.35,1)',
      fill: 'forwards',
    });
    Promise.all([a1 && a1.finished, a2 && a2.finished]).then(
      () => {
        if (state.sheet.open) return;
        layer.hidden = true;
        if (a1) a1.cancel();
        if (a2) a2.cancel();
      },
      () => {}
    );
    if (restoreFocus && sh.opener && document.contains(sh.opener)) sh.opener.focus({ preventScroll: true });
  }

  function isVisible(el) {
    const r = el.getBoundingClientRect();
    return r.bottom > 0 && r.top < innerHeight && r.width > 0;
  }

  function submitSheet() {
    const sh = state.sheet;
    const date = $('#date').value;
    let firstBad = null;
    if (!sh.amount) {
      showError('amount', '금액을 입력해 주세요.');
      firstBad = firstBad || $('#amount');
    }
    if (!sh.cat) {
      showError('cat', '카테고리를 하나 골라 주세요.');
      firstBad = firstBad || $('#cat-grid input');
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      showError('date', '날짜를 골라 주세요.');
      firstBad = firstBad || $('#date');
    }
    if (firstBad) {
      firstBad.focus({ preventScroll: false });
      return;
    }

    const payload = { type: sh.type, cat: sh.cat, amount: sh.amount, date, memo: $('#memo').value };
    const fromRect = $('#save-btn').getBoundingClientRect();
    const mode = sh.mode;
    const fromCalendar = sh.from === 'calendar';
    busy(1100);
    const entry = mode === 'edit' ? Store.update(sh.id, payload) : Store.add(payload);
    if (!entry) return;
    sh.lastType = sh.type;
    closeSheet({ restoreFocus: mode === 'add' });

    const [ey, em] = entry.date.split('-').map(Number);
    const moved = ey !== state.y || em !== state.m;
    const dir = monthIndex(ey, em) > monthIndex(state.y, state.m) ? 1 : -1;
    if (moved) {
      state.y = ey;
      state.m = em;
      watchMonth(ey, em);
      renderMonthLabel(dir);
    }
    // 달력에서 연 기록은 달력에 그대로 머물고, 그 밖에는 내역으로 가서 새 기록을 보여 줍니다
    if (state.tab !== 'list' && !fromCalendar) setTab('list');

    setTimeout(() => {
      renderList({ flip: !moved, enterDir: moved ? dir : null, fresh: entry.id });
      renderStats({ animate: moved && statsVisible(), dir });
      const balance = $('#balance');
      const row = $(`.entry[data-id="${CSS.escape(entry.id)}"]`);
      if (entry.type === 'income' && isVisible(balance) && mode === 'add' && Store.ready(state.y, state.m)) {
        M.FX.coinsTo(fromRect, balance, {
          count: 10,
          onArrive: () => {
            renderSummary();
            pulse(balance);
          },
        });
      } else {
        renderSummary();
        if (isVisible(balance) && Store.ready(state.y, state.m)) {
          pulse(balance);
          if (entry.type === 'expense' && mode === 'add') M.FX.coinBurst(balance, { count: 8 });
        }
      }
      if (row && listVisible()) {
        revealRow(row);
        setTimeout(() => M.FX.sparkles(row, { count: 8 }), 420);
        if (mode === 'edit') row.focus({ preventScroll: true });
      }
      flashCalDay(entry.date);
    }, 170);

    const c = Store.category(entry.type, entry.cat);
    if (mode === 'edit') {
      toast('기록을 고쳤어요.', { icon: 'check' });
      say(`${c.name} 기록을 고쳤어요. 잘못 적은 걸 바로잡는 것도 중요해요!`, { hop: true });
    } else {
      toast(`${TYPE_NAME[entry.type]} ${fmt(entry.amount)}원을 기록했어요.`, { icon: entry.type === 'income' ? 'pouch' : 'basket' });
      say(
        entry.type === 'income'
          ? `와, ${c.name} ${fmt(entry.amount)}원이 들어왔어요! 도토리 창고가 든든해졌어요.`
          : `${c.name}에 ${fmt(entry.amount)}원, 잘 적어 뒀어요. 꼼꼼해요!`,
        { hop: true }
      );
    }
  }

  function deleteFromSheet() {
    const id = state.sheet.id;
    const entry = Store.get(id);
    if (!entry) return;
    busy(1200);
    closeSheet({ restoreFocus: false });
    const row = $(`.entry[data-id="${CSS.escape(id)}"]`);
    const finish = () => {
      Store.remove(id);
      renderList({ flip: true });
      renderSummary();
      renderStats({ animate: false });
      addButton().focus({ preventScroll: true });
    };
    setTimeout(() => {
      if (row && isVisible(row)) {
        M.FX.poof(row);
        collapse(row.parentElement).then(finish);
      } else finish();
    }, 200);
    toast('기록을 지웠어요.', {
      icon: 'trash',
      action: '되돌리기',
      onAction: () => {
        busy(900);
        const back = Store.restore(entry);
        const [ry, rm] = back.date.split('-').map(Number);
        if (ry !== state.y || rm !== state.m) {
          const d = monthIndex(ry, rm) > monthIndex(state.y, state.m) ? 1 : -1;
          state.y = ry;
          state.m = rm;
          watchMonth(ry, rm);
          renderMonthLabel(d);
          renderList({ enterDir: d, fresh: back.id });
        } else renderList({ flip: true, fresh: back.id });
        renderSummary();
        renderStats({ animate: false });
        toast('지운 기록을 되살렸어요.', { icon: 'sprout' });
      },
    });
  }

  /* ───────── 처음 나타나는 움직임 ───────── */
  function rise(els, base = 60) {
    if (M.reduced()) return;
    els.forEach((el, i) => {
      M.animate(el, [{ opacity: 0, transform: 'translateY(28px) scale(.97)' }, { opacity: 1, transform: 'none' }], {
        duration: M.SPRING_SOFT.duration + 200,
        easing: M.SPRING_SOFT.easing,
        delay: base + i * 90,
        fill: 'backwards',
      });
    });
  }
  function popIn(el, delay) {
    M.animate(el, [{ transform: 'translateY(30px) scale(.3)', opacity: 0 }, { transform: 'none', opacity: 1 }], {
      duration: M.SPRING.duration,
      easing: M.SPRING.easing,
      delay,
      fill: 'backwards',
    });
  }
  function intro() {
    if (M.reduced()) return;
    const parts = [$('.hero'), $('#app > .talk')];
    if (!wide) parts.push($('#view-tabs'));
    if (!$('#panel-list').hidden) parts.push($('#panel-list'));
    if (!$('#panel-stats').hidden) parts.push($('#cal-card'), $('#pie-card'));
    rise(parts);
    if (wide) rise([$('.month-bar')], 0);
    M.animate($('#fab'), [{ transform: 'scale(0) rotate(-200deg)' }, { transform: 'none' }], {
      duration: M.SPRING.duration + 100,
      easing: M.SPRING.easing,
      delay: 520,
      fill: 'backwards',
    });
    popIn($('#tori'), 300);
  }
  function authIntro() {
    if (M.reduced()) return;
    rise($$('#auth > .talk, #auth > .auth-card'));
    popIn($('#auth-tori'), 240);
  }

  /* ───────── 이벤트 ───────── */
  function bind() {
    $('#theme-btn').addEventListener('click', toggleTheme);
    new MutationObserver(syncTheme).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    mqDark.addEventListener('change', syncTheme);
    $('#layout-btn').addEventListener('click', toggleLayout);
    mqWide.addEventListener('change', () => applyLayout());

    $$('.nav-btn').forEach((b) => b.addEventListener('click', () => changeMonth(+b.dataset.dir)));

    $('#tab-list').addEventListener('click', () => setTab('list'));
    $('#tab-stats').addEventListener('click', () => setTab('stats'));
    $('#view-tabs').addEventListener('keydown', (e) => {
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight' || e.key === 'Home' || e.key === 'End') {
        e.preventDefault();
        const toStats = e.key === 'End' || (e.key !== 'Home' && state.tab === 'list');
        setTab(toStats ? 'stats' : 'list', { focus: true });
      }
    });
    $$('input[name="stat-kind"]').forEach((r) => r.addEventListener('change', () => setStatKind(r.value)));

    $('#bubble').addEventListener('click', nextLine);
    $('#tori').addEventListener('click', () => {
      M.FX.sparkles($('#tori'), { count: 6 });
      nextLine();
    });

    // 계정 메뉴
    $('#account-btn').addEventListener('click', () => toggleAccountMenu());
    $('#logout-btn').addEventListener('click', logout);
    document.addEventListener('pointerdown', (e) => {
      if (!$('#account-menu').hidden && !e.target.closest('#account')) toggleAccountMenu(false);
      if (!e.target.closest('.pie-wrap, .legend')) KINDS.forEach((k) => setPieActive(k, -1));
    });

    // 기록 시트 열기
    $('#fab').addEventListener('click', (e) => openSheet({ mode: 'add', opener: e.currentTarget }));
    $('#list-add').addEventListener('click', (e) => openSheet({ mode: 'add', opener: e.currentTarget }));
    $('#list').addEventListener('click', (e) => {
      const btn = e.target.closest('.entry');
      if (!btn) return;
      const entry = Store.get(btn.dataset.id);
      if (entry) openSheet({ mode: 'edit', entry, opener: btn });
    });

    // 내역 칸
    $('#list-expand').addEventListener('click', () => setListFull(!state.listFull));
    $('#list-scrim').addEventListener('click', () => setListFull(false));
    let fadeTick = false;
    $('#list-scroll').addEventListener(
      'scroll',
      () => {
        if (fadeTick) return;
        fadeTick = true;
        requestAnimationFrame(() => {
          fadeTick = false;
          updateFades();
        });
      },
      { passive: true }
    );

    // 달력
    const cal = $('#cal-grid');
    cal.addEventListener('click', (e) => {
      const btn = e.target.closest('.cal-day');
      if (!btn) return;
      state.calFocus = btn.dataset.date;
      for (const b of $$('.cal-day', cal)) b.tabIndex = b === btn ? 0 : -1;
      if (!Store.ready(state.y, state.m)) return;
      if (btn.classList.contains('has')) goToDay(btn.dataset.date);
      else openSheet({ mode: 'add', opener: btn, date: btn.dataset.date, from: 'calendar' });
    });
    cal.addEventListener('keydown', (e) => {
      const btn = e.target.closest('.cal-day');
      if (!btn) return;
      const d = +btn.dataset.day;
      const days = new Date(state.y, state.m, 0).getDate();
      const wd = new Date(state.y, state.m - 1, d).getDay();
      const moves = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7, Home: -wd, End: 6 - wd };
      if (!Object.prototype.hasOwnProperty.call(moves, e.key)) return;
      e.preventDefault();
      focusCalDay(Math.min(days, Math.max(1, d + moves[e.key])));
    });

    // 원그래프: 조각이나 범례에 올리면 그 조각이 살짝 튀어나옵니다
    for (const kind of KINDS) {
      const block = $(`#pie-${kind}`);
      const canvas = $('.pie-canvas', block);
      const onCanvas = (e) => setPieActive(kind, pieIndexAt(kind, e), { tip: true });
      canvas.addEventListener('pointermove', onCanvas);
      canvas.addEventListener('pointerdown', onCanvas);
      canvas.addEventListener('pointerleave', (e) => {
        if (e.pointerType === 'mouse') setPieActive(kind, -1);
      });
      const legend = $('.legend', block);
      legend.addEventListener('pointerover', (e) => {
        const row = e.target.closest('.lg-row');
        if (row) setPieActive(kind, +row.dataset.i);
      });
      legend.addEventListener('pointerleave', () => setPieActive(kind, -1));
      legend.addEventListener('click', (e) => {
        const more = e.target.closest('.lg-more');
        if (!more) return;
        const open = more.getAttribute('aria-expanded') !== 'true';
        state.otherOpen[kind] = open;
        setOtherOpen(kind, open, { animate: true });
      });
    }

    // 현재 잔액 맞추기
    const dlg = $('#adjust-dialog');
    $('#adjust-btn').addEventListener('click', openAdjust);
    $('#adjust-form').addEventListener('submit', submitAdjust);
    $$('[data-adjust-close]').forEach((b) => b.addEventListener('click', () => dlg.close()));
    dlg.addEventListener('close', () => {
      syncScrollLock();
      if (state.screen === 'app') $('#adjust-btn').focus({ preventScroll: true });
    });
    // 바깥(어두운 부분)을 눌렀다 뗐을 때만 닫습니다 (입력칸에서 끌어 선택하다 바깥에서 놓은 경우는 제외)
    let downOutside = false;
    dlg.addEventListener('pointerdown', (e) => {
      downOutside = e.target === dlg;
    });
    dlg.addEventListener('click', (e) => {
      if (downOutside && e.target === dlg) dlg.close();
    });
    $('#adjust-sign').addEventListener('click', () => {
      setAdjustSign($('#adjust-sign').getAttribute('aria-pressed') !== 'true');
      adjustError('');
    });
    $('#adjust-amount').addEventListener('input', (e) => {
      const el = e.target;
      if (/^\s*[-−]/.test(el.value)) setAdjustSign(true);
      const digits = el.value.replace(/\D/g, '').replace(/^0+(?=\d)/, '').slice(0, 11);
      el.value = digits ? fmt(Number(digits)) : '';
      adjustError('');
    });

    // 시트 안
    $$('[data-close]').forEach((el) => el.addEventListener('click', () => closeSheet()));
    $$('input[name="type"]').forEach((r) =>
      r.addEventListener('change', () => {
        setType(r.value);
        hideError('cat');
      })
    );
    const amount = $('#amount');
    const toEnd = () => {
      const n = amount.value.length;
      try {
        amount.setSelectionRange(n, n);
      } catch {
        /* 일부 입력 형식은 커서 이동을 지원하지 않습니다 */
      }
    };
    amount.addEventListener('input', () => {
      const digits = amount.value.replace(/\D/g, '').replace(/^0+/, '').slice(0, 10);
      setAmount(digits ? +digits : 0);
      toEnd();
      hideError('amount');
    });
    amount.addEventListener('focus', toEnd);
    amount.addEventListener('click', toEnd);
    amount.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        const target = $('#cat-grid input:checked') || $('#cat-grid input');
        if (target) target.focus();
      }
    });
    $('.quick').addEventListener('click', (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      if ('clear' in b.dataset) setAmount(0);
      else setAmount(state.sheet.amount + +b.dataset.add);
      hideError('amount');
      M.animate(b, [{ transform: 'translateY(3px) scale(.92)' }, { transform: 'none' }], {
        duration: M.SPRING.duration,
        easing: M.SPRING.easing,
      });
    });
    $('#cat-grid').addEventListener('change', (e) => {
      if (e.target.name !== 'cat') return;
      state.sheet.cat = e.target.value;
      hideError('cat');
      M.FX.sparkles(e.target.parentElement.querySelector('.tile'), { count: 6, spread: 1.3 });
    });
    $('#date').addEventListener('change', () => hideError('date'));
    sheetEl().addEventListener('submit', (e) => {
      e.preventDefault();
      submitSheet();
    });
    $('#delete-btn').addEventListener('click', deleteFromSheet);

    // 로그인 화면
    $('#auth-tab-login').addEventListener('click', () => setAuthMode('login'));
    $('#auth-tab-signup').addEventListener('click', () => setAuthMode('signup'));
    $('#auth-tabs').addEventListener('keydown', (e) => {
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight' || e.key === 'Home' || e.key === 'End') {
        e.preventDefault();
        const toSignup = e.key === 'End' || (e.key !== 'Home' && state.authMode === 'login');
        setAuthMode(toSignup ? 'signup' : 'login', { focus: true });
      }
    });
    $('#auth-form').addEventListener('submit', submitAuth);
    $('#google-btn').addEventListener('click', googleAuth);
    $('#forgot-btn').addEventListener('click', forgotPassword);
    $('#retry-btn').addEventListener('click', () => window.location.reload());
    $('#pw-toggle').addEventListener('click', () => {
      const input = $('#auth-pw');
      const show = input.type === 'password';
      input.type = show ? 'text' : 'password';
      const t = $('#pw-toggle');
      t.textContent = show ? '숨기기' : '보기';
      t.setAttribute('aria-pressed', String(show));
      t.setAttribute('aria-label', show ? '비밀번호 숨기기' : '비밀번호 보기');
    });
    $('#auth-bubble').addEventListener('click', nextAuthLine);
    $('#auth-tori').addEventListener('click', () => {
      M.FX.sparkles($('#auth-tori'), { count: 6 });
      nextAuthLine();
    });

    document.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape' || dlg.open) return;
      if (state.sheet.open) {
        e.preventDefault();
        closeSheet();
      } else if (state.listFull) {
        e.preventDefault();
        setListFull(false);
      } else if (!$('#account-menu').hidden) {
        toggleAccountMenu(false);
        $('#account-btn').focus();
      }
    });

    // 스크롤하면 하늘이 살짝 따라 올라가며 깊이감을 줍니다
    let ticking = false;
    window.addEventListener(
      'scroll',
      () => {
        if (ticking || M.reduced()) return;
        ticking = true;
        requestAnimationFrame(() => {
          ticking = false;
          document.documentElement.style.setProperty('--scroll', String(Math.min(window.scrollY, 1200)));
        });
      },
      { passive: true }
    );

    // 칸 크기가 바뀌면 달력 금액을 다시 맞추고 원그래프를 다시 그립니다
    let sizeTick = false;
    const onResize = () => {
      if (sizeTick) return;
      sizeTick = true;
      requestAnimationFrame(() => {
        sizeTick = false;
        if (state.screen !== 'app') return;
        fitCalendar();
        for (const k of KINDS) {
          const cv = $(`#pie-${k} .pie-canvas`);
          if (cv.clientWidth && Math.max(24, Math.round(cv.clientWidth / 3)) !== cv.width) drawPie(k);
        }
        autoFoldLegend();
        updateFades();
      });
    };
    if (window.ResizeObserver) {
      const ro = new window.ResizeObserver(onResize);
      ro.observe($('#cal-grid'));
      ro.observe($('#list-scroll'));
      ro.observe($('#pie-card .card-body'));
      $$('.pie-canvas').forEach((c) => ro.observe(c));
    } else window.addEventListener('resize', onResize);
    if (document.fonts) {
      document.fonts.ready.then(onResize);
      document.fonts.addEventListener('loadingdone', onResize);
    }

    // 다른 기기에서 지난 달 기록을 고쳤을 수도 있으니, 화면으로 돌아오거나 5분마다 잔액 합계를 다시 셉니다
    const refreshTotals = () => {
      if (state.screen === 'app' && !document.hidden) Store.refreshTotals();
    };
    document.addEventListener('visibilitychange', refreshTotals);
    window.addEventListener('focus', refreshTotals);
    window.setInterval(refreshTotals, 5 * 60 * 1000);

    Store.onChange(onStoreChange);
    Store.onError(onStoreError);
    Store.onTotals(() => {
      if (state.screen !== 'app') return;
      paintBalances();
      paintCurrent();
    });
  }

  /* ───────── 시작 ───────── */
  function waitForCloud(ms) {
    return new Promise((resolve) => {
      if (window.Cloud) {
        resolve(window.Cloud);
        return;
      }
      const timer = setTimeout(() => resolve({ configured: true, ready: false, reason: 'timeout' }), ms);
      window.addEventListener(
        'moa:cloud',
        () => {
          clearTimeout(timer);
          resolve(window.Cloud);
        },
        { once: true }
      );
    });
  }

  async function boot() {
    paintSprites();
    odometer = new M.Odometer($('#balance .odo'));
    M.Scene.build(today.getMonth() + 1);
    M.setupLayer('ambient');
    M.setupLayer('fx');
    buildCategoryGrid('expense');
    state.layoutChoice = readLayoutChoice();
    document.documentElement.dataset.screen = state.screen;
    applyLayout();
    bind();
    syncTheme();
    rise([$('.topbar')], 0);

    const cloud = await waitForCloud(20000);
    state.cloud = cloud;
    if (!cloud.ready) {
      showAuth({ notice: cloud.reason || 'load' });
      return;
    }
    cloud.onAuth((user) => {
      if (user) enterApp(user);
      else showAuth();
    });
  }

  boot();
})();
