/* ============================================================================
   JCRGM CONNECT — CLOUD LAYER: Supabase realtime sync, cross-tab broadcast,
   presence/typing, WebRTC voice-video call signaling
   ========================================================================== */
"use strict";

const SUPA_CDN = "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.min.js";

const Cloud = {
  client: null,
  channel: null,
  status: "local",        // 'local' | 'connecting' | 'online' | 'error'
  url: "",
  key: "",
  bc: null,               // BroadcastChannel for cross-tab local sync
  myPresenceTrack: null,

  /* ------------------------------ init ------------------------------ */
  async init() {
    // Cross-tab sync always available
    try {
      this.bc = new BroadcastChannel("jcrgm-local-sync-v2");
      this.bc.onmessage = (ev) => this.onLocalBroadcast(ev.data);
    } catch (e) { this.bc = null; }

    const savedUrl = STORE.get("sb_url", "") || (CFG.SUPABASE_URL || "");
    const savedKey = STORE.get("sb_key", "") || (CFG.SUPABASE_ANON_KEY || "");
    if (savedUrl && savedKey) {
      await this.connect(savedUrl, savedKey, true);
    } else {
      this.setStatus("local");
    }
  },

  setStatus(status, detail) {
    this.status = status;
    const pill = $("#conn-pill"), txt = $("#conn-text");
    if (!pill) return;
    pill.classList.remove("offline", "err");
    const map = {
      local: ["LOCAL", "offline"],
      connecting: ["SYNC…", ""],
      online: ["LIVE", ""],
      error: ["OFFLINE", "err"]
    };
    const [label, cls] = map[status] || map.local;
    if (cls) pill.classList.add(cls);
    txt.textContent = label;
    pill.title = detail || ({
      local: "Local mode: messages saved on this device & shared across tabs",
      connecting: "Connecting to Supabase Cloud…",
      online: "Supabase Cloud connected — live cross-device sync active",
      error: "Cloud unreachable — working offline with local data"
    })[status];
  },

  /* ------------------------------ connect ------------------------------ */
  async connect(url, key, silent) {
    url = String(url || "").trim().replace(/\/+$/, "");
    key = String(key || "").trim();
    if (!url.startsWith("https://")) url = "https://" + url;
    if (!/^https:\/\/[a-z0-9-]+\.supabase\.(co|in)/i.test(url)) {
      if (!silent) toast("That doesn't look like a Supabase project URL (…supabase.co)", "error");
      this.setStatus("error", "Invalid project URL");
      return false;
    }
    if (!key || key.length < 30) {
      if (!silent) toast("Please paste your Supabase anon/public API key", "error");
      this.setStatus("error", "Invalid anon key");
      return false;
    }

    this.setStatus("connecting");
    try {
      if (!window.supabase) await this.loadScript(SUPA_CDN);
      if (!window.supabase) throw new Error("SDK failed to load");

      this.client = window.supabase.createClient(url, key, {
        realtime: { params: { eventsPerSecond: 40 } },
        auth: { persistSession: false, autoRefreshToken: false }
      });

      // Ping: verify schema was created
      const { data, error } = await this.client.from("jcrgm_rooms").select("id").limit(1);
      if (error) throw error;

      this.url = url; this.key = key;
      STORE.set("sb_url", url); STORE.set("sb_key", key);

      await this.bootstrapFromCloud();
      this.subscribe();
      this.setStatus("online");
      if (!silent) toast("Supabase Cloud connected — JCRGM is now LIVE", "success");
      return true;
    } catch (err) {
      console.warn("Supabase connect failed:", err);
      this.client = null;
      this.setStatus("error", String(err.message || err));
      if (!silent) toast("Cloud connection failed: " + (err.message || "unknown error") + " — running in local mode", "error", 4500);
      return false;
    }
  },

  loadScript(src) {
    return new Promise((res, rej) => {
      const s = document.createElement("script");
      s.src = src; s.async = true;
      s.onload = () => res();
      s.onerror = () => rej(new Error("Cannot load " + src));
      document.head.appendChild(s);
      setTimeout(() => rej(new Error("SDK load timeout")), 12000);
    });
  },

  disconnect() {
    try {
      if (this.channel) { this.client.removeChannel(this.channel); this.channel = null; }
    } catch (e) {}
    this.client = null;
    this.url = ""; this.key = "";
    STORE.del("sb_url"); STORE.del("sb_key");
    this.setStatus("local");
  },

  connected() { return !!(this.client && this.status === "online"); },

  /* ------------------------------ bootstrap ------------------------------ */
  async bootstrapFromCloud() {
    const c = this.client;
    const [profiles, rooms, msgs, statuses, calls] = await Promise.all([
      c.from("jcrgm_profiles").select("*").limit(500),
      c.from("jcrgm_rooms").select("*").limit(300),
      c.from("jcrgm_messages").select("*").order("created_at", { ascending: true }).limit(800),
      c.from("jcrgm_statuses").select("*").order("created_at", { ascending: false }).limit(100),
      c.from("jcrgm_calls").select("*").order("created_at", { ascending: false }).limit(100)
    ]);
    const err = profiles.error || rooms.error || msgs.error || statuses.error || calls.error;
    if (err) throw err;

    const merge = (localList, cloudList, keyFn) => {
      const map = new Map();
      localList.forEach((x) => map.set(keyFn(x), x));
      cloudList.forEach((x) => map.set(keyFn(x), Object.assign({}, map.get(keyFn(x)), x)));
      return Array.from(map.values());
    };

    DB.profiles = merge(DB.profiles.filter((p) => !String(p.id).startsWith("seed")), profiles.data || [], (x) => x.id);
    // keep seeded demo rooms only if cloud has none
    const cloudRooms = rooms.data || [];
    if (cloudRooms.length) {
      const seeded = DB.rooms.filter((r) => String(r.id).startsWith("seed"));
      const demoIds = ["jcrgm-announcements", "jcrgm-prayer", "jcrgm-leadership", "jcrgm-media", "jcrgm-youth", "room-choir", "dm-pastor", "dm-grace", "dm-joseph", "dm-ruth"];
      DB.rooms = merge(DB.rooms.filter((r) => demoIds.includes(r.id) || String(r.id).startsWith("seed-") || r.created_by === (APP.me && APP.me.id)), cloudRooms, (x) => x.id);
    }
    const cloudMsgs = msgs.data || [];
    if (cloudMsgs.length) DB.messages = merge(DB.messages.filter((m) => !String(m.id).startsWith("seed-")), cloudMsgs, (x) => x.id);
    const cloudSt = statuses.data || [];
    DB.statuses = merge(DB.statuses.filter((s) => !String(s.id).startsWith("st-")), cloudSt, (x) => x.id);
    const cloudCalls = calls.data || [];
    if (cloudCalls.length) DB.calls = merge(DB.calls.filter((x) => !String(x.id).startsWith("call-")), cloudCalls, (x) => x.id);

    saveDB();
    renderAll();
  },

  /* ------------------------------ realtime ------------------------------ */
  subscribe() {
    const c = this.client;
    if (this.channel) { try { c.removeChannel(this.channel); } catch (e) {} }

    const ch = c.channel(CFG.REALTIME_CHANNEL || "jcrgm-global-realtime-v2", {
      config: { presence: { key: "user_id" } }
    });
    this.channel = ch;

    // Postgres changes: messages / rooms / statuses / calls / profiles
    ch.on("postgres_changes", { event: "INSERT", schema: "public", table: "jcrgm_messages" }, (p) => this.onCloudMessage(p.new));
    ch.on("postgres_changes", { event: "UPDATE", schema: "public", table: "jcrgm_messages" }, (p) => this.onCloudMessage(p.new, true));
    ch.on("postgres_changes", { event: "INSERT", schema: "public", table: "jcrgm_rooms" }, (p) => this.onCloudRoom(p.new));
    ch.on("postgres_changes", { event: "UPDATE", schema: "public", table: "jcrgm_rooms" }, (p) => this.onCloudRoom(p.new, true));
    ch.on("postgres_changes", { event: "INSERT", schema: "public", table: "jcrgm_statuses" }, (p) => this.onCloudStatus(p.new));
    ch.on("postgres_changes", { event: "INSERT", schema: "public", table: "jcrgm_calls" }, (p) => this.onCloudCall(p.new));
    ch.on("postgres_changes", { event: "INSERT", schema: "public", table: "jcrgm_profiles" }, (p) => this.onCloudProfile(p.new));
    ch.on("postgres_changes", { event: "UPDATE", schema: "public", table: "jcrgm_profiles" }, (p) => this.onCloudProfile(p.new, true));

    // Broadcast: typing / presence / WebRTC signals
    ch.on("broadcast", { event: "typing" }, (p) => this.onTyping(p.payload));
    ch.on("broadcast", { event: "signal" }, (p) => this.onSignal(p.payload));
    ch.on("broadcast", { event: "ping" }, (p) => this.onPing(p.payload));

    // Presence
    ch.on("presence", { event: "sync" }, () => {
      const state = ch.presenceState();
      Object.keys(state).forEach((key) => {
        const meta = state[key][0];
        if (meta && meta.uid !== (APP.me && APP.me.id)) {
          APP.presence[meta.uid] = { name: meta.name, online: true, last: Date.now() };
        }
      });
      refreshChatSubIfOpen();
    });

    ch.subscribe((state) => {
      if (state === "SUBSCRIBED") {
        this.myPresenceTrack = null;
        try {
          ch.track({ uid: APP.me.id, name: APP.me.name, role: APP.me.role, online: true });
        } catch (e) {}
        this.upsertMyProfile();
      }
    });
  },

  async upsertMyProfile() {
    if (!this.connected() || !APP.me) return;
    try {
      await this.client.from("jcrgm_profiles").upsert({
        id: APP.me.id,
        display_name: APP.me.name,
        handle: APP.me.handle || "",
        role: APP.me.role || "Member",
        department: APP.me.department || "Community",
        bio: APP.me.bio || "",
        avatar_color: APP.me.color,
        online: true,
        last_seen: new Date().toISOString()
      });
    } catch (e) { console.warn("profile upsert", e); }
  },

  /* ------------------------------ incoming cloud events ------------------------------ */
  onCloudMessage(msg, isUpdate) {
    if (!msg || !msg.room_id) return;
    const mine = msg.sender_id === (APP.me && APP.me.id);
    const idx = DB.messages.findIndex((m) => m.id === msg.id);
    if (idx >= 0) {
      DB.messages[idx] = Object.assign(DB.messages[idx], msg);
    } else {
      DB.messages.push(msg);
      this.increaseUnread(msg, mine);
    }
    saveDB();
    maybeNotify(msg, mine);
    if (UI.currentRoom === msg.room_id) {
      UI.renderChat(true);
      this.markRoomRead(msg.room_id);
      UI.saveDraftAndFocus();
    }
    UI.renderChatList();
    this.broadcastLocal({ type: "message", msg });
  },

  onCloudRoom(room, isUpdate) {
    if (!room) return;
    const idx = DB.rooms.findIndex((r) => r.id === room.id);
    if (idx >= 0) DB.rooms[idx] = Object.assign(DB.rooms[idx], room);
    else DB.rooms.push(room);
    saveDB();
    UI.renderChatList();
    this.broadcastLocal({ type: "room", room });
  },

  onCloudStatus(st) {
    if (!st) return;
    if (!DB.statuses.some((s) => s.id === st.id)) DB.statuses.unshift(st);
    saveDB();
    UI.renderStatusList();
    this.broadcastLocal({ type: "status", status: st });
    if (st.user_id !== (APP.me && APP.me.id)) {
      toast(st.user_name + " posted a new status", "gold", 2800);
      updateNavBadges();
    }
  },

  onCloudCall(call) {
    if (!call) return;
    if (!DB.calls.some((c2) => c2.id === call.id)) DB.calls.unshift(call);
    saveDB();
    UI.renderCalls();
    this.broadcastLocal({ type: "call", call });
  },

  onCloudProfile(p, isUpdate) {
    if (!p) return;
    const idx = DB.profiles.findIndex((x) => x.id === p.id);
    if (idx >= 0) DB.profiles[idx] = Object.assign(DB.profiles[idx], p);
    else if (p.id !== (APP.me && APP.me.id)) DB.profiles.push(p);
    saveDB();
    UI.renderChatList();
    this.broadcastLocal({ type: "profile", profile: p });
  },

  increaseUnread(msg, mine) {
    if (mine || UI.currentRoom === msg.room_id) return;
    const room = DB.rooms.find((r) => r.id === msg.room_id);
    if (!room) return;
    room.unread = (room.unread || 0) + 1;
  },

  markRoomRead(roomId) {
    const room = DB.rooms.find((r) => r.id === roomId);
    if (room && room.unread) { room.unread = 0; saveDB(); updateNavBadges(); }
  },

  /* ------------------------------ sending ------------------------------ */
  async sendMessage(msg) {
    // Always persist locally first (optimistic)
    const idx = DB.messages.findIndex((m) => m.id === msg.id);
    if (idx >= 0) DB.messages[idx] = msg; else DB.messages.push(msg);
    saveDB();
    UI.renderChat(true);
    UI.renderChatList();

    // Cross-tab broadcast
    this.broadcastLocal({ type: "message", msg });

    // Push to cloud
    if (this.connected()) {
      try {
        const row = {
          id: msg.id, room_id: msg.room_id, sender_id: msg.sender_id,
          sender_name: msg.sender_name, sender_role: msg.sender_role,
          sender_color: msg.sender_color, msg_type: msg.msg_type,
          content: msg.content || "", media_url: msg.media_url || null,
          media_meta: msg.media_meta || {}, reply_to: msg.reply_to || null,
          reactions: msg.reactions || {}, created_at: msg.created_at
        };
        const { error } = await this.client.from("jcrgm_messages").insert(row);
        if (error) throw error;
        // Optimistically mark delivered
        msg.status = "delivered";
        saveDB();
        UI.renderChat(true);
      } catch (err) {
        console.warn("cloud send failed", err);
        toast("Cloud sync failed — message kept on device (will retry)", "error");
      }
    } else {
      msg.status = "delivered";
      saveDB();
      UI.renderChat(true);
      // simulate deliver→read ticks locally
      simulateLocalTicks(msg);
    }
    return msg;
  },

  async updateMessage(msgId, patch) {
    const m = DB.messages.find((x) => x.id === msgId);
    if (!m) return;
    Object.assign(m, patch);
    saveDB();
    UI.renderChat();
    this.broadcastLocal({ type: "message", msg: m });
    if (this.connected()) {
      try {
        await this.client.from("jcrgm_messages").update(patch).eq("id", msgId);
      } catch (e) { console.warn("updateMessage", e); }
    }
  },

  async deleteMessage(msgId) {
    const i = DB.messages.findIndex((x) => x.id === msgId);
    if (i < 0) return;
    const m = DB.messages[i];
    DB.messages.splice(i, 1);
    saveDB();
    UI.renderChat();
    this.broadcastLocal({ type: "delete", msgId, room_id: m.room_id });
    if (this.connected()) {
      try { await this.client.from("jcrgm_messages").delete().eq("id", msgId); } catch (e) {}
    }
  },

  async createRoom(room) {
    const idx = DB.rooms.findIndex((r) => r.id === room.id);
    if (idx >= 0) DB.rooms[idx] = room; else DB.rooms.push(room);
    saveDB();
    UI.renderChatList();
    this.broadcastLocal({ type: "room", room });
    if (this.connected()) {
      try {
        const row = Object.assign({}, room);
        delete row.unread; delete row.contact_id;
        await this.client.from("jcrgm_rooms").upsert(row);
      } catch (e) { console.warn("createRoom", e); }
    }
  },

  async createStatus(st) {
    DB.statuses.unshift(st);
    saveDB();
    UI.renderStatusList();
    this.broadcastLocal({ type: "status", status: st });
    if (this.connected()) {
      try {
        await this.client.from("jcrgm_statuses").insert({
          id: st.id, user_id: st.user_id, user_name: st.user_name,
          user_role: st.user_role, avatar_color: st.avatar_color,
          caption: st.caption, bg_gradient: st.bg_gradient,
          media_url: st.media_url || null, category: st.category,
          created_at: st.created_at
        });
      } catch (e) { toast("Status saved locally; cloud sync failed", "error"); }
    }
  },

  async logCall(call) {
    DB.calls.unshift(call);
    saveDB();
    UI.renderCalls();
    this.broadcastLocal({ type: "call", call });
    if (this.connected()) {
      try {
        await this.client.from("jcrgm_calls").insert({
          id: call.id, room_id: call.room_id, room_name: call.room_name,
          caller_id: call.caller_id, caller_name: call.caller_name,
          call_type: call.call_type, direction: call.direction,
          duration_sec: call.duration_sec, status: call.status,
          created_at: call.created_at
        });
      } catch (e) {}
    }
  },

  /* ------------------------------ typing & presence ------------------------------ */
  sendTyping(roomId) {
    if (this.connected() && this.channel) {
      try { this.channel.send({ type: "broadcast", event: "typing", payload: { room: roomId, uid: APP.me.id, name: APP.me.name, ts: Date.now() } }); } catch (e) {}
    }
    this.broadcastLocal({ type: "typing", room: roomId, uid: APP.me.id, name: APP.me.name, ts: Date.now() });
  },

  onTyping(p) {
    if (!p || p.uid === APP.me.id) return;
    APP.typing[p.room] = APP.typing[p.room] || {};
    APP.typing[p.room][p.uid] = { name: p.name, until: Date.now() + 4200 };
    if (UI.currentRoom === p.room) UI.updateChatSub();
    UI.renderChatList();
  },

  sendPing() {
    const payload = { uid: APP.me.id, name: APP.me.name, role: APP.me.role, color: APP.me.color, ts: Date.now() };
    if (this.connected() && this.channel) {
      try { this.channel.send({ type: "broadcast", event: "ping", payload }); } catch (e) {}
    }
    this.broadcastLocal({ type: "ping", payload });
    APP.presence[APP.me.id] = { name: APP.me.name, online: true, last: Date.now() };
  },

  onPing(p) {
    if (!p || p.uid === APP.me.id) return;
    APP.presence[p.uid] = { name: p.name, online: true, last: Date.now() };
    if (!profileById(p.uid)) {
      const prof = { id: p.uid, display_name: p.name, role: p.role || "Member", department: "Community", avatar_color: p.color || colorFor(p.uid), bio: "Connected on JCRGM Connect", online: true, handle: "" };
      DB.profiles.push(prof);
      saveDB();
      this.broadcastLocal({ type: "profile", profile: prof });
    }
    refreshChatSubIfOpen();
    UI.renderChatList();
  },

  /* ------------------------------ cross-tab local sync ------------------------------ */
  broadcastLocal(data) {
    if (this.bc) { try { this.bc.postMessage(Object.assign({ _from: APP.me ? APP.me.id : "anon", _t: Date.now() }, data)); } catch (e) {} }
  },

  onLocalBroadcast(data) {
    if (!data || data._from === (APP.me && APP.me.id)) return;
    switch (data.type) {
      case "message": {
        const msg = data.msg;
        if (DB.messages.some((m) => m.id === msg.id)) return;
        DB.messages.push(msg);
        const mineTarget = msg.sender_id !== APP.me.id;
        if (mineTarget && UI.currentRoom !== msg.room_id) {
          const room = DB.rooms.find((r) => r.id === msg.room_id);
          if (room) room.unread = (room.unread || 0) + 1;
        }
        saveDB();
        maybeNotify(msg, false);
        if (UI.currentRoom === msg.room_id) UI.renderChat(true);
        UI.renderChatList();
        break;
      }
      case "room": {
        const idx = DB.rooms.findIndex((r) => r.id === data.room.id);
        if (idx >= 0) DB.rooms[idx] = data.room; else DB.rooms.push(data.room);
        saveDB(); UI.renderChatList();
        break;
      }
      case "delete": {
        DB.messages = DB.messages.filter((m) => m.id !== data.msgId);
        saveDB();
        if (UI.currentRoom === data.room_id) UI.renderChat();
        UI.renderChatList();
        break;
      }
      case "status": {
        if (!DB.statuses.some((s) => s.id === data.status.id)) DB.statuses.unshift(data.status);
        saveDB(); UI.renderStatusList(); updateNavBadges();
        break;
      }
      case "call": {
        if (!DB.calls.some((c) => c.id === data.call.id)) DB.calls.unshift(data.call);
        saveDB(); UI.renderCalls();
        break;
      }
      case "profile": {
        const idx = DB.profiles.findIndex((x) => x.id === data.profile.id);
        if (idx >= 0) DB.profiles[idx] = data.profile;
        else if (data.profile.id !== APP.me.id) DB.profiles.push(data.profile);
        saveDB(); UI.renderChatList();
        break;
      }
      case "typing": {
        if (data.uid === APP.me.id) return;
        APP.typing[data.room] = APP.typing[data.room] || {};
        APP.typing[data.room][data.uid] = { name: data.name, until: Date.now() + 4200 };
        if (UI.currentRoom === data.room) UI.updateChatSub();
        UI.renderChatList();
        break;
      }
      case "ping": {
        this.onPing(data.payload);
        break;
      }
      case "signal": {
        this.onSignal(data.payload);
        break;
      }
      case "read": {
        // Mark my messages as read when another tab views the room
        if (data.reader !== APP.me.id) {
          let changed = false;
          DB.messages.forEach((m) => {
            if (m.room_id === data.room && m.sender_id === APP.me.id && m.status !== "read") { m.status = "read"; changed = true; }
          });
          if (changed) { saveDB(); if (UI.currentRoom === data.room) UI.renderChat(); }
        }
        break;
      }
    }
  },

  sendReadReceipt(roomId) {
    this.broadcastLocal({ type: "read", room: roomId, reader: APP.me.id });
  },

  /* ------------------------------ WebRTC signaling ------------------------------ */
  sendSignal(payload) {
    payload.from = APP.me.id;
    payload.fromName = APP.me.name;
    if (this.connected() && this.channel) {
      try { this.channel.send({ type: "broadcast", event: "signal", payload }); } catch (e) {}
    }
    this.broadcastLocal({ type: "signal", payload });
  },

  onSignal(p) {
    if (!p || p.from === APP.me.id) return;
    CallEngine.onSignal(p);
  }
};

/* ------------------------------ simulated local ticks ------------------------------ */
function simulateLocalTicks(msg) {
  setTimeout(() => { msg.status = "delivered"; saveDB(); if (UI.currentRoom === msg.room_id) UI.renderChat(); }, 650);
  setTimeout(() => {
    // "Read" if recipient is online-ish
    const contact = contactOfRoom(DB.rooms.find((r) => r.id === msg.room_id) || {});
    const online = contact ? (contact.online || APP.presence[contact.id]) : false;
    const inGroup = (DB.rooms.find((r) => r.id === msg.room_id) || {}).category !== "direct";
    if (online || inGroup) {
      msg.status = "read";
      saveDB();
      if (UI.currentRoom === msg.room_id) UI.renderChat();
    }
  }, 1900);
}

/* ------------------------------ demo auto-replies (local mode) ------------------------------ */
const DEMO_REPLIES = {
  prayer: ["Amen 🙏 praying with you right now.", "Noted — lifting this up in prayer tonight 🕊️"],
  amen: ["Amen! 🙏❤️", "Amen and amen 🙌"],
  sunday: ["Sunday service is 08:30 and 10:30 — don't be late! ⛪", "Yes! Two services this Sunday. See you there 😊"],
  meeting: ["Meeting confirmed ✅ I'll send the agenda shortly.", "Thanks — I'll be there. 📋"],
  hello: ["Hey! Grace and peace to you 😊", "Hi there! How are you doing? 👋"],
  hi: ["Hi! 👋 How can I help?", "Hello! 🙏"],
  bless: ["God bless you too! 🕊️", "Blessings! ✨"],
  thank: ["You're most welcome 🙏", "Anytime! 😊"],
  help: ["Of course — tell me more.", "I'm here for you. What's happening? 💛"],
  youth: ["Friday 19:00 — Faith Over Fear 🔥 Bring a friend!", "Yes! Youth all-nighter this Friday 🔥"],
  default: [
    "Received ✅ — thank you for sharing!",
    "That's wonderful to hear 🙌",
    "Noted, I'll get back to you shortly 👍",
    "Grace and peace! 🕊️ How can I assist?",
    "Amen 🙏 keep me posted."
  ]
};
function maybeAutoReply(room) {
  if (!room || room.category !== "direct") return;
  const contact = contactOfRoom(room);
  if (!contact) return;
  const online = contact.online || APP.presence[contact.id];
  if (!online && Math.random() > 0.45) return;
  const delay = 1400 + Math.random() * 2400;
  setTypingIndicator(room.id, contact.display_name, delay + 600);
  setTimeout(() => {
    if (!document || !document.body) return;
    const lastMine = roomMessages(room.id).reverse().find((m) => m.sender_id === APP.me.id);
    const text = (lastMine && lastMine.content || "").toLowerCase();
    let pool = DEMO_REPLIES.default;
    for (const k of Object.keys(DEMO_REPLIES)) {
      if (k !== "default" && text.includes(k)) { pool = DEMO_REPLIES[k]; break; }
    }
    const reply = {
      id: uid("msg"),
      room_id: room.id,
      sender_id: contact.id,
      sender_name: contact.display_name,
      sender_role: contact.role,
      sender_color: contact.avatar_color,
      msg_type: "text",
      content: pool[Math.floor(Math.random() * pool.length)],
      media_url: "", media_meta: {}, reply_to: null, reactions: {},
      status: "read",
      created_at: new Date().toISOString()
    };
    DB.messages.push(reply);
    if (UI.currentRoom !== room.id) room.unread = (room.unread || 0) + 1;
    saveDB();
    if (UI.currentRoom === room.id) UI.renderChat(true); else toast(reply.sender_name + ": " + reply.content.slice(0, 60), "info", 3500);
    UI.renderChatList();
    maybeNotify(reply, false);
    Cloud.broadcastLocal({ type: "message", msg: reply });
  }, delay);
}
function setTypingIndicator(roomId, name, ms) {
  APP.typing[roomId] = APP.typing[roomId] || {};
  APP.typing[roomId]["demo-" + roomId] = { name, until: Date.now() + ms };
  if (UI.currentRoom === roomId) UI.updateChatSub();
  UI.renderChatList();
}

/* ------------------------------ notification helper ------------------------------ */
function maybeNotify(msg, mine) {
  if (mine || UI.currentRoom === msg.room_id || document.visibilityState === "visible") return;
  const room = DB.rooms.find((r) => r.id === msg.room_id);
  if (!room) return;
  if (window.Notification && Notification.permission === "granted") {
    try {
      new Notification(room.name, {
        body: previewText(msg).slice(0, 120),
        icon: "./icons/icon-192.png",
        tag: msg.room_id
      });
    } catch (e) {}
  }
  updateNavBadges();
}
