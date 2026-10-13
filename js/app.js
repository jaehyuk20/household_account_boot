/*
 * 모아봐요 가계부 — 화면 동작
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

  const today = new Date();
  const state = {
    y: today.getFullYear(),
    m: today.getMonth() + 1,
    tab: 'list',
    statKind: 'expense',
    sheet: { open: false, mode: 'add', id: null, type: 'expense', amount: 0, cat: null, opener: null, origin: null, lastType: 'expense' },
    talk: { lines: [], idx: 0, ctrl: null },
  };
  let odometer = null;
  let prevSummary = { income: 0, expense: 0 };

  /* 받침에 따라 조사 고르기 (예: 식비예요 / 교육이에요) */
  function josa(word, withFinal, withoutFinal) {
    const code = word.charCodeAt(word.length - 1) - 0xac00;
    if (code < 0 || code > 11171) return withoutFinal;
    return code % 28 ? withFinal : withoutFinal;
  }
  const signed = (type, n) => (type === 'income' ? '+' : MINUS) + fmt(n);
  const isCurrentMonth = () => state.y === today.getFullYear() && state.m === today.getMonth() + 1;
  const monthIndex = (y, m) => y * 12 + m;

  /* ───────── 정적 스프라이트 채우기 ───────── */
  function paintSprites(root = document) {
    for (const img of $$('img[data-sprite]', root)) {
      const name = img.dataset.sprite;
      const scale = +(img.dataset.scale || 2);
      const { w, h } = S.size(name);
      img.src = S.url(name);
      img.width = w * scale;
      img.height = h * scale;
      img.classList.add('px-img');
      img.draggable = false;
    }
    $('#tori').style.setProperty('--img', `url("${S.sheet('tori')}")`);
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
    const img = btn.querySelector('img');
    img.src = S.url(dark ? 'sun' : 'moon');
    const meta = $('meta[name="theme-color"]');
    if (meta) meta.content = dark ? '#10173a' : '#8fd8f7';
    M.Ambient.start(today.getMonth() + 1, dark);
  }
  function toggleTheme() {
    const next = currentTheme() === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    try {
      localStorage.setItem('moa-theme', next);
    } catch {
      /* 저장할 수 없어도 화면 전환은 됩니다 */
    }
    const img = $('#theme-btn img');
    M.animate(img, [{ transform: 'rotate(-180deg) scale(.4)', opacity: 0 }, { transform: 'none', opacity: 1 }], {
      duration: M.SPRING.duration,
      easing: M.SPRING.easing,
    });
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
    const s = Store.summary(state.y, state.m);
    const bal = $('#balance');
    bal.classList.toggle('is-neg', s.balance < 0);
    bal.querySelector('.sign').textContent = s.balance < 0 ? MINUS : s.balance > 0 ? '+' : '';
    bal.classList.toggle('long', fmt(Math.abs(s.balance)).length > 10);
    odometer.set(s.balance, { instant: !animate, delay });
    $('#balance-sr').textContent = `${s.balance < 0 ? '마이너스 ' : ''}${fmt(Math.abs(s.balance))}원`;
    $('#balance-label').textContent = isCurrentMonth() ? '이번 달 남은 돈' : `${state.m}월 남은 돈`;

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
    if (e.sample) {
      const tag = document.createElement('span');
      tag.className = 'sample-tag';
      tag.textContent = '예시';
      cat.appendChild(tag);
    }
    main.appendChild(cat);
    if (e.memo) {
      const memo = document.createElement('span');
      memo.className = 'e-memo';
      memo.textContent = e.memo;
      main.appendChild(memo);
    }
    const amt = document.createElement('span');
    amt.className = 'e-amt ' + (e.type === 'income' ? 'in' : 'out');
    amt.textContent = signed(e.type, e.amount) + '원';
    btn.append(img, main, amt);
    btn.setAttribute(
      'aria-label',
      `${c.name} ${TYPE_NAME[e.type]} ${fmt(e.amount)}원${e.memo ? ', ' + e.memo : ''}${e.sample ? ', 예시' : ''}. 눌러서 고치기`
    );
    li.appendChild(btn);
    return li;
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

    if (flip) playFlip(list, before, fresh);
    else if (enterDir !== null) cascade(list, enterDir, delay);
    if (fresh) {
      const el = list.querySelector(`.entry[data-id="${CSS.escape(fresh)}"]`);
      if (el) {
        el.classList.add('fresh');
        setTimeout(() => el.classList.remove('fresh'), 1900);
      }
    }
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

  // 높이를 접으며 사라지게 합니다. gap은 부모 그리드 간격까지 함께 접을 때 씁니다.
  function collapse(li, delay = 0, gap = 0) {
    if (!li || M.reduced()) return Promise.resolve();
    const h = li.getBoundingClientRect().height;
    li.style.overflow = 'hidden';
    const a = li.animate(
      [
        { height: h + 'px', marginTop: '0px', opacity: 1, transform: 'none' },
        { height: '0px', marginTop: `-${gap}px`, opacity: 0, transform: 'scale(.92)' },
      ],
      { duration: 280, delay, easing: M.EASE_IN, fill: 'forwards' }
    );
    return a.finished.catch(() => {});
  }

  /* ───────── 통계 ───────── */
  function renderStats({ animate = true } = {}) {
    const kind = state.statKind;
    const rows = Store.byCategory(state.y, state.m, kind);
    const total = rows.reduce((a, r) => a + r.sum, 0);
    const count = rows.reduce((a, r) => a + r.count, 0);
    const bars = $('#bars');
    bars.dataset.kind = kind;
    bars.textContent = '';
    const totalEl = $('#stats-total');
    totalEl.textContent = '';
    if (total) {
      totalEl.append(`${TYPE_NAME[kind]} 합계 `);
      const b = document.createElement('b');
      b.textContent = `${fmt(total)}원`;
      totalEl.append(b, ` · ${count}건`);
    }
    $('#stats-empty').hidden = rows.length > 0;
    $('#stats-empty-title').textContent = `이 달에는 ${TYPE_NAME[kind]} 기록이 없어요`;
    const max = rows.length ? rows[0].sum : 1;
    rows.forEach((r, i) => {
      const pct = (r.sum / total) * 100;
      const li = document.createElement('li');
      li.className = 'bar-row';
      li.innerHTML =
        `<img class="px-img" alt="" width="32" height="32" src="${S.url(r.cat.icon)}">` +
        '<div class="bar-body"><div class="bar-top"><span class="bar-name"></span><span class="bar-val"></span></div>' +
        '<div class="bar-track px"><div class="bar-fill px"></div></div></div>';
      const name = li.querySelector('.bar-name');
      name.textContent = r.cat.name;
      const cnt = document.createElement('span');
      cnt.className = 'bar-count';
      cnt.textContent = `${r.count}건`;
      name.appendChild(cnt);
      const val = li.querySelector('.bar-val');
      val.textContent = `${fmt(r.sum)}원`;
      const em = document.createElement('em');
      em.textContent = pct < 1 ? '1% 미만' : `${Math.round(pct)}%`;
      val.appendChild(em);
      const fill = li.querySelector('.bar-fill');
      fill.style.setProperty('--w', (r.sum / max).toFixed(4));
      bars.appendChild(li);
      if (animate) {
        M.animate(fill, [{ transform: 'scaleX(0)' }, { transform: 'none' }], {
          duration: 900,
          delay: 120 + i * 70,
          easing: M.SPRING_SOFT.easing,
          fill: 'backwards',
        });
        M.animate(li, [{ opacity: 0, transform: 'translateY(10px)' }, { opacity: 1, transform: 'none' }], {
          duration: 420,
          delay: 40 + i * 70,
          easing: M.EASE_OUT,
          fill: 'backwards',
        });
      }
    });
  }

  /* ───────── 탭 ───────── */
  function setTab(tab, { focus = false } = {}) {
    if (state.tab === tab) return;
    state.tab = tab;
    const isList = tab === 'list';
    $('.tabs').style.setProperty('--tab', isList ? 0 : 1);
    const tl = $('#tab-list');
    const ts = $('#tab-stats');
    tl.setAttribute('aria-selected', String(isList));
    ts.setAttribute('aria-selected', String(!isList));
    tl.tabIndex = isList ? 0 : -1;
    ts.tabIndex = isList ? -1 : 0;
    if (focus) (isList ? tl : ts).focus();
    const show = isList ? $('#panel-list') : $('#panel-stats');
    const hide = isList ? $('#panel-stats') : $('#panel-list');
    hide.hidden = true;
    show.hidden = false;
    M.animate(show, [{ opacity: 0, transform: `translateX(${isList ? -24 : 24}px)` }, { opacity: 1, transform: 'none' }], {
      duration: M.SPRING_SOFT.duration,
      easing: M.SPRING_SOFT.easing,
    });
    if (isList) cascade($('#list'), 0);
    else renderStats({ animate: true });
  }

  function setStatKind(kind) {
    state.statKind = kind;
    const seg = $('.seg');
    seg.dataset.kind = kind;
    seg.style.setProperty('--seg', kind === 'expense' ? 0 : 1);
    renderStats({ animate: true });
  }

  /* ───────── 달 이동 ───────── */
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
    renderMonthLabel(dir);
    renderSummary();
    const panel = state.tab === 'list' ? $('#panel-list .panel-inner') : $('#bars');
    const redraw = () => {
      renderList({ enterDir: state.tab === 'list' ? dir : null });
      renderStats({ animate: state.tab === 'stats' });
    };
    const out = M.reduced()
      ? null
      : M.animate(panel, [{ opacity: 1, transform: 'none' }, { opacity: 0, transform: `translateX(${-dir * 28}px)` }], {
          duration: 150,
          easing: M.EASE_IN,
        });
    if (out) out.onfinish = redraw;
    else redraw();
    refreshTalk();
  }

  /* ───────── 토리의 말 ───────── */
  function greeting() {
    const h = new Date().getHours();
    if (h >= 5 && h < 11) return '좋은 아침이에요! 오늘도 도토리를 차곡차곡 모아 봐요.';
    if (h >= 11 && h < 17) return '점심은 먹었어요? 먹은 것도 잊기 전에 적어 두면 좋아요.';
    if (h >= 17 && h < 22) return '오늘 하루도 수고했어요. 자기 전에 오늘 쓴 돈을 한번 정리해 봐요.';
    return '밤이 깊었어요. 오늘 기록만 마무리하고 푹 쉬어요.';
  }

  function buildLines() {
    const s = Store.summary(state.y, state.m);
    const entries = Store.month(state.y, state.m);
    const cur = isCurrentMonth();
    const when = cur ? '이번 달' : `${state.m}월`;
    const lines = [];
    if (!entries.length) {
      lines.push(
        cur
          ? '이번 달 기록은 아직 없어요. 아래 나뭇잎 버튼을 눌러 첫 기록을 남겨 봐요!'
          : `${state.m}월에는 기록이 없어요. 날짜를 골라 지난 기록도 남길 수 있어요.`
      );
    } else {
      lines.push(`${when} 수입은 ${fmt(s.income)}원, 지출은 ${fmt(s.expense)}원이에요.`);
      if (s.income && s.expense > s.income) {
        lines.push('지출이 수입보다 많아요. 겨울을 나려면 도토리를 조금 아껴 둬야 해요!');
      } else if (s.income) {
        const pct = Math.round((s.expense / s.income) * 100);
        lines.push(
          pct <= 50 ? `수입의 ${pct}%만 썼어요. 알뜰하게 잘 모으고 있어요!` : `수입의 ${pct}%를 썼어요. 남은 날도 차근차근 가 봐요.`
        );
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
    if (Store.hasSamples()) lines.push('지금 기록은 예시예요. 예시 지우기를 누르면 깨끗한 가계부로 시작해요.');
    lines.push(greeting());
    return lines;
  }

  function say(text, { hop = false } = {}) {
    const tori = $('#tori');
    const bubble = $('#bubble');
    bubble.classList.remove('done');
    tori.classList.add('is-talking');
    if (hop) {
      tori.classList.remove('hop');
      void tori.offsetWidth;
      tori.classList.add('hop');
    }
    $('#talk-live').textContent = text;
    state.talk.ctrl = M.typewriter($('#talk-text'), text, {
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
    say(first || state.talk.lines[0]);
  }
  function nextLine() {
    const c = state.talk.ctrl;
    if (c && !c.done) {
      c.skip();
      return;
    }
    const t = state.talk;
    t.lines = buildLines();
    t.idx = (t.idx + 1) % t.lines.length;
    say(t.lines[t.idx], { hop: true });
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

  /* ───────── 예시 안내 ───────── */
  function renderSampleNote() {
    $('#sample-note').hidden = !Store.hasSamples();
  }
  function clearSamples() {
    const rows = $$('.entry[data-id^="sample-"]');
    rows.forEach((r, i) => setTimeout(() => M.FX.poof(r), i * 45));
    const note = $('#sample-note');
    Promise.all([...rows.map((r, i) => collapse(r.parentElement, i * 45)), collapse(note, 120, 18)]).then(() => {
      note.getAnimations().forEach((a) => a.cancel());
      note.style.overflow = '';
      Store.clearSamples();
      renderAll();
      refreshTalk('예시를 모두 치웠어요. 이제부터 여기는 당신만의 가계부예요!');
      toast('예시 기록을 모두 지웠어요.', { icon: 'sprout' });
    });
  }

  /* ───────── 기록 시트 ───────── */
  const sheetEl = () => $('#sheet');

  function defaultDate() {
    if (isCurrentMonth()) return Store.todayISO();
    const viewed = monthIndex(state.y, state.m);
    const now = monthIndex(today.getFullYear(), today.getMonth() + 1);
    const day = viewed < now ? new Date(state.y, state.m, 0).getDate() : 1;
    return `${state.y}-${String(state.m).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
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
    const box = field === 'amount' ? $('#amount-field') : field === 'cat' ? $('#cats') : $('#date-field');
    box.classList.remove('shake');
    void box.offsetWidth;
    box.classList.add('shake');
  }
  function hideError(field) {
    const p = $(`#${field}-error`);
    if (p) p.hidden = true;
  }

  function lockPage(lock) {
    $('#app').inert = lock;
    $('.fab-wrap').inert = lock;
    document.documentElement.style.overflow = lock ? 'hidden' : '';
  }

  function openSheet({ mode = 'add', entry = null, opener = null } = {}) {
    const sh = state.sheet;
    if (sh.open) return;
    sh.open = true;
    sh.mode = mode;
    sh.id = entry ? entry.id : null;
    sh.opener = opener;

    const layer = $('#sheet-layer');
    const sheet = sheetEl();
    const iris = $('#iris');
    sheet.getAnimations().forEach((a) => a.cancel());
    iris.getAnimations().forEach((a) => a.cancel());

    setType(entry ? entry.type : sh.lastType, { animate: false });
    selectCat(entry ? entry.cat : null);
    setAmount(entry ? entry.amount : 0, { animate: false });
    $('#date').value = entry ? entry.date : defaultDate();
    $('#memo').value = entry ? entry.memo : '';
    $('#sheet-title').textContent = mode === 'edit' ? '기록 고치기' : '새 기록';
    $('#save-btn .label-text').textContent = mode === 'edit' ? '고친 내용 저장' : '기록하기';
    $('#delete-btn').hidden = mode !== 'edit';
    ['amount', 'cat', 'date'].forEach(hideError);

    layer.hidden = false;
    lockPage(true);
    $('#fab').classList.add('is-open');
    sheet.querySelector('.sheet-scroll').scrollTop = 0;

    const r = (opener || $('#fab')).getBoundingClientRect();
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
    return r.bottom > 0 && r.top < innerHeight;
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
      renderMonthLabel(dir);
    }
    if (state.tab !== 'list') setTab('list');

    setTimeout(() => {
      renderList({ flip: !moved, enterDir: moved ? dir : null, fresh: entry.id });
      renderStats({ animate: false });
      renderSampleNote();
      const balance = $('#balance');
      const row = $(`.entry[data-id="${CSS.escape(entry.id)}"]`);
      if (entry.type === 'income' && isVisible(balance) && mode === 'add') {
        M.FX.coinsTo(fromRect, balance, {
          count: 10,
          onArrive: () => {
            renderSummary();
            pulse(balance);
          },
        });
      } else {
        renderSummary();
        if (isVisible(balance)) {
          pulse(balance);
          if (entry.type === 'expense' && mode === 'add') M.FX.coinBurst(balance, { count: 8 });
        }
      }
      if (row) {
        if (!isVisible(row)) row.scrollIntoView({ block: 'center', behavior: M.reduced() ? 'auto' : 'smooth' });
        setTimeout(() => M.FX.sparkles(row, { count: 8 }), 420);
        if (mode === 'edit') row.focus({ preventScroll: true });
      }
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
    closeSheet({ restoreFocus: false });
    const row = $(`.entry[data-id="${CSS.escape(id)}"]`);
    const finish = () => {
      Store.remove(id);
      renderList({ flip: true });
      renderSummary();
      renderStats({ animate: false });
      renderSampleNote();
      $('#fab').focus({ preventScroll: true });
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
        const back = Store.restore(entry);
        const [ry, rm] = back.date.split('-').map(Number);
        if (ry !== state.y || rm !== state.m) {
          const d = monthIndex(ry, rm) > monthIndex(state.y, state.m) ? 1 : -1;
          state.y = ry;
          state.m = rm;
          renderMonthLabel(d);
          renderList({ enterDir: d, fresh: back.id });
        } else renderList({ flip: true, fresh: back.id });
        renderSummary();
        renderStats({ animate: false });
        renderSampleNote();
        toast('지운 기록을 되살렸어요.', { icon: 'sprout' });
      },
    });
  }

  /* ───────── 전체 그리기 ───────── */
  function renderAll({ intro = false } = {}) {
    renderMonthLabel(0);
    renderSummary({ animate: true, delay: intro ? 420 : 0 });
    renderList({ enterDir: intro ? 0 : null, delay: intro ? 520 : 0 });
    renderStats({ animate: false });
    renderSampleNote();
  }

  function intro() {
    if (M.reduced()) return;
    const seq = $$('.topbar, .hero, .talk, #sample-note:not([hidden]), .tabs, .panel:not([hidden])');
    seq.forEach((el, i) => {
      M.animate(el, [{ opacity: 0, transform: 'translateY(28px) scale(.97)' }, { opacity: 1, transform: 'none' }], {
        duration: M.SPRING_SOFT.duration + 200,
        easing: M.SPRING_SOFT.easing,
        delay: 60 + i * 90,
        fill: 'backwards',
      });
    });
    M.animate($('#fab'), [{ transform: 'scale(0) rotate(-200deg)' }, { transform: 'none' }], {
      duration: M.SPRING.duration + 100,
      easing: M.SPRING.easing,
      delay: 620,
      fill: 'backwards',
    });
    M.animate($('#tori'), [{ transform: 'translateY(30px) scale(.3)', opacity: 0 }, { transform: 'none', opacity: 1 }], {
      duration: M.SPRING.duration,
      easing: M.SPRING.easing,
      delay: 330,
      fill: 'backwards',
    });
  }

  /* ───────── 이벤트 ───────── */
  function bind() {
    $('#theme-btn').addEventListener('click', toggleTheme);
    new MutationObserver(syncTheme).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    mqDark.addEventListener('change', syncTheme);

    $$('.nav-btn').forEach((b) => b.addEventListener('click', () => changeMonth(+b.dataset.dir)));

    $('#tab-list').addEventListener('click', () => setTab('list'));
    $('#tab-stats').addEventListener('click', () => setTab('stats'));
    $('.tabs').addEventListener('keydown', (e) => {
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

    $('#clear-samples').addEventListener('click', clearSamples);

    $('#fab').addEventListener('click', (e) => openSheet({ mode: 'add', opener: e.currentTarget }));
    $('#list').addEventListener('click', (e) => {
      const btn = e.target.closest('.entry');
      if (!btn) return;
      const entry = Store.get(btn.dataset.id);
      if (entry) openSheet({ mode: 'edit', entry, opener: btn });
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

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && state.sheet.open) {
        e.preventDefault();
        closeSheet();
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

    // 다른 탭에서 바꾼 기록도 따라갑니다
    window.addEventListener('storage', (e) => {
      if (e.key !== Store.KEY) return;
      Store.load();
      renderAll();
      refreshTalk();
    });
  }

  /* ───────── 시작 ───────── */
  function start() {
    Store.load();
    paintSprites();
    odometer = new M.Odometer($('#balance .odo'));
    M.Scene.build(today.getMonth() + 1);
    M.setupLayer('ambient');
    M.setupLayer('fx');
    buildCategoryGrid('expense');
    bind();
    syncTheme();
    renderAll({ intro: true });
    intro();
    state.talk.lines = buildLines();
    setTimeout(() => say(state.talk.lines[0], { hop: true }), M.reduced() ? 0 : 700);
  }

  start();
})();
