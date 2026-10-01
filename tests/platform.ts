/**
 * macOS のコマンド（afconvert・ditto・plutil）や `#!/bin/sh` の偽バイナリを実際に使うテストは、
 * Windows の CI では走らせない（ADR-048）。`describe.skipIf(notMacOS)` で囲む。
 * 製品コードの Windows 版を足したら、その実装のテストは別に書く。
 */
export const notMacOS = process.platform !== 'darwin'
