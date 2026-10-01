export interface PatchCommand {
  readonly command: string
  readonly args: readonly string[]
}

/** 開発用 Electron を直すコマンド。直す必要の無い OS では undefined。 */
export declare const devElectronPatchCommand: (platform: NodeJS.Platform) => PatchCommand | undefined
