"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

// index.html から <script id="core"> を取り出して実行する
function loadCore() {
  const html = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
  const m = html.match(/<script id="core">([\s\S]*?)<\/script>/);
  assert.ok(m, "core script not found");
  const ctx = vm.createContext({});
  vm.runInContext(m[1], ctx);
  return ctx.Core;
}
const C = loadCore();

function memStorage(init = {}) {
  const data = { ...init };
  return {
    data,
    getItem: (k) => (k in data ? data[k] : null),
    setItem: (k, v) => { data[k] = String(v); },
    removeItem: (k) => { delete data[k]; },
  };
}
const at = (s) => new Date(s); // ローカル時刻として解釈される "YYYY-MM-DDTHH:MM"

test("日付ユーティリティはローカル日付で計算する", () => {
  assert.equal(C.toDateStr(new Date(2026, 0, 5, 23, 59)), "2026-01-05");
  assert.equal(C.addDays("2026-03-01", -1), "2026-02-28");
  assert.equal(C.addDays("2028-03-01", -1), "2028-02-29");
  assert.equal(C.addDays("2026-12-31", 1), "2027-01-01");
  assert.equal(C.timeStr(at("2026-11-20T09:05")), "09:05");
  assert.equal(C.shortDate("2026-11-08"), "11/8");
});

test("新規保存：原文のままなら メモ 小見出しで始まる", () => {
  const r = C.upsertEntry([], { date: "2026-11-20", mode: "research", text: "  実験した  ", summary: null, now: at("2026-11-20T10:00") });
  assert.equal(r.appended, false);
  assert.equal(r.entries.length, 1);
  assert.equal(r.entry.id, "2026-11-20_research");
  assert.equal(r.entry.transcript, "実験した");
  assert.equal(r.entry.summary, "## メモ（10:00）\n\n実験した");
  assert.equal(r.entry.summaryEdited, false);
});

test("新規保存：AI の要約は見出しが無ければ補う", () => {
  const r1 = C.upsertEntry([], { date: "2026-11-20", mode: "diary", text: "a", summary: "## 散歩\n\n歩いた", now: at("2026-11-20T10:00") });
  assert.equal(r1.entry.summary, "## 散歩\n\n歩いた");
  const r2 = C.upsertEntry([], { date: "2026-11-20", mode: "diary", text: "a", summary: "歩いた", now: at("2026-11-20T10:00") });
  assert.equal(r2.entry.summary, "## メモ\n\n歩いた");
});

test("同じ日付・モードは1件にまとまり，区切り線で追記される", () => {
  let { entries } = C.upsertEntry([], { date: "2026-11-20", mode: "research", text: "一回目", summary: null, now: at("2026-11-20T10:00") });
  const created = entries[0].createdAt;
  const r = C.upsertEntry(entries, { date: "2026-11-20", mode: "research", text: "二回目", summary: null, now: at("2026-11-20T15:30") });
  assert.equal(r.appended, true);
  assert.equal(r.entries.length, 1);
  assert.equal(r.entry.transcript, "一回目\n\n---（15:30 追記）\n\n二回目");
  assert.equal(r.entry.summary, "## メモ（10:00）\n\n一回目\n\n## メモ（15:30 追記）\n\n二回目");
  assert.equal(r.entry.createdAt, created);
  assert.notEqual(r.entry.updatedAt, created);
});

test("AI で追記すると要約を置き換え，transcript は連結する", () => {
  let { entries } = C.upsertEntry([], { date: "2026-11-20", mode: "research", text: "一回目", summary: "## A\n\nx", now: at("2026-11-20T10:00") });
  const before = C.findEntry(entries, "2026-11-20", "research");
  assert.equal(C.nextTranscript(before, "二回目", at("2026-11-20T11:00")), "一回目\n\n---（11:00 追記）\n\n二回目");
  assert.equal(C.nextTranscript(null, "x", at("2026-11-20T11:00")), "x");
  const r = C.upsertEntry(entries, { date: "2026-11-20", mode: "research", text: "二回目", summary: "## A\n\ny\n\n## B\n\nz", now: at("2026-11-20T11:00") });
  assert.equal(r.entry.summary, "## A\n\ny\n\n## B\n\nz");
  assert.match(r.entry.transcript, /一回目[\s\S]*二回目/);
});

test("日付が同じでもモードが違えば別の記録", () => {
  let { entries } = C.upsertEntry([], { date: "2026-11-20", mode: "research", text: "研究", summary: null, now: at("2026-11-20T10:00") });
  ({ entries } = C.upsertEntry(entries, { date: "2026-11-20", mode: "diary", text: "日記", summary: null, now: at("2026-11-20T10:00") }));
  assert.equal(entries.length, 2);
  assert.ok(C.findEntry(entries, "2026-11-20", "diary"));
  assert.ok(C.findEntry(entries, "2026-11-20", "research"));
});

test("空の入力や不正なモードは保存しない", () => {
  assert.throws(() => C.upsertEntry([], { date: "2026-11-20", mode: "research", text: "   ", summary: null, now: new Date() }));
  assert.throws(() => C.upsertEntry([], { date: "2026-11-20", mode: "other", text: "x", summary: null, now: new Date() }));
});

test("手で編集すると summaryEdited が立ち，AI 要約で解除される．原文追記では保たれる", () => {
  let { entries } = C.upsertEntry([], { date: "2026-11-20", mode: "diary", text: "a", summary: null, now: at("2026-11-20T10:00") });
  const id = entries[0].id;
  // 内容が同じなら edited にしない
  let e2 = C.updateEntry(entries, id, { summary: entries[0].summary, transcript: "a", now: at("2026-11-20T10:01") });
  assert.equal(e2[0].summaryEdited, false);
  entries = C.updateEntry(entries, id, { summary: "## 直した\n\n本文", transcript: "a2", now: at("2026-11-20T10:02") });
  assert.equal(entries[0].summaryEdited, true);
  assert.equal(entries[0].transcript, "a2");
  const raw = C.upsertEntry(entries, { date: "2026-11-20", mode: "diary", text: "b", summary: null, now: at("2026-11-20T10:03") });
  assert.equal(raw.entry.summaryEdited, true);
  assert.match(raw.entry.summary, /^## 直した/);
  const ai = C.upsertEntry(entries, { date: "2026-11-20", mode: "diary", text: "b", summary: "## 新\n\nx", now: at("2026-11-20T10:03") });
  assert.equal(ai.entry.summaryEdited, false);
});

test("削除と並び替え・絞り込み", () => {
  const mk = (date, mode) => ({ id: `${date}_${mode}`, date, mode, summary: "", transcript: "" });
  const list = [mk("2026-11-01", "diary"), mk("2026-11-03", "research"), mk("2026-11-03", "diary"), mk("2026-11-02", "research")];
  assert.deepEqual(C.sortedEntries(list, "all").map((e) => e.id),
    ["2026-11-03_diary", "2026-11-03_research", "2026-11-02_research", "2026-11-01_diary"]);
  assert.deepEqual(C.sortedEntries(list, "research").map((e) => e.date), ["2026-11-03", "2026-11-02"]);
  assert.equal(C.deleteEntry(list, "2026-11-01_diary").length, 3);
  assert.equal(list.length, 4, "元の配列は変更しない");
});

test("保存と読み込み，壊れた JSON は退避する", () => {
  const s = memStorage();
  assert.equal(C.loadEntries(s).length, 0);
  C.saveEntries(s, [{ id: "x" }]);
  assert.equal(C.loadEntries(s)[0].id, "x");

  const broken = memStorage({ [C.ENTRIES_KEY]: "{oops" });
  assert.equal(C.loadEntries(broken).length, 0);
  assert.equal(broken.data[C.ENTRIES_KEY + ".broken"], "{oops");
  assert.equal(broken.getItem(C.ENTRIES_KEY), null);

  const notArray = memStorage({ [C.ENTRIES_KEY]: "{}" });
  assert.equal(C.loadEntries(notArray).length, 0);
  assert.equal(notArray.data[C.ENTRIES_KEY + ".broken"], "{}");
});

test("設定は既定値で補い，壊れていても既定値を返す", () => {
  const s = memStorage();
  assert.equal(C.loadSettings(s).model, "claude-opus-5-5");
  C.saveSettings(s, { apiKey: "k", model: "m", lastMode: "diary" });
  assert.deepEqual({ ...C.loadSettings(s) }, { apiKey: "k", model: "m", lastMode: "diary" });
  assert.equal(C.loadSettings(memStorage({ [C.SETTINGS_KEY]: "nope" })).lastMode, "research");
});

test("週次：基準日を含む7日間の研究日誌だけを昇順で選ぶ（月またぎ）", () => {
  assert.deepEqual({ ...C.weekRange("2026-12-03") }, { start: "2026-11-27", end: "2026-12-03" });
  const mk = (date, mode) => ({ id: `${date}_${mode}`, date, mode, summary: `s${date}` });
  const list = [
    mk("2026-11-26", "research"), // 範囲外（8日前）
    mk("2026-11-27", "research"), // 境界（含む）
    mk("2026-12-03", "research"), // 境界（含む）
    mk("2026-12-01", "diary"),    // 日記は除く
    mk("2026-11-30", "research"),
    mk("2026-12-04", "research"), // 未来は除く
  ];
  assert.deepEqual(C.selectWeekEntries(list, "2026-12-03").map((e) => e.date), ["2026-11-27", "2026-11-30", "2026-12-03"]);
  const input = C.buildWeeklyInput(C.selectWeekEntries(list, "2026-12-03"), C.weekRange("2026-12-03"));
  assert.ok(input.startsWith("期間: 2026-11-27〜2026-12-03\n\n### 2026-11-27\ns2026-11-27"));
});

test("プロンプト：小見出しの規則とモード別の指示を含む", () => {
  const d = C.systemPrompt("diary");
  const r = C.systemPrompt("research");
  for (const p of [d, r]) {
    assert.match(p, /付け足さない/);
    assert.match(p, /必ず「## 」で始まる小見出し/);
    assert.match(p, /話題ごとに小見出しを分け/);
  }
  assert.match(d, /日記/);
  assert.match(r, /箇条書き/);
  assert.match(r, /さらに見出しを作らない/);
  assert.doesNotMatch(r, /### /, "研究日誌に固定の観点見出しを付けない");
  const w = C.systemPrompt("weekly");
  for (const h of ["## 今週やったこと", "## わかったこと", "## 課題", "## 来週の予定"]) assert.ok(w.includes(h), h);
  assert.throws(() => C.systemPrompt("x"));
});

test("リクエスト本体", () => {
  const req = C.buildRequest("research", C.buildEntryInput("2026-11-20", "本文"), "");
  assert.equal(req.model, "claude-opus-5-5");
  assert.equal(req.max_tokens, 16000);
  assert.equal(req.output_config.effort, "low");
  assert.equal(req.fallbacks, "default");
  assert.deepEqual([...req.betas], ["server-side-fallback-2026-07-01"]);
  assert.equal(req.thinking, undefined);
  assert.equal(req.messages[0].role, "user");
  assert.equal(req.messages[0].content, "日付: 2026-11-20\n\n本文");
  assert.equal(C.buildRequest("diary", "x", "my-model").model, "my-model");
});

test("extractText：refusal・空・text の連結", () => {
  assert.equal(C.extractText(null).ok, false);
  assert.equal(C.extractText({ stop_reason: "refusal", content: [{ type: "text", text: "x" }] }).ok, false);
  assert.equal(C.extractText({ stop_reason: "end_turn", content: [] }).ok, false);
  const r = C.extractText({ stop_reason: "end_turn", content: [
    { type: "thinking", thinking: "" }, { type: "fallback" }, { type: "text", text: "## A\n" }, { type: "text", text: "b" },
  ] });
  assert.deepEqual({ ...r }, { ok: true, text: "## A\nb" });
});

test("カレンダー：日曜始まりで月の日数を並べる", () => {
  const g = C.monthGrid(2026, 10); // 2026年11月（1日は日曜）
  assert.equal(g[0][0], "2026-11-01");
  assert.equal(g.flat().filter(Boolean).length, 30);
  assert.ok(g.every((w) => w.length === 7));
  const feb = C.monthGrid(2026, 1); // 2026年2月（1日は日曜，28日）
  assert.equal(feb.length, 4);
  const dec = C.monthGrid(2026, 11); // 2026年12月（1日は火曜）
  assert.deepEqual([...dec[0]].slice(0, 3), [null, null, "2026-12-01"]);
});

test("簡易 Markdown：見出し・箇条書き・区切り線・段落とエスケープ", () => {
  const html = C.renderMarkdown("## 話題A\n\n本文1\n本文2\n\n### やったこと\n- 項目<b>\n- 項目2\n\n---（15:30 追記）\n\n## 話題B");
  assert.match(html, /<h3>話題A<\/h3>/);
  assert.match(html, /<p>本文1<br>本文2<\/p>/);
  assert.match(html, /<h4>やったこと<\/h4>/);
  assert.match(html, /<ul><li>項目&lt;b&gt;<\/li><li>項目2<\/li><\/ul>/);
  assert.match(html, /<hr>\n<p class="sep">（15:30 追記）<\/p>/);
  assert.match(html, /<h3>話題B<\/h3>/);
  assert.doesNotMatch(C.renderMarkdown("<script>alert(1)</script>"), /<script>/);
  assert.equal(C.preview("## 見出し\n\n- あいう", 100), "見出し あいう");
  assert.equal(C.preview("あいうえお", 3), "あいう…");
});
