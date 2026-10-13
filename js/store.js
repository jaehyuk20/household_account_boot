/*
 * 데이터: 카테고리 정의와 기록 저장소 (브라우저 localStorage)
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

  const KEY = 'moa-ledger/v1';
  const MAX_AMOUNT = 9999999999;

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

  function uid() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  /* ───────── 처음 열었을 때 보여 줄 예시 ───────── */
  function sampleEntries() {
    const now = new Date();
    const rows = [
      [0, 'expense', 'food', 8500, '점심 김밥'],
      [0, 'expense', 'cafe', 4800, '아이스 라떼'],
      [1, 'expense', 'transport', 1500, '버스'],
      [1, 'expense', 'living', 23400, '마트 장보기'],
      [2, 'income', 'side', 120000, '디자인 외주'],
      [3, 'expense', 'leisure', 15000, '영화 관람'],
      [4, 'expense', 'shopping', 39000, '가을 니트'],
      [5, 'expense', 'food', 32000, '친구랑 저녁'],
      [6, 'expense', 'health', 12000, '약국'],
      [8, 'income', 'salary', 2850000, '@월급'],
      [9, 'expense', 'housing', 550000, '월세'],
      [10, 'expense', 'gift', 50000, '친구 생일 선물'],
      [12, 'income', 'resale', 25000, '중고 책 판매'],
      [15, 'expense', 'education', 45000, '온라인 강의'],
      [18, 'expense', 'travel', 180000, '제주 숙소'],
      [22, 'expense', 'cafe', 6200, '조각 케이크'],
      [25, 'income', 'allowance', 100000, '부모님 용돈'],
      [38, 'income', 'salary', 2850000, '@월급'],
      [40, 'expense', 'housing', 550000, '월세'],
    ];
    return rows.map(([ago, type, cat, amount, memo], i) => {
      const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - ago);
      return {
        id: 'sample-' + i,
        type,
        cat,
        amount,
        date: toISO(d),
        memo: memo === '@월급' ? `${d.getMonth() + 1}월 월급` : memo,
        createdAt: d.getTime() + (rows.length - i),
        sample: true,
      };
    });
  }

  /* ───────── 저장소 ───────── */
  let data = { version: 1, entries: [] };
  let persistent = true;

  function load() {
    let raw = null;
    try {
      raw = global.localStorage.getItem(KEY);
    } catch {
      persistent = false;
    }
    if (raw) {
      try {
        const parsed = JSON.parse(raw);
        if (parsed && Array.isArray(parsed.entries)) {
          data = { version: 1, entries: parsed.entries.filter(valid) };
          return;
        }
      } catch {
        /* 깨진 데이터는 무시하고 새로 시작 */
      }
    }
    data = { version: 1, entries: sampleEntries() };
    save();
  }

  function valid(e) {
    return (
      e &&
      typeof e.id === 'string' &&
      (e.type === 'income' || e.type === 'expense') &&
      Number.isFinite(e.amount) &&
      e.amount > 0 &&
      /^\d{4}-\d{2}-\d{2}$/.test(e.date)
    );
  }

  function save() {
    if (!persistent) return;
    try {
      global.localStorage.setItem(KEY, JSON.stringify(data));
    } catch {
      persistent = false;
    }
  }

  const Store = {
    CATEGORIES,
    MAX_AMOUNT,
    category,
    toISO,
    todayISO,
    parseISO,
    monthKey,
    KEY,
    load,
    get persistent() {
      return persistent;
    },
    all() {
      return data.entries.slice();
    },
    get(id) {
      return data.entries.find((e) => e.id === id) || null;
    },
    add(input) {
      const entry = {
        id: uid(),
        type: input.type,
        cat: input.cat,
        amount: Math.min(MAX_AMOUNT, Math.round(input.amount)),
        date: input.date,
        memo: (input.memo || '').trim().slice(0, 40),
        createdAt: Date.now(),
      };
      data.entries.push(entry);
      save();
      return entry;
    },
    update(id, patch) {
      const e = this.get(id);
      if (!e) return null;
      Object.assign(e, {
        type: patch.type,
        cat: patch.cat,
        amount: Math.min(MAX_AMOUNT, Math.round(patch.amount)),
        date: patch.date,
        memo: (patch.memo || '').trim().slice(0, 40),
      });
      delete e.sample;
      save();
      return e;
    },
    remove(id) {
      const i = data.entries.findIndex((e) => e.id === id);
      if (i < 0) return null;
      const [removed] = data.entries.splice(i, 1);
      save();
      return removed;
    },
    restore(entry) {
      if (this.get(entry.id)) return entry;
      data.entries.push(entry);
      save();
      return entry;
    },
    hasSamples() {
      return data.entries.some((e) => e.sample);
    },
    clearSamples() {
      const removed = data.entries.filter((e) => e.sample);
      data.entries = data.entries.filter((e) => !e.sample);
      save();
      return removed;
    },
    /** 해당 달의 기록 (최근 날짜, 최근 입력 순) */
    month(y, m) {
      const key = monthKey(y, m);
      return data.entries
        .filter((e) => e.date.slice(0, 7) === key)
        .sort((a, b) => (a.date === b.date ? b.createdAt - a.createdAt : a.date < b.date ? 1 : -1));
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
