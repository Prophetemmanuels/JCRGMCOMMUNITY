/* ============================================================================
   JCRGM CONNECT — UI: Rendering, navigation, composer, message interactions
   ========================================================================== */
"use strict";

const UI = {
  currentRoom: null,
  scrollLocked: true,

  /* =========================== RENDER: ALL =========================== */
  renderAll() {
    renderOnboardingMe();
    this.renderChatList();
    this.renderStatusList();
    this.renderCalls();
    updateNavBadges();
    if (this.currentRoom) this.renderChat();
  },

  /* =========================== CHAT LIST =========================== */
  renderChatList() {
    const list = $("#chats-list");
    if (!list) return;
    const q = APP.searchQuery.trim().toLowerCase();

    let rooms = DB.rooms.slice();

    // filters
    if (APP.chatFilter === "unread") rooms = rooms.filter((r) => (r.unread || 0) > 0);
    else if (APP.chatFilter === "pinned") rooms = rooms.filter((r) => r.pinned);
    else if (["ministry", "team", "group", "direct"].includes(APP.chatFilter)) rooms = rooms.filter((r) => r.category === APP.chatFilter);

    if (q) {
      rooms = rooms.filter((r) => {
        if (r.name.toLowerCase().includes(q)) return true;
        return roomMessages(r.id).some((m) => (m.content || "").toLowerCase().includes(q));
      });
    }

    // sort: category sections (ministry → team → groups → direct), pinned first inside
    const catOrder = { ministry: 0, team: 1, group: 2, direct: 3 };
    rooms.sort((a, b) => {
      const grouped = APP.chatFilter === "all" && !q;
      if (grouped) {
        const d = (catOrder[a.category] ?? 9) - (catOrder[b.category] ?? 9);
        if (d !== 0) return d;
      }
      if (!!b.pinned - !!a.pinned) return (!!b.pinned) - (!!a.pinned);
      const la = lastMessage(a.id), lb = lastMessage(b.id);
      return new Date(lb ? lb.created_at : 0) - new Date(la ? la.created_at : 0);
    });

    if (!rooms.length) {
      list.innerHTML = q
        ? '<div class="empty-state"><div class="big">🔍</div><h3>No results for "' + esc(APP.searchQuery) + '"</h3><p>Try another name, group or message text.</p></div>'
        : '<div class="empty-state"><div class="big">💬</div><h3>No chats here</h3><p>Tap the compose button to start a new JCRGM conversation.</p></div>';
      return;
    }

    let html = "";
    let lastCat = "";
    rooms.forEach((room) => {
      const showLabel = APP.chatFilter === "all" && !q && room.category !== "direct";
      if (showLabel && room.category !== lastCat) {
        lastCat = room.category;
        const labels = { ministry: "⛪ JCRGM MINISTRY & COMMUNITY", team: "💼 JCRGM TEAMS & OPERATIONS", group: "👥 MY GROUPS" };
        const counts = {
          ministry: rooms.filter((r) => r.category === "ministry").length,
          team: rooms.filter((r) => r.category === "team").length,
          group: rooms.filter((r) => r.category === "group").length
        };
        html += '<div class="section-label">' + (labels[room.category] || room.category) + ' <span class="cnt">(' + counts[room.category] + ")</span></div>";
      }
      if (showLabel === false && !q && room.category === "direct" && lastCat !== "direct") {
        lastCat = "direct";
        html += '<div class="section-label">💬 DIRECT MESSAGES <span class="cnt">(' + rooms.filter((r) => r.category === "direct").length + ")</span></div>";
      }
      html += this.chatRowHTML(room, q);
    });
    list.innerHTML = html;
  },

  chatRowHTML(room, q) {
    const lm = lastMessage(room.id);
    const unread = room.unread || 0;
    const time = lm ? fmtListTime(lm.created_at) : "";
    const isTyping = this.isRoomTyping(room.id);
    let preview;
    if (isTyping) {
      preview = '<span class="typing">' + esc(isTyping) + " is typing…</span>";
    } else if (lm) {
      const tick = lm.sender_id === APP.me.id && lm.status === "read"
        ? '<span class="tick-mini">✓✓</span>'
        : lm.sender_id === APP.me.id && lm.status === "delivered" ? '<span class="tick-mini" style="color:var(--text-muted)">✓✓</span>' : "";
      const text = q
        ? highlight(previewText(lm), q)
        : esc(previewText(lm));
      preview = tick + "<span>" + text + "</span>";
    } else {
      preview = "<span>" + esc(room.subtitle || "New chat") + "</span>";
    }

    const contact = contactOfRoom(room);
    const online = contact && (contact.online || APP.presence[contact.id]);
    const catTag = room.category !== "direct"
      ? '<span class="cat-tag ' + room.category + '">' + (room.category === "ministry" ? "Ministry" : room.category === "team" ? "Team" : "Group") + "</span>"
      : "";
    const chanIco = room.is_channel ? '<span class="chan-ico">📢</span>' : "";
    const nameHl = q ? highlight(room.name, q) : esc(room.name);

    return (
      '<div class="chat-row' + (room.pinned ? " pinned" : "") + '" data-room="' + esc(room.id) + '">' +
        avatarHTML(room, online) +
        '<div class="meta">' +
          '<div class="line1">' +
            '<span class="name">' + nameHl + (room.category === "ministry" && room.is_channel ? '<span class="verify">✔</span>' : "") + "</span>" +
            '<span class="time' + (unread ? " unread-t" : "") + '">' + (unread ? "now" : time) + "</span>" +
          "</div>" +
          '<div class="line2">' +
            '<span class="preview">' + preview + "</span>" +
            '<span class="badges">' + catTag +
              (room.pinned ? '<span class="pin-ico">📌</span>' : "") +
              (room.muted ? '<span class="mute-ico">🔕</span>' : "") +
              chanIco +
              (unread ? '<span class="unread-badge">' + (unread > 99 ? "99+" : unread) + "</span>" : "") +
            "</span>" +
          "</div>" +
        "</div>" +
      "</div>"
    );
  },

  isRoomTyping(roomId) {
    const t = APP.typing[roomId];
    if (!t) return null;
    const now = Date.now();
    let name = null;
    Object.keys(t).forEach((k) => {
      if (t[k].until > now) name = t[k].name;
      else delete t[k];
    });
    return name;
  },

  /* =========================== CHAT SCREEN =========================== */
  openRoom(roomId, opts = {}) {
    const room = DB.rooms.find((r) => r.id === roomId);
    if (!room) return;
    this.currentRoom = roomId;
    APP.activeRoomId = roomId;
    Cloud.markRoomRead(roomId);
    Cloud.sendReadReceipt(roomId);

    $("#screen-main").classList.remove("active");
    $("#screen-profile").classList.remove("active");
    const chatScreen = $("#screen-chat");
    chatScreen.classList.add("active", "entering");
    setTimeout(() => chatScreen.classList.remove("entering"), 200);

    // header
    const contact = contactOfRoom(room);
    const av = $("#chat-avatar");
    av.className = "avatar " + (room.is_group ? "group-avatar" : "");
    if (room.is_group) {
      av.style.background = room.avatar_bg || colorFor(room.id);
      av.textContent = room.avatar_icon || initials(room.name);
    } else {
      av.style.background = (contact && contact.avatar_color) || room.avatar_bg || colorFor(room.name);
      av.textContent = initials(room.name);
    }
    $("#chat-title").innerHTML = esc(room.name) + (room.is_channel ? ' <span class="verify" style="color:var(--wa-teal)">✔</span>' : "");
    this.updateChatSub();

    // composer state
    const readOnly = !adminCanPost(room);
    $("#channel-bar").classList.toggle("show", readOnly);
    $("#composer").style.display = readOnly ? "none" : "flex";
    $("#msg-input").placeholder = room.category === "direct" ? "Message " + (room.name.split(" ")[0] || "") : "Message " + room.name;

    // restore draft
    const drafts = STORE.get("drafts", {});
    $("#msg-input").value = drafts[roomId] || "";
    autoGrow($("#msg-input"));
    updateSendIcon();

    this.renderChat(true);
    this.renderChatList();
    updateNavBadges();
    closeAllPanels();

    if (opts.focus) setTimeout(() => $("#msg-input").focus(), 120);
  },

  closeRoom() {
    Cloud.sendReadReceipt(this.currentRoom);
    this.currentRoom = null;
    $("#screen-chat").classList.remove("active");
    $("#screen-main").classList.add("active");
    closeAllPanels();
    cancelReply();
    this.renderChatList();
  },

  updateChatSub() {
    if (!this.currentRoom) return;
    const room = DB.rooms.find((r) => r.id === this.currentRoom);
    if (!room) return;
    const sub = $("#chat-sub");
    const typingName = this.isRoomTyping(room.id);
    if (typingName) {
      sub.textContent = typingName + " is typing…";
      sub.classList.add("live-typing");
      return;
    }
    sub.classList.remove("live-typing");
    if (room.is_group) {
      sub.textContent = room.subtitle || (room.member_count + " members");
    } else {
      const contact = contactOfRoom(room);
      const online = contact && (contact.online || APP.presence[contact.id]);
      if (online) sub.innerHTML = '<span class="presence-online">online</span>';
      else if (contact && contact.last_seen) sub.textContent = "last seen " + fmtListTime(contact.last_seen);
      else sub.textContent = (contact && contact.role) || "tap for info";
    }
  },

  renderChat(scrollToBottom = false) {
    if (!this.currentRoom) return;
    const room = DB.rooms.find((r) => r.id === this.currentRoom);
    const wp = $("#chat-wallpaper");
    const msgs = roomMessages(this.currentRoom);

    let html = '<div class="encryption-note"><span class="lock">🔒</span> Messages and calls are secured with end-to-end style encryption. Only JCRGM members can read or share them! ' + (Cloud.connected() ? "Synced live via Supabase Cloud." : "🔒 Stored privately on this device — connect Cloud to sync across devices.") + "</div>";

    let prev = null;
    msgs.forEach((m) => {
      const day = new Date(m.created_at).toDateString();
      if (!prev || new Date(prev.created_at).toDateString() !== day) {
        html += '<div class="day-divider"><span>' + fmtDayLabel(m.created_at) + "</span></div>";
      }
      html += msgHTML(m, prev, room);
      prev = m;
    });

    // typing indicator
    const typingName = this.isRoomTyping(this.currentRoom);
    if (typingName) {
      html += '<div class="msg group-start"><div class="bubble typing-bubble" style="border-top-left-radius:9px"><i></i><i></i><i></i></div></div>';
    }

    if (!msgs.length) {
      html += '<div class="empty-state" style="padding-top:60px"><div class="big">' + (room.avatar_icon || "👋") + "</div><h3>" + esc(room.name) + "</h3><p>" + esc(room.description || room.subtitle || "Say hello! 👋") + "</p></div>";
    }

    wp.innerHTML = html;
    if (scrollToBottom !== false) this.scrollChatBottom();
  },

  scrollChatBottom() {
    const wp = $("#chat-wallpaper");
    wp.scrollTop = wp.scrollHeight;
    APP.pinnedBottom[this.currentRoom] = false;
    $("#jump-bottom").classList.remove("show");
  },

  saveDraftAndFocus() {}
};

function refreshChatSubIfOpen() { if (UI.currentRoom) UI.updateChatSub(); }

/* ------------------------------ Avatar helper ------------------------------ */
function avatarHTML(room, online) {
  const contact = contactOfRoom(room);
  const bg = room.is_group ? (room.avatar_bg || colorFor(room.id)) : ((contact && contact.avatar_color) || room.avatar_bg || colorFor(room.name));
  const inner = room.is_group ? (room.avatar_icon || initials(room.name)) : initials(room.name);
  return (
    '<div class="avatar' + (room.is_group ? " group-avatar" : "") + '" style="background:' + esc(bg) + '">' +
    esc(inner) +
    (online ? '<span class="online-dot"></span>' : "") +
    "</div>"
  );
}
function personAvatarHTML(profile, size = "", online) {
  const bg = profile.avatar_color || colorFor(profile.id);
  return '<div class="avatar ' + size + '" style="background:' + esc(bg) + '">' + esc(initials(profile.display_name)) +
    (online || profile.online ? '<span class="online-dot"></span>' : "") + "</div>";
}
function highlight(text, q) {
  if (!q) return esc(text);
  const idx = text.toLowerCase().indexOf(q);
  if (idx < 0) return esc(text);
  return esc(text.slice(0, idx)) + '<b style="color:var(--wa-teal)">' + esc(text.slice(idx, idx + q.length)) + "</b>" + esc(text.slice(idx + q.length));
}

/* ------------------------------ Message HTML ------------------------------ */
function msgHTML(m, prev, room) {
  const mine = m.sender_id === APP.me.id;
  const groupStart = !prev || prev.sender_id !== m.sender_id ||
    (new Date(m.created_at) - new Date(prev.created_at)) > 6 * 60000 ||
    ["system", "announcement"].includes(m.msg_type);
  const cls = ["msg"];
  if (mine) cls.push("out");
  if (groupStart) cls.push("group-start");
  if (m.msg_type === "scripture") cls.push("scripture");
  if (m.msg_type === "announcement") cls.push("announcement");

  let inner = "";

  // sender name (groups)
  if (!mine && room.is_group && groupStart && m.msg_type !== "system") {
    inner += '<div class="sender-name">' + esc(m.sender_name) +
      (m.sender_role && m.sender_role !== "Member" && m.sender_role !== "Group" ? '<span class="role">' + esc(m.sender_role) + "</span>" : "") +
      "</div>";
  }

  // reply quote
  if (m.reply_to && m.reply_to.name) {
    inner += '<div class="reply-quote" data-jump="' + esc(m.reply_to.id || "") + '"><span class="rq-name">' + esc(m.reply_to.name) + '</span><span class="rq-text">' + esc(m.reply_to.text) + "</span></div>";
  }

  // type tag
  if (m.msg_type === "scripture") inner += '<span class="msg-tag">📖 Scripture</span>';
  if (m.msg_type === "announcement") inner += '<span class="msg-tag">📣 Announcement</span>';

  // media body
  if (m.msg_type === "image" && m.media_url) {
    inner += '<div class="msg-media"><img src="' + esc(m.media_url) + '" alt="photo" loading="lazy" onclick="openImageLightbox(this.src)">' +
      (m.content ? '<span class="media-caption-badge">' + esc(m.content) + "</span>" : "") + "</div>";
    if (!m.content) { /* media only */ }
  } else if (m.msg_type === "document") {
    const meta = m.media_meta || {};
    const ext = (meta.name || "").split(".").pop().toUpperCase().slice(0, 4);
    const cls2 = /png|jpg|jpeg|gif|webp|svg/i.test(ext) ? "img" : /zip|rar|7z|tar|gz/i.test(ext) ? "zip" : "";
    inner += '<div class="doc-chip" onclick="downloadDoc(this)" data-url="' + esc(m.media_url || "") + '" data-name="' + esc(meta.name || "document") + '">' +
      '<div class="doc-ico ' + cls2 + '">' + esc(ext || "DOC") + "</div>" +
      '<div style="min-width:0"><div class="doc-name">' + esc(meta.name || "Document") + '</div><div class="doc-size">' + esc(bytesLabel(meta.size)) + " • tap to open</div></div></div>";
    if (m.content) inner += '<div class="body-text">' + linkify(m.content) + "</div>";
  } else if (m.msg_type === "audio") {
    inner += voiceNoteHTML(m);
    if (m.content) inner += '<div class="body-text">' + linkify(m.content) + "</div>";
  } else if (m.msg_type === "poll") {
    inner += pollHTML(m);
  } else if (m.msg_type === "contact") {
    const c = m.media_meta || {};
    inner += '<div class="doc-chip" style="cursor:default"><div class="doc-ico" style="background:#0195a7;border-radius:50%;height:40px;width:40px">👤</div>' +
      '<div><div class="doc-name">' + esc(c.name || "Contact") + '</div><div class="doc-size">' + esc(c.handle || "") + "</div></div></div>";
  } else if (m.msg_type === "system") {
    return '<div class="sys-msg"><span>' + esc(m.content) + "</span></div>";
  } else {
    if (m.content && m.msg_type === "scripture") {
      inner += '<div class="body-text">' + linkify(m.content) + '</div><span class="scripture-ref">— ' + esc((m.media_meta && m.media_meta.ref) || "Scripture") + "</span>";
    } else if (m.content) {
      inner += '<div class="body-text">' + linkify(m.content) + "</div>";
    }
  }

  // edited mark
  if (m.edited) inner += ' <span class="edit-mark">(edited)</span>';

  // reactions
  if (m.reactions && Object.keys(m.reactions).length) {
    const pills = Object.keys(m.reactions).map((emoji) => {
      const arr = m.reactions[emoji] || [];
      const mineR = arr.includes(APP.me.id);
      return '<button class="reaction-pill' + (mineR ? " mine" : "") + '" data-react="' + emoji + '" data-msg="' + m.id + '">' + emoji + (arr.length > 1 ? '<span class="r-count">' + arr.length + "</span>" : "") + "</button>";
    }).join("");
    inner += '<div class="reactions-row">' + pills + "</div>";
  }

  // meta line: time + ticks
  let ticks = "";
  if (mine) {
    const st = m.status || "sent";
    const cls3 = st === "read" ? "read" : "";
    ticks = '<span class="ticks ' + cls3 + '">' + (st === "sent" ? "✓" : "✓✓") + "</span>";
  }
  inner += '<div class="meta-line"><span class="msg-time">' + fmtTime(m.created_at) + "</span>" + ticks + "</div>";

  // hover reply action
  inner += '<button class="reply-action" data-reply="' + m.id + '" title="Reply">↩</button>';

  return '<div class="' + cls.join(" ") + '" data-id="' + m.id + '"><div class="bubble">' + inner + "</div></div>";
}

function voiceNoteHTML(m) {
  const meta = m.media_meta || {};
  const dur = meta.duration || 0;
  const bars = (meta.wave || defaultWave(24)).map((h, i) =>
    '<span class="wb" style="height:' + h + '%" data-i="' + i + '"></span>').join("");
  const mine = m.sender_id === APP.me.id;
  const senderColor = m.sender_color || colorFor(m.sender_id);
  return (
    '<div class="voice-note" data-audio="' + esc(m.id) + '">' +
      '<button class="vn-play" data-play="' + esc(m.id) + '">▶</button>' +
      '<div class="vn-body">' +
        '<div class="voice-wave">' + bars + "</div>" +
        '<div class="vn-meta"><span>' + fmtDur(dur) + "</span><span>" + fmtTime(m.created_at) + "</span></div>" +
      "</div>" +
      '<div class="avatar xs vn-avatar" style="background:' + esc(senderColor) + '">' + esc(mine ? "Me" : initials(m.sender_name)) + "</div>" +
    "</div>"
  );
}
function defaultWave(n) {
  const out = [];
  for (let i = 0; i < n; i++) out.push(25 + Math.round(Math.abs(Math.sin(i * 1.7) * Math.cos(i * 0.6)) * 75));
  return out;
}

function pollHTML(m) {
  const meta = m.media_meta || {};
  const opts = meta.options || [];
  const votes = opts.map((o) => (o.v || []).length);
  const total = votes.reduce((a, b) => a + b, 0) || 0;
  const myVoteIdx = opts.findIndex((o) => (o.v || []).includes(APP.me.id));
  const optHTML = opts.map((o, i) => {
    const pct = total ? Math.round(votes[i] / total * 100) : 0;
    return '<div class="poll-option' + (i === myVoteIdx ? " voted" : "") + '" data-poll-msg="' + m.id + '" data-poll-idx="' + i + '">' +
      '<div class="poll-bar" style="width:' + (total ? pct : 0) + '%"></div>' +
      '<div class="poll-label"><span>' + (i === myVoteIdx ? "◉ " : "○ ") + esc(o.t) + '</span><span class="poll-pct">' + (total ? pct + "%" : "") + "</span></div></div>";
  }).join("");
  return (
    '<div class="poll-card">' +
      '<div class="poll-q">' + esc(meta.question || "Poll") + "</div>" +
      '<div class="poll-by">📊 ' + esc(meta.pollBy || "Poll") + "</div>" +
      optHTML +
      '<div class="poll-foot">' + total + " vote" + (total === 1 ? "" : "s") + " • tap to vote</div>" +
    "</div>"
  );
}

/* =========================== STATUS LIST =========================== */
UI.renderStatusList = function () {
  const el = $("#status-list");
  if (!el) return;
  const now = Date.now();
  const recent = DB.statuses.filter((s) => new Date(s.created_at).getTime() > now - 86400000 && s.user_id !== APP.me.id);
  const mine = DB.statuses.filter((s) => s.user_id === APP.me.id && new Date(s.created_at).getTime() > now - 86400000);

  const myAv = $("#status-my-avatar");
  if (myAv) {
    myAv.style.background = APP.me.color;
    myAv.innerHTML = esc(initials(APP.me.name)) + (mine.length ? "" : '<span class="plus-badge">+</span>');
  }
  const myTitle = $(".sm-title");
  const mySub = $(".sm-sub");
  if (myTitle) myTitle.textContent = mine.length ? "My status" : "Add my status";
  if (mySub) mySub.textContent = mine.length ? mine.length + " update" + (mine.length > 1 ? "s" : "") + " • " + fmtListTime(mine[0].created_at) : "Share a 24-hour testimony, prayer point or praise report";

  $("#status-recent-label").textContent = "Recent updates (" + recent.length + ")";

  if (!recent.length) {
    el.innerHTML = '<div class="empty-state" style="padding-top:30px"><div class="big">📸</div><h3>No status updates yet</h3><p>Be the first — tap "Add my status" to share with the JCRGM family.</p></div>';
    return;
  }

  // group by user
  const byUser = {};
  recent.forEach((s) => { (byUser[s.user_id] = byUser[s.user_id] || []).push(s); });

  el.innerHTML = Object.keys(byUser).map((uid2) => {
    const items = byUser[uid2];
    const latest = items[0];
    const seen = items.every((s) => APP.statusSeen[s.id]);
    const prof = profileById(uid2);
    const online = prof && (prof.online || APP.presence[uid2]);
    return (
      '<div class="status-row" data-status-user="' + esc(uid2) + '">' +
        '<div class="status-ring' + (seen ? " seen" : "") + '">' +
          '<div class="avatar" style="background:' + esc(latest.avatar_color) + '">' + esc(initials(latest.user_name)) + (online ? '<span class="online-dot"></span>' : "") + "</div>" +
        "</div>" +
        '<div style="flex:1;min-width:0">' +
          '<div class="st-name">' + esc(latest.user_name) + (latest.user_id === APP.me.id ? " (You)" : "") + "</div>" +
          '<div class="st-time">' + esc(latest.category || "Status") + " • " + fmtListTime(latest.created_at) + "</div>" +
        "</div>" +
        (items.length > 1 ? '<span class="unread-badge">' + items.length + "</span>" : "") +
      "</div>"
    );
  }).join("");
};

/* =========================== CALLS LIST =========================== */
UI.renderCalls = function () {
  const el = $("#calls-list");
  if (!el) return;
  const calls = DB.calls.slice().sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  $("#calls-cnt").textContent = calls.length ? calls.length + "" : "";
  $("#calls-empty").classList.toggle("hidden", calls.length > 0);
  el.innerHTML = calls.map((c) => {
    const missed = c.status === "missed" || c.status === "declined";
    const dirIco = c.direction === "incoming" ? "↙" : "↗";
    const cls = c.direction === "incoming" ? "in-ico" : "out-ico";
    const icon = c.call_type === "video" ? "🎥" : "📞";
    return (
      '<div class="call-row" data-call-room="' + esc(c.room_id) + '" data-call-type="' + esc(c.call_type) + '">' +
        '<div class="avatar" style="background:' + esc(colorFor(c.room_name)) + '">' + esc(initials(c.room_name)) + "</div>" +
        '<div class="meta">' +
          '<div class="c-name" style="' + (missed ? "color:var(--danger)" : "") + '">' + esc(c.room_name) + "</div>" +
          '<div class="c-sub"><span class="' + cls + '">' + dirIco + "</span> " +
            (missed ? '<span class="missed">Missed</span>' : (c.status === "declined" ? "Declined" : fmtDur(c.duration_sec))) +
            " • " + fmtListTime(c.created_at) + " " + icon + "</div>" +
        "</div>" +
        '<div class="call-actions"><button class="icon-btn" title="Call back">' + icon + "</button></div>" +
      "</div>"
    );
  }).join("");
};

/* =========================== NAV / TABS =========================== */
function switchTab(tab) {
  APP.activeTab = tab;
  $$(".nav-item[data-tab]").forEach((b) => b.classList.toggle("active", b.dataset.tab === tab));
  $$(".view").forEach((v) => v.classList.toggle("active", v.id === "view-" + tab));
  if (tab === "status") { UI.renderStatusList(); }
  if (tab === "calls") UI.renderCalls();
  if (tab === "chats") UI.renderChatList();
}
function updateNavBadges() {
  const un = totalUnread();
  const b = $("#badge-chats");
  b.classList.toggle("hidden", un === 0);
  b.textContent = un > 99 ? "99+" : un;
  const now = Date.now();
  const unseen = DB.statuses.filter((s) => new Date(s.created_at).getTime() > now - 86400000 && s.user_id !== APP.me.id && !APP.statusSeen[s.id]).length;
  const sb = $("#badge-status");
  sb.classList.toggle("hidden", unseen === 0);
  sb.textContent = unseen;
  const missed = DB.calls.filter((c) => (c.status === "missed") && !c.seen).length;
  const cb = $("#badge-calls");
  cb.classList.toggle("hidden", missed === 0);
  cb.textContent = missed;
}

/* =========================== COMPOSER =========================== */
function autoGrow(ta) {
  ta.style.height = "auto";
  ta.style.height = Math.min(ta.scrollHeight, 120) + "px";
}
function updateSendIcon() {
  const has = $("#msg-input").value.trim().length > 0;
  $("#send-ico").innerHTML = '<use href="#' + (has ? "i-send" : "i-mic") + '"/>';
}
function closeAllPanels() {
  $("#emoji-panel").classList.remove("show");
  $("#attach-panel").classList.remove("show");
  CtxMenu.close();
}
function cancelReply() {
  APP.replyTo = null;
  $("#reply-bar").classList.remove("show");
}
function setReply(msgId) {
  const m = DB.messages.find((x) => x.id === msgId);
  if (!m) return;
  APP.replyTo = { id: m.id, name: m.sender_id === APP.me.id ? "You" : m.sender_name, text: previewText(m).replace(/^You: /, "") };
  $("#rb-name").textContent = "Reply to " + APP.replyTo.name;
  $("#rb-text").textContent = APP.replyTo.text;
  $("#reply-bar").classList.add("show");
  $("#msg-input").focus();
}

function sendTextMessage() {
  const ta = $("#msg-input");
  const text = ta.value.trim();
  if (!text || !UI.currentRoom) return;
  const room = DB.rooms.find((r) => r.id === UI.currentRoom);
  if (!room || !adminCanPost(room)) return;

  const msg = {
    id: uid("msg"),
    room_id: UI.currentRoom,
    sender_id: APP.me.id,
    sender_name: APP.me.name,
    sender_role: APP.me.role,
    sender_color: APP.me.color,
    msg_type: "text",
    content: text,
    media_url: "",
    media_meta: {},
    reply_to: APP.replyTo ? Object.assign({}, APP.replyTo) : null,
    reactions: {},
    status: "sent",
    created_at: new Date().toISOString()
  };

  ta.value = "";
  autoGrow(ta);
  updateSendIcon();
  cancelReply();
  const drafts = STORE.get("drafts", {});
  delete drafts[UI.currentRoom];
  STORE.set("drafts", drafts);

  Cloud.sendMessage(msg);
  Cloud.sendTyping(UI.currentRoom);
  maybeAutoReply(room);
}

function buildAndSendRaw(partial) {
  const base = {
    id: uid("msg"),
    room_id: UI.currentRoom,
    sender_id: APP.me.id,
    sender_name: APP.me.name,
    sender_role: APP.me.role,
    sender_color: APP.me.color,
    media_url: "",
    media_meta: {},
    reply_to: APP.replyTo ? Object.assign({}, APP.replyTo) : null,
    reactions: {},
    status: "sent",
    created_at: new Date().toISOString()
  };
  const msg = Object.assign(base, partial);
  cancelReply();
  Cloud.sendMessage(msg);
  const room = DB.rooms.find((r) => r.id === UI.currentRoom);
  if (room && room.category === "direct") maybeAutoReply(room);
}

/* =========================== VOICE RECORDER =========================== */
const VoiceRecorder = {
  mediaRec: null, chunks: [], stream: null, timer: null, startTs: 0, analyser: null, raf: null,
  async start() {
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (e) {
      toast("Microphone access denied — check browser permissions", "error");
      return false;
    }
    this.chunks = [];
    try {
      this.mediaRec = new MediaRecorder(this.stream);
    } catch (e) {
      toast("Audio recording not supported in this browser", "error");
      return false;
    }
    this.mediaRec.ondataavailable = (ev) => { if (ev.data.size) this.chunks.push(ev.data); };
    this.mediaRec.onstop = () => this.onStop();
    this.mediaRec.start();
    this.startTs = Date.now();

    // visualizer
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      const src = ctx.createMediaStreamSource(this.stream);
      this.analyser = ctx.createAnalyser();
      this.analyser.fftSize = 64;
      src.connect(this.analyser);
      const wave = $("#rec-wave");
      wave.innerHTML = Array.from({ length: 36 }, () => '<span class="wb"></span>').join("");
      const bars = $$("#rec-wave .wb");
      const data = new Uint8Array(this.analyser.frequencyBinCount);
      const loop = () => {
        this.analyser.getByteFrequencyData(data);
        bars.forEach((b, i) => {
          const v = data[i % data.length] / 255;
          b.style.height = Math.max(3, v * 24) + "px";
        });
        this.raf = requestAnimationFrame(loop);
      };
      loop();
    } catch (e) {}

    this.timer = setInterval(() => {
      const sec = (Date.now() - this.startTs) / 1000;
      $("#rec-time").textContent = fmtDur(sec);
      if (sec >= 90) this.stop(true);
    }, 250);

    $("#recording-ui").classList.add("active");
    $("#input-shell").classList.add("hidden");
    return true;
  },
  stop(save = true) {
    this._save = save;
    clearInterval(this.timer);
    cancelAnimationFrame(this.raf);
    try { if (this.mediaRec && this.mediaRec.state !== "inactive") this.mediaRec.stop(); } catch (e) {}
    try { if (this.stream) this.stream.getTracks().forEach((t) => t.stop()); } catch (e) {}
    $("#recording-ui").classList.remove("active");
    $("#input-shell").classList.remove("hidden");
    $("#rec-time").textContent = "0:00";
  },
  async onStop() {
    if (!this._save) { this.chunks = []; return; }
    const dur = Math.round((Date.now() - this.startTs) / 1000);
    if (dur < 1) { toast("Recording too short", "error"); return; }
    const blob = new Blob(this.chunks, { type: this.chunks[0] ? this.chunks[0].type : "audio/webm" });
    this.chunks = [];
    const reader = new FileReader();
    reader.onload = () => {
      buildAndSendRaw({
        msg_type: "audio",
        content: "",
        media_url: reader.result,
        media_meta: { duration: dur, wave: defaultWave(24), type: blob.type, size: blob.size }
      });
      toast("Voice note sent 🎤", "success", 1800);
    };
    reader.readAsDataURL(blob);
  }
};

/* =========================== AUDIO PLAYBACK =========================== */
const AudioPlayer = {
  el: null, msgId: null, timer: null, startTs: 0,
  play(msgId) {
    if (this.msgId === msgId && this.el && !this.el.paused) { this.pause(); return; }
    this.stopAll();
    const m = DB.messages.find((x) => x.id === msgId);
    if (!m || !m.media_url) { toast("Voice note unavailable", "error"); return; }
    this.msgId = msgId;
    this.el = new Audio(m.media_url);
    this.el.play().catch(() => toast("Tap again to play 🎤", "info"));
    this.startTs = Date.now();
    const dur = (m.media_meta && m.media_meta.duration) || 0;
    const btn = document.querySelector('[data-play="' + msgId + '"]');
    if (btn) btn.textContent = "❚❚";
    const bars = document.querySelectorAll('[data-audio="' + msgId + '"] .wb');
    this.timer = setInterval(() => {
      if (!this.el) return;
      const frac = dur ? Math.min(1, (Date.now() - this.startTs) / 1000 / dur) : (this.el.duration ? this.el.currentTime / this.el.duration : 0);
      const upto = Math.round(frac * bars.length);
      bars.forEach((b, i) => b.classList.toggle("played", i < upto));
      if (this.el.ended || (dur && (Date.now() - this.startTs) / 1000 > dur + 0.3)) this.stopAll();
    }, 90);
    this.el.onended = () => this.stopAll();
  },
  pause() {
    if (this.el) this.el.pause();
    this.stopAll(false);
  },
  stopAll(reset = true) {
    clearInterval(this.timer);
    if (this.el) { try { this.el.pause(); } catch (e) {} }
    if (this.msgId) {
      const btn = document.querySelector('[data-play="' + this.msgId + '"]');
      if (btn) btn.textContent = "▶";
      if (reset) document.querySelectorAll('[data-audio="' + this.msgId + '"] .wb').forEach((b) => b.classList.remove("played"));
    }
    this.el = null; this.msgId = null;
  }
};

/* =========================== LIGHTBOX =========================== */
function openImageLightbox(src) {
  Modal.open({
    icon: "🖼️", title: "Photo", body:
      '<div style="text-align:center"><img src="' + esc(src) + '" style="max-width:100%;max-height:60vh;border-radius:12px" alt="photo"></div>',
    foot: '<button class="btn soft" onclick="Modal.close()">Close</button><a class="btn teal" href="' + esc(src) + '" download="jcrgm-photo">Download</a>'
  });
}
function downloadDoc(el) {
  const url = el.dataset.url, name = el.dataset.name || "document";
  if (url && url.startsWith("data:")) {
    const a = document.createElement("a");
    a.href = url; a.download = name;
    a.click();
  } else if (url) {
    window.open(url, "_blank");
  } else {
    toast("Document not available", "error");
  }
}

/* =========================== POLL VOTING =========================== */
function votePoll(msgId, optionIdx) {
  const m = DB.messages.find((x) => x.id === msgId);
  if (!m || m.msg_type !== "poll") return;
  const meta = m.media_meta;
  const already = meta.options.findIndex((o) => (o.v || []).includes(APP.me.id));
  if (already === optionIdx) return; // no toggle-off for simplicity
  meta.options.forEach((o) => {
    o.v = (o.v || []).filter((x) => x !== APP.me.id);
  });
  meta.options[optionIdx].v = (meta.options[optionIdx].v || []).concat([APP.me.id]);
  Cloud.updateMessage(msgId, { media_meta: meta });
}
