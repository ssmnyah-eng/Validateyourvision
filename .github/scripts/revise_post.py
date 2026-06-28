#!/usr/bin/env python3
"""Revise a VYV blog draft based on client feedback."""
import json, os, sys, urllib.request
from datetime import datetime

def call_claude(prompt):
    api_key = os.environ['ANTHROPIC_API_KEY']
    data = json.dumps({
        "model": "claude-opus-4-8",
        "max_tokens": 8192,
        "messages": [{"role": "user", "content": prompt}]
    }).encode()

    req = urllib.request.Request(
        'https://api.anthropic.com/v1/messages',
        data=data,
        headers={
            'x-api-key': api_key,
            'anthropic-version': '2023-06-01',
            'content-type': 'application/json'
        }
    )
    with urllib.request.urlopen(req) as resp:
        result = json.loads(resp.read())
    return result['content'][0]['text']

def main():
    feedback = os.environ.get('FEEDBACK', '')
    if not feedback:
        print("No feedback provided")
        sys.exit(1)

    with open('blog/_published-topics.json') as f:
        tracker = json.load(f)

    draft_info = tracker.get('current_draft')
    if not draft_info:
        print("No current draft found")
        sys.exit(1)

    draft_path = draft_info['path']
    with open(draft_path) as f:
        current_html = f.read()

    with open('blog/_blog-automation-brief.md') as f:
        brief = f.read()

    revision_num = draft_info.get('revision', 0) + 1

    prompt = f"""You wrote this blog post for VYV Moving Company:

{current_html}

---

The client reviewed it and has these specific edits:

{feedback}

---

Apply every edit exactly as requested. Where the client says to change something, change it. Where they say to remove something, remove it. Where they say to add something, add it.

Keep everything else — the HTML structure, CSS, schema, nav, footer, internal links — exactly the same.

The voice and style rules still apply (no banned words, human tone, specific details).

Return ONLY the complete revised HTML, starting with <!DOCTYPE html>.
Keep the same <!-- filename: ... --> comment on line 2."""

    revised_html = call_claude(prompt)

    with open(draft_path, 'w') as f:
        f.write(revised_html)

    tracker['current_draft']['revision'] = revision_num
    tracker['current_draft']['last_revised_at'] = datetime.now().isoformat()
    with open('blog/_published-topics.json', 'w') as f:
        json.dump(tracker, f, indent=2)

    print(f"DRAFT_PATH={draft_path}")
    print(f"DRAFT_FILENAME={draft_info['filename']}")
    print(f"REVISION={revision_num}")

if __name__ == '__main__':
    main()
