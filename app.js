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
          commit: li.dataset.commit || "", // set → this bullet gets its own commit on the branch
          date: li.dataset.date || "", // optional YYYY-MM for that commit
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

  function setupChrome(onToggle) {
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
      onToggle(plain);
    });
    apply();
    return plain;
  }

  // ---------- history model ----------

  // branch prefix per entry kind; edu and award commits live on main
  const SCOPE = { research: "research", work: "intern", oss: "oss", project: "project", other: "community" };
  // commit subjects use the "[Tag] message" style
  const TAG = { edu: "Edu", award: "Award", research: "Research", work: "Intern", oss: "Open Source", project: "Project", other: "Community" };

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
      // bullets marked with data-commit become extra commits (at data-date, else right after the first one)
      e.bullets.forEach((bl, i) => {
        if (!bl.commit) return;
        b.commits.push(add({
          key: `${name}:${i + 1}`, t: bl.date ? toMonth(bl.date) + 0.5 + i * 0.01 : e.start + 0.1 + i * 0.01,
          kind: e.kind, branch: b, entry: e, bullet: i, subject: `[${TAG[e.kind]}] ${bl.commit}`,
        }));
      });
      b.commits.sort((x, y) => x.t - y.t);
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

  // the branch a commit belongs to; a merge commit counts as part of the branch it merges
  const branchOf = (c) => (c.branch || c.merge || { name: "main" }).name;

  function renderLog(log, { commits, branches, lanes }) {
    const x = (lane) => PAD + lane * LANE;
    const y = (row) => row * ROW + ROW / 2;
    const x0 = x(0);
    let svg = "";

    const mainRows = commits.filter((c) => !c.branch).map((c) => c.row);
    svg += `<path class="edge k-main" data-kind="main" data-branch="main" d="M${x0} ${y(mainRows[0])} V${y(mainRows[mainRows.length - 1])}"/>`;

    for (const b of branches) {
      const lx = x(b.lane);
      const fork = y(b.parent.row);
      const top = y(b.commits[b.commits.length - 1].row);
      let d = `M${x0} ${fork} C${x0} ${fork - ROW * 0.55} ${lx} ${fork - ROW * 0.45} ${lx} ${fork - ROW} V${top}`;
      if (b.merge) {
        const m = y(b.merge.row);
        d += ` V${m + ROW} C${lx} ${m + ROW * 0.45} ${x0} ${m + ROW * 0.55} ${x0} ${m}`;
      }
      svg += `<path class="edge k-${b.kind}" data-kind="${b.kind}" data-branch="${b.name}" d="${d}"/>`;
    }

    for (const c of commits) {
      const cx = c.branch ? x(c.branch.lane) : x0;
      const cls = c.merge ? `merge k-${c.kind}` : c.branch ? `k-${c.kind}` : `k-${c.kind === "award" ? "award" : "main"}`;
      svg += `<circle class="dot ${cls}" data-kind="${c.kind}" data-branch="${branchOf(c)}" data-row="${c.row}" cx="${cx}" cy="${y(c.row)}" r="${c.merge ? 4 : 4.5}"/>`;
    }

    const width = PAD * 2 + lanes * LANE;
    log.style.setProperty("--graph-w", `${width}px`);
    log.innerHTML =
      `<svg class="graph" width="${width}" height="${commits.length * ROW}" aria-hidden="true">${svg}</svg>` +
      commits.map((c) => `
        <button type="button" class="row" data-row="${c.row}" data-kind="${c.kind}" data-branch="${branchOf(c)}" style="--i: ${c.row}">
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
    // a data-commit bullet shows only on its own commit; every other commit shows the rest
    const shown = c.bullet == null ? e.bullets.filter((b) => !b.commit) : [e.bullets[c.bullet]];
    const bullets = shown.length
      ? `<ul>${shown.map((b) => `<li>${b.html}</li>`).join("")}</ul>`
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
      <p><span class="kw">Date:</span>   ${esc(c.bullet != null && e.bullets[c.bullet].date ? fmtMonth(toMonth(e.bullets[c.bullet].date)) : e.when)}</p>
      <div class="msg">
        <p class="msg-subject">${esc(c.subject)}</p>
        <h3>${e.titleHTML}</h3>
        ${e.meta ? `<p class="meta">${e.meta}</p>` : ""}
        ${bullets}
      </div>
      ${diff}`;
  }

  // ---------- prompt: the command in the top bar mirrors what the visitor does ----------

  const LOG_ALL = "git log --graph --all --decorate";

  // the real git command that would show what a filter shows
  function filterCommand(kind) {
    if (kind === "all") return LOG_ALL;
    if (kind === "award" || kind === "edu") return `git log --first-parent main --grep='\\[${TAG[kind]}\\]'`;
    return `git log --graph --decorate --branches='${SCOPE[kind]}/*'`;
  }

  function createPrompt() {
    const cmd = document.querySelector(".p-cmd");
    const branches = document.querySelectorAll(".p-branch, .c-branch"); // top bar + console prompt
    let current = "main";
    let timer = 0;
    let target = cmd.textContent;

    // show the full command now and stop the caret
    const settle = () => {
      clearTimeout(timer);
      cmd.textContent = target;
      cmd.classList.remove("typing");
    };
    // type `text` one character at a time, then call `then` (by default: settle)
    const type = (text, { delay = 0, min = 6, jitter = 10, then = settle } = {}) => {
      clearTimeout(timer);
      target = text;
      if (matchMedia("(prefers-reduced-motion: reduce)").matches) {
        settle();
        return;
      }
      let n = 0;
      cmd.textContent = "";
      cmd.classList.add("typing");
      const tick = () => {
        cmd.textContent = text.slice(0, ++n);
        if (n < text.length) timer = setTimeout(tick, min + Math.random() * jitter);
        else then();
      };
      timer = setTimeout(tick, delay);
    };
    return {
      type,
      settle,
      set(text) {
        target = text;
        settle();
      },
      get text() {
        return target;
      },
      branch(name) {
        if (name === undefined) return current;
        current = name;
        branches.forEach((el) => (el.textContent = `(${name})`));
        return name;
      },
    };
  }

  // ---------- intro: type the command, then print the log line by line ----------

  const ROW_MS = 32; // delay between printed rows; keep in sync with .intro.printed .row in CSS

  function playIntro(view, rowCount, prompt) {
    if (!document.body.classList.contains("fancy")) return;
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    let timer = 0;
    view.style.setProperty("--print-ms", `${rowCount * ROW_MS}ms`);
    view.classList.add("intro");

    const cleanup = () => {
      window.removeEventListener("keydown", skip);
      window.removeEventListener("pointerdown", skip);
    };
    const done = () => view.classList.remove("intro", "printed");
    // "press Enter": stop the caret and let the CSS print the rows one by one
    const print = () => {
      cleanup();
      prompt.settle();
      view.classList.add("printed");
      timer = setTimeout(done, rowCount * ROW_MS + 600);
    };
    // any key or click shows everything at once
    function skip() {
      clearTimeout(timer);
      cleanup();
      prompt.settle();
      done();
    }
    window.addEventListener("keydown", skip);
    window.addEventListener("pointerdown", skip);
    prompt.type(prompt.text, { delay: 250, min: 14, jitter: 26, then: () => (timer = setTimeout(print, 250)) });
  }

  // ---------- console: a tiny git-flavoured shell over the same history ----------

  const isoOf = (t) => {
    const m = Math.floor(t);
    return `${Math.floor(m / 12)}-${String((m % 12) + 1).padStart(2, "0")}`;
  };
  const KIND_OF_SCOPE = Object.fromEntries(Object.entries(SCOPE).map(([kind, scope]) => [scope, kind]));
  const KIND_OF_TAG = Object.fromEntries(Object.entries(TAG).map(([kind, tag]) => [tag.toLowerCase(), kind]));

  function setupConsole({ history, prompt, log, select, applyFilter, applyBranch, setLogCmd }) {
    const out = document.getElementById("console-out");
    const input = document.getElementById("console-in");
    const chips = document.getElementById("console-chips");
    const { commits, branches } = history;
    const head = commits.find((c) => c.refs?.some((r) => r.type === "head"));
    const tags = commits.filter((c) => c.refs?.some((r) => r.type === "tag"));
    const typed = [];
    let walk = 0;

    // ----- output helpers -----
    const line = (html, cls = "") => `<div class="c-line${cls ? ` ${cls}` : ""}">${html}</div>`;
    const k = (s) => `<span class="c-k">${esc(s)}</span>`;
    const hash = (c) => `<span class="c-hash">${c.sha.slice(0, 7)}</span>`;
    const refsOf = (c) => (c.refs ? ` <span class="c-ref">(${c.refs.map((r) => esc(r.name)).join(", ")})</span>` : "");
    const write = (html) => {
      const block = document.createElement("div");
      block.className = "c-block";
      block.innerHTML = html;
      out.append(block);
      out.scrollTop = out.scrollHeight;
    };
    const echo = (raw) => write(line(`<span class="c-ps1">lima@hkust:~/lima-wu (${esc(prompt.branch())}) $</span> ${esc(raw)}`, "c-echo"));
    const scrollToLog = () => log.scrollIntoView({ block: "nearest", behavior: "smooth" });

    // ----- refs: HEAD, a branch name, a tag, or a hash prefix -----
    const branchByName = (name) => branches.find((b) => b.name === name);
    function resolve(ref = "HEAD") {
      if (ref === "HEAD" || ref === "main") return head;
      const b = branchByName(ref);
      if (b) return b.commits[b.commits.length - 1];
      const tag = tags.find((c) => c.refs.some((r) => r.name === `tag: ${ref.replace(/^tag:\s*/, "")}`));
      if (tag) return tag;
      return ref.length >= 4 ? commits.find((c) => c.sha.startsWith(ref.toLowerCase())) : undefined;
    }
    const refNames = () => ["HEAD", "main", ...branches.map((b) => b.name), ...tags.map((c) => c.refs.find((r) => r.type === "tag").name.slice(5))];

    // ----- content straight from the page, so nothing is duplicated -----
    const profile = () => {
      const p = document.querySelector("#content .profile");
      return line(`<strong>${esc(p.querySelector("h1").textContent)}</strong>`) +
        line(esc(p.querySelector(".lede").textContent.replace(/\s+/g, " ").trim()), "c-dim");
    };
    const contact = () => line([...document.querySelectorAll("#content .profile .links li")].map((li) => li.innerHTML).join(" · "));
    const skills = () => [...document.querySelectorAll("#skills dt")]
      .map((dt) => line(`${k(dt.textContent.padEnd(24))}${esc(dt.nextElementSibling.textContent.replace(/\s+/g, " ").trim())}`))
      .join("");
    const courses = () => [...document.querySelectorAll("#coursework .courses li")]
      .map((li) => line(esc(li.textContent.replace(/\s+/g, " ").trim())))
      .join("");
    const inProgress = () => branches.filter((b) => !b.merge)
      .map((b) => ({ name: b.name, note: b.entry.title, until: b.entry.ongoing ? "" : `, until ${isoOf(b.entry.end)}` }))
      .concat(commits.filter((c) => c.kind === "edu" && !c.entry.ongoing && c.entry.end > NOW).map((c) => ({ name: `edu/${c.entry.id}`, note: c.entry.title, until: `, until ${isoOf(c.entry.end)}` })))
      .filter((v, i, all) => all.findIndex((w) => w.name === v.name) === i);

    // ----- git subcommands -----
    const GIT = {
      log(args) {
        const oneline = args.includes("--oneline");
        const branchArg = args.find((a) => branchByName(a));
        const branchesArg = args.find((a) => a.startsWith("--branches="));
        const grepArg = args.find((a) => a.startsWith("--grep="));
        let kind = "all";
        if (branchesArg) kind = KIND_OF_SCOPE[branchesArg.slice(11).replace(/['"]/g, "").split("/")[0]] || "all";
        if (grepArg) kind = KIND_OF_TAG[(grepArg.match(/\[(\w+)/) || [])[1]?.toLowerCase()] || "all";
        const picked = commits.filter((c) => (branchArg ? branchOf(c) === branchArg : kind === "all" || c.kind === kind));
        if (oneline) return picked.map((c) => line(`${hash(c)}${refsOf(c)} ${esc(c.subject)}`)).join("");
        if (branchArg) applyBranch(branchArg);
        else applyFilter(kind);
        setLogCmd(`git ${["log", ...args].join(" ")}`);
        scrollToLog();
        return line(`showing ${picked.length} commit${picked.length === 1 ? "" : "s"} in the graph below ↓`, "c-dim");
      },
      show(args) {
        const ref = args.find((a) => !a.startsWith("-")) || "HEAD";
        const c = resolve(ref);
        if (!c) return line(`fatal: ambiguous argument '${esc(ref)}': unknown revision`, "c-err");
        select(c.row);
        log.querySelector(`.row[data-row="${c.row}"]`).scrollIntoView({ block: "nearest", behavior: "smooth" });
        return line(`${hash(c)} ${esc(c.subject)}`) + line("opened in the git show panel →", "c-dim");
      },
      branch(args) {
        const verbose = args.includes("-v") || args.includes("-vv");
        const sorted = [...branches].sort((a, b) => b.commits[b.commits.length - 1].t - a.commits[a.commits.length - 1].t);
        const width = Math.max(...branches.map((b) => b.name.length));
        const row = (name, c, star) => line(`${star ? '<span class="c-ok">* ' : "  "}${esc(verbose ? name.padEnd(width) : name)}${star ? "</span>" : ""}${verbose ? `  ${hash(c)} ${esc(c.subject)}` : ""}`);
        const current = prompt.branch();
        return row("main", head, current === "main") + sorted.map((b) => row(b.name, b.commits[b.commits.length - 1], current === b.name)).join("");
      },
      tag(args) {
        const notes = args.some((a) => a.startsWith("-n"));
        return tags.map((c) => {
          const name = c.refs.find((r) => r.type === "tag").name.slice(5);
          return line(`${k(name.padEnd(10))}${notes ? esc(c.entry.title) : ""}`);
        }).join("");
      },
      checkout(args) {
        const name = args.find((a) => !a.startsWith("-"));
        if (args.includes("-b")) return line("fatal: this history is read-only. New branches are welcome in real life, though: try contact", "c-err");
        if (!name) return line("usage: git checkout &lt;branch&gt;", "c-dim");
        if (name === "main") {
          applyFilter("all");
          return line("Switched to branch 'main'");
        }
        if (!branchByName(name)) return line(`error: pathspec '${esc(name)}' did not match any branch known to git`, "c-err");
        applyBranch(name);
        setLogCmd(`git log --graph --decorate ${name}`);
        scrollToLog();
        return line(`Switched to branch '${esc(name)}'`) + line("tip: git checkout main to see everything again", "c-dim");
      },
      status() {
        const busy = inProgress();
        return line(`On branch ${esc(prompt.branch())}`) +
          line("Your branch is up to date with 'origin/main'.") +
          line("") +
          line("Changes not staged for commit:") +
          busy.map((b) => line(`        <span class="c-err">modified:   ${esc(b.name.padEnd(18))}</span> <span class="c-dim">${esc(b.note)}${esc(b.until)}</span>`)).join("") +
          line("") +
          line('no changes added to commit (still working on these; use "contact" to talk about them)', "c-dim");
      },
      blame() {
        const chronological = commits.filter((c) => !c.merge).sort((a, b) => a.t - b.t);
        return chronological.map((c, i) => line(`${hash(c)} (Lima WU ${isoOf(c.t)} ${String(i + 1).padStart(2)}) ${esc(c.subject)}`)).join("") +
          line("every line: Lima WU. no co-authors to blame.", "c-dim");
      },
      commit: () => line("nothing to commit, working tree clean") + line("…but always open to new opportunities:", "c-dim") + contact(),
      push(args) {
        if (args.some((a) => a === "-f" || a === "--force" || a === "--force-with-lease")) {
          return line(" ! [rejected]        main -> main (protected branch: real life)", "c-err") +
            line("error: failed to push some refs to 'origin/the-past'", "c-err") +
            line("hint: you can't force-push over things that actually happened.", "c-dim") +
            line(`hint: make new history instead: ${k("git commit")}`, "c-dim");
        }
        return line("Everything up-to-date");
      },
      pull: () => line("Already up to date."),
      fetch: () => line("Already up to date."),
      reset: () => line("fatal: no regrets found to reset. HEAD stays where it is.", "c-err"),
      rebase: () => line("error: cannot rebase: these commits are already public (and on LinkedIn).", "c-err"),
      switch: (args) => GIT.checkout(args),
      help: () => COMMANDS.help(),
    };
    const GIT_SUBS = ["log", "show", "branch", "tag", "checkout", "switch", "status", "blame", "commit", "push"];

    // ----- shell commands -----
    const COMMANDS = {
      help: () =>
        line("a tiny git shell over my history. try:", "c-dim") +
        [
          ["git log [--oneline]", "the history (--oneline prints it here)"],
          ["git show <hash|branch|tag>", "open one commit in the panel"],
          ["git branch [-v]", "every branch: one per role"],
          ["git tag [-n]", "every tag: one per award"],
          ["git checkout <branch>", "focus the graph on one branch (main = all)"],
          ["git status", "what is still in progress"],
          ["git blame", "who wrote all this"],
          ["whoami · contact", "the short bio · email, GitHub, LinkedIn"],
          ["ls · cat <file>", "README.md, skills.txt, coursework/"],
          ["theme · plain · clear · history", ""],
        ].map(([cmd, what]) => line(`${k(cmd.padEnd(28))}${esc(what)}`)).join("") +
        line("Tab autocompletes · ↑/↓ recall earlier commands · / focuses this prompt. some commands are undocumented, as is tradition.", "c-dim"),
      git(args) {
        const [sub, ...rest] = args;
        if (!sub || sub === "--help") return COMMANDS.help();
        const fn = GIT[sub];
        if (!fn) return line(`git: '${esc(sub)}' is not a git command. See 'git --help'.`, "c-err");
        return fn(rest);
      },
      whoami: () => profile() + contact(),
      contact: () => contact(),
      ls(args) {
        if ((args[0] || "").startsWith("coursework")) return courses();
        return line(`${k("README.md")}  ${k("skills.txt")}  ${k("coursework/")}`);
      },
      cat(args) {
        const file = args[0] || "";
        if (file === "README.md") {
          document.getElementById("view-toggle").click();
          return "";
        }
        if (file === "skills.txt") return skills();
        if (file.startsWith("coursework")) return line(`cat: ${esc(file)}: Is a directory (try ls coursework)`, "c-err");
        return line(`cat: ${esc(file || "")}: No such file or directory`, "c-err");
      },
      plain: () => COMMANDS.cat(["README.md"]),
      theme() {
        document.getElementById("theme-toggle").click();
        return line("theme switched. same history, new lighting.", "c-dim");
      },
      clear() {
        out.innerHTML = "";
        return "";
      },
      history: () => (typed.length ? typed.map((t, i) => line(`${String(i + 1).padStart(4)}  ${esc(t)}`)).join("") : line("no commands yet. the only empty log on this page.", "c-dim")),
      sudo: () => line("lima is not in the sudoers file. This incident will be reported.", "c-err"),
      rm: () => line("rm: refusing to remove that: it's someone's life story", "c-err"),
      exit: () => line("exit status 0: nothing went wrong, so nobody gets to leave. (type plain for the plain view)", "c-dim"),
      vim: () => line("you are now stuck in vim. (just kidding: there is no vim here.)", "c-dim"),
    };

    function run(raw) {
      const trimmed = raw.trim();
      if (!trimmed) return;
      echo(trimmed);
      typed.push(trimmed);
      walk = typed.length;
      const [name, ...args] = trimmed.split(/\s+/);
      const fn = COMMANDS[name.toLowerCase()];
      if (!fn) {
        // git-style "did you mean": a command sharing the first two letters, else help
        const guess = Object.keys(COMMANDS).find((c) => c.startsWith(name.slice(0, 2).toLowerCase())) || "help";
        write(line(`${esc(name)}: command not found`, "c-err") + line(`did you mean ${k(guess)}?`, "c-dim"));
        return;
      }
      const html = fn(args);
      if (html) write(html);
      if (name !== "clear") prompt.set(trimmed); // the top bar always shows the last command
    }

    // ----- tab completion: commands, git subcommands, then refs -----
    function complete() {
      const value = input.value;
      const parts = value.split(/\s+/);
      let pool;
      if (parts.length === 1) pool = [...Object.keys(COMMANDS)];
      else if (parts[0] === "git" && parts.length === 2) pool = GIT_SUBS;
      else if (parts[0] === "git" && ["show", "checkout", "switch", "log"].includes(parts[1])) pool = refNames();
      else if (parts[0] === "cat" || parts[0] === "ls") pool = ["README.md", "skills.txt", "coursework/"];
      else return;
      const word = parts[parts.length - 1];
      const hits = pool.filter((p) => p.startsWith(word));
      if (!hits.length) return;
      if (hits.length === 1) {
        parts[parts.length - 1] = hits[0];
        input.value = `${parts.join(" ")}${hits[0].endsWith("/") ? "" : " "}`;
        return;
      }
      // several matches: extend to the common prefix and list them, like bash
      let common = hits[0];
      for (const h of hits) while (!h.startsWith(common)) common = common.slice(0, -1);
      parts[parts.length - 1] = common;
      input.value = parts.join(" ");
      write(line(hits.map((h) => esc(h)).join("   "), "c-dim"));
    }

    input.addEventListener("keydown", (ev) => {
      if (ev.key === "Enter") {
        run(input.value);
        input.value = "";
      } else if (ev.key === "ArrowUp") {
        if (walk > 0) input.value = typed[--walk];
      } else if (ev.key === "ArrowDown") {
        walk = Math.min(typed.length, walk + 1);
        input.value = typed[walk] || "";
      } else if (ev.key === "Tab") {
        complete();
      } else if (ev.key === "l" && ev.ctrlKey) {
        out.innerHTML = "";
      } else if (ev.key === "Escape") {
        input.blur();
        return;
      } else {
        return;
      }
      ev.preventDefault();
    });

    // "/" from anywhere jumps to the shell (the git view's own j/k keys still work elsewhere)
    document.addEventListener("keydown", (ev) => {
      if (ev.key !== "/" || ev.target.matches("input, textarea") || !document.body.classList.contains("fancy")) return;
      ev.preventDefault();
      input.focus();
    });
    document.querySelector(".prompt")?.addEventListener("click", () => input.focus());

    // quick commands for touch screens, so nobody has to summon a keyboard
    const QUICK = ["help", "whoami", "git status", "git branch -v", "git tag -n", "git log --oneline", "git blame"];
    chips.innerHTML = QUICK.map((c) => `<button type="button" data-cmd="${c}">${c}</button>`).join("");
    chips.addEventListener("click", (ev) => {
      const btn = ev.target.closest("button");
      if (btn) run(btn.dataset.cmd);
    });

    // boot message: a short tutorial, the way a shell greets you
    write(
      line(`this page is a git repo of my life. run ${k("git status")} to see what I'm working on right now, or ${k("help")} for the full list.`) +
      line("Tab autocompletes · ↑/↓ recall commands · press / anywhere to type here · no keyboard? tap a command below", "c-dim") +
      line(`(warning: ${k("git push --force")} is disabled. my past self already tried.)`, "c-dim")
    );
  }

  // ---------- interaction ----------

  const FILTERS = [
    ["all", "all"], ["research", "research"], ["oss", "oss"], ["work", "intern"],
    ["project", "project"], ["award", "award"], ["edu", "edu"], ["other", "community"],
  ];

  function init() {
    const prompt = createPrompt();
    let logCmd = LOG_ALL; // last log command, restored when leaving plain view
    const startPlain = setupChrome((plain) => {
      prompt.branch("main");
      prompt.type(plain ? "cat README.md" : logCmd);
    });
    if (startPlain) prompt.set("cat README.md");
    setupToc();

    const history = buildHistory(readEntries());
    const log = document.getElementById("log");
    const show = document.getElementById("show");
    const filters = document.getElementById("filters");
    renderLog(log, history);

    const rows = [...log.querySelectorAll(".row")];
    const dots = [...log.querySelectorAll(".dot")];
    let current = -1;

    function select(i, { focus = false, open = true, announce = true } = {}) {
      i = Math.max(0, Math.min(rows.length - 1, i));
      if (announce) {
        const c = history.commits[i];
        prompt.branch(c.branch ? c.branch.name : "main");
        prompt.type(`git show ${c.sha.slice(0, 7)}`);
      }
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
    // dim everything outside one kind ("all" clears it)
    function applyFilter(f) {
      logCmd = filterCommand(f);
      prompt.branch("main");
      filters.querySelectorAll("button").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.filter === f)));
      log.querySelectorAll("[data-kind]").forEach((el) => {
        el.classList.toggle("dim", f !== "all" && el.dataset.kind !== "main" && el.dataset.kind !== f);
      });
    }
    // dim everything outside one branch, like `git checkout <branch>`
    function applyBranch(name) {
      prompt.branch(name);
      filters.querySelectorAll("button").forEach((b) => b.setAttribute("aria-pressed", "false"));
      log.querySelectorAll("[data-branch]").forEach((el) => {
        el.classList.toggle("dim", el.dataset.kind !== "main" && el.dataset.branch !== name);
      });
    }
    filters.addEventListener("click", (ev) => {
      const btn = ev.target.closest("button");
      if (!btn) return;
      applyFilter(btn.dataset.filter);
      prompt.type(logCmd);
    });

    setupConsole({
      history,
      prompt,
      log,
      select: (row) => select(row, { announce: false }),
      applyFilter,
      applyBranch,
      setLogCmd: (cmd) => (logCmd = cmd),
    });

    select(0, { open: false, announce: false });
    playIntro(document.getElementById("log-view"), rows.length, prompt);
  }

  init();
})();
