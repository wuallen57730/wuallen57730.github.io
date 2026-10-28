// lima-gitlog: draws the .entry articles in #content as `git log --graph`.
// Content lives in index.html; this file only reads it and renders the view.
(() => {
  "use strict";

  const KEY = "gitlog";
  const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const today = new Date();
  const NOW = today.getFullYear() * 12 + today.getMonth();

  const toMonth = (s) => {
    const [y, m] = s.split("-").map(Number);
    return y * 12 + m - 1;
  };
  const fmtMonth = (t) => {
    const m = Math.floor(t);
    return `${MONTHS[m % 12]} ${Math.floor(m / 12)}`;
  };
  const esc = (s) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

  const store = {
    get(k) {
      try { return localStorage.getItem(`${KEY}-${k}`); } catch { return null; }
    },
    set(k, v) {
      try { localStorage.setItem(`${KEY}-${k}`, v); } catch { /* storage blocked */ }
    },
  };

  // ---------- content ----------

  function readEntries() {
    return [...document.querySelectorAll("#content .entry")].map((el) => {
      const times = el.querySelectorAll(".when time");
      const start = toMonth(times[0].dateTime);
      const end = times[1] ? toMonth(times[1].dateTime) : el.hasAttribute("data-ongoing") ? null : start;
      return {
        id: el.dataset.id,
        kind: el.dataset.kind,
        title: el.querySelector("h3").textContent.trim(),
        titleHTML: el.querySelector("h3").innerHTML,
        when: el.querySelector(".when").textContent.trim(),
        meta: [".meta", ".where"].map((sel) => el.querySelector(sel)?.innerHTML.trim()).filter(Boolean).join(" · "),
        bullets: [...el.querySelectorAll("ul > li")].map((li) => ({
          html: li.innerHTML.trim(),
          short: li.dataset.short || li.textContent.trim(),
        })),
        tags: (el.querySelector(".tags")?.textContent ?? "").split(",").map((s) => s.trim()).filter(Boolean),
        start,
        end,
        ongoing: end === null,
      };
    });
  }

  // ---------- plain view table of contents: mark the section currently in view ----------

  function setupToc() {
    const links = [...document.querySelectorAll(".toc a")];
    const targets = links.map((a) => document.getElementById(a.hash.slice(1))).filter(Boolean);
    if (!("IntersectionObserver" in window) || !targets.length) return;
    const visible = new Set();
    const io = new IntersectionObserver((entries) => {
      for (const en of entries) {
        if (en.isIntersecting) visible.add(en.target);
        else visible.delete(en.target);
      }
      const current = targets.find((t) => visible.has(t));
      if (!current) return;
      for (const a of links) {
        if (a.hash === `#${current.id}`) a.setAttribute("aria-current", "true");
        else a.removeAttribute("aria-current");
      }
      // on small screens the toc is a horizontal row: keep the current link in view
      const nav = links[0].closest(".toc");
      const active = links.find((a) => a.hash === `#${current.id}`);
      if (nav.scrollWidth > nav.clientWidth) nav.scrollLeft = active.offsetLeft - nav.clientWidth / 2 + active.offsetWidth / 2;
    }, { rootMargin: "-80px 0px -60% 0px" });
    targets.forEach((t) => io.observe(t));
  }

  // ---------- chrome: theme + plain/fancy view ----------

  function setupChrome() {
    const root = document.documentElement;
    document.getElementById("theme-toggle").addEventListener("click", () => {
      const dark = root.dataset.theme
        ? root.dataset.theme === "dark"
        : matchMedia("(prefers-color-scheme: dark)").matches;
      root.dataset.theme = dark ? "light" : "dark";
      store.set("theme", root.dataset.theme);
    });

    const btn = document.getElementById("view-toggle");
    let plain = store.get("view") === "plain" || location.hash === "#plain";
    const apply = () => {
      document.body.classList.toggle("fancy", !plain);
      btn.textContent = plain ? "git view" : "plain view";
    };
    btn.addEventListener("click", () => {
      plain = !plain;
      store.set("view", plain ? "plain" : "fancy");
      apply();
    });
    apply();
  }

  // ---------- history model ----------

  // branch prefix per entry kind; edu and award commits live on main
  const SCOPE = { research: "research", work: "intern", oss: "oss", project: "project", other: "community" };
  // commit subjects use the "[Tag] message" style
  const TAG = { edu: "Edu", award: "Award", research: "Research", work: "Intern", oss: "OSS", project: "Project", other: "Community" };

  function fnv(str) {
    let h = 0x811c9dc5;
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 0x01000193);
    }
    return (h >>> 0).toString(16).padStart(8, "0");
  }
  const sha = (key) => [0, 1, 2, 3, 4].map((i) => fnv(`${key}#${i}`)).join("");
  const abbrev = (title) => (title.match(/\(([^)]+)\)\s*$/) || [null, title])[1];

  function buildHistory(entries) {
    const commits = [];
    const branches = [];
    const add = (c) => {
      c.sha = sha(c.key);
      commits.push(c);
      return c;
    };

    for (const e of entries) {
      if (e.kind === "edu") {
        add({ key: `${e.id}:start`, t: e.start + 0.5, kind: "edu", entry: e, subject: `[${TAG.edu}] enroll at ${abbrev(e.title)}` });
        if (!e.ongoing && e.end <= NOW) {
          add({ key: `${e.id}:end`, t: e.end + 0.5, kind: "edu", entry: e, subject: `[${TAG.edu}] graduate from ${abbrev(e.title)}` });
        }
        continue;
      }
      if (e.kind === "award") {
        add({
          key: e.id, t: e.start + 0.6, kind: "award", entry: e,
          subject: `[${TAG.award}] ${e.title}`, refs: [{ type: "tag", name: `tag: ${e.id}` }],
        });
        continue;
      }

      // one commit per experience on its own branch, merged back when it ends
      const name = `${SCOPE[e.kind]}/${e.id}`;
      const merged = !e.ongoing && e.end <= NOW;
      const b = { name, kind: e.kind, entry: e, commits: [] };
      branches.push(b);

      b.commits.push(add({ key: `${name}:0`, t: e.start + 0.05, kind: e.kind, branch: b, entry: e, subject: `[${TAG[e.kind]}] ${e.title}` }));
      if (merged) {
        b.merge = add({ key: `${name}:merge`, t: e.end + 0.95, kind: e.kind, merge: b, entry: e, subject: `Merge branch '${name}'` });
      } else {
        b.commits[b.commits.length - 1].refs = [{ type: "branch", name }];
      }
    }

    commits.sort((a, b) => b.t - a.t);
    commits.forEach((c, i) => (c.row = i));
    const mainline = commits.filter((c) => !c.branch);
    mainline[0].refs = [{ type: "head", name: "HEAD -> main" }, ...(mainline[0].refs || [])];

    // each branch forks from the newest main commit older than its first commit
    for (const b of branches) {
      b.parent = mainline.find((c) => c.t < b.commits[0].t) || mainline[mainline.length - 1];
    }

    // greedy lane assignment: a lane is reused once the previous branch on it has merged
    const laneEnd = [];
    [...branches].sort((a, b) => a.parent.t - b.parent.t || a.commits[0].t - b.commits[0].t).forEach((b) => {
      const from = b.parent.t;
      let lane = laneEnd.findIndex((end) => end < from - 0.3);
      if (lane === -1) lane = laneEnd.push(0) - 1;
      laneEnd[lane] = b.merge ? b.merge.t : Infinity;
      b.lane = lane + 1;
    });

    return { commits, branches, lanes: laneEnd.length };
  }

  // ---------- rendering ----------

  const ROW = 34;
  const LANE = 16;
  const PAD = 16;

  function renderLog(log, { commits, branches, lanes }) {
    const x = (lane) => PAD + lane * LANE;
    const y = (row) => row * ROW + ROW / 2;
    const x0 = x(0);
    let svg = "";

    const mainRows = commits.filter((c) => !c.branch).map((c) => c.row);
    svg += `<path class="edge k-main" data-kind="main" d="M${x0} ${y(mainRows[0])} V${y(mainRows[mainRows.length - 1])}"/>`;

    for (const b of branches) {
      const lx = x(b.lane);
      const fork = y(b.parent.row);
      const top = y(b.commits[b.commits.length - 1].row);
      let d = `M${x0} ${fork} C${x0} ${fork - ROW * 0.55} ${lx} ${fork - ROW * 0.45} ${lx} ${fork - ROW} V${top}`;
      if (b.merge) {
        const m = y(b.merge.row);
        d += ` V${m + ROW} C${lx} ${m + ROW * 0.45} ${x0} ${m + ROW * 0.55} ${x0} ${m}`;
      }
      svg += `<path class="edge k-${b.kind}" data-kind="${b.kind}" d="${d}"/>`;
    }

    for (const c of commits) {
      const cx = c.branch ? x(c.branch.lane) : x0;
      const cls = c.merge ? `merge k-${c.kind}` : c.branch ? `k-${c.kind}` : `k-${c.kind === "award" ? "award" : "main"}`;
      svg += `<circle class="dot ${cls}" data-kind="${c.kind}" data-row="${c.row}" cx="${cx}" cy="${y(c.row)}" r="${c.merge ? 4 : 4.5}"/>`;
    }

    const width = PAD * 2 + lanes * LANE;
    log.style.setProperty("--graph-w", `${width}px`);
    log.innerHTML =
      `<svg class="graph" width="${width}" height="${commits.length * ROW}" aria-hidden="true">${svg}</svg>` +
      commits.map((c) => `
        <button type="button" class="row" data-row="${c.row}" data-kind="${c.kind}">
          <span class="hash">${c.sha.slice(0, 7)}</span>
          ${c.refs ? `<span class="refs">${c.refs.map((r) => `<span class="ref ${r.type}">${esc(r.name)}</span>`).join("")}</span>` : ""}
          <span class="subject${c.merge ? " is-merge" : ""}">${esc(c.subject)}</span>
          <span class="date">${fmtMonth(c.t)}</span>
        </button>`).join("");
  }

  function showHTML(c, commits) {
    const e = c.entry;
    const refs = c.refs ? ` <span class="show-refs">(${c.refs.map((r) => esc(r.name)).join(", ")})</span>` : "";
    let merge = "";
    if (c.merge) {
      const parent = commits.slice(c.row + 1).find((p) => !p.branch);
      const tip = c.merge.commits[c.merge.commits.length - 1];
      merge = `<p><span class="kw">Merge:</span> ${parent ? parent.sha.slice(0, 7) : "0000000"} ${tip.sha.slice(0, 7)}</p>`;
    }
    const bullets = e.bullets.length
      ? `<ul>${e.bullets.map((b) => `<li>${b.html}</li>`).join("")}</ul>`
      : "";
    const diff = e.tags.length
      ? `<pre class="diff"><span class="d-meta">diff --git a/skills.txt b/skills.txt</span>
<span class="d-meta">@@ -0,0 +1,${e.tags.length} @@</span>
${e.tags.map((t) => `<span class="d-add">+${esc(t)}</span>`).join("\n")}</pre>`
      : "";

    return `
      <button type="button" class="show-close" aria-label="Close">×</button>
      <p class="show-cmd">$ git show ${c.sha.slice(0, 7)}</p>
      <p class="sha-line"><span class="kw">commit</span> <span class="sha">${c.sha}</span>${refs}</p>
      ${merge}
      <p><span class="kw">Author:</span> Lima Wu &lt;ywugd@connect.ust.hk&gt;</p>
      <p><span class="kw">Date:</span>   ${esc(e.when)}</p>
      <div class="msg">
        <p class="msg-subject">${esc(c.subject)}</p>
        <h3>${e.titleHTML}</h3>
        ${e.meta ? `<p class="meta">${e.meta}</p>` : ""}
        ${bullets}
      </div>
      ${diff}`;
  }

  // ---------- interaction ----------

  const FILTERS = [
    ["all", "all"], ["research", "research"], ["oss", "oss"], ["work", "intern"],
    ["project", "project"], ["award", "award"], ["edu", "edu"], ["other", "community"],
  ];

  function init() {
    setupChrome();
    setupToc();

    const history = buildHistory(readEntries());
    const log = document.getElementById("log");
    const show = document.getElementById("show");
    const filters = document.getElementById("filters");
    renderLog(log, history);

    const rows = [...log.querySelectorAll(".row")];
    const dots = [...log.querySelectorAll(".dot")];
    let current = -1;

    function select(i, { focus = false, open = true } = {}) {
      i = Math.max(0, Math.min(rows.length - 1, i));
      if (current >= 0) {
        rows[current].classList.remove("selected");
        dots[current].classList.remove("selected");
      }
      current = i;
      rows[i].classList.add("selected");
      dots[i].classList.add("selected");
      show.innerHTML = showHTML(history.commits[i], history.commits);
      show.scrollTop = 0;
      if (open) show.classList.add("open");
      if (focus) {
        rows[i].focus();
        rows[i].scrollIntoView({ block: "nearest" });
      }
    }

    log.addEventListener("click", (ev) => {
      const row = ev.target.closest(".row");
      if (row) select(Number(row.dataset.row));
    });
    show.addEventListener("click", (ev) => {
      if (ev.target.closest(".show-close")) show.classList.remove("open");
    });

    document.addEventListener("keydown", (ev) => {
      if (!document.body.classList.contains("fancy") || ev.target.matches("input, textarea")) return;
      if (ev.ctrlKey || ev.metaKey || ev.altKey) return;
      const inLog = log.contains(document.activeElement);
      if (ev.key === "j" || (inLog && ev.key === "ArrowDown")) select(current + 1, { focus: true });
      else if (ev.key === "k" || (inLog && ev.key === "ArrowUp")) select(current - 1, { focus: true });
      else if (ev.key === "Escape") show.classList.remove("open");
      else return;
      ev.preventDefault();
    });

    // only offer filters for kinds that actually have entries
    const present = new Set(history.commits.map((c) => c.kind));
    filters.innerHTML = FILTERS.filter(([kind]) => kind === "all" || present.has(kind)).map(([kind, label]) =>
      `<button type="button" data-filter="${kind}" style="--dot: var(--c-${kind === "all" ? "main" : kind})" aria-pressed="${kind === "all"}">${label}</button>`
    ).join("");
    filters.addEventListener("click", (ev) => {
      const btn = ev.target.closest("button");
      if (!btn) return;
      const f = btn.dataset.filter;
      filters.querySelectorAll("button").forEach((b) => b.setAttribute("aria-pressed", String(b === btn)));
      log.querySelectorAll("[data-kind]").forEach((el) => {
        el.classList.toggle("dim", f !== "all" && el.dataset.kind !== "main" && el.dataset.kind !== f);
      });
    });

    select(0, { open: false });
  }

  init();
})();
