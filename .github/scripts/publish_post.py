#!/usr/bin/env python3
"""Publish an approved VYV blog draft to the live blog."""
import json, os, re, sys
from datetime import datetime

def main():
    with open('blog/_published-topics.json') as f:
        tracker = json.load(f)

    draft_info = tracker.get('current_draft')
    if not draft_info:
        print("No current draft to publish")
        sys.exit(1)

    draft_path = draft_info['path']
    filename = draft_info['filename']
    topic_num = draft_info['topic_number']
    live_path = f"blog/{filename}"

    with open(draft_path) as f:
        html = f.read()

    # Write to live blog folder
    with open(live_path, 'w') as f:
        f.write(html)

    # Extract title and excerpt for blog index card
    title_match = re.search(r'<title>(.*?)</title>', html)
    page_title = title_match.group(1).split('|')[0].strip() if title_match else "New Post"

    h1_match = re.search(r'<h1[^>]*>(.*?)</h1>', html, re.DOTALL)
    h1 = re.sub(r'<[^>]+>', '', h1_match.group(1)).strip() if h1_match else page_title

    # Get first paragraph for excerpt
    intro_match = re.search(r'class="intro"[^>]*>(.*?)</p>', html, re.DOTALL)
    if intro_match:
        excerpt_raw = re.sub(r'<[^>]+>', '', intro_match.group(1)).strip()
        excerpt = excerpt_raw[:160] + '...' if len(excerpt_raw) > 160 else excerpt_raw
    else:
        excerpt = "Read the latest moving tips and advice from the VYV team."

    month_year = datetime.now().strftime('%B %Y')

    new_card = f"""
      <a href="/blog/{filename}" class="post-card">
        <div class="post-card-img-placeholder">📦</div>
        <div class="post-card-body">
          <p class="post-tag">Moving Tips</p>
          <h2>{h1}</h2>
          <p>{excerpt}</p>
          <div class="post-meta">VYV Team <span>·</span> {month_year}</div>
          <div class="read-more">Read more →</div>
        </div>
      </a>"""

    # Insert card into blog/index.html
    with open('blog/index.html') as f:
        index_html = f.read()

    marker = '<!-- ADD MORE CARDS ABOVE THIS LINE -->'
    if marker in index_html:
        index_html = index_html.replace(marker, new_card + '\n\n      ' + marker)
        with open('blog/index.html', 'w') as f:
            f.write(index_html)
        print("Blog index updated.")
    else:
        print("WARNING: Could not find insertion marker in blog/index.html")

    # Update tracker
    tracker['published'].append({
        'topic_number': topic_num,
        'filename': filename,
        'published_at': datetime.now().isoformat()
    })
    tracker['next_topic_number'] = topic_num + 1
    tracker['current_draft'] = None

    with open('blog/_published-topics.json', 'w') as f:
        json.dump(tracker, f, indent=2)

    # Remove draft file
    os.remove(draft_path)

    print(f"LIVE_PATH={live_path}")
    print(f"FILENAME={filename}")

if __name__ == '__main__':
    main()
