# eldest-boy

Static site for the band Eldest Boy (Justin + Steve Saputo). Plain HTML/CSS/JS with no
build step, no framework, and no package manager — what is in the repo is what ships.

## Pushing to main deploys to eldestboy.com. There is no staging.

`.github/workflows/pages.yml` runs on every push to `main` and publishes to GitHub Pages,
which serves the custom domain in `CNAME`. A merged PR is a live change to a public site.

**Ask before pushing to main.** Work on a branch and open a PR if the change is anything
more than a typo.

## The workflow uploads `path: .` — every tracked file is published

The Pages artifact is the whole repository, not a build output. Three consequences that
have already cost real work:

- **Anything you `git add` becomes publicly downloadable**, whether or not a page links to it.
- **Anything tracked counts toward the deploy**, so a large asset committed "just to keep it
  somewhere" slows the site for everyone. PRs #3–#5 were spent undoing exactly that: first
  load went 3.2 MB → 1.1 MB, and an 11 MB WAV was dropped from the deploy.
- **`.gitignore` is load-bearing, not tidiness.** It excludes audio masters and stems for
  this reason, and says so. Keep masters on disk; do not track them to "back them up" — that
  publishes them. The repo is ~27 MB tracked against ~136 MB on disk, and the difference is
  mostly history from assets that were once tracked and later removed.

Before adding any binary, ask whether the site actually loads it. If not, it does not belong
in the repo.

## Pages

| file | what it is |
|---|---|
| `index.html` | the main site, including THE ARCHIVE section driven by `archive-data.js` |
| `caterpillar.html` | the Caterpillar Sim — the two `TwoPeople_PolyReduce` MP4s (10.2 MB and 6.2 MB) are its heaviest assets and the largest things shipped |
| `chat.html` | AIM-styled chat UI — see below |
| `CorrectSpeed.html` | standalone page |

## `chat.html` cannot work on GitHub Pages as written

It connects to `wss://` + `location.host` — a WebSocket on the same origin serving the page.
GitHub Pages serves static files only and cannot accept a WebSocket, so on eldestboy.com the
connection fails and the reconnect loop backs off to its 10 s ceiling.

That is an observation from reading the code, not a statement about intent. It works if the
page is served by something that also speaks WebSocket. If a chat server exists elsewhere,
the URL needs to point at it rather than at `location.host`; if the page is aspirational,
that is worth a comment in the file so the next reader does not re-derive this.

## Conventions

- No build, no bundler, no `npm install`. Edit the HTML directly and open it in a browser.
- Assets are WebP/MP4/M4A where possible — the repo has been deliberately converted away from
  PNG and WAV to cut deploy weight. Match that when adding anything.
- Commits here go through PRs (#3–#6 are the recent history), which is worth keeping given
  that main is production.
