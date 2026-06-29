#!/usr/bin/env python3
"""Generate a new VYV blog post using Claude API."""
import json, os, sys, urllib.request, urllib.error
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
    with open('blog/_blog-automation-brief.md') as f:
        brief = f.read()
    with open('blog/_blog-topics.md') as f:
        topics = f.read()
    with open('blog/_published-topics.json') as f:
        tracker = json.load(f)

    topic_num = tracker.get('next_topic_number', 4)

    prompt = f"""You are writing a blog post for VYV Moving Company in Fredericksburg, VA.

VOICE AND STYLE GUIDE — follow every single rule in here exactly:
{brief}

FULL TOPIC LIST:
{topics}

Write Topic {topic_num} as a complete, publish-ready HTML blog post.

CRITICAL REQUIREMENTS:
1. Return ONLY valid HTML starting with <!DOCTYPE html>
2. Line 2 must be exactly: <!-- filename: [url-slug-here].html -->
3. Match the VYV brand CSS variables exactly:
   --dp: #190E2A; --mp: #210D46; --ap: #4A237A; --lv: #8B5BC7; --tw: #ECEBEE; --lbg: #ffffff; --lbg2: #F4F0FF
4. Google Fonts: Playfair Display (headings), Raleway (labels/UI), Inter (body)
5. Include the VYV SVG logo in the nav (same as existing posts)
6. Post structure (in order):
   - <head> with meta title, meta description (140-155 chars), canonical URL, JSON-LD schema
   - JSON-LD schema: one array containing Article + BreadcrumbList + FAQPage schemas
   - Nav bar (sticky, dark, logo + links + CTA button)
   - Breadcrumb nav (.breadcrumb class)
   - Article hero (full-width gradient header with H1 + meta)
   - Table of contents (anchor links to each H2)
   - Intro paragraph with left-border accent style (.intro class)
   - Real Unsplash photo: https://images.unsplash.com/photo-[REAL-ID]?w=800&q=80&auto=format&fit=crop
   - Section 1: Why this matters / what goes wrong
   - Pull quote (.pull-quote class)
   - Sections 2-4: Practical content
   - Tip boxes (.tip-box with .tip-label small-caps tag)
   - Checklist card (.checklist-card)
   - Second real Unsplash photo
   - FAQ section (4-6 questions, marked up for schema)
   - CTA block → /pricing-estimator.html
   - Footer
7. Minimum 1,200 words of body content
8. Primary keyword in the very first sentence of body text
9. Internal links: at least one to /pricing-estimator.html and one to /#areas
10. Alt text on every image — descriptive, includes Fredericksburg VA or relevant VA city
11. DO NOT use any banned words from the style guide
12. Write exactly like a real local business owner who knows their stuff — not a marketing writer
13. Specific local details (Route 1, Quantico, Stafford, Nextdoor, Facebook groups, etc.)
14. Vary sentence length. Short punchy ones. Then a longer one that gives context. Never the same rhythm twice.
15. Use "you" constantly. Opinions stated plainly. No hedging.

Write Topic {topic_num} now. Return only the HTML."""

    html = call_claude(prompt)

    # Extract filename from comment on line 2
    lines = html.split('\n')
    filename = None
    for line in lines[:5]:
        if '<!-- filename:' in line:
            filename = line.split('<!-- filename:')[1].split('-->')[0].strip()
            break

    if not filename:
        filename = f"blog-post-topic-{topic_num}-{datetime.now().strftime('%Y-%m-%d')}.html"

    draft_path = f"blog/drafts/{filename}"

    with open(draft_path, 'w') as f:
        f.write(html)

    # Update tracker
    tracker['current_draft'] = {
        'filename': filename,
        'path': draft_path,
        'topic_number': topic_num,
        'generated_at': datetime.now().isoformat(),
        'revision': 0
    }
    with open('blog/_published-topics.json', 'w') as f:
        json.dump(tracker, f, indent=2)

    print(f"DRAFT_PATH={draft_path}")
    print(f"DRAFT_FILENAME={filename}")
    print(f"TOPIC_NUMBER={topic_num}")

if __name__ == '__main__':
    main()
