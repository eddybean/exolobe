import type { ReactElement } from 'react'
import { LICENSE_TEXTS } from '@domain/LicenseTexts'
import {
  NOTICE_GROUPS,
  usedLicenses,
  type ThirdPartyNotice
} from '@domain/ThirdPartyNotices'

/**
 * ライセンス表記。設定画面の「このアプリについて」にそのまま出す。
 *
 * 以前は設定画面の 1 本のページに並べると他の項目が押し下げられるのでモーダルへ
 * 逃がしていたが、項目ごとのページになったので、専用のページに全文を置けばよい。
 * 表記そのものは純粋なデータ（@domain/ThirdPartyNotices）で、ここは描くだけ。
 */
export const LicenseNotices = (): ReactElement => (
  <div className="licenses__body">
    <p className="licenses__lead">
      このアプリが利用しているソフトウェアとモデルの著作権表示とライセンスです。
    </p>

    {NOTICE_GROUPS.map((group) => (
      <section key={group.title}>
        <h3 className="licenses__group">{group.title}</h3>
        <p className="licenses__lead">{group.description}</p>
        <ul className="licenses">
          {group.entries.map((notice) => (
            <NoticeItem key={notice.name} notice={notice} />
          ))}
        </ul>
      </section>
    ))}

    <section>
      <h3 className="licenses__group">ライセンス全文</h3>
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
)

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
