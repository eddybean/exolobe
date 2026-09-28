import type { NoticeGroup, NoticeNoteId } from '@domain/ThirdPartyNotices'
import { localized } from './locale'

const ja: {
  lead: string
  fullTextTitle: string
  publishedElsewhere: string
  groups: Readonly<Record<NoticeGroup['id'], { title: string; description: string }>>
  notes: Readonly<Record<NoticeNoteId, string>>
} = {
  lead: 'このアプリが利用しているソフトウェアとモデルの著作権表示とライセンスです。',
  fullTextTitle: 'ライセンス全文',
  publishedElsewhere: '条項は配布元で公開されています。',
  groups: {
    bundled: {
      title: '同梱しているソフトウェア',
      description: 'アプリと一緒に配布しているものです。'
    },
    models: {
      title: 'ダウンロードして使うモデル',
      description: 'アプリには含まれず、設定画面から配布元より取得します。'
    }
  },
  notes: {
    includedInElectron: 'Electron に含まれています。',
    renderingUi: 'react / react-dom を画面の描画に使っています。',
    bundledWhisperCli: 'ビルドした whisper-cli を同梱しています。',
    includedInNodeLlamaCpp: 'node-llama-cpp に含まれています。',
    linkedIntoWhisperAndLlama: 'whisper.cpp と llama.cpp に静的リンクされています。',
    speakerIdentification: 'sherpa-onnx-node（ネイティブアドオン）として話者識別に使っています。',
    includedInSherpaOnnx: 'sherpa-onnx-node に含まれています。',
    systemAudioNoCopyright:
      'システム音声の取り込みに使っています。配布元が著作権表示を掲げていないため、ライセンスの種別だけを示します。',
    ggmlConversionByWhisperCpp: 'ggml 形式への変換は whisper.cpp の配布物を使っています。',
    onnxConversionBySherpa: 'sherpa-onnx が配布する ONNX 変換版を使っています。',
    ggufConversionByGgmlOrg: 'GGUF 形式への変換は ggml-org の配布物を使っています。'
  }
}

const en: typeof ja = {
  lead: 'Copyright notices and licenses for the software and models this app uses.',
  fullTextTitle: 'Full license texts',
  publishedElsewhere: 'The terms are published by the distributor.',
  groups: {
    bundled: {
      title: 'Bundled software',
      description: 'Distributed together with the app.'
    },
    models: {
      title: 'Downloaded models',
      description: 'Not included in the app; downloaded from the distributor in Settings.'
    }
  },
  notes: {
    includedInElectron: 'Included in Electron.',
    renderingUi: 'react / react-dom render the app’s screens.',
    bundledWhisperCli: 'A build of whisper-cli is bundled.',
    includedInNodeLlamaCpp: 'Included in node-llama-cpp.',
    linkedIntoWhisperAndLlama: 'Statically linked into whisper.cpp and llama.cpp.',
    speakerIdentification: 'Used for speaker identification as sherpa-onnx-node (a native add-on).',
    includedInSherpaOnnx: 'Included in sherpa-onnx-node.',
    systemAudioNoCopyright:
      'Used to capture system audio. The distributor does not publish a copyright notice, so only the license type is shown.',
    ggmlConversionByWhisperCpp: 'The ggml conversion distributed by whisper.cpp is used.',
    onnxConversionBySherpa: 'The ONNX conversion distributed by sherpa-onnx is used.',
    ggufConversionByGgmlOrg: 'The GGUF conversion distributed by ggml-org is used.'
  }
}

/** ライセンス表記（LicenseNotices）の枠の文言。個々の表記は @domain/ThirdPartyNotices 由来。 */
export const licensesText = localized({ ja, en })
