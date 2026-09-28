import type { RecordingRepositoryPort } from '@application/ports'
import { interruptSteps, isProcessing, overallStatus } from '@domain/Recording'

export interface RecoverInterruptedStepsDeps {
  readonly repository: RecordingRepositoryPort
}

/**
 * 実行中のまま保存に残ったステップを失敗に直す。
 *
 * パイプラインのステップは開始時点で running として保存される。処理プロセスが
 * 落ちたり、アプリが途中で終了したりすると、その running を書き換える者がいなくなり、
 * 画面は「処理中」を出し続け、再実行の導線も出ない。
 *
 * 呼んでよいのはパイプラインが何も動かしていないと分かっているときだけ
 * （起動時と、処理プロセスが落ちて次のジョブを始める前）。動いているステップまで
 * 失敗にしてしまうため、判定はここではなく呼び出し側が持つ。
 */
export class RecoverInterruptedSteps {
  constructor(private readonly deps: RecoverInterruptedStepsDeps) {}

  async execute(): Promise<void> {
    const recordings = await this.deps.repository.list()

    for (const recording of recordings) {
      if (!isProcessing(recording.steps)) continue

      const steps = interruptSteps(recording.steps)
      await this.deps.repository.save({ ...recording, steps, status: overallStatus(steps) })
    }
  }
}
