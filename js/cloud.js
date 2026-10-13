/*
 * 클라우드 연결: Firebase 인증(로그인)과 Firestore(기록 저장)
 * 다른 스크립트는 window.Cloud 하나만 보고 동작합니다. 준비가 끝나면 'moa:cloud' 이벤트를 보냅니다.
 */
const SDK = 'https://www.gstatic.com/firebasejs/12.19.0';

function announce(api) {
  window.Cloud = api;
  window.dispatchEvent(new Event('moa:cloud'));
}

// 로컬에서 ?emulator 로 열면 Firebase 에뮬레이터(auth 9099, firestore 8080)에 붙습니다.
const isLocal = ['localhost', '127.0.0.1'].includes(location.hostname);
const useEmulator = isLocal && new URLSearchParams(location.search).has('emulator');

let config = window.MOA_FIREBASE_CONFIG || {};
if (useEmulator && !config.apiKey) {
  config = { apiKey: 'demo-key', authDomain: 'demo-moa.firebaseapp.com', projectId: 'demo-moa', appId: 'demo-app' };
}
const configured = Boolean(config.apiKey && config.projectId && config.appId);

async function connect() {
  const [fbApp, fbAuth, fbStore] = await Promise.all([
    import(`${SDK}/firebase-app.js`),
    import(`${SDK}/firebase-auth.js`),
    import(`${SDK}/firebase-firestore.js`),
  ]);
  const app = fbApp.initializeApp(config);
  const auth = fbAuth.getAuth(app);
  auth.languageCode = 'ko';
  if (useEmulator) fbAuth.connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });

  let db = null;
  const openDb = () => {
    db = fbStore.getFirestore(app);
    if (useEmulator) fbStore.connectFirestoreEmulator(db, '127.0.0.1', 8080);
  };
  openDb();
  // 로그인한 사람이 바뀌면 Firestore를 닫고 새로 엽니다.
  // 앞사람의 기록이 같은 탭의 메모리 캐시에 남아 다음 사람에게 보이는 일을 막습니다.
  const resetDb = async () => {
    const old = db;
    await fbStore.terminate(old).catch(() => {});
    openDb();
  };
  let lastUid = null;
  let queue = Promise.resolve();

  const toUser = (u) => (u ? { uid: u.uid, email: u.email || '', name: u.displayName || '' } : null);
  const entries = (uid) => fbStore.collection(db, 'users', uid, 'entries');

  return {
    configured: true,
    ready: true,
    emulator: useEmulator,
    onAuth(cb) {
      return fbAuth.onAuthStateChanged(auth, (u) => {
        const uid = u ? u.uid : null;
        const changed = lastUid !== null && lastUid !== uid;
        lastUid = uid;
        if (changed) queue = queue.then(resetDb);
        queue = queue.then(() => cb(toUser(u)));
      });
    },
    async signIn(email, password) {
      await fbAuth.signInWithEmailAndPassword(auth, email, password);
    },
    async signUp(email, password, name) {
      const cred = await fbAuth.createUserWithEmailAndPassword(auth, email, password);
      if (name) await fbAuth.updateProfile(cred.user, { displayName: name });
      return toUser(cred.user);
    },
    async signInGoogle() {
      const provider = new fbAuth.GoogleAuthProvider();
      provider.setCustomParameters({ prompt: 'select_account' });
      await fbAuth.signInWithPopup(auth, provider);
    },
    async resetPassword(email) {
      await fbAuth.sendPasswordResetEmail(auth, email);
    },
    async signOut() {
      // 아직 서버에 닿지 않은 저장이 있으면 잠깐 기다렸다가 로그아웃합니다
      await Promise.race([fbStore.waitForPendingWrites(db), new Promise((r) => setTimeout(r, 3000))]).catch(() => {});
      await fbAuth.signOut(auth);
    },
    newId(uid) {
      return fbStore.doc(entries(uid)).id;
    },
    /** 한 달 치 기록을 실시간으로 받습니다. 돌려준 함수를 부르면 구독을 끊습니다. */
    listenMonth(uid, start, end, onData, onError) {
      const q = fbStore.query(entries(uid), fbStore.where('date', '>=', start), fbStore.where('date', '<', end));
      return fbStore.onSnapshot(
        q,
        (snap) => onData(snap.docs.map((d) => ({ id: d.id, ...d.data() }))),
        onError
      );
    },
    put(uid, id, data) {
      return fbStore.setDoc(fbStore.doc(db, 'users', uid, 'entries', id), data);
    },
    remove(uid, id) {
      return fbStore.deleteDoc(fbStore.doc(db, 'users', uid, 'entries', id));
    },
  };
}

if (!configured) {
  announce({ configured: false, ready: false, reason: 'config' });
} else {
  try {
    announce(await connect());
  } catch (err) {
    console.error('Firebase를 불러오지 못했어요.', err);
    announce({ configured: true, ready: false, reason: 'load' });
  }
}
