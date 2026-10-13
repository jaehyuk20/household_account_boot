/*
 * 데이터: 카테고리 정의와 기록 저장소
 * 기록은 로그인한 사람의 클라우드 공간(window.Cloud)에 달마다 나눠 실시간으로 받아 옵니다.
 * 추가·수정·삭제는 화면에 먼저 반영하고(낙관적 갱신) 저장은 뒤에서 이어서 합니다.
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
  const KEEP_MONTHS = 4; // 실시간 구독을 유지할 최근 달 수

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

  /* 서버에서 받은 문서는 모양을 확인한 뒤에만 씁니다 */
  function normalize(raw) {
    if (!raw || typeof raw.id !== 'string') return null;
    if (raw.type !== 'income' && raw.type !== 'expense') return null;
    if (!Number.isFinite(raw.amount) || raw.amount <= 0) return null;
    if (typeof raw.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(raw.date)) return null;
    return {
      id: raw.id,
      type: raw.type,
      cat: typeof raw.cat === 'string' ? raw.cat : '',
      amount: Math.round(raw.amount),
      date: raw.date,
      memo: typeof raw.memo === 'string' ? raw.memo : '',
      createdAt: Number.isFinite(raw.createdAt) ? raw.createdAt : 0,
      updatedAt: Number.isFinite(raw.updatedAt) ? raw.updatedAt : 0,
    };
  }
  function sortEntries(list) {
    return list.sort((a, b) => (a.date === b.date ? b.createdAt - a.createdAt : a.date < b.date ? 1 : -1));
  }
  function clean(input) {
    return {
      type: input.type,
      cat: String(input.cat),
      amount: Math.min(MAX_AMOUNT, Math.round(input.amount)),
      date: input.date,
      memo: String(input.memo || '').trim().slice(0, 40),
    };
  }

  /* ───────── 저장소 ───────── */
  let cloud = null;
  let uid = null;
  let clock = 0;
  const months = new Map(); // 'YYYY-MM' → { entries, ready, unsub, used }
  const changeFns = new Set();
  const errorFns = new Set();

  const emitChange = (key) => changeFns.forEach((fn) => fn(key));
  const emitError = (kind, err) => errorFns.forEach((fn) => fn(kind, err));

  function evict(keep) {
    if (months.size <= KEEP_MONTHS) return;
    const old = [...months.entries()].filter(([k]) => k !== keep).sort((a, b) => a[1].used - b[1].used);
    while (months.size > KEEP_MONTHS && old.length) {
      const [k, slot] = old.shift();
      if (slot.unsub) slot.unsub();
      months.delete(k);
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
    cloud.put(uid, id, data).catch((err) => emitError('write', err));
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
        (docs) => {
          if (months.get(key) !== slot) return;
          slot.entries = sortEntries(docs.map(normalize).filter(Boolean));
          slot.ready = true;
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

    get(id) {
      return findLocal(id);
    },
    add(input) {
      const now = Date.now();
      const entry = { id: cloud.newId(uid), ...clean(input), createdAt: now, updatedAt: now };
      placeLocal(entry);
      persist(entry);
      return entry;
    },
    update(id, patch) {
      const old = findLocal(id);
      if (!old) return null;
      const entry = { ...old, ...clean(patch), updatedAt: Date.now() };
      dropLocal(id);
      placeLocal(entry);
      persist(entry);
      return entry;
    },
    remove(id) {
      const old = findLocal(id);
      if (!old) return null;
      dropLocal(id);
      cloud.remove(uid, id).catch((err) => emitError('delete', err));
      return old;
    },
    restore(entry) {
      placeLocal(entry);
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
  };

  global.Store = Store;
})(window);
