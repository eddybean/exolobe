import { useCallback, useEffect, useState, type ReactElement } from 'react'
import type { FolderDto, RecordingDetailDto, RecordingDto, SetupStateDto } from '@shared/ipc'
import { LibrarySidebar } from './components/LibrarySidebar'
import { isSemanticSearchAvailable } from './library/semanticSearch'
import { TransportBar } from './components/TransportBar'
import { useTransport } from './hooks/useTransport'
import { OnboardingView } from './views/OnboardingView'
import { RecordingDetailView } from './views/RecordingDetailView'
import { SettingsView } from './views/SettingsView'

type Screen = 'library' | 'settings' | 'onboarding'

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
  const [detail, setDetail] = useState<RecordingDetailDto>()
  const [folders, setFolders] = useState<FolderDto[]>([])
  const [semanticAvailable, setSemanticAvailable] = useState(false)

  const transport = useTransport(setup?.settings.audio.sampleRate ?? 16_000)

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
        <h1 className="nav__brand">会議レコーダー</h1>
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

        {screen === 'settings' && (
          <SettingsView setup={setup} onChanged={() => void refreshSetup()} />
        )}

        {screen === 'library' && (
          <div className="library">
            <LibrarySidebar
              folders={folders}
              recordings={recordings}
              semanticAvailable={semanticAvailable}
              selectedId={selectedId}
              onSelect={setSelectedId}
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
            />
            {detail ? (
              <RecordingDetailView
                detail={detail}
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

      <TransportBar transport={transport} />
    </div>
  )
}
