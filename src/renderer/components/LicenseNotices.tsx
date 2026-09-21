import { useCallback, useEffect, useRef, useState, type ReactElement } from 'react'
import { LICENSE_TEXTS } from '@domain/LicenseTexts'
import {
  NOTICE_GROUPS,
  usedLicenses,
  type ThirdPartyNotice
} from '@domain/ThirdPartyNotices'
import { useModalKeys } from '../hooks/useModalKeys'

/**
 * ライセンス表記への入口。
 *
 * 本文は設定画面に直接置かずモーダルへ逃がす。全文まで含めると数万字になり、
 * 設定画面に並べると他の項目が届かない位置まで押し下げられる。
 * 表記そのものは純粋なデータ（@domain/ThirdPartyNotices）で、ここは描くだけ。
 */
export const LicenseNotices = (): ReactElement => {
  const [open, setOpen] = useState(false)
  const openerRef = useRef<HTMLButtonElement>(null)
  const restoring = useRef(false)

  const close = useCallback((): void => {
    setOpen(false)
    restoring.current = true
  }, [])

  // 閉じたあとのフォーカスを開いたボタンへ戻す。body に落ちると
  // キーボードだけの操作で現在地を見失う。
  useEffect(() => {
    if (open || !restoring.current) return
    restoring.current = false
    openerRef.current?.focus()
  }, [open])

  return (
    <div className="field">
      <button type="button" ref={openerRef} onClick={() => setOpen(true)}>
        ライセンス表記
      </button>
      <span className="field__hint">
        このアプリが利用しているソフトウェアとモデルの著作権表示とライセンスです。
      </span>

      {open && <LicenseModal onClose={close} />}
    </div>
  )
}

const LicenseModal = ({ onClose }: { onClose: () => void }): ReactElement => {
  const panelRef = useRef<HTMLDivElement>(null)
  const closeRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    closeRef.current?.focus()
  }, [])

  useModalKeys(panelRef, onClose)

  const title = 'ライセンス表記'

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        ref={panelRef}
        className="modal modal--wide"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(event) => event.stopPropagation()}
      >
        <h3 className="modal__title">{title}</h3>

        <div className="licenses__body">
          {NOTICE_GROUPS.map((group) => (
            <section key={group.title}>
              <h4 className="licenses__group">{group.title}</h4>
              <p className="licenses__lead">{group.description}</p>
              <ul className="licenses">
                {group.entries.map((notice) => (
                  <NoticeItem key={notice.name} notice={notice} />
                ))}
              </ul>
            </section>
          ))}

          <section>
            <h4 className="licenses__group">ライセンス全文</h4>
            {usedLicenses().map((id) => {
              const license = LICENSE_TEXTS[id]
              return (
                <details key={id} className="licenses__full">
                  <summary>{license.title}</summary>
                  {license.body === undefined ? (
                    <p className="licenses__lead">
                      条項は配布元で公開されています。
                      <a href={license.url} target="_blank" rel="noreferrer">
                        {license.url}
                      </a>
                    </p>
                  ) : (
                    <pre className="licenses__text">{license.body}</pre>
                  )}
                </details>
              )
            })}
          </section>
        </div>

        <div className="modal__actions">
          <button type="button" ref={closeRef} onClick={onClose}>
            閉じる
          </button>
        </div>
      </div>
    </div>
  )
}

const NoticeItem = ({ notice }: { notice: ThirdPartyNotice }): ReactElement => (
  <li className="licenses__item">
    <span className="licenses__name">{notice.name}</span>
    <span className="licenses__license">{notice.license}</span>
    {notice.copyright !== undefined && (
      <span className="licenses__copyright">{notice.copyright}</span>
    )}
    {notice.note !== undefined && <span className="licenses__note">{notice.note}</span>}
    <a className="licenses__url" href={notice.url} target="_blank" rel="noreferrer">
      {notice.url}
    </a>
  </li>
)
