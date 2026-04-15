import os

BASE     = os.path.dirname(__file__)
FRONTEND = os.path.join(BASE, 'frontend')
PARTS    = os.path.join(FRONTEND, 'parts')
HTMLDIR  = os.path.join(FRONTEND, 'htmlfile')
JSDIR    = os.path.join(FRONTEND, 'javafiles')
OUTPUT   = os.path.join(FRONTEND, 'index.html')

HTML_PARTS = [
    os.path.join(PARTS,   'heads_firebase.html'),
    os.path.join(HTMLDIR, 'body_background.html'),
    os.path.join(HTMLDIR, 'nav_toast.html'),
    os.path.join(HTMLDIR, 'landing_page.html'),
    os.path.join(HTMLDIR, 'signup_auth_page.html'),
    os.path.join(HTMLDIR, 'role_portal_sidebar.html'),
    os.path.join(HTMLDIR, 'portal_main_content.html'),
    os.path.join(HTMLDIR, 'live_cam_page.html'),
]

JS_FILES = [
    os.path.join(JSDIR, 'global_state.js'),
    os.path.join(JSDIR, 'appointments.js'),
    os.path.join(JSDIR, 'history_profile.js'),
    os.path.join(JSDIR, 'auth.js'),
    os.path.join(JSDIR, 'portal_show.js'),
    os.path.join(JSDIR, 'portal_nav.js'),
    os.path.join(JSDIR, 'profile_save.js'),
    os.path.join(JSDIR, 'bookgarage.js'),
    os.path.join(JSDIR, 'carlife.js'),
    os.path.join(JSDIR, 'inspection_logic.js'),
    os.path.join(JSDIR, 'livecamera.js'),
    os.path.join(JSDIR, 'audio.js'),
    os.path.join(JSDIR, 'ai_panelreport.js'),
    os.path.join(JSDIR, 'rta_portal.js'),
    os.path.join(JSDIR, 'tasjeel_portal.js'),
    os.path.join(JSDIR, 'marketplace_operator.js'),
    os.path.join(JSDIR, 'registeration_renewal.js'),
    os.path.join(JSDIR, 'marketplace_owner.js'),
    os.path.join(JSDIR, 'fixes_insurance.js'),
]

CLOSING = os.path.join(PARTS, 'closing_tags.html')


def read(path):
    if not os.path.exists(path):
        print(f'  [MISSING] {path}')
        return ''
    with open(path, 'r', encoding='utf-8') as f:
        return f.read()


chunks = []

for p in HTML_PARTS:
    chunks.append(read(p))

chunks.append('\n    <script>')
for js in JS_FILES:
    chunks.append(read(js))
chunks.append('    </script>\n')

chunks.append(read(CLOSING))

with open(OUTPUT, 'w', encoding='utf-8') as f:
    f.write('\n'.join(chunks))

print(f'[MEHRA] index.html rebuilt -> {OUTPUT}')
