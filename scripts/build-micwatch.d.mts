export interface MicwatchBuildCommand {
  readonly command: string
  readonly args: readonly string[]
}

/** その OS で micwatch を作るコマンド。作れない OS では undefined。 */
export declare const micwatchBuildCommand: (platform: NodeJS.Platform) => MicwatchBuildCommand | undefined
