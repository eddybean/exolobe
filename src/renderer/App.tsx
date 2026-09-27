import { useCallback, useEffect, useRef, useState, type CSSProperties, type ReactElement } from 'react'
import type {
  FolderDto,
  ImportProgressDto,
  RecordingDetailDto,
  RecordingDto,
  SetupStateDto
} from '@shared/ipc'
import { LibrarySidebar } from './components/LibrarySidebar'
import { PaneResizer } from './components/PaneResizer'
import type { FolderKey } from './library/folders'
import { initialSettingsSection, type SettingsSectionId } from './settingsSections'
import { messageOf } from './errorMessage'
import { importSummary } from './library/fileDrop'
import { useChat } from './hooks/useChat'
import { useFileDrop } from './hooks/useFileDrop'
import { useLibraryWidth } from './hooks/useLibraryWidth'
import { isSemanticSearchAvailable } from './library/semanticSearch'
import { recordingToOpen, showsLiveView } from './library/liveNotes'
import { TransportBar } from './components/TransportBar'
import { useTransport } from './hooks/useTransport'
import { ChatView } from './views/ChatView'
import { OnboardingView } from './views/OnboardingView'
import { RecordingDetailView } from './views/RecordingDetailView'
import { RecordingLiveView } from './views/RecordingLiveView'
import { SettingsView } from './views/SettingsView'

type Screen = 'library' | 'chat' | 'settings' | 'onboarding'

/**
 * 画面の器。
 *
 * 録音バーはビューの外側に置き、どの画面でも常に表示され続けるようにしている
 * （会議中に画面を切り替えても停止できることが要件のため）。
 */
export const App = (): ReactElement => {
  const [setup, setSetup] = useState<SetupStateDto>()
  const [screen, setScreen] = useState<Screen>('library')
  const [recordings, setRecordings] = useState<RecordingDto[]>([])
  const [selectedId, setSelectedId] = useState<string>()
  /**
   * 本文の検索から飛んだ先の発言。録音を開き直したら消えるよう録音 id ごと持つ。
   * 同じヒットをもう一度押しても飛べるよう、押すたびに増える nonce を添える。
   */
  const [focus, setFocus] = useState<{
    recordingId: string
    startMs: number
    nonce: number
  }>()
  const [detail, setDetail] = useState<RecordingDetailDto>()
  const [folders, setFolders] = useState<FolderDto[]>([])
  /**
   * ライブラリのツリーで、ユーザーが手で開閉したノード。
   * サイドバーは画面を切り替えると消えるので、開閉状態はここで持ち越す。
   */
  const [folderKey, setFolderKey] = useState<FolderKey>('all')
  const [settingsSection, setSettingsSection] = useState<SettingsSectionId>()
  const libraryWidth = useLibraryWidth()
  const [resizingLibrary, setResizingLibrary] = useState(false)
  const libraryStyle: CSSProperties & Record<'--library-width', string> = {
    '--library-width': `${libraryWidth.width}px`
  }
  const [semanticAvailable, setSemanticAvailable] = useState(false)
  const [importing, setImporting] = useState<ImportProgressDto>()
  const [importError, setImportError] = useState<string>()

  const transport = useTransport(setup?.settings.audio.sampleRate ?? 16_000)
  // 会話は画面を切り替えても残す。引用から録音へ飛ぶとチャット画面は外れるので、
  // チャット側に持たせると戻ったときに会話が消える。
  const chat = useChat()

  const refreshSetup = useCallback(async (): Promise<void> => {
    const state = await window.recorder.getSetupState()
    setSetup(state)
    // 設定やモデルが変わるたびにここを通るので、意味検索を出せるかも合わせて確かめる。
    setSemanticAvailable(isSemanticSearchAvailable(await window.recorder.getSearchIndexStatus()))
    // 保存先が未設定なら、まず初期設定に誘導する。
    setScreen((current) =>
      state.needsStorageDir ? 'onboarding' : current === 'onboarding' ? 'library' : current
    )
  }, [])

  const refreshList = useCallback(async (): Promise<void> => {
    setRecordings(await window.recorder.listRecordings())
  }, [])

  const refreshFolders = useCallback(async (): Promise<void> => {
    setFolders(await window.recorder.listFolders())
  }, [])

  const refreshDetail = useCallback(async (): Promise<void> => {
    if (!selectedId) {
      setDetail(undefined)
      return
    }
    try {
      setDetail(await window.recorder.getRecording(selectedId))
    } catch {
      // 削除直後などで開けない場合は選択を外す。
      setSelectedId(undefined)
      setDetail(undefined)
    }
  }, [selectedId])

  /**
   * 削除は取り消せないため、まず main にネイティブの確認ダイアログを出させる。
   * 選択中のものを消したときは選択を外し、詳細ペインを空に戻す。
   */
  const deleteRecording = useCallback(
    async (id: string): Promise<void> => {
      if (!(await window.recorder.confirmDeleteRecording(id))) return

      await window.recorder.deleteRecording(id)
      setSelectedId((current) => (current === id ? undefined : current))
      await refreshList()
    },
    [refreshList]
  )

  /**
   * 取り込みは選択とドロップの両方から来るので、結果の扱いを 1 箇所にまとめる。
   * 成功は一覧に録音が増えることで分かるので、失敗だけを知らせる。
   */
  const runImport = useCallback(
    async (filePaths: readonly string[]): Promise<void> => {
      setImportError(undefined)
      setImporting({ done: 0, total: filePaths.length, fileName: '' })
      try {
        setImportError(importSummary(await window.recorder.importAudioFiles(filePaths)))
      } catch (error: unknown) {
        setImportError(messageOf(error))
      } finally {
        setImporting(undefined)
        await refreshList()
      }
    },
    [refreshList]
  )

  const chooseAndImport = useCallback(async (): Promise<void> => {
    setImportError(undefined)
    setImporting({ done: 0, total: 0, fileName: '' })
    try {
      setImportError(importSummary(await window.recorder.chooseAudioFilesToImport()))
    } catch (error: unknown) {
      setImportError(messageOf(error))
    } finally {
      setImporting(undefined)
      await refreshList()
    }
  }, [refreshList])

  const drop = useFileDrop({
    enabled: screen === 'library',
    onDrop: (filePaths) => void runImport(filePaths)
  })

  // 取り込みが終わった後に遅れて届いた進捗で、消したはずの表示を蘇らせない。
  useEffect(
    () =>
      window.recorder.onImportProgress((event) =>
        setImporting((current) => (current === undefined ? undefined : event))
      ),
    []
  )

  useEffect(() => {
    void refreshSetup()
  }, [refreshSetup])

  useEffect(() => {
    void refreshList()
    return window.recorder.onRecordingsChanged(() => {
      void refreshList()
      void refreshDetail()
    })
  }, [refreshList, refreshDetail])

  useEffect(() => {
    void refreshDetail()
  }, [refreshDetail])

  // 録音を始めたら、その録音の録音中の画面（メモと印）を開く。始めた瞬間だけで、
  // 録音中に利用者が別の録音を開き直したときは奪わない（recordingToOpen）。
  const previousTransport = useRef(transport.state)
  useEffect(() => {
    const started = recordingToOpen(previousTransport.current, transport.state)
    previousTransport.current = transport.state
    if (started === undefined) return
    setSelectedId(started)
    setFocus(undefined)
    // 初期設定の途中では動かさない（保存先が無いまま一覧へ出すことになる）。
    setScreen((current) => (current === 'onboarding' ? current : 'library'))
  }, [transport.state])

  useEffect(() => {
    void refreshFolders()
    return window.recorder.onFoldersChanged(() => void refreshFolders())
  }, [refreshFolders])

  if (!setup) {
    return <main className="app app--loading">読み込み中…</main>
  }

  return (
    <div className="app">
      <nav className="nav">
        <div className="nav__links">
          <button
            type="button"
            className={screen === 'library' ? 'nav__link nav__link--active' : 'nav__link'}
            onClick={() => setScreen('library')}
          >
            録音
          </button>
          <button
            type="button"
            className={screen === 'chat' ? 'nav__link nav__link--active' : 'nav__link'}
            onClick={() => setScreen('chat')}
          >
            チャット
          </button>
          <button
            type="button"
            className={screen === 'settings' ? 'nav__link nav__link--active' : 'nav__link'}
            onClick={() => setScreen('settings')}
          >
            設定
          </button>
        </div>
      </nav>

      <main className="main">
        {screen === 'onboarding' && (
          <OnboardingView
            setup={setup}
            onChanged={() => void refreshSetup()}
            onOpenSettings={() => setScreen('settings')}
          />
        )}

        {screen === 'chat' && (
          <ChatView
            chat={chat}
            onOpenRecording={(id) => {
              setSelectedId(id)
              setScreen('library')
            }}
          />
        )}

        {screen === 'settings' && (
          <SettingsView
            setup={setup}
            section={initialSettingsSection({
              storageDir: setup.settings.storageDir,
              previous: settingsSection
            })}
            onSectionChange={setSettingsSection}
            onChanged={() => void refreshSetup()}
          />
        )}

        {screen === 'library' && (
          <div
            className={[
              'library',
              importing || importError ? 'library--notified' : '',
              resizingLibrary ? 'library--resizing' : ''
            ]
              .filter(Boolean)
              .join(' ')}
            style={libraryStyle}
          >
            {drop.active && (
              <div className="drop-overlay" aria-hidden="true">
                <p className="drop-overlay__label">音声ファイルをドロップすると取り込みます</p>
              </div>
            )}
            {importing && (
              <p className="library__import-status" role="status">
                音声を取り込んでいます…
                {importing.total > 0 && ` ${importing.done}/${importing.total}`}
                {importing.fileName && `（${importing.fileName}）`}
              </p>
            )}

            {importError && (
              <div className="library__import-error" role="alert">
                <span>{importError}</span>
                <button
                  type="button"
                  onClick={() => setImportError(undefined)}
                  aria-label="取り込みのエラーを閉じる"
                >
                  ✕
                </button>
              </div>
            )}

            <LibrarySidebar
              folders={folders}
              recordings={recordings}
              semanticAvailable={semanticAvailable}
              selectedId={selectedId}
              onSelect={(id) => {
                setSelectedId(id)
                setFocus(undefined)
              }}
              onSelectSegment={(recordingId, startMs) => {
                setSelectedId(recordingId)
                setFocus((current) => ({
                  recordingId,
                  startMs,
                  nonce: (current?.nonce ?? 0) + 1
                }))
              }}
              focus={focus}
              onCreateFolder={(params) => void window.recorder.createFolder(params)}
              onRenameFolder={(folderId, name) =>
                void window.recorder.renameFolder(folderId, name)
              }
              onDeleteFolder={(folderId) => void window.recorder.deleteFolder(folderId)}
              onMoveFolder={(folderId, parentId) =>
                void window.recorder.moveFolder(folderId, parentId)
              }
              onMoveRecording={(recordingId, folderId) =>
                void window.recorder.moveRecordingToFolder(recordingId, folderId)
              }
              onImport={() => void chooseAndImport()}
              importing={importing !== undefined}
              folderKey={folderKey}
              onSelectFolder={setFolderKey}
            />
            <PaneResizer pane={libraryWidth} onDraggingChange={setResizingLibrary} />
            {detail && showsLiveView(detail.recording, transport.state) ? (
              <RecordingLiveView
                key={detail.recording.id}
                detail={detail}
                transport={transport}
                onChanged={() => void refreshDetail()}
              />
            ) : detail ? (
              <RecordingDetailView
                detail={detail}
                focus={focus?.recordingId === detail.recording.id ? focus : undefined}
                onChanged={() => void refreshDetail()}
                onDelete={() => void deleteRecording(detail.recording.id)}
              />
            ) : (
              <section className="detail detail--empty">
                <p>左のライブラリから録音を選ぶと、文字起こし・要約・メモを表示します。</p>
              </section>
            )}
          </div>
        )}
      </main>

      <TransportBar
        transport={transport}
        shortcutEnabled={setup?.settings.recording.globalShortcutEnabled ?? false}
      />
    </div>
  )
}
