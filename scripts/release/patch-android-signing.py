# Adds release signing to the Gradle file `tauri android init` generates. The template has none. The release build is
# signed only when the project root has keystore.properties (password, keyAlias, storeFile); without it, it stays unsigned.
# Run once after `tauri android init`. The patch is idempotent.
import sys

path = sys.argv[1]
text = open(path).read()
if 'signingConfigs {' in text:
    sys.exit(0)

signing = '''    signingConfigs {
        val keystoreFile = rootProject.file("keystore.properties")
        if (keystoreFile.exists()) {
            val keystore = Properties().apply { keystoreFile.inputStream().use { load(it) } }
            create("release") {
                storeFile = file(keystore.getProperty("storeFile"))
                storePassword = keystore.getProperty("password")
                keyAlias = keystore.getProperty("keyAlias")
                keyPassword = keystore.getProperty("password")
            }
        }
    }
'''
release = '        getByName("release") {\n'

for anchor, insert in [('android {\n', signing), (release, release + '            signingConfig = signingConfigs.findByName("release")\n')]:
    if text.count(anchor) != 1:
        sys.exit(f'Expected one {anchor.strip()!r} in {path}')
    text = text.replace(anchor, anchor + insert if anchor == 'android {\n' else insert)

open(path, 'w').write(text)
print(f'patched {path}')
