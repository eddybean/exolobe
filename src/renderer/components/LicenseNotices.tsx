import type { ReactElement } from 'react'
import { LICENSE_TEXTS } from '@domain/LicenseTexts'
import { NOTICE_GROUPS, usedLicenses, type ThirdPartyNotice } from '@domain/ThirdPartyNotices'
import { licensesText } from '../i18n/licenses'

/**
 * ライセンス表記。設定画面の「このアプリについて」にそのまま出す。
 *
 * 以前は設定画面の 1 本のページに並べると他の項目が押し下げられるのでモーダルへ
 * 逃がしていたが、項目ごとのページになったので、専用のページに全文を置けばよい。
 * 表記そのものは純粋なデータ（@domain/ThirdPartyNotices）で、ここは描くだけ。
 */
export const LicenseNotices = (): ReactElement => {
  const t = licensesText()

  return (
    <div className="licenses__body">
      <p className="licenses__lead">{t.lead}</p>

      {NOTICE_GROUPS.map((group) => (
        <section key={group.id} className="settings-card">
          <h3 className="settings-card__title">{t.groups[group.id].title}</h3>
          <p className="licenses__lead">{t.groups[group.id].description}</p>
          <ul className="licenses">
            {group.entries.map((notice) => (
              <NoticeItem key={notice.name} notice={notice} />
            ))}
          </ul>
        </section>
      ))}

      <section className="settings-card">
        <h3 className="settings-card__title">{t.fullTextTitle}</h3>
        {usedLicenses().map((id) => {
          const license = LICENSE_TEXTS[id]
          return (
            <details key={id} className="licenses__full">
              <summary>{license.title}</summary>
              {license.body === undefined ? (
                <p className="licenses__lead">
                  {t.publishedElsewhere}
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
  )
}

const NoticeItem = ({ notice }: { notice: ThirdPartyNotice }): ReactElement => {
  const t = licensesText()
  return (
    <li className="licenses__item">
      <span className="licenses__name">{notice.name}</span>
      <span className="licenses__license">{notice.license}</span>
      {notice.copyright !== undefined && <span className="licenses__copyright">{notice.copyright}</span>}
      {notice.noteId !== undefined && <span className="licenses__note">{t.notes[notice.noteId]}</span>}
      {notice.requiredNotice !== undefined && <span className="licenses__note">{notice.requiredNotice}</span>}
      <a className="licenses__url" href={notice.url} target="_blank" rel="noreferrer">
        {notice.url}
      </a>
    </li>
  )
}
