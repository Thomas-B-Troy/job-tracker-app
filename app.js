/* Job Tracker: a phone-friendly viewer and quick editor for a job search kept as
   Markdown + YAML files in a private GitHub repo. No server: the browser talks to the
   GitHub API directly with a token that never leaves this device. */
(() => {
  "use strict";

  const CONFIG_KEY = "jt.config";
  const CACHE_KEY = "jt.cache";
  const API = "https://api.github.com";
  const DATA_PATH = /^(jobs\/(inbox|active|archive)\/[^/]+\.md|companies\/[^/]+\.md|contacts\.ya?ml|weekly\.ya?ml)$/;
  const CLOSED = new Set(["rejected", "no-response", "withdrawn", "not-applied", "closed", "archived", "declined"]);
  const STATUSES = ["lead", "drafting", "confirm", "applied", "screening", "interviewing", "offer", "no-response", "rejected", "withdrawn", "not-applied"];
  const PLACEHOLDER = /^(not (captured|written|researched) yet\.?|\(none yet\))$/i;

  // CORE_SCHEMA keeps dates as plain "YYYY-MM-DD" strings instead of Date objects.
  const YAML_OPTS = { schema: jsyaml.CORE_SCHEMA };

  const $ = (sel, el = document) => el.querySelector(sel);
  const view = $("#view");
  let state = { roles: [], companies: {}, contacts: [], weekly: null, sha: {} };
  let config = loadJSON(CONFIG_KEY) || {};
  let roleFilter = "open";
  // Warm intros added since the previous visit are flagged "new". The first visit counts everything as new.
  const SEEN_KEY = "jt.seen";
  const prevSeen = loadJSON(SEEN_KEY) || "";
  saveJSON(SEEN_KEY, new Date().toLocaleDateString("en-CA", { timeZone: "Australia/Brisbane" }));

  // ---------- storage helpers (browser storage can be blocked; never let that break the app)
  function loadJSON(key) { try { return JSON.parse(localStorage.getItem(key)); } catch { return null; } }
  function saveJSON(key, val) { try { localStorage.setItem(key, JSON.stringify(val)); } catch { /* ignore */ } }

  // ---------- text helpers
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const slugify = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  const today = () => new Date().toLocaleDateString("en-CA", { timeZone: "Australia/Brisbane" });

  DOMPurify.addHook("afterSanitizeAttributes", (node) => {
    if (node.tagName === "A") { node.setAttribute("target", "_blank"); node.setAttribute("rel", "noopener noreferrer"); }
  });
  const md = (text) => DOMPurify.sanitize(marked.parse(text || ""));

  function b64decode(b64) {
    const bin = atob(b64.replace(/\n/g, ""));
    return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
  }
  function b64encode(text) {
    const bytes = new TextEncoder().encode(text);
    let bin = "";
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return btoa(bin);
  }

  function splitFrontmatter(text) {
    const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(text);
    if (!m) return { data: {}, body: text };
    let data = {};
    try { data = jsyaml.load(m[1], YAML_OPTS) || {}; } catch (e) { console.warn("Bad frontmatter", e); }
    return { data, body: m[2] };
  }

  // Split a Markdown body into its "## " sections, keeping order.
  function sections(body) {
    const out = [];
    let cur = { title: "", text: "" };
    for (const line of body.split(/\r?\n/)) {
      const h = /^##\s+(.+?)\s*$/.exec(line);
      if (h) { out.push(cur); cur = { title: h[1], text: "" }; } else cur.text += line + "\n";
    }
    out.push(cur);
    return out.filter((s) => s.title || s.text.trim());
  }

  // A section counts as empty if it only holds placeholders or unfilled "- **Label:**" lines.
  function isEmpty(text) {
    const lines = (text || "").split("\n").map((l) => l.trim()).filter(Boolean)
      .filter((l) => !PLACEHOLDER.test(l) && !/^-\s*\*\*[^*]+:\*\*\s*$/.test(l) && l !== "---");
    return lines.length === 0;
  }

  // ---------- loading
  async function gh(path, opts = {}) {
    const res = await fetch(API + path, {
      ...opts,
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${config.token}`,
        "X-GitHub-Api-Version": "2022-11-28",
        ...(opts.headers || {}),
      },
    });
    if (!res.ok) {
      const msg = res.status === 401 ? "GitHub rejected the token (401). Check it in Settings."
        : res.status === 404 ? "Repo or branch not found (404). Check owner, repo, branch and the token's repo access."
        : res.status === 409 ? "Someone changed this file since it loaded (409). Refresh and try again."
        : `GitHub error ${res.status}`;
      throw new Error(msg);
    }
    return res.json();
  }

  async function pool(items, limit, fn) {
    const out = [];
    let i = 0;
    await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (i < items.length) { const n = i++; out[n] = await fn(items[n]); }
    }));
    return out;
  }

  async function loadFromGitHub() {
    const { owner, repo, branch } = config;
    const tree = await gh(`/repos/${enc(owner)}/${enc(repo)}/git/trees/${enc(branch || "main")}?recursive=1`);
    const cache = loadJSON(CACHE_KEY) || {};
    const next = {};
    const blobs = tree.tree.filter((t) => t.type === "blob" && DATA_PATH.test(t.path));
    await pool(blobs, 6, async (t) => {
      if (cache[t.path] && cache[t.path].sha === t.sha) { next[t.path] = cache[t.path]; return; }
      const blob = await gh(`/repos/${enc(owner)}/${enc(repo)}/git/blobs/${t.sha}`);
      next[t.path] = { sha: t.sha, text: b64decode(blob.content) };
    });
    saveJSON(CACHE_KEY, next);
    return next;
  }

  async function loadStatic(base) {
    const manifest = await (await fetch(base + "manifest.json", { cache: "no-cache" })).json();
    const files = {};
    await pool(manifest.files, 6, async (p) => {
      const r = await fetch(base + p, { cache: "no-cache" });
      if (r.ok) files[p] = { sha: "", text: await r.text() };
    });
    return files;
  }

  const enc = (s) => encodeURIComponent(s || "");

  function ingest(files) {
    const roles = [], companies = {}, sha = {};
    let contacts = [], weekly = null;
    for (const [path, f] of Object.entries(files)) {
      sha[path] = f.sha;
      if (path.startsWith("jobs/")) {
        const { data, body } = splitFrontmatter(f.text);
        if (!data.company && !data.role) continue; // notes that live alongside job files
        const folder = path.split("/")[1];
        const status = String(data.status || folder).toLowerCase().trim();
        roles.push({
          path, folder, data, body, status,
          slug: data.company_slug || slugify(data.company),
          closed: folder === "archive" || [...CLOSED].some((c) => status.startsWith(c)),
          confirm: status === "confirm" || !!String(data.needs_confirm || "").trim(),
          sortDate: String(data.date_applied || data.date_found || (/\d{4}-\d{2}-\d{2}/.exec(path) || [""])[0]),
          haystack: (f.text).toLowerCase(),
        });
      } else if (path.startsWith("companies/")) {
        const { data, body } = splitFrontmatter(f.text);
        const slug = data.slug || path.slice(10, -3);
        companies[slug] = { path, slug, data, body, haystack: f.text.toLowerCase() };
      } else if (/^contacts\./.test(path)) {
        try { contacts = jsyaml.load(f.text, YAML_OPTS) || []; } catch (e) { console.warn(e); }
      } else if (/^weekly\./.test(path)) {
        try { weekly = jsyaml.load(f.text, YAML_OPTS); } catch (e) { console.warn(e); }
      }
    }
    roles.sort((a, b) => b.sortDate.localeCompare(a.sortDate));
    state = { roles, companies, contacts: Array.isArray(contacts) ? contacts : [], weekly, sha };
    notifyNewIntros();
  }

  async function load({ quiet = false } = {}) {
    const local = new URLSearchParams(location.search).get("data");
    const isLocalhost = ["localhost", "127.0.0.1"].includes(location.hostname);
    try {
      if (local && isLocalhost) ingest(await loadStatic(local.endsWith("/") ? local : local + "/"));
      else if (config.mode === "github" && config.token) {
        const cached = loadJSON(CACHE_KEY);
        if (cached && !state.roles.length) { ingest(cached); route(); }
        ingest(await loadFromGitHub());
        if (!quiet) toast("Up to date");
      } else if (config.mode === "demo") ingest(await loadStatic("sample/"));
      else { location.hash = "#/settings"; }
    } catch (e) {
      console.error(e);
      toast(e.message || "Could not load data");
    }
    route();
  }

  // ---------- writing back (GitHub mode only)
  const canWrite = () => config.mode === "github" && !!config.token && !new URLSearchParams(location.search).get("data");

  async function commit(path, text, message) {
    const { owner, repo, branch } = config;
    const res = await gh(`/repos/${enc(owner)}/${enc(repo)}/contents/${path.split("/").map(enc).join("/")}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message, content: b64encode(text), sha: state.sha[path], branch: branch || "main" }),
    });
    const cache = loadJSON(CACHE_KEY) || {};
    cache[path] = { sha: res.content.sha, text };
    saveJSON(CACHE_KEY, cache);
    ingest(cache);
  }

  function withStatus(text, status) {
    return text.replace(/^(---\r?\n[\s\S]*?)^status:.*$/m, `$1status: ${status}`);
  }

  function withNote(text, note) {
    const line = `- ${today()}: ${note.replace(/\s*\n\s*/g, " ").trim()}`;
    const h = text.search(/^## Activity log\s*$/m);
    if (h < 0) return text.replace(/\s*$/, `\n\n## Activity log\n\n${line}\n`);
    // The log ends at the next "## " heading or a "---" rule, whichever comes first.
    const endRel = text.slice(h + 1).search(/\n(## |---\s*$)/m);
    const end = endRel < 0 ? text.length : h + 1 + endRel;
    const head = text.slice(0, end).replace(/\s*$/, "").replace(/\n- \(none yet\)$/, "");
    return `${head}\n${line}\n${text.slice(end)}`;
  }

  // ---------- rendering helpers
  const pill = (status) => `<span class="pill ${esc(slugify(status))}">${esc(status || "unknown")}</span>`;
  const repoLink = (path) => config.mode === "github" && config.owner && path
    ? `https://github.com/${enc(config.owner)}/${enc(config.repo)}/blob/${enc(config.branch || "main")}/${path.split("/").map(enc).join("/")}`
    : "";
  const fileName = (p) => String(p || "").split("/").pop();

  // "- **Label:** value" lines inside a section, e.g. Role specifics.
  function labelled(body, label) {
    const m = new RegExp(`^-[ \\t]*\\*\\*${label}[^*\\n]*:\\*\\*[ \\t]*(\\S.*)$`, "im").exec(body || "");
    return m ? m[1].trim() : "";
  }

  // First real line of a section, as plain text.
  function firstLine(body, title) {
    const s = sections(body || "").find((x) => x.title.toLowerCase() === title);
    if (!s || isEmpty(s.text)) return "";
    const line = s.text.split("\n").map((l) => l.trim())
      .find((l) => l && !PLACEHOLDER.test(l) && l !== "---" && !l.startsWith("|") && !/^-\s*\*\*[^*]+:\*\*\s*$/.test(l));
    return (line || "").replace(/^[-*]\s+/, "").replace(/\*\*|__|`/g, "").replace(/\[([^\]]+)\]\([^)]*\)/g, "$1");
  }

  function age(date) {
    const t = Date.parse(date);
    if (!t) return "";
    const days = Math.max(0, Math.floor((Date.now() - t) / 86400000));
    return days < 1 ? "today" : days < 7 ? `${days}d` : days < 60 ? `${Math.floor(days / 7)}w` : `${Math.floor(days / 30)}mo`;
  }

  const initials = (name) => String(name || "?").replace(/[^A-Za-z0-9 ]/g, " ").trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join("").toUpperCase();
  const hue = (name) => [...String(name || "")].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7) % 6;
  const ICON_PIN = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2a7 7 0 0 0-7 7c0 5 7 13 7 13s7-8 7-13a7 7 0 0 0-7-7zm0 9.5A2.5 2.5 0 1 1 12 6.5a2.5 2.5 0 0 1 0 5z"/></svg>';
  const ICON_DOC = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 2h9l5 5v15H6zm8 1.5V8h4.5z"/></svg>';
  const ICON_LINK = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M10.6 13.4a1 1 0 0 1 0-1.4l3.4-3.4a1 1 0 1 1 1.4 1.4L12 13.4a1 1 0 0 1-1.4 0zM7 17a3 3 0 0 1 0-4.2l2-2 1.4 1.4-2 2a1 1 0 0 0 1.4 1.4l2-2 1.4 1.4-2 2A3 3 0 0 1 7 17zm6.6-4.6-1.4-1.4 2-2a1 1 0 0 0-1.4-1.4l-2 2-1.4-1.4 2-2a3 3 0 0 1 4.2 4.2z"/></svg>';
  const ICON_USER = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 12a5 5 0 1 0-5-5 5 5 0 0 0 5 5zm0 2c-4 0-8 2-8 5v3h16v-3c0-3-4-5-8-5z"/></svg>';

  // Warm intro paths recorded on the company file (intros: [{via, to, role, hot, added}]).
  const introsFor = (slug) => {
    const c = state.companies[slug];
    return c && Array.isArray(c.data.intros) ? c.data.intros.filter((i) => i && i.via && i.to) : [];
  };
  const isNew = (i) => String(i.added || "") > prevSeen;
  const isHot = (i) => i.hot === true || String(i.hot).toLowerCase() === "true";

  function introFlag(r) {
    if (r.closed) return "";
    const list = introsFor(r.slug);
    if (!list.length) return "";
    const hot = list.find(isHot);
    const fresh = list.some(isNew) ? '<span class="pill new">new</span>' : "";
    return hot
      ? `<div class="tile-flag hot">${ICON_LINK}<span><strong>Hot lead:</strong> ${esc(hot.via)} knows ${esc(hot.to)}${list.length > 1 ? ` (+${list.length - 1} more)` : ""}</span>${fresh}</div>`
      : `<div class="tile-flag">${ICON_LINK}<span>${list.length} warm intro path${list.length === 1 ? "" : "s"}</span>${fresh}</div>`;
  }

  function roleCard(r) {
    const d = r.data;
    const co = state.companies[r.slug];
    const about = co ? (firstLine(co.body, "overview") || co.data.industry || "") : "";
    const summary = labelled(r.body, "Required skills") || firstLine(r.body, "posting");
    const tags = [d.remote, d.hours, d.salary].map((x) => String(x || "").trim()).filter((x) => x && !/^not stated/i.test(x));
    const people = [d.contact && `Contact: ${d.contact}`, d.referred_by && `Referred by ${d.referred_by}`].filter(Boolean).join(" · ");
    const when = d.date_applied || d.date_found;
    return `<a class="tile" href="#/role/${enc(r.path)}">
      <div class="tile-head"><div class="tile-title">${esc(d.role)}</div>${when ? `<span class="age" title="${esc(when)}">${esc(age(when))}</span>` : ""}</div>
      ${d.location ? `<div class="tile-loc">${ICON_PIN}<span>${esc(d.location)}</span></div>` : ""}
      ${tags.length ? `<div class="tags">${tags.map((t) => `<span class="tag">${esc(t)}</span>`).join("")}</div>` : ""}
      <div class="tile-co"><span class="avatar h${hue(d.company)}">${esc(initials(d.company))}</span>
        <div class="clamp3"><strong>${esc(d.company)}</strong>${about ? `: ${esc(about)}` : ""}</div></div>
      ${summary ? `<div class="tile-row">${ICON_DOC}<div class="clamp4">${esc(summary)}</div></div>` : ""}
      ${people ? `<div class="tile-row">${ICON_USER}<div class="clamp2">${esc(people)}</div></div>` : ""}
      ${introFlag(r)}
      ${d.next_action && !r.closed ? `<div class="tile-next"><strong>Next${d.next_action_date ? ` ${esc(d.next_action_date)}` : ""}:</strong> ${esc(d.next_action)}</div>` : ""}
      <div class="tile-foot">${pill(r.status)}${r.confirm ? '<span class="pill confirm">needs confirming</span>' : ""}
        <span class="muted small">${esc([d.date_applied && `Applied ${d.date_applied}`, d.channel].filter(Boolean).join(" · "))}</span></div>
    </a>`;
  }

  function companyCard(c) {
    const n = state.roles.filter((r) => r.slug === c.slug).length;
    return `<a class="card" href="#/company/${enc(c.slug)}">
      <div class="t">${esc(c.data.name || c.slug)}</div>
      <div class="s">${esc([c.data.industry, c.data.hq].filter(Boolean).join(" · ") || (c.data.researched ? "" : "Not researched yet"))}</div>
      <div class="row"><span class="muted small">${n} role${n === 1 ? "" : "s"}</span>
        ${c.data.researched ? `<span class="muted small">researched ${esc(c.data.researched)}</span>` : ""}</div>
    </a>`;
  }

  function contactCard(p) {
    const co = p.company_slug && state.companies[p.company_slug];
    return `<div class="card">
      <div class="t">${esc(p.name)}</div>
      <div class="s">${esc([p.role, p.company].filter(Boolean).join(", "))}</div>
      ${p.notes ? `<div class="small">${esc(p.notes)}</div>` : ""}
      ${p.next_step ? `<div class="small"><strong>Next:</strong> ${esc(p.next_step)}</div>` : ""}
      <div class="row">${p.status ? pill(p.status) : ""}${p.connection_type ? `<span class="pill">${esc(p.connection_type)}</span>` : ""}
        ${safeUrl(p.linkedin) ? `<a class="small" href="${esc(safeUrl(p.linkedin))}" target="_blank" rel="noopener noreferrer">LinkedIn</a>` : ""}
        ${co ? `<a class="small" href="#/company/${enc(p.company_slug)}">Company</a>` : ""}</div>
    </div>`;
  }

  function safeUrl(u) {
    try { const x = new URL(String(u)); return /^https?:$/.test(x.protocol) ? x.href : ""; } catch { return ""; }
  }

  function facts(pairs) {
    const items = pairs.filter(([, v]) => v !== undefined && v !== null && String(v).trim() !== "");
    if (!items.length) return "";
    return `<div class="facts">${items.map(([k, v]) => `<div class="fact"><div class="k">${esc(k)}</div><div class="v">${esc(v)}</div></div>`).join("")}</div>`;
  }

  function sectionBlocks(list, openTitles = []) {
    return list.filter((s) => s.title).map((s) => {
      const empty = isEmpty(s.text);
      const open = !empty && openTitles.some((t) => s.title.toLowerCase().startsWith(t)) ? " open" : "";
      return `<details class="sec"${open}><summary>${esc(s.title)}${empty ? ' <span class="muted small">empty</span>' : ""}</summary>
        <div class="md">${empty ? '<p class="empty">Nothing recorded yet.</p>' : md(s.text)}</div></details>`;
    }).join("");
  }

  function setChrome(title, tab, back) {
    $("#title").textContent = title;
    document.title = title === "Job Tracker" ? title : `${title} · Job Tracker`;
    $("#back").hidden = !back;
    document.querySelectorAll(".tabs a").forEach((a) => a.classList.toggle("on", a.dataset.tab === tab));
    document.body.classList.toggle("wide", tab === "roles" && !back || tab === "");
  }

  // Count new warm intros on open roles: dot on the Roles tab, and the home-screen icon badge where supported.
  function notifyNewIntros() {
    const slugs = new Set(state.roles.filter((r) => !r.closed).map((r) => r.slug));
    const fresh = [...slugs].reduce((n, s) => n + introsFor(s).filter(isNew).length, 0);
    const tab = document.querySelector('.tabs a[data-tab="roles"]');
    if (tab) tab.classList.toggle("dot", fresh > 0);
    try { if (navigator.setAppBadge) fresh ? navigator.setAppBadge(fresh) : navigator.clearAppBadge(); } catch { /* optional */ }
  }

  // ---------- views
  function viewRoles() {
    setChrome("Job Tracker", "roles");
    const groups = {
      open: (r) => !r.closed,
      intros: (r) => !r.closed && introsFor(r.slug).length > 0,
      confirm: (r) => r.confirm,
      closed: (r) => r.closed,
      all: () => true,
    };
    const labels = { open: "Open", intros: "Warm intros", confirm: "Needs confirming", closed: "Closed", all: "All" };
    const list = state.roles.filter(groups[roleFilter] || groups.open);
    const next = state.roles.filter((r) => !r.closed && r.data.next_action_date)
      .sort((a, b) => String(a.data.next_action_date).localeCompare(String(b.data.next_action_date)));
    const hotLeads = state.roles.filter((r) => !r.closed)
      .flatMap((r) => introsFor(r.slug).filter(isHot).map((i) => ({ r, i })))
      .filter((x, n, all) => all.findIndex((y) => y.r.slug === x.r.slug && y.i.to === x.i.to) === n);
    view.innerHTML = `
      <div class="chips">${Object.keys(groups).map((k) =>
        `<button class="chip${k === roleFilter ? " on" : ""}" data-filter="${k}">${labels[k]} (${state.roles.filter(groups[k]).length})</button>`).join("")}</div>
      ${hotLeads.length && roleFilter === "open" ? `<div class="group-h">Hot leads</div><div class="list">${hotLeads.map(({ r, i }) =>
        `<a class="card lead" href="#/role/${enc(r.path)}"><div class="t">${esc(i.via)} knows ${esc(i.to)}${isNew(i) ? ' <span class="pill new">new</span>' : ""}</div><div class="s">${esc(i.role || "")}${i.role ? " · " : ""}${esc(r.data.company)}, ${esc(r.data.role)}</div></a>`).join("")}</div>` : ""}
      ${next.length && roleFilter === "open" ? `<div class="group-h">Next actions</div><div class="list">${next.map((r) =>
        `<a class="card" href="#/role/${enc(r.path)}"><div class="t">${esc(r.data.next_action_date)}: ${esc(r.data.next_action)}</div><div class="s">${esc(r.data.company)}, ${esc(r.data.role)}</div></a>`).join("")}</div>` : ""}
      ${(next.length || hotLeads.length) && roleFilter === "open" ? '<div class="group-h">Roles</div>' : ""}
      <div class="tiles">${list.map(roleCard).join("") || '<p class="empty">No roles here.</p>'}</div>`;
    view.querySelectorAll("[data-filter]").forEach((b) => b.addEventListener("click", () => { roleFilter = b.dataset.filter; viewRoles(); }));
  }

  function viewRole(path) {
    const r = state.roles.find((x) => x.path === path);
    if (!r) return notFound();
    const d = r.data;
    const co = state.companies[r.slug];
    setChrome(d.company || "Role", "roles", true);
    const people = state.contacts.filter((p) => p.company_slug && p.company_slug === r.slug);
    const coSecs = co ? sections(co.body) : [];
    const brief = coSecs.filter((s) => /^(overview|mission|core values|people i know|green flags|red flags|reviews)/i.test(s.title) && !isEmpty(s.text));
    const links = [
      [safeUrl(d.url), "Job ad"],
      [repoLink(d.resume_file), d.resume_file ? `Resume: ${fileName(d.resume_file)}` : ""],
      [repoLink(d.cover_letter_file), d.cover_letter_file ? `Cover letter: ${fileName(d.cover_letter_file)}` : ""],
      [repoLink(r.path), "Open file on GitHub"],
    ];
    view.innerHTML = `
      <div class="hero"><h2>${esc(d.role)}</h2>
        <div class="s">${co ? `<a href="#/company/${enc(r.slug)}">${esc(d.company)}</a>` : esc(d.company)} ${pill(r.status)}</div></div>
      ${d.needs_confirm ? `<div class="callout"><strong>To confirm:</strong> ${esc(d.needs_confirm)}</div>` : ""}
      ${introsFor(r.slug).length ? `<div class="callout intros"><strong>Warm intros</strong><ul>${introsFor(r.slug).map((i) =>
        `<li>${isHot(i) ? '<span class="pill hot">hot</span> ' : ""}<strong>${esc(i.via)}</strong> knows <strong>${esc(i.to)}</strong>${i.role ? `, ${esc(i.role)}` : ""}${isNew(i) ? ' <span class="pill new">new</span>' : ""}</li>`).join("")}</ul></div>` : ""}
      ${facts([["Applied", d.date_applied], ["Channel", d.channel], ["Contact", d.contact], ["Salary", d.salary],
        ["Location", d.location], ["Work mode", d.remote], ["Hours", d.hours], ["Level", d.level],
        ["Interview stage", d.interview_stage], ["Referred by", d.referred_by], ["Fit", d.fit_score], ["Interest", d.interest],
        ["Next action", [d.next_action_date, d.next_action].filter(Boolean).join(": ")]])}
      <div class="links">${links.filter(([u, t]) => u && t).map(([u, t]) => `<a href="${esc(u)}" target="_blank" rel="noopener noreferrer">${esc(t)}</a>`).join("")}
        ${!repoLink(d.resume_file) && d.resume_file ? `<span class="small muted">Resume: ${esc(fileName(d.resume_file))}</span>` : ""}
        ${!repoLink(d.cover_letter_file) && d.cover_letter_file ? `<span class="small muted">Cover letter: ${esc(fileName(d.cover_letter_file))}</span>` : ""}</div>
      ${brief.length || people.length ? `<details class="sec" open><summary>Company brief</summary><div class="md">
        ${brief.map((s) => `<h4>${esc(s.title)}</h4>${md(s.text)}`).join("")}
        ${people.length ? `<h4>Contacts on file</h4><ul>${people.map((p) => `<li>${esc(p.name)}${p.role ? `, ${esc(p.role)}` : ""}${p.notes ? `: ${esc(p.notes)}` : ""}</li>`).join("")}</ul>` : ""}
        ${co ? `<p><a href="#/company/${enc(r.slug)}">Full company research</a></p>` : ""}</div></details>` : ""}
      ${sectionBlocks(sections(r.body), ["alignment", "interview prep", "activity log"])}
      ${canWrite() ? `<details class="sec"><summary>Update</summary><form class="stack md" id="upd">
        <label>Status <select name="status">${[...new Set([r.status, ...STATUSES])].map((s) => `<option${s === r.status ? " selected" : ""}>${esc(s)}</option>`).join("")}</select></label>
        <label>Add a note to the activity log <textarea name="note" placeholder="e.g. Phone screen with Sam booked for Tuesday 10am"></textarea></label>
        <button class="primary" type="submit">Save to GitHub</button></form></details>` : ""}`;
    const form = $("#upd");
    if (form) form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const status = form.status.value, note = form.note.value.trim();
      if (status === r.status && !note) return toast("Nothing to save");
      const btn = form.querySelector("button");
      btn.disabled = true; btn.textContent = "Saving...";
      try {
        const cache = loadJSON(CACHE_KEY) || {};
        let text = cache[r.path] ? cache[r.path].text : null;
        if (text == null) throw new Error("Refresh first, then try again.");
        if (status !== r.status) text = withStatus(text, status);
        if (note) text = withNote(text, note);
        const bits = [status !== r.status ? `status ${status}` : "", note ? "note" : ""].filter(Boolean).join(" + ");
        await commit(r.path, text, `${d.company}: ${bits} (from phone)`);
        toast("Saved");
        viewRole(r.path);
      } catch (err) { toast(err.message); btn.disabled = false; btn.textContent = "Save to GitHub"; }
    });
  }

  function viewCompanies() {
    setChrome("Companies", "companies");
    const list = Object.values(state.companies).sort((a, b) => String(a.data.name).localeCompare(String(b.data.name)));
    view.innerHTML = `<div class="list">${list.map(companyCard).join("") || '<p class="empty">No companies yet.</p>'}</div>`;
  }

  function viewCompany(slug) {
    const c = state.companies[slug];
    if (!c) return notFound();
    const d = c.data;
    setChrome(d.name || slug, "companies", true);
    const roles = state.roles.filter((r) => r.slug === slug);
    const people = state.contacts.filter((p) => p.company_slug === slug);
    const links = [[d.website, "Website"], [d.linkedin, "LinkedIn"], [d.glassdoor, "Glassdoor"], [d.seek_reviews, "SEEK reviews"], [repoLink(c.path), "Open file on GitHub"]];
    view.innerHTML = `
      <div class="hero"><h2>${esc(d.name || slug)}</h2>
        <div class="s">${esc(d.researched ? `Researched ${d.researched}` : "Not researched yet")}</div></div>
      ${facts([["Industry", d.industry], ["Size", d.size], ["Head office", d.hq]])}
      <div class="links">${links.map(([u, t]) => [safeUrl(u), t]).filter(([u]) => u).map(([u, t]) => `<a href="${esc(u)}" target="_blank" rel="noopener noreferrer">${esc(t)}</a>`).join("")}</div>
      ${roles.length ? `<div class="group-h">Roles</div><div class="tiles">${roles.map(roleCard).join("")}</div>` : ""}
      ${people.length ? `<div class="group-h">Contacts on file</div><div class="list">${people.map(contactCard).join("")}</div>` : ""}
      <div class="group-h">Research</div>
      ${sectionBlocks(sections(c.body), ["overview", "people i know", "green flags", "red flags", "reviews"])}`;
  }

  function viewContacts() {
    setChrome("People", "contacts");
    const list = [...state.contacts].sort((a, b) => String(a.name).localeCompare(String(b.name)));
    view.innerHTML = `<div class="list">${list.map(contactCard).join("") || '<p class="empty">No contacts yet.</p>'}</div>`;
  }

  const METRICS = [
    ["companies_researched", "Companies researched"], ["applications_submitted", "Applications"],
    ["new_linkedin_connections", "New connections"], ["outreach_messages_sent", "Outreach sent"],
    ["networking_meetings_booked", "Meetings booked"], ["referrals_requested", "Referrals asked"],
    ["follow_ups_sent", "Follow-ups"], ["phone_screens", "Phone screens"], ["interviews", "Interviews"],
  ];

  function viewWeek() {
    setChrome("Week", "week");
    const w = state.weekly || {};
    const goals = w.goals || {};
    const weeks = (Array.isArray(w.weeks) ? w.weeks : []).slice().sort((a, b) => String(b.week_starting).localeCompare(String(a.week_starting))).slice(0, 6);
    const cell = (v, g) => v === undefined || v === null || v === "" ? "<td></td>"
      : `<td class="${g !== undefined ? (Number(v) >= Number(g) ? "hit" : "miss") : ""}">${esc(v)}</td>`;
    view.innerHTML = `
      <div class="table-wrap"><table class="week"><thead><tr><th>Measure</th><th>Goal</th>${weeks.map((x) => `<th>${esc(x.week_starting)}</th>`).join("")}</tr></thead>
      <tbody>${METRICS.map(([k, label]) => `<tr><td>${esc(label)}</td><td>${esc(goals[k] ?? "")}</td>${weeks.map((x) => cell(x[k], goals[k])).join("")}</tr>`).join("")}</tbody></table></div>
      ${weeks.length ? "" : '<p class="empty">No weeks logged yet. Ask Claude to add this week\'s numbers to weekly.yaml.</p>'}
      ${weeks.map((x) => (x.went_well || x.adjust || x.notes) ? `<details class="sec"><summary>${esc(x.week_starting)} reflection</summary><div class="md">
        ${x.went_well ? `<p><strong>Went well:</strong> ${esc(x.went_well)}</p>` : ""}${x.adjust ? `<p><strong>Adjust:</strong> ${esc(x.adjust)}</p>` : ""}${x.notes ? `<p>${esc(x.notes)}</p>` : ""}</div></details>` : "").join("")}`;
  }

  function viewSettings() {
    setChrome("Settings", "settings");
    view.innerHTML = `
      <form class="stack" id="cfg">
        <p class="small muted">Point this app at the private GitHub repo that holds your tracker files. Your token is stored only in this browser on this device and is sent only to api.github.com.</p>
        <label>GitHub owner <input type="text" name="owner" value="${esc(config.owner || "")}" autocapitalize="off" autocomplete="off" spellcheck="false" required></label>
        <label>Repository <input type="text" name="repo" value="${esc(config.repo || "")}" autocapitalize="off" autocomplete="off" spellcheck="false" required></label>
        <label>Branch <input type="text" name="branch" value="${esc(config.branch || "main")}" autocapitalize="off" autocomplete="off" spellcheck="false"></label>
        <label>Fine-grained access token <input type="password" name="token" value="" placeholder="${config.token ? "Saved (leave blank to keep)" : "github_pat_..."}" autocomplete="off"></label>
        <p class="small muted">Create one at GitHub → Settings → Developer settings → Fine-grained tokens. Repository access: only your tracker repo. Permissions: Contents read and write (read-only works too, but then you can't save notes from your phone). Set an expiry.</p>
        <button class="primary" type="submit">Save and load</button>
      </form>
      <div class="group-h">Other options</div>
      <div class="stack">
        <button class="secondary" id="demo">Try it with sample data</button>
        <button class="secondary" id="forget">Remove token and cached data from this device</button>
      </div>
      <p class="small muted">Current mode: ${esc(config.mode || "not set")}${config.mode === "github" ? ` (${esc(config.owner)}/${esc(config.repo)})` : ""}</p>`;
    $("#cfg").addEventListener("submit", (e) => {
      e.preventDefault();
      const f = e.target;
      const token = f.token.value.trim() || config.token;
      if (!token) return toast("A token is needed for a private repo");
      if (config.owner !== f.owner.value.trim() || config.repo !== f.repo.value.trim()) saveJSON(CACHE_KEY, {});
      config = { mode: "github", owner: f.owner.value.trim(), repo: f.repo.value.trim(), branch: f.branch.value.trim() || "main", token };
      saveJSON(CONFIG_KEY, config);
      location.hash = "#/roles";
      load();
    });
    $("#demo").addEventListener("click", () => { config = { mode: "demo" }; saveJSON(CONFIG_KEY, config); saveJSON(CACHE_KEY, {}); location.hash = "#/roles"; load(); });
    $("#forget").addEventListener("click", () => {
      try { localStorage.removeItem(CONFIG_KEY); localStorage.removeItem(CACHE_KEY); } catch { /* ignore */ }
      config = {}; state = { roles: [], companies: {}, contacts: [], weekly: null, sha: {} };
      toast("Removed from this device"); viewSettings();
    });
  }

  function viewSearch(q) {
    const needle = q.toLowerCase();
    const roles = state.roles.filter((r) => r.haystack.includes(needle));
    const cos = Object.values(state.companies).filter((c) => c.haystack.includes(needle));
    const people = state.contacts.filter((p) => JSON.stringify(p).toLowerCase().includes(needle));
    setChrome(`Search: ${q}`, "", false);
    view.innerHTML = `
      ${cos.length ? `<div class="group-h">Companies</div><div class="list">${cos.map(companyCard).join("")}</div>` : ""}
      ${roles.length ? `<div class="group-h">Roles</div><div class="tiles">${roles.map(roleCard).join("")}</div>` : ""}
      ${people.length ? `<div class="group-h">People</div><div class="list">${people.map(contactCard).join("")}</div>` : ""}
      ${!roles.length && !cos.length && !people.length ? '<p class="empty">Nothing matches.</p>' : ""}`;
  }

  function notFound() { setChrome("Not found", "", true); view.innerHTML = '<p class="empty">That item isn\'t in the loaded data. Try refreshing.</p>'; }

  // ---------- routing
  function route() {
    const q = $("#search").value.trim();
    const [, name, ...rest] = (location.hash || "#/roles").split("/");
    const arg = decodeURIComponent(rest.join("/"));
    if (q && !["settings"].includes(name)) return viewSearch(q);
    ({ roles: viewRoles, role: () => viewRole(arg), companies: viewCompanies, company: () => viewCompany(arg),
      contacts: viewContacts, week: viewWeek, settings: viewSettings }[name] || viewRoles)();
    view.focus({ preventScroll: true });
  }

  let toastTimer;
  function toast(msg) {
    const t = $("#toast");
    t.textContent = msg; t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { t.hidden = true; }, 3500);
  }

  window.addEventListener("hashchange", () => { window.scrollTo(0, 0); route(); });
  $("#search").addEventListener("input", route);
  $("#back").addEventListener("click", () => { if (history.length > 1) history.back(); else location.hash = "#/roles"; });
  $("#refresh").addEventListener("click", () => load());
  document.querySelectorAll(".tabs a").forEach((a) => a.addEventListener("click", () => { $("#search").value = ""; }));

  if ("serviceWorker" in navigator && location.protocol === "https:") {
    navigator.serviceWorker.register("sw.js").catch(() => { /* offline support is optional */ });
  }

  load({ quiet: true });
})();
