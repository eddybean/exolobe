export interface WhisperBuildCommand {
  readonly command: string
  readonly args: readonly string[]
}

/** 外部のスクリプトに任せる OS ではそのコマンド。ここでビルドする OS（Windows）では undefined。 */
export declare const whisperBuildCommand: (platform: NodeJS.Platform) => WhisperBuildCommand | undefined

/** Windows の cmake の構成の引数。 */
export declare const windowsCmakeArgs: (sourceDir: string, buildDir: string) => readonly string[]

/** whisper-cli の横に置く Visual C++ ランタイムの DLL。 */
export declare const VC_RUNTIME_DLLS: readonly string[]

/** ビルド成果物のファイル名のうち、resources/bin に運ぶもの。 */
export declare const bundledWhisperFiles: (files: readonly string[]) => readonly string[]
