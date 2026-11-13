// Records a voice note with the phone's microphone. The sound stays in memory, on this
// phone: it is handed to the caller as a blob and goes nowhere until an envelope is sealed.

import { useEffect, useRef, useState } from 'react'
import type { Recording } from '../../data/do'
import { clock } from '../../lib/when'
import { Button, buzz } from '../../ui/components'
import { Icon } from '../../ui/deco/Icon'
import { Player } from './Player'

/** Longer than this and it is a podcast. Also keeps the sealed file well under the cloud's limit. */
export const MAX_SECONDS = 300

export interface RecorderLabels {
  record: string
  stop: string
  recording: string
  play: string
  pause: string
  again: string
  remove: string
  limit: (clock: string) => string
  denied: string
  unsupported: string
  failed: string
  length: (clock: string) => string
}

interface Props {
  value: Recording | null
  onChange: (recording: Recording | null) => void
  labels: RecorderLabels
}

/** The formats a phone might record in, best first. */
const FORMATS = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus']

function pickFormat(): string | undefined {
  if (typeof MediaRecorder === 'undefined') return undefined
  return FORMATS.find((format) => MediaRecorder.isTypeSupported(format))
}

export function Recorder({ value, onChange, labels }: Props) {
  const [state, setState] = useState<'idle' | 'recording'>('idle')
  const [seconds, setSeconds] = useState(0)
  const [problem, setProblem] = useState<string | null>(null)
  const session = useRef<{ recorder: MediaRecorder; stream: MediaStream; startedAt: number; timer: ReturnType<typeof setInterval> } | null>(null)

  const release = () => {
    const current = session.current
    if (!current) return
    clearInterval(current.timer)
    for (const track of current.stream.getTracks()) track.stop()
    session.current = null
  }

  // Leaving the page in the middle of a recording lets go of the microphone.
  useEffect(() => () => release(), [])

  const stop = () => {
    const current = session.current
    if (current && current.recorder.state !== 'inactive') current.recorder.stop()
  }

  const start = async () => {
    setProblem(null)
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') return setProblem(labels.unsupported)
    let stream: MediaStream
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true })
    } catch (error) {
      const name = (error as { name?: string }).name
      return setProblem(name === 'NotAllowedError' || name === 'SecurityError' ? labels.denied : labels.failed)
    }
    try {
      const format = pickFormat()
      const recorder = new MediaRecorder(stream, { ...(format ? { mimeType: format } : {}), audioBitsPerSecond: 32_000 })
      const chunks: Blob[] = []
      const startedAt = Date.now()
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunks.push(event.data)
      }
      recorder.onerror = () => {
        release()
        setState('idle')
        setProblem(labels.failed)
      }
      recorder.onstop = () => {
        const length = (Date.now() - startedAt) / 1000
        const mime = recorder.mimeType || format || 'audio/webm'
        release()
        setState('idle')
        const blob = new Blob(chunks, { type: mime })
        if (blob.size === 0) return setProblem(labels.failed)
        buzz([10, 30, 10])
        onChange({ blob, mime, seconds: Math.max(1, length) })
      }
      const timer = setInterval(() => {
        const passed = (Date.now() - startedAt) / 1000
        setSeconds(passed)
        if (passed >= MAX_SECONDS) stop()
      }, 250)
      session.current = { recorder, stream, startedAt, timer }
      setSeconds(0)
      setState('recording')
      buzz(14)
      recorder.start(1000)
    } catch {
      for (const track of stream.getTracks()) track.stop()
      setProblem(labels.failed)
    }
  }

  if (state === 'recording') {
    return (
      <div className="flex items-center gap-3 rounded-card border-[1.5px] border-wax bg-surface p-3" data-testid="recorder" data-state="recording">
        <button type="button" aria-label={labels.stop} onClick={stop} className="grid size-12 shrink-0 place-items-center rounded-full bg-wax text-on-wax shadow-[0_3px_0_var(--color-wax-edge)] active:translate-y-[2px]">
          <Icon name="stop" size={22} />
        </button>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-bold" role="status">
            {labels.recording}
          </p>
          <p className="tabular text-xs font-semibold text-ink-soft">
            {clock(seconds)} / {clock(MAX_SECONDS)}
          </p>
        </div>
        {/* Five bars breathing: something is listening. */}
        <div className="flex h-8 items-center gap-1 pr-1 text-wax" aria-hidden>
          {[0, 1, 2, 3, 4].map((bar) => (
            <span key={bar} className="h-full w-1 origin-center rounded-full bg-current" style={{ animation: `listen 0.9s ease-in-out ${bar * 0.12}s infinite` }} />
          ))}
        </div>
      </div>
    )
  }

  if (value) {
    return (
      <div className="flex flex-col gap-2" data-testid="recorder" data-state="recorded">
        <Player sound={value.blob} seconds={value.seconds} labels={labels} />
        <div className="flex flex-wrap gap-x-1">
          <Button variant="quiet" onClick={() => void start()}>
            {labels.again}
          </Button>
          <Button variant="quiet" onClick={() => onChange(null)}>
            {labels.remove}
          </Button>
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-2.5" data-testid="recorder" data-state="idle">
      <div className="flex items-center gap-3">
        <Button variant="secondary" icon={<Icon name="mic" size={20} />} onClick={() => void start()}>
          {labels.record}
        </Button>
        <span className="text-xs font-semibold text-ink-soft">{labels.limit(clock(MAX_SECONDS))}</span>
      </div>
      {problem && (
        <p role="alert" className="text-xs font-semibold leading-snug text-accent">
          {problem}
        </p>
      )}
    </div>
  )
}
