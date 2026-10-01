/**
 * macOS のコマンド（afconvert・ditto・plutil）や `#!/bin/sh` の偽バイナリを実際に使うテストは、
 * Windows の CI では走らせない（ADR-048）。`describe.skipIf(notMacOS)` で囲む。
 * 製品コードの Windows 版を足したら、その実装のテストは別に書く。
 */
export const notMacOS = process.platform !== 'darwin'

/**
 * Windows の API（WASAPI・Media Foundation など）や `.exe` の補助プログラムを実際に使うテストは、
 * Windows でだけ走らせる。`describe.skipIf(notWindows)` で囲む。
 */
export const notWindows = process.platform !== 'win32'
