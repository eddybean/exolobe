import type { LiveAssistModelPort } from '@application/ports'
import { AppleLmSessionFactory } from '@infrastructure/summarization/AppleLmSessionFactory'

/**
 * 録音中のアシストの生成（ADR-050）。要約と同じ applelm を 1 回の応答ごとに起こす（ADR-046）。
 * モデルは OS のプロセスで動くので、このアプリのメモリは使わない。
 */
export class AppleLmLiveModel implements LiveAssistModelPort {
  private readonly factory: AppleLmSessionFactory

  constructor(binaryPath: string | undefined) {
    this.factory = new AppleLmSessionFactory(binaryPath)
  }

  async respond(prompt: string): Promise<string> {
    const session = await this.factory.create()
    try {
      return await session.prompt(prompt)
    } finally {
      await session.dispose()
    }
  }
}
