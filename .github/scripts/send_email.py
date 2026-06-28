#!/usr/bin/env python3
"""Send VYV blog draft email via Resend API."""
import json, os, re, sys, urllib.request

def send_email(subject, html_body):
    api_key = os.environ['RESEND_API_KEY']

    data = json.dumps({
        "from": "VYV Blog <blog@validateyourvision.com>",
        "to": ["validateyourvision@gmail.com"],
        "cc": ["nyahwood.va@gmail.com"],
        "reply_to": "validateyourvision@gmail.com",
        "subject": subject,
        "html": html_body
    }).encode()

    req = urllib.request.Request(
        'https://api.resend.com/emails',
        data=data,
        headers={
            'Authorization': f'Bearer {api_key}',
            'Content-Type': 'application/json'
        }
    )
    with urllib.request.urlopen(req) as resp:
        result = json.loads(resp.read())
    return result

def build_email(draft_path, revision=0, mode='draft'):
    with open(draft_path) as f:
        html = f.read()

    # Extract key info
    title_match = re.search(r'<title>(.*?)</title>', html)
    page_title = title_match.group(1).split('|')[0].strip() if title_match else "New Blog Post"

    h1_match = re.search(r'<h1[^>]*>(.*?)</h1>', html, re.DOTALL)
    h1 = re.sub(r'<[^>]+>', '', h1_match.group(1)).strip() if h1_match else page_title

    # Extract body content sections (H2s + paragraphs) for readable email preview
    body_sections = []
    for match in re.finditer(r'<h2[^>]*>(.*?)</h2>(.*?)(?=<h2|<section|<div class="faq|<div class="cta)', html, re.DOTALL):
        heading = re.sub(r'<[^>]+>', '', match.group(1)).strip()
        content = re.sub(r'<[^>]+>', ' ', match.group(2)).strip()
        content = re.sub(r'\s+', ' ', content)[:400]
        if heading and content:
            body_sections.append((heading, content))

    # Build FAQ preview
    faq_items = []
    for match in re.finditer(r'<dt[^>]*>(.*?)</dt>\s*<dd[^>]*>(.*?)</dd>', html, re.DOTALL):
        q = re.sub(r'<[^>]+>', '', match.group(1)).strip()
        a = re.sub(r'<[^>]+>', '', match.group(2)).strip()
        faq_items.append((q, a))

    revision_label = f"Revision {revision}" if revision > 0 else "First Draft"
    subject_prefix = "✏️ Revised:" if revision > 0 else "📝 New Draft:"

    sections_html = ""
    for heading, content in body_sections[:6]:
        sections_html += f"""
        <h3 style="font-family:Georgia,serif;font-size:18px;color:#210D46;margin:24px 0 8px;">{heading}</h3>
        <p style="font-size:15px;color:#333;line-height:1.7;margin:0 0 16px;">{content}...</p>"""

    faq_html = ""
    for q, a in faq_items[:4]:
        faq_html += f"""
        <div style="background:#F4F0FF;border-radius:8px;padding:16px;margin-bottom:12px;">
          <strong style="color:#210D46;font-size:14px;">{q}</strong>
          <p style="font-size:14px;color:#555;margin:8px 0 0;line-height:1.6;">{a[:200]}...</p>
        </div>"""

    email_html = f"""
<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>
<body style="font-family:Inter,Arial,sans-serif;background:#f5f5f5;margin:0;padding:20px;">
  <div style="max-width:680px;margin:0 auto;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 4px 20px rgba(0,0,0,0.1);">

    <!-- Header -->
    <div style="background:linear-gradient(135deg,#210D46,#4A237A);padding:32px 40px;text-align:center;">
      <p style="color:rgba(255,255,255,0.6);font-size:12px;letter-spacing:0.1em;text-transform:uppercase;margin:0 0 8px;">Validate Your Vision — Blog Automation</p>
      <h1 style="font-family:Georgia,serif;color:#fff;font-size:22px;margin:0 0 8px;">{subject_prefix} Blog Post</h1>
      <p style="color:rgba(255,255,255,0.75);font-size:14px;margin:0;">{revision_label}</p>
    </div>

    <!-- Post Title -->
    <div style="padding:32px 40px 0;">
      <p style="font-size:12px;color:#8B5BC7;font-weight:700;text-transform:uppercase;letter-spacing:0.1em;margin:0 0 8px;">Post Title</p>
      <h2 style="font-family:Georgia,serif;font-size:24px;color:#190E2A;line-height:1.3;margin:0 0 24px;">{h1}</h2>
    </div>

    <!-- Instructions Box -->
    <div style="margin:0 40px;background:#FFF8E7;border:2px solid #F0C040;border-radius:8px;padding:20px;">
      <p style="margin:0;font-size:15px;color:#7A5500;line-height:1.6;">
        <strong>To request changes:</strong> Reply to this email with your edits. Be as specific as you want — "change the second paragraph to say..." or "remove the section about X" etc.<br><br>
        <strong>To approve and publish:</strong> Reply with just the word <strong>APPROVED</strong> on its own line.
      </p>
    </div>

    <!-- Post Preview -->
    <div style="padding:32px 40px;">
      <h3 style="font-size:14px;color:#5c5470;text-transform:uppercase;letter-spacing:0.08em;margin:0 0 20px;border-bottom:1px solid #eee;padding-bottom:12px;">POST PREVIEW</h3>
      {sections_html}
    </div>

    <!-- FAQ Preview -->
    {'<div style="padding:0 40px 32px;"><h3 style="font-size:14px;color:#5c5470;text-transform:uppercase;letter-spacing:0.08em;margin:0 0 16px;border-bottom:1px solid #eee;padding-bottom:12px;">FAQ SECTION PREVIEW</h3>' + faq_html + '</div>' if faq_html else ''}

    <!-- Footer -->
    <div style="background:#190E2A;padding:24px 40px;text-align:center;">
      <p style="color:rgba(255,255,255,0.5);font-size:13px;margin:0;">
        Validate Your Vision Moving Co. · Fredericksburg, VA<br>
        This draft is stored in your GitHub repo under <code style="color:#8B5BC7;">blog/drafts/</code>
      </p>
    </div>

  </div>
</body>
</html>"""

    subject = f"{subject_prefix} {h1[:60]}{'...' if len(h1) > 60 else ''}"
    return subject, email_html

def main():
    draft_path = os.environ.get('DRAFT_PATH', '')
    revision = int(os.environ.get('REVISION', '0'))
    mode = os.environ.get('MODE', 'draft')

    if not draft_path or not os.path.exists(draft_path):
        print(f"Draft not found: {draft_path}")
        sys.exit(1)

    subject, email_html = build_email(draft_path, revision, mode)
    result = send_email(subject, email_html)
    print(f"Email sent. ID: {result.get('id', 'unknown')}")

if __name__ == '__main__':
    main()
