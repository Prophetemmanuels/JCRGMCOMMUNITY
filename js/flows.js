/* ============================================================================
   JCRGM CONNECT — FLOWS: modals, status viewer, call engine, events, init
   ========================================================================== */
"use strict";

/* =========================== ONBOARDING =========================== */
const ONBOARD_COLORS = ["#075E54", "#128C7E", "#25D366", "#6B46C1", "#D97706", "#DC2626", "#0E7490", "#B91C1C", "#0369A1", "#7C3AED"];

function renderOnboardingColors(sel) {
  $("#ob-colors").innerHTML = ONBOARD_COLORS.map((c) =>
    '<span class="color-dot' + (c === sel ? " sel" : "") + '" data-color="' + c + '" style="background:' + c + '"></span>').join("");
}

function renderOnboardingMe() {
  if (!APP.me) return;
  const sub = $("#brand-sub");
  if (sub) sub.textContent = APP.me.name + " • " + APP.me.role + " • " + (APP.me.department || "JCRGM");
}

function completeOnboarding() {
  const name = $("#ob-name").value.trim();
  if (name.length < 2) { toast("Please enter your display name (2+ characters)", "error"); $("#ob-name").focus(); return; }
  const color = ($("#ob-colors .color-dot.sel") || {}).dataset ? $("#ob-colors .color-dot.sel").dataset.color : ONBOARD_COLORS[0];
  APP.me = {
    id: uid("user"),
    name,
    role: $("#ob-role").value,
    department: $("#ob-dept").value.trim() || "Community",
    color: color || ONBOARD_COLORS[0],
    handle: "",
    bio: "Connected on JCRGM Connect"
  };
  STORE.set("me", APP.me);
  seedIfNeeded();
  enterApp();
}

function enterApp() {
  $("#screen-onboarding").classList.remove("active");
  $("#screen-main").classList.add("active");
  renderOnboardingMe();
  UI.renderAll();
  Cloud.sendPing();
  requestNotificationPermission(false);
  handleDeepLink();
}

/* =========================== NEW CHAT / GROUP FLOWS =========================== */
function openNewChatModal() {
  const contacts = DB.profiles.filter((p) => p.id !== APP.me.id);
  const body =
    '<div class="opt-list" style="margin-bottom:14px">' +
      '<button class="opt-item" data-new="group"><span class="o-ico">👥</span><div><div class="o-title">New Group</div><div class="o-sub">Create a JCRGM fellowship or family group</div></div></button>' +
      '<button class="opt-item" data-new="community"><span class="o-ico">⛪</span><div><div class="o-title">New Community / Ministry Channel</div><div class="o-sub">Broadcast announcements to a whole ministry or team</div></div></button>' +
      '<button class="opt-item" data-new="contact"><span class="o-ico">➕</span><div><div class="o-title">New Contact</div><div class="o-sub">Add someone by name or phone number</div></div></button>' +
    "</div>" +
    '<div class="section-label" style="padding:4px 0 8px">CONTACTS ON JCRGM CONNECT</div>' +
    '<div class="pick-list">' +
      (contacts.length ? contacts.map((p) =>
        '<div class="pick-item" data-dm="' + esc(p.id) + '">' + personAvatarHTML(p, "sm") +
        '<div><div class="p-name">' + esc(p.display_name) + '</div><div class="p-sub">' + esc(p.role) + " • " + esc(p.department || "") + "</div></div>" +
        '<span class="p-check">✓</span></div>').join("")
        : '<div class="empty-state" style="padding:24px 10px"><p>No contacts yet — add one!</p></div>') +
    "</div>";
  Modal.open({ icon: "💬", title: "New chat", sub: "Start a conversation", body });
}

function openNewGroupModal(mode) {
  const isCommunity = mode === "community";
  const contacts = DB.profiles.filter((p) => p.id !== APP.me.id);
  const body =
    '<div class="field"><label>Group name</label><input id="grp-name" maxlength="40" placeholder="' + (isCommunity ? "e.g. JCRGM Women's Fellowship" : "e.g. JCRGM Family Group") + '"></div>' +
    '<div class="field"><label>' + (isCommunity ? "Channel description" : "Description (optional)") + '</label><textarea id="grp-desc" maxlength="200" placeholder="What is this group about?"></textarea></div>' +
    (isCommunity
      ? '<div class="field"><label>Category</label><select id="grp-cat"><option value="ministry">⛪ Ministry / Community</option><option value="team">💼 Team / Department</option></select></div>'
      : "") +
    '<div class="section-label" style="padding:6px 0 4px">ADD PARTICIPANTS</div>' +
    '<div class="pick-list">' + contacts.map((p) =>
      '<div class="pick-item" data-pick="' + esc(p.id) + '">' + personAvatarHTML(p, "sm") +
      '<div><div class="p-name">' + esc(p.display_name) + '</div><div class="p-sub">' + esc(p.role) + "</div></div>" +
      '<span class="p-check">✓</span></div>').join("") + "</div>";
  Modal.open({
    icon: isCommunity ? "⛪" : "👥",
    title: isCommunity ? "New community channel" : "New group",
    sub: isCommunity ? "One-way broadcast to a ministry or team" : "Add JCRGM members",
    body,
    foot: '<button class="btn soft" onclick="Modal.close()">Cancel</button><button class="btn teal" id="grp-create">Create ' + (isCommunity ? "channel" : "group") + "</button>",
    onOpen(bodyEl, footEl) {
      footEl.querySelector("#grp-create").onclick = () => {
        const name = bodyEl.querySelector("#grp-name").value.trim();
        if (name.length < 2) { toast("Please enter a group name", "error"); return; }
        const picks = bodyEl.querySelectorAll(".pick-item.sel").length;
        const cat = isCommunity ? bodyEl.querySelector("#grp-cat").value : "group";
        const room = {
          id: uid("room"),
          name,
          subtitle: isCommunity ? "Official channel • announcements only" : "Group chat",
          category: cat,
          avatar_bg: "linear-gradient(135deg," + (isCommunity ? "#075E54,#D4AF37" : colorFor(name) + "," + colorFor(name + "x")) + ")",
          avatar_icon: isCommunity ? "📢" : initials(name),
          is_group: true,
          is_channel: isCommunity,
          pinned: false,
          member_count: picks + 1,
          description: bodyEl.querySelector("#grp-desc").value.trim(),
          created_by: APP.me.id
        };
        Cloud.createRoom(room);
        // system welcome message
        const sys = {
          id: uid("msg"), room_id: room.id, sender_id: "system", sender_name: "JCRGM",
          sender_role: "System", sender_color: "#075E54", msg_type: "system",
          content: APP.me.name + ' created ' + (isCommunity ? 'the channel "' : 'the group "') + name + '" 🎉',
          media_url: "", media_meta: {}, reply_to: null, reactions: {},
          created_at: new Date().toISOString()
        };
        DB.messages.push(sys); saveDB();
        Modal.close();
        toast(isCommunity ? "Channel created 📢" : "Group created 👥", "success");
        UI.openRoom(room.id, { focus: true });
      };
    }
  });
}

function openAddContactModal() {
  const body =
    '<div class="field"><label>Full name</label><input id="ct-name" maxlength="30" placeholder="e.g. Chanda Mwansa"></div>' +
    '<div class="field"><label>Phone number (optional)</label><input id="ct-phone" maxlength="20" placeholder="+260 977 000 000"></div>' +
    '<div class="field"><label>Role</label><select id="ct-role"><option>Member</option><option>Pastor</option><option>Leader</option><option>Deacon</option><option>Worship Lead</option><option>Media Team</option><option>Youth Leader</option></select></div>' +
    '<div class="field"><label>Department</label><input id="ct-dept" maxlength="30" placeholder="e.g. Outreach" value="Community"></div>';
  Modal.open({
    icon: "➕", title: "New contact", body,
    foot: '<button class="btn soft" onclick="Modal.close()">Cancel</button><button class="btn teal" id="ct-save">Save contact</button>',
    onOpen(bodyEl, footEl) {
      footEl.querySelector("#ct-save").onclick = () => {
        const name = bodyEl.querySelector("#ct-name").value.trim();
        if (name.length < 2) { toast("Enter the contact's name", "error"); return; }
        const phone = bodyEl.querySelector("#ct-phone").value.trim();
        if (phone && !isPhone(phone)) { toast("That phone number doesn't look right", "error"); return; }
        const p = {
          id: uid("contact"),
          display_name: name,
          handle: phone,
          role: bodyEl.querySelector("#ct-role").value,
          department: bodyEl.querySelector("#ct-dept").value.trim() || "Community",
          bio: "New JCRGM contact",
          avatar_color: colorFor(name),
          online: false
        };
        DB.profiles.push(p);
        saveDB();
        Cloud.broadcastLocal({ type: "profile", profile: p });
        if (Cloud.connected()) Cloud.upsertMyProfile();
        openDirectRoom(p);
        Modal.close();
        toast("Contact added ✅", "success");
      };
    }
  });
}

function openDirectRoom(profile) {
  let room = DB.rooms.find((r) => r.category === "direct" && r.contact_id === profile.id);
  if (!room) {
    room = {
      id: uid("dm"),
      name: profile.display_name,
      subtitle: "",
      category: "direct",
      avatar_bg: profile.avatar_color,
      avatar_icon: "",
      is_group: false, is_channel: false, pinned: false,
      member_count: 2, description: profile.bio || "",
      contact_id: profile.id
    };
    DB.rooms.unshift(room);
    saveDB();
    Cloud.createRoom(Object.assign({}, room));
    // intro system msg optional — skip
  }
  Modal.close();
  UI.openRoom(room.id, { focus: true });
}

/* =========================== SEARCH =========================== */
function toggleSearch(open) {
  const row = $("#search-row");
  const showIt = open !== undefined ? open : row.style.display === "none";
  row.style.display = showIt ? "block" : "none";
  if (showIt) $("#search-input").focus();
  else { APP.searchQuery = ""; $("#search-input").value = ""; UI.renderChatList(); }
}

/* =========================== CONTEXT MENU: MESSAGE =========================== */
function openMessageMenu(msgId, x, y) {
  const m = DB.messages.find((x2) => x2.id === msgId);
  if (!m) return;
  const items = [
    { act: "reply:" + msgId, icon: "↩", label: "Reply" },
    { act: "react:" + msgId, icon: "😀", label: "React" },
    { act: "copy:" + msgId, icon: "⧉", label: "Copy text" },
    { act: "forward:" + msgId, icon: "↪", label: "Forward" }
  ];
  if (m.sender_id === APP.me.id && m.msg_type === "text") items.push({ act: "edit:" + msgId, icon: "✎", label: "Edit" });
  items.push("-");
  items.push({ act: "star:" + msgId, icon: "⭐", label: (m.starred ? "Unstar message" : "Star message") });
  if (m.sender_id === APP.me.id) items.push({ act: "delete:" + msgId, icon: "🗑", label: "Delete for everyone", danger: true });
  CtxMenu.open(x, y, items);
}

function openReactPicker(msgId, x, y) {
  const emojis = ["❤️", "🙏", "👍", "😂", "😮", "😢", "✝️", "🔥", "🙌", "👏"];
  const items = emojis.map((e) => ({ act: "reactpick:" + msgId + ":" + e, icon: e, label: e }));
  CtxMenu.open(x, y, items);
}

function toggleReaction(msgId, emoji) {
  const m = DB.messages.find((x) => x.id === msgId);
  if (!m) return;
  m.reactions = m.reactions || {};
  if (!Array.isArray(m.reactions[emoji])) m.reactions[emoji] = [];
  const arr = m.reactions[emoji];
  const i = arr.indexOf(APP.me.id);
  if (i >= 0) arr.splice(i, 1); else arr.push(APP.me.id);
  if (!arr.length) delete m.reactions[emoji];
  Cloud.updateMessage(msgId, { reactions: m.reactions });
}

function forwardMessage(msgId) {
  const m = DB.messages.find((x) => x.id === msgId);
  if (!m) return;
  const rooms = DB.rooms.filter((r) => r.id !== m.room_id);
  const body = '<div class="pick-list">' + rooms.map((r) =>
    '<div class="pick-item" data-fwd="' + esc(r.id) + '">' + avatarHTML(r, false) +
    '<div><div class="p-name">' + esc(r.name) + '</div><div class="p-sub">' + esc(r.category) + "</div></div>" +
    '<span class="p-check">✓</span></div>').join("") + "</div>";
  Modal.open({
    icon: "↪", title: "Forward message", body,
    foot: '<button class="btn soft" onclick="Modal.close()">Cancel</button><button class="btn teal" id="fwd-go">Forward</button>',
    onOpen(bodyEl, footEl) {
      footEl.querySelector("#fwd-go").onclick = () => {
        const sel = bodyEl.querySelectorAll(".pick-item.sel");
        if (!sel.length) { toast("Choose at least one chat", "error"); return; }
        sel.forEach((el) => {
          const roomId = el.dataset.fwd;
          buildRawInto(roomId, {
            msg_type: m.msg_type === "system" ? "text" : m.msg_type,
            content: m.content,
            media_url: m.media_url,
            media_meta: m.media_meta ? JSON.parse(JSON.stringify(m.media_meta)) : {},
            reply_to: null
          });
        });
        Modal.close();
        toast("Forwarded to " + sel.length + " chat" + (sel.length > 1 ? "s" : ""), "success");
      };
    }
  });
}
function buildRawInto(roomId, partial) {
  const msg = Object.assign({
    id: uid("msg"), room_id: roomId,
    sender_id: APP.me.id, sender_name: APP.me.name, sender_role: APP.me.role, sender_color: APP.me.color,
    media_url: "", media_meta: {}, reply_to: null, reactions: {}, status: "sent",
    created_at: new Date().toISOString()
  }, partial);
  Cloud.sendMessage(msg);
}

function editMessage(msgId) {
  const m = DB.messages.find((x) => x.id === msgId);
  if (!m || m.msg_type !== "text") return;
  const body = '<div class="field"><label>Edit message</label><textarea id="edit-txt" maxlength="2000">' + esc(m.content) + "</textarea></div>";
  Modal.open({
    icon: "✎", title: "Edit message", body,
    foot: '<button class="btn soft" onclick="Modal.close()">Cancel</button><button class="btn teal" id="edit-save">Save</button>',
    onOpen(bodyEl, footEl) {
      footEl.querySelector("#edit-save").onclick = () => {
        const v = bodyEl.querySelector("#edit-txt").value.trim();
        if (!v) { toast("Message can't be empty", "error"); return; }
        Cloud.updateMessage(msgId, { content: v, edited: true });
        Modal.close();
        toast("Message edited ✏️", "success");
      };
    }
  });
}

function confirmDeleteMsg(msgId) {
  Modal.open({
    icon: "🗑", title: "Delete message?",
    body: '<p style="font-size:14px;color:var(--text-secondary);line-height:1.6">This message will be removed for everyone in the chat. This cannot be undone.</p>',
    foot: '<button class="btn soft" onclick="Modal.close()">Cancel</button><button class="btn danger" id="del-yes">Delete</button>',
    onOpen(b, f) {
      f.querySelector("#del-yes").onclick = () => { Cloud.deleteMessage(msgId); Modal.close(); toast("Message deleted", "info", 1600); };
    }
  });
}

/* =========================== SCRIPTURE / ANNOUNCEMENT / POLL / CONTACT =========================== */
function openScriptureModal() {
  const body =
    '<div class="field"><label>Verse text</label><textarea id="scr-txt" maxlength="600" placeholder="&quot;For God so loved the world…&quot;"></textarea></div>' +
    '<div class="field"><label>Reference</label><input id="scr-ref" maxlength="60" placeholder="John 3:16 (NIV)"></div>';
  Modal.open({
    icon: "📖", title: "Share Scripture", sub: "Posts as a highlighted verse card", body,
    foot: '<button class="btn soft" onclick="Modal.close()">Cancel</button><button class="btn gold" id="scr-send">Share verse</button>',
    onOpen(b, f) {
      f.querySelector("#scr-send").onclick = () => {
        const txt = b.querySelector("#scr-txt").value.trim();
        const ref = b.querySelector("#scr-ref").value.trim();
        if (!txt) { toast("Enter the verse text", "error"); return; }
        buildAndSendRaw({ msg_type: "scripture", content: txt, media_meta: { ref: ref || "Holy Scriptures" } });
        Modal.close();
      };
    }
  });
}

function openAnnounceModal() {
  const room = DB.rooms.find((r) => r.id === UI.currentRoom);
  if (room && !adminCanPost(room)) { toast("Only administrators can post announcements here", "error"); return; }
  const body =
    '<div class="field"><label>Announcement title / headline</label><input id="an-title" maxlength="90" placeholder="e.g. 🕊️ Sunday Service Update"></div>' +
    '<div class="field"><label>Details</label><textarea id="an-txt" maxlength="900" placeholder="Service times, events, schedules…"></textarea></div>';
  Modal.open({
    icon: "📣", title: "Post announcement", sub: "Highlighted broadcast-style message", body,
    foot: '<button class="btn soft" onclick="Modal.close()">Cancel</button><button class="btn teal" id="an-send">Post announcement</button>',
    onOpen(b, f) {
      f.querySelector("#an-send").onclick = () => {
        const t = b.querySelector("#an-title").value.trim();
        const x = b.querySelector("#an-txt").value.trim();
        if (!x && !t) { toast("Write your announcement", "error"); return; }
        const content = (t ? t + (x ? "\n\n" : "") : "") + x;
        buildAndSendRaw({ msg_type: "announcement", content });
        Modal.close();
        toast("Announcement posted 📣", "success");
      };
    }
  });
}

function openPollModal() {
  const body =
    '<div class="field"><label>Question</label><input id="poll-q" maxlength="120" placeholder="e.g. Best day for Bible study?"></div>' +
    '<div class="field"><label>Options (2–6, one per line)</label><textarea id="poll-opts" rows="4" placeholder="Tuesday&#10;Thursday&#10;Saturday"></textarea></div>';
  Modal.open({
    icon: "📊", title: "Create poll", body,
    foot: '<button class="btn soft" onclick="Modal.close()">Cancel</button><button class="btn teal" id="poll-go">Create poll</button>',
    onOpen(b, f) {
      f.querySelector("#poll-go").onclick = () => {
        const q = b.querySelector("#poll-q").value.trim();
        const opts = b.querySelector("#poll-opts").value.split("\n").map((s) => s.trim()).filter(Boolean).slice(0, 6);
        if (!q) { toast("Enter a question", "error"); return; }
        if (opts.length < 2) { toast("Add at least 2 options", "error"); return; }
        buildAndSendRaw({
          msg_type: "poll", content: "",
          media_meta: { question: q, options: opts.map((t) => ({ t, v: [] })), pollBy: APP.me.name }
        });
        Modal.close();
        toast("Poll created 📊", "success");
      };
    }
  });
}

function openShareContactModal() {
  const body = '<div class="pick-list">' + DB.profiles.filter((p) => p.id !== APP.me.id).map((p) =>
    '<div class="pick-item" data-share="' + esc(p.id) + '">' + personAvatarHTML(p, "sm") +
    '<div><div class="p-name">' + esc(p.display_name) + '</div><div class="p-sub">' + esc(p.handle || p.role) + "</div></div>" +
    '<span class="p-check">✓</span></div>').join("") + "</div>";
  Modal.open({
    icon: "👤", title: "Share contact", body,
    foot: '<button class="btn soft" onclick="Modal.close()">Cancel</button><button class="btn teal" id="share-go">Send</button>',
    onOpen(b, f) {
      f.querySelector("#share-go").onclick = () => {
        const sel = b.querySelector(".pick-item.sel");
        if (!sel) { toast("Choose a contact", "error"); return; }
        const p = profileById(sel.dataset.share);
        buildAndSendRaw({ msg_type: "contact", content: "Contact card", media_meta: { name: p.display_name, handle: p.handle, role: p.role, id: p.id } });
        Modal.close();
      };
    }
  });
}

/* =========================== SETTINGS / CLOUD / THEME =========================== */
function openSettingsModal() {
  const body =
    '<div class="profile-hero" style="padding-top:4px">' +
      '<div class="avatar" style="width:84px;height:84px;font-size:28px;background:' + esc(APP.me.color) + '">' + esc(initials(APP.me.name)) + "</div>" +
      '<h2 style="font-size:19px;margin-top:10px">' + esc(APP.me.name) + "</h2>" +
      '<div class="ph-sub">' + esc(APP.me.role) + " • " + esc(APP.me.department) + "</div>" +
    "</div>" +
    '<div class="stats-row">' +
      '<div class="stat-box"><div class="num">' + DB.rooms.length + '</div><div class="lbl">Chats</div></div>' +
      '<div class="stat-box"><div class="num">' + DB.messages.length + '</div><div class="lbl">Messages</div></div>' +
      '<div class="stat-box"><div class="num">' + DB.profiles.length + '</div><div class="lbl">Contacts</div></div>' +
    "</div>" +
    '<div class="section-label" style="padding:14px 0 6px">🎨 Theme</div>' +
    '<div class="theme-row" id="theme-row">' +
      '<div class="theme-card dark" data-theme-set="dark"><div class="swatch"></div>Dark</div>' +
      '<div class="theme-card light" data-theme-set="light"><div class="swatch"></div>Light</div>' +
      '<div class="theme-card royal" data-theme-set="royal"><div class="swatch"></div>Royal</div>' +
    "</div>" +
    '<div class="section-label" style="padding:14px 0 6px">⚙️ Preferences</div>' +
    '<div class="opt-list">' +
      '<button class="opt-item" data-set="profile"><span class="o-ico">👤</span><div><div class="o-title">Edit my profile</div><div class="o-sub">Name, role, department &amp; bio</div></div></button>' +
      '<button class="opt-item" data-set="notify"><span class="o-ico">🔔</span><div><div class="o-title">Notifications</div><div class="o-sub">Desktop alerts for new messages</div></div></button>' +
      '<button class="opt-item" data-set="starred"><span class="o-ico">⭐</span><div><div class="o-title">Starred messages</div><div class="o-sub">Your saved verses &amp; notes</div></div></button>' +
      '<button class="opt-item" data-set="reset"><span class="o-ico">🧹</span><div><div class="o-title">Reset local data</div><div class="o-sub">Clear chats stored on this device</div></div></button>' +
    "</div>" +
    '<div class="about-foot"><span class="brand-inline">JCRGM CONNECT</span> v' + esc(APP.VERSION) + "<br>WhatsApp-style Messenger • Ministry • Organization Hub<br>Installable Progressive Web App • Powered by Supabase</div>";
  Modal.open({
    icon: "⚙️", title: "Settings", body,
    onOpen(b) {
      b.querySelectorAll(".theme-card").forEach((c) => {
        c.classList.toggle("sel", c.dataset.themeSet === APP.theme);
        c.onclick = () => { applyTheme(c.dataset.themeSet); b.querySelectorAll(".theme-card").forEach((x) => x.classList.remove("sel")); c.classList.add("sel"); };
      });
      b.querySelectorAll("[data-set]").forEach((btn) => {
        btn.onclick = () => {
          const act = btn.dataset.set;
          if (act === "profile") openEditProfileModal();
          if (act === "notify") requestNotificationPermission(true);
          if (act === "starred") openStarredModal();
          if (act === "reset") confirmReset();
        };
      });
    }
  });
}

function openEditProfileModal() {
  const body =
    '<div class="field"><label>Display name</label><input id="pf-name" maxlength="28" value="' + esc(APP.me.name) + '"></div>' +
    '<div class="field"><label>Role</label><input id="pf-role" maxlength="30" value="' + esc(APP.me.role) + '"></div>' +
    '<div class="field"><label>Department</label><input id="pf-dept" maxlength="32" value="' + esc(APP.me.department || "") + '"></div>' +
    '<div class="field"><label>Phone (optional)</label><input id="pf-phone" maxlength="20" value="' + esc(APP.me.handle || "") + '" placeholder="+260 …"></div>' +
    '<div class="field"><label>Bio</label><textarea id="pf-bio" maxlength="160">' + esc(APP.me.bio || "") + "</textarea></div>" +
    '<div class="field"><label>Avatar color</label><div class="color-row" id="pf-colors"></div></div>';
  Modal.open({
    icon: "👤", title: "Edit profile", body,
    foot: '<button class="btn soft" onclick="Modal.close()">Cancel</button><button class="btn teal" id="pf-save">Save</button>',
    onOpen(b, f) {
      renderColorRow(b.querySelector("#pf-colors"), APP.me.color);
      f.querySelector("#pf-save").onclick = () => {
        const name = b.querySelector("#pf-name").value.trim();
        if (name.length < 2) { toast("Name too short", "error"); return; }
        APP.me.name = name;
        APP.me.role = b.querySelector("#pf-role").value.trim() || "Member";
        APP.me.department = b.querySelector("#pf-dept").value.trim();
        APP.me.handle = b.querySelector("#pf-phone").value.trim();
        APP.me.bio = b.querySelector("#pf-bio").value.trim();
        const sel = b.querySelector("#pf-colors .color-dot.sel");
        if (sel) APP.me.color = sel.dataset.color;
        STORE.set("me", APP.me);
        renderOnboardingMe();
        Cloud.upsertMyProfile();
        Cloud.sendPing();
        Modal.close();
        toast("Profile updated ✅", "success");
      };
    }
  });
}
function renderColorRow(container, sel) {
  container.innerHTML = ONBOARD_COLORS.map((c) =>
    '<span class="color-dot' + (c === sel ? " sel" : "") + '" data-color="' + c + '" style="background:' + c + '"></span>').join("");
}

function openStarredModal() {
  const starred = DB.messages.filter((m) => m.starred);
  const body = starred.length
    ? starred.map((m) =>
      '<div class="info-row starred-msg"><div class="i-ico">⭐</div><div><div class="i-label">' + esc(m.sender_name) + " • " + fmtListTime(m.created_at) + '</div><div class="i-value">' + esc((m.content || "").slice(0, 220)) + "</div></div></div>").join("")
    : '<div class="empty-state" style="padding:26px"><div class="big">⭐</div><h3>No starred messages</h3><p>Long-press or right-click any message and choose "Star message" to save it here.</p></div>';
  Modal.open({ icon: "⭐", title: "Starred messages", body });
}

function confirmReset() {
  Modal.open({
    icon: "🧹", title: "Reset local data?",
    body: '<p style="font-size:14px;line-height:1.6;color:var(--text-secondary)">All chats, statuses and settings stored <b>on this device</b> will be erased and the demo content restored. Cloud data (if connected) is not affected.</p>',
    foot: '<button class="btn soft" onclick="Modal.close()">Cancel</button><button class="btn danger" id="rs-yes">Reset</button>',
    onOpen(b, f) {
      f.querySelector("#rs-yes").onclick = () => {
        Object.keys(localStorage).filter((k) => k.startsWith("jcrgm:") && !["jcrgm:sb_url", "jcrgm:sb_key"].includes(k)).forEach((k) => localStorage.removeItem(k));
        location.reload();
      };
    }
  });
}

function openCloudModal() {
  const st = Cloud.status;
  const statusMap = {
    local: ["local", "🖥️ Local mode", "Messages are saved on this device and synced across browser tabs"],
    connecting: ["", "⏳ Connecting…", "Handshaking with Supabase"],
    online: ["ok", "☁️ Supabase Cloud LIVE", "Real-time cross-device sync is active for all JCRGM users"],
    error: ["bad", "⚠️ Cloud unreachable", "Check your credentials or network — running in local mode"]
  };
  const [cls, title, sub] = statusMap[st] || statusMap.local;
  const body =
    '<div class="conn-status-box ' + cls + '"><span class="cs-ico">' + title.split(" ")[0] + '</span><div><div class="cs-title">' + title.replace(/^\S+\s/, "") + '</div><div class="cs-sub">' + sub + "</div></div></div>" +
    '<div class="step-hint"><b>Connect real-time messaging in 4 steps:</b>' +
      "<ol>" +
        "<li>Create a free project at <code>supabase.com</code></li>" +
        "<li>Open <b>SQL Editor</b>, paste the contents of <code>supabase-schema.sql</code> (shipped with this repo) and press <b>Run</b></li>" +
        "Copy your <b>Project URL</b> &amp; <b>anon public key</b> from <b>Project Settings → API</b>" +
        "<li>Paste both below and hit <b>Connect</b> — done! 🎉</li>" +
      "</ol></div>" +
    '<div class="field"><label>Supabase Project URL</label><input id="sb-url" placeholder="https://xxxxxxxx.supabase.co" value="' + esc(Cloud.url || STORE.get("sb_url", "")) + '"></div>' +
    '<div class="field"><label>Supabase anon public key</label><input id="sb-key" type="password" placeholder="eyJhbGciOi…" value="' + esc(Cloud.key || STORE.get("sb_key", "")) + '"></div>' +
    '<p style="font-size:11.5px;color:var(--text-muted);line-height:1.6">🔒 The <b>anon key</b> is safe to expose in a static app — Row Level Security (created by the schema) restricts all access. You can also hardcode these in <code>config.js</code> before pushing to GitHub.</p>';
  Modal.open({
    icon: "☁️", title: "Supabase Cloud", sub: "Live multi-device messaging", body,
    foot:
      (st === "online" ? '<button class="btn danger" id="sb-off">Disconnect</button>' : "") +
      '<button class="btn soft" onclick="Modal.close()">Close</button>' +
      '<button class="btn teal" id="sb-go">' + (st === "online" ? "Reconnect" : "Connect") + "</button>",
    onOpen(b, f) {
      f.querySelector("#sb-go").onclick = async () => {
        const url = b.querySelector("#sb-url").value.trim();
        const key = b.querySelector("#sb-key").value.trim();
        f.querySelector("#sb-go").textContent = "Connecting…";
        const ok = await Cloud.connect(url, key, false);
        if (ok) { Modal.close(); }
        else { f.querySelector("#sb-go").textContent = "Connect"; }
      };
      const off = f.querySelector("#sb-off");
      if (off) off.onclick = () => { Cloud.disconnect(); Modal.close(); toast("Switched to local mode", "info"); };
    }
  });
}

function requestNotificationPermission(manual) {
  if (!window.Notification) { if (manual) toast("This browser doesn't support desktop notifications", "error"); return; }
  if (Notification.permission === "granted") { if (manual) toast("Notifications already enabled 🔔", "success"); return; }
  if (Notification.permission === "denied") { if (manual) toast("Notifications blocked — allow them in browser settings", "error"); return; }
  Notification.requestPermission().then((p) => {
    if (manual) toast(p === "granted" ? "Notifications enabled 🔔" : "Notifications not enabled", p === "granted" ? "success" : "info");
  });
}

function openAboutModal() {
  Modal.open({
    icon: "🕊️", title: "About JCRGM Connect",
    body:
      '<div class="profile-hero"><img src="./icons/icon-192.png" style="width:84px;height:84px;border-radius:22px;margin:0 auto 12px">' +
      "<h2>JCRGM CONNECT</h2><div class=\"ph-sub\">" + esc(CFG.APP_TAGLINE || "") + "</div></div>" +
      '<div class="info-rows">' +
        '<div class="info-row"><span class="i-ico">🏛️</span><div><div class="i-label">Organization</div><div class="i-value">' + esc(APP.ORG.fullName || "JCRGM") + "</div></div></div>" +
        '<div class="info-row"><span class="i-ico">✨</span><div><div class="i-label">Motto</div><div class="i-value gold">' + esc(APP.ORG.motto || "") + "</div></div></div>" +
        '<div class="info-row"><span class="i-ico">💬</span><div><div class="i-label">What it is</div><div class="i-value">A WhatsApp-style messenger rebuilt for ministries, organizations and teams — with chats, ministry channels, group communities, status stories, voice notes, polls, scripture cards, calls, and live Supabase Cloud sync.</div></div></div>' +
        '<div class="info-row"><span class="i-ico">📲</span><div><div class="i-label">Install</div><div class="i-value">This is a Progressive Web App — use your browser menu and choose <b>"Install app"</b> / <b>"Add to Home Screen"</b>.</div></div></div>' +
        '<div class="info-row"><span class="i-ico">Version</span><div><div class="i-label">Build</div><div class="i-value">v' + esc(APP.VERSION) + "</div></div></div>" +
      "</div>"
  });
}

/* =========================== PROFILE SCREEN =========================== */
function openProfileScreen(target) {
  // target: profile object OR room object
  let prof = null, room = null;
  if (target && target.display_name) prof = target;
  else if (target) {
    room = target;
    prof = contactOfRoom(room);
  }
  const isMe = prof && APP.me && prof.id === APP.me.id;
  const name = prof ? prof.display_name : room.name;
  const role = prof ? prof.role : (room.is_group ? (room.member_count + " participants") : "");
  const color = prof ? (prof.avatar_color || colorFor(name)) : (room.avatar_bg || colorFor(room.id));
  const icon = prof ? initials(name) : (room.is_group ? (room.avatar_icon || initials(name)) : initials(name));

  $("#profile-head-title").textContent = room && room.is_group && !prof ? "Group info" : "Contact info";
  const av = $("#profile-avatar");
  av.style.background = color;
  av.textContent = icon;
  $("#profile-name").textContent = name;
  $("#profile-role").textContent = (role || "") + (prof && prof.department ? " • " + prof.department : "");

  const rows = [];
  if (prof) {
    if (prof.handle) rows.push(["📞", "Phone", prof.handle]);
    rows.push(["💼", "Role", prof.role + (prof.department ? " — " + prof.department : "")]);
    rows.push(["✍️", "About", prof.bio || "Hey there! I am using JCRGM Connect."]);
    const online = prof.id !== APP.me.id && (prof.online || APP.presence[prof.id]);
    rows.push(["🟢", "Status", prof.id === APP.me.id ? "This is you" : online ? "Online now" : "Offline"]);
  }
  if (room) {
    if (room.description) rows.push(["ℹ️", room.is_group ? "Group description" : "About", room.description]);
    if (room.is_group) rows.push(["👥", "Participants", room.member_count + " members • created by " + (room.created_by === (APP.me && APP.me.id) ? "you" : "JCRGM admin")]);
    if (room.is_channel) rows.push(["📢", "Channel type", "Broadcast — only administrators post"]);
    rows.push(["🏷️", "Category", room.category === "ministry" ? "⛪ Ministry & Community" : room.category === "team" ? "💼 Team & Operations" : room.category === "group" ? "👥 Group" : "💬 Direct message"]);
  }
  $("#profile-info").innerHTML = rows.map((r) =>
    '<div class="info-row"><span class="i-ico">' + r[0] + '</span><div><div class="i-label">' + esc(r[1]) + '</div><div class="i-value">' + esc(r[2]) + "</div></div></div>").join("");

  const msgBtn = $("#profile-msg-btn"), callBtn = $("#profile-call-btn");
  if (prof && !room) {
    msgBtn.style.display = callBtn.style.display = "";
    msgBtn.onclick = () => openDirectRoom(prof);
    callBtn.onclick = () => { const rm = DB.rooms.find((r) => r.category === "direct" && r.contact_id === prof.id); if (rm) { backToMain(); startCall(rm.id, "audio"); } else { openDirectRoom(prof); } };
  } else if (room) {
    msgBtn.style.display = callBtn.style.display = "";
    msgBtn.onclick = () => { $("#screen-profile").classList.remove("active"); $("#screen-chat").classList.add("active"); };
    callBtn.onclick = () => { $("#screen-profile").classList.remove("active"); $("#screen-chat").classList.add("active"); startCall(room.id, "audio"); };
  } else { msgBtn.style.display = callBtn.style.display = "none"; }

  $("#screen-chat").classList.remove("active");
  $("#screen-profile").classList.add("active");
}
function backToMain() {
  $("#screen-profile").classList.remove("active");
  if (UI.currentRoom) $("#screen-chat").classList.add("active");
  else $("#screen-main").classList.add("active");
}

/* =========================== STATUS VIEWER =========================== */
const StatusViewer = {
  items: [], idx: 0, timer: null, tick: null,
  open(userId) {
    const now = Date.now();
    this.items = DB.statuses
      .filter((s) => s.user_id === userId && new Date(s.created_at).getTime() > now - 86400000)
      .sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
    if (!this.items.length) return;
    this.idx = 0;
    $("#status-viewer").classList.add("show");
    this.show();
  },
  show() {
    clearInterval(this.timer); clearInterval(this.tick);
    const s = this.items[this.idx];
    if (!s) { this.close(); return; }
    APP.statusSeen[s.id] = true;
    STORE.set("seen", APP.statusSeen);
    updateNavBadges();
    UI.renderStatusList();

    $("#sv-name").textContent = s.user_name;
    $("#sv-time").textContent = fmtListTime(s.created_at) + " • " + (s.category || "Status");
    const av = $("#sv-avatar");
    av.style.background = s.avatar_color;
    av.textContent = initials(s.user_name);
    $("#sv-body").style.background = s.media_url ? "#000" : "transparent";
    $("#sv-caption").innerHTML = s.media_url
      ? '<img src="' + esc(s.media_url) + '" style="max-width:min(92vw,540px);max-height:56vh;border-radius:14px;box-shadow:0 10px 40px rgba(0,0,0,.5)"><div style="margin-top:16px;font-size:17px;font-weight:600;white-space:pre-wrap;text-align:left;max-width:540px">' + esc(s.caption) + "</div>"
      : esc(s.caption);
    $("#sv-body").style.backgroundImage = s.media_url ? "none" : esc(s.bg_gradient || "");
    $("#sv-cat").textContent = s.category || "Status";

    const seenCount = Object.keys(APP.statusSeen).filter((k) => k.startsWith("st-")).length;
    $("#sv-progress").innerHTML = this.items.map((it, i) =>
      '<div class="bar"><div class="fill" data-p="' + i + '" style="width:' + (i < this.idx ? "100%" : "0%") + '"></div></div>').join("");

    let t0 = Date.now();
    const DUR = 5000;
    this.tick = setInterval(() => {
      const frac = Math.min(1, (Date.now() - t0) / DUR);
      const fill = document.querySelector('[data-p="' + this.idx + '"]');
      if (fill) fill.style.width = frac * 100 + "%";
    }, 60);
    this.timer = setTimeout(() => this.next(), DUR);
  },
  next() {
    clearInterval(this.tick);
    if (this.idx < this.items.length - 1) { this.idx++; this.show(); }
    else this.close();
  },
  prev() {
    clearInterval(this.tick); clearTimeout(this.timer);
    if (this.idx > 0) { this.idx--; this.show(); }
  },
  close() {
    clearInterval(this.tick); clearTimeout(this.timer);
    $("#status-viewer").classList.remove("show");
    $("#sv-reply-input").value = "";
    UI.renderStatusList();
  }
};

function openAddStatusModal() {
  const grads = [
    "linear-gradient(150deg,#075E54 0%,#0a7d6c 60%,#D4AF37 130%)",
    "linear-gradient(150deg,#4c1d95 0%,#7c3aed 60%,#ec4899 130%)",
    "linear-gradient(150deg,#7c2d12 0%,#ea580c 60%,#facc15 130%)",
    "linear-gradient(150deg,#14532d 0%,#16a34a 60%,#fde047 130%)",
    "linear-gradient(150deg,#0c4a6e 0%,#0284c7 60%,#67e8f9 130%)",
    "linear-gradient(150deg,#111827 0%,#374151 60%,#9ca3af 130%)"
  ];
  const body =
    '<div class="field"><label>Status text (24 hours)</label><textarea id="st-cap" maxlength="300" placeholder="Share a testimony, prayer point, praise report or announcement…"></textarea></div>' +
    '<div class="field"><label>Category</label><select id="st-cat"><option>Testimony</option><option>Praise Report</option><option>Prayer Point</option><option>Daily Devotional</option><option>Announcement</option><option>Fellowship</option></select></div>' +
    '<div class="field"><label>Background</label><div style="display:flex;gap:8px;flex-wrap:wrap" id="st-grads">' +
      grads.map((g, i) => '<span class="color-dot' + (i === 0 ? " sel" : "") + '" data-grad="' + i + '" style="width:44px;height:44px;border-radius:11px;background:' + g + '"></span>').join("") +
    "</div></div>";
  Modal.open({
    icon: "📸", title: "Add my status", sub: "Visible to all JCRGM members for 24h", body,
    foot: '<button class="btn soft" onclick="Modal.close()">Cancel</button><button class="btn teal" id="st-go">Share status</button><label class="btn soft" style="cursor:pointer">🖼️ Photo<input type="file" id="st-file" accept="image/*" hidden></label>',
    onOpen(b, f) {
      let grad = 0;
      b.querySelectorAll("#st-grads .color-dot").forEach((d) => {
        d.onclick = () => { b.querySelectorAll("#st-grads .color-dot").forEach((x) => x.classList.remove("sel")); d.classList.add("sel"); grad = +d.dataset.grad; };
      });
      let imgData = null;
      f.querySelector("#st-file").onchange = (ev) => {
        const file = ev.target.files[0];
        if (!file) return;
        if (file.size > 900000) { toast("Image too large for sync — please use under ~900KB", "error"); return; }
        const r = new FileReader();
        r.onload = () => { imgData = r.result; toast("Photo attached 🖼️", "success", 1500); };
        r.readAsDataURL(file);
      };
      f.querySelector("#st-go").onclick = () => {
        const cap = b.querySelector("#st-cap").value.trim();
        if (!cap && !imgData) { toast("Write something or attach a photo", "error"); return; }
        Cloud.createStatus({
          id: uid("st"),
          user_id: APP.me.id,
          user_name: APP.me.name,
          user_role: APP.me.role,
          avatar_color: APP.me.color,
          caption: cap || "📷",
          bg_gradient: grads[grad],
          media_url: imgData,
          category: b.querySelector("#st-cat").value,
          views: 1,
          created_at: new Date().toISOString()
        });
        Modal.close();
        toast("Status shared for 24 hours 📸", "success");
        switchTab("status");
      };
    }
  });
}

/* =========================== CALL ENGINE =========================== */
const CallEngine = {
  pc: null, localStream: null, remoteStream: null,
  state: "idle",        // idle | outgoing | incoming | connected | ending
  current: null,        // { roomId, roomName, peerId, type, isVideo }
  timer: null, seconds: 0, isCallee: false, pendingSignal: null,

  async start(roomId, type) {
    const room = DB.rooms.find((r) => r.id === roomId);
    if (!room) return;
    const contact = contactOfRoom(room);
    this.current = {
      roomId,
      roomName: room.name,
      peerId: contact ? contact.id : null,
      type,
      isVideo: type === "video"
    };
    this.isCallee = false;
    this.state = "outgoing";
    this.seconds = 0;
    this.showOverlay("Ringing…");

    const online = contact && (contact.online || APP.presence[contact.id]);
    const cloudOK = Cloud.connected();

    // Real signaling if peer reachable
    if (contact && (online || cloudOK)) {
      Cloud.sendSignal({ kind: "call-offer", room: roomId, roomName: room.name, callType: type, to: contact.id });
    }

    // Simulated: no peer / local-only → offline after a moment
    this._simTimer = setTimeout(() => {
      if (this.state === "outgoing") {
        const reachable = online || cloudOK;
        if (!reachable) {
          this.setStatus("offline busy", "Couldn't reach " + room.name.split(" ")[0] + " — number is unreachable");
          setTimeout(() => this.finish("unreachable"), 1800);
        } else {
          // Peer online but not answering WebRTC: pretend ringing then answered (demo mode)
          this.setStatus("Ringing…", null);
        }
      }
    }, 4500);

    // Auto-answer demo after 7s if still ringing and no real signal back
    this._demoAnswer = setTimeout(() => {
      if (this.state === "outgoing") this.acceptIncoming(true);
    }, 7000);

    // Local media for video calls
    if (this.isVideo) {
      try {
        this.localStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "user" }, audio: true });
        const self = $("#co-self-video");
        self.srcObject = this.localStream;
        self.style.display = "block";
        $("#co-cam").classList.add("on");
      } catch (e) {
        toast("Camera unavailable — audio only", "info");
        this.current.isVideo = false;
      }
    }
  },

  showOverlay(statusText) {
    const c = this.current;
    $("#call-overlay").classList.add("show");
    const av = $("#co-avatar");
    const room = DB.rooms.find((r) => r.id === c.roomId);
    av.style.background = room ? (room.avatar_bg || colorFor(room.id)) : colorFor(c.roomName);
    av.textContent = room && room.avatar_icon ? room.avatar_icon : initials(c.roomName);
    av.style.animation = "";
    $("#co-name").textContent = c.roomName;
    $("#co-status").textContent = statusText || "Ringing…";
    $("#co-controls").classList.remove("hidden");
    $("#co-incoming-controls").classList.add("hidden");
    $("#co-remote-video").style.display = "none";
    $("#co-self-video").style.display = "none";
    $("#co-mic").classList.remove("on");
    $("#co-cam").classList.remove("on");
    $("#co-spk").classList.remove("on");
    document.querySelectorAll(".co-btn").forEach((b) => { b.disabled = false; });
  },

  setStatus(main, sub) { $("#co-status").textContent = sub ? main : main; if (sub) $("#co-status").title = sub; },

  /* Incoming call from signal */
  incoming(payload) {
    if (this.state !== "idle") { Cloud.sendSignal({ kind: "call-busy", to: payload.from, callType: payload.callType }); return; }
    this.current = {
      roomId: payload.room, roomName: payload.roomName,
      peerId: payload.from, type: payload.callType, isVideo: payload.callType === "video"
    };
    this.isCallee = true;
    this.state = "incoming";
    this.seconds = 0;
    this.showOverlay("Incoming " + (payload.callType === "video" ? "video" : "voice") + " call…");
    $("#co-controls").classList.add("hidden");
    $("#co-incoming-controls").classList.remove("hidden");
    this.pendingSignal = payload;
    // auto-decline after 25s
    this._ringTimeout = setTimeout(() => { if (this.state === "incoming") this.finish("missed"); }, 25000);
    try { if (navigator.vibrate) navigator.vibrate([300, 200, 300, 200, 300]); } catch (e) {}
  },

  async acceptIncoming(demo = false) {
    if (this.state === "outgoing") {
      // demo answered
      clearTimeout(this._demoAnswer);
      this.state = "connected";
      this.startTimer();
      this.setStatus("Connecting…");
      $("#co-status").textContent = "Connected • 0:00";
      this.logDurationOnEnd = true;
      if (this.current.isVideo) await this.setupPeer(true, true);
      setTimeout(() => { if (this.state === "connected") $("#co-status").textContent = "Connected • " + fmtDur(this.seconds); }, 500);
      return;
    }
    if (this.state !== "incoming") return;
    clearTimeout(this._ringTimeout);
    this.state = "connected";
    $("#co-incoming-controls").classList.add("hidden");
    $("#co-controls").classList.remove("hidden");
    this.startTimer();
    $("#co-status").textContent = "Connecting…";
    Cloud.sendSignal({ kind: "call-accept", to: this.current.peerId, room: this.current.roomId, callType: this.current.type });
    await this.setupPeer(!this.isCallee, this.current.isVideo);
    setTimeout(() => { if (this.state === "connected") $("#co-status").textContent = "Connected • " + fmtDur(this.seconds); }, 600);
  },

  async setupPeer(initiator, wantVideo) {
    // Only create a real RTCPeerConnection when both sides signal; otherwise run audio-simulated call
    if (!Cloud.connected()) { this.simulated = true; return; }
    this.simulated = false;
    try {
      const config = { iceServers: [{ urls: "stun:stun.l.google.com:19302" }, { urls: "stun:global.stun.twilio.com:3478" }] };
      this.pc = new RTCPeerConnection(config);
      if (this.localStream) this.localStream.getTracks().forEach((t) => this.pc.addTrack(t, this.localStream));
      else if (wantVideo || true) {
        try {
          this.localStream = await navigator.mediaDevices.getUserMedia({ audio: true });
          this.localStream.getTracks().forEach((t) => this.pc.addTrack(t, this.localStream));
        } catch (e) { /* mic denied: still signal w/o tracks */ }
      }
      this.remoteStream = new MediaStream();
      this.pc.ontrack = (ev) => {
        ev.streams[0].getTracks().forEach((t) => this.remoteStream.addTrack(t));
        const remote = $("#co-remote-video");
        remote.srcObject = this.remoteStream;
        remote.style.display = this.current.isVideo ? "block" : "none";
      };
      this.pc.onicecandidate = (ev) => {
        if (ev.candidate) Cloud.sendSignal({ kind: "call-ice", to: this.current.peerId, candidate: ev.candidate, room: this.current.roomId });
      };
      this.pc.onconnectionstatechange = () => {
        if (this.pc && ["failed", "disconnected"].includes(this.pc.connectionState) && this.state === "connected") {
          this.setStatus("Connection lost");
        }
      };
      if (initiator) {
        const offer = await this.pc.createOffer();
        await this.pc.setLocalDescription(offer);
        Cloud.sendSignal({ kind: "call-sdp", sdp: offer, to: this.current.peerId, room: this.current.roomId });
      }
    } catch (e) { console.warn("RTCPeer setup", e); this.simulated = true; }
  },

  async onSignal(p) {
    switch (p.kind) {
      case "call-offer":
        this.incoming(p);
        break;
      case "call-accept":
        if (this.state === "outgoing") this.acceptIncoming(false);
        break;
      case "call-busy":
        if (this.state === "outgoing") { this.setStatus("Busy", null); setTimeout(() => this.finish("declined"), 1400); }
        break;
      case "call-decline":
        if (this.state === "outgoing") { this.finish("declined"); }
        break;
      case "call-end":
        if (["connected", "incoming", "outgoing"].includes(this.state)) this.finish("completed");
        break;
      case "call-sdp":
        if (this.state === "connected") {
          try {
            if (!this.pc) await this.setupPeer(false, this.current.isVideo);
            if (this.pc) {
              await this.pc.setRemoteDescription(new RTCSessionDescription(p.sdp));
              if (p.sdp.type === "offer") {
                const ans = await this.pc.createAnswer();
                await this.pc.setLocalDescription(ans);
                Cloud.sendSignal({ kind: "call-sdp", sdp: ans, to: p.from, room: this.current.roomId });
              }
            }
          } catch (e) { console.warn("sdp", e); }
        }
        break;
      case "call-ice":
        try { if (this.pc) await this.pc.addIceCandidate(new RTCIceCandidate(p.candidate)); } catch (e) {}
        break;
    }
  },

  startTimer() {
    clearInterval(this.timer);
    this.timer = setInterval(() => {
      this.seconds++;
      if (this.state === "connected") $("#co-status").textContent = "Connected • " + fmtDur(this.seconds);
    }, 1000);
  },

  toggleMic() {
    const on = $("#co-mic").classList.toggle("on");
    if (this.localStream) this.localStream.getAudioTracks().forEach((t) => (t.enabled = !on));
    $("#co-mic").textContent = on ? "🔇" : "🎤";
  },
  toggleCam() {
    if (!this.localStream || !this.current.isVideo) { toast("Video not active", "info", 1500); return; }
    const on = $("#co-cam").classList.toggle("on");
    this.localStream.getVideoTracks().forEach((t) => (t.enabled = !on));
    $("#co-self-video").style.display = on ? "none" : "block";
  },
  toggleSpeaker() {
    const on = $("#co-spk").classList.toggle("on");
    const remote = $("#co-remote-video");
    remote.muted = !on ? remote.muted : false;
    $("#co-spk").textContent = on ? "🔉" : "🔊";
  },

  hangup() {
    if (this.state === "outgoing") {
      Cloud.sendSignal({ kind: "call-decline", to: this.current.peerId });
      this.finish("declined");
    } else if (this.state === "incoming") {
      Cloud.sendSignal({ kind: "call-decline", to: this.current.peerId });
      this.finish("declined");
    } else if (this.state === "connected") {
      Cloud.sendSignal({ kind: "call-end", to: this.current.peerId });
      this.finish("completed");
    } else this.finish("cancelled");
  },

  finish(status) {
    if (this.state === "idle") return;
    const wasConnected = this.state === "connected";
    clearTimeout(this._simTimer); clearTimeout(this._demoAnswer); clearTimeout(this._ringTimeout);
    clearInterval(this.timer);
    this.state = "idle";

    try { if (this.pc) this.pc.close(); } catch (e) {}
    this.pc = null;
    if (this.localStream) { this.localStream.getTracks().forEach((t) => t.stop()); this.localStream = null; }
    if (this.remoteStream) { this.remoteStream.getTracks().forEach((t) => t.stop()); this.remoteStream = null; }
    $("#co-self-video").style.display = "none";
    $("#call-overlay").classList.remove("show");

    if (this.current) {
      Cloud.logCall({
        id: uid("call"),
        room_id: this.current.roomId,
        room_name: this.current.roomName,
        caller_id: APP.me.id,
        caller_name: APP.me.name,
        call_type: this.current.type,
        direction: this.isCallee ? "incoming" : "outgoing",
        duration_sec: wasConnected ? this.seconds : 0,
        status: status,
        created_at: new Date().toISOString()
      });
      if (!wasConnected && ["declined", "unreachable", "missed", "busy"].includes(status)) {
        toast(status === "completed" ? "Call ended" : "Call " + status, status === "completed" ? "info" : "gold", 2500);
      } else if (wasConnected) {
        toast("Call ended • " + fmtDur(this.seconds), "info", 2000);
      }
    }
    this.current = null;
    this.seconds = 0;
  }
};

function startCall(roomId, type) {
  CallEngine.start(roomId, type);
}

/* =========================== INSTALL PWA =========================== */
window.addEventListener("beforeinstallprompt", (e) => {
  e.preventDefault();
  APP.deferredInstall = e;
  if (!STORE.get("install_dismissed", false)) $("#install-banner").classList.add("show");
});
function doInstall() {
  if (!APP.deferredInstall) { toast("Use your browser menu → 'Install app' / 'Add to Home Screen'", "gold", 4200); return; }
  APP.deferredInstall.prompt();
  APP.deferredInstall.userChoice.then((r) => {
    if (r.outcome === "accepted") { $("#install-banner").classList.remove("show"); toast("JCRGM Connect installed 🎉", "success"); }
    APP.deferredInstall = null;
  });
}

/* =========================== DEEP LINKS =========================== */
function handleDeepLink() {
  const params = new URLSearchParams(location.search);
  const chat = params.get("chat");
  const tab = params.get("tab");
  if (tab) switchTab(tab);
  if (chat && DB.rooms.some((r) => r.id === chat)) UI.openRoom(chat);
}

/* =========================== EVENT WIRING =========================== */
function wireEvents() {
  /* ---- onboarding ---- */
  $("#ob-colors").addEventListener("click", (e) => {
    const d = e.target.closest(".color-dot");
    if (!d) return;
    $$("#ob-colors .color-dot").forEach((x) => x.classList.remove("sel"));
    d.classList.add("sel");
  });
  $("#ob-name").addEventListener("keydown", (e) => { if (e.key === "Enter") completeOnboarding(); });
  $("#ob-start").addEventListener("click", completeOnboarding);
  $("#ob-cloud").addEventListener("click", () => { openCloudModal(); });
  $("#ob-mode").addEventListener("click", () => openCloudModal());

  /* ---- topbar ---- */
  $("#btn-search").addEventListener("click", () => toggleSearch());
  $("#search-close").addEventListener("click", () => toggleSearch(false));
  $("#search-input").addEventListener("input", debounce((e) => { APP.searchQuery = e.target.value; UI.renderChatList(); }, 160));
  $("#btn-menu").addEventListener("click", (e) => {
    CtxMenu.open(e.clientX - 160, e.clientY + 10, [
      { act: "newchat", icon: "💬", label: "New chat" },
      { act: "newgroup", icon: "👥", label: "New group" },
      { act: "newcommunity", icon: "⛪", label: "New community channel" },
      "-",
      { act: "starred", icon: "⭐", label: "Starred messages" },
      { act: "cloud", icon: "☁️", label: "Supabase Cloud…" },
      { act: "settings", icon: "⚙️", label: "Settings" },
      { act: "install", icon: "📲", label: "Install app" },
      "-",
      { act: "about", icon: "🕊️", label: "About JCRGM Connect" }
    ]);
  });
  $("#conn-pill").addEventListener("click", openCloudModal);

  /* ---- nav ---- */
  $$(".nav-item[data-tab]").forEach((b) => b.addEventListener("click", () => switchTab(b.dataset.tab)));
  $("#nav-cloud").addEventListener("click", openCloudModal);

  /* ---- chats list (delegated) ---- */
  $("#chats-list").addEventListener("click", (e) => {
    const row = e.target.closest(".chat-row");
    if (row) UI.openRoom(row.dataset.room, { focus: false });
  });
  $("#chat-chips").addEventListener("click", (e) => {
    const c = e.target.closest(".chip");
    if (!c) return;
    $$("#chat-chips .chip").forEach((x) => x.classList.remove("active"));
    c.classList.add("active");
    APP.chatFilter = c.dataset.filter;
    UI.renderChatList();
  });
  $("#fab-new").addEventListener("click", openNewChatModal);

  /* ---- chat screen ---- */
  $("#chat-back").addEventListener("click", () => UI.closeRoom());
  $("#chat-profile-open").addEventListener("click", () => {
    const room = DB.rooms.find((r) => r.id === UI.currentRoom);
    if (room) openProfileScreen(room);
  });
  $("#chat-avatar").addEventListener("click", () => {
    const room = DB.rooms.find((r) => r.id === UI.currentRoom);
    if (room) openProfileScreen(room);
  });
  $("#chat-call").addEventListener("click", () => { if (UI.currentRoom) startCall(UI.currentRoom, "audio"); });
  $("#chat-video").addEventListener("click", () => { if (UI.currentRoom) startCall(UI.currentRoom, "video"); });
  $("#chat-kebab").addEventListener("click", (e) => {
    const room = DB.rooms.find((r) => r.id === UI.currentRoom);
    if (!room) return;
    CtxMenu.open(e.clientX - 170, e.clientY + 10, [
      { act: "info", icon: "ℹ️", label: "Group / contact info" },
      { act: "searchroom", icon: "🔍", label: "Search in chat" },
      { act: "pin", icon: "📌", label: room.pinned ? "Unpin chat" : "Pin chat" },
      { act: "mute", icon: "🔕", label: room.muted ? "Unmute" : "Mute notifications" },
      "-",
      { act: "clearchat", icon: "🧹", label: "Clear chat", danger: true }
    ]);
  });

  /* ---- wallpaper scroll ---- */
  $("#chat-wallpaper").addEventListener("scroll", throttle(function () {
    const wp = this;
    const atBottom = wp.scrollHeight - wp.scrollTop - wp.clientHeight < 70;
    $("#jump-bottom").classList.toggle("show", !atBottom);
    if (atBottom) APP.pinnedBottom[UI.currentRoom] = false;
    else APP.pinnedBottom[UI.currentRoom] = true;
  }, 200));
  $("#jump-bottom").addEventListener("click", () => UI.scrollChatBottom());

  /* ---- wallpaper interactions (delegated) ---- */
  $("#chat-wallpaper").addEventListener("click", (e) => {
    const reactPill = e.target.closest(".reaction-pill");
    if (reactPill) { toggleReaction(reactPill.dataset.msg, reactPill.dataset.react); return; }
    const replyBtn = e.target.closest(".reply-action");
    if (replyBtn) { setReply(replyBtn.dataset.reply); return; }
    const play = e.target.closest("[data-play]");
    if (play) { AudioPlayer.play(play.dataset.play); return; }
    const poll = e.target.closest("[data-poll-msg]");
    if (poll) { votePoll(poll.dataset.pollMsg, +poll.dataset.pollIdx); return; }
    const rq = e.target.closest(".reply-quote");
    if (rq && rq.dataset.jump) { /* scroll to replied msg */ return; }
  });

  let pressTimer = null;
  $("#chat-wallpaper").addEventListener("pointerdown", (e) => {
    const bubble = e.target.closest(".msg");
    if (!bubble || e.target.closest("button") || e.target.closest("a")) return;
    pressTimer = setTimeout(() => {
      const rect = bubble.getBoundingClientRect();
      openMessageMenu(bubble.dataset.id, rect.left + 40, rect.top - 10);
      if (navigator.vibrate) navigator.vibrate(18);
    }, 480);
  });
  ["pointerup", "pointerleave", "pointercancel", "pointermove"].forEach((ev) =>
    $("#chat-wallpaper").addEventListener(ev, () => clearTimeout(pressTimer)));
  $("#chat-wallpaper").addEventListener("contextmenu", (e) => {
    const bubble = e.target.closest(".msg");
    if (!bubble) return;
    e.preventDefault();
    openMessageMenu(bubble.dataset.id, e.clientX, e.clientY);
  });

  /* ---- composer ---- */
  const ta = $("#msg-input");
  ta.addEventListener("input", () => {
    autoGrow(ta);
    updateSendIcon();
    if (ta.value.trim()) Cloud.sendTyping(UI.currentRoom);
    const drafts = STORE.get("drafts", {});
    if (UI.currentRoom) { if (ta.value) drafts[UI.currentRoom] = ta.value; else delete drafts[UI.currentRoom]; }
    STORE.set("drafts", drafts);
  });
  ta.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendTextMessage(); }
  });
  $("#send-btn").addEventListener("click", async () => {
    if (ta.value.trim()) { sendTextMessage(); return; }
    // mic: start/stop recording
    if ($("#recording-ui").classList.contains("active")) VoiceRecorder.stop(true);
    else { const ok = await VoiceRecorder.start(); if (ok) toast("Recording… tap ✔ or mic to send", "info", 2200); }
  });
  $("#rec-cancel").addEventListener("click", () => { VoiceRecorder.stop(false); toast("Recording discarded", "info", 1400); });

  $("#btn-emoji").addEventListener("click", (e) => {
    e.stopPropagation();
    $("#attach-panel").classList.remove("show");
    $("#emoji-panel").classList.toggle("show");
    renderEmojiPanel();
  });
  $("#btn-attach").addEventListener("click", (e) => {
    e.stopPropagation();
    $("#emoji-panel").classList.remove("show");
    $("#attach-panel").classList.toggle("show");
  });
  $("#rb-cancel").addEventListener("click", cancelReply);

  /* ---- emoji panel ---- */
  $("#emoji-grid").addEventListener("click", (e) => {
    const b = e.target.closest("button");
    if (!b) return;
    insertEmoji(b.textContent);
  });
  $("#emoji-recent").addEventListener("click", (e) => {
    const b = e.target.closest("button");
    if (!b) return;
    insertEmoji(b.textContent);
  });
  $("#emoji-cats").addEventListener("click", (e) => {
    const b = e.target.closest("button");
    if (!b) return;
    renderEmojiGrid(b.dataset.cat);
  });

  /* ---- attach panel ---- */
  $("#attach-panel").addEventListener("click", (e) => {
    const b = e.target.closest("[data-attach]");
    if (!b) return;
    $("#attach-panel").classList.remove("show");
    handleAttach(b.dataset.attach);
  });
  $("#file-image").addEventListener("change", (e) => handleFile(e.target, "image"));
  $("#file-doc").addEventListener("change", (e) => handleFile(e.target, "doc"));
  $("#file-camera").addEventListener("change", (e) => handleFile(e.target, "image"));

  /* ---- context menu actions ---- */
  $("#ctx-menu").addEventListener("click", (e) => {
    const b = e.target.closest("[data-act]");
    if (!b) return;
    const act = b.dataset.act;
    CtxMenu.close();
    handleAction(act);
  });
  document.addEventListener("click", (e) => {
    if (!e.target.closest("#ctx-menu")) CtxMenu.close();
    if (!e.target.closest(".float-panel") && !e.target.closest("#btn-emoji") && !e.target.closest("#btn-attach")) closePanelsOnly();
  });

  /* ---- profile ---- */
  $("#profile-back").addEventListener("click", () => {
    $("#screen-profile").classList.remove("active");
    if (UI.currentRoom) $("#screen-chat").classList.add("active");
    else $("#screen-main").classList.add("active");
  });

  /* ---- status ---- */
  $("#status-add-me").addEventListener("click", openAddStatusModal);
  $("#status-list").addEventListener("click", (e) => {
    const row = e.target.closest(".status-row");
    if (row) StatusViewer.open(row.dataset.statusUser);
  });
  $("#sv-close").addEventListener("click", () => StatusViewer.close());
  $("#sv-next").addEventListener("click", () => StatusViewer.next());
  $("#sv-prev").addEventListener("click", () => StatusViewer.prev());
  $("#sv-reply-input").addEventListener("keydown", (e) => {
    if (e.key !== "Enter") return;
    const v = e.target.value.trim();
    if (!v) return;
    const s = StatusViewer.items[StatusViewer.idx];
    let room = DB.rooms.find((r) => r.category === "direct" && r.contact_id === s.user_id);
    if (!room) {
      const prof = profileById(s.user_id);
      if (prof) {
        room = { id: uid("dm"), name: prof.display_name, subtitle: "", category: "direct", avatar_bg: prof.avatar_color, avatar_icon: "", is_group: false, is_channel: false, pinned: false, member_count: 2, description: "", contact_id: prof.id };
        DB.rooms.unshift(room); saveDB();
      }
    }
    if (room) {
      buildRawInto(room.id, { msg_type: "text", content: "Re: your status — " + v });
      e.target.value = "";
      StatusViewer.close();
      toast("Reply sent to " + s.user_name, "success");
    }
  });

  /* ---- calls ---- */
  $("#calls-list").addEventListener("click", (e) => {
    const row = e.target.closest(".call-row");
    if (!row) return;
    startCall(row.dataset.callRoom, row.dataset.callType || "audio");
  });
  $("#co-hang").addEventListener("click", () => CallEngine.hangup());
  $("#co-decline").addEventListener("click", () => CallEngine.hangup());
  $("#co-answer").addEventListener("click", () => CallEngine.acceptIncoming());
  $("#co-mic").addEventListener("click", () => CallEngine.toggleMic());
  $("#co-cam").addEventListener("click", () => CallEngine.toggleCam());
  $("#co-spk").addEventListener("click", () => CallEngine.toggleSpeaker());

  /* ---- modal ---- */
  $("#m-close").addEventListener("click", Modal.close);
  $("#modal-root").addEventListener("click", (e) => { if (e.target.id === "modal-root") Modal.close(); });

  /* ---- install banner ---- */
  $("#ib-install").addEventListener("click", doInstall);
  $("#ib-dismiss").addEventListener("click", () => { $("#install-banner").classList.remove("show"); STORE.set("install_dismissed", true); });

  /* ---- keyboard ---- */
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      if ($("#status-viewer").classList.contains("show")) return StatusViewer.close();
      if ($("#modal-root").classList.contains("show")) return Modal.close();
      if ($("#ctx-menu").classList.contains("show")) return CtxMenu.close();
      if (CallEngine.state !== "idle") return CallEngine.hangup();
      if (UI.currentRoom) return UI.closeRoom();
    }
    // Ctrl/Cmd+K search
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") { e.preventDefault(); switchTab("chats"); toggleSearch(true); }
  });

  /* ---- visibility: refresh presence ---- */
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && APP.me) Cloud.sendPing();
  });
  window.addEventListener("online", () => toast("Back online 🌐", "success", 1800));
  window.addEventListener("offline", () => toast("You are offline — messages will be stored locally", "gold", 3000));
}

function closePanelsOnly() {
  $("#emoji-panel").classList.remove("show");
  $("#attach-panel").classList.remove("show");
}

function insertEmoji(ch) {
  const ta = $("#msg-input");
  const start = ta.selectionStart, end = ta.selectionEnd;
  ta.value = ta.value.slice(0, start) + ch + ta.value.slice(end);
  ta.selectionStart = ta.selectionEnd = start + ch.length;
  ta.focus();
  autoGrow(ta);
  updateSendIcon();
  APP.recentEmoji = [ch].concat(APP.recentEmoji.filter((x) => x !== ch)).slice(0, 18);
  STORE.set("recent_emoji", APP.recentEmoji);
}

let emojiRendered = false;
function renderEmojiPanel() {
  if (emojiRendered) { renderEmojiRecent(); return; }
  emojiRendered = true;
  const cats = Object.keys(EMOJI_CATS);
  $("#emoji-cats").innerHTML = cats.map((c, i) =>
    '<button class="' + (i === 0 ? "active" : "") + '" data-cat="' + esc(c) + '">' + esc(c.split(" ")[0]) + "</button>").join("");
  renderEmojiGrid(cats[0]);
  renderEmojiRecent();
}
function renderEmojiGrid(cat) {
  $$("#emoji-cats button").forEach((b) => b.classList.toggle("active", b.dataset.cat === cat));
  $("#emoji-grid").innerHTML = EMOJI_CATS[cat].map((e) => "<button>" + e + "</button>").join("");
}
function renderEmojiRecent() {
  const list = (APP.recentEmoji && APP.recentEmoji.length ? APP.recentEmoji : ["🙏", "❤️", "👍"]).slice(0, 18);
  $("#emoji-recent").innerHTML = list.map((e) => "<button>" + e + "</button>").join("");
}

/* ---- attach handlers ---- */
function handleAttach(kind) {
  switch (kind) {
    case "voice":
      VoiceRecorder.start().then((ok) => { if (ok) toast("Recording… tap mic to send", "info", 2000); });
      break;
    case "image": $("#file-image").click(); break;
    case "camera": $("#file-camera").click(); break;
    case "doc": $("#file-doc").click(); break;
    case "poll": openPollModal(); break;
    case "contact": openShareContactModal(); break;
    case "scripture": openScriptureModal(); break;
    case "announce": openAnnounceModal(); break;
  }
}
function handleFile(input, kind) {
  const file = input.files[0];
  if (!file) return;
  input.value = "";
  if (kind === "doc") {
    if (file.size > 6_000_000) { toast("Document too large (max 6MB)", "error"); return; }
    const r = new FileReader();
    r.onload = () => buildAndSendRaw({ msg_type: "document", content: "", media_url: r.result, media_meta: { name: file.name, size: file.size, type: file.type } });
    r.readAsDataURL(file);
    toast("Sending document…", "info", 1400);
    return;
  }
  // image
  if (file.size > 2_500_000) { toast("Image too large — please choose one under 2.5MB", "error"); return; }
  const r = new FileReader();
  r.onload = () => buildAndSendRaw({ msg_type: "image", content: "", media_url: r.result, media_meta: { name: file.name, size: file.size, type: file.type } });
  r.readAsDataURL(file);
}

/* ---- context action handler ---- */
function handleAction(act) {
  const [cmd, a1, a2] = act.split(":");
  switch (cmd) {
    case "reply": setReply(a1); break;
    case "react": {
      const bubble = document.querySelector('.msg[data-id="' + a1 + '"]');
      const rect = bubble ? bubble.getBoundingClientRect() : { left: 100, top: 200 };
      openReactPicker(a1, rect.left + 40, rect.top - 10);
      break;
    }
    case "reactpick": toggleReaction(a1, a2); break;
    case "copy": {
      const m = DB.messages.find((x) => x.id === a1);
      if (m) { navigator.clipboard.writeText(m.content || "[media]").then(() => toast("Copied to clipboard", "success", 1500)).catch(() => toast("Copy failed", "error")); }
      break;
    }
    case "forward": forwardMessage(a1); break;
    case "edit": editMessage(a1); break;
    case "star": {
      const m = DB.messages.find((x) => x.id === a1);
      if (m) { m.starred = !m.starred; saveDB(); toast(m.starred ? "Starred ⭐" : "Unstarred", "success", 1500); }
      break;
    }
    case "delete": confirmDeleteMsg(a1); break;
    /* room menu */
    case "info": {
      const room = DB.rooms.find((r) => r.id === UI.currentRoom);
      if (room) openProfileScreen(room);
      break;
    }
    case "searchroom": toggleSearch(true); break;
    case "pin": {
      const room = DB.rooms.find((r) => r.id === UI.currentRoom);
      if (room) { room.pinned = !room.pinned; saveDB(); UI.renderChatList(); toast(room.pinned ? "Pinned 📌" : "Unpinned", "success", 1400); }
      break;
    }
    case "mute": {
      const room = DB.rooms.find((r) => r.id === UI.currentRoom);
      if (room) { room.muted = !room.muted; saveDB(); UI.renderChatList(); toast(room.muted ? "Muted 🔕" : "Unmuted 🔔", "success", 1400); }
      break;
    }
    case "clearchat": {
      Modal.open({
        icon: "🧹", title: "Clear chat?",
        body: '<p style="font-size:14px;color:var(--text-secondary)">All messages in this chat will be removed from this device.</p>',
        foot: '<button class="btn soft" onclick="Modal.close()">Cancel</button><button class="btn danger" id="clr-yes">Clear</button>',
        onOpen(b, f) {
          f.querySelector("#clr-yes").onclick = () => {
            DB.messages = DB.messages.filter((m) => m.room_id !== UI.currentRoom);
            saveDB(); UI.renderChat(); UI.renderChatList(); Modal.close();
            toast("Chat cleared", "success", 1500);
          };
        }
      });
      break;
    }
    /* topbar menu */
    case "newchat": openNewChatModal(); break;
    case "newgroup": openNewGroupModal("group"); break;
    case "newcommunity": openNewGroupModal("community"); break;
    case "starred": openStarredModal(); break;
    case "cloud": openCloudModal(); break;
    case "settings": openSettingsModal(); break;
    case "install": doInstall(); break;
    case "about": openAboutModal(); break;
  }
}

/* ---- modal delegated clicks (new chat flows) ---- */
document.addEventListener("click", (e) => {
  const dm = e.target.closest("[data-dm]");
  if (dm) { openDirectRoom(profileById(dm.dataset.dm)); return; }
  const pick = e.target.closest("[data-pick]");
  if (pick) { pick.classList.toggle("sel"); return; }
  const share = e.target.closest("[data-share]");
  if (share) {
    const list = share.parentElement;
    list.querySelectorAll(".pick-item").forEach((x) => { if (x !== share) x.classList.remove("sel"); });
    share.classList.toggle("sel");
    return;
  }
  const fwd = e.target.closest("[data-fwd]");
  if (fwd) { fwd.classList.toggle("sel"); return; }
  const nw = e.target.closest("[data-new]");
  if (nw) {
    const t = nw.dataset.new;
    if (t === "group") openNewGroupModal("group");
    if (t === "community") openNewGroupModal("community");
    if (t === "contact") openAddContactModal();
    return;
  }
  const row = e.target.closest(".pick-item");
  if (row && !row.dataset.dm && !row.dataset.pick && !row.dataset.share && !row.dataset.fwd) row.classList.toggle("sel");
});

/* =========================== INIT =========================== */
async function initApp() {
  applyTheme(STORE.get("theme", CFG.ORGANIZATION && CFG.ORGANIZATION.defaultTheme) || "dark");
  APP.recentEmoji = STORE.get("recent_emoji", APP.recentEmoji);
  APP.statusSeen = STORE.get("seen", {});
  APP.me = STORE.get("me", null);
  $("#ob-tagline").textContent = CFG.APP_TAGLINE || "";
  renderOnboardingColors(APP.me ? APP.me.color : ONBOARD_COLORS[0]);

  loadDB();
  seedIfNeeded();
  wireEvents();

  if (APP.me) {
    enterApp();
  } else {
    $("#screen-onboarding").classList.add("active");
    $("#ob-name").focus();
  }

  await Cloud.init();

  // service worker
  if ("serviceWorker" in navigator && location.protocol.startsWith("http")) {
    navigator.serviceWorker.register("./sw.js").catch((e) => console.warn("SW", e));
  }

  // presence heartbeat
  setInterval(() => {
    if (APP.me) {
      Cloud.sendPing();
      // prune stale presence
      const now = Date.now();
      Object.keys(APP.presence).forEach((k) => { if (now - (APP.presence[k].last || 0) > 45000) delete APP.presence[k]; });
      if (UI.currentRoom) UI.updateChatSub();
      UI.renderChatList();
    }
  }, 18000);
  setTimeout(() => APP.me && Cloud.sendPing(), 1500);

  // periodic badge refresh (statuses expire)
  setInterval(updateNavBadges, 60000);
}

document.addEventListener("DOMContentLoaded", initApp);
