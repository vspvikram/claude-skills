"""Fill the replay template with one page's data.

    python3 assemble.py <template/replay.html> <page.js> <data-dir> <out.html> [--title "Engine Replay"]

page.js is yours: META, FLOWS, FINDS, FLAGS, COMPARE and LIMITS (see the template's sample data
for every field; FINDS, FLAGS, COMPARE and LIMITS may be left out). <data-dir> is build_runs.py's
output (runs.json and prompts.json). The page's <title> comes from --title, else META.title.
"""
import json, re, sys
from pathlib import Path

BEGIN = '/* ================================ DATA ================================'
END = '/* ================================ ENGINE ================================ */'


def main():
    args = [a for a in sys.argv[1:]]
    title = None
    if '--title' in args:
        k = args.index('--title')
        title = args[k + 1]
        del args[k:k + 2]
    if len(args) != 4:
        print(__doc__)
        sys.exit(2)
    template, page_js, data_dir, out = args
    s = Path(template).read_text(encoding='utf-8')
    page = Path(page_js).read_text(encoding='utf-8').rstrip() + '\n'
    runs = json.loads((Path(data_dir) / 'runs.json').read_text())
    prompts = json.loads((Path(data_dir) / 'prompts.json').read_text())
    i, j = s.index(BEGIN), s.index(END)
    block = BEGIN + '\n   Filled by assemble.py: page.js, then the recorded runs. */\n' + page
    for name, default in (('FINDS', '[]'), ('FLAGS', '{}'), ('COMPARE', 'null'), ('LIMITS', 'null')):
        if not re.search(rf'\b(const|let|var)\s+{name}\b', page):
            block += f'const {name} = {default};\n'
    block += 'const RUNS = ' + json.dumps(runs, separators=(',', ':'), ensure_ascii=False) + ';\n'
    block += 'const PROMPTS = ' + json.dumps(prompts['prompts'], separators=(',', ':'), ensure_ascii=False) + ';\n'
    block += 'const SCHEMAS = ' + json.dumps(prompts['schemas'], separators=(',', ':'), ensure_ascii=False) + ';\n'
    s = s[:i] + block + s[j:]
    if not title:
        m = re.search(r"title:\s*['\"]([^'\"]+)['\"]", page)
        title = m.group(1) if m else 'Workflow Replay'
    s = re.sub(r'<title>[^<]*</title>', f'<title>{title}</title>', s, count=1)
    Path(out).write_text(s, encoding='utf-8')
    print(f"wrote {out} ({len(s.encode('utf-8')):,} bytes, {len(runs)} runs)")


if __name__ == '__main__':
    main()
