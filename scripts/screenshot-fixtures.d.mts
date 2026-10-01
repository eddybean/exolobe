/** root の下に library（録音の保存先）と userData（設定）を作る。 */
export declare const writeScreenshotFixtures: (
  root: string,
  options?: {
    /** 無音の m4a を作るか。afconvert を使うので既定は macOS のときだけ true。 */
    audio?: boolean
  }
) => Promise<void>
