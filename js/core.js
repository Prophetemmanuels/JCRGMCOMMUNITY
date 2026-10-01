/* ============================================================================
   JCRGM CONNECT — CORE: State, Storage, Utilities, Seed Data
   ========================================================================== */
"use strict";

const CFG = (window.JCRGM_CONFIG || {});
const APP = {
  NAME: CFG.APP_NAME || "JCRGM Connect",
  VERSION: CFG.APP_VERSION || "1.0.0",
  ORG: CFG.ORGANIZATION || {},
  me: null,            // my profile
  activeRoomId: null,
  activeTab: "chats",
  chatFilter: "all",
  replyTo: null,
  editingMsg: null,
  theme: "dark",
  searchQuery: "",
  recentEmoji: ["🙏", "❤️", "👍", "😂", "🙌", "🔥", "✝️", "😊", "👏"],
  deferredInstall: null,
  statusSeen: {},      // { statusId: true }
  typing: {},          // { roomId: { userId: {name, until} } }
  presence: {},        // { userId: {name, online, last} }
  pinnedBottom: {}     // roomId -> true when user scrolled up
};

/* ------------------------------ Persistence ------------------------------ */
const STORE = {
  get(key, fallback) {
    try {
      const raw = localStorage.getItem("jcrgm:" + key);
      return raw === null ? fallback : JSON.parse(raw);
    } catch (e) { return fallback; }
  },
  set(key, value) {
    try { localStorage.setItem("jcrgm:" + key, JSON.stringify(value)); return true; }
    catch (e) { console.warn("Storage write failed", key, e); return false; }
  },
  del(key) { try { localStorage.removeItem("jcrgm:" + key); } catch (e) {} }
};

const DB = {
  profiles: [],
  rooms: [],
  messages: [],   // all messages across rooms
  statuses: [],
  calls: []
};

function saveDB() {
  STORE.set("profiles", DB.profiles);
  STORE.set("rooms", DB.rooms);
  STORE.set("messages", DB.messages.slice(-1500)); // cap local history
  STORE.set("statuses", DB.statuses);
  STORE.set("calls", DB.calls.slice(-200));
}

function loadDB() {
  DB.profiles = STORE.get("profiles", null) || [];
  DB.rooms = STORE.get("rooms", null) || [];
  DB.messages = STORE.get("messages", null) || [];
  DB.statuses = STORE.get("statuses", null) || [];
  DB.calls = STORE.get("calls", null) || [];
}

/* ------------------------------ Utilities ------------------------------ */
function uid(prefix) {
  const r = (crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2) + Date.now());
  return (prefix || "id") + "-" + r;
}
function esc(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}
function fmtTime(ts) {
  const d = new Date(ts);
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}
function fmtDayLabel(ts) {
  const d = new Date(ts), now = new Date();
  const startOf = (x) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((startOf(now) - startOf(d)) / 86400000);
  if (diff === 0) return "Today";
  if (diff === 1) return "Yesterday";
  if (diff < 7) return d.toLocaleDateString([], { weekday: "long" });
  return d.toLocaleDateString([], { day: "numeric", month: "short", year: "numeric" });
}
function fmtListTime(ts) {
  const d = new Date(ts), now = new Date();
  const startOf = (x) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((startOf(now) - startOf(d)) / 86400000);
  if (diff === 0) return fmtTime(ts);
  if (diff === 1) return "Yesterday";
  if (diff < 7) return d.toLocaleDateString([], { weekday: "short" });
  return d.toLocaleDateString([], { day: "2-digit", month: "2-digit", year: "2-digit" });
}
function fmtDur(sec) {
  sec = Math.max(0, Math.round(sec));
  const m = Math.floor(sec / 60), s = sec % 60;
  if (m >= 60) return Math.floor(m / 60) + "h " + (m % 60) + "m";
  return m + ":" + String(s).padStart(2, "0");
}
function initials(name) {
  if (!name) return "?";
  const parts = String(name).trim().split(/\s+/);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}
function colorFor(str) {
  const palette = ["#075E54", "#128C7E", "#25D366", "#6B46C1", "#D97706", "#DC2626", "#0E7490", "#B91C1C", "#7C3AED", "#0369A1", "#15803D", "#BE185D"];
  let h = 0;
  for (let i = 0; i < String(str).length; i++) h = (h * 31 + String(str).charCodeAt(i)) >>> 0;
  return palette[h % palette.length];
}
function bytesLabel(n) {
  if (n == null) return "";
  if (n < 1024) return n + " B";
  if (n < 1048576) return (n / 1024).toFixed(1) + " KB";
  return (n / 1048576).toFixed(1) + " MB";
}
function debounce(fn, ms) {
  let t; return function (...a) { clearTimeout(t); t = setTimeout(() => fn.apply(this, a), ms); };
}
function throttle(fn, ms) {
  let last = 0, t;
  return function (...a) {
    const now = Date.now();
    if (now - last >= ms) { last = now; fn.apply(this, a); }
    else { clearTimeout(t); t = setTimeout(() => { last = Date.now(); fn.apply(this, a); }, ms - (now - last)); }
  };
}
function isPhone(v) { return /^(\+?\d[\d\s\-()]{6,15})$/.test(String(v).trim()); }
function linkify(text) {
  let s = esc(text);
  s = s.replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" target="_blank" rel="noopener">$1</a>');
  s = s.replace(/(^|[\s(])(\+?\d[\d\s\-()]{7,16})(?=$|[\s).,!?])/g, '$1<a class="phone-link" href="tel:$2">$2</a>');
  s = s.replace(/@([A-Za-z][A-Za-z0-9_]{2,20})/g, '<span class="mention">@$1</span>');
  s = s.replace(/\n/g, "<br>");
  return s;
}
function isURL(v) { try { new URL(v); return true; } catch (e) { return false; } }

/* ------------------------------ DOM helpers ------------------------------ */
const $ = (sel, root) => (root || document).querySelector(sel);
const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));

function show(el) { if (el) el.classList.add("hidden"); }
function hide(el) { if (el) el.classList.remove("hidden"); }
const showEl = (el) => el && el.classList.remove("hidden");
const hideEl = (el) => el && el.classList.add("hidden");

/* ------------------------------ Toasts ------------------------------ */
function toast(msg, type = "info", ms = 3000) {
  const stack = $("#toast-stack");
  const el = document.createElement("div");
  el.className = "toast " + (type === "error" ? "err" : type);
  const icons = { info: "ℹ️", success: "✅", error: "⚠️", gold: "⭐" };
  el.innerHTML = '<span class="t-ico">' + (icons[type] || icons.info) + "</span><span>" + esc(msg) + "</span>";
  stack.appendChild(el);
  setTimeout(() => { el.classList.add("out"); setTimeout(() => el.remove(), 300); }, ms);
  // Notification for background
  if (document.hidden && window.Notification && Notification.permission === "granted" && type === "info") {
    try { new Notification("JCRGM Connect", { body: msg, icon: "./icons/icon-192.png", tag: "jcrgm-toast" }); } catch (e) {}
  }
}

/* ------------------------------ Modal ------------------------------ */
const Modal = {
  open({ icon = "✨", title = "", sub = "", body = "", foot = "", wide = false, onOpen }) {
    $("#m-ico").textContent = icon;
    $("#m-title").textContent = title;
    const subEl = $("#m-sub");
    if (sub) { subEl.textContent = sub; showEl(subEl); } else hideEl(subEl);
    $("#m-body").innerHTML = body;
    const footEl = $("#m-foot");
    if (foot) { footEl.innerHTML = foot; showEl(footEl); } else hideEl(footEl);
    $("#modal-box").classList.toggle("wide", !!wide);
    $("#modal-root").classList.add("show");
    if (onOpen) onOpen($("#m-body"), $("#m-foot"));
  },
  close() { $("#modal-root").classList.remove("show"); }
};

/* ------------------------------ Context menu ------------------------------ */
const CtxMenu = {
  open(x, y, items) {
    const menu = $("#ctx-menu");
    menu.innerHTML = items.map((it) => {
      if (it === "-") return "<hr>";
      return '<button data-act="' + esc(it.act) + '" class="' + (it.danger ? "danger" : "") + '"><span class="ci">' + (it.icon || "•") + "</span>" + esc(it.label) + "</button>";
    }).join("");
    menu.classList.add("show");
    const rect = menu.getBoundingClientRect();
    const px = Math.min(x, window.innerWidth - rect.width - 8);
    const py = Math.min(y, window.innerHeight - rect.height - 8);
    menu.style.left = Math.max(8, px) + "px";
    menu.style.top = Math.max(8, py) + "px";
    menu._items = items;
  },
  close() { $("#ctx-menu").classList.remove("show"); }
};

/* ------------------------------ Theme ------------------------------ */
function applyTheme(theme) {
  APP.theme = theme || "dark";
  document.documentElement.setAttribute("data-theme", APP.theme);
  STORE.set("theme", APP.theme);
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute("content", APP.theme === "royal" ? "#1c1745" : APP.theme === "light" ? "#f0f2f5" : "#075E54");
}

/* ------------------------------ Seed data ------------------------------ */
function seedIfNeeded() {
  if (DB.rooms.length > 0 && DB.profiles.length > 0) return;

  const now = Date.now();
  const H = 3600000, M = 60000;

  const seedProfiles = [
    { id: "u-pastor", display_name: "Pastor David Mwale", handle: "+260 977 100 200", role: "Pastor", department: "Senior Leadership", bio: "Shepherding the JCRGM family. Galatians 6:9", avatar_color: "#075E54", online: true },
    { id: "u-grace", display_name: "Sister Grace Banda", handle: "+260 966 344 512", role: "Worship Lead", department: "Worship & Music", bio: "Worship in spirit and in truth 🎵", avatar_color: "#6B46C1", online: true },
    { id: "u-joseph", display_name: "Deacon Joseph Phiri", handle: "+260 955 208 774", role: "Deacon", department: "Media & Tech Team", bio: "Livestreams, GitHub & the JCRGM Connect app.", avatar_color: "#0E7490", online: false },
    { id: "u-ruth", display_name: "Sister Ruth Chileshe", handle: "+260 979 611 032", role: "Youth Leader", department: "Youth & Young Adults", bio: "On fire for God 🔥", avatar_color: "#D97706", online: true },
    { id: "u-mwamba", display_name: "Brother Mwamba Kaluba", handle: "+260 968 745 190", role: "Leader", department: "Outreach & Missions", bio: "Go therefore and make disciples.", avatar_color: "#15803D", online: false },
    { id: "u-mutale", display_name: "Sister Mutale Nkosi", handle: "+260 971 550 648", role: "Administrator", department: "Administration & Finance", bio: "Office hours: Mon–Fri, 8–17h.", avatar_color: "#BE185D", online: false },
    { id: "u-choir", display_name: "JCRGM Choir", handle: "Choir Group", role: "Group", department: "Worship & Music", bio: "Psalm 100", avatar_color: "#7C3AED", online: false }
  ];

  const seedRooms = [
    { id: "jcrgm-announcements", name: "JCRGM Official Sanctuary", subtitle: "Official Announcements, Word & Live Broadcasts", category: "ministry", avatar_bg: "linear-gradient(135deg,#075E54,#D4AF37)", avatar_icon: "👑", is_group: true, is_channel: true, pinned: true, member_count: 480, description: "Official JCRGM Ministry & Organization broadcast channel for service schedules, daily devotionals, and executive updates." },
    { id: "jcrgm-prayer", name: "JCRGM Prayer & Fellowship Wall", subtitle: "24/7 Intercession, Testimonies & Community Care", category: "ministry", avatar_bg: "linear-gradient(135deg,#128C7E,#25D366)", avatar_icon: "🙏", is_group: true, is_channel: false, pinned: true, member_count: 312, description: "Share prayer requests, praise reports, daily encouragement, and fellowship with the JCRGM family worldwide." },
    { id: "jcrgm-leadership", name: "JCRGM Leadership & Operations", subtitle: "Executive Team, Department Heads & Logistics", category: "team", avatar_bg: "linear-gradient(135deg,#1E3A8A,#3B82F6)", avatar_icon: "🏛️", is_group: true, is_channel: false, pinned: true, member_count: 42, description: "Coordination hub for JCRGM leadership, event planning, outreach logistics, and finance/admin updates." },
    { id: "jcrgm-media", name: "JCRGM Media, Worship & Tech", subtitle: "Livestream, Sound, Graphics & Choir Coordination", category: "team", avatar_bg: "linear-gradient(135deg,#6D28D9,#A855F7)", avatar_icon: "🎥", is_group: true, is_channel: false, pinned: false, member_count: 68, description: "Production schedules, worship setlists, slide decks, and digital ministry coordination." },
    { id: "jcrgm-youth", name: "JCRGM Youth & Young Adults Hub", subtitle: "Campus Fellowship, Mentorship & Events", category: "ministry", avatar_bg: "linear-gradient(135deg,#D97706,#F59E0B)", avatar_icon: "🔥", is_group: true, is_channel: false, pinned: false, member_count: 195, description: "Vibrant community for JCRGM youth, Bible study groups, career mentorship, and Friday hangouts." },
    { id: "room-choir", name: "JCRGM Choir 🎶", subtitle: "Rehearsals & Setlists", category: "group", avatar_bg: "linear-gradient(135deg,#7C3AED,#EC4899)", avatar_icon: "🎵", is_group: true, is_channel: false, pinned: false, member_count: 24, description: "Choir rehearsals, setlists and harmonies." },
    { id: "dm-pastor", name: "Pastor David Mwale", subtitle: "", category: "direct", avatar_bg: "#075E54", avatar_icon: "", is_group: false, is_channel: false, pinned: false, member_count: 2, description: "", contact_id: "u-pastor" },
    { id: "dm-grace", name: "Sister Grace Banda", subtitle: "", category: "direct", avatar_bg: "#6B46C1", avatar_icon: "", is_group: false, is_channel: false, pinned: false, member_count: 2, description: "", contact_id: "u-grace" },
    { id: "dm-joseph", name: "Deacon Joseph Phiri", subtitle: "", category: "direct", avatar_bg: "#0E7490", avatar_icon: "", is_group: false, is_channel: false, pinned: false, member_count: 2, description: "", contact_id: "u-joseph" },
    { id: "dm-ruth", name: "Sister Ruth Chileshe", subtitle: "", category: "direct", avatar_bg: "#D97706", avatar_icon: "", is_group: false, is_channel: false, pinned: false, member_count: 2, description: "", contact_id: "u-ruth" }
  ];

  const seedMsgs = [
    { room_id: "jcrgm-announcements", sender_id: "u-pastor", sender_name: "Pastor David Mwale", sender_role: "Pastor", sender_color: "#075E54", msg_type: "announcement", content: "🕊️ Praise God JCRGM family!\n\nThis week's schedule:\n• Wed 18:00 — Bible Study (Main Hall)\n• Fri 19:00 — Youth All-Nighter 🔥\n• Sun 08:30 & 10:30 — Two Services\n\nLivestream will run on the official platforms. Invite someone this week!", created_at: now - 5 * H },
    { room_id: "jcrgm-announcements", sender_id: "u-mutale", sender_name: "Sister Mutale Nkosi", sender_role: "Administrator", sender_color: "#BE185D", msg_type: "text", content: "📌 Reminder: Quarterly reports are due Friday 17:00. Submit to the Administration office or reply here.", created_at: now - 4.2 * H },
    { room_id: "jcrgm-announcements", sender_id: "u-pastor", sender_name: "Pastor David Mwale", sender_role: "Pastor", sender_color: "#075E54", msg_type: "scripture", content: "\"Let us not become weary in doing good, for at the proper time we will reap a harvest if we do not give up.\"", media_meta: { ref: "Galatians 6:9 (NIV)" }, created_at: now - 3.5 * H },
    { room_id: "jcrgm-prayer", sender_id: "u-ruth", sender_name: "Sister Ruth Chileshe", sender_role: "Youth Leader", sender_color: "#D97706", msg_type: "text", content: "Please pray for our exams this week 🙏 — claiming Philippians 4:13 over everyone writing!", created_at: now - 6 * H },
    { room_id: "jcrgm-prayer", sender_id: "u-grace", sender_name: "Sister Grace Banda", sender_role: "Worship Lead", sender_color: "#6B46C1", msg_type: "text", content: "Amen 🙏❤️", created_at: now - 5.7 * H },
    { room_id: "jcrgm-prayer", sender_id: "u-mwamba", sender_name: "Brother Mwamba Kaluba", sender_role: "Leader", sender_color: "#15803D", msg_type: "text", content: "Good morning family! Sharing a praise report: the outreach team reached 120 households last Saturday! 🙌", created_at: now - 2 * H },
    { room_id: "jcrgm-leadership", sender_id: "u-mutale", sender_name: "Sister Mutale Nkosi", sender_role: "Administrator", sender_color: "#BE185D", msg_type: "poll", content: "", media_meta: { question: "Best day for the quarterly leaders' meeting?", options: [{ t: "Tuesday 18:00", v: ["u-pastor", "u-grace"] }, { t: "Thursday 18:00", v: ["u-joseph"] }, { t: "Saturday 09:00", v: ["u-ruth", "u-mwamba", "u-mutale"] }], pollBy: "Sister Mutale Nkosi" }, created_at: now - 26 * H },
    { room_id: "jcrgm-leadership", sender_id: "u-pastor", sender_name: "Pastor David Mwale", sender_role: "Pastor", sender_color: "#075E54", msg_type: "text", content: "Team, kindly confirm logistics for Sunday. Media 🎥 please test the stream early.", created_at: now - 7 * H },
    { room_id: "jcrgm-media", sender_id: "u-joseph", sender_name: "Deacon Joseph Phiri", sender_role: "Deacon", sender_color: "#0E7490", msg_type: "text", content: "Rehearsal stream test at 16:00 today. New camera angles uploaded to the shared drive 📂", created_at: now - 8 * H },
    { room_id: "jcrgm-youth", sender_id: "u-ruth", sender_name: "Sister Ruth Chileshe", sender_role: "Youth Leader", sender_color: "#D97706", msg_type: "text", content: "Friday's theme: \"Faith Over Fear\" 🔥 Bring a friend! Snacks at 18:30, session at 19:00.", created_at: now - 3 * H },
    { room_id: "room-choir", sender_id: "u-grace", sender_name: "Sister Grace Banda", sender_role: "Worship Lead", sender_color: "#6B46C1", msg_type: "text", content: "Rehearsal moved to Thursday 17:30. Sopranos, please master pages 12–14 🎵", created_at: now - 30 * H },
    { room_id: "dm-pastor", sender_id: "u-pastor", sender_name: "Pastor David Mwale", sender_role: "Pastor", sender_color: "#075E54", msg_type: "text", content: "Grace and peace! How can I pray for you this week?", created_at: now - 20 * H },
    { room_id: "dm-grace", sender_id: "u-grace", sender_name: "Sister Grace Banda", sender_role: "Worship Lead", sender_color: "#6B46C1", msg_type: "text", content: "Hi! Are you on the worship roster this Sunday? 🎶", created_at: now - 27 * H },
    { room_id: "dm-joseph", sender_id: "u-joseph", sender_name: "Deacon Joseph Phiri", sender_role: "Deacon", sender_color: "#0E7490", msg_type: "text", content: "The JCRGM Connect app is deployed on GitHub Pages — you can install it to your home screen!", created_at: now - 22 * H },
    { room_id: "dm-ruth", sender_id: "u-ruth", sender_name: "Sister Ruth Chileshe", sender_role: "Youth Leader", sender_color: "#D97706", msg_type: "text", content: "Don't forget youth all-nighter Friday! 🔥", created_at: now - 4 * H }
  ].map((m, i) => Object.assign({
    id: "seed-msg-" + i,
    msg_type: "text", media_url: "", reply_to: null, reactions: {}, read_by: []
  }, m));

  const seedStatuses = [
    { id: "st-1", user_id: "u-pastor", user_name: "Pastor David Mwale", user_role: "Pastor", avatar_color: "#075E54", caption: "Morning dew, fresh mercy. 🕊️\n\n\"His mercies are new every morning.\" — Lamentations 3:23", bg_gradient: "linear-gradient(150deg,#075E54 0%,#0a7d6c 55%,#D4AF37 130%)", category: "Daily Devotional", created_at: now - 2 * H },
    { id: "st-2", user_id: "u-grace", user_name: "Sister Grace Banda", user_role: "Worship Lead", avatar_color: "#6B46C1", caption: "Rehearsal vibes 🎶✨ God is preparing us for Sunday!", bg_gradient: "linear-gradient(150deg,#4c1d95 0%,#7c3aed 60%,#ec4899 130%)", category: "Testimony", created_at: now - 5 * H },
    { id: "st-3", user_id: "u-ruth", user_name: "Sister Ruth Chileshe", user_role: "Youth Leader", avatar_color: "#D97706", caption: "Faith Over Fear 🔥🔥🔥 Who's coming Friday?", bg_gradient: "linear-gradient(150deg,#7c2d12 0%,#ea580c 60%,#facc15 130%)", category: "Announcement", created_at: now - 8 * H },
    { id: "st-4", user_id: "u-mwamba", user_name: "Brother Mwamba Kaluba", user_role: "Leader", avatar_color: "#15803D", caption: "120 households reached 🙌🌍 #JCRGMOutreach", bg_gradient: "linear-gradient(150deg,#14532d 0%,#16a34a 60%,#fde047 130%)", category: "Praise Report", created_at: now - 21 * H }
  ];

  const seedCalls = [
    { id: "call-1", room_id: "dm-pastor", room_name: "Pastor David Mwale", caller_id: "u-pastor", caller_name: "Pastor David Mwale", call_type: "audio", direction: "incoming", duration_sec: 342, status: "completed", created_at: now - 26 * H },
    { id: "call-2", room_id: "dm-grace", room_name: "Sister Grace Banda", caller_id: APP.me ? APP.me.id : "me", caller_name: APP.me ? APP.me.name : "Me", call_type: "video", direction: "outgoing", duration_sec: 96, status: "completed", created_at: now - 50 * H },
    { id: "call-3", room_id: "dm-joseph", room_name: "Deacon Joseph Phiri", caller_id: APP.me ? APP.me.id : "me", caller_name: APP.me ? APP.me.name : "Me", call_type: "audio", direction: "outgoing", duration_sec: 0, status: "missed", created_at: now - 72 * H }
  ];

  DB.profiles = DB.profiles.concat(seedProfiles);
  DB.rooms = DB.rooms.concat(seedRooms);
  DB.messages = DB.messages.concat(seedMsgs);
  DB.statuses = DB.statuses.concat(seedStatuses);
  DB.calls = DB.calls.concat(seedCalls);
  saveDB();
}

/* ------------------------------ Derived helpers ------------------------------ */
function roomMessages(roomId) {
  return DB.messages.filter((m) => m.room_id === roomId)
    .sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
}
function lastMessage(roomId) {
  const list = DB.messages.filter((m) => m.room_id === roomId);
  if (!list.length) return null;
  return list.reduce((a, b) => new Date(a.created_at) <= new Date(b.created_at) ? a : b);
}
function unreadCount(roomId) {
  const r = DB.rooms.find((x) => x.id === roomId);
  if (!r) return 0;
  return r.unread || 0;
}
function totalUnread() { return DB.rooms.reduce((s, r) => s + (r.unread || 0), 0); }
function profileById(id) { return DB.profiles.find((p) => p.id === id) || null; }
function contactOfRoom(room) {
  if (room && room.contact_id) return profileById(room.contact_id);
  return null;
}
function previewText(msg) {
  if (!msg) return "Tap to start the conversation";
  const who = msg.sender_id === (APP.me && APP.me.id) ? "You: " : (isDirectRoom(msg.room_id) ? "" : shortName(msg.sender_name) + ": ");
  let body = "";
  switch (msg.msg_type) {
    case "audio": body = "🎤 Voice note (" + fmtDur((msg.media_meta && msg.media_meta.duration) || 0) + ")"; break;
    case "image": body = "📷 Photo" + (msg.content ? " " + msg.content : ""); break;
    case "document": body = "📄 " + ((msg.media_meta && msg.media_meta.name) || "Document"); break;
    case "poll": body = "📊 " + ((msg.media_meta && msg.media_meta.question) || "Poll"); break;
    case "contact": body = "👤 Contact card"; break;
    case "scripture": body = "📖 " + msg.content; break;
    case "announcement": body = "📣 " + msg.content; break;
    case "system": body = msg.content; break;
    default: body = msg.content;
  }
  return who + String(body).replace(/\n/g, " ");
}
function isDirectRoom(roomId) {
  const r = DB.rooms.find((x) => x.id === roomId);
  return !!(r && r.category === "direct");
}
function shortName(n) { return String(n || "").split(" ").slice(-1)[0]; }
function adminCanPost(room) {
  if (!room || !room.is_channel) return true;
  const myRole = (APP.me && APP.me.role) || "Member";
  return ["Pastor", "Leader", "Administrator", "Media Team", "Deacon"].includes(myRole) || room.created_by === (APP.me && APP.me.id);
}

/* Emoji data */
const EMOJI_CATS = {
  "🙏 Faith": ["🙏", "✝️", "⛪", "🕊️", "📖", " bible", "📿", "🕯️", "🌅", "🙌", "🙏🏽", "😇", " amen", "🙌🏽", "✨", "👑", "🏆", "💛", "✨"],
  "😀 Smileys": ["😀", "😃", "😄", "😁", "😆", "😅", "😂", "🙂", "😉", "😊", "😇", "🥰", "😍", "😘", "😜", "🤪", "😎", "🤩", "🥳", "😏", "😴", "🤗", "🤭", "🫡", "🤔", "😐", "😔", "😢", "😭", "😤", "😡", "🥶", "🤯", "😱", "🥳"],
  "❤️ Hearts": ["❤️", "🧡", "💛", "💚", "💙", "💜", "🖤", "🤍", "🤎", "💕", "💞", "💓", "💗", "💖", "💘", "💝", "💟", "💋", "💯", "🔥"],
  "👍 Gestures": ["👍", "👎", "👌", "✌️", "🤞", "🤙", "👋", "🤝", "👏", "🙌", "🫶", "💪", "🙏", "☝️", "👆", "👇", "👉", "👈", "🤙🏽", "✌🏽"],
  "🎉 Objects": ["🎉", "🎊", "🎈", "🎁", "🏆", "🥇", "🎵", "🎶", "🎤", "🎧", "📷", "📸", "📞", "☎️", "💬", "💭", "📢", "📌", "📅", "⏰", "☕", "🍽️", "🍕", "🎂", "🌹", "🌸", "🌻", "⭐", "🌟", "💫"],
  "🌍 Travel": ["🌍", "🌎", "🌏", "✈️", "🚗", "🚌", "🏠", "🏢", "⛰️", "🏝️", "🌅", "🌄", "🏙️", "🗺️", "🧳", "⛽"]
};
// Clean accidental entries
EMOJI_CATS["🙏 Faith"] = ["🙏", "✝️", "⛪", "🕊️", "📖", "📿", "🕯️", "🌅", "🙌", "😇", "✨", "👑", "🏆", "💛", "📿", "🛐", "🔯", "☀️", "🌈", "🌱"];

const EMOJI_FLAT = Object.values(EMOJI_CATS).flat();
