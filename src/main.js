
import './style.css';

import { auth, db } from './firebase.js';

import {
  signInWithEmailAndPassword,
  onAuthStateChanged,
  signOut
} from 'firebase/auth';

import {
  collection,
  addDoc,
  doc,
  getDoc,
  updateDoc,
  onSnapshot,
  query,
  where,
  serverTimestamp
} from 'firebase/firestore';

const app = document.querySelector('#app');

let currentUser = null;
let currentRole = null;
let entries = [];
let unsubscribeEntries = null;
let editingId = null;

const money = n => Number(n || 0).toLocaleString('en-US');

function today() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

function escapeHTML(value) {
  return String(value ?? '').replace(/[&<>"']/g, c => ({
    '&':'&amp;', '<':'&lt;', '>':'&gt;',
    '"':'&quot;', "'":'&#39;'
  })[c]);
}

function showMessage(message, error = false) {
  const el = document.querySelector('#message');
  if (!el) return;
  el.textContent = message;
  el.className = error ? 'status-message error-message' : 'status-message';
}

function showLogin() {
  app.innerHTML = `
    <div class="app-header">
      <h1>🚖 CNG হিসাব</h1>
      <p>গাড়ির দৈনিক হিসাব ব্যবস্থাপনা</p>
    </div>

    <div class="card">
      <h2>অ্যাকাউন্ট লগইন</h2>
      <div class="form-group">
        <label>ইমেইল</label>
        <input id="email" type="email" placeholder="আপনার ইমেইল">
      </div>
      <div class="form-group">
        <label>পাসওয়ার্ড</label>
        <input id="password" type="password" placeholder="পাসওয়ার্ড">
      </div>
      <button id="loginBtn">লগইন করুন</button>
      <div id="message"></div>
    </div>
  `;

  document.querySelector('#loginBtn').onclick = async () => {
    const email = document.querySelector('#email').value.trim();
    const password = document.querySelector('#password').value;

    if (!email || !password) {
      showMessage('ইমেইল ও পাসওয়ার্ড লিখুন।', true);
      return;
    }

    try {
      document.querySelector('#loginBtn').disabled = true;
      await signInWithEmailAndPassword(auth, email, password);
    } catch (error) {
      showMessage(error.message, true);
      document.querySelector('#loginBtn').disabled = false;
    }
  };
}

function showDashboard() {
  app.innerHTML = `
    <div class="app-header">
      <h1>🚖 CNG হিসাব</h1>
      <p>দৈনিক আয় ও খরচ ব্যবস্থাপনা</p>
      <p id="userInfo"></p>
    </div>

    <div class="summary-grid">
      <div class="summary-box">
        <p>মোট জমা</p>
        <strong id="totalDeposit">৳ 0</strong>
      </div>
      <div class="summary-box">
        <p>মোট গাড়ির খরচ</p>
        <strong id="totalExpense">৳ 0</strong>
      </div>
      <div class="summary-box">
        <p>মোট নির্ধারিত জমা</p>
        <strong id="totalDue">৳ 0</strong>
      </div>
      <div class="summary-box due">
        <p>মোট বকেয়া</p>
        <strong id="totalOutstanding">৳ 0</strong>
      </div>
    </div>

    <div class="card">
      <h2 id="formTitle">📝 নতুন দৈনিক হিসাব</h2>

      <div class="form-group">
        <label>তারিখ</label>
        <input id="date" type="date" value="${today()}">
      </div>

      <div class="form-group">
        <label>আজকের অবস্থা</label>
        <select id="dayType">
          <option value="working">গাড়ি চালু — ৬৫০ টাকা</option>
          <option value="off">গাড়ি বন্ধ — ০ টাকা</option>
        </select>
      </div>

      <div class="form-group">
        <label>আজকের জমা (টাকা)</label>
        <input id="deposit" type="number" min="0" inputmode="decimal" placeholder="জমার টাকা লিখুন">
      </div>

      <div class="form-group">
        <label>গাড়ির খরচ (টাকা)</label>
        <input id="expense" type="number" min="0" inputmode="decimal" placeholder="খরচ লিখুন">
      </div>

      <div class="form-group">
        <label>মন্তব্য / খরচের বিবরণ</label>
        <textarea id="note" placeholder="যেমন: মেরামত, তেল, যন্ত্রাংশ"></textarea>
      </div>

      <button id="saveBtn">হিসাব জমা দিন</button>
      <button id="cancelBtn" class="btn-secondary hidden">পরিবর্তন বাতিল</button>

      <div id="message"></div>
    </div>

    <div class="card">
      <h2>📋 দৈনিক হিসাবের তালিকা</h2>
      <div id="entriesList">হিসাব লোড হচ্ছে...</div>
    </div>

    <button id="logoutBtn" class="btn-danger">লগআউট</button>
  `;

  document.querySelector('#userInfo').textContent =
    `ইমেইল: ${currentUser.email} | ভূমিকা: ${currentRole === 'admin' ? 'Admin' : 'Entry User'}`;

  document.querySelector('#logoutBtn').onclick = async () => {
    await signOut(auth);
  };

  document.querySelector('#saveBtn').onclick = saveEntry;
  document.querySelector('#cancelBtn').onclick = cancelEdit;

  document.querySelector('#dayType').onchange = () => {
    showMessage('নির্বাচিত দৈনিক জমা: ' +
      (document.querySelector('#dayType').value === 'off' ? '০' : '৬৫০') + ' টাকা');
  };

  document.querySelector('#entriesList').onclick = event => {
    const btn = event.target.closest('[data-edit]');
    if (btn) editEntry(btn.dataset.edit);
  };
}

function listenEntries() {
  if (unsubscribeEntries) unsubscribeEntries();

  let q = collection(db, 'entries');


  unsubscribeEntries = onSnapshot(q, snapshot => {
    entries = snapshot.docs.map(d => ({
      id: d.id,
      ...d.data()
    }));

    entries.sort((a,b) => String(b.date).localeCompare(String(a.date)));

    renderEntries();
  }, error => {
    showMessage('হিসাব লোড হয়নি: ' + error.message, true);
  });
}

function renderEntries() {
  let totalDue = 0;
  let totalDeposit = 0;
  let totalExpense = 0;

  entries.forEach(item => {
    totalDue += Number(item.due || 0);
    totalDeposit += Number(item.deposit || 0);
    totalExpense += Number(item.expense || 0);
  });

  document.querySelector('#totalDeposit').textContent = '৳ ' + money(totalDeposit);
  document.querySelector('#totalExpense').textContent = '৳ ' + money(totalExpense);
  document.querySelector('#totalDue').textContent = '৳ ' + money(totalDue);
  document.querySelector('#totalOutstanding').textContent =
    '৳ ' + money(totalDue - totalDeposit);

  const list = document.querySelector('#entriesList');

  if (entries.length === 0) {
    list.textContent = 'এখনো কোনো হিসাব জমা হয়নি।';
    return;
  }

  list.innerHTML = entries.map(item => `
    <div class="entry-item">
      <p><strong>তারিখ:</strong> ${escapeHTML(item.date)}</p>
      <p><strong>অবস্থা:</strong> ${Number(item.due || 0) === 0 ? 'বন্ধ' : 'চালু'}</p>
      <p><strong>নির্ধারিত জমা:</strong> ৳ ${money(item.due)}</p>
      <p><strong>জমা:</strong> ৳ ${money(item.deposit)}</p>
      <p><strong>গাড়ির খরচ:</strong> ৳ ${money(item.expense)}</p>
      <p><strong>মন্তব্য:</strong> ${escapeHTML(item.note || 'নেই')}</p>
      <button class="btn-secondary" data-edit="${escapeHTML(item.id)}">হিসাব পরিবর্তন</button>
    </div>
  `).join('');
}

async function saveEntry() {
  const date = document.querySelector('#date').value;
  const dayType = document.querySelector('#dayType').value;
  const deposit = Number(document.querySelector('#deposit').value || 0);
  const expense = Number(document.querySelector('#expense').value || 0);
  const note = document.querySelector('#note').value.trim();

  if (!date) {
    showMessage('তারিখ নির্বাচন করুন।', true);
    return;
  }

  if (deposit < 0 || expense < 0 ||
      !Number.isFinite(deposit) || !Number.isFinite(expense)) {
    showMessage('টাকার পরিমাণ সঠিকভাবে লিখুন।', true);
    return;
  }

  const due = dayType === 'off' ? 0 : 650;

  const data = {
    date,
    due,
    deposit,
    expense,
    note,
    updatedAt: serverTimestamp()
  };

  const saveBtn = document.querySelector('#saveBtn');
  saveBtn.disabled = true;

  try {
    if (editingId) {
      const oldEntry = entries.find(e => e.id === editingId);

      if (!oldEntry) throw new Error('হিসাবটি পাওয়া যায়নি।');

      await updateDoc(doc(db, 'entries', editingId), data);
      showMessage('হিসাব সফলভাবে পরিবর্তন হয়েছে।');
    } else {
      await addDoc(collection(db, 'entries'), {
        ...data,
        uid: currentUser.uid,
        createdAt: serverTimestamp()
      });
      showMessage('নতুন হিসাব সফলভাবে জমা হয়েছে।');
    }

    cancelEdit();
  } catch (error) {
    showMessage('সমস্যা: ' + error.message, true);
  } finally {
    saveBtn.disabled = false;
  }
}

function editEntry(id) {
  const item = entries.find(e => e.id === id);
  if (!item) return;

  if (currentRole !== 'admin' && item.uid !== currentUser.uid) {
    showMessage('অন্যের হিসাব পরিবর্তন করা যাবে না।', true);
    return;
  }

  editingId = id;

  document.querySelector('#formTitle').textContent = '✏️ হিসাব পরিবর্তন';
  document.querySelector('#date').value = item.date || today();
  document.querySelector('#dayType').value =
    Number(item.due || 0) === 0 ? 'off' : 'working';
  document.querySelector('#deposit').value = item.deposit || 0;
  document.querySelector('#expense').value = item.expense || 0;
  document.querySelector('#note').value = item.note || '';

  document.querySelector('#saveBtn').textContent = 'পরিবর্তন সংরক্ষণ';
  document.querySelector('#cancelBtn').classList.remove('hidden');

  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function cancelEdit() {
  editingId = null;

  const title = document.querySelector('#formTitle');
  if (!title) return;

  title.textContent = '📝 নতুন দৈনিক হিসাব';
  document.querySelector('#date').value = today();
  document.querySelector('#dayType').value = 'working';
  document.querySelector('#deposit').value = '';
  document.querySelector('#expense').value = '';
  document.querySelector('#note').value = '';

  document.querySelector('#saveBtn').textContent = 'হিসাব জমা দিন';
  document.querySelector('#cancelBtn').classList.add('hidden');
}

onAuthStateChanged(auth, async user => {
  if (unsubscribeEntries) {
    unsubscribeEntries();
    unsubscribeEntries = null;
  }

  currentUser = user;
  currentRole = null;
  entries = [];
  editingId = null;

  if (!user) {
    showLogin();
    return;
  }

  try {
    const userDoc = await getDoc(doc(db, 'user', user.uid));

    if (!userDoc.exists()) {
      await signOut(auth);
      showLogin();
      const message = document.querySelector('#message');
      if (message) message.textContent = 'এই অ্যাকাউন্টের ব্যবহারকারী তথ্য পাওয়া যায়নি।';
      return;
    }

    currentRole = userDoc.data().role;

    if (!['admin', 'entry'].includes(currentRole)) {
      throw new Error('অ্যাকাউন্টের ভূমিকা সঠিক নয়।');
    }

    showDashboard();
    listenEntries();

  } catch (error) {
    app.innerHTML = `
      <div class="card">
        <h2>সংযোগ সমস্যা</h2>
        <p class="error-message">${escapeHTML(error.message)}</p>
        <button id="backBtn">লগইন পেজে ফিরে যান</button>
      </div>
    `;
    document.querySelector('#backBtn').onclick = () => signOut(auth);
  }
});
