"""Check local links, fragments, inline JavaScript syntax, and retired phone number."""
from pathlib import Path
from html.parser import HTMLParser
from urllib.parse import urlsplit, unquote
import subprocess

class Page(HTMLParser):
    def __init__(self):
        super().__init__(); self.refs=[]; self.ids=set(); self.scripts=[]; self.buffer=None
    def handle_starttag(self, tag, attrs):
        attrs=dict(attrs)
        if 'id' in attrs: self.ids.add(attrs['id'])
        for attr in ['href','src']:
            if attrs.get(attr): self.refs.append(attrs[attr])
        if tag=='script' and not attrs.get('src') and attrs.get('type','')!='application/ld+json': self.buffer=''
    def handle_data(self, text):
        if self.buffer is not None: self.buffer+=text
    def handle_endtag(self, tag):
        if tag=='script' and self.buffer is not None: self.scripts.append(self.buffer); self.buffer=None

root=Path(__file__).resolve().parent.parent
pages={}
for file in root.rglob('*.html'):
    if '.git' in file.parts: continue
    page=Page(); page.feed(file.read_text()); pages[file]=page
errors=[]
for file,page in pages.items():
    for ref in page.refs:
        url=urlsplit(ref)
        if url.scheme or url.netloc or '{{' in ref: continue
        target=(root/url.path.lstrip('/')) if url.path.startswith('/') else file.parent/url.path
        if not url.path: target=file
        if target.is_dir(): target/= 'index.html'
        if not target.exists(): errors.append(f'{file.relative_to(root)}: missing {ref}')
        elif url.fragment and target in pages and unquote(url.fragment) not in pages[target].ids:
            errors.append(f'{file.relative_to(root)}: missing fragment {ref}')
    for script in page.scripts:
        result=subprocess.run(['node','-e',"new(require('vm').Script)(require('fs').readFileSync(0,'utf8'))"],input=script,text=True,capture_output=True)
        if result.returncode: errors.append(f'{file.relative_to(root)}: invalid JavaScript\n{result.stderr[:400]}')
    if '5403001414' in file.read_text() or '300-1414' in file.read_text(): errors.append(f'{file.name}: retired phone number')
print(f'Checked {len(pages)} pages: {len(errors)} errors')
print('\n'.join(errors))
raise SystemExit(bool(errors))
