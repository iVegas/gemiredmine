# Exits non-zero unless the APK carries a signature: a v1 META-INF certificate, or the v2 APK Signing Block.
import sys
import zipfile

path = sys.argv[1]
with zipfile.ZipFile(path) as apk:
    v1 = any(n.startswith('META-INF/') and n.endswith(('.RSA', '.DSA', '.EC')) for n in apk.namelist())
with open(path, 'rb') as f:
    v2 = b'APK Sig Block 42' in f.read()
if not (v1 or v2):
    sys.exit(f'No signature found in {path}')
print(f'signed: {path} (v1={v1}, v2={v2})')
