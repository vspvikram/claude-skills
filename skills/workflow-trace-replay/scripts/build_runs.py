"""Turn recorded runs (record.mjs's traces.json) into the replay page's data: runs.json (steps,
calls, events, funnels, summaries) and prompts.json (each instruction text and response format once).

    python3 build_runs.py <traces.json> <out-dir> [--steps steps.py]

Without --steps every model call becomes a step named after the call, the outside calls between
them become one step per service, and each turn starts with "in" and ends with "save". That is
enough for a first page. For a real workflow, write steps.py with

    def build(trace, kit):            # one recorded run
        return steps, funnels, summary   # funnels and summary may be []

using kit's helpers (kit.calls, kit.message(e), kit.llm_meta(e), kit.window(...), ...): see
reference/example-steps.py, which turns a help-desk agent's traces into named steps with a funnel.
"""
import hashlib, importlib.util, json, sys
from pathlib import Path

PROMPTS, SCHEMAS = {}, {}


def jparse(text):
    if not text:
        return None
    text = text.split('…[+')[0]
    try:
        return json.loads(text)
    except Exception:
        return None


def secs(ms):
    return f"{ms/1000:.1f} s"


def num(n):
    return f"{n:,}"


def short_hash(text):
    return hashlib.sha1(text.encode('utf-8')).hexdigest()[:10]


def end_of(e):
    return e.get('end') or e['start']


def llm_events(d):
    return sorted([e for e in d['events'] if e['kind'] == 'http' and e['service'] == 'llm'], key=lambda e: e['start'])


def message(e):
    """A model call's answer, parsed when it is JSON."""
    outs = (e.get('res') or {}).get('output') or []
    text = next((o['text'] for o in outs if o['type'] == 'message'), '')
    return jparse(text) or ({'text': text} if text else {})


def llm_meta(e, version=None):
    r, s = e.get('req') or {}, (e.get('res') or {})
    u = s.get('usage') or {}
    body = r.get('body') or {}
    effort = (body.get('reasoning') or {}).get('effort') if isinstance(body.get('reasoning'), dict) else None
    bits = [version] if version else []
    if effort:
        bits.append(f"effort {effort}")
    if u.get('input') is not None:
        bits.append(f"{num(u['input'])} in ({round(100*(u.get('cached') or 0)/max(1,u['input']))}% cached)")
        bits.append(f"{num(u.get('output') or 0)} out")
    else:
        bits.append('cut off, no answer')
    bits.append(secs(end_of(e) - e['start']))
    return ' · '.join(bits)


def window(d, a, b, pred=lambda x: True):
    return [x for x in d['events'] if a <= x['start'] < b and pred(x)]


def data_meta(evs, name):
    cache = [x for x in evs if x['kind'] == 'cache']
    live = [x for x in evs if x['kind'] == 'http']
    timeouts = [x for x in live if 'timeout' in (x.get('error') or '')]
    bits = []
    if cache:
        bits.append(f"{len(cache)} {name} cache reads ({sum(1 for x in cache if x['hit'])} hits)")
    bits.append(f"{len(live)} live")
    if timeouts:
        bits.append(f"{len(timeouts)} timed out")
    return ' · '.join(bits)


# ---------- the calls, as the pop-up shows them ----------
SPLIT = ('model', 'instructions', 'system', 'input', 'messages', 'contents', 'prompt', 'text', 'tools', 'response_format')


def call_records(d, versions=None):
    """Every outside call and cache read in order; each event gets its id ('_cid')."""
    out = []
    for e in d['events']:
        cid = len(out)
        e['_cid'] = cid
        if e['kind'] == 'cache':
            out.append({'i': cid, 'k': 'cache', 's': e['service'], 'a': e['start'], 'b': e['end'], 'hit': e['hit'],
                        'key': e.get('key'), 'asked': e.get('asked'), 'summary': e.get('summary')})
            continue
        if e['service'] == 'llm':
            req = e.get('req') or {}
            body = req.get('body') or {}
            res = e.get('res') or {}
            instr = body.get('instructions') or body.get('system') or ''
            if not isinstance(instr, str):
                instr = json.dumps(instr, ensure_ascii=False, indent=1)
            ph = short_hash(instr) if instr else None
            if ph:
                PROMPTS[ph] = instr
            fmt = (body.get('text') or {}).get('format') or ((body.get('response_format') or {}).get('json_schema')) or {}
            sh = None
            if isinstance(fmt, dict) and fmt.get('schema') is not None:
                sh = short_hash(json.dumps(fmt['schema'], sort_keys=True))
                SCHEMAS[sh] = fmt['schema']
            known = SPLIT + ('reasoning', 'max_output_tokens', 'max_tokens', 'temperature', 'stream', 'store', 'tool_choice')
            other = {k: v for k, v in body.items() if k not in known}
            outs = res.get('output') or []
            msg = next((o['text'] for o in outs if o['type'] == 'message'), None)
            output = jparse(msg) if msg else None
            if output is None and msg:
                output = msg
            name = req.get('name') or req.get('model') or 'model call'
            out.append({'i': cid, 'k': 'llm', 'name': name, 'pv': (versions or {}).get(name), 'a': e['start'], 'b': end_of(e), 'f': e.get('firstDelta'),
                        'model': body.get('model') or req.get('model'),
                        'params': {'reasoning': body.get('reasoning'), 'max_output_tokens': body.get('max_output_tokens') or body.get('max_tokens'),
                                   'temperature': body.get('temperature'), 'stream': body.get('stream'), 'store': body.get('store'),
                                   'tool_choice': body.get('tool_choice'),
                                   'format': {'type': fmt.get('type', 'json_schema'), 'name': fmt.get('name'), 'strict': fmt.get('strict')} if fmt else None,
                                   'other': other or None},
                        'prompt': ph, 'schema': sh,
                        'tools': [t.get('name') or (t.get('function') or {}).get('name') or t.get('type') for t in body.get('tools') or []],
                        'input': next((body[k] for k in ('input', 'messages', 'contents', 'prompt') if k in body), None),
                        'output': output,
                        'toolCalls': [{'name': o['name'], 'args': jparse(o.get('args')) or o.get('args')} for o in outs if o['type'] == 'tool_call'],
                        'usage': res.get('usage'), 'status': res.get('status'), 'size': len(json.dumps(body))})
            continue
        out.append({'i': cid, 'k': e['service'], 'a': e['start'], 'b': end_of(e), 'method': e.get('method'), 'host': e.get('host'),
                    'path': e.get('path'), 'params': e.get('params'), 'status': e.get('status'), 'error': e.get('error'),
                    'sent': e.get('sent'), 'summary': e.get('summary'), 'results': e.get('results')})
    return out


def compact_events(d):
    """The sequence view's events: calls as-is, cache reads bucketed per 200 ms per service."""
    out, buckets = [], {}
    for e in d['events']:
        if e['kind'] == 'cache':
            key = (e['service'], e['start'] // 200)
            b = buckets.setdefault(key, {'k': 'cache', 's': e['service'], 'a': e['start'], 'b': e['end'], 'n': 0, 'miss': 0})
            b['n'] += 1
            b['miss'] += 0 if e['hit'] else 1
            b['a'] = min(b['a'], e['start'])
            b['b'] = max(b['b'], e['end'])
            continue
        ev = {'k': e['service'], 'a': e['start'], 'b': end_of(e), 'c': e.get('_cid')}
        if e['service'] == 'llm':
            r, s = e.get('req') or {}, e.get('res') or {}
            ev['n'] = r.get('name') or r.get('model') or 'model call'
            if e.get('firstDelta'):
                ev['f'] = e['firstDelta']
            u = s.get('usage') or {}
            ev['tin'], ev['tc'], ev['tout'] = u.get('input'), u.get('cached'), u.get('output')
            outs = s.get('output') or []
            tools = [o['name'] for o in outs if o['type'] == 'tool_call']
            ev['o'] = ('→ ' + ', '.join(tools)) if tools else ('→ answer' if any(o['type'] == 'message' for o in outs) else '→ cut off')
        else:
            ev['n'] = (e.get('path') or '').strip('/').split('/')[-1] or e.get('method', 'call').lower()
            if e.get('error'):
                ev['x'] = 'timeout' if 'timeout' in e['error'] else 'error'
        out.append(ev)
    out += list(buckets.values())
    out.sort(key=lambda x: x['a'])
    return out


# ---------- default steps: one per model call, one per run of outside calls ----------
def default_build(trace, kit):
    steps = []
    for ti, turn in enumerate(trace['turns']):
        t0, t1 = turn['began'], turn['ended']
        asks = trace.get('ask') or []
        steps.append({'a': t0, 'b': t0 + 1, 'st': 'in', 'title': 'Request in',
                      'body': f"“{asks[ti] if ti < len(asks) else ''}”", 'meta': f"turn {ti+1} of {len(trace['turns'])}"})
        evs = [e for e in trace['events'] if t0 - 5 <= e['start'] <= t1]
        group = []

        def flush():
            if not group:
                return
            svc = group[0]['service']
            steps.append({'a': group[0]['start'], 'b': max(end_of(x) for x in group), 'st': svc, 'title': f"{svc} calls",
                          'meta': data_meta(group, svc), 'calls': [x['_cid'] for x in group]})
            group.clear()
        for e in evs:
            if e['kind'] == 'http' and e['service'] == 'llm':
                flush()
                name = (e.get('req') or {}).get('name') or (e.get('req') or {}).get('model') or 'model call'
                steps.append({'a': e['start'], 'b': end_of(e), 'st': name, 'title': name.replace('_', ' ').capitalize(),
                              'meta': llm_meta(e), 'calls': [e['_cid']]})
            else:
                svc = e['service']
                if group and group[0]['service'] != svc:
                    flush()
                group.append(e)
        flush()
        steps.append({'a': max(t1 - 2, steps[-1]['a'] + 1), 'b': max(t1, steps[-1]['a'] + 2), 'st': 'save', 'title': 'Done'})
    result = (trace['turns'][-1].get('result') or {}) if trace['turns'] else {}
    answer = result.get('reply') or result.get('answer') or result.get('text') if isinstance(result, dict) else str(result)
    summary = [{'h': 'Answer', 'text': answer}] if answer else []
    return steps, [], summary


class Kit:
    """What steps.py gets: the run's calls and the helpers above."""
    def __init__(self, trace, calls):
        self.trace, self.calls = trace, calls
    jparse, secs, num, end_of, message, llm_meta, window, data_meta, llm_events = (
        staticmethod(jparse), staticmethod(secs), staticmethod(num), staticmethod(end_of), staticmethod(message),
        staticmethod(llm_meta), staticmethod(window), staticmethod(data_meta), staticmethod(llm_events))


def main():
    args = sys.argv[1:]
    if len(args) < 2:
        print(__doc__)
        sys.exit(2)
    traces = json.load(open(args[0]))
    out = Path(args[1])
    out.mkdir(parents=True, exist_ok=True)
    custom = None
    if '--steps' in args:
        path = args[args.index('--steps') + 1]
        spec = importlib.util.spec_from_file_location('steps', path)
        custom = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(custom)
    versions = getattr(custom, 'VERSIONS', None) if custom else None
    order = getattr(custom, 'ORDER', None) if custom else None
    if order:
        by = {t['id']: t for t in traces}
        traces = [by[i] for i in order if i in by]
    runs, names = [], []
    for d in traces:
        calls = call_records(d, versions)
        kit = Kit(d, calls)
        steps, funnels, summary = (custom.build if custom else default_build)(d, kit)
        steps.sort(key=lambda s: (s['a'], s['b']))
        for s in steps:
            s.setdefault('calls', [])
            if s['st'] not in names:
                names.append(s['st'])
        llm = llm_events(d)
        meta = getattr(custom, 'META', {}).get(d['id'], {}) if custom else {}
        runs.append({
            'id': d['id'], 'flow': meta.get('flow') or d.get('flow') or 'main', 'label': meta.get('label') or d.get('label') or 'Run',
            'title': meta.get('title') or d.get('title') or d['id'], 'ask': meta.get('ask') or d.get('ask') or [],
            **({'you': meta['you']} if meta.get('you') else {}),
            'total': max([s['b'] for s in steps] + [1]),
            'tokens': {'in': sum((e.get('res') or {}).get('usage', {}).get('input') or 0 for e in llm),
                       'cached': sum((e.get('res') or {}).get('usage', {}).get('cached') or 0 for e in llm),
                       'out': sum((e.get('res') or {}).get('usage', {}).get('output') or 0 for e in llm)},
            'calls': len(llm), 'turns': [{'a': t['began'], 'b': t['ended']} for t in d['turns']],
            'steps': steps, 'net': calls, 'events': compact_events(d), 'funnels': funnels or [], 'summary': summary or [],
        })
    json.dump(runs, open(out / 'runs.json', 'w'), separators=(',', ':'), ensure_ascii=False)
    json.dump({'prompts': PROMPTS, 'schemas': SCHEMAS}, open(out / 'prompts.json', 'w'), separators=(',', ':'), ensure_ascii=False)
    print(f"{len(runs)} runs → {out/'runs.json'} ({(out/'runs.json').stat().st_size:,} bytes); {len(PROMPTS)} prompts, {len(SCHEMAS)} schemas")
    print('Step names, in the order they first appear (each needs a box in FLOWS, or an alias):')
    print('  ' + ', '.join(names))
    for r in runs:
        print(f"  {r['id']}: {r['total']/1000:.1f} s · {r['calls']} model calls · {len(r['steps'])} steps · {len(r['net'])} calls")


if __name__ == '__main__':
    main()
