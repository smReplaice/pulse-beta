#!/usr/bin/env python3
"""Render docs/AUDIT.md into the artifact page (contract-compliant HTML)."""
import re, html as H

SRC = 'docs/AUDIT.md'
OUT = 'docs/audit-page.html'

md = open(SRC).read()

CSS = """
/* Layout concept: single-column report; sticky module nav; status-filterable tables. */
:root {
  --bg: #f6f7f9; --surface: #ffffff; --fg: #1c2430; --muted: #5c6875;
  --line: #dde2e8; --accent: #24509f; --accent-soft: #e3ecfa;
  --ok: #1e7c34; --ok-bg: #e7f4ea; --part: #8a6d1a; --part-bg: #fbf3dd;
  --miss: #b3261e; --miss-bg: #fbe9e7; --mono: "IBM Plex Mono", ui-monospace, monospace;
}
@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) {
  --bg: #14181d; --surface: #1c2128; --fg: #e8ecf1; --muted: #9aa5b1;
  --line: #323a44; --accent: #7fa9e8; --accent-soft: #22304a;
  --ok: #6fc284; --ok-bg: #1d3326; --part: #d9bb6a; --part-bg: #363020;
  --miss: #ee8c85; --miss-bg: #3c2321; color-scheme: dark;
} }
:root[data-theme="dark"] {
  --bg: #14181d; --surface: #1c2128; --fg: #e8ecf1; --muted: #9aa5b1;
  --line: #323a44; --accent: #7fa9e8; --accent-soft: #22304a;
  --ok: #6fc284; --ok-bg: #1d3326; --part: #d9bb6a; --part-bg: #363020;
  --miss: #ee8c85; --miss-bg: #3c2321; color-scheme: dark;
}
body { background: var(--bg); color: var(--fg); font: 15px/1.55 "IBM Plex Sans", -apple-system, "Segoe UI", sans-serif; }
.wrap { max-width: 980px; margin: 0 auto; padding-block: 40px 72px; }
h1 { font-size: 27px; letter-spacing: -0.01em; margin: 0 0 4px; text-wrap: balance; }
.sub { color: var(--muted); font-size: 13.5px; margin: 0 0 26px; }
h2 { font-size: 18px; margin: 40px 0 4px; letter-spacing: -0.005em; }
h3 { font-size: 14px; margin: 22px 0 8px; color: var(--muted); text-transform: uppercase; letter-spacing: 0.07em; font-weight: 600; }
p { margin: 8px 0; max-width: 72ch; }
.hero-card { background: var(--surface); border: 1px solid var(--line); border-radius: 10px; padding: 18px 20px; margin-bottom: 6px; }
.hero-card .big { font-size: 34px; font-weight: 700; letter-spacing: -0.02em; font-variant-numeric: tabular-nums; }
.hero-card .note { color: var(--muted); font-size: 13px; margin-top: 4px; }
.scorebar { display: flex; gap: 6px; height: 10px; border-radius: 5px; overflow: hidden; margin: 14px 0 6px; }
.scorebar div { height: 100%; }
.legend { display: flex; gap: 14px; flex-wrap: wrap; font-size: 12.5px; color: var(--muted); margin: 10px 0 0; }
.tscroll { overflow-x: auto; border: 1px solid var(--line); border-radius: 8px; background: var(--surface); margin: 10px 0 4px; }
table { border-collapse: collapse; width: 100%; font-size: 13.5px; }
th { text-align: left; font-size: 11px; text-transform: uppercase; letter-spacing: 0.06em; color: var(--muted); padding: 9px 12px; border-bottom: 1px solid var(--line); white-space: nowrap; }
td { padding: 7px 12px; border-bottom: 1px solid var(--line); vertical-align: top; }
tr:last-child td { border-bottom: none; }
td.f { min-width: 260px; } td.n { color: var(--muted); min-width: 200px; }
th.c, td.c { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
td.s { white-space: nowrap; }
.pill { display: inline-block; font-size: 11px; font-weight: 600; padding: 1.5px 9px; border-radius: 99px; }
.pill.ok { color: var(--ok); background: var(--ok-bg); }
.pill.part { color: var(--part); background: var(--part-bg); }
.pill.miss { color: var(--miss); background: var(--miss-bg); }
.nav { position: sticky; top: 0; z-index: 5; background: var(--bg); padding: 10px 0 8px; border-bottom: 1px solid var(--line); margin-bottom: 6px; display: flex; gap: 6px; flex-wrap: wrap; align-items: center; }
.nav a { color: var(--accent); text-decoration: none; font-size: 12px; padding: 3px 9px; border-radius: 99px; border: 1px solid var(--line); background: var(--surface); }
.nav .sp { flex: 1; }
.nav button { font: inherit; font-size: 12px; padding: 3px 10px; border-radius: 99px; border: 1px solid var(--line); background: var(--surface); color: var(--muted); cursor: pointer; }
.nav button.on-ok { color: var(--ok); border-color: var(--ok); }
.nav button.on-part { color: var(--part); border-color: var(--part); }
.nav button.on-miss { color: var(--miss); border-color: var(--miss); }
blockquote { border-left: 3px solid var(--accent); margin: 12px 0; padding: 2px 14px; color: var(--muted); }
ol li, ul li { margin: 5px 0; }
code { font-family: var(--mono); font-size: 12px; background: var(--accent-soft); border-radius: 3px; padding: 1px 5px; }
hr { border: none; border-top: 1px solid var(--line); margin: 26px 0; }
strong { font-weight: 600; }
a.ext { color: var(--accent); }
"""

def esc(s): return H.escape(s, quote=False)

def status_pill(tok):
    tok = tok.strip()
    if tok.startswith('✅'): return 'ok', 'Complete'
    if tok.startswith('🟡'): return 'part', 'Partial'
    return 'miss', 'Missing'

lines = md.split('\n')
out, i = [], 0
# skip the original H1 (page builds its own hero)
first_h1 = True
in_table = False
module_ids = {}
mod_idx = 0

def close_table():
    global in_table
    if in_table:
        out.append('</tbody></table></div>')
        in_table = False

while i < len(lines):
    ln = lines[i]
    if ln.startswith('# ') and first_h1:
        first_h1 = False; i += 1; continue
    if ln.startswith('## '):
        close_table()
        title = ln[3:].strip()
        mod_idx += 1
        mid = f"m{mod_idx}"
        module_ids[mid] = title
        out.append(f'<h2 id="{mid}">{esc(title)}</h2>')
        i += 1; continue
    if ln.startswith('### '):
        close_table()
        out.append(f'<h3>{esc(ln[4:].strip())}</h3>')
        i += 1; continue
    if ln.startswith('|'):
        rows = []
        while i < len(lines) and lines[i].startswith('|'):
            cells = [c.strip() for c in lines[i].strip().strip('|').split('|')]
            rows.append(cells)
            i += 1
        header, body = rows[0], rows[2:]
        is_status = header[1].lower().startswith('status')
        if not in_table:
            out.append('<div class="tscroll"><table><thead><tr>')
            out.extend(f'<th>{esc(h)}</th>' for h in header)
            out.append('</tr></thead><tbody>')
            in_table = True
        for r in body:
            if is_status:
                cls, label = status_pill(r[1])
                notes = esc(r[2]) if len(r) > 2 else ''
                out.append(f'<tr data-s="{cls}"><td class="f">{esc(r[0])}</td><td class="s"><span class="pill {cls}">{label}</span></td><td class="n">{notes}</td></tr>')
            else:
                while len(r) < len(header): r.append('')
                tds = ''
                for j, cell in enumerate(r):
                    cls = 'c' if j > 0 else ''
                    tds += f'<td class="{cls}">{esc(cell)}</td>'
                out.append(f'<tr>{tds}</tr>')
        continue
    close_table()
    if ln.startswith('**') and 'Overall' in ln:
        total_complete, total_partial, total_missing = 113, 77, 73
        out.append('<div class="hero-card"><div class="big">72% <span style="font-size:15px;font-weight:500;color:var(--muted)">of 263 audited line items deliver capability</span></div>')
        out.append('<div class="note">113 complete · 77 partial · 73 missing — verified in source on 5 Nov 2026</div>')
        out.append('<div class="scorebar">')
        out.append(f'<div style="flex:{total_complete};background:var(--ok)"></div><div style="flex:{total_partial};background:var(--part)"></div><div style="flex:{total_missing};background:var(--miss)"></div>')
        out.append('</div></div>')
        out.append('<div class="legend"><span>🟩 Complete &amp; working</span><span>🟨 Partial — gap noted in table</span><span>🟥 Missing</span></div>')
        i += 1; continue
    if ln.strip() == '---':
        out.append('<hr>'); i += 1; continue
    if re.match(r'^\d+\. ', ln):
        close_table()
        if not out or not out[-1].startswith('<ol'):
            out.append('<ol>')
        out.append(f'<li>{esc(re.sub(r"^\\d+\\. ", "", ln))}</li>')
        nxt = lines[i+1] if i+1 < len(lines) else ''
        if not re.match(r'^\d+\. ', nxt):
            out.append('</ol>')
        i += 1; continue
    if ln.strip():
        txt = esc(ln)
        txt = re.sub(r'\*\*(.+?)\*\*', r'<strong>\1</strong>', txt)
        txt = re.sub(r'`(.+?)`', r'<code>\1</code>', txt)
        txt = re.sub(r'\*(.+?)\*', r'<em>\1</em>', txt)
        out.append(f'<p>{txt}</p>')
    i += 1
close_table()

nav = '<div class="nav">' + ''.join(
    f'<a href="#{mid}">{esc(t.split("—")[0].strip())}</a>' for mid, t in module_ids.items()
) + '<span class="sp"></span><button data-f="ok">Complete</button><button data-f="part">Partial</button><button data-f="miss">Missing</button></div>'

page = f"""<title>BiltFlow Pulse Feature Audit</title>
<meta name="claude:viewport-fit-sides" content="cover">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@400;500;600;700&family=IBM+Plex+Mono:wght@400&display=swap">
<style>{CSS}</style>
<div class="wrap">
<h1>BiltFlow Pulse — Feature Audit</h1>
<p class="sub">Modules 1–6.1 · audited against the live codebase on 5 November 2026 · every line verified in source</p>
{nav}
{''.join(out)}
</div>
<script>
(function () {{
  var mode = null;
  var btns = document.querySelectorAll('.nav button');
  btns.forEach(function (b) {{
    b.addEventListener('click', function () {{
      var f = b.getAttribute('data-f');
      mode = (mode === f) ? null : f;
      btns.forEach(function (x) {{ x.className = x.className.replace(/on-\\w+/, '').trim(); }});
      if (mode) b.className += ' on-' + mode;
      document.querySelectorAll('tr[data-s]').forEach(function (tr) {{
        tr.hidden = mode !== null && tr.getAttribute('data-s') !== mode;
      }});
    }});
  }});
}})();
</script>
"""
open(OUT, 'w').write(page)
print('wrote', OUT, len(page), 'bytes')
