import type { LicenseId } from './LicenseTexts'
import type { ManagedAssetId } from './ModelCatalog'

/**
 * 利用している第三者ソフトウェアとモデルの表記。
 *
 * MIT / BSD-3-Clause / Apache-2.0 はいずれも「著作権表示とライセンスの写しを
 * 配布物に含めること」を許諾の条件にしている。アプリの中から読めなければ
 * 条件を満たさないので、設定画面のモーダルから全部を見せる。
 *
 * 著作権表示は配布元の原文をそのまま写す（訳したり年をまとめたりしない）。
 * 掲げていない配布元のものは copyright を持たせず、note でその旨を書く。
 *
 * ここは手で保つ一覧なので、依存やモデルを足したときに漏れる。
 * tests/domain/third-party-notices.test.ts が package.json の dependencies と
 * MANAGED_ASSETS を突き合わせて、漏れたら落ちるようにしてある。
 */

/** 表記に添える説明の種類。 */
export type NoticeNoteId =
  | 'includedInElectron'
  | 'renderingUi'
  | 'bundledWhisperCli'
  | 'includedInNodeLlamaCpp'
  | 'linkedIntoWhisperAndLlama'
  | 'speakerIdentification'
  | 'includedInSherpaOnnx'
  | 'systemAudioNoCopyright'
  | 'ggmlConversionByWhisperCpp'
  | 'onnxConversionBySherpa'
  | 'ggufConversionByGgmlOrg'

export interface ThirdPartyNotice {
  readonly name: string
  readonly license: LicenseId
  /** 配布元。表記の出所を利用者が確かめられるようにする。 */
  readonly url: string
  /** 配布元が掲げている著作権表示の原文。 */
  readonly copyright?: string
  /** どう使っているか、あるいは表記が欠けている理由。文言は画面が UI の言語で引く（ADR-043）。 */
  readonly noteId?: NoticeNoteId
  /** 配布元が表示を求める文。条件の一部なので訳さず原文のまま載せる。 */
  readonly requiredNotice?: string
  /** npm パッケージ名。同梱している依存が漏れていないかの突き合わせに使う。 */
  readonly packageName?: string
  /** このモデルの表記であることを示す。カタログとの突き合わせに使う。 */
  readonly assetIds?: readonly ManagedAssetId[]
}

/** アプリに同梱していて、配布物と一緒に渡るもの。 */
const BUNDLED: readonly ThirdPartyNotice[] = [
  {
    name: 'Electron',
    license: 'MIT',
    url: 'https://github.com/electron/electron',
    copyright: 'Copyright (c) Electron contributors\nCopyright (c) 2013-2020 GitHub Inc.',
    packageName: 'electron'
  },
  {
    name: 'Chromium',
    license: 'BSD-3-Clause',
    url: 'https://www.chromium.org/Home/',
    copyright: 'Copyright 2015 The Chromium Authors',
    noteId: 'includedInElectron'
  },
  {
    name: 'Node.js',
    license: 'MIT',
    url: 'https://nodejs.org/',
    copyright: 'Copyright Node.js contributors. All rights reserved.',
    noteId: 'includedInElectron'
  },
  {
    name: 'React',
    license: 'MIT',
    url: 'https://react.dev/',
    copyright: 'Copyright (c) Meta Platforms, Inc. and affiliates.',
    noteId: 'renderingUi'
  },
  {
    name: 'whisper.cpp',
    license: 'MIT',
    url: 'https://github.com/ggml-org/whisper.cpp',
    copyright: 'Copyright (c) 2023-2026 The ggml authors',
    noteId: 'bundledWhisperCli'
  },
  {
    name: 'llama.cpp',
    license: 'MIT',
    url: 'https://github.com/ggml-org/llama.cpp',
    copyright: 'Copyright (c) 2023-2026 The ggml authors',
    noteId: 'includedInNodeLlamaCpp'
  },
  {
    name: 'ggml',
    license: 'MIT',
    url: 'https://github.com/ggml-org/ggml',
    copyright: 'Copyright (c) 2023-2026 The ggml authors',
    noteId: 'linkedIntoWhisperAndLlama'
  },
  {
    name: 'node-llama-cpp',
    license: 'MIT',
    url: 'https://node-llama-cpp.withcat.ai/',
    copyright: 'Copyright (c) 2023 Gilad S.',
    packageName: 'node-llama-cpp'
  },
  {
    name: 'sherpa-onnx',
    license: 'Apache-2.0',
    url: 'https://github.com/k2-fsa/sherpa-onnx',
    copyright: 'Copyright (c) 2022-2024 Xiaomi Corporation',
    noteId: 'speakerIdentification',
    packageName: 'sherpa-onnx-node'
  },
  {
    name: 'ONNX Runtime',
    license: 'MIT',
    url: 'https://github.com/microsoft/onnxruntime',
    copyright: 'Copyright (c) Microsoft Corporation',
    noteId: 'includedInSherpaOnnx'
  },
  {
    name: 'AudioTee',
    license: 'MIT',
    url: 'https://github.com/makeusabrew/audiotee',
    noteId: 'systemAudioNoCopyright',
    packageName: 'audiotee'
  }
]

/**
 * 利用者が配布元からダウンロードして使うモデル。
 *
 * アプリは再配布していないので写しを同梱する義務は無いが、出所とライセンスが
 * 分からないまま使わせない。Gemma のように商用利用に条件が付くものがある。
 */
const MODELS: readonly ThirdPartyNotice[] = [
  {
    name: 'Whisper (large-v3-turbo)',
    license: 'MIT',
    url: 'https://github.com/openai/whisper',
    copyright: 'Copyright (c) 2022 OpenAI',
    noteId: 'ggmlConversionByWhisperCpp',
    assetIds: ['transcription-model', 'transcription-coreml-encoder']
  },
  {
    name: 'Silero VAD',
    license: 'MIT',
    url: 'https://github.com/snakers4/silero-vad',
    copyright: 'Copyright (c) 2020-present Silero Team',
    assetIds: ['vad-model']
  },
  {
    name: 'Gemma',
    license: 'Gemma Terms of Use',
    url: 'https://ai.google.dev/gemma/terms',
    requiredNotice: 'Gemma is provided under and subject to the Gemma Terms of Use found at ai.google.dev/gemma/terms',
    assetIds: ['summarization-model']
  },
  {
    name: 'pyannote.audio (segmentation 3.0)',
    license: 'MIT',
    url: 'https://github.com/pyannote/pyannote-audio',
    copyright: 'Copyright (c) 2020 CNRS',
    noteId: 'onnxConversionBySherpa',
    assetIds: ['diarization-segmentation']
  },
  {
    name: '3D-Speaker (CAM++)',
    license: 'Apache-2.0',
    url: 'https://github.com/alibaba-damo-academy/3D-Speaker',
    copyright: 'Copyright 3D-Speaker (https://github.com/alibaba-damo-academy/3D-Speaker). All Rights Reserved.',
    noteId: 'onnxConversionBySherpa',
    assetIds: ['diarization-embedding']
  },
  {
    name: 'BGE-M3',
    license: 'MIT',
    url: 'https://github.com/FlagOpen/FlagEmbedding',
    copyright: 'Copyright (c) 2022 staoxiao',
    noteId: 'ggufConversionByGgmlOrg',
    assetIds: ['search-model']
  }
]

/** 見出しと説明は画面が UI の言語で引く（ADR-043）。 */
export interface NoticeGroup {
  readonly id: 'bundled' | 'models'
  readonly entries: readonly ThirdPartyNotice[]
}

export const NOTICE_GROUPS: readonly NoticeGroup[] = [
  { id: 'bundled', entries: BUNDLED },
  { id: 'models', entries: MODELS }
]

export const THIRD_PARTY_NOTICES: readonly ThirdPartyNotice[] = [...BUNDLED, ...MODELS]

/** 表記に出てくるライセンスだけを、一覧に並ぶ順で返す。使っていない全文は見せない。 */
export const usedLicenses = (notices: readonly ThirdPartyNotice[] = THIRD_PARTY_NOTICES): readonly LicenseId[] => [
  ...new Set(notices.map((notice) => notice.license))
]
