/*
 * 데이터: 카테고리 정의와 기록 저장소
 * 기록은 로그인한 사람의 클라우드 공간(window.Cloud)에 달마다 나눠 실시간으로 받아 옵니다.
 * 추가·수정·삭제는 화면에 먼저 반영하고(낙관적 갱신) 저장은 뒤에서 이어서 합니다.
 *
 * 잔액은 처음 기록부터 이어집니다. 잔액 = 시작 잔액 + 그때까지 모든 기록의 delta 합계.
 * delta는 수입이면 +금액, 지출이면 −금액이고, 지난 달까지의 합계는 서버에서 바로 셉니다.
 */
(function (global) {
  'use strict';

  const CATEGORIES = {
    expense: [
      { id: 'food', name: '식비', icon: 'food', tile: '#ffd5b0', lip: '#efb27f' },
      { id: 'cafe', name: '카페·간식', icon: 'cafe', tile: '#f2dfc8', lip: '#d8b48d' },
      { id: 'living', name: '생활·마트', icon: 'living', tile: '#d3f0dd', lip: '#9fd4b1' },
      { id: 'shopping', name: '쇼핑·미용', icon: 'shopping', tile: '#ffdbe7', lip: '#f0a9c2' },
      { id: 'transport', name: '교통·차량', icon: 'transport', tile: '#d2efe9', lip: '#93d0c3' },
      { id: 'housing', name: '주거·통신', icon: 'housing', tile: '#fff0c4', lip: '#e8cf82' },
      { id: 'health', name: '의료·건강', icon: 'health', tile: '#e2f1ff', lip: '#acd0ef' },
      { id: 'leisure', name: '문화·여가', icon: 'leisure', tile: '#ebe2fd', lip: '#c4b1ee' },
      { id: 'travel', name: '여행·숙박', icon: 'travel', tile: '#d3ebff', lip: '#97c6ee' },
      { id: 'education', name: '교육', icon: 'education', tile: '#e5f5cd', lip: '#b9da8b' },
      { id: 'gift', name: '경조·선물', icon: 'gift', tile: '#ffe2de', lip: '#f0aca4' },
      { id: 'etc', name: '기타', icon: 'etc', tile: '#ece6da', lip: '#cdc1aa' },
    ],
    income: [
      { id: 'salary', name: '월급', icon: 'salary', tile: '#fff1bd', lip: '#e9cd6c' },
      { id: 'bonus', name: '상여금', icon: 'bonus', tile: '#ffe9c6', lip: '#f0c275' },
      { id: 'side', name: '부업·알바', icon: 'side', tile: '#dff0ea', lip: '#a6cfc1' },
      { id: 'allowance', name: '용돈', icon: 'allowance', tile: '#ffdde9', lip: '#f0a7c1' },
      { id: 'invest', name: '금융·투자', icon: 'invest', tile: '#d8f5e2', lip: '#9cdab3' },
      { id: 'resale', name: '중고판매', icon: 'resale', tile: '#dbefff', lip: '#a0cbee' },
      { id: 'refund', name: '환급·캐시백', icon: 'refund', tile: '#e6f6d6', lip: '#b1da92' },
      { id: 'income-etc', name: '기타', icon: 'clover', tile: '#ece6da', lip: '#cdc1aa' },
    ],
  };

  const CAT_INDEX = {};
  for (const type of Object.keys(CATEGORIES)) {
    for (const c of CATEGORIES[type]) CAT_INDEX[type + ':' + c.id] = c;
  }
  function category(type, id) {
    return CAT_INDEX[type + ':' + id] || (type === 'income' ? CAT_INDEX['income:income-etc'] : CAT_INDEX['expense:etc']);
  }

  const MAX_AMOUNT = 9999999999;
  const MAX_BALANCE = 99999999999;
  const KEEP_MONTHS = 4; // 실시간 구독을 유지할 최근 달 수
  const SCHEMA = 2; // 2: 기록마다 delta 필드가 있음

  /* ───────── 날짜 도우미 (로컬 시간 기준) ───────── */
  const pad = (n) => String(n).padStart(2, '0');
  function toISO(d) {
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  }
  function todayISO() {
    return toISO(new Date());
  }
  function parseISO(s) {
    const [y, m, d] = s.split('-').map(Number);
    return new Date(y, m - 1, d);
  }
  function monthKey(y, m) {
    return `${y}-${pad(m)}`;
  }
  function monthRange(y, m) {
    const next = m === 12 ? [y + 1, 1] : [y, m + 1];
    return [`${monthKey(y, m)}-01`, `${monthKey(next[0], next[1])}-01`];
  }

  const signedOf = (e) => (e.type === 'income' ? e.amount : -e.amount);

  /* 서버에서 받은 문서는 모양을 확인한 뒤에만 씁니다 */
  function normalize(raw) {
    if (!raw || typeof raw.id !== 'string') return null;
    if (raw.type !== 'income' && raw.type !== 'expense') return null;
    if (!Number.isFinite(raw.amount) || raw.amount <= 0) return null;
    if (typeof raw.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(raw.date)) return null;
    const e = {
      id: raw.id,
      type: raw.type,
      cat: typeof raw.cat === 'string' ? raw.cat : '',
      amount: Math.round(raw.amount),
      date: raw.date,
      memo: typeof raw.memo === 'string' ? raw.memo : '',
      createdAt: Number.isFinite(raw.createdAt) ? raw.createdAt : 0,
      updatedAt: Number.isFinite(raw.updatedAt) ? raw.updatedAt : 0,
    };
    e.delta = signedOf(e);
    return e;
  }
  /** 최근 날짜, 같은 날이면 최근 입력이 먼저 */
  function sortEntries(list) {
    return list.sort((a, b) => (a.date === b.date ? b.createdAt - a.createdAt : a.date < b.date ? 1 : -1));
  }
  function clean(input) {
    const type = input.type;
    const amount = Math.min(MAX_AMOUNT, Math.round(input.amount));
    return {
      type,
      cat: String(input.cat),
      amount,
      delta: type === 'income' ? amount : -amount,
      date: input.date,
      memo: String(input.memo || '').trim().slice(0, 40),
    };
  }

  /* ───────── 저장소 ───────── */
  let cloud = null;
  let uid = null;
  let clock = 0;
  let session = 0;
  const months = new Map(); // 'YYYY-MM' → { entries, ready, unsub, used }
  const changeFns = new Set();
  const errorFns = new Set();
  const totalsFns = new Set();

  /* 잔액 계산에 쓰는 합계들. 값이 오래되면(stale) 다시 받는 동안에도 이전 값을 보여 줍니다. */
  const totals = {
    ready: false, // 프로필 확인과 이전 기록 정리가 끝났는지
    opening: 0, // 시작 잔액
    upTo: null, // { day, value }: 오늘까지 delta 합계
    before: new Map(), // 'YYYY-MM' → { value }: 그 달 1일 전까지 delta 합계
    stale: new Set(),
    inflight: new Map(),
    pending: 0, // 아직 서버에 닿지 않은 저장 수
    timer: 0,
    failedAt: 0, // 마지막으로 합계를 못 센 시각 (잠깐 쉬었다가 다시 셉니다)
  };
  const RETRY_MS = 30000;

  const emitChange = (key) => changeFns.forEach((fn) => fn(key));
  const emitError = (kind, err) => errorFns.forEach((fn) => fn(kind, err));
  const emitTotals = () => totalsFns.forEach((fn) => fn());

  function resetTotals() {
    clearTimeout(totals.timer);
    totals.ready = false;
    totals.opening = 0;
    totals.upTo = null;
    totals.before = new Map();
    totals.stale = new Set();
    totals.inflight = new Map();
    totals.pending = 0;
    totals.failedAt = 0;
  }

  /* 로그인 직후 한 번: 시작 잔액을 읽고, 예전 기록에 delta가 없으면 채웁니다 */
  async function prepare(sid) {
    try {
      const profile = (await cloud.getProfile(uid)) || {};
      if (sid !== session) return;
      totals.opening = Number.isFinite(profile.openingBalance) ? profile.openingBalance : 0;
      if (!(profile.schema >= SCHEMA)) {
        const all = await cloud.allEntries(uid);
        if (sid !== session) return;
        const fixes = all
          .filter((e) => (e.type === 'income' || e.type === 'expense') && Number.isFinite(e.amount) && e.delta !== signedOf(e))
          .map((e) => ({ id: e.id, delta: signedOf(e) }));
        if (fixes.length) await cloud.patchDeltas(uid, fixes);
        await cloud.saveProfile(uid, { schema: SCHEMA });
      }
      if (sid !== session) return;
      totals.ready = true;
      totals.failedAt = 0;
      emitTotals();
    } catch (err) {
      if (sid !== session) return;
      totals.failedAt = Date.now();
      emitError('totals', err);
      emitTotals();
      // 오프라인이었을 수 있으니 잠시 뒤에 다시 해 봅니다
      setTimeout(() => {
        if (sid === session) ensurePrepared();
      }, RETRY_MS);
    }
  }
  let preparing = 0; // 준비 중인 세션 번호 (0이면 없음)
  function ensurePrepared() {
    if (!uid || totals.ready || preparing === session) return;
    const sid = session;
    preparing = sid;
    prepare(sid).finally(() => {
      if (preparing === sid) preparing = 0;
    });
  }

  function fetchSum(key, cond, { force = false } = {}) {
    if (totals.inflight.has(key)) return;
    // 실패한 직후(색인이 없거나 오프라인)에는 화면을 그릴 때마다 다시 묻지 않습니다
    if (!force && totals.failedAt && Date.now() - totals.failedAt < RETRY_MS) return;
    const sid = session;
    const inflight = totals.inflight;
    const job = cloud
      .sumDelta(uid, cond)
      .then(
        (value) => {
          if (sid !== session) return;
          // 저장이 진행 중이면 서버 합계가 아직 옛날 값이라 덮어쓰지 않고 나중에 다시 셉니다
          if (totals.pending > 0) {
            scheduleRefresh();
            return;
          }
          if (key === 'upTo') totals.upTo = { day: cond.upTo, value };
          else totals.before.set(key, { value });
          totals.stale.delete(key);
          totals.failedAt = 0;
          emitTotals();
        },
        (err) => {
          if (sid !== session) return;
          totals.failedAt = Date.now();
          emitError('totals', err);
          emitTotals();
        }
      )
      .finally(() => inflight.delete(key));
    inflight.set(key, job);
  }

  /* 서버 합계를 다시 셉니다 (저장이 끝난 뒤, 다른 기기에서 바뀐 뒤, 화면으로 돌아왔을 때) */
  function scheduleRefresh(delay = 900) {
    clearTimeout(totals.timer);
    totals.timer = setTimeout(() => {
      if (!uid || !totals.ready) return;
      if (totals.pending > 0) {
        scheduleRefresh(delay);
        return;
      }
      for (const key of totals.before.keys()) {
        totals.stale.add(key);
        fetchSum(key, { before: key + '-01' }, { force: true });
      }
      totals.stale.add('upTo');
      fetchSum('upTo', { upTo: todayISO() }, { force: true });
    }, delay);
  }

  /* 화면을 바로 맞추려고 서버 합계를 기다리지 않고 직접 더하고 뺍니다 */
  function adjust(oldE, newE) {
    for (const [key, slot] of totals.before) {
      const start = key + '-01';
      if (oldE && oldE.date < start) slot.value -= oldE.delta;
      if (newE && newE.date < start) slot.value += newE.delta;
    }
    const day = todayISO();
    if (totals.upTo && totals.upTo.day === day) {
      if (oldE && oldE.date <= day) totals.upTo.value -= oldE.delta;
      if (newE && newE.date <= day) totals.upTo.value += newE.delta;
    }
    emitTotals();
  }

  function track(promise, kind) {
    const sid = session;
    totals.pending++;
    promise.then(
      () => {
        if (sid !== session) return;
        totals.pending--;
        scheduleRefresh();
      },
      (err) => {
        if (sid !== session) return;
        totals.pending--;
        scheduleRefresh(200);
        emitError(kind, err);
      }
    );
  }

  function evict(keep) {
    if (months.size <= KEEP_MONTHS) return;
    const old = [...months.entries()].filter(([k]) => k !== keep).sort((a, b) => a[1].used - b[1].used);
    while (months.size > KEEP_MONTHS && old.length) {
      const [k, slot] = old.shift();
      if (slot.unsub) slot.unsub();
      months.delete(k);
      totals.before.delete(k);
    }
  }

  function findLocal(id) {
    for (const slot of months.values()) {
      const e = slot.entries.find((x) => x.id === id);
      if (e) return e;
    }
    return null;
  }
  function placeLocal(entry) {
    const slot = months.get(entry.date.slice(0, 7));
    if (slot && slot.ready) slot.entries = sortEntries(slot.entries.filter((e) => e.id !== entry.id).concat(entry));
  }
  function dropLocal(id) {
    for (const slot of months.values()) slot.entries = slot.entries.filter((e) => e.id !== id);
  }
  function persist(entry) {
    const { id, ...data } = entry;
    track(cloud.put(uid, id, data), 'write');
  }

  const Store = {
    CATEGORIES,
    MAX_AMOUNT,
    category,
    toISO,
    todayISO,
    parseISO,
    monthKey,

    /** 로그인한 사람의 저장소를 엽니다 */
    begin(cloudApi, userId) {
      this.end();
      cloud = cloudApi;
      uid = userId;
      session++;
      ensurePrepared();
    },
    /** 구독을 모두 끊고 메모리에 있던 기록을 비웁니다 (로그아웃) */
    end() {
      for (const slot of months.values()) {
        try {
          if (slot.unsub) slot.unsub();
        } catch {
          /* 이미 닫힌 연결이면 무시합니다 */
        }
      }
      months.clear();
      uid = null;
      session++;
      resetTotals();
    },
    get active() {
      return Boolean(uid);
    },

    /** 그 달을 실시간으로 받기 시작합니다. 이미 받아 둔 달이면 true */
    watch(y, m) {
      if (!uid) return false;
      const key = monthKey(y, m);
      let slot = months.get(key);
      if (slot) {
        slot.used = ++clock;
        return slot.ready;
      }
      slot = { entries: [], ready: false, unsub: null, used: ++clock };
      months.set(key, slot);
      const [start, end] = monthRange(y, m);
      slot.unsub = cloud.listenMonth(
        uid,
        start,
        end,
        (docs, meta) => {
          if (months.get(key) !== slot) return;
          const wasReady = slot.ready;
          slot.entries = sortEntries(docs.map(normalize).filter(Boolean));
          slot.ready = true;
          // 서버가 확인한 변화(다른 기기에서 고친 것 포함)면 잔액 합계도 다시 셉니다
          if (wasReady && meta && !meta.pending) scheduleRefresh(1200);
          emitChange(key);
        },
        (err) => {
          if (months.get(key) === slot) months.delete(key);
          emitError('read', err);
        }
      );
      evict(key);
      return false;
    },
    ready(y, m) {
      const slot = months.get(monthKey(y, m));
      return Boolean(slot && slot.ready);
    },
    onChange(fn) {
      changeFns.add(fn);
    },
    onError(fn) {
      errorFns.add(fn);
    },
    onTotals(fn) {
      totalsFns.add(fn);
    },

    get(id) {
      return findLocal(id);
    },
    add(input) {
      const now = Date.now();
      const entry = { id: cloud.newId(uid), ...clean(input), createdAt: now, updatedAt: now };
      placeLocal(entry);
      adjust(null, entry);
      persist(entry);
      return entry;
    },
    update(id, patch) {
      const old = findLocal(id);
      if (!old) return null;
      const entry = { ...old, ...clean(patch), updatedAt: Date.now() };
      dropLocal(id);
      placeLocal(entry);
      adjust(old, entry);
      persist(entry);
      return entry;
    },
    remove(id) {
      const old = findLocal(id);
      if (!old) return null;
      dropLocal(id);
      adjust(old, null);
      track(cloud.remove(uid, id), 'delete');
      return old;
    },
    restore(entry) {
      placeLocal(entry);
      adjust(null, entry);
      persist(entry);
      return entry;
    },

    /** 그 달의 기록 (최근 날짜, 최근 입력 순) */
    month(y, m) {
      const slot = months.get(monthKey(y, m));
      return slot ? slot.entries.slice() : [];
    },
    /** 화면을 다시 그려야 하는지 비교할 때 쓰는 지문 */
    signature(y, m) {
      const slot = months.get(monthKey(y, m));
      if (!slot || !slot.ready) return 'loading';
      return slot.entries.map((e) => `${e.id}:${e.updatedAt}:${e.amount}:${e.date}:${e.type}:${e.cat}:${e.memo}`).join('|');
    },
    summary(y, m) {
      let income = 0;
      let expense = 0;
      for (const e of this.month(y, m)) {
        if (e.type === 'income') income += e.amount;
        else expense += e.amount;
      }
      return { income, expense, balance: income - expense };
    },
    byCategory(y, m, type) {
      const map = new Map();
      for (const e of this.month(y, m)) {
        if (e.type !== type) continue;
        const c = category(type, e.cat);
        const row = map.get(c.id) || { cat: c, sum: 0, count: 0 };
        row.sum += e.amount;
        row.count += 1;
        map.set(c.id, row);
      }
      return [...map.values()].sort((a, b) => b.sum - a.sum);
    },
    /** 날짜별 수입·지출 합계 */
    byDay(y, m) {
      const map = new Map();
      for (const e of this.month(y, m)) {
        const day = map.get(e.date) || { income: 0, expense: 0, count: 0 };
        day[e.type] += e.amount;
        day.count += 1;
        map.set(e.date, day);
      }
      return map;
    },

    /* ───────── 잔액 ───────── */
    get opening() {
      return totals.opening;
    },
    /** 잔액 합계를 서버에서 세지 못한 상태인지 (색인 없음, 권한 없음, 오프라인) */
    get totalsFailed() {
      return Boolean(totals.failedAt);
    },
    /** 그 달 1일이 되기 직전의 잔액 (아직 모르면 null) */
    carry(y, m) {
      if (!uid || !totals.ready) return null;
      const key = monthKey(y, m);
      const slot = totals.before.get(key);
      if (!slot || totals.stale.has(key)) fetchSum(key, { before: key + '-01' });
      return slot ? totals.opening + slot.value : null;
    },
    /** 오늘까지 기록을 모두 반영한 현재 잔액 (아직 모르면 null) */
    current() {
      if (!uid || !totals.ready) return null;
      const day = todayISO();
      const s = totals.upTo;
      if (!s || s.day !== day || totals.stale.has('upTo')) fetchSum('upTo', { upTo: day });
      return s && s.day === day ? totals.opening + s.value : null;
    },
    /** 그 달 기록마다 '거래 후 잔액' (날짜순, 같은 날은 입력순으로 누적) */
    balances(y, m) {
      const base = this.carry(y, m);
      if (base === null) return null;
      const asc = this.month(y, m).sort((a, b) => (a.date === b.date ? a.createdAt - b.createdAt : a.date < b.date ? -1 : 1));
      const out = new Map();
      let bal = base;
      for (const e of asc) {
        bal += e.delta;
        out.set(e.id, bal);
      }
      return out;
    },
    /** 지금 실제로 가진 돈을 알려 주면 시작 잔액을 거꾸로 계산해 맞춥니다 */
    async setActualBalance(actual) {
      if (!uid) throw new Error('signed-out');
      const sid = session;
      await cloud.flush();
      const day = todayISO();
      const sum = await cloud.sumDelta(uid, { upTo: day });
      const opening = Math.round(actual) - sum;
      if (Math.abs(opening) > MAX_BALANCE) throw Object.assign(new Error('out-of-range'), { code: 'out-of-range' });
      await cloud.saveProfile(uid, { openingBalance: opening, schema: SCHEMA });
      if (sid !== session) return;
      totals.opening = opening;
      totals.upTo = { day, value: sum };
      totals.stale.delete('upTo');
      emitTotals();
    },
    /** 다른 기기에서 바뀌었을 수 있으니 합계를 다시 셉니다 */
    refreshTotals() {
      if (!totals.ready) ensurePrepared();
      else scheduleRefresh(50);
    },
  };

  global.Store = Store;
})(window);
