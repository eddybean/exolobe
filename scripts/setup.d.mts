export interface SetupCommand {
  readonly command: string
  readonly args: readonly string[]
}

/** 外部のスクリプトに任せる OS ではそのコマンド。自前で確かめる OS では undefined。 */
export declare const setupCommand: (platform: NodeJS.Platform) => SetupCommand | undefined

export interface SetupReportItem {
  readonly level: 'ok' | 'warn'
  /** 確かめた対象（コマンド名や環境変数名）。 */
  readonly subject: string
  readonly message: string
}

/** Windows で開発を始める前に確かめることの一覧。 */
export declare const windowsSetupReport: (probe: {
  readonly env: Readonly<Record<string, string | undefined>>
  readonly onPath: (name: string) => boolean
  /** npm run build:whisper が resources/bin に作った whisper-cli.exe があるか。 */
  readonly whisperBuilt: boolean
}) => readonly SetupReportItem[]
