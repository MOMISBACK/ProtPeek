#!/usr/bin/env python3
# SPDX-License-Identifier: MPL-2.0
"""Verify public Android artifacts against their recorded hashes and certificate.

No private key is required: the temporary verification truststore contains only
the public ProtPeek certificate committed beside the Android sources.
"""
import argparse
import base64
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import tempfile
import xml.etree.ElementTree as ET
import zipfile

ANDROID_NAMESPACE = '{http://schemas.android.com/apk/res/android}'
BUNDLETOOL_SHA256 = 'a099cfa1543f55593bc2ed16a70a7c67fe54b1747bb7301f37fdfd6d91028e29'


def run(command, *, stdout_only=False):
    result = subprocess.run(command, capture_output=True, text=True)
    if result.returncode:
        raise RuntimeError(result.stdout + result.stderr)
    return result.stdout if stdout_only else result.stdout + result.stderr


def fingerprint(pem):
    match = re.search(r'-----BEGIN CERTIFICATE-----\s*(.*?)\s*-----END CERTIFICATE-----', pem, re.S)
    if match is None:
        raise ValueError('Missing X.509 certificate')
    return hashlib.sha256(base64.b64decode(match.group(1))).hexdigest()


def require_hash(value, length, label):
    if not isinstance(value, str) or not re.fullmatch(r'[0-9a-fA-F]{' + str(length) + '}', value):
        raise ValueError('Invalid ' + label)
    if set(value) == {'0'}:
        raise ValueError('Missing ' + label)
    return value.lower()


def version_properties(path):
    values = {}
    for line in path.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith(('#', '!')):
            continue
        if '=' not in line:
            raise ValueError('Invalid Android version.properties')
        key, value = line.split('=', 1)
        key = key.strip()
        if key in values:
            raise ValueError('Duplicate Android version property: ' + key)
        values[key] = value.strip()
    if not {'applicationId', 'versionName', 'versionCode'}.issubset(values):
        raise ValueError('Missing Android version properties')
    if not re.fullmatch(r'[1-9][0-9]*', values['versionCode']):
        raise ValueError('Invalid source Android version code')
    return values


def validate_metadata(metadata, properties):
    version = metadata.get('versionName')
    code = metadata.get('versionCode')
    if not isinstance(version, str) or not re.fullmatch(r'\d+\.\d+\.\d+', version):
        raise ValueError('Unexpected version name')
    if not isinstance(code, int) or isinstance(code, bool) or code < 1:
        raise ValueError('Unexpected Android version code')
    if (metadata.get('applicationId') != 'com.protpeek.app'
            or metadata['applicationId'] != properties['applicationId']
            or version != properties['versionName']
            or code != int(properties['versionCode'])):
        raise ValueError('Release metadata differs from android/version.properties')
    require_hash(metadata.get('sourceCommit'), 40, 'build source commit')
    workflow = metadata.get('workflowRun')
    if isinstance(workflow, bool) or not isinstance(workflow, (int, str)) \
            or not re.fullmatch(r'[1-9][0-9]*', str(workflow)):
        raise ValueError('Missing successful-build workflow run ID')
    unsigned = metadata.get('unsignedSha256')
    unsigned_names = {'app-release.aab', 'app-release-unsigned.apk'}
    if not isinstance(unsigned, dict) or set(unsigned) != unsigned_names:
        raise ValueError('Record both unsigned artifact hashes from CI build-info.json')
    for name, digest in unsigned.items():
        require_hash(digest, 64, 'unsigned artifact hash: ' + name)
    required = {f'ProtPeek-Android-{version}.aab', f'ProtPeek-Android-{version}.apk'}
    files = metadata.get('files')
    if not isinstance(files, dict) or set(files) != required:
        raise ValueError('The release must include exactly its signed AAB and APK')
    for name, info in files.items():
        if not isinstance(info, dict) or not isinstance(info.get('size'), int) \
                or isinstance(info['size'], bool) or info['size'] < 1:
            raise ValueError('Invalid artifact size: ' + name)
        digest = require_hash(info.get('sha256'), 64, 'signed artifact hash: ' + name)
        source = 'app-release.aab' if name.endswith('.aab') else 'app-release-unsigned.apk'
        if digest == unsigned[source].lower():
            raise ValueError('Signed and unsigned artifact hashes must differ: ' + name)


def require_package_identity(application_id, version_name, version_code, metadata, kind):
    if (application_id != metadata['applicationId']
            or version_name != metadata['versionName']
            or str(version_code) != str(metadata['versionCode'])):
        raise ValueError(kind + ' manifest package/version differs from the release metadata')


def verify_apk_manifest(aapt2, artifact, metadata):
    output = run([str(aapt2), 'dump', 'badging', str(artifact)], stdout_only=True)
    package = re.search(r'^package:\s+([^\r\n]+)', output, re.M)
    if package is None:
        raise ValueError('aapt2 did not return APK package metadata')
    fields = dict(re.findall(r"([A-Za-z][A-Za-z0-9]*)='([^']*)'", package.group(1)))
    require_package_identity(fields.get('name'), fields.get('versionName'),
                             fields.get('versionCode'), metadata, 'APK')


def verify_aab_manifest(java, bundletool, artifact, metadata):
    output = run(java + ['-jar', str(bundletool), 'dump', 'manifest',
                        '--bundle=' + str(artifact), '--module=base'], stdout_only=True)
    manifest = ET.fromstring(output)
    if manifest.tag != 'manifest':
        raise ValueError('bundletool did not return an Android manifest')
    require_package_identity(manifest.get('package'),
                             manifest.get(ANDROID_NAMESPACE + 'versionName'),
                             manifest.get(ANDROID_NAMESPACE + 'versionCode'), metadata, 'AAB')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--directory', type=Path, default=Path('android/releases'))
    parser.add_argument('--apksigner-jar', type=Path)
    parser.add_argument('--aapt2', type=Path)
    parser.add_argument('--bundletool-jar', type=Path, required=True)
    args = parser.parse_args()
    root = Path(__file__).resolve().parents[1]
    directory = args.directory.resolve()
    metadata = json.loads((directory / 'release.json').read_text())
    validate_metadata(metadata, version_properties(root / 'android/version.properties'))
    version = metadata['versionName']
    sdk = os.environ.get('ANDROID_HOME') or os.environ.get('ANDROID_SDK_ROOT')
    tools = Path(sdk or '') / 'build-tools/36.0.0'
    aapt2 = args.aapt2 or tools / ('aapt2.exe' if os.name == 'nt' else 'aapt2')
    if not aapt2.is_file():
        raise ValueError('Supply the official Android SDK aapt2 executable')
    bundletool = args.bundletool_jar
    if not bundletool.is_file() or hashlib.sha256(bundletool.read_bytes()).hexdigest() != BUNDLETOOL_SHA256:
        raise ValueError('Supply the checksum-verified official bundletool 1.18.3 JAR')
    certificate = root / 'android/signing-certificate.pem'
    expected = require_hash(metadata.get('certificateSha256'), 64, 'signing certificate fingerprint')
    if fingerprint(certificate.read_text()) != expected:
        raise ValueError('The public signing certificate does not match the release')
    java = ['java', '-Duser.language=en', '-Duser.country=US']
    with tempfile.TemporaryDirectory(prefix='protpeek-verify-') as temporary:
        trust = Path(temporary) / 'public-certificate.p12'
        run(java + ['-m', 'java.base/sun.security.tools.keytool.Main', '-importcert',
                    '-noprompt', '-alias', 'protpeek-android', '-file', str(certificate),
                    '-keystore', str(trust), '-storetype', 'PKCS12', '-storepass', 'verification-only'])
        for name, info in metadata['files'].items():
            artifact = directory / name
            if artifact.is_symlink() or not artifact.is_file():
                raise ValueError('Missing ordinary artifact: ' + name)
            if artifact.stat().st_size != info['size'] or hashlib.sha256(artifact.read_bytes()).hexdigest() != info['sha256'].lower():
                raise ValueError('Artifact checksum differs: ' + name)
            with zipfile.ZipFile(artifact) as archive:
                if archive.testzip() is not None:
                    raise ValueError('Corrupt Android archive: ' + name)
                names = archive.namelist()
                if len(names) != len(set(names)):
                    raise ValueError('Duplicate ZIP entries: ' + name)
            if name.endswith('.aab'):
                if not {'BundleConfig.pb', 'base/manifest/AndroidManifest.xml'}.issubset(names):
                    raise ValueError('Invalid AAB layout')
                output = run(java + ['-m', 'jdk.jartool/sun.security.tools.jarsigner.Main',
                                     '-verify', '-strict', '-verbose', '-certs', '-keystore', str(trust),
                                     '-storetype', 'PKCS12', '-storepass', 'verification-only', str(artifact), 'protpeek-android'])
                if 'jar verified.' not in output.lower():
                    raise ValueError('AAB signature was not confirmed')
                pem = run(java + ['-m', 'java.base/sun.security.tools.keytool.Main', '-printcert', '-jarfile', str(artifact), '-rfc'])
                if fingerprint(pem) != expected:
                    raise ValueError('Unexpected AAB signing key')
                verify_aab_manifest(java, bundletool, artifact, metadata)
            else:
                jar = args.apksigner_jar
                if jar is None:
                    jar = tools / 'lib/apksigner.jar'
                if not jar.is_file():
                    raise ValueError('Supply the official Android SDK apksigner.jar')
                output = run(java + ['-jar', str(jar), 'verify', '--verbose', '--print-certs', str(artifact)])
                values = re.findall(r'Signer #\d+ certificate SHA-256 digest:\s*([0-9a-fA-F:]+)', output)
                if [value.replace(':', '').lower() for value in values] != [expected]:
                    raise ValueError('Unexpected APK signing key')
                verify_apk_manifest(aapt2, artifact, metadata)
            print('Verified signed artifact:', name, info['sha256'])
    print('Verified Android release', version, 'with manifest versions and reported source',
          metadata['sourceCommit'], 'workflow run', metadata['workflowRun'])


if __name__ == '__main__':
    main()
