import { useEffect, useState, type RefObject } from 'react'

export interface AudioPosition {
  /** 再生位置（ミリ秒）。 */
  readonly positionMs: number
  readonly playing: boolean
}

/**
 * audio 要素の再生位置と、再生中かどうか。
 *
 * timeupdate は再生中に数百ミリ秒おきに届く。発言の強調と縦線にはその粒度で足り、
 * 毎フレーム読むと文字起こし全体が描き直されて長い会議で重くなる。
 */
export const useAudioPosition = (
  audioRef: RefObject<HTMLAudioElement | null>,
  /** 切り替わったら位置を読み直す。前の録音の位置を持ち越さない。 */
  sourceKey: string
): AudioPosition => {
  const [position, setPosition] = useState<AudioPosition>({ positionMs: 0, playing: false })

  useEffect(() => {
    const audio = audioRef.current
    if (!audio) return

    const read = (): void =>
      setPosition({ positionMs: audio.currentTime * 1000, playing: !audio.paused })
    read()

    const events = ['timeupdate', 'seeked', 'play', 'pause', 'ended', 'emptied'] as const
    for (const name of events) audio.addEventListener(name, read)
    return () => {
      for (const name of events) audio.removeEventListener(name, read)
    }
  }, [audioRef, sourceKey])

  return position
}
