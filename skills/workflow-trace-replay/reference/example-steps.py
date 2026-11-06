"""A worked steps.py: the template's help-desk agent (classify, a cached help-center search, draft,
a policy check in code, a redraft with a fix note, send) turned into named steps, a staged funnel
and summary cards.

    python3 build_runs.py traces.json data --steps example-steps.py

It reads what the recording holds: the model calls by name (classify_ticket, draft_reply), the
search's cache reads and live calls, the help desk's POST, and the app's own events, which the
agent sent with record.mjs's event():

    {stage: 'check', ok, rules: [{rule, ok}]}   after each draft
    {stage: 'fix', note}                        before a redraft

Copy its shape for your workflow: one step per thing the reader should see happen, each step linked
to the calls inside it, and every word on a step read from the recording.
"""

# The prompt version each call ran, shown in the pop-up and in the step's meta line.
VERSIONS = {'classify_ticket': 'triage-v2', 'draft_reply': 'reply-v4'}

# Per run: which state machine in page.js FLOWS it plays on, and its picker label.
META = {
    'refund-simple': {'flow': 'agent', 'label': 'Refund', 'title': 'Within 30 days'},
    'refund-late': {'flow': 'agent', 'label': 'Refund', 'title': 'After 41 days'},
}
ORDER = ['refund-simple', 'refund-late']


def named(kit, name):
    return [e for e in kit.llm_events(kit.trace) if (e.get('req') or {}).get('name') == name]


def titles(evs):
    """The article titles a search returned, from the live call or the cache read."""
    for e in evs:
        results = (e.get('summary') or {}).get('results') or []
        if results:
            return [r.get('title') for r in results]
    return []


def build(trace, kit):
    turn = trace['turns'][0]
    t0, t1 = turn['began'], turn['ended']
    app = turn.get('appEvents') or []
    checks = [x for x in app if x.get('stage') == 'check']
    fixes = [x for x in app if x.get('stage') == 'fix']
    ask = (trace.get('ask') or [''])[0]
    steps = [{'a': t0, 'b': t0 + 1, 'st': 'in', 'title': 'Ticket in', 'body': f"“{ask}”"}]

    # Classify: one small model call.
    classify = named(kit, 'classify_ticket')[0]
    triage = kit.message(classify)
    steps.append({'a': classify['start'], 'b': kit.end_of(classify), 'st': 'classify', 'title': 'Classify the ticket',
                  'meta': kit.llm_meta(classify, VERSIONS['classify_ticket']),
                  'body': 'A small call reads the ticket and says what it is about, how urgent it is, and what to search for.',
                  'chips': [{'t': triage.get('intent', '?'), 'k': 'firm', 'c': 'intent'},
                            {'t': triage.get('urgency', '?'), 'k': 'soft', 'c': 'urgency'}],
                  'calls': [classify['_cid']]})

    # Search: the cache read and any live call between classify and the first draft are one step.
    drafts = named(kit, 'draft_reply')
    search = kit.window(trace, kit.end_of(classify), drafts[0]['start'] if drafts else t1,
                        lambda x: x['service'] == 'search')
    found = titles(search)
    if search:
        hit = any(x['kind'] == 'cache' and x['hit'] for x in search)
        steps.append({'a': search[0]['start'], 'b': max(kit.end_of(x) for x in search), 'st': 'search',
                      'title': 'Search the help center', 'meta': kit.data_meta(search, 'search'),
                      'body': 'The same query ran earlier, so the articles come from the cache.' if hit
                      else 'Code searches the help center with the model’s query and keeps the top articles.',
                      'chips': [{'t': t, 'k': 'keep'} for t in found], 'calls': [x['_cid'] for x in search]})

    # Each draft, then the code check that follows it, then a fix note if the check failed.
    cited = []
    for k, draft in enumerate(drafts):
        answer = kit.message(draft)
        cited.append(answer.get('cites') or [])
        steps.append({'a': draft['start'], 'b': kit.end_of(draft), 'st': 'draft',
                      'title': 'Draft the reply' if k == 0 else 'Draft again, with the fix note',
                      'meta': kit.llm_meta(draft, VERSIONS['draft_reply']),
                      'body': f"“{answer.get('reply', '')}”", 'calls': [draft['_cid']]})
        check = next((c for c in checks if c['t'] >= kit.end_of(draft)), None)
        if not check:
            continue
        broken = [r['rule'] for r in check['rules'] if not r['ok']]
        steps.append({'a': check['t'], 'b': check['t'] + 1, 'st': 'check', 'title': 'Policy OK?',
                      'body': 'Yes.' if check['ok'] else f"No: {', '.join(broken)}.",
                      'chips': [{'t': r['rule'], 'k': 'pass' if r['ok'] else 'fail'} for r in check['rules']]})
        nxt = drafts[k + 1]['start'] if k + 1 < len(drafts) else t1
        fix = next((f for f in fixes if check['t'] <= f['t'] < nxt), None)
        if fix:
            steps.append({'a': fix['t'], 'b': fix['t'] + 1, 'st': 'fix', 'title': 'Note what to fix',
                          'meta': f"redraft {k + 1}", 'body': fix['note']})

    # Send, then log.
    sends = [x for x in trace['events'] if x['kind'] == 'http' and x['service'] == 'helpdesk']
    for s in sends:
        steps.append({'a': s['start'], 'b': kit.end_of(s), 'st': 'send', 'title': 'Send the reply',
                      'meta': f"{s.get('method')} {s.get('path')} · {s.get('status')}",
                      'body': 'The reply goes to the customer.', 'calls': [s['_cid']], 'say': 'reply sent'})
    calls = len(named(kit, 'classify_ticket')) + len(drafts)
    steps.append({'a': max(t1 - 1, steps[-1]['b'] + 1), 'b': max(t1, steps[-1]['b'] + 2), 'st': 'save',
                  'title': 'Log the ticket', 'meta': f"{calls} model calls · {len(drafts) - 1} redrafts"})

    # The funnel: articles found, then what each draft cited.
    final_ok = bool(checks) and checks[-1]['ok']
    stages = [{'lab': 'Articles found', 'n': len(found), 'at': steps[2]['b'] if search else t0, 'sub': 'help-center search',
               'chips': [{'t': t, 'k': 'keep'} for t in found]}]
    for k, (draft, cites) in enumerate(zip(drafts, cited)):
        ok = k == len(drafts) - 1 and final_ok
        stages.append({'lab': f"Draft {k + 1} cited", 'n': len(cites), 'at': kit.end_of(draft), 'sub': 'from the draft’s cites',
                       'chips': [{'t': c, 'k': 'pass' if ok else 'fail'} for c in cites]})
    funnel = {'a': t0, 'b': t1, 'stages': stages,
              'stats': [{'n': len(found), 'label': 'articles found', 'at': stages[0]['at']},
                        {'n': len(drafts), 'label': 'drafts written', 'at': kit.end_of(drafts[-1]) if drafts else t1},
                        {'n': 'yes' if final_ok else 'no', 'label': 'policy OK', 'at': checks[-1]['t'] if checks else t1,
                         'cls': 'board'}]}
    turned = [c for c in checks if not c['ok']]
    if turned:
        funnel['away'] = {'at': turned[0]['t'], 'title': 'Why a draft was turned back',
                          'list': [{'reason': r['rule'], 'count': 1, 'examples': [f"draft {i + 1}"]}
                                   for i, c in enumerate(checks) if not c['ok'] for r in c['rules'] if not r['ok']]}

    result = turn.get('result') or {}
    summary = [{'h': 'Ticket, as classified', 'chips': [{'t': triage.get('intent', '?'), 'k': 'firm', 'c': 'intent'},
                                                       {'t': triage.get('urgency', '?'), 'k': 'soft', 'c': 'urgency'}]},
               {'h': 'Reply sent', 'text': f"“{result.get('reply', '')}”", 'flag': True}]
    return steps, [funnel], summary
