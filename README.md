# Lima Wu — personal site (git log-like)

Personal homepage of Yu-Chen (Lima) WU, Computer Science undergraduate at HKUST.
Experience is drawn as `git log --graph --all --decorate`: education and awards live on
`main`, and every research project, internship and open-source effort is a branch with one
commit, merged back when it ends. Click a commit to see it as `git show`.

There is also a tiny git shell above the graph: try `help`, `git status`, `git branch -v`,
`git show <hash>`, `git checkout <branch>` or `git blame` (Tab completes, `/` focuses it).

**Website:** https://wuallen57730.github.io/limaWU-website/

## How it works

- `index.html` holds all content as plain, semantic HTML inside `<main id="content">`.
  With JavaScript off (or for search engines) it reads as a normal résumé.
- `app.js` reads the `.entry` articles, builds commits and branches, and renders the
  graph (SVG) and the commit list. It never contains content of its own.
- **plain view** in the top bar switches back to the plain layout; `#plain` in the URL does
  the same.

No dependencies, no build step.

## Editing

Add or change an `<article class="entry">` in `index.html`:

```html
<article class="entry" data-id="kuberay" data-kind="oss" data-ongoing>
  <h3>Ray / KubeRay</h3>
  <p class="when"><time datetime="2026-06">Jun 2026</time> – Present</p>
  <p class="meta">Role, supervisor</p>
  <p class="where">Location or organisation</p>
  <ul>
    <li>Full bullet text.</li>
  </ul>
  <p class="tags">Go, Helm</p>
</article>
```

- `data-kind`: `research`, `oss`, `work`, `edu`, `award`, `project` or `other`.
- One `<time>` is a point in time; two are a start and end; `data-ongoing` means "Present".
- Commit subjects use the `[Tag] message` style, e.g. `[Research] Agentic RL on AReaL 2.0` or `[Award] …`; the full entry appears in `git show`.
- Add `data-commit="message"` (and optionally `data-date="YYYY-MM"`) to a bullet to give it
  its own commit on the branch (e.g. the TAIONE fellowship on `oss/kuberay`, Oct 2026).

## Preview

Open `index.html` directly, or run `python -m http.server 8000` in this folder.

## SEO

Canonical URL, Open Graph / Twitter cards, `ProfilePage` + `Person` + `WebSite` JSON-LD,
`sitemap.xml` and `robots.txt` all point to the URL above. Update them together if the site
moves, and bump `<lastmod>` in `sitemap.xml` after meaningful content changes.

## License

- **Code** (the HTML structure, `style.css` and `app.js`): [MIT](LICENSE). Feel free to fork it
  and build your own git log homepage.
- **Content**: the text about me in `index.html` (biography, experience, awards, coursework and
  other personal details, including the meta tags and structured data) and the photo in `assets/`
  are © Yu-Chen (Lima) WU. All rights reserved: they are not covered by the MIT License and may
  not be reused. If you fork this, please replace them with your own.
