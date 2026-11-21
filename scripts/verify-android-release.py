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
import zipfile


def run(command):
    result = subprocess.run(command, capture_output=True, text=True)
    if result.returncode:
        raise RuntimeError(result.stdout + result.stderr)
    return result.stdout + result.stderr


def fingerprint(pem):
    match = re.search(r'-----BEGIN CERTIFICATE-----\s*(.*?)\s*-----END CERTIFICATE-----', pem, re.S)
    if match is None:
        raise ValueError('Missing X.509 certificate')
    return hashlib.sha256(base64.b64decode(match.group(1))).hexdigest()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--directory', type=Path, default=Path('android/releases'))
    parser.add_argument('--apksigner-jar', type=Path)
    args = parser.parse_args()
    root = Path(__file__).resolve().parents[1]
    directory = args.directory.resolve()
    metadata = json.loads((directory / 'release.json').read_text())
    version = metadata['versionName']
    if not re.fullmatch(r'\d+\.\d+\.\d+', version):
        raise ValueError('Unexpected version name')
    if metadata['applicationId'] != 'com.protpeek.app' or metadata['versionCode'] < 1:
        raise ValueError('Unexpected Android application metadata')
    if not re.fullmatch(r'[0-9a-f]{40}', metadata['sourceCommit']):
        raise ValueError('Missing build provenance')
    certificate = root / 'android/signing-certificate.pem'
    expected = metadata['certificateSha256'].lower()
    if fingerprint(certificate.read_text()) != expected:
        raise ValueError('The public signing certificate does not match the release')
    required = {f'ProtPeek-Android-{version}.aab', f'ProtPeek-Android-{version}.apk'}
    if set(metadata['files']) != required:
        raise ValueError('The release must include exactly its signed AAB and APK')
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
            if artifact.stat().st_size != info['size'] or hashlib.sha256(artifact.read_bytes()).hexdigest() != info['sha256']:
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
            else:
                jar = args.apksigner_jar
                if jar is None:
                    sdk = os.environ.get('ANDROID_HOME') or os.environ.get('ANDROID_SDK_ROOT')
                    jar = Path(sdk or '') / 'build-tools/36.0.0/lib/apksigner.jar'
                if not jar.is_file():
                    raise ValueError('Supply the official Android SDK apksigner.jar')
                output = run(java + ['-jar', str(jar), 'verify', '--verbose', '--print-certs', str(artifact)])
                values = re.findall(r'Signer #\d+ certificate SHA-256 digest:\s*([0-9a-fA-F:]+)', output)
                if [value.replace(':', '').lower() for value in values] != [expected]:
                    raise ValueError('Unexpected APK signing key')
            print('Verified signed artifact:', name, info['sha256'])
    print('Verified Android release', version, 'from', metadata['sourceCommit'])


if __name__ == '__main__':
    main()
