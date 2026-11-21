#!/usr/bin/env bash
# SPDX-License-Identifier: MPL-2.0
set -euo pipefail
mkdir -p .output/android-emulator
collect_evidence() {
  adb logcat -d > .output/android-emulator/logcat.txt || true
  adb pull /sdcard/Android/data/com.protpeek.app/files/qa/ .output/android-emulator/ || true
}
trap collect_evidence EXIT
app_apk=$(find .output/android-test-apks -name app-debug.apk -print -quit)
test_apk=$(find .output/android-test-apks -name app-debug-androidTest.apk -print -quit)
[[ -f "$app_apk" && -f "$test_apk" ]]
adb install -r "$app_apk"
adb install -r "$test_apk"
adb shell am instrument -w com.protpeek.app.test/androidx.test.runner.AndroidJUnitRunner | tee .output/android-emulator/instrumentation.txt
grep -E 'OK \([0-9]+ tests?\)' .output/android-emulator/instrumentation.txt
