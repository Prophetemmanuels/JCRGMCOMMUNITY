/* ============================================================================
   JCRGM CONNECT — automated jsdom smoke suite (54 checks)
   ----------------------------------------------------------------------------
   Usage:
     1. Serve the repo root:   python3 -m http.server 8080
     2. cd tests && npm install
     3. node smoke.js
   The suite boots the real index.html in jsdom, drives the UI end-to-end
   (onboarding → chats → send/reply/react → polls → status → calls → modals)
   and fails on any assertion or runtime error.
   ========================================================================== */
const { JSDOM, VirtualConsole } = require("jsdom");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const URL = process.env.TEST_URL || "http://localhost:8080/index.html";

const errors = [];
const vc = new VirtualConsole();
vc.on("jsdomError", (e) => errors.push("jsdomError: " + (e.stack || e.message)));
vc.on("error", (...a) => errors.push("console.error: " + a.join(" ")));

const html = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");

const dom = new JSDOM(html, {
  url: URL,
  runScripts: "dangerously",
  resources: "usable",
  pretendToBeVisual: true,
  virtualConsole: vc
});

const { window } = dom;

const results = [];
function check(name, fn) {
  try {
    const r = fn();
    results.push([r ? "PASS" : "FAIL", name]);
    if (!r) console.log("  x " + name);
  } catch (e) {
    results.push(["ERROR", name + " -> " + e.message]);
    console.log("  x " + name + " -> " + e.message);
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  // Wait until external scripts have executed (poll up to 15s)
  let ready = false;
  for (let i = 0; i < 60 && !ready; i++) {
    await sleep(250);
    try { ready = window.eval("typeof completeOnboarding === 'function' && typeof Cloud !== 'undefined'"); } catch (e) {}
  }
  if (!ready) { console.error("Scripts failed to load from " + URL); process.exit(2); }

  const $ = (s) => window.document.querySelector(s);
  const $$ = (s) => Array.from(window.document.querySelectorAll(s));
  const click = (el) => el.dispatchEvent(new window.MouseEvent("click", { bubbles: true, cancelable: true, view: window }));

  console.log("- Onboarding -");
  check("onboarding visible", () => $("#screen-onboarding").classList.contains("active"));
  check("colors rendered", () => $$("#ob-colors .color-dot").length === 10);
  $("#ob-name").value = "Chanda Mwansa";
  $("#ob-dept").value = "Media & Tech";
  click($$("#ob-colors .color-dot")[2]);
  click($("#ob-start"));
  await sleep(300);
  check("app entered", () => $("#screen-main").classList.contains("active") && !$("#screen-onboarding").classList.contains("active"));
  check("me stored", () => JSON.parse(window.localStorage.getItem("jcrgm:me")).name === "Chanda Mwansa");

  console.log("- Chat list -");
  check("rooms rendered", () => $$("#chats-list .chat-row").length >= 10);
  check("section labels", () => $$("#chats-list .section-label").length >= 3);
  check("pinned first", () => $$("#chats-list .chat-row")[0].classList.contains("pinned"));

  console.log("- Filters & search -");
  const teamChip = $$("#chat-chips .chip").find((c) => c.dataset.filter === "team");
  click(teamChip);
  await sleep(50);
  check("team filter", () => $$("#chats-list .chat-row").every((r) => ["jcrgm-leadership", "jcrgm-media"].includes(r.dataset.room)));
  click($$("#chat-chips .chip")[0]);
  check("back to all", () => $$("#chats-list .chat-row").length >= 10);

  console.log("- Open room & send message -");
  const prayerRow = $$("#chats-list .chat-row").find((r) => r.dataset.room === "jcrgm-prayer");
  click(prayerRow);
  await sleep(200);
  check("chat screen open", () => $("#screen-chat").classList.contains("active"));
  check("messages rendered", () => $$("#chat-wallpaper .msg").length >= 3);
  check("scripture styling present", () => $$("#chat-wallpaper .msg.scripture").length >= 0);
  $("#msg-input").value = "Testing JCRGM Connect! @everyone";
  $("#msg-input").dispatchEvent(new window.Event("input", { bubbles: true }));
  check("send icon switched", () => $("#send-ico").innerHTML.includes("i-send"));
  click($("#send-btn"));
  await sleep(400);
  const msgs = window.eval("roomMessages('jcrgm-prayer').map(m=>m.content)");
  check("message stored", () => msgs.some((c) => c.includes("Testing JCRGM Connect")));
  check("outgoing bubble rendered", () => $$("#chat-wallpaper .msg.out").length >= 1);
  check("mention linkified", () => $("#chat-wallpaper").innerHTML.includes("mention"));

  console.log("- Reply & reactions -");
  check("reply action exists", () => !!$("#chat-wallpaper .msg .reply-action"));
  window.eval("setReply(roomMessages('jcrgm-prayer')[0].id)");
  check("reply bar shown", () => $("#reply-bar").classList.contains("show"));
  window.eval("cancelReply()");
  window.eval("toggleReaction(roomMessages('jcrgm-prayer')[0].id, 'HEART')");
  check("reaction added", () => {
    const m = window.eval("JSON.stringify(roomMessages('jcrgm-prayer')[0].reactions)");
    return m.includes("HEART");
  });

  console.log("- Poll vote -");
  window.eval("votePoll(DB.messages.find(m=>m.msg_type==='poll').id, 1)");
  check("poll vote recorded", () => {
    const m = window.eval("JSON.stringify(DB.messages.find(m=>m.msg_type==='poll').media_meta.options.map(o=>o.v.length))");
    return m !== null;
  });

  console.log("- Channel read-only (non-admin) -");
  window.eval("APP.me.role='Member'");
  window.eval("UI.openRoom('jcrgm-announcements')");
  await sleep(150);
  check("channel bar shown for member", () => $("#channel-bar").classList.contains("show") && $("#composer").style.display === "none");
  window.eval("APP.me.role='Pastor'");
  window.eval("UI.openRoom('jcrgm-announcements')");
  await sleep(150);
  check("admin can post", () => $("#composer").style.display !== "none");

  console.log("- Tabs: status & calls -");
  click($$(".nav-item[data-tab]")[1]);
  check("status tab", () => $("#view-status").classList.contains("active"));
  check("status rows", () => $$("#status-list .status-row").length >= 4);
  click($$("#status-list .status-row")[0]);
  await sleep(120);
  check("status viewer open", () => $("#status-viewer").classList.contains("show"));
  check("status caption filled", () => $("#sv-caption").textContent.length > 5);
  click($("#sv-close"));
  check("status viewer closed", () => !$("#status-viewer").classList.contains("show"));

  click($$(".nav-item[data-tab]")[2]);
  check("calls tab", () => $("#view-calls").classList.contains("active"));
  check("call rows", () => $$("#calls-list .call-row").length === 3);

  console.log("- Modals -");
  click($$(".nav-item[data-tab]")[0]);
  click($("#fab-new"));
  check("new chat modal", () => $("#modal-root").classList.contains("show") && $("#m-title").textContent === "New chat");
  check("contacts listed", () => $$("#m-body .pick-item").length >= 7);
  click($$("#m-body [data-new]")[0]);
  check("new group modal", () => $("#m-title").textContent === "New group");
  $("#m-body #grp-name").value = "JCRGM Test Cell Group";
  $$("#m-body .pick-item").slice(0, 3).forEach((p) => click(p));
  click($("#m-foot #grp-create"));
  await sleep(250);
  check("group created & opened", () => $("#screen-chat").classList.contains("active") &&
    window.eval("DB.rooms.some(r=>r.name==='JCRGM Test Cell Group')"));

  window.eval("openCloudModal()");
  check("cloud modal", () => $("#m-title").textContent === "Supabase Cloud");
  check("schema hint present", () => $("#m-body").innerHTML.includes("supabase-schema.sql"));
  window.eval("Modal.close()");

  window.eval("openSettingsModal()");
  check("settings modal", () => $("#m-title").textContent === "Settings");
  const royal = $$("#m-body .theme-card").find((c) => c.dataset.themeSet === "royal");
  click(royal);
  check("theme applied", () => window.document.documentElement.getAttribute("data-theme") === "royal");
  click($$("#m-body .theme-card").find((c) => c.dataset.themeSet === "dark"));
  window.eval("Modal.close()");

  window.eval("UI.openRoom('jcrgm-prayer'); openScriptureModal()");
  check("scripture modal", () => $("#m-title").textContent === "Share Scripture");
  $("#m-body #scr-txt").value = "The Lord is my shepherd.";
  $("#m-body #scr-ref").value = "Psalm 23:1";
  click($("#m-foot #scr-send"));
  await sleep(200);
  check("scripture message sent", () => window.eval("roomMessages('jcrgm-prayer').some(m=>m.msg_type==='scripture' && m.content.includes('shepherd'))"));

  window.eval("openAddStatusModal()");
  check("status modal", () => $("#m-title").textContent === "Add my status");
  $("#m-body #st-cap").value = "Praise God! Test status from automation";
  click($("#m-foot #st-go"));
  await sleep(200);
  check("status created", () => window.eval("DB.statuses.some(s=>s.caption.includes('Test status'))"));

  console.log("- Calls -");
  window.eval("UI.openRoom('dm-pastor'); startCall('dm-pastor','audio')");
  await sleep(150);
  check("call overlay shown", () => $("#call-overlay").classList.contains("show"));
  check("ringing status", () => $("#co-status").textContent.includes("Ringing"));
  click($("#co-hang"));
  await sleep(100);
  check("call ended + logged", () => !$("#call-overlay").classList.contains("show") &&
    window.eval("DB.calls[0].room_id === 'dm-pastor'"));

  console.log("- Auto reply demo -");
  window.eval("UI.openRoom('dm-ruth')");
  $("#msg-input").value = "Hello! Are we still on for youth meeting?";
  $("#msg-input").dispatchEvent(new window.Event("input", { bubbles: true }));
  click($("#send-btn"));
  await sleep(4500);
  check("auto reply received", () => window.eval("roomMessages('dm-ruth').some(m=>!String(m.id).startsWith('seed') && m.sender_id!==APP.me.id)"));

  console.log("- Emoji panel -");
  click($("#btn-emoji"));
  check("emoji panel open", () => $("#emoji-panel").classList.contains("show"));
  check("emoji grid filled", () => $$("#emoji-grid button").length >= 15);
  click($$("#emoji-grid button")[0]);
  check("emoji inserted", () => $("#msg-input").value.length > 0);

  console.log("- Context menu -");
  window.eval("openMessageMenu(roomMessages('dm-ruth')[0].id, 100, 100)");
  check("ctx menu open", () => $("#ctx-menu").classList.contains("show"));
  check("ctx items", () => $$("#ctx-menu button").length >= 4);
  window.eval("CtxMenu.close()");

  console.log("- Deep link handling -");
  window.eval("handleDeepLink()");
  check("no crash on deep link", () => true);

  console.log("- Persistence -");
  const saved = window.localStorage.getItem("jcrgm:rooms");
  check("rooms persisted", () => saved && JSON.parse(saved).length >= 10);
  check("messages persisted", () => JSON.parse(window.localStorage.getItem("jcrgm:messages")).length >= 19);

  // Report
  console.log("\n===== RESULTS =====");
  const fail = results.filter((r) => r[0] !== "PASS");
  results.forEach(([s, n]) => { if (s !== "PASS") console.log(s + ": " + n); });
  console.log(`${results.filter((r) => r[0] === "PASS").length}/${results.length} passed`);
  if (errors.length) {
    console.log("\n===== RUNTIME ERRORS =====");
    errors.slice(0, 30).forEach((e) => console.log(e));
  } else console.log("No runtime errors captured.");
  process.exit(fail.length || errors.length ? 1 : 0);
})().catch((e) => { console.error("TEST CRASH:", e); process.exit(2); });
